// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { buildLaunch } = require('./launcher');
const { JournalPanel } = require('./journalPanel');
const {
    CredentialVault,
    addCredentialPrompt,
    insertPasswordToTerminal,
    insertUsernameToTerminal,
    insertCredentialToTerminal,
    deleteCredentialPrompt
} = require('./credentialManager');

/** Jar shipped inside the extension (bin/bmcshell.jar); undefined when absent */
function bundledJar() {
    const jar = path.join(__dirname, '..', 'bin', 'bmcshell.jar');
    return fs.existsSync(jar) ? jar : undefined;
}

/**
 * @returns {import('./launcher').Settings}
 */
function readSettings() {
    const c = vscode.workspace.getConfiguration('bmcshellProfile');
    return {
        mode: c.get('mode', 'jar'),
        jarPath: c.get('jarPath', ''),
        bundledJarPath: bundledJar(),
        javaPath: c.get('javaPath', 'java'),
        jvmArgs: c.get('jvmArgs', []),
        port: c.get('port', 8443),
        workingDirectory: c.get('workingDirectory', ''),
        dockerImage: c.get('dockerImage', 'bmcshell:latest')
    };
}

/**
 * Let the user pick the jar and store it in user settings
 * @returns {Promise<boolean>} true when a jar was selected
 */
async function selectJar() {
    const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFiles: true,
        canSelectFolders: false,
        filters: { 'Java archive': ['jar'] },
        openLabel: 'Select bmcshell jar'
    });
    if (!picked || picked.length === 0) {
        return false;
    }
    await vscode.workspace.getConfiguration('bmcshellProfile')
        .update('jarPath', picked[0].fsPath, vscode.ConfigurationTarget.Global);
    return true;
}

/**
 * Compute terminal options, offering to pick the jar when it is missing
 * @param {number} [port] overrides bmcshellProfile.port and adds the port to the terminal name
 * @returns {Promise<vscode.TerminalOptions | undefined>}
 */
async function resolveTerminalOptions(port) {
    let settings = readSettings();
    if (settings.mode === 'jar' && !settings.jarPath && !settings.bundledJarPath) {
        if (!(await selectJar())) {
            return undefined;
        }
        settings = readSettings();
    }
    if (port !== undefined) {
        settings = { ...settings, port };
    }
    try {
        const launch = buildLaunch(settings);
        return {
            name: port !== undefined ? `${launch.name} :${port}` : launch.name,
            shellPath: launch.shellPath,
            shellArgs: launch.shellArgs,
            cwd: launch.cwd,
            iconPath: new vscode.ThemeIcon('terminal')
        };
    } catch (err) {
        vscode.window.showErrorMessage(err instanceof Error ? err.message : 'Unable to launch bmcshell.');
        return undefined;
    }
}

/**
 * Open two bmcshell terminals side by side, on port and secondPort
 */
async function openSplitTerminals() {
    const port = readSettings().port;
    const secondPort = vscode.workspace.getConfiguration('bmcshellProfile').get('secondPort', 8444);
    if (port === secondPort) {
        vscode.window.showErrorMessage('bmcshellProfile.secondPort must differ from bmcshellProfile.port.');
        return;
    }
    const firstOptions = await resolveTerminalOptions(port);
    if (!firstOptions) {
        return;
    }
    const secondOptions = await resolveTerminalOptions(secondPort);
    if (!secondOptions) {
        return;
    }
    const first = vscode.window.createTerminal(firstOptions);
    first.show();
    vscode.window.createTerminal({ ...secondOptions, location: { parentTerminal: first } }).show();
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    const vault = new CredentialVault(context.secrets);

    context.subscriptions.push(
        vscode.window.registerTerminalProfileProvider('bmcshellProfile.terminalProfile', {
            async provideTerminalProfile() {
                const options = await resolveTerminalOptions();
                return options ? new vscode.TerminalProfile(options) : undefined;
            }
        }),
        vscode.commands.registerCommand('bmcshellProfile.openTerminal', async () => {
            const options = await resolveTerminalOptions();
            if (options) {
                vscode.window.createTerminal(options).show();
            }
        }),
        vscode.commands.registerCommand('bmcshellProfile.openSplitTerminals', () => openSplitTerminals()),
        vscode.commands.registerCommand('bmcshellProfile.selectJar', async () => {
            if (await selectJar()) {
                vscode.window.showInformationMessage('bmcshell jar path saved.');
            }
        }),
        vscode.commands.registerCommand('bmcshellProfile.openJournal', () => JournalPanel.show(context)),
        vscode.commands.registerCommand('bmcshellProfile.disconnectJournal', () => JournalPanel.disconnect()),
        vscode.commands.registerCommand('bmcshellProfile.addCredential', () => addCredentialPrompt(vault)),
        vscode.commands.registerCommand('bmcshellProfile.insertPassword', () => insertPasswordToTerminal(vault)),
        vscode.commands.registerCommand('bmcshellProfile.insertUsername', () => insertUsernameToTerminal(vault)),
        vscode.commands.registerCommand('bmcshellProfile.insertCredential', () => insertCredentialToTerminal(vault)),
        vscode.commands.registerCommand('bmcshellProfile.deleteCredential', () => deleteCredentialPrompt(vault))
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
