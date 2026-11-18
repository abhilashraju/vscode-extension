// @ts-check
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { BoxService, safeFileName, webUrl, checkId } = require('./boxService');
const { getWebviewContent } = require('./webviewHtml');

const SECRET_KEY = 'boxAccessToken';
const SECRET_CLIENT_ID = 'boxClientId';
const SECRET_CLIENT_SECRET = 'boxClientSecret';
const SECRET_ENTERPRISE_ID = 'boxEnterpriseId';

/**
 * Sidebar webview for browsing Box
 */
class BoxWebviewProvider {
    /**
     * @param {vscode.ExtensionContext} context
     */
    constructor(context) {
        this.context = context;
        this.box = new BoxService();
        /** @type {vscode.WebviewView | undefined} */
        this._view = undefined;
        this.folderId = this.rootId();
        this.query = '';
    }

    /** @returns {vscode.WorkspaceConfiguration} */
    config() {
        return vscode.workspace.getConfiguration('boxExplorer');
    }

    /** @returns {string} */
    rootId() {
        const id = String(this.config().get('rootFolderId', '0')).trim();
        return /^\d{1,20}$/.test(id) ? id : '0';
    }

    /** @returns {number} */
    pageSize() {
        return Number(this.config().get('pageSize', 100)) || 100;
    }

    /** @returns {number} */
    maxBytes() {
        return (Number(this.config().get('maxDownloadMB', 50)) || 50) * 1024 * 1024;
    }

    /**
     * Prefer client credentials (auto-renewing) when all three are set, else a pasted access token
     */
    async loadToken() {
        const secrets = this.context.secrets;
        const clientId = (await secrets.get(SECRET_CLIENT_ID)) || process.env.BOX_CLIENT_ID || '';
        const clientSecret = (await secrets.get(SECRET_CLIENT_SECRET)) || process.env.BOX_CLIENT_SECRET || '';
        const enterpriseId = (await secrets.get(SECRET_ENTERPRISE_ID)) || process.env.BOX_ENTERPRISE_ID || '';
        this.box.setClientCredentials(clientId, clientSecret, enterpriseId);
        if (!this.box.creds) {
            this.box.setToken((await secrets.get(SECRET_KEY)) || process.env.BOX_ACCESS_TOKEN || '');
        }
    }

    /**
     * @param {vscode.WebviewView} webviewView
     */
    async resolveWebviewView(webviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
        webviewView.webview.html = getWebviewContent({
            nonce: crypto.randomBytes(16).toString('base64'),
            cspSource: webviewView.webview.cspSource
        });
        webviewView.webview.onDidReceiveMessage((m) => this.onMessage(m), undefined, this.context.subscriptions);
    }

    /** @param {any} message */
    post(message) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    /**
     * @param {any} message
     */
    async onMessage(message) {
        try {
            switch (message.command) {
                case 'ready':
                    await this.refresh();
                    break;
                case 'openFolder':
                    this.query = '';
                    this.folderId = message.id ? checkId(message.id) : this.rootId();
                    await this.showFolder(0);
                    break;
                case 'search':
                    this.query = String(message.query || '');
                    await this.showSearch(0);
                    break;
                case 'more':
                    if (this.query) {
                        await this.showSearch(Number(message.offset) || 0);
                    } else {
                        await this.showFolder(Number(message.offset) || 0);
                    }
                    break;
                case 'openFile':
                    await this.openFile(checkId(message.id));
                    break;
                case 'downloadFile':
                    await this.downloadFile(checkId(message.id));
                    break;
                case 'openWeb':
                    vscode.env.openExternal(vscode.Uri.parse(webUrl(message.type, message.id)));
                    break;
                case 'upload':
                    await this.uploadActiveFile();
                    break;
                case 'token':
                    await this.promptToken();
                    break;
                case 'credentials':
                    await this.promptClientCredentials();
                    break;
            }
        } catch (err) {
            this.post({ type: 'error', error: err instanceof Error ? err.message : String(err) });
        }
    }

    /**
     * @returns {Promise<boolean>} true when a token is available
     */
    async ensureToken() {
        await this.loadToken();
        if (!this.box.hasToken()) {
            this.post({ type: 'needToken' });
            return false;
        }
        return true;
    }

    async refresh() {
        if (!(await this.ensureToken())) {
            return;
        }
        if (this.query) {
            await this.showSearch(0);
        } else {
            await this.showFolder(0);
        }
    }

    /**
     * @param {number} offset
     */
    async showFolder(offset) {
        if (!(await this.ensureToken())) {
            return;
        }
        this.post({ type: 'loading' });
        const [page, trail] = await Promise.all([
            this.box.listFolder(this.folderId, this.pageSize(), offset),
            offset === 0 ? this.box.folderPath(this.folderId) : Promise.resolve(undefined)
        ]);
        this.post({ type: 'page', mode: 'folder', append: offset > 0, path: trail, ...page });
    }

    /**
     * @param {number} offset
     */
    async showSearch(offset) {
        if (!(await this.ensureToken())) {
            return;
        }
        this.post({ type: 'loading' });
        const page = await this.box.search(this.query, this.pageSize(), offset);
        this.post({ type: 'page', mode: 'search', append: offset > 0, ...page });
    }

