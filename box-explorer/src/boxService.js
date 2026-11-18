// @ts-check
'use strict';

const API = 'https://api.box.com/2.0';
const UPLOAD_API = 'https://upload.box.com/api/2.0';
const TOKEN_URL = 'https://api.box.com/oauth2/token';
const EXPIRY_MARGIN_MS = 60000;
const REQUEST_TIMEOUT_MS = 30000;
const TRANSFER_TIMEOUT_MS = 300000;
const ID_RE = /^\d{1,20}$/;
const FIELDS = 'id,type,name,size,modified_at,modified_by,parent';

/**
 * @param {unknown} id
 * @returns {string}
 */
function checkId(id) {
    const s = String(id);
    if (!ID_RE.test(s)) {
        throw new Error('Invalid Box item id.');
    }
    return s;
}

/**
 * Turn a Box file name into a safe local file name
 * @param {string} name
 * @returns {string}
 */
function safeFileName(name) {
    const cleaned = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim();
    return cleaned.slice(0, 200) || 'file';
}

/**
 * @param {number} n
 * @returns {number}
 */
function clampLimit(n) {
    const v = Math.floor(Number(n)) || 100;
    return Math.min(1000, Math.max(1, v));
}

/**
 * @param {any} e Box item entry
 * @returns {{id: string, type: string, name: string, size: number, modified: string, modifiedBy: string}}
 */
function toItem(e) {
    return {
        id: String(e.id),
        type: e.type === 'folder' ? 'folder' : 'file',
        name: String(e.name || ''),
        size: Number(e.size) || 0,
        modified: e.modified_at ? String(e.modified_at) : '',
        modifiedBy: e.modified_by ? String(e.modified_by.name || e.modified_by.login || '') : ''
    };
}

/**
 * @param {any} data Box list response
 */
function toPage(data) {
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const offset = Number(data.offset) || 0;
    return {
        items: entries.filter((/** @type {any} */ e) => e.type === 'file' || e.type === 'folder').map(toItem),
        total: Number(data.total_count) || 0,
        offset,
        nextOffset: offset + entries.length
    };
}

class BoxError extends Error {
    /**
     * @param {string} message
     * @param {number} status
     * @param {any} [body]
     */
    constructor(message, status, body) {
        super(message);
        this.status = status;
        this.body = body;
    }
}

/**
 * Minimal Box REST client. Authenticates with either a fixed bearer token
 * (developer / OAuth access token) or app client credentials (Client Credentials Grant),
 * in which case tokens are fetched and renewed automatically.
 */
class BoxService {
    /**
     * @param {string} [token]
     */
    constructor(token = '') {
        this.token = token;
        /** @type {{clientId: string, clientSecret: string, enterpriseId: string} | undefined} */
        this.creds = undefined;
        this.expiresAt = 0;
        /** @type {Promise<void> | undefined} */
        this.pendingToken = undefined;
    }

    /** @param {string} token */
    setToken(token) {
        this.token = token;
        this.expiresAt = 0;
    }

    /**
     * Use app client credentials; a no-op when unchanged so the cached token is kept
     * @param {string} clientId
     * @param {string} clientSecret
     * @param {string} enterpriseId
     */
    setClientCredentials(clientId, clientSecret, enterpriseId) {
        const same = this.creds && this.creds.clientId === clientId
            && this.creds.clientSecret === clientSecret && this.creds.enterpriseId === enterpriseId;
        if (same) {
            return;
        }
        if (clientId && clientSecret && enterpriseId) {
            this.creds = { clientId, clientSecret, enterpriseId };
        } else {
            this.creds = undefined;
        }
        this.token = '';
        this.expiresAt = 0;
    }

    /** @returns {boolean} true when a token or client credentials are available */
    hasToken() {
        return Boolean(this.token || this.creds);
    }

