'use strict';

// Run with: node test/journalPanel.test.js
// Uses a mock `vscode` module whose webview throws after disposal, like the real one.

const assert = require('assert');
const Module = require('module');
const { EventEmitter } = require('events');

let panelCount = 0;
let lastPanel;

function createPanel() {
    panelCount++;
    const disposeHandlers = [];
    const panel = {
        disposed: false,
        revealed: 0,
        posted: [],
        reveal() {
            if (this.disposed) { throw new Error('Webview is disposed'); }
            this.revealed++;
        },
        onDidDispose(cb) { disposeHandlers.push(cb); },
        dispose() { this.disposed = true; disposeHandlers.forEach((cb) => cb()); },
        webview: {
            cspSource: 'mock',
            html: '',
            onDidReceiveMessage(cb) { panel.onMessage = cb; },
            postMessage(m) {
                if (panel.disposed) { throw new Error('Webview is disposed'); }
                panel.posted.push(m);
                return Promise.resolve(true);
            }
        }
    };
    lastPanel = panel;
    return panel;
}

const mockVscode = {
    window: { createWebviewPanel: createPanel },
    ViewColumn: { Beside: 2 },
    workspace: {
        getConfiguration: () => ({
            get: (key, def) => ({ 'journal.host': '127.0.0.1', port: 1, 'journal.autoReconnect': false }[key] ?? def)
        })
    }
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
    return request === 'vscode' ? mockVscode : origLoad.call(this, request, ...rest);
};

const { JournalPanel } = require('../src/journalPanel');
const ctx = { subscriptions: [] };

(async () => {
    // Close while a connection attempt is in flight and lines are queued
    JournalPanel.show(ctx);
    const first = lastPanel;
    first.onMessage({ command: 'connect', pane: 0 });
    first.onMessage({ command: 'connect', pane: 1 });
    JournalPanel.current.enqueue(0, 'queued line');
    JournalPanel.current.enqueue(1, 'queued line 2');
    first.dispose(); // must not throw
    assert.strictEqual(JournalPanel.current, undefined);
    await new Promise((r) => setTimeout(r, 300)); // pending flush/connect events must not throw either

    // Re-opening creates a fresh panel
    JournalPanel.show(ctx);
    assert.strictEqual(panelCount, 2);
    JournalPanel.show(ctx); // already open: just reveals
    assert.strictEqual(panelCount, 2);
    assert.strictEqual(lastPanel.revealed, 1);

    // A stale (disposed) instance left in `current` is replaced, not revealed
    JournalPanel.current.disposed = true;
    JournalPanel.show(ctx);
    assert.strictEqual(panelCount, 3);

    JournalPanel.disconnect();
    console.log('ok - closing the panel while connected does not throw; reopen works');
    process.exit(0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
