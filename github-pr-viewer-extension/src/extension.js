// @ts-check
'use strict';

const vscode = require('vscode');
const PrWebviewProvider = require('./prWebviewProvider');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const provider = new PrWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('githubPrViewer.sidebarView', provider),
        vscode.commands.registerCommand('githubPrViewer.refresh', () => provider.refresh()),
        vscode.commands.registerCommand('githubPrViewer.setToken', () => provider.promptSetToken()),
        vscode.commands.registerCommand('githubPrViewer.clearToken', () => provider.clearToken()),
        vscode.commands.registerCommand('githubPrViewer.openDashboard', async () => {
            const panel = vscode.window.createWebviewPanel(
                'githubPrViewerDashboard',
                'GitHub Pull Requests',
                vscode.ViewColumn.One,
                { enableScripts: true, retainContextWhenHidden: true }
            );
            await provider.attach(panel.webview);
            panel.onDidDispose(() => provider.webviews.delete(panel.webview));
        })
    );
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
