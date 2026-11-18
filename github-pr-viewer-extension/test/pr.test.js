'use strict';

// Run with: node test/pr.test.js
const assert = require('assert');
const http = require('http');
const Module = require('module');

const { parsePatch } = require('../src/diffParser');
const GithubService = require('../src/githubService');

// ---------- diff parser ----------
function testParser() {
    const patch = [
        '@@ -10,4 +10,5 @@ fn()',
        ' ctx1',
        '-old',
        '+new1',
        '+new2',
        ' ctx2',
        '\\ No newline at end of file',
        '@@ -50 +51,2 @@',
        '+x',
        ' y'
    ].join('\n');
    const { rows, truncated } = parsePatch(patch);
    assert.strictEqual(truncated, false);
    assert.deepStrictEqual(rows, [
        { t: 'h', text: '@@ -10,4 +10,5 @@ fn()' },
        { t: 'c', o: 10, n: 10, text: 'ctx1' },
        { t: 'd', o: 11, text: 'old' },
        { t: 'a', n: 11, text: 'new1' },
        { t: 'a', n: 12, text: 'new2' },
        { t: 'c', o: 12, n: 13, text: 'ctx2' },
        { t: 'n', text: '\\ No newline at end of file' },
        { t: 'h', text: '@@ -50 +51,2 @@' },
        { t: 'a', n: 51, text: 'x' },
        { t: 'c', o: 50, n: 52, text: 'y' }
    ]);
    // a line that merely looks like a header inside content is still data (starts with + or -)
    assert.deepStrictEqual(parsePatch('@@ -1 +1 @@\n+@@ not header').rows[1], { t: 'a', n: 1, text: '@@ not header' });
    // truncation
    const big = '@@ -1,5 +1,5 @@\n' + Array.from({ length: 10 }, (_, i) => `+l${i}`).join('\n');
    const cut = parsePatch(big, 4);
    assert.strictEqual(cut.rows.length, 4);
    assert.strictEqual(cut.truncated, true);
    console.log('ok - diff parser');
}

// ---------- API layer against a mock GitHub ----------
function mockGithub() {
    const seen = [];
    const files = Array.from({ length: 130 }, (_, i) => ({
        filename: `src/f${i}.c`, status: 'modified', additions: 1, deletions: 1,
        blob_url: `https://github.com/o/r/blob/x/src/f${i}.c`,
        patch: '@@ -1,2 +1,2 @@\n-a\n+b'
    }));
    files[1] = { filename: 'logo.png', status: 'added', additions: 0, deletions: 0 }; // no patch
    files[2] = { filename: 'new.c', previous_filename: 'old.c', status: 'renamed', additions: 0, deletions: 0, patch: '@@ -1 +1 @@\n x' };

    const routes = {
        '/repos/o/r/pulls/7': () => ({
            number: 7, title: 'Fix <b>it</b>', html_url: 'https://github.com/o/r/pull/7', state: 'closed', merged: true,
            draft: false, user: { login: 'alice' }, base: { ref: 'main' }, head: { label: 'bob:fix', ref: 'fix' },
            body: 'desc', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
            additions: 5, deletions: 3, changed_files: 130, commits: 2, labels: [{ name: 'bug' }]
        }),
        '/repos/o/r/pulls/7/files': (page) => files.slice((page - 1) * 100, page * 100),
        '/repos/o/r/issues/7/comments': () => [{ user: { login: 'carol' }, body: 'hi', created_at: '2026-01-01T01:00:00Z' }],
        '/repos/o/r/pulls/7/comments': () => [
            { user: { login: 'dave' }, body: 'nit', created_at: '2026-01-01T02:00:00Z', path: 'src/f0.c', line: 1, side: 'RIGHT' }
        ],
        '/repos/o/r/pulls/7/reviews': () => [
            { user: { login: 'dave' }, state: 'CHANGES_REQUESTED' },
            { user: { login: 'dave' }, state: 'APPROVED' },
            { user: { login: 'erin' }, state: 'COMMENTED' }
        ]
    };
    const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        seen.push({ path: u.pathname, auth: req.headers.authorization });
        const route = routes[u.pathname];
        if (!route) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"message":"Not Found"}'); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(route(Number(u.searchParams.get('page') || 1))));
    });
    return { server, seen };
}

