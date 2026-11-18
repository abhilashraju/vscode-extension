// @ts-check
'use strict';

/**
 * @param {number} i pane index
 * @param {string} target host:port shown in the pane title
 * @returns {string}
 */
function paneHtml(i, target) {
    // target comes from validated settings (host regex + integer port); escape anyway
    const safe = String(target).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `        <section class="pane" data-pane="${i}">
            <div class="title">bmcshell ${safe}</div>
            <div class="toolbar">
                <button class="toggleBtn">Connect</button>
                <button class="pauseBtn secondary">Pause</button>
                <button class="clearBtn secondary">Clear</button>
                <input type="text" class="filterInput" placeholder="Filter (space separated, any match)" autocomplete="off">
                <select class="levelSelect">
                    <option value="all">All levels</option>
                    <option value="warning">Warnings + errors</option>
                    <option value="error">Errors only</option>
                </select>
                <label><input type="checkbox" class="autoScroll" checked> Auto-scroll</label>
            </div>
            <div class="status"><span class="dot"></span><span class="statusText">Disconnected</span><span class="counts"></span></div>
            <div class="log"><div class="empty">Press Connect. Start the journal in the bmcshell terminal on this port (<code>machine &lt;name&gt;</code>, then <code>journal.start</code> or <code>journal.subscribe</code>) to see lines here.</div></div>
        </section>`;
}

/**
 * Generates the HTML for the journal viewer webview: one pane per target
 * @param {{nonce: string, cspSource: string, maxLines: number, targets: string[]}} opts
 * @returns {string}
 */
