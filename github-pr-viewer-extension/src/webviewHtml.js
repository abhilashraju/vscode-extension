// @ts-check
'use strict';

/**
 * Escape a value for safe embedding in HTML text/attributes
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Serialize a value as JSON that is safe inside an inline <script> block
 * @param {any} value
 * @returns {string}
 */
function safeJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/**
 * Generates the HTML for the GitHub PR Viewer Webview
 * @param {{
 *   nonce: string,
 *   cspSource: string,
 *   apiUrl: string,
 *   hasToken: boolean,
 *   defaults: { scope: string, owner: string, repo: string }
 * }} opts
 * @returns {string}
 */
function getWebviewContent(opts) {
    const { nonce, cspSource, apiUrl, hasToken, defaults } = opts;
    const scopes = [
        ['author', 'Created by me'],
        ['assignee', 'Assigned to me'],
        ['review-requested', 'Review requested from me'],
        ['involves', 'Involving me'],
        ['any', 'Anyone (needs owner/repo)']
    ];
    const scopeOptions = scopes
        .map(([v, label]) => `<option value="${v}"${v === defaults.scope ? ' selected' : ''}>${label}</option>`)
        .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GitHub Pull Requests</title>
    <style nonce="${nonce}">
        :root {
            --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
            --bg-color: var(--vscode-editor-background);
            --fg-color: var(--vscode-editor-foreground);
            --card-bg: var(--vscode-sideBar-background, #1e1e1e);
            --card-border: var(--vscode-widget-border, rgba(128, 128, 128, 0.25));
            --input-bg: var(--vscode-input-background, #2d2d2d);
            --input-fg: var(--vscode-input-foreground, #cccccc);
            --input-border: var(--vscode-input-border, #3c3c3c);
            --btn-bg: var(--vscode-button-background, #0e639c);
            --btn-fg: var(--vscode-button-foreground, #ffffff);
            --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
            --link-color: var(--vscode-textLink-foreground, #3794ff);
            --muted: var(--vscode-descriptionForeground, #888888);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--font-family);
            background-color: var(--bg-color);
            color: var(--fg-color);
            padding: 12px;
            font-size: 13px;
            line-height: 1.4;
        }
        .header-container {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 14px;
            position: sticky;
            top: 0;
            background-color: var(--bg-color);
            z-index: 100;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--card-border);
        }
        .auth-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
            background: rgba(128, 128, 128, 0.1);
            padding: 4px 8px;
            border-radius: 4px;
            border: 1px solid var(--card-border);
        }
        .auth-status { display: flex; align-items: center; gap: 6px; }
        .auth-dot { width: 8px; height: 8px; border-radius: 50%; background: ${hasToken ? '#3fb950' : '#8b949e'}; }
        .auth-btn {
            background: transparent;
            color: var(--link-color);
            border: 1px solid var(--card-border);
            padding: 2px 6px;
            font-size: 10px;
            border-radius: 3px;
        }
        .auth-btn:hover { background: var(--input-bg); }
        .row { display: flex; gap: 6px; flex-wrap: wrap; }
        input, select {
            flex: 1;
            min-width: 80px;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            border-radius: 4px;
            padding: 6px 10px;
            font-size: 12px;
            outline: none;
            font-family: inherit;
        }
        input:focus, select:focus { border-color: var(--btn-bg); }
        button {
            background: var(--btn-bg);
            color: var(--btn-fg);
            border: none;
            border-radius: 4px;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            font-family: inherit;
            white-space: nowrap;
        }
        button:hover { background: var(--btn-hover); }
        .chips-container { display: flex; gap: 6px; flex-wrap: wrap; }
        .chip {
            padding: 3px 8px;
            border-radius: 12px;
            background: var(--input-bg);
            border: 1px solid var(--input-border);
            font-size: 11px;
            cursor: pointer;
            user-select: none;
        }
        .chip.active { background: var(--btn-bg); color: var(--btn-fg); border-color: var(--btn-bg); }
        .chip-count { background: rgba(255, 255, 255, 0.2); padding: 1px 5px; border-radius: 8px; font-size: 10px; }
        .stats-bar { font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; }
        .pr-list { display: flex; flex-direction: column; gap: 8px; }
        .pr-card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 6px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .pr-card:hover { border-color: var(--btn-bg); }
        .card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
        .card-title {
            font-weight: 600;
            font-size: 13px;
            color: var(--link-color);
            cursor: pointer;
            word-break: break-word;
            flex: 1;
        }
        .card-title:hover { text-decoration: underline; }
        .status-badge { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }
        .status-open { background: rgba(46, 160, 67, 0.18); color: #3fb950; border: 1px solid rgba(63, 185, 80, 0.4); }
        .status-merged { background: rgba(163, 113, 247, 0.18); color: #a371f7; border: 1px solid rgba(163, 113, 247, 0.4); }
        .status-closed { background: rgba(248, 81, 73, 0.18); color: #f85149; border: 1px solid rgba(248, 81, 73, 0.4); }
        .status-draft { background: rgba(128, 128, 128, 0.18); color: #8b949e; border: 1px solid rgba(128, 128, 128, 0.4); }
        .meta-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; color: var(--muted); }
        .meta-tag { background: rgba(128, 128, 128, 0.15); padding: 2px 6px; border-radius: 3px; font-family: monospace; }
        .card-actions { display: flex; gap: 6px; margin-top: 4px; padding-top: 6px; border-top: 1px dashed var(--card-border); }
        .mini-btn {
            background: transparent;
            color: var(--muted);
            border: 1px solid var(--card-border);
            padding: 2px 8px;
            font-size: 11px;
            border-radius: 3px;
        }
        .mini-btn:hover { background: var(--input-bg); color: var(--fg-color); border-color: var(--btn-bg); }
        .empty-state { text-align: center; padding: 40px 20px; color: var(--muted); }
        .error { color: #f85149; }
    </style>
</head>
<body>
    <div class="header-container">
        <div class="auth-bar">
            <div class="auth-status">
                <div class="auth-dot"></div>
                <span>${hasToken ? 'Authenticated (token set)' : 'No access token'}</span>
            </div>
            <button class="auth-btn" id="authBtn">${hasToken ? 'Manage Token' : 'Set Token'}</button>
        </div>

        <div class="row">
            <input type="text" id="ownerInput" placeholder="Owner (user/org), e.g. openbmc" value="${escapeHtml(defaults.owner)}" autocomplete="off">
            <input type="text" id="repoInput" placeholder="Repo, e.g. bmcweb" value="${escapeHtml(defaults.repo)}" autocomplete="off">
        </div>
        <div class="row">
            <select id="scopeSelect">${scopeOptions}</select>
            <button id="fetchBtn">Fetch</button>
        </div>

        <div class="chips-container">
            <div class="chip active" data-state="all">All <span class="chip-count" id="countAll">0</span></div>
            <div class="chip" data-state="open">Open <span class="chip-count" id="countOpen">0</span></div>
            <div class="chip" data-state="merged">Merged <span class="chip-count" id="countMerged">0</span></div>
            <div class="chip" data-state="closed">Closed <span class="chip-count" id="countClosed">0</span></div>
        </div>

        <div class="row">
            <input type="text" id="searchInput" placeholder="Live filter by title, number, owner, repo, or author...">
        </div>
        <div class="row">
            <select id="ownerFilter"><option value="">All Owners</option></select>
            <select id="repoFilter"><option value="">All Repos</option></select>
            <select id="sortSelect">
                <option value="updated">Sort: Recently Updated</option>
                <option value="created">Sort: Created Date</option>
                <option value="number">Sort: PR #</option>
            </select>
        </div>

        <div class="stats-bar">
            <span id="resultsStats">Ready</span>
            <span id="hostLabel"></span>
        </div>
    </div>

    <div class="pr-list" id="prContainer">
        <div class="empty-state">Click 'Fetch' to load pull requests.</div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const config = ${safeJson({ apiUrl })};

        let allPrs = [];
        let currentState = 'all';
        let currentSearch = '';
        let currentOwner = '';
        let currentRepo = '';

        const ownerInput = document.getElementById('ownerInput');
        const repoInput = document.getElementById('repoInput');
        const scopeSelect = document.getElementById('scopeSelect');
        const fetchBtn = document.getElementById('fetchBtn');
        const authBtn = document.getElementById('authBtn');
        const searchInput = document.getElementById('searchInput');
        const ownerFilter = document.getElementById('ownerFilter');
        const repoFilter = document.getElementById('repoFilter');
        const sortSelect = document.getElementById('sortSelect');
        const container = document.getElementById('prContainer');
        const resultsStats = document.getElementById('resultsStats');

        document.getElementById('hostLabel').textContent = config.apiUrl;

        authBtn.addEventListener('click', () => vscode.postMessage({ command: 'promptAuth' }));
        fetchBtn.addEventListener('click', triggerFetch);
        [ownerInput, repoInput].forEach(el => el.addEventListener('keydown', e => {
            if (e.key === 'Enter') { triggerFetch(); }
        }));
        scopeSelect.addEventListener('change', triggerFetch);

        searchInput.addEventListener('input', e => {
            currentSearch = e.target.value.trim().toLowerCase();
            renderPrs();
        });
        ownerFilter.addEventListener('change', e => {
            currentOwner = e.target.value;
            updateRepoDropdown();
            renderPrs();
        });
        repoFilter.addEventListener('change', e => {
            currentRepo = e.target.value;
            renderPrs();
        });
        sortSelect.addEventListener('change', renderPrs);

        document.querySelectorAll('.chip[data-state]').forEach(chip => {
            chip.addEventListener('click', () => {
                document.querySelectorAll('.chip[data-state]').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                currentState = chip.getAttribute('data-state');
                renderPrs();
            });
        });

        function triggerFetch() {
            resultsStats.textContent = 'Fetching from GitHub...';
            container.innerHTML = '<div class="empty-state">Loading pull requests...</div>';
            vscode.postMessage({
                command: 'fetchPullRequests',
                filters: {
                    owner: ownerInput.value.trim(),
                    repo: repoInput.value.trim(),
                    scope: scopeSelect.value
                }
            });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'prsLoaded') {
                allPrs = message.prs || [];
                currentOwner = '';
                currentRepo = '';
                updateOwnerDropdown();
                updateRepoDropdown();
                updateCounters();
                renderPrs();
            } else if (message.type === 'error') {
                container.innerHTML = '';
                const div = document.createElement('div');
                div.className = 'empty-state error';
                div.textContent = 'Error: ' + message.error;
                container.appendChild(div);
                resultsStats.textContent = 'Fetch failed';
            }
        });

        function countBy(list, key) {
            const counts = {};
            list.forEach(p => { counts[p[key]] = (counts[p[key]] || 0) + 1; });
            return counts;
        }

        function fillSelect(select, label, counts, selected) {
            const names = Object.keys(counts).sort();
            select.innerHTML = '';
            const first = document.createElement('option');
            first.value = '';
            first.textContent = label + ' (' + names.length + ')';
            select.appendChild(first);
            names.forEach(name => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name + ' (' + counts[name] + ')';
                select.appendChild(opt);
            });
            select.value = selected;
        }

        function updateOwnerDropdown() {
            fillSelect(ownerFilter, 'All Owners', countBy(allPrs, 'owner'), currentOwner);
        }

        function updateRepoDropdown() {
            const scoped = currentOwner ? allPrs.filter(p => p.owner === currentOwner) : allPrs;
            currentRepo = '';
            fillSelect(repoFilter, 'All Repos', countBy(scoped, 'repo'), '');
        }

        function updateCounters() {
            const count = s => allPrs.filter(p => p.state === s).length;
            document.getElementById('countAll').textContent = allPrs.length;
            document.getElementById('countOpen').textContent = count('open');
            document.getElementById('countMerged').textContent = count('merged');
            document.getElementById('countClosed').textContent = count('closed');
        }

        function renderPrs() {
            const filtered = allPrs.filter(p => {
                if (currentState !== 'all' && p.state !== currentState) { return false; }
                if (currentOwner && p.owner !== currentOwner) { return false; }
                if (currentRepo && p.repo !== currentRepo) { return false; }
                if (currentSearch) {
                    const hay = [p.title, String(p.number), p.owner, p.repo, p.author].join(' ').toLowerCase();
                    if (!hay.includes(currentSearch)) { return false; }
                }
                return true;
            });

            const sortBy = sortSelect.value;
            filtered.sort((a, b) => {
                if (sortBy === 'created') { return new Date(b.created) - new Date(a.created); }
                if (sortBy === 'number') { return b.number - a.number; }
                return new Date(b.updated) - new Date(a.updated);
            });

            resultsStats.textContent = 'Showing ' + filtered.length + ' of ' + allPrs.length + ' pull requests';
            container.innerHTML = '';
            if (filtered.length === 0) {
                const div = document.createElement('div');
                div.className = 'empty-state';
                div.textContent = 'No pull requests match the current filters.';
                container.appendChild(div);
                return;
            }
            filtered.forEach(pr => container.appendChild(createCard(pr)));
        }

        function el(tag, className, text) {
            const node = document.createElement(tag);
            if (className) { node.className = className; }
            if (text !== undefined) { node.textContent = text; }
            return node;
        }

        function createCard(pr) {
            const card = el('div', 'pr-card');

            const top = el('div', 'card-top');
            const title = el('a', 'card-title', '#' + pr.number + ': ' + pr.title);
            const openDetail = () => vscode.postMessage({
                command: 'openDetail', owner: pr.owner, repo: pr.repo, number: pr.number
            });
            title.addEventListener('click', e => {
                e.preventDefault();
                openDetail();
            });
            const statusKey = pr.draft && pr.state === 'open' ? 'draft' : pr.state;
            top.appendChild(title);
            top.appendChild(el('span', 'status-badge status-' + statusKey, statusKey));
            card.appendChild(top);

            const meta = el('div', 'meta-row');
            meta.appendChild(el('span', 'meta-tag', pr.owner + '/' + pr.repo));
            meta.appendChild(el('span', 'meta-tag', '@' + pr.author));
            if (pr.comments) { meta.appendChild(el('span', 'meta-tag', pr.comments + ' comments')); }
            pr.labels.forEach(l => meta.appendChild(el('span', 'meta-tag', l)));
            const updated = el('span', '', pr.updated ? new Date(pr.updated).toLocaleDateString() : '');
            updated.style.marginLeft = 'auto';
            meta.appendChild(updated);
            card.appendChild(meta);

            const actions = el('div', 'card-actions');
            const openBtn = el('button', 'mini-btn', 'Open');
            openBtn.addEventListener('click', openDetail);
            const webBtn = el('button', 'mini-btn', 'GitHub');
            webBtn.addEventListener('click', () => vscode.postMessage({ command: 'openUrl', url: pr.url }));
            const copyBtn = el('button', 'mini-btn', 'Copy Link');
            copyBtn.addEventListener('click', () => vscode.postMessage({
                command: 'copyClipboard', text: pr.url, message: 'Pull request link copied to clipboard!'
            }));
            const checkoutBtn = el('button', 'mini-btn', 'Copy Checkout');
            checkoutBtn.addEventListener('click', () => vscode.postMessage({
                command: 'copyClipboard',
                text: 'gh pr checkout ' + pr.number + ' --repo ' + pr.owner + '/' + pr.repo,
                message: 'Checkout command copied to clipboard!'
            }));
            actions.appendChild(openBtn);
            actions.appendChild(webBtn);
            actions.appendChild(copyBtn);
            actions.appendChild(checkoutBtn);
            card.appendChild(actions);

            return card;
        }

        triggerFetch();
    </script>
</body>
</html>`;
}

module.exports = { getWebviewContent };