async function testService() {
    const { server, seen } = mockGithub();
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const svc = new GithubService('https://api.github.com', 'tok');
    svc.apiUrl = `http://127.0.0.1:${server.address().port}`; // bypass https-only check for the local mock

    const d = await svc.fetchPullRequestDetail('o', 'r', 7);
    assert.strictEqual(d.state, 'merged');
    assert.strictEqual(d.title, 'Fix <b>it</b>'); // stays raw text; the page renders with textContent
    assert.strictEqual(d.head, 'bob:fix');
    assert.strictEqual(d.files.length, 130, 'paginates files over 100');
    assert.strictEqual(d.files[1].rows, null);
    assert.strictEqual(d.files[1].noPatch, true);
    assert.strictEqual(d.files[2].previous, 'old.c');
    assert.deepStrictEqual(d.files[0].rows[2], { t: 'a', n: 1, text: 'b' });
    assert.deepStrictEqual(d.reviewers, [{ user: 'dave', state: 'APPROVED' }]); // latest state, COMMENTED ignored
    assert.strictEqual(d.comments[0].author, 'carol');
    assert.strictEqual(d.reviewComments[0].path, 'src/f0.c');
    assert.ok(seen.every((s) => s.auth === 'Bearer tok'));
    console.log('ok - detail fetch, pagination, reviewers, no-patch files');

    // 404 gives a readable error
    await assert.rejects(() => svc.fetchPullRequestDetail('o', 'r', 999), /HTTP 404/);
    // Bad references never reach the network
    const before = seen.length;
    await assert.rejects(() => svc.fetchPullRequestDetail('o/../x', 'r', 1), /Invalid/);
    await assert.rejects(() => svc.fetchPullRequestDetail('o', 'r', -1), /Invalid/);
    await assert.rejects(() => svc.fetchPullRequestDetail('o', 'r?x=1', 1), /Invalid/);
    assert.strictEqual(seen.length, before);
    console.log('ok - errors and input validation');

    // Diff budget: many large patches are shortened, not unbounded
    const huge = { items: Array.from({ length: 10 }, (_, i) => ({
        filename: `h${i}`, status: 'modified', patch: '@@ -1 +1 @@\n' + Array.from({ length: 5000 }, () => '+x').join('\n')
    })), truncated: false };
    const t = svc.toDetail('o', 'r', { number: 1, title: 't', state: 'open' }, huge, [], [], []);
    const total = t.files.reduce((n, f) => n + (f.rows ? f.rows.length : 0), 0);
    assert.ok(total <= 20000, 'total rows capped, got ' + total);
    assert.strictEqual(t.diffTruncated, true);
    console.log('ok - diff size budget');
    server.close();
}

// ---------- webview page script in a minimal DOM ----------
function makeDom() {
    class Node {
        constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this.listeners = {}; this._text = ''; this.open = false; }
        set textContent(v) { this._text = String(v); this.children = []; }
        get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
        set innerHTML(v) { this.children = []; this._text = ''; this._html = v; }
        appendChild(c) { this.children.push(c); return c; }
        addEventListener(t, cb) { (this.listeners[t] = this.listeners[t] || []).push(cb); }
        fire(t) { (this.listeners[t] || []).forEach((cb) => cb({ preventDefault() {} })); }
        all(pred, out = []) { if (pred(this)) { out.push(this); } this.children.forEach((c) => c.all(pred, out)); return out; }
    }
    const root = new Node('div');
    const doc = {
        title: '',
        getElementById: () => root,
        createElement: (t) => new Node(t),
        createDocumentFragment: () => new Node('frag')
    };
    return { root, doc };
}

