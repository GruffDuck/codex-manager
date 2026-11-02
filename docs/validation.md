# Validation record

Date: **2026-11-02**. Product: **Codex Manager 0.1.0 preview**.

## Completed checks

| Check | Result | Scope |
| --- | --- | --- |
| `npm test` | 35 passed | Isolated core, mock gateway and lifecycle tests on macOS. |
| `npm run typecheck` | Passed | Core and UI TypeScript. |
| `npm run package` | Passed | macOS ARM64 DMG / ZIP. |
| `npm run test:package` | Passed | Bundled Node 24.22.2, production dependencies and a fresh temporary home; health, API and UI responses. |
| Packaged app startup | Passed | Native account screen opened; no account mutation. |
| Native Codex status | Passed | Installed running Codex located through the AppKit helper. |
| Windows cross-build | Passed | Windows x64 Setup EXE and ZIP generated on macOS. |
| Windows archive inspection | Passed | ZIP and NSIS archive checks; application and Node headers identify PE32+ x86-64. |
| Production dependency audit | No findings at audit time | `npm audit --omit=dev`; not a security guarantee. |

Electron is 45.2.1; Zod is 4.6.7. The health response uses `management_api: 3` to prevent a new window from silently using an incompatible old core.

## Restart coverage

The primary account button and zero-quota policy share a controller. Tests cover waiting before credential writes, refused quits, launch-failure recovery, unexpected auth changes and concurrent mutations.

A real close/change/reopen cycle has **not** been performed. The development chat would be interrupted. Startup verification checks process state and the auth file, rather than independently reading Codex's displayed account. Conversation resumption is not implemented.

## Published artifacts

The [v0.1.0-preview.1 release](https://github.com/GruffDuck/codex-manager/releases/tag/v0.1.0-preview.1) contains macOS ARM64 DMG/ZIP, Windows x64 Setup EXE/ZIP and SHA-256 checksums. The original binaries were built from the initial release source; later documentation and Settings interval-display improvements on `main` are not a replacement binary build.

These are unsigned packages without macOS notarization or auto-update. Windows installation/startup, macOS Intel and Linux execution remain unvalidated. The macOS helper is excluded from Windows packages, which do not advertise restart support.

## Documentation images

Accounts in light/dark themes, Gateway, Settings and Traffic were captured from a native Electron application window using the production UI and a read-only synthetic backend. No real account credentials, account addresses or live request history are shown. Architecture and lifecycle diagrams are SVG image assets.
