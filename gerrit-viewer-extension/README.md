# Gerrit Review Viewer for VS Code

An interactive, fast Gerrit review tracking extension for VS Code with live search, multi-factor filtering, review score badges, and direct navigation.

![Gerrit Review Viewer](media/icon.svg)

---

## 🚀 Features

- **⚡ Real-Time Live Search:** Filter changes instantly as you type across Subject, Change Number, Repository/Project, Branch, or Author.
- **🏷️ Status Filter Chips:** Toggle between `All`, `Open (NEW)`, `Merged`, and `Abandoned` changes with dynamic count badges.
- **📂 Project Dropdown Filter:** Dynamically lists repositories in the query (e.g. `openbmc/bmcweb`, `openbmc/docs`) with change counts.
- **🔢 Review Scores & Status:** Displays `Code-Review` (+1, +2, -1, -2) and `Verified` badges for each change.
- **📄 In-IDE Change Page:** Click a change title or **Open** to see it in an editor tab: commit message, votes, file list, per-file diffs (loaded when you expand a file), inline review comments with unresolved state, patchset-level comments and history. Works anonymously for public changes; set credentials for private ones.
- **📋 One-Click Actions:**
  - **Open in Gerrit:** Launches the change in your browser.
  - **Copy Link:** Copies the Gerrit URL to your clipboard.
  - **Copy Checkout:** Generates the exact `git fetch <url> refs/changes/... && git checkout FETCH_HEAD` command.
- **🗂️ Dual Views:**
  - **Activity Bar Sidebar:** Always accessible side panel.
  - **Full Editor Tab Dashboard:** Command `Gerrit: Open Full Dashboard Panel` for wide screen view.
- **🎨 Native VS Code Theme Integration:** Matches dark, light, and high-contrast editor themes out of the box.

---

## 🛠️ Configuration Settings

Configure these in VS Code Settings (`Cmd + ,` or `Ctrl + ,`):

| Setting | Default | Description |
| :--- | :--- | :--- |
| `gerritViewer.host` | `https://gerrit.openbmc.org` | Base URL of your Gerrit server |
| `gerritViewer.defaultQuery` | `owner:self` | Default query on startup (e.g. `owner:self`, `status:open`) |
| `gerritViewer.limit` | `100` | Maximum number of changes to fetch |

---

## 📦 How to Run / Test in VS Code

### Method 1: Extension Development Host (F5 Debugging)
1. Open this folder (`gerrit-viewer-extension`) in VS Code.
2. Press **`F5`** to launch a new VS Code window with the extension activated.
3. Look for the **Gerrit Reviews** icon in the Activity Bar on the left!

### Method 2: Install Locally as `.vsix`
To package into a `.vsix` file and install in any VS Code instance:
```bash
cd gerrit-viewer-extension
npx @vscode/vsce package
code --install-extension gerrit-review-viewer-1.0.0.vsix
```