function testPageScript() {
    const { getPrDetailHtml } = require('../src/prDetailHtml');
    const html = getPrDetailHtml({ nonce: 'n', cspSource: 'x' });
    assert.ok(/Content-Security-Policy[^>]*default-src 'none'/.test(html));
    assert.ok(!/unsafe-inline|unsafe-eval/.test(html));
    const js = html.split('<script nonce="n">')[1].split('</script>')[0];

    const { root, doc } = makeDom();
    const posted = [];
    let handler;
    const win = { addEventListener: (t, cb) => { handler = cb; } };
    new Function('acquireVsCodeApi', 'document', 'window', js)(() => ({ postMessage: (m) => posted.push(m) }), doc, win);
    assert.deepStrictEqual(posted[0], { command: 'ready' });

    const pr = {
        owner: 'o', repo: 'r', number: 7, title: '<img src=x onerror=alert(1)>', url: 'https://github.com/o/r/pull/7',
        state: 'open', draft: false, author: 'alice', base: 'main', head: 'bob:fix', body: '<script>x</script>',
        created: '', updated: '', additions: 1, deletions: 1, changedFiles: 1, commits: 1, labels: [], reviewers: [],
        filesTruncated: false, diffTruncated: false,
        files: [{ filename: 'a.c', status: 'modified', additions: 1, deletions: 1, rows: [
            { t: 'h', text: '@@ -1 +1 @@' }, { t: 'd', o: 1, text: 'old' }, { t: 'a', n: 1, text: 'new' }
        ], truncated: false }],
        comments: [], reviewComments: [{ author: 'dave', body: 'nit', created: '', path: 'a.c', line: 1, side: 'RIGHT' },
                                       { author: 'dave', body: 'gone', created: '', path: 'zzz.c', line: 9, side: 'RIGHT' }]
    };
    handler({ data: { type: 'detail', pr } });
    const text = root.textContent;
    assert.ok(text.includes('<img src=x onerror=alert(1)> #7'), 'title shown as text');
    assert.ok(text.includes('<script>x</script>'), 'body shown as text');
    assert.ok(text.includes('gone'), 'comment on a file not in the diff goes to "Other review comments"');

    const file = root.all((n) => n.tag === 'details')[0];
    assert.strictEqual(file.children.length, 1, 'diff is not rendered until the file is opened');
    file.open = true; file.fire('toggle');
    const lines = file.all((n) => /^dl /.test(n.className));
    assert.strictEqual(lines.length, 3);
    assert.ok(file.textContent.includes('nit'), 'inline comment shown under line 1 of the new side');
    file.fire('toggle');
    assert.strictEqual(file.all((n) => /^dl /.test(n.className)).length, 3, 'no duplicate rendering');
    assert.strictEqual(root.all((n) => n.tag === 'img').length, 0);
    console.log('ok - page renders safely, lazy diff, inline comments');

    handler({ data: { type: 'error', error: 'HTTP 404' } });
    assert.ok(root.textContent.includes('Error: HTTP 404'));
}

// ---------- panel lifecycle with a mock vscode ----------
async function testPanel() {
    const disposers = [];
    const panels = [];
    const mockVscode = {
        window: { createWebviewPanel: () => {
            const p = { disposed: false, title: '', revealed: 0, posted: [],
                reveal() { if (this.disposed) { throw new Error('Webview is disposed'); } this.revealed++; },
                onDidDispose(cb) { disposers.push(cb); },
                webview: { cspSource: 'x', html: '', onDidReceiveMessage(cb) { p.onMessage = cb; },
                    postMessage(m) { if (p.disposed) { throw new Error('Webview is disposed'); } p.posted.push(m); } } };
            panels.push(p); return p; } },
        ViewColumn: { Active: -1 },
        env: { openExternal: (u) => { mockVscode.opened.push(String(u)); } },
        Uri: { parse: (s) => s },
        opened: []
    };
    const orig = Module._load;
    Module._load = function (r, ...rest) { return r === 'vscode' ? mockVscode : orig.call(this, r, ...rest); };
    const { PrDetailPanel } = require('../src/prDetailPanel');
    Module._load = orig;

    let calls = 0;
    const provider = { loadState: async () => {}, service: { fetchPullRequestDetail: async (o, r, n) => {
        calls++; if (n === 404) { throw new Error('HTTP 404'); } return { url: 'https://github.com/o/r/pull/' + n, number: n }; } } };
    const ctx = { subscriptions: [] };

    PrDetailPanel.show(ctx, provider, 'o', 'r', 7);
    PrDetailPanel.show(ctx, provider, 'O', 'R', 7); // same PR (case-insensitive): reuse
    assert.strictEqual(panels.length, 1);
    assert.strictEqual(panels[0].revealed, 1);

    panels[0].onMessage({ command: 'ready' });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(panels[0].posted[0].type, 'detail');

    // openUrl only for the PR's own URL
    panels[0].onMessage({ command: 'openUrl', url: 'https://evil.example/' });
    panels[0].onMessage({ command: 'openUrl', url: 'https://github.com/o/r/pull/7' });
    assert.deepStrictEqual(mockVscode.opened, ['https://github.com/o/r/pull/7']);

    // errors are reported to the page
    PrDetailPanel.show(ctx, provider, 'o', 'r', 404);
    panels[1].onMessage({ command: 'refresh' });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepStrictEqual(panels[1].posted[0], { type: 'error', error: 'HTTP 404' });

    // closing mid-load must not throw, and the PR can be reopened
    panels[0].onMessage({ command: 'refresh' });
    panels[0].disposed = true; disposers[0]();
    await new Promise((r) => setTimeout(r, 20));
    PrDetailPanel.show(ctx, provider, 'o', 'r', 7);
    assert.strictEqual(panels.length, 3);
    console.log('ok - panel reuse, URL allow-list, error path, close during load');
}

(async () => {
    testParser();
    await testService();
    testPageScript();
    await testPanel();
    console.log('all tests passed');
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
