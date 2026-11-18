// @ts-check
'use strict';

const { parseDiff } = require('./gerritDiff');

const REQUEST_TIMEOUT_MS = 30000;
const MAX_FILES = 500;
const MAX_MESSAGES = 500;
const MAX_TEXT_CHARS = 100000;
const MAX_ROWS_PER_FILE = 3000;
const REVISION_RE = /^[0-9a-f]{40}$/;

/**
 * Gerrit timestamps are UTC like "2026-11-13 17:11:17.000000000"
 * @param {string | undefined} s
 * @returns {string}
 */
function toIso(s) {
    return s ? `${String(s).slice(0, 19).replace(' ', 'T')}Z` : '';
}

/**
 * @param {any} account
 * @returns {string}
 */
function accountName(account) {
    return account ? String(account.name || account.username || account.email || 'unknown') : 'Gerrit';
}

/**
 * Service to interact with Gerrit REST API with optional Basic Auth
 */
class GerritService {
    /**
     * @param {string} host
     * @param {string} [username]
     * @param {string} [token]
     */
    constructor(host = 'https://gerrit.openbmc.org', username = '', token = '') {
        this.host = host.replace(/\/+$/, '');
        this.username = username;
        this.token = token;
    }

    /**
     * Update base host URL
     * @param {string} host
     */
    setHost(host) {
        this.host = host.replace(/\/+$/, '');
    }

    /**
     * Update authentication credentials
     * @param {string} username
     * @param {string} token
     */
    setCredentials(username, token) {
        this.username = username;
        this.token = token;
    }

    /**
     * Whether credentials are set
     * @returns {boolean}
     */
    hasCredentials() {
        return Boolean(this.username && this.token);
    }

    /**
     * @returns {string} API root, with the /a/ prefix when authenticated
     */
    apiRoot() {
        return this.hasCredentials() ? `${this.host}/a` : this.host;
    }

    /**
     * @returns {Record<string, string>}
     */
    requestHeaders() {
        /** @type {Record<string, string>} */
        const headers = { 'Accept': 'application/json' };
        if (this.hasCredentials()) {
            headers['Authorization'] = `Basic ${Buffer.from(`${this.username}:${this.token}`).toString('base64')}`;
        }
        return headers;
    }

    /**
     * GET a JSON resource (strips Gerrit's XSSI prefix)
     * @param {string} apiPath path starting with "/", already URL-safe
     * @returns {Promise<any>}
     */
    async getJson(apiPath) {
        const response = await fetch(`${this.apiRoot()}${apiPath}`, {
            headers: this.requestHeaders(),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new Error(`Authentication failed (HTTP ${response.status}). Please verify your Gerrit username and HTTP password/token.`);
            }
            if (response.status === 404) {
                throw new Error('Not found (HTTP 404). The change may not exist or may need authentication.');
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const text = (await response.text()).replace(/^\)\]\}'\s*/, '');
        return JSON.parse(text);
    }

    /**
     * Fetch everything needed for the in-IDE change page (diffs are loaded per file later)
     * @param {number} number
     * @returns {Promise<any>}
     */
    async fetchChangeDetail(number) {
        if (!Number.isInteger(number) || number < 1) {
            throw new Error('Invalid change number.');
        }
        const base = `/changes/${number}`;
        const [change, files, comments] = await Promise.all([
            this.getJson(`${base}/detail?o=CURRENT_REVISION&o=CURRENT_COMMIT&o=MESSAGES&o=DETAILED_LABELS&o=DETAILED_ACCOUNTS`),
            this.getJson(`${base}/revisions/current/files`),
            this.getJson(`${base}/comments`)
        ]);
        return this.toDetail(change, files, comments);
    }

