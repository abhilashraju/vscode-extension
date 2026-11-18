// @ts-check
'use strict';

/**
 * Generates the HTML for the Gerrit Viewer Webview
 * @param {string} gerritHost
 * @param {string} defaultQuery
 * @param {boolean} isAuthenticated
 * @param {string} [username]
 * @returns {string}
 */
function getWebviewContent(gerritHost, defaultQuery, isAuthenticated = false, username = '') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gerrit Review Viewer</title>
    <style>
        :root {
            --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
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
            --badge-bg: var(--vscode-badge-background, #4d4d4d);
            --badge-fg: var(--vscode-badge-foreground, #ffffff);
            --link-color: var(--vscode-textLink-foreground, #3794ff);
            --tag-open-bg: rgba(46, 160, 67, 0.18);
            --tag-open-fg: #3fb950;
            --tag-merged-bg: rgba(163, 113, 247, 0.18);
            --tag-merged-fg: #a371f7;
            --tag-abandoned-bg: rgba(248, 81, 73, 0.18);
            --tag-abandoned-fg: #f85149;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

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

        .auth-status {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .auth-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: ${isAuthenticated ? '#3fb950' : '#8b949e'};
        }

        .auth-btn {
            background: transparent;
            color: var(--link-color);
            border: 1px solid var(--card-border);
            padding: 2px 6px;
            font-size: 10px;
            border-radius: 3px;
            cursor: pointer;
        }

        .auth-btn:hover {
            background: var(--input-bg);
        }

        .query-bar {
            display: flex;
            gap: 6px;
        }

        .query-bar input, .search-bar input, select {
            flex: 1;
            background: var(--input-bg);
            color: var(--input-fg);
            border: 1px solid var(--input-border);
            border-radius: 4px;
            padding: 6px 10px;
            font-size: 12px;
            outline: none;
            font-family: inherit;
        }

        .query-bar input:focus, .search-bar input:focus, select:focus {
            border-color: var(--btn-bg);
        }

        button {
            background: var(--btn-bg);
            color: var(--btn-fg);
            border: none;
            border-radius: 4px;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            font-family: inherit;
            white-space: nowrap;
        }

        button:hover {
            background: var(--btn-hover);
        }

        .filter-row {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }

        .chips-container {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            margin-top: 4px;
        }

        .chip {
            padding: 3px 8px;
            border-radius: 12px;
            background: var(--input-bg);
            border: 1px solid var(--input-border);
            font-size: 11px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            user-select: none;
            transition: all 0.15s ease;
        }

        .chip.active {
            background: var(--btn-bg);
            color: var(--btn-fg);
            border-color: var(--btn-bg);
        }

        .chip-count {
            background: rgba(255, 255, 255, 0.2);
            padding: 1px 5px;
            border-radius: 8px;
            font-size: 10px;
        }

        .stats-bar {
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #888888);
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 2px;
        }

        .changes-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .change-card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 6px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 6px;
            transition: transform 0.1s ease, border-color 0.15s ease;
        }

        .change-card:hover {
            border-color: var(--btn-bg);
        }

        .card-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
        }

        .card-title {
            font-weight: 600;
            font-size: 13px;
            color: var(--link-color);
            text-decoration: none;
            cursor: pointer;
            word-break: break-word;
            flex: 1;
        }

        .card-title:hover {
            text-decoration: underline;
        }

        .status-badge {
            font-size: 10px;
            font-weight: 700;
            padding: 2px 6px;
            border-radius: 4px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .status-NEW {
            background: var(--tag-open-bg);
            color: var(--tag-open-fg);
            border: 1px solid rgba(63, 185, 80, 0.4);
        }

        .status-MERGED {
            background: var(--tag-merged-bg);
            color: var(--tag-merged-fg);
            border: 1px solid rgba(163, 113, 247, 0.4);
        }

        .status-ABANDONED {
            background: var(--tag-abandoned-bg);
            color: var(--tag-abandoned-fg);
            border: 1px solid rgba(248, 81, 73, 0.4);
        }

        .meta-row {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            align-items: center;
            font-size: 11px;
            color: var(--vscode-descriptionForeground, #999999);
        }

        .meta-tag {
            background: rgba(128, 128, 128, 0.15);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
        }

        .scores-row {
            display: flex;
            gap: 6px;
            font-size: 11px;
            align-items: center;
        }

        .score-pill {
            padding: 1px 6px;
            border-radius: 3px;
            font-weight: bold;
            font-size: 10px;
        }

        .score-cr-pos { background: rgba(46, 160, 67, 0.25); color: #3fb950; }
        .score-cr-neg { background: rgba(248, 81, 73, 0.25); color: #f85149; }
        .score-v-pos { background: rgba(56, 139, 253, 0.25); color: #58a6ff; }
        .score-v-neg { background: rgba(248, 81, 73, 0.25); color: #f85149; }

        .card-actions {
            display: flex;
            gap: 6px;
            margin-top: 4px;
            padding-top: 6px;
            border-top: 1px dashed var(--card-border);
        }

        .mini-btn {
            background: transparent;
            color: var(--vscode-descriptionForeground, #888888);
            border: 1px solid var(--card-border);
            padding: 2px 8px;
            font-size: 11px;
            border-radius: 3px;
            cursor: pointer;
        }

        .mini-btn:hover {
            background: var(--input-bg);
            color: var(--fg-color);
            border-color: var(--btn-bg);
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground, #888888);
        }

        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: var(--btn-fg);
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="header-container">
        <!-- Auth status bar -->
        <div class="auth-bar">
            <div class="auth-status">
                <div class="auth-dot"></div>
                <span>${isAuthenticated ? 'Authenticated: <b>' + (username || 'user') + '</b>' : 'Anonymous Mode'}</span>
            </div>
            <div>
                <button class="auth-btn" id="authBtn">${isAuthenticated ? '🔑 Manage Auth' : '🔓 Set Credentials'}</button>
            </div>
        </div>

        <!-- Gerrit Query Bar -->
        <div class="query-bar">
            <input type="text" id="gerritQueryInput" placeholder="Gerrit Query (e.g. owner:self, status:open)" value="${defaultQuery}">
            <button id="fetchBtn">
                <span id="btnIcon">🔍</span> Fetch
            </button>
        </div>

        <!-- Query Presets -->
        <div class="chips-container">
            <div class="chip preset-chip" data-query="owner:self">My Changes</div>
            <div class="chip preset-chip" data-query="reviewer:self -owner:self">Added Me as Reviewer</div>
            <div class="chip preset-chip" data-query="reviewer:self -owner:self status:open">Reviewer (Open)</div>
        </div>

        <!-- Real-Time Client Search Filter -->
        <div class="search-bar">
            <input type="text" id="searchInput" placeholder="⚡ Live Filter by subject, change #, repo, branch, or author...">
        </div>

        <!-- Filter and Sort Controls -->
        <div class="filter-row">
            <select id="projectFilter">
                <option value="">All Projects</option>
            </select>
            <select id="sortSelect">
                <option value="updated">Sort: Recently Updated</option>
                <option value="created">Sort: Created Date</option>
                <option value="number">Sort: Change #</option>
            </select>
        </div>

        <!-- Status Filter Chips -->
        <div class="chips-container">
            <div class="chip active" data-status="ALL">All <span class="chip-count" id="countAll">0</span></div>
            <div class="chip" data-status="NEW">Open <span class="chip-count" id="countOpen">0</span></div>
            <div class="chip" data-status="MERGED">Merged <span class="chip-count" id="countMerged">0</span></div>
            <div class="chip" data-status="ABANDONED">Abandoned <span class="chip-count" id="countAbandoned">0</span></div>
        </div>

        <!-- Status Summary Bar -->
        <div class="stats-bar">
            <span id="resultsStats">Ready</span>
            <span id="hostLabel">${gerritHost}</span>
        </div>
    </div>

    <!-- Changes List Container -->
    <div class="changes-list" id="changesContainer">
        <div class="empty-state">Click 'Fetch' or press Enter to load changes.</div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const gerritHost = "${gerritHost}";

        let allChanges = [];
        let currentStatusFilter = 'ALL';
        let currentProjectFilter = '';
        let currentSearchQuery = '';

        const gerritQueryInput = document.getElementById('gerritQueryInput');
        const fetchBtn = document.getElementById('fetchBtn');
        const authBtn = document.getElementById('authBtn');
        const searchInput = document.getElementById('searchInput');
        const projectFilter = document.getElementById('projectFilter');
        const sortSelect = document.getElementById('sortSelect');
        const changesContainer = document.getElementById('changesContainer');
        const resultsStats = document.getElementById('resultsStats');

        authBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'promptAuth' });
        });

        // Fetch button click
        fetchBtn.addEventListener('click', () => {
            triggerFetch();
        });

        gerritQueryInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                triggerFetch();
            }
        });

        // Search bar real-time filter
        searchInput.addEventListener('input', (e) => {
            currentSearchQuery = e.target.value.trim().toLowerCase();
            renderChanges();
        });

        // Project filter change
        projectFilter.addEventListener('change', (e) => {
            currentProjectFilter = e.target.value;
            renderChanges();
        });

        // Sort change
        sortSelect.addEventListener('change', () => {
            renderChanges();
        });

        // Query presets
        document.querySelectorAll('.preset-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                gerritQueryInput.value = chip.getAttribute('data-query');
                triggerFetch();
            });
        });

        // Status chips
        document.querySelectorAll('.chips-container .chip[data-status]').forEach(chip => {
            chip.addEventListener('click', () => {
                document.querySelectorAll('.chip[data-status]').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                currentStatusFilter = chip.getAttribute('data-status');
                renderChanges();
            });
        });

        function triggerFetch() {
            const query = gerritQueryInput.value.trim() || 'owner:self';
            resultsStats.textContent = 'Fetching from Gerrit...';
            changesContainer.innerHTML = '<div class="empty-state"><div class="spinner"></div><p style="margin-top:10px;">Loading changes...</p></div>';
            vscode.postMessage({ command: 'fetchChanges', query: query });
        }

        // Listen for messages from the Extension Host
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'changesLoaded':
                    allChanges = message.changes || [];
                    updateProjectsDropdown(allChanges);
                    updateCounters(allChanges);
                    renderChanges();
                    break;
                case 'error':
                    changesContainer.innerHTML = '<div class="empty-state" style="color:var(--tag-abandoned-fg)">⚠️ Error: ' + escapeHtml(message.error) + '</div>';
                    resultsStats.textContent = 'Fetch failed';
                    break;
            }
        });

        function updateCounters(changes) {
            const total = changes.length;
            const open = changes.filter(c => c.status === 'NEW').length;
            const merged = changes.filter(c => c.status === 'MERGED').length;
            const abandoned = changes.filter(c => c.status === 'ABANDONED').length;

            document.getElementById('countAll').textContent = total;
            document.getElementById('countOpen').textContent = open;
            document.getElementById('countMerged').textContent = merged;
            document.getElementById('countAbandoned').textContent = abandoned;
        }

        function updateProjectsDropdown(changes) {
            const projectCounts = {};
            changes.forEach(c => {
                if (c.project) {
                    projectCounts[c.project] = (projectCounts[c.project] || 0) + 1;
                }
            });

            projectFilter.innerHTML = '<option value="">All Projects (' + Object.keys(projectCounts).length + ')</option>';
            Object.keys(projectCounts).sort().forEach(proj => {
                const opt = document.createElement('option');
                opt.value = proj;
                opt.textContent = proj + ' (' + projectCounts[proj] + ')';
                projectFilter.appendChild(opt);
            });
        }

        function renderChanges() {
            let filtered = allChanges.filter(c => {
                // Status Filter
                if (currentStatusFilter !== 'ALL' && c.status !== currentStatusFilter) {
                    return false;
                }

                // Project Filter
                if (currentProjectFilter && c.project !== currentProjectFilter) {
                    return false;
                }

                // Text Search Query
                if (currentSearchQuery) {
                    const matchSubject = (c.subject || '').toLowerCase().includes(currentSearchQuery);
                    const matchNumber = String(c._number || '').includes(currentSearchQuery);
                    const matchProject = (c.project || '').toLowerCase().includes(currentSearchQuery);
                    const matchBranch = (c.branch || '').toLowerCase().includes(currentSearchQuery);
                    const matchOwner = (c.owner && (c.owner.name || c.owner.username || c.owner.email) || '').toLowerCase().includes(currentSearchQuery);
                    if (!matchSubject && !matchNumber && !matchProject && !matchBranch && !matchOwner) {
                        return false;
                    }
                }

                return true;
            });

            // Sorting
            const sortBy = sortSelect.value;
            filtered.sort((a, b) => {
                if (sortBy === 'updated') {
                    return new Date(b.updated).getTime() - new Date(a.updated).getTime();
                } else if (sortBy === 'created') {
                    return new Date(b.created).getTime() - new Date(a.created).getTime();
                } else if (sortBy === 'number') {
                    return b._number - a._number;
                }
                return 0;
            });

            resultsStats.textContent = 'Showing ' + filtered.length + ' of ' + allChanges.length + ' changes';

            if (filtered.length === 0) {
                changesContainer.innerHTML = '<div class="empty-state">No changes match the current filters.</div>';
                return;
            }

            changesContainer.innerHTML = '';
            filtered.forEach(change => {
                const card = createChangeCard(change);
                changesContainer.appendChild(card);
            });
        }

        function createChangeCard(change) {
            const card = document.createElement('div');
            card.className = 'change-card';

            const changeUrl = gerritHost + '/c/' + change.project + '/+/' + change._number;
            const updatedDate = change.updated ? new Date(change.updated).toLocaleDateString() : '';

            // Extract review labels
            let codeReviewScore = 0;
            let verifiedScore = 0;

            if (change.labels) {
                if (change.labels['Code-Review'] && change.labels['Code-Review'].all) {
                    for (const vote of change.labels['Code-Review'].all) {
                        if (vote.value && Math.abs(vote.value) > Math.abs(codeReviewScore)) {
                            codeReviewScore = vote.value;
                        }
                    }
                }
                if (change.labels['Verified'] && change.labels['Verified'].all) {
                    for (const vote of change.labels['Verified'].all) {
                        if (vote.value && Math.abs(vote.value) > Math.abs(verifiedScore)) {
                            verifiedScore = vote.value;
                        }
                    }
                }
            }

            let scoresHtml = '';
            if (codeReviewScore !== 0) {
                const sign = codeReviewScore > 0 ? '+' : '';
                const cls = codeReviewScore > 0 ? 'score-cr-pos' : 'score-cr-neg';
                scoresHtml += '<span class="score-pill ' + cls + '">CR ' + sign + codeReviewScore + '</span>';
            }
            if (verifiedScore !== 0) {
                const sign = verifiedScore > 0 ? '+' : '';
                const cls = verifiedScore > 0 ? 'score-v-pos' : 'score-v-neg';
                scoresHtml += '<span class="score-pill ' + cls + '">V ' + sign + verifiedScore + '</span>';
            }

            const statusClass = 'status-' + (change.status || 'NEW');

            card.innerHTML = \`
                <div class="card-top">
                    <a class="card-title" data-url="\${changeUrl}">#\${change._number}: \${escapeHtml(change.subject || '')}</a>
                    <span class="status-badge \${statusClass}">\${change.status === 'NEW' ? 'OPEN' : change.status}</span>
                </div>
                <div class="meta-row">
                    <span class="meta-tag">\${escapeHtml(change.project || '')}</span>
                    <span class="meta-tag">\${escapeHtml(change.branch || 'master')}</span>
                    <span class="meta-tag">👤 \${escapeHtml((change.owner && (change.owner.name || change.owner.username || change.owner.email)) || 'unknown')}</span>
                    \${scoresHtml}
                    <span style="margin-left:auto;">🕒 \${updatedDate}</span>
                </div>
                <div class="card-actions">
                    <button class="mini-btn open-detail" data-num="\${change._number}">📄 Open</button>
                    <button class="mini-btn open-url" data-url="\${changeUrl}">🔗 Open in Gerrit</button>
                    <button class="mini-btn copy-url" data-url="\${changeUrl}">📋 Copy Link</button>
                    <button class="mini-btn copy-checkout" data-num="\${change._number}" data-proj="\${change.project}">⚡ Copy Checkout</button>
                </div>
            \`;

            // Action listeners
            card.querySelector('.card-title').addEventListener('click', (e) => {
                e.preventDefault();
                vscode.postMessage({ command: 'openDetail', number: change._number });
            });

            card.querySelector('.open-detail').addEventListener('click', () => {
                vscode.postMessage({ command: 'openDetail', number: change._number });
            });

            card.querySelector('.open-url').addEventListener('click', () => {
                vscode.postMessage({ command: 'openUrl', url: changeUrl });
            });

            card.querySelector('.copy-url').addEventListener('click', () => {
                vscode.postMessage({ command: 'copyClipboard', text: changeUrl, message: 'Gerrit link copied to clipboard!' });
            });

            card.querySelector('.copy-checkout').addEventListener('click', () => {
                const fetchCmd = 'git fetch ' + gerritHost + '/' + change.project + ' refs/changes/' + String(change._number).slice(-2) + '/' + change._number + ' && git checkout FETCH_HEAD';
                vscode.postMessage({ command: 'copyClipboard', text: fetchCmd, message: 'Git checkout command copied to clipboard!' });
            });

            return card;
        }

        function escapeHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // Auto-fetch initial changes on load
        triggerFetch();
    </script>
</body>
</html>`;
}

module.exports = { getWebviewContent };
