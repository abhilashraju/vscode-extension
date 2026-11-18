// @ts-check
'use strict';

const vscode = require('vscode');
const BoxWebviewProvider = require('./boxWebviewProvider');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const provider = new BoxWebviewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('boxExplorer.sidebarView', provider),
        vscode.commands.registerCommand('boxExplorer.refresh', () => provider.refresh()),
        vscode.commands.registerCommand('boxExplorer.setToken', () => provider.promptToken()),
        vscode.commands.registerCommand('boxExplorer.setClientCredentials', () => provider.promptClientCredentials()),
        vscode.commands.registerCommand('boxExplorer.clearToken', () => provider.clearToken()),
        vscode.commands.registerCommand('boxExplorer.uploadActiveFile', async () => {
            try {
                await provider.uploadActiveFile();
            } catch (err) {
                vscode.window.showErrorMessage(err instanceof Error ? err.message : String(err));
            }
        })
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