    /**
     * @param {any} change
     * @param {any} files
     * @param {any} comments
     * @returns {any}
     */
    toDetail(change, files, comments) {
        const revisionId = String(change.current_revision || '');
        const revision = (change.revisions && change.revisions[revisionId]) || {};
        const patchSet = revision._number || change.current_revision_number || 0;

        // Comments per path, with thread state: a thread is open only if its last comment is unresolved
        /** @type {Record<string, Array<any>>} */
        const byPath = {};
        for (const [path, list] of Object.entries(comments || {})) {
            const arr = Array.isArray(list) ? list : [];
            const replied = new Set(arr.map((/** @type {any} */ c) => c.in_reply_to).filter(Boolean));
            byPath[path] = arr
                .map((/** @type {any} */ c) => ({
                    author: accountName(c.author),
                    body: String(c.message || '').slice(0, MAX_TEXT_CHARS),
                    created: toIso(c.updated),
                    patchSet: c.patch_set || 0,
                    line: c.line || 0,
                    side: c.side === 'PARENT' ? 'LEFT' : 'RIGHT',
                    reply: Boolean(c.in_reply_to),
                    unresolved: Boolean(c.unresolved) && !replied.has(c.id)
                }))
                .sort((x, y) => x.created.localeCompare(y.created));
        }

        const statusNames = { A: 'added', D: 'deleted', R: 'renamed', C: 'copied', W: 'rewritten' };
        const fileEntries = Object.entries(files || {}).filter(([p]) => p !== '/MERGE_LIST');
        const outFiles = fileEntries.slice(0, MAX_FILES).map(([path, f]) => {
            const info = /** @type {any} */ (f);
            return {
                path,
                label: path === '/COMMIT_MSG' ? 'Commit message' : path,
                old: info.old_path || '',
                status: /** @type {Record<string, string>} */ (statusNames)[info.status] || 'modified',
                ins: info.lines_inserted || 0,
                del: info.lines_deleted || 0,
                binary: Boolean(info.binary),
                comments: byPath[path] || []
            };
        });

        /** @type {Array<{label: string, user: string, value: number}>} */
        const votes = [];
        for (const [label, data] of Object.entries(change.labels || {})) {
            const all = (data && /** @type {any} */ (data).all) || [];
            for (const v of all) {
                if (v && v.value) {
                    votes.push({ label, user: accountName(v), value: v.value });
                }
            }
        }

        const owner = accountName(change.owner);
        return {
            number: change._number,
            project: change.project,
            branch: change.branch,
            subject: change.subject,
            status: change.status,
            topic: change.topic || '',
            url: `${this.host}/c/${change.project}/+/${change._number}`,
            owner,
            created: toIso(change.created),
            updated: toIso(change.updated),
            insertions: change.insertions || 0,
            deletions: change.deletions || 0,
            unresolved: change.unresolved_comment_count || 0,
            patchSet,
            revision: REVISION_RE.test(revisionId) ? revisionId : '',
            message: String((revision.commit && revision.commit.message) || '').slice(0, MAX_TEXT_CHARS),
            votes,
            files: outFiles,
            filesTruncated: fileEntries.length > MAX_FILES,
            patchsetComments: byPath['/PATCHSET_LEVEL'] || [],
            messages: (Array.isArray(change.messages) ? change.messages : []).slice(-MAX_MESSAGES).map((/** @type {any} */ m) => ({
                author: accountName(m.author),
                body: String(m.message || '').slice(0, MAX_TEXT_CHARS),
                created: toIso(m.date),
                patchSet: m._revision_number || 0,
                auto: typeof m.tag === 'string' && m.tag.startsWith('autogenerated')
            }))
        };
    }

    /**
     * Fetch and parse the diff of one file in a revision
     * @param {number} number
     * @param {string} revision 40-char commit id from fetchChangeDetail
     * @param {string} path
     * @returns {Promise<{rows: Array<any> | null, truncated: boolean, binary: boolean}>}
     */
    async fetchFileDiff(number, revision, path) {
        if (!Number.isInteger(number) || number < 1 || !REVISION_RE.test(revision)
            || typeof path !== 'string' || path.length === 0 || path.length > 4096) {
            throw new Error('Invalid diff request.');
        }
        const data = await this.getJson(
            `/changes/${number}/revisions/${revision}/files/${encodeURIComponent(path)}/diff?context=3`);
        if (data && data.binary) {
            return { rows: null, truncated: false, binary: true };
        }
        const parsed = parseDiff(data && data.content, MAX_ROWS_PER_FILE);
        return { rows: parsed.rows, truncated: parsed.truncated, binary: false };
    }

    /**
     * Fetch changes matching a query
     * @param {string} query
     * @param {number} limit
     * @returns {Promise<Array<any>>}
     */
    async fetchChanges(query = 'owner:self', limit = 100) {
        const encodedQuery = encodeURIComponent(query);
        const isAuth = this.hasCredentials();
        // If authenticated, Gerrit requires the '/a/' prefix in endpoint paths
        const basePath = isAuth ? `${this.host}/a/changes/` : `${this.host}/changes/`;
        const url = `${basePath}?q=${encodedQuery}&n=${limit}&o=LABELS&o=CURRENT_REVISION&o=DETAILED_ACCOUNTS`;

        /** @type {Record<string, string>} */
        const headers = {
            'Accept': 'application/json'
        };

        if (isAuth) {
            const authStr = `${this.username}:${this.token}`;
            const basicAuth = Buffer.from(authStr).toString('base64');
            headers['Authorization'] = `Basic ${basicAuth}`;
        }

        try {
            const response = await fetch(url, { headers });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error(`Authentication failed (HTTP ${response.status}). Please verify your Gerrit username and HTTP password/token.`);
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const rawText = await response.text();
            // Gerrit prepends )]}' to JSON responses to prevent XSSI attacks
            const cleanJsonText = rawText.replace(/^\)\]\}'\s*/, '');
            const data = JSON.parse(cleanJsonText);
            return Array.isArray(data) ? data : [];
        } catch (err) {
            console.error('[GerritService] Fetch error:', err);
            throw err;
        }
    }
}

module.exports = GerritService;
