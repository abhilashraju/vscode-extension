// @ts-check
'use strict';

const vscode = require('vscode');
const crypto = require('crypto');

const VAULT_SECRET_KEY = 'bmcshell.credentials.vault';

/**
 * @typedef {Object} CredentialItem
 * @property {string} id
 * @property {string} label
 * @property {string} username
 * @property {string} password
 */

/**
 * @typedef {Object} CredentialSummary
 * @property {string} id
 * @property {string} label
 * @property {string} username
 */

class CredentialVault {
    /**
     * @param {vscode.SecretStorage} secretStorage
     */
    constructor(secretStorage) {
        this._secrets = secretStorage;
    }

    /**
     * @private
     * @returns {Promise<Record<string, CredentialItem>>}
     */
    async _loadVault() {
        const raw = await this._secrets.get(VAULT_SECRET_KEY);
        if (!raw) {
            return {};
        }
        try {
            const parsed = JSON.parse(raw);
            return typeof parsed === 'object' && parsed !== null ? parsed : {};
        } catch {
            return {};
        }
    }

    /**
     * @private
     * @param {Record<string, CredentialItem>} vault
     */
    async _saveVault(vault) {
        await this._secrets.store(VAULT_SECRET_KEY, JSON.stringify(vault));
    }

    /**
     * List all stored credentials without exposing passwords
     * @returns {Promise<CredentialSummary[]>}
     */
    async list() {
        const vault = await this._loadVault();
        return Object.values(vault).map(({ id, label, username }) => ({ id, label, username }));
    }

    /**
     * Get a specific credential including password
     * @param {string} id
     * @returns {Promise<CredentialItem | null>}
     */
    async get(id) {
        const vault = await this._loadVault();
        return vault[id] || null;
    }

    /**
     * Save or update a credential
     * @param {{ label: string, username: string, password: string, id?: string }} entry
     * @returns {Promise<string>} Saved credential ID
     */
    async save(entry) {
        if (!entry.label || typeof entry.label !== 'string' || !entry.label.trim()) {
            throw new Error('Label cannot be empty');
        }
        if (!entry.username || typeof entry.username !== 'string' || !entry.username.trim()) {
            throw new Error('Username cannot be empty');
        }
        if (typeof entry.password !== 'string' || entry.password.length === 0) {
            throw new Error('Password cannot be empty');
        }

        const vault = await this._loadVault();
        const id = entry.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
        vault[id] = {
            id,
            label: entry.label.trim(),
            username: entry.username.trim(),
            password: entry.password
        };
        await this._saveVault(vault);
        return id;
    }

    /**
     * Delete a credential by id
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async delete(id) {
        const vault = await this._loadVault();
        if (vault[id]) {
            delete vault[id];
            await this._saveVault(vault);
            return true;
        }
        return false;
    }

    /**
     * Clear all credentials from vault
     */
    async clear() {
        await this._secrets.delete(VAULT_SECRET_KEY);
    }
}

/**
 * Prompt user to create and store a credential
 * @param {CredentialVault} vault
 */
async function addCredentialPrompt(vault) {
    const label = await vscode.window.showInputBox({
        title: 'Store Credential: Step 1 of 3',
        prompt: 'Enter a profile name / label for this credential (e.g. "BMC Lab 1", "Admin Root")',
        placeHolder: 'BMC Server 1',
        validateInput: (text) => (!text || !text.trim() ? 'Label is required' : null)
    });
    if (!label) {
        return;
    }

    const username = await vscode.window.showInputBox({
        title: 'Store Credential: Step 2 of 3',
        prompt: `Enter the username for "${label.trim()}"`,
        placeHolder: 'root',
        validateInput: (text) => (!text || !text.trim() ? 'Username is required' : null)
    });
    if (!username) {
        return;
    }

    const password = await vscode.window.showInputBox({
        title: 'Store Credential: Step 3 of 3',
        prompt: `Enter the password for "${username.trim()}"`,
        password: true,
        placeHolder: '••••••••',
        validateInput: (text) => (text === undefined || text === '' ? 'Password is required' : null)
    });
    if (password === undefined) {
        return;
    }

    await vault.save({
        label: label.trim(),
        username: username.trim(),
        password
    });

    vscode.window.showInformationMessage(`Credential "${label.trim()}" saved securely.`);
}

