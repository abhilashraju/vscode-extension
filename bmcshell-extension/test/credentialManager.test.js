'use strict';

// Run with: node test/credentialManager.test.js

const assert = require('assert');
const Module = require('module');

// Mock SecretStorage
class MockSecretStorage {
    constructor() {
        /** @type {Map<string, string>} */
        this.storeMap = new Map();
    }
    async get(key) {
        return this.storeMap.get(key);
    }
    async store(key, value) {
        this.storeMap.set(key, value);
    }
    async delete(key) {
        this.storeMap.delete(key);
    }
}

// Mock VSCode UI & Terminal
let mockActiveTerminal = null;
let mockInputAnswers = [];
let mockQuickPickAnswer = null;
let mockWarningAnswer = null;
let infoMessages = [];
let errorMessages = [];
let warningMessages = [];

const mockVscode = {
    window: {
        get activeTerminal() {
            return mockActiveTerminal;
        },
        async showInputBox(opts) {
            const next = mockInputAnswers.shift();
            return next;
        },
        async showQuickPick(items, opts) {
            if (typeof mockQuickPickAnswer === 'function') {
                return mockQuickPickAnswer(items, opts);
            }
            return mockQuickPickAnswer;
        },
        async showInformationMessage(msg) {
            infoMessages.push(msg);
            return undefined;
        },
        async showErrorMessage(msg) {
            errorMessages.push(msg);
            return undefined;
        },
        async showWarningMessage(msg, ...items) {
            warningMessages.push({ msg, items });
            return mockWarningAnswer;
        }
    }
};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
    return request === 'vscode' ? mockVscode : origLoad.call(this, request, ...rest);
};

const {
    CredentialVault,
    addCredentialPrompt,
    insertPasswordToTerminal,
    insertUsernameToTerminal,
    insertCredentialToTerminal,
    deleteCredentialPrompt
} = require('../src/credentialManager');

async function testVaultCrud() {
    const secrets = new MockSecretStorage();
    const vault = new CredentialVault(secrets);

    // Initial state
    assert.deepStrictEqual(await vault.list(), []);
    assert.strictEqual(await vault.get('non-existent'), null);

    // Validation
    await assert.rejects(() => vault.save({ label: '', username: 'root', password: '123' }), /Label/);
    await assert.rejects(() => vault.save({ label: 'BMC', username: '', password: '123' }), /Username/);
    await assert.rejects(() => vault.save({ label: 'BMC', username: 'root', password: '' }), /Password/);

    // Save
    const id1 = await vault.save({ label: 'BMC Lab 1', username: 'root', password: 'secretPassword1' });
    assert.ok(id1);

    const list1 = await vault.list();
    assert.strictEqual(list1.length, 1);
    assert.strictEqual(list1[0].label, 'BMC Lab 1');
    assert.strictEqual(list1[0].username, 'root');
    assert.strictEqual(list1[0].password, undefined); // password not exposed in list

    const item1 = await vault.get(id1);
    assert.ok(item1);
    assert.strictEqual(item1.label, 'BMC Lab 1');
    assert.strictEqual(item1.username, 'root');
    assert.strictEqual(item1.password, 'secretPassword1');

    // Update
    await vault.save({ id: id1, label: 'BMC Lab 1 Updated', username: 'admin', password: 'newPassword' });
    const updated = await vault.get(id1);
    assert.strictEqual(updated.label, 'BMC Lab 1 Updated');
    assert.strictEqual(updated.username, 'admin');
    assert.strictEqual(updated.password, 'newPassword');

    // Second item
    const id2 = await vault.save({ label: 'Production Server', username: 'service', password: 'svcPassword' });
    assert.strictEqual((await vault.list()).length, 2);

    // Delete
    const deleted = await vault.delete(id1);
    assert.strictEqual(deleted, true);
    assert.strictEqual((await vault.list()).length, 1);
    assert.strictEqual(await vault.get(id1), null);

    // Clear
    await vault.clear();
    assert.deepStrictEqual(await vault.list(), []);

    console.log('ok - CredentialVault CRUD operations');
}

async function testTerminalInteractions() {
    const secrets = new MockSecretStorage();
    const vault = new CredentialVault(secrets);

    const sent = [];
    mockActiveTerminal = {
        sendText(text, addNewLine) {
            sent.push({ text, addNewLine });
        }
    };

    // Save a test credential
    const id = await vault.save({ label: 'Lab BMC', username: 'root', password: 'testPassword123' });

    // 1. insertPasswordToTerminal
    mockQuickPickAnswer = { credential: { id, label: 'Lab BMC', username: 'root' } };
    await insertPasswordToTerminal(vault);
    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(sent[0], { text: 'testPassword123', addNewLine: true });

    // 2. insertUsernameToTerminal
    await insertUsernameToTerminal(vault);
    assert.strictEqual(sent.length, 2);
    assert.deepStrictEqual(sent[1], { text: 'root', addNewLine: true });

    // 3. insertCredentialToTerminal - Both
    mockQuickPickAnswer = (items, opts) => {
        if (opts && opts.placeHolder && opts.placeHolder.startsWith('Insert credential')) {
            return { label: 'Both', type: 'both' };
        }
        return { credential: { id, label: 'Lab BMC', username: 'root' } };
    };
    await insertCredentialToTerminal(vault);
    assert.strictEqual(sent.length, 3);
    assert.deepStrictEqual(sent[2], { text: 'root', addNewLine: true });
    // Wait for the timeout to send password
    await new Promise((r) => setTimeout(r, 600));
    assert.strictEqual(sent.length, 4);
    assert.deepStrictEqual(sent[3], { text: 'testPassword123', addNewLine: true });

    // 4. No active terminal
    mockActiveTerminal = null;
    warningMessages = [];
    await insertPasswordToTerminal(vault);
    assert.ok(warningMessages.some((w) => w.msg.includes('No active terminal')));

    console.log('ok - Terminal insertions and shortcuts');
}

async function testPrompts() {
    const secrets = new MockSecretStorage();
    const vault = new CredentialVault(secrets);

    // Add credential prompt
    mockInputAnswers = ['My Test BMC', 'admin', 'pass999'];
    await addCredentialPrompt(vault);
    const list = await vault.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].label, 'My Test BMC');
    assert.strictEqual(list[0].username, 'admin');
    const cred = await vault.get(list[0].id);
    assert.strictEqual(cred.password, 'pass999');

    // Delete credential prompt
    mockQuickPickAnswer = { credential: list[0] };
    mockWarningAnswer = 'Delete';
    await deleteCredentialPrompt(vault);
    assert.deepStrictEqual(await vault.list(), []);

    console.log('ok - Add & Delete prompts');
}

(async () => {
    await testVaultCrud();
    await testTerminalInteractions();
    await testPrompts();
    console.log('all credential manager tests passed');
    process.exit(0);
})().catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
});
