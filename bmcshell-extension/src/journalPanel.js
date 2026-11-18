// @ts-check
'use strict';

const crypto = require('crypto');
const vscode = require('vscode');
const { JournalStreamClient } = require('./journalClient');
const { getJournalHtml } = require('./journalView');

const FLUSH_INTERVAL_MS = 100;
const MAX_QUEUED_LINES = 20000;
const PANE_COUNT = 2;

/**
 * @returns {{host: string, port: number, secondPort: number, caCertPath: string, tlsServerName: string, autoReconnect: boolean, maxLines: number}}
 */
function readJournalSettings() {
    const c = vscode.workspace.getConfiguration('bmcshellProfile');
    return {
        host: c.get('journal.host', '127.0.0.1'),
        port: c.get('port', 8443),
        secondPort: c.get('secondPort', 8444),
        caCertPath: c.get('journal.caCertPath', ''),
        tlsServerName: c.get('journal.tlsServerName', ''),
        autoReconnect: c.get('journal.autoReconnect', true),
        maxLines: c.get('journal.maxLines', 5000)
    };
}

/**
 * Editor-tab webview that streams the journal of two bmcshell servers
 * (bmcshellProfile.port and bmcshellProfile.secondPort) over SSE, one pane each
 */
class JournalPanel {
    /** @type {JournalPanel | undefined} */
    static current = undefined;

    /**
     * @param {vscode.ExtensionContext} context
     */
    static show(context) {
        if (JournalPanel.current && !JournalPanel.current.disposed) {
            JournalPanel.current.panel.reveal();
            return;
        }
        JournalPanel.current = new JournalPanel(context);
    }

    static disconnect() {
        if (JournalPanel.current) {
            for (let i = 0; i < PANE_COUNT; i++) {
                JournalPanel.current.stopClient(i);
            }
        }
    }

    /**
     * @param {vscode.ExtensionContext} context
     */
    constructor(context) {
        const settings = readJournalSettings();
        this.panel = vscode.window.createWebviewPanel(
            'bmcshellJournal',
            'bmcshell Journal',
            vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        this.panel.webview.html = getJournalHtml({
            nonce: crypto.randomBytes(16).toString('base64'),
            cspSource: this.panel.webview.cspSource,
            maxLines: settings.maxLines,
            targets: [`${settings.host}:${settings.port}`, `${settings.host}:${settings.secondPort}`]
        });

        /** @type {string[][]} */
        this.queues = [[], []];
        /** @type {(NodeJS.Timeout | undefined)[]} */
        this.flushTimers = [undefined, undefined];
        /** @type {(JournalStreamClient | undefined)[]} */
        this.clients = [undefined, undefined];
        this.disposed = false;

        this.panel.webview.onDidReceiveMessage((message) => {
            if (!message || typeof message.command !== 'string') {
                return;
            }
            if (message.command === 'ready') {
                for (let i = 0; i < PANE_COUNT; i++) {
                    this.postStatus(i, 'disconnected', '');
                }
                return;
            }
            const pane = message.pane;
            if (!Number.isInteger(pane) || pane < 0 || pane >= PANE_COUNT) {
                return;
            }
            if (message.command === 'connect') {
                this.startClient(pane);
            } else if (message.command === 'disconnect') {
                this.stopClient(pane);
            }
        }, undefined, context.subscriptions);

        this.panel.onDidDispose(() => {
            // Mark first: the webview can no longer receive messages
            this.disposed = true;
            JournalPanel.current = undefined;
            for (let i = 0; i < PANE_COUNT; i++) {
                const timer = this.flushTimers[i];
                if (timer) {
                    clearTimeout(timer);
                    this.flushTimers[i] = undefined;
                }
                this.queues[i] = [];
                this.stopClient(i);
            }
        }, undefined, context.subscriptions);
    }

    /**
     * @param {number} pane
     */
    startClient(pane) {
        this.stopClient(pane);
        try {
            const settings = readJournalSettings();
            const port = pane === 0 ? settings.port : settings.secondPort;
            const client = new JournalStreamClient({ ...settings, port });
            client.on('line', (line) => this.enqueue(pane, line));
            client.on('status', (state, detail) => this.postStatus(pane, state, detail));
            this.clients[pane] = client;
            client.start();
        } catch (err) {
            this.postStatus(pane, 'error', err instanceof Error ? err.message : 'Unable to start journal stream.');
        }
    }

    /**
     * @param {number} pane
     */
    stopClient(pane) {
        const client = this.clients[pane];
        if (client) {
            client.removeAllListeners();
            client.stop();
            this.clients[pane] = undefined;
            this.postStatus(pane, 'disconnected', '');
        }
    }

    /**
     * @param {number} pane
     * @param {string} line
     */
    enqueue(pane, line) {
        const queue = this.queues[pane];
        if (queue.length >= MAX_QUEUED_LINES) {
            queue.shift();
        }
        queue.push(line);
        if (!this.flushTimers[pane]) {
            this.flushTimers[pane] = setTimeout(() => this.flush(pane), FLUSH_INTERVAL_MS);
        }
    }

    /**
     * @param {number} pane
     */
    flush(pane) {
        this.flushTimers[pane] = undefined;
        if (this.disposed || this.queues[pane].length === 0) {
            return;
        }
        const lines = this.queues[pane];
        this.queues[pane] = [];
        this.panel.webview.postMessage({ type: 'lines', pane, lines });
    }

    /**
     * @param {number} pane
     * @param {string} state
     * @param {string} detail
     */
    postStatus(pane, state, detail) {
        if (this.disposed) {
            return;
        }
        this.panel.webview.postMessage({ type: 'status', pane, state, detail });
    }
}

module.exports = { JournalPanel };
