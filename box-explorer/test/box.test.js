'use strict';

// Run with: node test/box.test.js
const assert = require('assert');
const http = require('http');
const { BoxService, BoxError, safeFileName, webUrl, checkId } = require('../src/boxService');

function testHelpers() {
    assert.strictEqual(checkId('123'), '123');
    assert.throws(() => checkId('12/../3'));
    assert.throws(() => checkId(''));
    assert.strictEqual(safeFileName('../a/b:c.txt'), '__a_b_c.txt');
    assert.strictEqual(safeFileName('.hidden'), '_hidden');
    assert.strictEqual(safeFileName(''), 'file');
    assert.strictEqual(webUrl('folder', '5'), 'https://app.box.com/folder/5');
    assert.strictEqual(webUrl('file', '5'), 'https://app.box.com/file/5');
    assert.strictEqual(BoxService.conflictFileId(new BoxError('x', 409, { context_info: { conflicts: { id: '77' } } })), '77');
    assert.strictEqual(BoxService.conflictFileId(new BoxError('x', 409, { context_info: { conflicts: [{ id: '78' }] } })), '78');
    assert.strictEqual(BoxService.conflictFileId(new BoxError('x', 500, {})), '');
}

async function testClientCredentials() {
    let tokenCalls = 0;
    let failToken = false;
    /** @type {string[]} */
    const bearers = [];
    let tokenBody = '';
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/oauth2/token') {
            let body = '';
            req.on('data', (c) => { body += c; });
            req.on('end', () => {
                tokenBody = body;
                if (failToken) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: 'invalid_client', error_description: 'bad secret' }));
                    return;
                }
                tokenCalls++;
                res.end(JSON.stringify({ access_token: `T${tokenCalls}`, expires_in: 3600 }));
            });
            return;
        }
        bearers.push(String(req.headers.authorization));
        // reject the first token once to exercise renewal on 401
        if (req.headers.authorization === 'Bearer T1' && bearers.length === 1) {
            res.statusCode = 401;
            res.end('{}');
            return;
        }
        res.end(JSON.stringify({ total_count: 0, offset: 0, entries: [] }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const realFetch = global.fetch;
    global.fetch = (url, init) => realFetch(String(url).replace('https://api.box.com', `http://127.0.0.1:${port}`), init);
    try {
        const box = new BoxService();
        assert.strictEqual(box.hasToken(), false);
        box.setClientCredentials('cid', 'sec', '455328');
        assert.strictEqual(box.hasToken(), true);

        await box.listFolder('0'); // T1 rejected with 401, renewed to T2
        assert.strictEqual(tokenCalls, 2);
        assert.deepStrictEqual(bearers, ['Bearer T1', 'Bearer T2']);
        const params = new URLSearchParams(tokenBody);
        assert.strictEqual(params.get('grant_type'), 'client_credentials');
        assert.strictEqual(params.get('client_id'), 'cid');
        assert.strictEqual(params.get('box_subject_type'), 'enterprise');
        assert.strictEqual(params.get('box_subject_id'), '455328');

        await box.listFolder('0'); // cached, no new token
        assert.strictEqual(tokenCalls, 2);
        box.setClientCredentials('cid', 'sec', '455328'); // unchanged keeps the cache
        await box.listFolder('0');
        assert.strictEqual(tokenCalls, 2);

        box.setClientCredentials('cid', 'sec2', '455328'); // changed drops it
        await box.listFolder('0');
        assert.strictEqual(tokenCalls, 3);

        const bad = new BoxService();
        bad.setClientCredentials('cid', 'wrong', '455328');
        failToken = true;
        await assert.rejects(() => bad.listFolder('0'), /rejected the client credentials.*bad secret/);

        box.setClientCredentials('', '', '');
        assert.strictEqual(box.hasToken(), false);
    } finally {
        global.fetch = realFetch;
        server.close();
    }
}

async function testService() {
    /** @type {string[]} */
    const seen = [];
    const server = http.createServer((req, res) => {
        seen.push(`${req.method} ${req.url} ${req.headers.authorization}`);
        res.setHeader('Content-Type', 'application/json');
        if (req.url.startsWith('/2.0/folders/0/items')) {
            res.end(JSON.stringify({
                total_count: 3, offset: 0,
                entries: [
                    { id: '1', type: 'folder', name: 'docs' },
                    { id: '2', type: 'file', name: 'a.txt', size: 5, modified_by: { name: 'Bob' } },
                    { id: '3', type: 'web_link', name: 'skip' }
                ]
            }));
        } else if (req.url.startsWith('/2.0/folders/1?')) {
            res.end(JSON.stringify({ id: '1', name: 'docs', path_collection: { entries: [{ id: '0', name: 'All Files' }] } }));
        } else if (req.url.startsWith('/2.0/files/2/content')) {
            res.setHeader('Content-Type', 'text/plain');
            res.end('hello');
        } else if (req.url.startsWith('/2.0/search')) {
            res.end(JSON.stringify({ total_count: 0, offset: 0, entries: [] }));
        } else if (req.url.startsWith('/2.0/files/9')) {
            res.statusCode = 404;
            res.end('{}');
        } else {
            res.statusCode = 401;
            res.end('{}');
        }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const realFetch = global.fetch;
    global.fetch = (url, init) => realFetch(String(url).replace('https://api.box.com', `http://127.0.0.1:${port}`), init);
    try {
        const box = new BoxService('tok');
        const page = await box.listFolder('0');
        assert.strictEqual(page.items.length, 2);
        assert.deepStrictEqual(page.items[1], { id: '2', type: 'file', name: 'a.txt', size: 5, modified: '', modifiedBy: 'Bob' });
        assert.strictEqual(page.total, 3);
        assert.strictEqual(page.nextOffset, 3);
        assert.ok(seen[0].endsWith('Bearer tok'));

        assert.deepStrictEqual(await box.folderPath('1'), [{ id: '0', name: 'All Files' }, { id: '1', name: 'docs' }]);
        assert.deepStrictEqual(await box.folderPath('0'), [{ id: '0', name: 'All Files' }]);
        assert.strictEqual((await box.downloadFile('2')).toString(), 'hello');
        assert.deepStrictEqual((await box.search('x')).items, []);
        await assert.rejects(() => box.search('  '), /search term/);
        await assert.rejects(() => box.fileInfo('9'), /404/);
        await assert.rejects(() => new BoxService('').listFolder('0'), /No Box credentials/);
        await assert.rejects(() => box.listFolder('7'), /401/);
    } finally {
        global.fetch = realFetch;
        server.close();
    }
}

(async () => {
    testHelpers();
    await testService();
    await testClientCredentials();
    console.log('box tests passed');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
