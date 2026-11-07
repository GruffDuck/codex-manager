<p align="center">
  <img src="ui/public/logo.svg" width="72" height="72" alt="Codex Manager logo">
</p>
<h1 align="center">Codex Manager</h1>
<p align="center">Your Codex accounts, quotas and local routing in one desktop app.</p>
<p align="center">
  <a href="https://github.com/GruffDuck/codex-manager/releases/tag/v0.1.0-preview.8"><img alt="Release: preview" src="https://img.shields.io/badge/release-0.1.0_preview.8-blue?style=flat-square"></a>
  <a href="LICENSE"><img alt="License: CC BY-NC-SA 4.0" src="https://img.shields.io/badge/license-CC_BY--NC--SA_4.0-64748b?style=flat-square"></a>
  <a href="docs/validation.md"><img alt="Validation: 50 tests passed on macOS" src="https://img.shields.io/badge/macOS_tests-50_passed-15803d?style=flat-square"></a>
</p>
<p align="center">
  <a href="#download">Download</a> · <a href="#getting-started">Getting started</a> · <a href="#screenshots">Screenshots</a> · <a href="#documentation">Documentation</a>
</p>

![Codex Manager desktop application showing saved accounts and their remaining quotas](docs/images/accounts-light.jpg)

<p align="center"><sub>Native desktop screenshot with synthetic demonstration accounts. No personal account data is shown.</sub></p>

Codex Manager keeps multiple ChatGPT/Codex logins on your computer, shows their
reported quotas and helps you choose the next account. On macOS, switching can
close Codex, save the selected login and reopen Codex. An optional local gateway
can distribute Responses API requests across eligible accounts.

> **Preview software.** macOS Apple Silicon packages have passed a packaged
> startup check. Windows x64 packages are available for testing, but Windows
> installation and startup have not yet been validated. Automatic Codex
> close/reopen is currently **macOS-only**. Packages are unsigned; macOS packages
> are not notarized.

## Contents

