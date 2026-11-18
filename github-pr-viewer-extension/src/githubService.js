// @ts-check
'use strict';

const { parsePatch } = require('./diffParser');

const MAX_FILES = 300;
const MAX_COMMENTS = 300;
const MAX_TOTAL_DIFF_ROWS = 20000;
const MAX_ROWS_PER_FILE = 3000;
const MAX_BODY_CHARS = 100000;


const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
const SCOPES = ['author', 'assignee', 'review-requested', 'involves', 'any'];
const STATES = ['all', 'open', 'closed', 'merged'];
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 30000;

/**
 * Service to list pull requests through the GitHub Search REST API
 */
class GithubService {
    /**
     * @param {string} apiUrl
     * @param {string} [token]
     * @param {string} [username]
     */
    constructor(apiUrl = 'https://api.github.com', token = '', username = '') {
        this.apiUrl = '';
        this.token = token;
        this.username = username;
        this.setApiUrl(apiUrl);
    }

    /**
     * @param {string} apiUrl
     */
    setApiUrl(apiUrl) {
        const cleaned = String(apiUrl || '').trim().replace(/\/+$/, '');
        if (!/^https:\/\//i.test(cleaned)) {
            throw new Error('githubPrViewer.apiUrl must be an https:// URL.');
        }
        this.apiUrl = cleaned;
    }

    /**
     * @param {string} token
     */
    setToken(token) {
        this.token = token;
    }

    /**
     * @param {string} username
     */
    setUsername(username) {
        this.username = username;
    }

    /**
     * @returns {boolean}
     */
    hasToken() {
        return Boolean(this.token);
    }

    /**
     * Build the GitHub search query from validated filter values.
     * @param {{scope?: string, owner?: string, repo?: string, state?: string}} filters
     * @returns {string}
     */
    buildQuery(filters) {
        const scope = filters.scope || 'author';
        const state = filters.state || 'all';
        let owner = (filters.owner || '').trim();
        let repo = (filters.repo || '').trim();

        if (!SCOPES.includes(scope)) {
            throw new Error('Invalid scope.');
        }
        if (!STATES.includes(state)) {
            throw new Error('Invalid state.');
        }

        // Accept "owner/repo" in the repo field
        if (repo.includes('/')) {
            const parts = repo.split('/');
            if (parts.length !== 2) {
                throw new Error('Repository must be "repo" or "owner/repo".');
            }
            if (owner && owner.toLowerCase() !== parts[0].toLowerCase()) {
                throw new Error('Owner field does not match the owner in the repository filter.');
            }
            owner = parts[0];
            repo = parts[1];
        }
        if (owner && !OWNER_RE.test(owner)) {
            throw new Error('Invalid owner name.');
        }
        if (repo && !REPO_RE.test(repo)) {
            throw new Error('Invalid repository name.');
        }
        if (repo && !owner) {
            throw new Error('Repository filter requires an owner.');
        }

        const terms = ['is:pr'];

        if (scope === 'any') {
            if (!owner) {
                throw new Error('Scope "Any" requires an owner or repository filter.');
            }
        } else {
            let who = '@me';
            if (!this.hasToken()) {
                if (!this.username) {
                    throw new Error('Set an access token or githubPrViewer.username to list your pull requests.');
                }
                if (!USER_RE.test(this.username)) {
                    throw new Error('Invalid githubPrViewer.username.');
                }
                who = this.username;
            }
            terms.push(`${scope}:${who}`);
        }

        if (repo) {
            terms.push(`repo:${owner}/${repo}`);
        } else if (owner) {
            terms.push(`user:${owner}`);
        }

        if (state === 'open') {
            terms.push('is:open');
        } else if (state === 'closed') {
            terms.push('is:closed', 'is:unmerged');
        } else if (state === 'merged') {
            terms.push('is:merged');
        }

        return terms.join(' ');
    }