    /**
     * @param {string} fileId
     * @returns {Promise<{name: string, data: Buffer}>}
     */
    async fetchFile(fileId) {
        const info = await this.box.fileInfo(fileId);
        if (info.size > this.maxBytes()) {
            throw new Error(`File is ${(info.size / 1048576).toFixed(1)} MB, above the ${this.maxBytes() / 1048576} MB limit (boxExplorer.maxDownloadMB).`);
        }
        return { name: safeFileName(info.name), data: await this.box.downloadFile(fileId) };
    }

    /**
     * @param {string} fileId
     */
    async openFile(fileId) {
        this.post({ type: 'info', text: 'Downloading...' });
        const { name, data } = await this.fetchFile(fileId);
        const dir = path.join(os.tmpdir(), 'box-explorer', fileId);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const target = path.join(dir, name);
        fs.writeFileSync(target, data, { mode: 0o600 });
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(target));
        this.post({ type: 'info', text: '' });
    }

    /**
     * @param {string} fileId
     */
    async downloadFile(fileId) {
        const info = await this.box.fileInfo(fileId);
        const folders = vscode.workspace.workspaceFolders;
        const defaultDir = folders && folders.length ? folders[0].uri.fsPath : os.homedir();
        const dest = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(path.join(defaultDir, safeFileName(info.name)))
        });
        if (!dest) {
            return;
        }
        this.post({ type: 'info', text: 'Downloading...' });
        const { data } = await this.fetchFile(fileId);
        await vscode.workspace.fs.writeFile(dest, data);
        this.post({ type: 'info', text: '' });
        vscode.window.showInformationMessage(`Saved ${path.basename(dest.fsPath)}`);
    }

    async uploadActiveFile() {
        if (!(await this.ensureToken())) {
            return;
        }
        if (this.query) {
            throw new Error('Open a folder first; uploads go to the current folder.');
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.scheme !== 'file') {
            throw new Error('Open a saved file in the editor to upload it.');
        }
        if (editor.document.isDirty) {
            await editor.document.save();
        }
        const filePath = editor.document.uri.fsPath;
        const name = path.basename(filePath);
        const content = fs.readFileSync(filePath);
        this.post({ type: 'info', text: `Uploading ${name}...` });
        try {
            await this.box.uploadFile(this.folderId, name, content);
        } catch (err) {
            const existing = BoxService.conflictFileId(err);
            if (!existing) {
                throw err;
            }
            const choice = await vscode.window.showWarningMessage(
                `"${name}" already exists in this Box folder. Upload as a new version?`, { modal: true }, 'Upload new version');
            if (choice !== 'Upload new version') {
                this.post({ type: 'info', text: '' });
                return;
            }
            await this.box.uploadFile(this.folderId, name, content, existing);
        }
        vscode.window.showInformationMessage(`Uploaded ${name} to Box.`);
        await this.showFolder(0);
    }

    async promptToken() {
        const token = await vscode.window.showInputBox({
            prompt: 'Enter your Box access token (Box Developer Console > Configuration > Developer Token, valid 60 minutes, or an OAuth access token)',
            placeHolder: 'Box access token',
            password: true,
            ignoreFocusOut: true
        });
        if (!token || !token.trim()) {
            return;
        }
        await this.context.secrets.store(SECRET_KEY, token.trim());
        vscode.window.showInformationMessage('Box access token saved.');
        await this.refresh();
    }

    async promptClientCredentials() {
        const clientId = await vscode.window.showInputBox({
            prompt: 'Box app Client ID (Developer Console > your app > Configuration > Credentials)',
            ignoreFocusOut: true
        });
        if (!clientId || !clientId.trim()) {
            return;
        }
        const clientSecret = await vscode.window.showInputBox({
            prompt: 'Box app Client Secret',
            password: true,
            ignoreFocusOut: true
        });
        if (!clientSecret || !clientSecret.trim()) {
            return;
        }
        const enterpriseId = await vscode.window.showInputBox({
            prompt: 'Box Enterprise ID (shown under Credentials)',
            ignoreFocusOut: true,
            validateInput: (v) => (/^\d{1,20}$/.test(v.trim()) ? undefined : 'Enterprise ID is a number')
        });
        if (!enterpriseId || !enterpriseId.trim()) {
            return;
        }
        const secrets = this.context.secrets;
        await secrets.store(SECRET_CLIENT_ID, clientId.trim());
        await secrets.store(SECRET_CLIENT_SECRET, clientSecret.trim());
        await secrets.store(SECRET_ENTERPRISE_ID, enterpriseId.trim());
        vscode.window.showInformationMessage('Box client credentials saved.');
        await this.refresh();
    }

    async clearToken() {
        const secrets = this.context.secrets;
        for (const key of [SECRET_KEY, SECRET_CLIENT_ID, SECRET_CLIENT_SECRET, SECRET_ENTERPRISE_ID]) {
            await secrets.delete(key);
        }
        this.box.setToken('');
        this.box.setClientCredentials('', '', '');
        vscode.window.showInformationMessage('Box credentials removed.');
        await this.refresh();
    }
}

module.exports = BoxWebviewProvider;
