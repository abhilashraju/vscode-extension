// @ts-check
'use strict';

/**
 * HTML for the Box sidebar webview. All dynamic text is inserted with textContent.
 * @param {{nonce: string, cspSource: string}} opts
 * @returns {string}
 */
function getWebviewContent({ nonce, cspSource }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Box Files</title>
    <style nonce="${nonce}">
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            background: var(--vscode-sideBar-background);
            font-size: 13px;
            padding: 10px;
        }
        .row { display: flex; gap: 6px; margin-bottom: 8px; }
        input[type=text] {
            flex: 1; min-width: 0; padding: 4px 6px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
        }
        button {
            padding: 4px 8px; cursor: pointer;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button.link {
            background: none; color: var(--vscode-textLink-foreground); padding: 0 2px;
        }
        .crumbs { margin-bottom: 8px; line-height: 1.6; word-break: break-word; }
        .sep { opacity: 0.6; margin: 0 2px; }
        .notice { padding: 8px 0; opacity: 0.85; }
        .error { color: var(--vscode-errorForeground); padding: 8px 0; }
        .item {
            display: flex; align-items: center; gap: 6px; padding: 4px 2px;
            border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
        }
        .item .name { flex: 1; min-width: 0; cursor: pointer; overflow-wrap: anywhere; }
        .item .name:hover { color: var(--vscode-textLink-foreground); }
        .item .meta { font-size: 11px; opacity: 0.7; white-space: nowrap; }
        .kind { width: 14px; text-align: center; opacity: 0.8; }
        .hidden { display: none; }
    </style>
</head>
<body>
    <div class="row">
        <input type="text" id="search" placeholder="Search Box" aria-label="Search Box">
        <button id="searchBtn">Search</button>
    </div>
    <div class="row">
        <button id="uploadBtn" title="Upload the active editor file to the current folder">Upload active file</button>
        <button id="tokenBtn">Token</button>
        <button id="credsBtn" title="Sign in with app Client ID, Client Secret and Enterprise ID">Client creds</button>
    </div>
    <div class="crumbs" id="crumbs"></div>
    <div id="status" class="notice"></div>
    <div id="list"></div>
    <button id="moreBtn" class="hidden">Load more</button>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const $ = (id) => document.getElementById(id);
        const search = $('search');
        const list = $('list');
        const status = $('status');
        const crumbs = $('crumbs');
        const moreBtn = $('moreBtn');
        let mode = 'folder';
        let nextOffset = 0;

        function fmtSize(n) {
            if (!n) { return ''; }
            const u = ['B', 'KB', 'MB', 'GB'];
            let i = 0;
            while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
            return (i ? n.toFixed(1) : n) + ' ' + u[i];
        }

        function setStatus(text, isError) {
            status.textContent = text || '';
            status.className = isError ? 'error' : 'notice';
        }

        function button(label, title, onClick, cls) {
            const b = document.createElement('button');
            b.textContent = label;
            b.title = title;
            if (cls) { b.className = cls; }
            b.addEventListener('click', onClick);
            return b;
        }

        function renderCrumbs(path) {
            crumbs.textContent = '';
            if (!path) { return; }
            path.forEach((p, i) => {
                if (i) {
                    const s = document.createElement('span');
                    s.className = 'sep';
                    s.textContent = '/';
                    crumbs.appendChild(s);
                }
                crumbs.appendChild(button(p.name, 'Open folder', () => vscode.postMessage({ command: 'openFolder', id: p.id }), 'link'));
            });
        }

        function renderItem(it) {
            const row = document.createElement('div');
            row.className = 'item';
            const kind = document.createElement('span');
            kind.className = 'kind';
            kind.textContent = it.type === 'folder' ? 'D' : 'F';
            const name = document.createElement('span');
            name.className = 'name';
            name.textContent = it.name;
            name.title = it.type === 'folder' ? 'Open folder' : 'Open file';
            name.addEventListener('click', () => vscode.postMessage(
                it.type === 'folder' ? { command: 'openFolder', id: it.id } : { command: 'openFile', id: it.id }));
            const meta = document.createElement('span');
            meta.className = 'meta';
            meta.textContent = fmtSize(it.size);
            row.append(kind, name, meta);
            if (it.type === 'file') {
                row.appendChild(button('Save', 'Download to disk', () => vscode.postMessage({ command: 'downloadFile', id: it.id }), 'link'));
            }
            row.appendChild(button('Web', 'Open in browser', () => vscode.postMessage({ command: 'openWeb', id: it.id, type: it.type }), 'link'));
            return row;
        }

        function doSearch() {
            const q = search.value.trim();
            if (!q) { vscode.postMessage({ command: 'openFolder' }); return; }
            setStatus('Searching...');
            vscode.postMessage({ command: 'search', query: q });
        }

        $('searchBtn').addEventListener('click', doSearch);
        search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { doSearch(); } });
        $('uploadBtn').addEventListener('click', () => vscode.postMessage({ command: 'upload' }));
        $('tokenBtn').addEventListener('click', () => vscode.postMessage({ command: 'token' }));
        $('credsBtn').addEventListener('click', () => vscode.postMessage({ command: 'credentials' }));
        moreBtn.addEventListener('click', () => vscode.postMessage({ command: 'more', offset: nextOffset }));

        window.addEventListener('message', (event) => {
            const m = event.data;
            switch (m.type) {
                case 'loading':
                    setStatus('Loading...');
                    break;
                case 'page':
                    mode = m.mode;
                    if (!m.append) { list.textContent = ''; }
                    renderCrumbs(m.mode === 'folder' ? m.path : null);
                    if (m.mode === 'search') {
                        crumbs.textContent = 'Search results';
                    }
                    m.items.forEach((it) => list.appendChild(renderItem(it)));
                    nextOffset = m.nextOffset;
                    moreBtn.className = m.nextOffset < m.total ? '' : 'hidden';
                    setStatus(m.items.length || m.append ? '' : 'Nothing here.');
                    break;
                case 'needToken':
                    list.textContent = '';
                    crumbs.textContent = '';
                    moreBtn.className = 'hidden';
                    setStatus('No Box credentials set. Click Token to paste an access token, or Client creds to sign in with a Client ID and Secret.');
                    break;
                case 'error':
                    setStatus(m.error, true);
                    break;
                case 'info':
                    setStatus(m.text);
                    break;
            }
        });

        vscode.postMessage({ command: 'ready' });
    </script>
</body>
</html>`;
}

module.exports = { getWebviewContent };