    /**
     * Fetch a new access token with the Client Credentials Grant
     * @returns {Promise<void>}
     */
    async fetchClientToken() {
        const creds = this.creds;
        if (!creds) {
            return;
        }
        const body = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: creds.clientId,
            client_secret: creds.clientSecret,
            box_subject_type: 'enterprise',
            box_subject_id: creds.enterpriseId
        });
        const response = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        /** @type {any} */
        let data;
        try {
            data = await response.json();
        } catch (_e) {
            data = undefined;
        }
        if (!response.ok || !data || !data.access_token) {
            const reason = data && data.error_description ? `: ${String(data.error_description).slice(0, 200)}` : '';
            throw new BoxError(
                `Box rejected the client credentials (HTTP ${response.status}${reason}). Check the Client ID, Client Secret and Enterprise ID, and that a Box admin has authorized the app.`,
                response.status);
        }
        this.token = String(data.access_token);
        this.expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    }

    /**
     * Make sure a usable token exists, renewing client-credential tokens near expiry
     * @param {boolean} [force]
     * @returns {Promise<void>}
     */
    async ensureAccessToken(force = false) {
        if (!this.creds) {
            return;
        }
        if (!force && this.token && Date.now() < this.expiresAt - EXPIRY_MARGIN_MS) {
            return;
        }
        if (!this.pendingToken) {
            this.pendingToken = this.fetchClientToken().finally(() => {
                this.pendingToken = undefined;
            });
        }
        await this.pendingToken;
    }

    /**
     * @param {string} url
     * @param {RequestInit} [init]
     * @param {number} [timeout]
     * @returns {Promise<Response>}
     */
    async request(url, init = {}, timeout = REQUEST_TIMEOUT_MS) {
        if (!this.hasToken()) {
            throw new BoxError('No Box credentials set. Use "Box: Set Access Token" or "Box: Set Client Credentials".', 401);
        }
        await this.ensureAccessToken();
        let response = await this.send(url, init, timeout);
        if (response.status === 401 && this.creds) {
            await this.ensureAccessToken(true);
            response = await this.send(url, init, timeout);
        }
        if (!response.ok) {
            /** @type {any} */
            let body;
            try {
                body = await response.json();
            } catch (_e) {
                body = undefined;
            }
            if (response.status === 401) {
                throw new BoxError('Authentication failed (HTTP 401). The access token is invalid or expired; developer tokens last 60 minutes.', 401, body);
            }
            if (response.status === 403) {
                throw new BoxError('Access denied (HTTP 403).', 403, body);
            }
            if (response.status === 404) {
                throw new BoxError('Not found (HTTP 404).', 404, body);
            }
            if (response.status === 429) {
                throw new BoxError('Rate limited by Box (HTTP 429). Try again shortly.', 429, body);
            }
            throw new BoxError(`Box request failed (HTTP ${response.status}${body && body.code ? `: ${body.code}` : ''}).`, response.status, body);
        }
        return response;
    }

    /**
     * @param {string} url
     * @param {RequestInit} init
     * @param {number} timeout
     * @returns {Promise<Response>}
     */
    send(url, init, timeout) {
        const headers = Object.assign({ Authorization: `Bearer ${this.token}` }, init.headers || {});
        return fetch(url, Object.assign({}, init, { headers, signal: AbortSignal.timeout(timeout) }));
    }

    /**
     * @param {string} path
     * @returns {Promise<any>}
     */
    async getJson(path) {
        const response = await this.request(`${API}${path}`, { headers: { Accept: 'application/json' } });
        return response.json();
    }

    /**
     * List one page of a folder
     * @param {string} folderId
     * @param {number} [limit]
     * @param {number} [offset]
     */
    async listFolder(folderId, limit = 100, offset = 0) {
        const id = checkId(folderId);
        const data = await this.getJson(
            `/folders/${id}/items?fields=${FIELDS}&limit=${clampLimit(limit)}&offset=${Math.max(0, Math.floor(offset))}&sort=name&direction=ASC`);
        return toPage(data);
    }

    /**
     * Name and ancestors of a folder, for breadcrumbs
     * @param {string} folderId
     * @returns {Promise<Array<{id: string, name: string}>>}
     */
    async folderPath(folderId) {
        const id = checkId(folderId);
        if (id === '0') {
            return [{ id: '0', name: 'All Files' }];
        }
        const data = await this.getJson(`/folders/${id}?fields=id,name,path_collection`);
        const parents = (data.path_collection && Array.isArray(data.path_collection.entries)) ? data.path_collection.entries : [];
        return parents.concat([data]).map((/** @type {any} */ p) => ({
            id: String(p.id),
            name: String(p.id) === '0' ? 'All Files' : String(p.name)
        }));
    }

    /**
     * Search files and folders
     * @param {string} query
     * @param {number} [limit]
     * @param {number} [offset]
     */
    async search(query, limit = 100, offset = 0) {
        const q = String(query || '').trim();
        if (!q) {
            throw new Error('Enter a search term.');
        }
        const data = await this.getJson(
            `/search?query=${encodeURIComponent(q)}&fields=${FIELDS}&limit=${clampLimit(limit)}&offset=${Math.max(0, Math.floor(offset))}`);
        return toPage(data);
    }

    /**
     * Name and size of a file
     * @param {string} fileId
     * @returns {Promise<{name: string, size: number}>}
     */
    async fileInfo(fileId) {
        const data = await this.getJson(`/files/${checkId(fileId)}?fields=id,name,size`);
        return { name: String(data.name || ''), size: Number(data.size) || 0 };
    }

    /**
     * Download file content
     * @param {string} fileId
     * @returns {Promise<Buffer>}
     */
    async downloadFile(fileId) {
        const response = await this.request(`${API}/files/${checkId(fileId)}/content`, {}, TRANSFER_TIMEOUT_MS);
        return Buffer.from(await response.arrayBuffer());
    }

    /**
     * Upload a new file, or a new version of an existing one
     * @param {string} folderId
     * @param {string} name
     * @param {Buffer} content
     * @param {string} [existingFileId] when set, uploads a new version of this file
     * @returns {Promise<any>} the uploaded file entry
     */
    async uploadFile(folderId, name, content, existingFileId) {
        const form = new FormData();
        if (existingFileId) {
            form.append('attributes', JSON.stringify({ name }));
        } else {
            form.append('attributes', JSON.stringify({ name, parent: { id: checkId(folderId) } }));
        }
        form.append('file', new Blob([content]), name);
        const url = existingFileId
            ? `${UPLOAD_API}/files/${checkId(existingFileId)}/content`
            : `${UPLOAD_API}/files/content`;
        const response = await this.request(url, { method: 'POST', body: form }, TRANSFER_TIMEOUT_MS);
        const data = await response.json();
        return data && Array.isArray(data.entries) ? data.entries[0] : data;
    }

    /**
     * Id of the existing file that caused an upload name conflict, or ''
     * @param {any} err
     * @returns {string}
     */
    static conflictFileId(err) {
        const conflicts = err && err.status === 409 && err.body && err.body.context_info && err.body.context_info.conflicts;
        if (!conflicts) {
            return '';
        }
        const first = Array.isArray(conflicts) ? conflicts[0] : conflicts;
        const id = first && first.id;
        return id && ID_RE.test(String(id)) ? String(id) : '';
    }
}

/**
 * @param {string} type
 * @param {string} id
 * @returns {string}
 */
function webUrl(type, id) {
    return `https://app.box.com/${type === 'folder' ? 'folder' : 'file'}/${checkId(id)}`;
}

module.exports = { BoxService, BoxError, safeFileName, webUrl, checkId };
