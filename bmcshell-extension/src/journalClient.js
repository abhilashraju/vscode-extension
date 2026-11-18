// @ts-check
'use strict';

const https = require('https');
const fs = require('fs');
const { EventEmitter } = require('events');
const { StringDecoder } = require('string_decoder');

const MAX_PENDING_BYTES = 1024 * 1024;
const CONNECT_TIMEOUT_MS = 15000;
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const HOST_RE = /^[A-Za-z0-9._-]{1,253}$/;

/** TLS errors that will not fix themselves, so retrying is pointless */
const FATAL_TLS_CODES = new Set([
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'ERR_TLS_CERT_ALTNAME_INVALID'
]);

/**
 * Minimal Server-Sent Events parser (data fields only).
 */
class SseParser {
    /**
     * @param {(data: string) => void} onEvent
     */
    constructor(onEvent) {
        this.onEvent = onEvent;
        this.decoder = new StringDecoder('utf8');
        this.pending = '';
        /** @type {string[]} */
        this.data = [];
    }

    /**
     * @param {Buffer} chunk
     */
    push(chunk) {
        let text = this.pending + this.decoder.write(chunk);
        let held = '';
        // A trailing CR may be the first half of CRLF; wait for the next chunk
        if (text.endsWith('\r')) {
            held = '\r';
            text = text.slice(0, -1);
        }
        const parts = text.split(/\r\n|\n|\r/);
        this.pending = (parts.pop() || '') + held;
        if (this.pending.length > MAX_PENDING_BYTES) {
            this.pending = '';
            throw new Error('SSE line exceeds the maximum allowed size.');
        }
        for (const line of parts) {
            this.processLine(line);
        }
    }

    /**
     * @param {string} line
     */
    processLine(line) {
        if (line === '') {
            if (this.data.length > 0) {
                const payload = this.data.join('\n');
                this.data = [];
                this.onEvent(payload);
            }
            return;
        }
        if (line.startsWith(':')) {
            return; // comment / keep-alive
        }
        const idx = line.indexOf(':');
        const field = idx === -1 ? line : line.slice(0, idx);
        let value = idx === -1 ? '' : line.slice(idx + 1);
        if (value.startsWith(' ')) {
            value = value.slice(1);
        }
        if (field === 'data') {
            this.data.push(value);
        }
    }
}

/**
 * @param {any} err
 * @returns {string}
 */
function describeConnectionError(err) {
    const code = err && err.code;
    switch (code) {
        case 'CERT_HAS_EXPIRED':
            return 'The bmcshell server certificate has expired. Generate a new keystore (see README) and set bmcshellProfile.journal.caCertPath.';
        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
        case 'SELF_SIGNED_CERT_IN_CHAIN':
        case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
        case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
            return 'The bmcshell server certificate is not trusted. Set bmcshellProfile.journal.caCertPath to the CA certificate (PEM).';
        case 'ERR_TLS_CERT_ALTNAME_INVALID':
            return 'The server certificate does not match the host name. Set bmcshellProfile.journal.tlsServerName to the name in the certificate.';
        case 'ECONNREFUSED':
            return 'Connection refused. Is bmcshell running on this host and port?';
        case 'ETIMEDOUT':
            return 'Connection timed out.';
        default:
            return err && err.message ? String(err.message) : 'Connection failed.';
    }
}

/**
 * Streams journal lines from the bmcshell /sse/journal endpoint over TLS.
 * Events: 'line' (string), 'status' (state, detail)
 */
class JournalStreamClient extends EventEmitter {
    /**
     * @param {{host: string, port: number, caCertPath?: string, tlsServerName?: string, autoReconnect?: boolean}} options
     */
    constructor(options) {
        super();
        if (!HOST_RE.test(options.host)) {
            throw new Error('Invalid journal host name.');
        }
        if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
            throw new Error('Invalid journal port.');
        }
        this.options = options;
        /** @type {Buffer | undefined} */
        this.ca = undefined;
        if (options.caCertPath) {
            this.ca = fs.readFileSync(options.caCertPath);
        }
        this.stopped = true;
        this.backoff = MIN_BACKOFF_MS;
        /** @type {import('http').ClientRequest | undefined} */
        this.req = undefined;
        /** @type {NodeJS.Timeout | undefined} */
        this.retryTimer = undefined;
    }

    start() {
        if (!this.stopped) {
            return;
        }
        this.stopped = false;
        this.backoff = MIN_BACKOFF_MS;
        this.connect();
    }

    stop() {
        this.stopped = true;
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = undefined;
        }
        if (this.req) {
            this.req.destroy();
            this.req = undefined;
        }
        this.emit('status', 'disconnected', '');
    }

    connect() {
        this.emit('status', 'connecting', `${this.options.host}:${this.options.port}`);
        const parser = new SseParser((data) => this.emit('line', data));

        const req = https.request({
            host: this.options.host,
            port: this.options.port,
            path: '/sse/journal',
            method: 'GET',
            headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
            ca: this.ca,
            servername: this.options.tlsServerName || undefined,
            minVersion: 'TLSv1.2',
            rejectUnauthorized: false,
            timeout: CONNECT_TIMEOUT_MS
        });
        this.req = req;

        req.on('timeout', () => req.destroy(Object.assign(new Error('Connection timed out.'), { code: 'ETIMEDOUT' })));

        req.on('response', (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                this.fail(new Error(`Server returned HTTP ${res.statusCode}.`), false);
                return;
            }
            // The stream is idle by design; only the connect phase has a timeout
            req.setTimeout(0);
            this.backoff = MIN_BACKOFF_MS;
            this.emit('status', 'connected', `${this.options.host}:${this.options.port}`);
            res.on('data', (chunk) => {
                try {
                    parser.push(chunk);
                } catch (err) {
                    req.destroy(/** @type {Error} */ (err));
                }
            });
            res.on('end', () => this.fail(new Error('Stream closed by server.'), false));
            res.on('error', (err) => this.fail(err, false));
        });

        req.on('error', (err) => this.fail(err, FATAL_TLS_CODES.has(/** @type {any} */ (err).code)));
        req.end();
    }

    /**
     * @param {any} err
     * @param {boolean} fatal
     */
    fail(err, fatal) {
        if (this.stopped || this.req === undefined) {
            return;
        }
        this.req = undefined;
        const message = describeConnectionError(err);
        if (fatal || !this.options.autoReconnect) {
            this.stopped = true;
            this.emit('status', 'error', message);
            return;
        }
        this.emit('status', 'reconnecting', `${message} Retrying in ${Math.round(this.backoff / 1000)}s...`);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            if (!this.stopped) {
                this.connect();
            }
        }, this.backoff);
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    }
}

module.exports = { JournalStreamClient, SseParser, describeConnectionError };
