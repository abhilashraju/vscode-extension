# Box Explorer

IDE extension (same style as Gerrit Review Viewer) for Box.com file access from the sidebar.

- Browse folders with breadcrumbs, search, load more
- Click a file to open it in the editor; Save to download; Web to open in the browser
- Upload the active editor file to the current folder (offers a new version on name conflict)

## Authentication

Two options:

1. **Client credentials (recommended, auto-renewing).** Run **Box: Set Client Credentials** (or click **Client creds**) and enter the
   Client ID, Client Secret and Enterprise ID from the Box Developer Console > your app > Configuration > Credentials.
   Works for apps using Server Authentication (Client Credentials Grant). A Box admin must authorize the app first
   (Admin Console > Apps > Custom Apps Manager). The app acts as its service account, so it only sees content shared with that account.
   Env fallbacks: `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`, `BOX_ENTERPRISE_ID`.
2. **Access token.** Run **Box: Set Access Token** and paste a developer token (valid 60 minutes) or OAuth access token. Env fallback: `BOX_ACCESS_TOKEN`.

Secrets are kept in the IDE secret storage. **Box: Clear Credentials** removes all of them.

## Settings

- `boxExplorer.rootFolderId` (default `0`)
- `boxExplorer.pageSize` (default 100)
- `boxExplorer.maxDownloadMB` (default 50)

## Install

    ./install.sh      # copies to symlinks into ~/.bobide/extensions and registers it; reload the Bob window

## Tests

    npm run lint && npm test
