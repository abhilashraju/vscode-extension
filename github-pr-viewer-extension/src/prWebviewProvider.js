// @ts-check
'use strict';

const crypto = require('crypto');
const vscode = require('vscode');
const GithubService = require('./githubService');
const { getWebviewContent } = require('./webviewHtml');
const { PrDetailPanel } = require('./prDetailPanel');

const TOKEN_KEY = 'githubPrViewerToken';

/**
 * Shared controller for the sidebar view and the full dashboard panel
 */
class PrWebviewProvider {
    /**
     * @param {vscode.ExtensionContext} context
     */
    constructor(context) {
        this.context = context;
        this.service = new GithubService();
        /** @type {Set<vscode.Webview>} */
        this.webviews = new Set();
    }

    /**
     * Reload settings and token into the service
     */
    async loadState() {
        const config = vscode.workspace.getConfiguration('githubPrViewer');
        this.service.setApiUrl(config.get('apiUrl', 'https://api.github.com'));
        this.service.setUsername(config.get('username', ''));
        const token = (await this.context.secrets.get(TOKEN_KEY)) || process.env.GITHUB_TOKEN || '';
        this.service.setToken(token);
    }

    /**
     * @param {vscode.WebviewView} webviewView
     */
    async resolveWebviewView(webviewView) {
        webviewView.webview.options = { enableScripts: true };
        await this.attach(webviewView.webview);
        webviewView.onDidDispose(() => this.webviews.delete(webviewView.webview));
    }

    /**
     * Render the page into a webview and wire its message handler
     * @param {vscode.Webview} webview
     */
    async attach(webview) {
        this.webviews.add(webview);
        await this.render(webview);
        webview.onDidReceiveMessage((message) => this.handleMessage(webview, message));
    }

    /**
     * @param {vscode.Webview} webview
     */
    async render(webview) {
        try {
            await this.loadState();
        } catch (err) {
            vscode.window.showErrorMessage(this.errorText(err));
        }
        const config = vscode.workspace.getConfiguration('githubPrViewer');
        webview.html = getWebviewContent({
            nonce: crypto.randomBytes(16).toString('base64'),
            cspSource: webview.cspSource,
            apiUrl: this.service.apiUrl,
            hasToken: this.service.hasToken(),
            defaults: {
                scope: config.get('defaultScope', 'author'),
                owner: config.get('defaultOwner', ''),
                repo: config.get('defaultRepo', '')
            }
        });
    }

    /**
     * @param {any} err
     * @returns {string}
     */
    errorText(err) {
        return err && err.message ? String(err.message) : 'Unexpected error';
    }

    async promptSetToken() {
        const token = await vscode.window.showInputBox({
            prompt: 'Enter a GitHub personal access token (stored in VS Code secret storage)',
            placeHolder: 'GitHub access token',
            password: true,
            ignoreFocusOut: true
        });
        if (!token) {
            return;
        }
        await this.context.secrets.store(TOKEN_KEY, token.trim());
        vscode.window.showInformationMessage('GitHub access token saved.');
        await this.refresh();
    }

    async clearToken() {
        await this.context.secrets.delete(TOKEN_KEY);
        vscode.window.showInformationMessage('GitHub access token removed.');
        await this.refresh();
    }

    /**
     * @param {vscode.Webview} webview
     * @param {any} message
     */
    async handleMessage(webview, message) {
        if (!message || typeof message.command !== 'string') {
            return;
        }
        switch (message.command) {
            case 'promptAuth': {
                if (this.service.hasToken()) {
                    const action = await vscode.window.showQuickPick(
                        ['Update Token', 'Clear Token'],
                        { placeHolder: 'GitHub access token is set' }
                    );
                    if (action === 'Update Token') {
                        await this.promptSetToken();
                    } else if (action === 'Clear Token') {
                        await this.clearToken();
                    }
                } else {
                    await this.promptSetToken();
                }
                break;
            }
            case 'fetchPullRequests': {
                try {
                    await this.loadState();
                    const config = vscode.workspace.getConfiguration('githubPrViewer');
                    const filters = message.filters || {};
                    const prs = await this.service.fetchPullRequests({
                        scope: String(filters.scope || ''),
                        owner: String(filters.owner || ''),
                        repo: String(filters.repo || '')
                    }, config.get('limit', 100));
                    webview.postMessage({ type: 'prsLoaded', prs });
                } catch (err) {
                    webview.postMessage({ type: 'error', error: this.errorText(err) });
                }
                break;
            }
            case 'openDetail': {
                const number = Number(message.number);
                if (typeof message.owner === 'string' && typeof message.repo === 'string' && Number.isInteger(number)) {
                    PrDetailPanel.show(this.context, this, message.owner, message.repo, number);
                }
                break;
            }
            case 'openUrl': {
                if (typeof message.url === 'string' && /^https:\/\//i.test(message.url)) {
                    vscode.env.openExternal(vscode.Uri.parse(message.url));
                }
                break;
            }
            case 'copyClipboard': {
                if (typeof message.text === 'string' && message.text) {
                    await vscode.env.clipboard.writeText(message.text);
                    vscode.window.showInformationMessage(
                        typeof message.message === 'string' ? message.message : 'Copied to clipboard'
                    );
                }
                break;
            }
        }
    }

    /**
     * Re-render all open webviews
     */
    async refresh() {
        for (const webview of this.webviews) {
            await this.render(webview);
        }
    }
}

module.exports = PrWebviewProvider;
