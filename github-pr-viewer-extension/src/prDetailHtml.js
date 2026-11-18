// @ts-check
'use strict';

/**
 * Generates the HTML for the in-IDE pull request detail page.
 * All pull request content is rendered with textContent in the page script.
 * @param {{nonce: string, cspSource: string}} opts
 * @returns {string}
 */
function getPrDetailHtml(opts) {
    const { nonce, cspSource } = opts;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Pull Request</title>
    <style nonce="${nonce}">
        body {
            margin: 0; padding: 16px 20px; font-family: var(--vscode-font-family); font-size: 13px; line-height: 1.5;
            color: var(--vscode-editor-foreground); background: var(--vscode-editor-background);
        }
        h1 { font-size: 18px; margin: 0 0 6px; word-break: break-word; }
        h2 { font-size: 14px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3)); }
        .muted { color: var(--vscode-descriptionForeground); }
        .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 6px 0; }
        .tag { background: rgba(128,128,128,.15); padding: 2px 6px; border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
        .badge { font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 4px; text-transform: uppercase; }
        .b-open { background: rgba(46,160,67,.18); color: #3fb950; }
        .b-merged { background: rgba(163,113,247,.18); color: #a371f7; }
        .b-closed { background: rgba(248,81,73,.18); color: #f85149; }
        .b-draft { background: rgba(128,128,128,.2); color: #8b949e; }
        .add { color: #3fb950; } .del { color: #f85149; }
        button {
            background: var(--vscode-button-background); color: var(--vscode-button-foreground);
            border: none; border-radius: 3px; padding: 4px 10px; cursor: pointer; font-size: 12px;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .body, .comment-body { white-space: pre-wrap; word-break: break-word; }
        .comment { border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3)); border-radius: 5px; margin: 8px 0; }
        .comment .head { padding: 5px 10px; background: rgba(128,128,128,.1); font-size: 12px; }
        .comment .comment-body { padding: 8px 10px; }
        .notice { padding: 8px 10px; border-left: 3px solid #d29922; background: rgba(210,153,34,.1); margin: 8px 0; }
        .error { color: #f85149; padding: 30px 0; }
        details.file { border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3)); border-radius: 5px; margin: 8px 0; }
        details.file > summary { cursor: pointer; padding: 6px 10px; background: rgba(128,128,128,.1); display: flex; gap: 10px; align-items: center; }
        .fname { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; word-break: break-all; flex: 1; }
        .fstat { font-size: 12px; white-space: nowrap; }
        .diff { overflow-x: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
        .dl { display: flex; min-width: max-content; }
        .dl .no { width: 48px; flex: none; text-align: right; padding-right: 8px; color: var(--vscode-editorLineNumber-foreground); user-select: none; }
        .dl .sign { width: 14px; flex: none; user-select: none; }
        .dl .txt { white-space: pre; padding-right: 12px; }
        .dl.a { background: rgba(46,160,67,.18); }
        .dl.d { background: rgba(248,81,73,.18); }
        .dl.h { background: rgba(56,139,253,.15); color: var(--vscode-descriptionForeground); }
        .dl.n { color: var(--vscode-descriptionForeground); font-style: italic; }
        .inline { margin: 4px 0 4px 62px; font-family: var(--vscode-font-family); font-size: 13px; }
    </style>
</head>
<body>
    <div id="root"><div class="muted">Loading pull request...</div></div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const root = document.getElementById('root');

        function el(tag, className, text) {
            const n = document.createElement(tag);
            if (className) { n.className = className; }
            if (text !== undefined && text !== null) { n.textContent = text; }
            return n;
        }
        function fmt(d) { return d ? new Date(d).toLocaleString() : ''; }
        function loading() { root.innerHTML = '<div class="muted">Loading pull request...</div>'; }

        function commentBox(c, extra) {
            const box = el('div', 'comment');
            const head = el('div', 'head');
            head.appendChild(el('b', '', '@' + c.author));
            head.appendChild(el('span', 'muted', '  ' + fmt(c.created) + (extra || '')));
            box.appendChild(head);
            box.appendChild(el('div', 'comment-body', c.body));
            return box;
        }

        function render(pr) {
            root.innerHTML = '';
            document.title = '#' + pr.number + ' ' + pr.title;

            root.appendChild(el('h1', '', pr.title + ' #' + pr.number));

            const meta = el('div', 'row');
            const stateKey = pr.draft && pr.state === 'open' ? 'draft' : pr.state;
            meta.appendChild(el('span', 'badge b-' + stateKey, stateKey));
            meta.appendChild(el('span', 'tag', pr.owner + '/' + pr.repo));
            meta.appendChild(el('span', 'muted', '@' + pr.author + ' wants to merge'));
            meta.appendChild(el('span', 'tag', pr.head));
            meta.appendChild(el('span', 'muted', 'into'));
            meta.appendChild(el('span', 'tag', pr.base));
            root.appendChild(meta);

            const stats = el('div', 'row muted');
            stats.appendChild(el('span', '', pr.commits + ' commits'));
            stats.appendChild(el('span', '', pr.changedFiles + ' files'));
            stats.appendChild(el('span', 'add', '+' + pr.additions));
            stats.appendChild(el('span', 'del', '-' + pr.deletions));
            stats.appendChild(el('span', '', 'updated ' + fmt(pr.updated)));
            root.appendChild(stats);

            if (pr.labels.length || pr.reviewers.length) {
                const lr = el('div', 'row');
                pr.labels.forEach(l => lr.appendChild(el('span', 'tag', l)));
                pr.reviewers.forEach(r => lr.appendChild(el('span', 'tag', '@' + r.user + ': ' + r.state.toLowerCase().replace('_', ' '))));
                root.appendChild(lr);
            }

            const actions = el('div', 'row');
            const open = el('button', '', 'Open on GitHub');
            open.addEventListener('click', () => vscode.postMessage({ command: 'openUrl', url: pr.url }));
            const refresh = el('button', 'secondary', 'Refresh');
            refresh.addEventListener('click', () => { loading(); vscode.postMessage({ command: 'refresh' }); });
            actions.appendChild(open);
            actions.appendChild(refresh);
            root.appendChild(actions);

            root.appendChild(el('h2', '', 'Description'));
            root.appendChild(pr.body ? el('div', 'body', pr.body) : el('div', 'muted', 'No description provided.'));

            // Index which review comments can be shown inline
            const present = new Set();
            pr.files.forEach(f => (f.rows || []).forEach(r => {
                if (r.t === 'a') { present.add(f.filename + '|RIGHT|' + r.n); }
                else if (r.t === 'd') { present.add(f.filename + '|LEFT|' + r.o); }
                else if (r.t === 'c') { present.add(f.filename + '|RIGHT|' + r.n); present.add(f.filename + '|LEFT|' + r.o); }
            }));
            const inline = new Map();
            const other = [];
            pr.reviewComments.forEach(c => {
                const key = c.path + '|' + c.side + '|' + c.line;
                if (present.has(key)) {
                    if (!inline.has(key)) { inline.set(key, []); }
                    inline.get(key).push(c);
                } else {
                    other.push(c);
                }
            });

            root.appendChild(el('h2', '', 'Files changed (' + pr.files.length + ')'));
            if (pr.filesTruncated) {
                root.appendChild(el('div', 'notice', 'Only the first ' + pr.files.length + ' files are shown. Use "Open on GitHub" for the rest.'));
            }
            if (pr.diffTruncated) {
                root.appendChild(el('div', 'notice', 'Some diffs are shortened to keep this page responsive. Use "Open on GitHub" for the full diff.'));
            }
            const bar = el('div', 'row');
            const expand = el('button', 'secondary', 'Expand all');
            const collapse = el('button', 'secondary', 'Collapse all');
            bar.appendChild(expand);
            bar.appendChild(collapse);
            root.appendChild(bar);
            const list = el('div');
            const fileEls = pr.files.map(f => fileBlock(f, inline));
            fileEls.forEach(d => list.appendChild(d));
            root.appendChild(list);
            expand.addEventListener('click', () => fileEls.forEach(d => { d.open = true; }));
            collapse.addEventListener('click', () => fileEls.forEach(d => { d.open = false; }));

            if (other.length) {
                root.appendChild(el('h2', '', 'Other review comments (' + other.length + ')'));
                other.forEach(c => root.appendChild(commentBox(c, '  on ' + c.path + (c.line ? ':' + c.line : ''))));
            }

            root.appendChild(el('h2', '', 'Conversation (' + pr.comments.length + ')'));
            if (pr.comments.length === 0) { root.appendChild(el('div', 'muted', 'No comments.')); }
            pr.comments.forEach(c => root.appendChild(commentBox(c)));
        }

        function fileBlock(f, inline) {
            const d = el('details', 'file');
            const s = el('summary');
            s.appendChild(el('span', 'badge b-' + (f.status === 'removed' ? 'closed' : f.status === 'added' ? 'open' : 'draft'), f.status));
            s.appendChild(el('span', 'fname', f.previous ? f.previous + ' -> ' + f.filename : f.filename));
            const st = el('span', 'fstat');
            st.appendChild(el('span', 'add', '+' + f.additions + ' '));
            st.appendChild(el('span', 'del', '-' + f.deletions));
            s.appendChild(st);
            d.appendChild(s);

            let rendered = false;
            d.addEventListener('toggle', () => {
                if (!d.open || rendered) { return; }
                rendered = true;
                if (!f.rows) {
                    d.appendChild(el('div', 'notice', 'No diff available (binary or very large file). Use "Open on GitHub".'));
                    return;
                }
                const diff = el('div', 'diff');
                const frag = document.createDocumentFragment();
                f.rows.forEach(r => {
                    const line = el('div', 'dl ' + r.t);
                    const oldNo = r.t === 'd' || r.t === 'c' ? r.o : '';
                    const newNo = r.t === 'a' || r.t === 'c' ? r.n : '';
                    line.appendChild(el('span', 'no', String(oldNo)));
                    line.appendChild(el('span', 'no', String(newNo)));
                    line.appendChild(el('span', 'sign', r.t === 'a' ? '+' : r.t === 'd' ? '-' : ''));
                    line.appendChild(el('span', 'txt', r.text));
                    frag.appendChild(line);
                    const keys = [];
                    if (r.t === 'a' || r.t === 'c') { keys.push(f.filename + '|RIGHT|' + r.n); }
                    if (r.t === 'd' || r.t === 'c') { keys.push(f.filename + '|LEFT|' + r.o); }
                    keys.forEach(k => {
                        const list = inline.get(k) || [];
                        list.forEach(c => {
                            const wrap = el('div', 'inline');
                            wrap.appendChild(commentBox(c));
                            frag.appendChild(wrap);
                        });
                        inline.delete(k);
                    });
                });
                diff.appendChild(frag);
                d.appendChild(diff);
                if (f.truncated) {
                    d.appendChild(el('div', 'notice', 'Diff shortened. Use "Open on GitHub" for the full file diff.'));
                }
            });
            return d;
        }

        window.addEventListener('message', event => {
            const m = event.data;
            if (m.type === 'detail') {
                render(m.pr);
            } else if (m.type === 'error') {
                root.innerHTML = '';
                root.appendChild(el('div', 'error', 'Error: ' + m.error));
                const retry = el('button', '', 'Retry');
                retry.addEventListener('click', () => { loading(); vscode.postMessage({ command: 'refresh' }); });
                root.appendChild(retry);
            }
        });

        vscode.postMessage({ command: 'ready' });
    </script>
</body>
</html>`;
}

module.exports = { getPrDetailHtml };