- [Download](#download)
- [What it does](#what-it-does)
- [Platform support](#platform-support)
- [Getting started](#getting-started)
- [Account switching](#account-switching)
- [T3 Code](#t3-code)
- [Optional gateway](#optional-gateway)
- [Screenshots](#screenshots)
- [Privacy and local storage](#privacy-and-local-storage)
- [Build from source](#build-from-source)
- [Documentation](#documentation)
- [License and attribution](#license-and-attribution)

## Download

| Platform | Installer | Alternative |
| --- | --- | --- |
| macOS Apple Silicon | [Download DMG](https://github.com/GruffDuck/codex-manager/releases/download/v0.1.0-preview.8/Codex.Manager-0.1.0-preview.8-mac-arm64.dmg) | [Download ZIP](https://github.com/GruffDuck/codex-manager/releases/download/v0.1.0-preview.8/Codex.Manager-0.1.0-preview.8-mac-arm64.zip) |
| Windows x64 · testing preview | [Download Setup EXE](https://github.com/GruffDuck/codex-manager/releases/download/v0.1.0-preview.8/Codex.Manager-Setup-0.1.0-preview.8-win-x64.exe) | [Download ZIP](https://github.com/GruffDuck/codex-manager/releases/download/v0.1.0-preview.8/Codex.Manager-0.1.0-preview.8-win-x64.zip) |

[Release notes](https://github.com/GruffDuck/codex-manager/releases/tag/v0.1.0-preview.8)
· [SHA-256 checksums](https://github.com/GruffDuck/codex-manager/releases/download/v0.1.0-preview.8/SHA256SUMS.txt)
· [All releases](https://github.com/GruffDuck/codex-manager/releases)

Node.js is included in the desktop packages. You do not need Node or npm to use
an installer. Extract the complete Windows ZIP before opening the app; copying
only the EXE will omit required files.

## What it does

| Feature | What you get |
| --- | --- |
| Multiple accounts | Sign in, import an existing Codex login or import a credential bundle. |
| Quota visibility | Remaining quota, reset times and plan information reported by the upstream service. |
| Account switching | On macOS, a controlled close, login update and reopen sequence. |
| Automatic switching | On macOS, the same restart sequence when the selected login reaches your quota threshold. |
| T3 Code | One fixed profile follows account selections, with graceful T3 desktop restart on macOS. |
| Local gateway | Optional quota-weighted routing, token refresh and retries for Responses API requests. |
| Desktop utilities | Menu-bar access, configurable notifications, light/dark themes and request history. |
| Import and export | Account metadata, explicitly requested credential exports and diagnostics. |

Quotas are reported values, not estimates. A saved login, the account shown in
Codex and the account selected for a gateway request are different states;
Manager does not treat them as interchangeable.

## Platform support

| Capability | macOS Apple Silicon | Windows x64 | Linux |
| --- | --- | --- | --- |
| Downloadable package | DMG / ZIP | Setup EXE / ZIP | Build targets only |
| Packaged startup validation | Passed | Not yet run | Not yet run |
| Account, quota and gateway UI | Included | Included; awaiting platform testing | Source build |
| Linked T3 Code switching | Implemented; live round-trip checked | Not supported | Not supported |
| Automatic Codex close/reopen | Implemented; real switch cycle still pending | Not implemented | Not implemented |
| Signed release / auto-update | Not available | Not available | Not available |

See [validation](docs/validation.md) for the exact checks performed.

## Getting started

1. Install the package for your platform and open Codex Manager.
2. Select **Add account**. Sign in with ChatGPT or import an existing Codex login.
3. Refresh quotas to confirm each account's reported availability.
4. On macOS, select **Use in Codex** to close Codex, save that login and reopen it.
5. To switch at quota exhaustion, open **Settings**, choose **Restart Codex**, set
   the threshold to **0%**, choose the check interval and enable automatic switching.

Automatic switching is off by default on a fresh installation. The default
threshold is 0%, with a 60-second check interval. A usable alternative account
with known remaining quota is required. If Codex is already closed, automatic
switching leaves it closed.

## Account switching

![Account switching flow: check account, close Codex, save login, reopen and verify startup](docs/images/account-switching.svg)

The account is checked before Codex is asked to quit. Manager waits for Codex
and its child processes to exit before writing credentials. A refused quit
leaves the login unchanged. If reopening or startup checks fail, Manager tries
to restore the previous files and reopen the previous session.

Switching can interrupt an active reply. Startup confirmation checks that Codex
is running and the selected login remains in its auth file; it does **not**
independently read the account displayed inside a private Codex desktop session.
It also does not automatically resume an interrupted conversation.

[Switching behavior and recovery](docs/desktop-integration.md)

## T3 Code

Linked switching currently requires the macOS desktop build. On Windows, use
T3 Code’s own account management; automatic T3 restart is not supported.

Select **Use in T3 Code**, directly below the Codex button on an account,
then **Link and use this account**. Manager
prepares one fixed profile at `~/.codex-manager/integrations/t3-code/linked`.
Once, set your existing T3 Codex CLI provider's **CODEX_HOME path** to that
path, leave **Shadow home path** empty and refresh provider status. Keep
using that same provider instance. Preview 5 users must replace the old
account-specific path once. If the CLI reports `ENOENT`, set **Binary path**
to a working Codex CLI executable.

After connecting, manual Codex/CLI selections and quota-triggered switches
update this same T3 profile automatically. On macOS, if T3 Code is running,
Manager asks it to quit, waits for its tracked child processes, saves the new
login and reopens it. Active replies may be interrupted and are not automatically
resumed. A closed T3 stays closed. No forced quit is used. The same-account
selection does not restart T3 or overwrite credentials it may have refreshed.

The linked accounts share T3 sessions and configuration. Credentials use file
storage with restricted permissions; the main Codex configuration is separate.
If T3 refuses to quit, its login stays unchanged. Reopen/verification failures
attempt to restore the previous T3 login and reopen it. A T3 failure is shown
in Manager and does not undo an already completed Codex change. Verification
checks the app process and saved auth file, not the account displayed in T3's
private UI. Select the linked instance when starting or continuing a T3 thread.

Use **Disconnect linked switching** in the T3 dialog to stop following Manager.
The provider and its files are retained. Removing an account does not delete an
exported profile; disconnect its T3 provider and delete unused profile directories
(including their credential backups) when no longer needed. Usage in both
clients counts against the same account quota. Remote servers, WSL and background
T3 servers are not controlled by the macOS desktop restart integration.

See [T3 Code's Codex provider documentation](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-codex.md).

## Optional gateway

![Architecture showing the desktop UI, local Manager core, optional client routing and encrypted account storage](docs/images/architecture.svg)

Enable the gateway from **Gateway** when you want eligible accounts to share
Responses API traffic. Manager backs up your Codex configuration and writes a
local provider. Restart Codex to load that provider. You can restore the previous
configuration from the same page.

The gateway selects accounts per request using quota-weighted round-robin. It
refreshes rejected tokens once, cools down rate-limited accounts and retries
eligible failures within the configured attempt limit. Gateway routing does
not change the account displayed in the Codex desktop app.

[Gateway configuration and API reference](docs/gateway.md)

## Screenshots

These images were captured from a **native Electron application window**. The
account, settings, gateway and traffic images use a read-only demonstration
backend with synthetic accounts and requests. The sign-in image uses the real
Preview 3 package in an empty temporary profile. They are not browser
screenshots or generated UI mockups.

<details>
<summary><strong>Browser and in-app sign-in</strong></summary>

![Native sign-in options in the packaged application, using an empty test profile](docs/images/sign-in-options.jpg)

</details>

<details>
<summary><strong>Accounts in dark mode</strong></summary>

![Accounts and quota windows in the native desktop app, dark theme](docs/images/accounts-dark.jpg)

</details>

<details>
<summary><strong>Gateway settings</strong></summary>

![Optional local gateway configuration in the native desktop app](docs/images/gateway.jpg)

</details>

<details>
<summary><strong>Automatic switching and notifications</strong></summary>

![Automatic switching and notification settings in the native desktop app](docs/images/settings.jpg)

</details>

<details>
<summary><strong>Request history</strong></summary>

![Local Responses API request history in the native desktop app](docs/images/traffic.jpg)

</details>

## Privacy and local storage

Account credentials stored by Manager are encrypted with AES-256-GCM. The local
key is stored separately from the SQLite database. The gateway and management
API listen on `127.0.0.1`; gateway requests require a local API key. Management
requests are restricted to local hostnames and matching browser origins.

| Location | Purpose |
| --- | --- |
| `~/.codex-manager/data.db` | Accounts, encrypted credential bundles, quotas and request history. |
| `~/.codex-manager/secret.key` | Local encryption key. Keep it private and back it up with the database. |
| `~/.codex-manager/config.json` | Gateway configuration and local API key. |
| `$CODEX_HOME/auth.json` | Codex's selected login; defaults to `~/.codex/auth.json`. |

Codex's auth file and credential exports contain readable credentials; Manager's
at-rest encryption does not encrypt those files. Metadata exports omit tokens.
Do not publish credential exports, auth files, the database or the local key.

[Security policy](SECURITY.md)

## Build from source

Use Node.js 24 and npm. Building the macOS lifecycle helper also requires Xcode
Command Line Tools. Binary packages include the runtime and compiled helper.

```sh
git clone https://github.com/GruffDuck/codex-manager.git
cd codex-manager
npm ci
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the core and development UI. |
| `npm run desktop` | Build and run the native Electron shell. |
| `npm test` | Run unit, mock gateway and lifecycle tests in isolated profiles. |
| `npm run typecheck` | Check core and UI TypeScript. |
| `npm run package` | Package the host macOS/Linux target. |
| `npm run package:win` | Build Windows x64 Setup EXE and ZIP. |

[Build and packaging guide](docs/packaging.md) · [Contribution guide](CONTRIBUTING.md)

## Documentation

- [Changelog](CHANGELOG.md)
- [Feature guide](docs/features.md)
- [Account switching and automatic restart](docs/desktop-integration.md)
- [Gateway configuration and API](docs/gateway.md)
- [Build, packaging and signing](docs/packaging.md)
- [Architecture and the Electron/Rust trade-off](docs/architecture.md)
- [Validation record](docs/validation.md)
- [Source provenance review](docs/provenance-audit.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License and attribution

Project contributions are licensed under **CC BY-NC-SA 4.0**. Noncommercial use,
modification and sharing are permitted subject to attribution, change notices
and share-alike requirements. Commercial use is not granted by this license.
Third-party components retain their own licenses.

Because commercial use is restricted, this project is **source-available**,
rather than open source under the OSI definition. Creative Commons licenses are
not specifically designed for software; this license is the project owner's
choice. Read the [full license](LICENSE) and [third-party notices](THIRD_PARTY_NOTICES.md).

The architecture was inspired by Antigravity Manager. A local comparison found
no clear copied application implementation, but it is not a proof of complete
originality; the [review](docs/provenance-audit.md) documents its scope and limits.

Codex Manager is an independent project and is not affiliated with or endorsed
by OpenAI or Antigravity Manager.