    /**
     * Fetch pull requests matching the filters
     * @param {{scope?: string, owner?: string, repo?: string, state?: string}} filters
     * @param {number} limit
     * @returns {Promise<Array<any>>}
     */
    async fetchPullRequests(filters, limit = 100) {
        const q = this.buildQuery(filters);
        const max = Math.max(1, Math.min(Number(limit) || 100, 1000));

        const headers = this.headers();

        /** @type {Array<any>} */
        const results = [];
        let page = 1;

        while (results.length < max) {
            const perPage = Math.min(PAGE_SIZE, max - results.length);
            const url = `${this.apiUrl}/search/issues?q=${encodeURIComponent(q)}` +
                `&sort=updated&order=desc&per_page=${perPage}&page=${page}`;

            const response = await fetch(url, {
                headers,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            });

            if (!response.ok) {
                throw new Error(await this.describeError(response));
            }

            const data = await response.json();
            const items = Array.isArray(data.items) ? data.items : [];
            for (const item of items) {
                results.push(this.toPullRequest(item));
            }

            if (items.length < perPage || results.length >= (data.total_count || 0)) {
                break;
            }
            page++;
        }

        return results;
    }

    /**
     * @returns {Record<string, string>}
     */
    headers() {
        /** @type {Record<string, string>} */
        const headers = {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        return headers;
    }

    /**
     * GET a JSON resource below the API root
     * @param {string} apiPath path starting with "/", already URL-safe
     * @returns {Promise<any>}
     */
    async getJson(apiPath) {
        const response = await fetch(`${this.apiUrl}${apiPath}`, {
            headers: this.headers(),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (!response.ok) {
            throw new Error(await this.describeError(response));
        }
        return response.json();
    }

    /**
     * GET a paginated list endpoint, up to maxItems
     * @param {string} apiPath path without query string
     * @param {number} maxItems
     * @returns {Promise<{items: Array<any>, truncated: boolean}>}
     */
    async getPages(apiPath, maxItems) {
        /** @type {Array<any>} */
        const items = [];
        let page = 1;
        for (;;) {
            const data = await this.getJson(`${apiPath}?per_page=${PAGE_SIZE}&page=${page}`);
            const batch = Array.isArray(data) ? data : [];
            items.push(...batch);
            if (batch.length < PAGE_SIZE) {
                return { items, truncated: false };
            }
            if (items.length >= maxItems) {
                return { items: items.slice(0, maxItems), truncated: true };
            }
            page++;
        }
    }

    /**
     * Fetch everything needed for the in-IDE pull request page
     * @param {string} owner
     * @param {string} repo
     * @param {number} number
     * @returns {Promise<any>}
     */
    async fetchPullRequestDetail(owner, repo, number) {
        if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || !Number.isInteger(number) || number < 1) {
            throw new Error('Invalid pull request reference.');
        }
        const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
        const pr = `${base}/pulls/${number}`;

        const [info, files, issueComments, reviewComments, reviews] = await Promise.all([
            this.getJson(pr),
            this.getPages(`${pr}/files`, MAX_FILES),
            this.getPages(`${base}/issues/${number}/comments`, MAX_COMMENTS),
            this.getPages(`${pr}/comments`, MAX_COMMENTS),
            this.getPages(`${pr}/reviews`, MAX_COMMENTS)
        ]);

        return this.toDetail(owner, repo, info, files, issueComments.items, reviewComments.items, reviews.items);
    }

    /**
     * @param {string} owner
     * @param {string} repo
     * @param {any} info
     * @param {{items: Array<any>, truncated: boolean}} files
     * @param {Array<any>} issueComments
     * @param {Array<any>} reviewComments
     * @param {Array<any>} reviews
     * @returns {any}
     */
    toDetail(owner, repo, info, files, issueComments, reviewComments, reviews) {
        let budget = MAX_TOTAL_DIFF_ROWS;
        let diffTruncated = false;

        const outFiles = files.items.map((/** @type {any} */ f) => {
            let rows = null;
            let truncated = false;
            if (typeof f.patch === 'string' && budget > 0) {
                const parsed = parsePatch(f.patch, Math.min(MAX_ROWS_PER_FILE, budget));
                rows = parsed.rows;
                truncated = parsed.truncated;
                budget -= rows.length;
                if (truncated) {
                    diffTruncated = true;
                }
            } else if (typeof f.patch === 'string') {
                diffTruncated = true;
                truncated = true;
            }
            return {
                filename: f.filename,
                previous: f.previous_filename || '',
                status: f.status,
                additions: f.additions || 0,
                deletions: f.deletions || 0,
                url: f.blob_url || '',
                rows,
                // true when GitHub gave no patch (binary or too large) or we cut it
                noPatch: typeof f.patch !== 'string',
                truncated
            };
        });

        // Latest state per reviewer, ignoring plain comments
        /** @type {Map<string, string>} */
        const latest = new Map();
        for (const r of reviews) {
            if (r.user && r.state && r.state !== 'COMMENTED' && r.state !== 'PENDING') {
                latest.set(r.user.login, r.state);
            }
        }

        const merged = Boolean(info.merged);
        return {
            owner,
            repo,
            number: info.number,
            title: info.title,
            url: info.html_url,
            state: merged ? 'merged' : info.state,
            draft: Boolean(info.draft),
            author: info.user ? info.user.login : '',
            base: info.base ? info.base.ref : '',
            head: info.head ? `${info.head.label || info.head.ref}` : '',
            body: String(info.body || '').slice(0, MAX_BODY_CHARS),
            created: info.created_at,
            updated: info.updated_at,
            additions: info.additions || 0,
            deletions: info.deletions || 0,
            changedFiles: info.changed_files || outFiles.length,
            commits: info.commits || 0,
            labels: Array.isArray(info.labels) ? info.labels.map((/** @type {any} */ l) => l.name) : [],
            reviewers: [...latest.entries()].map(([user, state]) => ({ user, state })),
            files: outFiles,
            filesTruncated: files.truncated,
            diffTruncated,
            comments: issueComments.map((/** @type {any} */ c) => ({
                author: c.user ? c.user.login : '',
                body: String(c.body || '').slice(0, MAX_BODY_CHARS),
                created: c.created_at
            })),
            reviewComments: reviewComments.map((/** @type {any} */ c) => ({
                author: c.user ? c.user.login : '',
                body: String(c.body || '').slice(0, MAX_BODY_CHARS),
                created: c.created_at,
                path: c.path,
                line: c.line || c.original_line || 0,
                side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT'
            }))
        };
    }

    /**
     * @param {any} item
     * @returns {any}
     */
    toPullRequest(item) {
        const repoFull = String(item.repository_url || '').split('/repos/')[1] || '';
        const [owner = '', repo = ''] = repoFull.split('/');
        const merged = Boolean(item.pull_request && item.pull_request.merged_at);
        return {
            number: item.number,
            title: item.title,
            url: item.html_url,
            state: merged ? 'merged' : item.state,
            draft: Boolean(item.draft),
            owner,
            repo,
            author: item.user ? item.user.login : '',
            comments: item.comments || 0,
            labels: Array.isArray(item.labels) ? item.labels.map((/** @type {any} */ l) => l.name) : [],
            created: item.created_at,
            updated: item.updated_at
        };
    }

    /**
     * @param {Response} response
     * @returns {Promise<string>}
     */
    async describeError(response) {
        let detail = '';
        try {
            const body = await response.json();
            detail = body && body.message ? String(body.message) : '';
        } catch (_e) {
            // ignore body parse failures
        }
        if (response.status === 401) {
            return 'Authentication failed (HTTP 401). Please verify your GitHub access token.';
        }
        if (response.status === 403 || response.status === 429) {
            return `Request refused (HTTP ${response.status}): ${detail || 'rate limit or permission issue'}. Set an access token to raise the rate limit.`;
        }
        if (response.status === 422) {
            return `GitHub rejected the query (HTTP 422): ${detail || 'validation failed'}.`;
        }
        return `HTTP ${response.status}: ${detail || response.statusText}`;
    }
}

module.exports = GithubService;
