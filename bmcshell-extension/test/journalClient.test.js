'use strict';

// Run with: node test/journalClient.test.js
// Requires the `openssl` CLI (used only to create a throw-away test certificate).

const assert = require('assert');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { JournalStreamClient, SseParser } = require('../src/journalClient');

function testParser() {
    const events = [];
    const p = new SseParser((d) => events.push(d));
    // Event split across chunks, CRLF split across chunks, multibyte split, comment, multi-line data
    p.push(Buffer.from('data: hel'));
    p.push(Buffer.from('lo\r'));
    p.push(Buffer.from('\n\r\n: keepalive\n\ndata: a\ndata: b\n\n'));
    const euro = Buffer.from('data: \u20ac\n\n');
    p.push(euro.subarray(0, 7));
    p.push(euro.subarray(7));
    p.push(Buffer.from('data:nospace\n\n'));
    assert.deepStrictEqual(events, ['hello', 'a\nb', '\u20ac', 'nospace']);

    const big = new SseParser(() => {});
    assert.throws(() => big.push(Buffer.alloc(2 * 1024 * 1024, 0x61)), /maximum/);
    console.log('ok - SSE parser');
}

function makeCert(dir) {
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
        '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'
    ], { stdio: 'ignore' });
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert), certPath: cert };
}

function waitFor(client, predicate, ms = 5000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout waiting for client event')), ms);
        client.on('status', function handler(state, detail) {
            if (predicate(state, detail)) {
                clearTimeout(t);
                client.off('status', handler);
                resolve({ state, detail });
            }
        });
    });
}

async function testEndToEnd() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmcshell-ext-'));
    try {
        const { key, cert, certPath } = makeCert(dir);
        let requests = 0;
        const server = https.createServer({ key, cert }, (req, res) => {
            requests++;
            assert.strictEqual(req.url, '/sse/journal');
            assert.strictEqual(req.headers.accept, 'text/event-stream');
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write('data:Connected to journal stream\n\n');
            res.write('data:bmcweb: error something\n\ndata:second');
            setTimeout(() => res.write('\n\n'), 50);
            // keep open; the client decides when to stop
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const port = server.address().port;

        // 1. Trusted CA: lines arrive
        const lines = [];
        const ok = new JournalStreamClient({ host: '127.0.0.1', port, caCertPath: certPath, autoReconnect: false });
        ok.on('line', (l) => lines.push(l));
        const connected = waitFor(ok, (s) => s === 'connected');
        ok.start();
        await connected;
        await new Promise((r) => setTimeout(r, 300));
        ok.stop();
        assert.deepStrictEqual(lines, ['Connected to journal stream', 'bmcweb: error something', 'second']);
        console.log('ok - streams lines over verified TLS');

        // 2. Untrusted certificate is rejected and is not retried
        const before = requests;
        const bad = new JournalStreamClient({ host: '127.0.0.1', port, autoReconnect: true });
        const failed = waitFor(bad, (s) => s === 'error');
        bad.start();
        const res = await failed;
        assert.match(res.detail, /not trusted|certificate/i);
        await new Promise((r) => setTimeout(r, 200));
        assert.strictEqual(requests, before, 'request must not reach the app handler without trust');
        console.log('ok - untrusted certificate rejected');

        // 3. Wrong host name in certificate
        const wrongName = new JournalStreamClient({
            host: '127.0.0.1', port, caCertPath: certPath, tlsServerName: 'other.example', autoReconnect: false
        });
        const mismatch = waitFor(wrongName, (s) => s === 'error');
        wrongName.start();
        assert.match((await mismatch).detail, /host name/i);
        console.log('ok - host name mismatch rejected');

        // 4. Reconnect after server drops the stream
        let hits = 0;
        const flaky = https.createServer({ key, cert }, (req, res) => {
            hits++;
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            res.write(`data:hit ${hits}\n\n`);
            if (hits === 1) { res.end(); }
        });
        await new Promise((r) => flaky.listen(0, '127.0.0.1', r));
        const got = [];
        const rc = new JournalStreamClient({
            host: '127.0.0.1', port: flaky.address().port, caCertPath: certPath, autoReconnect: true
        });
        rc.on('line', (l) => got.push(l));
        rc.start();
        await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('no reconnect')), 6000);
            rc.on('line', () => { if (got.length >= 2) { clearTimeout(t); resolve(); } });
        });
        rc.stop();
        assert.deepStrictEqual(got, ['hit 1', 'hit 2']);
        console.log('ok - reconnects after drop');

        // 5. Input validation
        assert.throws(() => new JournalStreamClient({ host: 'a b;rm', port: 1 }), /host/);
        assert.throws(() => new JournalStreamClient({ host: 'localhost', port: 0 }), /port/);
        console.log('ok - input validation');

        flaky.close();
        server.closeAllConnections();
        server.close();
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

(async () => {
    testParser();
    await testEndToEnd();
    console.log('all tests passed');
    process.exit(0);
})().catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
});
