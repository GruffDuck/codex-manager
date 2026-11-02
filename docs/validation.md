# Validation record

Date: **2026-11-02**. Product: **Codex Manager 0.1.0-preview.4**.

## Completed checks

| Check | Result | Scope |
| --- | --- | --- |
| `npm test` | 40 passed | Isolated core, mock gateway and lifecycle tests on macOS. |
| `npm run typecheck` | Passed | Core and UI TypeScript. |
| `npm run package` | Passed | macOS ARM64 DMG / ZIP. |
| `npm run test:package` | Passed | Bundled Node 24.22.2, production dependencies and a fresh temporary home; health, API and UI responses. |
| Packaged app startup | Passed | Native account screen opened; no account mutation. |
| Native Codex status | Passed | Installed running Codex located through the AppKit helper. |
| Windows cross-build | Passed | Windows x64 Setup EXE and ZIP generated on macOS. |
| Windows archive inspection | Passed | ZIP and NSIS archive checks; application and Node headers identify PE32+ x86-64. |
| Production dependency audit | No findings at audit time | `npm audit --omit=dev`; not a security guarantee. |

Electron is 45.2.1; Zod is 4.6.7. The health response uses `management_api: 3` to prevent a new window from silently using an incompatible old core.

## Preview 3 desktop checks

- The Windows EXE resource table contains `Codex Manager` product/description fields and seven embedded custom icon sizes matching the generated application ICO.
- A real packaged macOS app opened in an empty temporary profile and showed both **Open browser** and **In app** controls.
- One macOS run recorded window visibility at 391 ms, core readiness at 880 ms and UI load at 974 ms from the Electron entry point. This is a single sample, excludes OS launch time before that point, has no comparable baseline and is not a Windows performance measurement.
- Desktop bridge tests verify opening the system browser without a blank Electron popup, rejecting foreign frames/URLs and isolating the in-app sign-in window. A complete provider sign-in with real credentials was not performed.

## Preview 4 tray checks

A regression test runs the actual desktop main module with mocked Windows Electron APIs. It verifies that a left click opens the main window, minimized windows are restored, repeated/double clicks keep the window visible, the title-bar close hides it, the native menu reopens it, a second instance restores it, and explicit quit allows closing and stops the core owned by the shell. Windows never creates the macOS popover in these tests.

The previous placement code always positioned the popover below the tray icon. This is inappropriate for a bottom Windows taskbar; the Windows path now uses the main window and a native context menu instead. The reported behavior has not been reproduced or visually verified on a real Windows desktop in this macOS development environment.

## Restart coverage

The primary account button and zero-quota policy share a controller. Tests cover waiting before credential writes, refused quits, launch-failure recovery, unexpected auth changes and concurrent mutations.

A real close/change/reopen cycle has **not** been performed. The development chat would be interrupted. Startup verification checks process state and the auth file, rather than independently reading Codex's displayed account. Conversation resumption is not implemented.

## Published artifacts

The [v0.1.0-preview.4 release](https://github.com/GruffDuck/codex-manager/releases/tag/v0.1.0-preview.4) contains macOS ARM64 DMG/ZIP, Windows x64 Setup EXE/ZIP and SHA-256 checksums. Preview 4 includes the Windows tray restore and explicit quit fix, preserving the branding, startup and sign-in improvements from Preview 3. Previous previews remain available separately.

These are unsigned packages without macOS notarization or auto-update. Windows installation/startup, macOS Intel and Linux execution remain unvalidated. The macOS helper is excluded from Windows packages, which do not advertise restart support.

## Documentation images

Accounts in light/dark themes, Gateway, Settings and Traffic were captured from a native Electron application window using the production UI and a read-only synthetic backend. The sign-in options screenshot comes from the real Preview 3 package in an empty temporary profile. No real account credentials, account addresses or live request history are shown. Architecture and lifecycle diagrams are SVG image assets.
