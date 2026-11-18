// @ts-check
'use strict';

const vscode = require('vscode');
const GerritWebviewProvider = require('./gerritWebviewProvider');
const { getWebviewContent } = require('./webviewHtml');
const GerritService = require('./gerritService');
const { ChangeDetailPanel } = require('./changeDetailPanel');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const provider = new GerritWebviewProvider(context);

    // Register Webview View in the Sidebar / Activity bar
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('gerritViewer.sidebarView', provider)
    );

    // Refresh command
    context.subscriptions.push(
        vscode.commands.registerCommand('gerritViewer.refresh', () => {
            provider.refresh();
        })
    );

    // Set Credentials command
    context.subscriptions.push(
        vscode.commands.registerCommand('gerritViewer.setCredentials', async () => {
            await provider.promptSetCredentials();
        })
    );

    // Clear Credentials command
    context.subscriptions.push(
        vscode.commands.registerCommand('gerritViewer.clearCredentials', async () => {
            await provider.clearCredentials();
        })
    );

    // Open Full Dashboard in Editor Tab
    context.subscriptions.push(
        vscode.commands.registerCommand('gerritViewer.openDashboard', async () => {
            const panel = vscode.window.createWebviewPanel(
                'gerritViewerDashboard',
                'Gerrit Reviews Dashboard',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [context.extensionUri]
                }
            );

            const config = vscode.workspace.getConfiguration('gerritViewer');
            const host = config.get('host', 'https://gerrit.openbmc.org');
            const defaultQuery = config.get('defaultQuery', 'owner:self');
            
            let username = await context.secrets.get('gerritUsername') || process.env.GERRIT_USER || '';
            let token = await context.secrets.get('gerritHttpPassword') || process.env.GERRIT_TOKEN || '';
            const gerritService = new GerritService(host, username, token);

            panel.webview.html = getWebviewContent(host, defaultQuery, gerritService.hasCredentials(), username);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'promptAuth': {
                        await provider.promptSetCredentials();
                        username = await context.secrets.get('gerritUsername') || '';
                        token = await context.secrets.get('gerritHttpPassword') || '';
                        gerritService.setCredentials(username, token);
                        panel.webview.html = getWebviewContent(host, defaultQuery, gerritService.hasCredentials(), username);
                        break;
                    }
                    case 'fetchChanges': {
                        try {
                            const limit = config.get('limit', 100);
                            const changes = await gerritService.fetchChanges(message.query, limit);
                            panel.webview.postMessage({ type: 'changesLoaded', changes });
                        } catch (err) {
                            panel.webview.postMessage({ type: 'error', error: err.message || String(err) });
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
                            ChangeDetailPanel.show(context, provider, message.number);
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
        })
    );
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