/**
 * Show a quick pick selection box to pick a credential
 * @param {CredentialVault} vault
 * @param {string} placeHolder
 * @returns {Promise<CredentialSummary | undefined>}
 */
async function pickCredential(vault, placeHolder) {
    const list = await vault.list();
    if (list.length === 0) {
        const choice = await vscode.window.showWarningMessage(
            'No stored credentials found.',
            'Add Credential'
        );
        if (choice === 'Add Credential') {
            await addCredentialPrompt(vault);
        }
        return undefined;
    }

    const items = list.map((c) => ({
        label: `$(key) ${c.label}`,
        description: `User: ${c.username}`,
        credential: c
    }));

    const picked = await vscode.window.showQuickPick(items, {
        placeHolder,
        matchOnDescription: true
    });

    return picked ? picked.credential : undefined;
}

/**
 * Get active terminal or show warning
 * @returns {vscode.Terminal | undefined}
 */
function getActiveTerminal() {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
        vscode.window.showWarningMessage('No active terminal found to input credential.');
        return undefined;
    }
    return terminal;
}

/**
 * Input selected password into active terminal
 * @param {CredentialVault} vault
 */
async function insertPasswordToTerminal(vault) {
    const terminal = getActiveTerminal();
    if (!terminal) {
        return;
    }

    const cred = await pickCredential(vault, 'Select credential to insert password into terminal');
    if (!cred) {
        return;
    }

    const item = await vault.get(cred.id);
    if (!item) {
        vscode.window.showErrorMessage('Credential not found.');
        return;
    }

    terminal.sendText(item.password, true);
}

/**
 * Input selected username into active terminal
 * @param {CredentialVault} vault
 */
async function insertUsernameToTerminal(vault) {
    const terminal = getActiveTerminal();
    if (!terminal) {
        return;
    }

    const cred = await pickCredential(vault, 'Select credential to insert username into terminal');
    if (!cred) {
        return;
    }

    terminal.sendText(cred.username, true);
}

/**
 * Input selected username, password, or both into active terminal
 * @param {CredentialVault} vault
 */
async function insertCredentialToTerminal(vault) {
    const terminal = getActiveTerminal();
    if (!terminal) {
        return;
    }

    const cred = await pickCredential(vault, 'Select credential to insert into terminal');
    if (!cred) {
        return;
    }

    const action = await vscode.window.showQuickPick(
        [
            { label: '$(lock) Password Only', description: 'Send password + Enter to terminal', type: 'password' },
            { label: '$(account) Username Only', description: 'Send username + Enter to terminal', type: 'username' },
            { label: '$(symbol-key) Both (Username then Password)', description: 'Send username + Enter, then password + Enter', type: 'both' }
        ],
        { placeHolder: `Insert credential for "${cred.label}"` }
    );

    if (!action) {
        return;
    }

    const item = await vault.get(cred.id);
    if (!item) {
        vscode.window.showErrorMessage('Credential not found.');
        return;
    }

    if (action.type === 'username') {
        terminal.sendText(item.username, true);
    } else if (action.type === 'password') {
        terminal.sendText(item.password, true);
    } else if (action.type === 'both') {
        terminal.sendText(item.username, true);
        setTimeout(() => {
            terminal.sendText(item.password, true);
        }, 500);
    }
}

/**
 * Delete a credential
 * @param {CredentialVault} vault
 */
async function deleteCredentialPrompt(vault) {
    const cred = await pickCredential(vault, 'Select credential to delete');
    if (!cred) {
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete credential "${cred.label}" (${cred.username})?`,
        { modal: true },
        'Delete'
    );

    if (confirm === 'Delete') {
        await vault.delete(cred.id);
        vscode.window.showInformationMessage(`Credential "${cred.label}" deleted.`);
    }
}

module.exports = {
    CredentialVault,
    VAULT_SECRET_KEY,
    addCredentialPrompt,
    pickCredential,
    insertPasswordToTerminal,
    insertUsernameToTerminal,
    insertCredentialToTerminal,
    deleteCredentialPrompt
};
