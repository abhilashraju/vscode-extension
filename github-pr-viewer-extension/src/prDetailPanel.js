// @ts-check
'use strict';

const crypto = require('crypto');
const vscode = require('vscode');
const { getPrDetailHtml } = require('./prDetailHtml');

/**
 * One editor tab per pull request, showing details and diffs inside the IDE
 */
class PrDetailPanel {
    /** @type {Map<string, PrDetailPanel>} */
    static open = new Map();

    /**
     * @param {vscode.ExtensionContext} context
     * @param {{loadState: () => Promise<void>, service: import('./githubService')}} provider
     * @param {string} owner
     * @param {string} repo
     * @param {number} number
     */
    static show(context, provider, owner, repo, number) {
        const key = `${owner}/${repo}#${number}`.toLowerCase();
        const existing = PrDetailPanel.open.get(key);
        if (existing && !existing.disposed) {
            existing.panel.reveal();
            return;
        }
        PrDetailPanel.open.set(key, new PrDetailPanel(context, provider, key, owner, repo, number));
    }

    /**
     * @param {vscode.ExtensionContext} context
     * @param {{loadState: () => Promise<void>, service: import('./githubService')}} provider
     * @param {string} key
     * @param {string} owner
     * @param {string} repo
     * @param {number} number
     */
    constructor(context, provider, key, owner, repo, number) {
        this.provider = provider;
        this.owner = owner;
        this.repo = repo;
        this.number = number;
        this.disposed = false;
        /** @type {string | undefined} */
        this.url = undefined;

        this.panel = vscode.window.createWebviewPanel(
            'githubPrDetail',
            `#${number} ${repo}`,
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true }
        );
        this.panel.webview.html = getPrDetailHtml({
            nonce: crypto.randomBytes(16).toString('base64'),
            cspSource: this.panel.webview.cspSource
        });

        this.panel.webview.onDidReceiveMessage((message) => {
            if (!message || typeof message.command !== 'string') {
                return;
            }
            if (message.command === 'ready' || message.command === 'refresh') {
                this.load();
            } else if (message.command === 'openUrl') {
                // Only open the link the API returned for this pull request
                if (this.url && message.url === this.url && /^https:\/\//i.test(this.url)) {
                    vscode.env.openExternal(vscode.Uri.parse(this.url));
                }
            }
        }, undefined, context.subscriptions);

        this.panel.onDidDispose(() => {
            this.disposed = true;
            PrDetailPanel.open.delete(key);
        }, undefined, context.subscriptions);
    }

    async load() {
        try {
            await this.provider.loadState();
            const pr = await this.provider.service.fetchPullRequestDetail(this.owner, this.repo, this.number);
            this.url = pr.url;
            this.post({ type: 'detail', pr });
            this.panel.title = `#${pr.number} ${this.repo}`;
        } catch (err) {
            this.post({ type: 'error', error: err instanceof Error ? err.message : 'Unexpected error' });
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

module.exports = { PrDetailPanel };
