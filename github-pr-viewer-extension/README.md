# GitHub Pull Request Viewer for VS Code

Lists pull requests raised in GitHub, with owner and repository filters, live search, state chips and one-click actions. Modeled on `gerrit-viewer-extension`.

## Features

- **Owner / Repo filters (server side):** type an owner (user or org) and/or a repo (`bmcweb` or `openbmc/bmcweb`) and press Fetch/Enter. These become `user:`/`repo:` qualifiers in the GitHub search query.
- **Owner / Repo dropdowns (client side):** after a fetch, narrow the loaded results by owner and repo, with counts.
- **Scope:** created by me, assigned to me, review requested from me, involving me, or anyone (requires owner/repo).
- **State chips:** All / Open / Merged / Closed with counts.
- **Live search** across title, PR number, owner, repo and author; sort by updated, created or number.
- **In-IDE pull request page:** click a title or **Open** to see the description, status, reviewers, labels, every changed file with a line-numbered diff (lazy-rendered when you expand a file), inline review comments under their lines, and the conversation. GitHub refuses to be embedded in a frame (`X-Frame-Options: DENY`), so this page is built from the REST API instead of embedding github.com.
- **Actions:** Open (in the IDE), GitHub (in the system browser), Copy Link, Copy `gh pr checkout` command.
- **Views:** Activity Bar sidebar and a full editor dashboard (`GitHub PRs: Open Full Dashboard Panel`).

## Authentication

Run `GitHub PRs: Set Access Token`. The token is kept in VS Code secret storage (fallback: `GITHUB_TOKEN` environment variable). Use a token with `repo` scope (or fine-grained read access to pull requests) for private repositories. Without a token, only public data is available and `githubPrViewer.username` is needed for "my" scopes.

## Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `githubPrViewer.apiUrl` | `https://api.github.com` | GitHub REST API URL (`https://<host>/api/v3` for GHES) |
| `githubPrViewer.username` | `` | Login used for "my" scopes when no token is set |
| `githubPrViewer.defaultScope` | `author` | Initial scope |
| `githubPrViewer.defaultOwner` | `` | Initial owner filter |
| `githubPrViewer.defaultRepo` | `` | Initial repo filter |
| `githubPrViewer.limit` | `100` | Max pull requests fetched (GitHub search returns at most 1000) |

## Run / Install

- Open this folder in VS Code and press `F5`.
- Or package: `npx @vscode/vsce package` then `code --install-extension github-pr-viewer-1.0.0.vsix`.

## Pull request page limits

Up to 300 files and 300 comments/reviews per pull request; diffs are capped at 3,000 lines per file and 20,000 lines overall (the page says when something is shortened). Binary files and very large diffs have no patch from GitHub, so the page links to GitHub instead. Merging, approving and commenting are not supported here.

## Tests

`npm test` runs the diff parser, the API layer against a mock GitHub server, the page script in a minimal DOM (including HTML-injection checks), and the panel lifecycle.
