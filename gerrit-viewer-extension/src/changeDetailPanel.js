// @ts-check
'use strict';

const crypto = require('crypto');
const vscode = require('vscode');
const { getChangeDetailHtml } = require('./changeDetailHtml');

/**
 * One editor tab per Gerrit change, showing details and diffs inside the IDE
 */
class ChangeDetailPanel {
    /** @type {Map<number, ChangeDetailPanel>} */
    static open = new Map();

    /**
     * @param {vscode.ExtensionContext} context
     * @param {{loadCredentials: () => Promise<void>, gerritService: import('./gerritService')}} provider
     * @param {number} number
     */
    static show(context, provider, number) {
        const existing = ChangeDetailPanel.open.get(number);
        if (existing && !existing.disposed) {
            existing.panel.reveal();
            return;
        }
        ChangeDetailPanel.open.set(number, new ChangeDetailPanel(context, provider, number));
    }

    /**
     * @param {vscode.ExtensionContext} context
     * @param {{loadCredentials: () => Promise<void>, gerritService: import('./gerritService')}} provider
     * @param {number} number
     */
    constructor(context, provider, number) {
        this.provider = provider;
        this.number = number;
        this.disposed = false;
        /** @type {string | undefined} */
        this.url = undefined;
        /** @type {string} */
        this.revision = '';
        /** @type {Set<string>} */
        this.paths = new Set();

        this.panel = vscode.window.createWebviewPanel(
            'gerritChangeDetail',
            `#${number}`,
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        this.panel.webview.html = getChangeDetailHtml({
            nonce: crypto.randomBytes(16).toString('base64'),
            cspSource: this.panel.webview.cspSource
        });

        this.panel.webview.onDidReceiveMessage((message) => this.onMessage(message), undefined, context.subscriptions);

        this.panel.onDidDispose(() => {
            this.disposed = true;
            ChangeDetailPanel.open.delete(number);
        }, undefined, context.subscriptions);
    }

    /**
     * @param {any} message
     */
    async onMessage(message) {
        if (!message || typeof message.command !== 'string') {
            return;
        }
        switch (message.command) {
            case 'ready':
            case 'refresh':
                await this.load();
                break;
            case 'openUrl':
                // Only open the link built from the loaded change
                if (this.url && message.url === this.url && /^https:\/\//i.test(this.url)) {
                    vscode.env.openExternal(vscode.Uri.parse(this.url));
                }
                break;
            case 'loadDiff':
                await this.loadDiff(message);
                break;
        }
    }

    async load() {
        try {
            await this.provider.loadCredentials();
            const change = await this.provider.gerritService.fetchChangeDetail(this.number);
            this.url = change.url;
            this.revision = change.revision;
            this.paths = new Set(change.files.map((/** @type {any} */ f) => f.path));
            this.post({ type: 'detail', change });
            if (!this.disposed) {
                this.panel.title = `#${change.number} ${change.project.split('/').pop()}`;
            }
        } catch (err) {
            this.post({ type: 'error', error: err instanceof Error ? err.message : 'Unexpected error' });
        }
    }

    /**
     * Only files and the revision of the loaded change can be requested
     * @param {any} message
     */
    async loadDiff(message) {
        const id = message.id;
        if (!Number.isInteger(id)) {
            return;
        }
        if (message.number !== this.number || message.revision !== this.revision || !this.paths.has(message.path)) {
            this.post({ type: 'diffError', id, error: 'That file is not part of the loaded change. Refresh and try again.' });
            return;
        }
        try {
            const result = await this.provider.gerritService.fetchFileDiff(this.number, this.revision, message.path);
            this.post({ type: 'diff', id, result });
        } catch (err) {
            this.post({ type: 'diffError', id, error: err instanceof Error ? err.message : 'Unexpected error' });
        }
    }

    /**
     * @param {any} message
     */
    post(message) {
        if (!this.disposed) {
            this.panel.webview.postMessage(message);
        }
    }
}

module.exports = { ChangeDetailPanel };
