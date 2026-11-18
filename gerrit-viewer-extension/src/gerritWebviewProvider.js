// @ts-check
'use strict';

const vscode = require('vscode');
const GerritService = require('./gerritService');
const { getWebviewContent } = require('./webviewHtml');
const { ChangeDetailPanel } = require('./changeDetailPanel');

/**
 * Webview View Provider for the sidebar view
 */
class GerritWebviewProvider {
    /**
     * @param {vscode.ExtensionContext} context
     */
    constructor(context) {
        this.context = context;
        const config = vscode.workspace.getConfiguration('gerritViewer');
        const host = config.get('host', 'https://gerrit.openbmc.org');
        this.gerritService = new GerritService(host);
        /** @type {vscode.WebviewView | undefined} */
        this._view = undefined;
    }

    /**
     * Load credentials from secret storage
     */
    async loadCredentials() {
        let username = await this.context.secrets.get('gerritUsername');
        let token = await this.context.secrets.get('gerritHttpPassword');

        // Fallback to process.env if available
        if (!username && process.env.GERRIT_USER) {
            username = process.env.GERRIT_USER;
        }
        if (!token && process.env.GERRIT_TOKEN) {
            token = process.env.GERRIT_TOKEN;
        }

        if (username && token) {
            this.gerritService.setCredentials(username, token);
        } else {
            this.gerritService.setCredentials('', '');
        }
    }

    /**
     * @param {vscode.WebviewView} webviewView
     * @param {vscode.WebviewViewResolveContext} _context
     * @param {vscode.CancellationToken} _token
     */
    async resolveWebviewView(webviewView, _context, _token) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        await this.loadCredentials();
        this.updateWebviewContent(webviewView.webview);
        this.setupMessageListener(webviewView.webview);
    }

    /**
     * @param {vscode.Webview} webview
     */
    updateWebviewContent(webview) {
        const config = vscode.workspace.getConfiguration('gerritViewer');
        const host = config.get('host', 'https://gerrit.openbmc.org');
        const defaultQuery = config.get('defaultQuery', 'owner:self');
        this.gerritService.setHost(host);
        const isAuth = this.gerritService.hasCredentials();
        const username = this.gerritService.username;
        webview.html = getWebviewContent(host, defaultQuery, isAuth, username);
    }

    /**
     * Prompt user to enter or change credentials
     */
    async promptSetCredentials() {
        const username = await vscode.window.showInputBox({
            prompt: 'Enter your Gerrit Username',
            placeHolder: 'e.g. abhilashraju',
            value: this.gerritService.username || ''
        });

        if (!username) {
            return;
        }

        const token = await vscode.window.showInputBox({
            prompt: 'Enter your Gerrit HTTP Password / Token (from Gerrit Settings -> HTTP Credentials)',
            placeHolder: 'HTTP Password / Access Token',
            password: true
        });

        if (!token) {
            return;
        }

        await this.context.secrets.store('gerritUsername', username);
        await this.context.secrets.store('gerritHttpPassword', token);
        this.gerritService.setCredentials(username, token);

        vscode.window.showInformationMessage(`Gerrit credentials saved for "${username}".`);
        this.refresh();
    }

    /**
     * Clear stored credentials
     */
    async clearCredentials() {
        await this.context.secrets.delete('gerritUsername');
        await this.context.secrets.delete('gerritHttpPassword');
        this.gerritService.setCredentials('', '');
        vscode.window.showInformationMessage('Gerrit credentials removed.');
        this.refresh();
    }

    /**
     * @param {vscode.Webview} webview
     */
    setupMessageListener(webview) {
        webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'promptAuth': {
                    if (this.gerritService.hasCredentials()) {
                        const action = await vscode.window.showQuickPick(
                            ['Update Credentials', 'Clear Credentials'],
                            { placeHolder: `Gerrit Authenticated as: ${this.gerritService.username}` }
                        );
                        if (action === 'Update Credentials') {
                            await this.promptSetCredentials();
                        } else if (action === 'Clear Credentials') {
                            await this.clearCredentials();
                        }
                    } else {
                        await this.promptSetCredentials();
                    }
                    break;
                }
                case 'fetchChanges': {
                    try {
                        const config = vscode.workspace.getConfiguration('gerritViewer');
                        const limit = config.get('limit', 100);
                        const changes = await this.gerritService.fetchChanges(message.query, limit);
                        webview.postMessage({ type: 'changesLoaded', changes });
                    } catch (err) {
                        webview.postMessage({ type: 'error', error: err.message || String(err) });
                    }
                    break;
                }
                case 'openUrl': {
                    if (typeof message.url === 'string' && /^https:\/\//i.test(message.url)) {
                        vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                    break;
                }
                case 'openDetail': {
                    if (Number.isInteger(message.number) && message.number > 0) {
                        ChangeDetailPanel.show(this.context, this, message.number);
                    }
                    break;
                }
                case 'copyClipboard': {
                    if (message.text) {
                        await vscode.env.clipboard.writeText(message.text);
                        vscode.window.showInformationMessage(message.message || 'Copied to clipboard');
                    }
                    break;
                }
            }
        });
    }

    /**
     * Refresh the sidebar webview
     */
    async refresh() {
        if (this._view) {
            await this.loadCredentials();
            this.updateWebviewContent(this._view.webview);
        }
    }
}

module.exports = GerritWebviewProvider;