function getJournalHtml(opts) {
    const { nonce, cspSource, maxLines, targets } = opts;
    const config = JSON.stringify({ maxLines, targets })
        .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>bmcshell Journal</title>
    <style nonce="${nonce}">
        html, body { height: 100%; }
        body {
            margin: 0; padding: 8px; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box;
            font-family: var(--vscode-font-family); font-size: 13px;
            color: var(--vscode-editor-foreground); background: var(--vscode-editor-background);
        }
        .panes { flex: 1; min-height: 0; display: flex; flex-direction: row; gap: 8px; }
        .pane { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
        .title { font-size: 12px; font-weight: 600; }
        .toolbar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        input[type=text], select {
            background: var(--vscode-input-background); color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, #3c3c3c); border-radius: 3px;
            padding: 4px 8px; font-family: inherit; font-size: 12px;
        }
        input[type=text] { flex: 1; min-width: 100px; }
        button {
            background: var(--vscode-button-background); color: var(--vscode-button-foreground);
            border: none; border-radius: 3px; padding: 4px 10px; cursor: pointer; font-size: 12px;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        label { font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
        .status { font-size: 12px; display: flex; gap: 8px; align-items: center; color: var(--vscode-descriptionForeground); }
        .dot { width: 9px; height: 9px; border-radius: 50%; background: #8b949e; flex: none; }
        .dot.connected { background: #3fb950; }
        .dot.connecting, .dot.reconnecting { background: #d29922; }
        .dot.error { background: #f85149; }
        .log {
            flex: 1; overflow-y: auto; white-space: pre-wrap; word-break: break-all;
            font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
            border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3)); border-radius: 3px; padding: 6px;
        }
        .line { padding: 1px 0; }
        .line.error { color: #f85149; }
        .line.warning { color: #d29922; }
        .empty { color: var(--vscode-descriptionForeground); }
    </style>
</head>
<body>
    <div class="panes">
${targets.map((t, i) => paneHtml(i, t)).join('\n')}
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const config = ${config};
        const MAX_LINES = Math.max(100, config.maxLines);

        function levelOf(text) {
            const t = text.toLowerCase();
            if (/(error|fail|crit|fatal|panic)/.test(t)) { return 'error'; }
            if (/warn/.test(t)) { return 'warning'; }
            return 'info';
        }

        function createPane(root, index) {
            const q = (sel) => root.querySelector(sel);
            const log = q('.log');
            const toggleBtn = q('.toggleBtn');
            const pauseBtn = q('.pauseBtn');
            const clearBtn = q('.clearBtn');
            const filterInput = q('.filterInput');
            const levelSelect = q('.levelSelect');
            const autoScroll = q('.autoScroll');
            const dot = q('.dot');
            const statusText = q('.statusText');
            const counts = q('.counts');
            const target = config.targets[index];

            let lines = [];
            let paused = false;
            let connected = false;
            let busy = false;

            function terms() {
                return filterInput.value.toLowerCase().split(/\\s+/)
                    .map(s => s.replace(/^\\*+|\\*+$/g, '')).filter(Boolean);
            }

            function passes(entry, ts) {
                const lvl = levelSelect.value;
                if (lvl === 'error' && entry.level !== 'error') { return false; }
                if (lvl === 'warning' && entry.level === 'info') { return false; }
                if (ts.length === 0) { return true; }
                const lower = entry.text.toLowerCase();
                return ts.some(t => lower.includes(t));
            }

            function lineNode(entry) {
                const div = document.createElement('div');
                div.className = 'line ' + entry.level;
                div.textContent = entry.text;
                return div;
            }

            function updateCounts(shown) {
                counts.textContent = shown + ' shown / ' + lines.length + ' buffered' + (paused ? ' (paused)' : '');
            }

            function stick() {
                if (autoScroll.checked) { log.scrollTop = log.scrollHeight; }
            }

            function rebuild() {
                const ts = terms();
                const frag = document.createDocumentFragment();
                let shown = 0;
                lines.forEach(e => { if (passes(e, ts)) { frag.appendChild(lineNode(e)); shown++; } });
                log.innerHTML = '';
                log.appendChild(frag);
                updateCounts(shown);
                stick();
            }

            function addLines(batch) {
                const ts = terms();
                const entries = batch.map(text => ({ text: String(text), level: levelOf(String(text)) }));
                lines = lines.concat(entries);
                if (lines.length > MAX_LINES) { lines = lines.slice(lines.length - MAX_LINES); }
                if (paused) { updateCounts(log.childElementCount); return; }
                const empty = log.querySelector('.empty');
                if (empty) { empty.remove(); }
                const frag = document.createDocumentFragment();
                entries.forEach(e => { if (passes(e, ts)) { frag.appendChild(lineNode(e)); } });
                log.appendChild(frag);
                while (log.childElementCount > MAX_LINES) { log.removeChild(log.firstChild); }
                updateCounts(log.childElementCount);
                stick();
            }

            function setStatus(state, detail) {
                connected = state === 'connected';
                busy = state === 'connecting' || state === 'reconnecting';
                dot.className = 'dot ' + state;
                statusText.textContent = state.charAt(0).toUpperCase() + state.slice(1) +
                    (detail ? ': ' + detail : (state === 'disconnected' ? '' : ' (' + target + ')'));
                toggleBtn.textContent = connected || busy ? 'Disconnect' : 'Connect';
            }

            toggleBtn.addEventListener('click', () => {
                vscode.postMessage({ command: connected || busy ? 'disconnect' : 'connect', pane: index });
            });
            pauseBtn.addEventListener('click', () => {
                paused = !paused;
                pauseBtn.textContent = paused ? 'Resume' : 'Pause';
                if (!paused) { rebuild(); } else { updateCounts(log.childElementCount); }
            });
            clearBtn.addEventListener('click', () => { lines = []; rebuild(); });
            filterInput.addEventListener('input', () => { if (!paused) { rebuild(); } });
            levelSelect.addEventListener('change', () => { if (!paused) { rebuild(); } });

            return { addLines, setStatus };
        }

        const panes = Array.from(document.querySelectorAll('.pane'))
            .map((root, i) => createPane(root, i));

        window.addEventListener('message', event => {
            const m = event.data;
            const pane = panes[m.pane];
            if (!pane) { return; }
            if (m.type === 'lines' && Array.isArray(m.lines)) {
                pane.addLines(m.lines);
            } else if (m.type === 'status') {
                pane.setStatus(m.state, m.detail);
            }
        });

        vscode.postMessage({ command: 'ready' });
    </script>
</body>
</html>`;
}

module.exports = { getJournalHtml };
