# bmcshell Terminal

Opens the bmcshell (Spring Shell, Java 21) application in an IDE terminal.

## Usage

- Terminal dropdown (`+ v`) → **bmcshell**, or
- Command Palette → **bmcshell Profile: Open Terminal**.

The extension bundles the bmcshell jar (`bin/bmcshell.jar`) and uses it by default. To use a different build, run `bmcshell Profile: Select Jar File`; the choice is saved to `bmcshellProfile.jarPath` and overrides the bundled jar.

## Modes

- `jar` (default): runs `java [jvmArgs] -Dserver.port=<port> -jar <jarPath>` in the working directory (default `~/.bmcshell`, created if missing). Requires Java 21+.
- `docker`: runs the image like `bmcshell.sh` (mounts `$HOME`, `~/.ssh`, the `bmcshellhome` volume, host network).

## Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `bmcshellProfile.mode` | `jar` | `jar` or `docker` |
| `bmcshellProfile.jarPath` | `` | Custom bmcshell jar; empty uses the bundled `bin/bmcshell.jar` |
| `bmcshellProfile.javaPath` | `java` | Java executable |
| `bmcshellProfile.jvmArgs` | `[]` | Extra JVM args, one per entry |
| `bmcshellProfile.port` | `8443` | Embedded server port |
| `bmcshellProfile.secondPort` | `8444` | Second embedded server port (split terminals, second journal pane) |
| `bmcshellProfile.workingDirectory` | `` | Working dir (empty = `~/.bmcshell`) |
| `bmcshellProfile.dockerImage` | `bmcshell:latest` | Image for docker mode |

Arguments are passed to the process as an array, not through a shell string.

## Journal stream viewer

**bmcshell Profile: Open Journal Stream** opens an editor tab that connects to the running bmcshell server's `/sse/journal` endpoint (`https://<bmcshellProfile.journal.host>:<bmcshellProfile.port>`) and shows lines live. The tab has two side-by-side panes, one per server: `bmcshellProfile.port` (8443) on the left and `bmcshellProfile.secondPort` (8444) on the right. Each pane has its own Connect/Pause/Clear/filter controls.

**bmcshell Profile: Open Two Terminals (Split, ports 8443 + 8444)** starts two bmcshell terminals side by side, one on each port. Both servers use the same TLS keystore, so one certificate must be valid for both.

Viewer features: Connect/Disconnect, Pause/Resume (lines keep buffering), Clear, live filter (space-separated terms, any match; `*` wildcards are ignored), level filter (all / warnings+errors / errors), auto-scroll, line cap (`bmcshellProfile.journal.maxLines`), automatic reconnect with backoff.

Feed it from the bmcshell terminal (same instance, same port):

```
machine <name>
journal.start bmcweb      # or: journal.subscribe
```

SSE broadcasting is on by default. `journal.filter *error* *warn*` filters on the server side for all clients; `journal.ws.status` shows connected clients.

### TLS

Certificate verification is always on and cannot be disabled. The server uses the keystore from its `application.properties`; the one bundled in the jar **expired on 2025-06-11**, so the stream is refused until you provide a valid one:

```bash
scripts/make-dev-cert.sh                      # writes ~/.bmcshell/tls/{keystore.p12,server-cert.pem}
```

Then set:

- `bmcshellProfile.jvmArgs`: `["-Dserver.ssl.key-store=file:/Users/<you>/.bmcshell/tls/keystore.p12"]`
- `bmcshellProfile.journal.caCertPath`: `/Users/<you>/.bmcshell/tls/server-cert.pem`

If you use another certificate whose name differs from `journal.host`, set `bmcshellProfile.journal.tlsServerName`.

## Credential Manager & Terminal Input Shortcuts

Store usernames and passwords securely in the VS Code OS-backed SecretStorage and quickly paste credentials directly into any active terminal session using selection boxes and shortcut keys.

### Keybindings (When Terminal is Focused)

| Shortcut (Win / Linux) | Shortcut (macOS) | Action |
| :--- | :--- | :--- |
| `Ctrl+Alt+P` | `Cmd+Alt+P` | Show selection box to insert stored **Password** into active terminal |
| `Ctrl+Alt+U` | `Cmd+Alt+U` | Show selection box to insert stored **Username** into active terminal |
| `Ctrl+Alt+C` | `Cmd+Alt+C` | Show selection box to insert **Username / Password / Both** into active terminal |

### Commands (Command Palette `Ctrl+Shift+P` / `Cmd+Shift+P`)

- **Terminal Credentials: Add / Store Credential (Username & Password)**: Prompts for label, username, and password, securely storing it in VS Code `SecretStorage`.
- **Terminal Credentials: Insert Password to Terminal (Selection Box)**: Pick a credential from a QuickPick selection box to insert the password into the terminal.
- **Terminal Credentials: Insert Username to Terminal (Selection Box)**: Pick a credential to insert the username into the terminal.
- **Terminal Credentials: Insert Credential (Username/Password) to Terminal**: Select a credential and choose whether to send username, password, or both (username followed by password).
- **Terminal Credentials: Delete Stored Credential**: Select and remove stored credentials.

### Tests

`npm test` runs the test suite (SSE parser, TLS client, webview panel, and credential manager tests). It needs the `openssl` CLI.
