// @ts-check
'use strict';

/**
 * Generates the HTML for the in-IDE Gerrit change detail page.
 * All change content is rendered with textContent in the page script.
 * @param {{nonce: string, cspSource: string}} opts
 * @returns {string}
 */
function getChangeDetailHtml(opts) {
    const { nonce, cspSource } = opts;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gerrit Change</title>
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
        .vote-pos { background: rgba(46,160,67,.25); color: #3fb950; }
        .vote-neg { background: rgba(248,81,73,.25); color: #f85149; }
        button {
            background: var(--vscode-button-background); color: var(--vscode-button-foreground);
            border: none; border-radius: 3px; padding: 4px 10px; cursor: pointer; font-size: 12px;
        }
        button:hover { background: var(--vscode-button-hoverBackground); }
        button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .text { white-space: pre-wrap; word-break: break-word; }
        .comment { border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.3)); border-radius: 5px; margin: 8px 0; }
        .comment.open { border-left: 3px solid #d29922; }
        .comment .head { padding: 5px 10px; background: rgba(128,128,128,.1); font-size: 12px; }
        .comment .text { padding: 8px 10px; }
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
        .dl.s { background: rgba(56,139,253,.15); color: var(--vscode-descriptionForeground); }
        .inline { margin: 4px 0 4px 62px; font-family: var(--vscode-font-family); font-size: 13px; }
        .msg.auto { opacity: .6; }
    </style>
</head>
<body>
    <div id="root"><div class="muted">Loading change...</div></div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const root = document.getElementById('root');
        let current = null;
        let seq = 0;
        const pending = new Map();

        function el(tag, className, text) {
            const n = document.createElement(tag);
            if (className) { n.className = className; }
            if (text !== undefined && text !== null) { n.textContent = text; }
            return n;
        }
        function fmt(d) { return d ? new Date(d).toLocaleString() : ''; }
        function loading() { root.innerHTML = '<div class="muted">Loading change...</div>'; }

        function commentBox(c, extra) {
            const box = el('div', 'comment' + (c.unresolved ? ' open' : ''));
            const head = el('div', 'head');
            head.appendChild(el('b', '', c.author));
            head.appendChild(el('span', 'muted', '  ' + fmt(c.created) + (extra || '') + (c.unresolved ? '  - unresolved' : '')));
            box.appendChild(head);
            box.appendChild(el('div', 'text', c.body));
            return box;
        }

        function render(ch) {
            current = ch;
            root.innerHTML = '';
            document.title = '#' + ch.number + ' ' + ch.subject;

            root.appendChild(el('h1', '', ch.subject + ' #' + ch.number));

            const meta = el('div', 'row');
            const sk = ch.status === 'NEW' ? 'open' : ch.status === 'MERGED' ? 'merged' : ch.status === 'ABANDONED' ? 'closed' : 'draft';
            meta.appendChild(el('span', 'badge b-' + sk, ch.status === 'NEW' ? 'open' : ch.status.toLowerCase()));
            meta.appendChild(el('span', 'tag', ch.project));
            meta.appendChild(el('span', 'tag', ch.branch));
            if (ch.topic) { meta.appendChild(el('span', 'tag', 'topic: ' + ch.topic)); }
            meta.appendChild(el('span', 'muted', 'by ' + ch.owner));
            root.appendChild(meta);

            const stats = el('div', 'row muted');
            stats.appendChild(el('span', '', 'patchset ' + ch.patchSet));
            stats.appendChild(el('span', '', ch.files.length + ' files'));
            stats.appendChild(el('span', 'add', '+' + ch.insertions));
            stats.appendChild(el('span', 'del', '-' + ch.deletions));
            if (ch.unresolved) { stats.appendChild(el('span', '', ch.unresolved + ' unresolved')); }
            stats.appendChild(el('span', '', 'updated ' + fmt(ch.updated)));
            root.appendChild(stats);

            if (ch.votes.length) {
                const v = el('div', 'row');
                ch.votes.forEach(x => v.appendChild(el('span', 'tag ' + (x.value > 0 ? 'vote-pos' : 'vote-neg'),
                    x.label + ' ' + (x.value > 0 ? '+' : '') + x.value + ' ' + x.user)));
                root.appendChild(v);
            }

            const actions = el('div', 'row');
            const open = el('button', '', 'Open in Gerrit');
            open.addEventListener('click', () => vscode.postMessage({ command: 'openUrl', url: ch.url }));
            const refresh = el('button', 'secondary', 'Refresh');
            refresh.addEventListener('click', () => { loading(); vscode.postMessage({ command: 'refresh' }); });
            actions.appendChild(open);
            actions.appendChild(refresh);
            root.appendChild(actions);

            root.appendChild(el('h2', '', 'Commit message'));
            root.appendChild(ch.message ? el('div', 'text', ch.message) : el('div', 'muted', 'No commit message.'));

            root.appendChild(el('h2', '', 'Files (' + ch.files.length + ')'));
            if (ch.filesTruncated) {
                root.appendChild(el('div', 'notice', 'Only the first ' + ch.files.length + ' files are listed. Use "Open in Gerrit" for the rest.'));
            }
            const bar = el('div', 'row');
            const expand = el('button', 'secondary', 'Expand all');
            const collapse = el('button', 'secondary', 'Collapse all');
            bar.appendChild(expand);
            bar.appendChild(collapse);
            root.appendChild(bar);
            const list = el('div');
            const fileEls = ch.files.map(f => fileBlock(ch, f));
            fileEls.forEach(d => list.appendChild(d));
            root.appendChild(list);
            expand.addEventListener('click', () => fileEls.forEach(d => { d.open = true; }));
            collapse.addEventListener('click', () => fileEls.forEach(d => { d.open = false; }));

            if (ch.patchsetComments.length) {
                root.appendChild(el('h2', '', 'Patchset-level comments (' + ch.patchsetComments.length + ')'));
                ch.patchsetComments.forEach(c => root.appendChild(commentBox(c, '  patchset ' + c.patchSet)));
            }

            root.appendChild(el('h2', '', 'History (' + ch.messages.length + ')'));
            ch.messages.forEach(m => {
                const box = commentBox({ author: m.author, body: m.body, created: m.created, unresolved: false },
                    m.patchSet ? '  patchset ' + m.patchSet : '');
                if (m.auto) { box.className += ' msg auto'; }
                root.appendChild(box);
            });
        }

        function fileBlock(ch, f) {
            const d = el('details', 'file');
            const s = el('summary');
            s.appendChild(el('span', 'badge b-' + (f.status === 'deleted' ? 'closed' : f.status === 'added' ? 'open' : 'draft'), f.status));
            s.appendChild(el('span', 'fname', f.old ? f.old + ' -> ' + f.label : f.label));
            const st = el('span', 'fstat');
            if (f.comments.length) { st.appendChild(el('span', 'muted', f.comments.length + ' comments  ')); }
            st.appendChild(el('span', 'add', '+' + f.ins + ' '));
            st.appendChild(el('span', 'del', '-' + f.del));
            s.appendChild(st);
            d.appendChild(s);

            let requested = false;
            const body = el('div');
            d.appendChild(body);
            d.addEventListener('toggle', () => {
                if (!d.open || requested) { return; }
                requested = true;
                body.appendChild(el('div', 'muted', 'Loading diff...'));
                const id = ++seq;
                pending.set(id, { f, body, ch });
                vscode.postMessage({ command: 'loadDiff', id, number: ch.number, revision: ch.revision, path: f.path });
            });
            return d;
        }

        function showDiff(entry, result) {
            const { f, body } = entry;
            body.innerHTML = '';
            if (result.binary || !result.rows) {
                body.appendChild(el('div', 'notice', 'No text diff available (binary file). Use "Open in Gerrit".'));
                return;
            }
            // Group comments by side+line; only the latest patchset's comments line up with this diff
            const bySide = new Map();
            const unplaced = [];
            f.comments.forEach(c => {
                if (c.patchSet !== entry.ch.patchSet || !c.line) { unplaced.push(c); return; }
                const key = c.side + '|' + c.line;
                if (!bySide.has(key)) { bySide.set(key, []); }
                bySide.get(key).push(c);
            });

            const diff = el('div', 'diff');
            const frag = document.createDocumentFragment();
            result.rows.forEach(r => {
                const line = el('div', 'dl ' + r.t);
                if (r.t === 's') {
                    line.appendChild(el('span', 'no', ''));
                    line.appendChild(el('span', 'no', ''));
                    line.appendChild(el('span', 'sign', ''));
                    line.appendChild(el('span', 'txt', '... ' + r.count + ' unchanged lines ...'));
                    frag.appendChild(line);
                    return;
                }
                const oldNo = r.t === 'd' || r.t === 'c' ? r.o : '';
                const newNo = r.t === 'a' || r.t === 'c' ? r.n : '';
                line.appendChild(el('span', 'no', String(oldNo)));
                line.appendChild(el('span', 'no', String(newNo)));
                line.appendChild(el('span', 'sign', r.t === 'a' ? '+' : r.t === 'd' ? '-' : ''));
                line.appendChild(el('span', 'txt', r.text));
                frag.appendChild(line);
                const keys = [];
                if (r.t === 'a' || r.t === 'c') { keys.push('RIGHT|' + r.n); }
                if (r.t === 'd') { keys.push('LEFT|' + r.o); }
                keys.forEach(k => {
                    (bySide.get(k) || []).forEach(c => {
                        const wrap = el('div', 'inline');
                        wrap.appendChild(commentBox(c));
                        frag.appendChild(wrap);
                    });
                    bySide.delete(k);
                });
            });
            // Comments whose line is not visible in this diff
            bySide.forEach(list => list.forEach(c => unplaced.push(c)));
            diff.appendChild(frag);
            body.appendChild(diff);
            if (result.truncated) {
                body.appendChild(el('div', 'notice', 'Diff shortened. Use "Open in Gerrit" for the full file diff.'));
            }
            if (unplaced.length) {
                body.appendChild(el('div', 'muted', 'Other comments on this file (' + unplaced.length + '):'));
                unplaced.forEach(c => body.appendChild(commentBox(c,
                    '  patchset ' + c.patchSet + (c.line ? ', line ' + c.line : ''))));
            }
        }

        window.addEventListener('message', event => {
            const m = event.data;
            if (m.type === 'detail') {
                pending.clear();
                render(m.change);
            } else if (m.type === 'diff') {
                const entry = pending.get(m.id);
                if (entry) { pending.delete(m.id); showDiff(entry, m.result); }
            } else if (m.type === 'diffError') {
                const entry = pending.get(m.id);
                if (entry) {
                    pending.delete(m.id);
                    entry.body.innerHTML = '';
                    entry.body.appendChild(el('div', 'error', 'Error: ' + m.error));
                }
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

module.exports = { getChangeDetailHtml };
