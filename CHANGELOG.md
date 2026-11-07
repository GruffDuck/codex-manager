# Changelog

## 0.1.0-preview.7 — 2026-11-07

- Show **Use in T3 Code** directly below the Codex action on each account, instead of hiding it in More actions.

## 0.1.0-preview.6 — 2026-11-07

- Use one linked T3 profile so changing accounts in Manager no longer requires editing provider paths.
- Follow manual and quota-triggered Codex/CLI changes, gracefully restarting an open T3 Code desktop on macOS.
- Preserve shared T3 sessions/configuration; keep closed apps closed, skip same-account restarts, and recover the old T3 login when reopening fails.
- Add persistent link status, visible failure reporting and a disconnect action.

## 0.1.0-preview.5 — 2026-11-07

- Add **Use in T3 Code** with an independent per-account Codex CLI profile and guided provider setup, without restarting Codex or changing its active login.
- Show profile path copying and explicitly distinguish preparation from a verified T3 Code connection.

## 0.1.0-preview.4 — 2026-11-02

- Fix Windows tray clicks: open and focus the main window, restoring it from minimized or hidden states.
- Use a native tray context menu with explicit **Open Codex Manager** and **Quit Codex Manager** actions on Windows/Linux. Keep the quota popover on macOS.
- Stop placing a macOS-style popup below the Windows taskbar, where it can be offscreen.
- Route second-instance activation through the same restore/focus behavior.
- Add a regression test covering repeated clicks, minimize/restore, close-to-tray, reopen, second launch and explicit quit with owned-core shutdown.

## 0.1.0-preview.3 — 2026-11-02

- Restore Windows executable icon and product metadata editing while keeping code signing independent.
- Set a consistent Windows application ID and use the application icon in the Windows tray.
- Display a local branded startup window before core initialization. Defer quota/tray requests until the dashboard is loaded and remove the extra bundled Node version-probe process.
- Record local startup timings and reject stale cores from another Manager version.
- Add default-browser and sandboxed in-app sign-in options, browser reopen and copy-link fallback; keep Manager open during sign-in.
- Add regression coverage for startup ordering, URL validation and the desktop sign-in bridge.

## 0.1.0-preview.2 — 2026-11-02

- Rebuild macOS Apple Silicon DMG/ZIP and Windows x64 Setup EXE/ZIP from the current source.
- Show the default one-minute automatic-switch interval correctly in Settings, including singular wording.
- Translate project documentation and third-party explanatory notices into English; preserve upstream license texts.
- Add native desktop screenshots with synthetic accounts, SVG architecture/lifecycle diagrams, feature documentation and contribution/security guides.
- Publish SHA-256 checksums using the exact downloadable asset filenames.

Packages remain unsigned; macOS builds are not notarized. Windows installation/startup and a real Codex restart-switch cycle remain unvalidated. Automatic desktop restart is macOS-only.

## 0.1.0-preview.1 — 2026-11-02

Initial public preview: saved account management, quotas, optional local Responses gateway, macOS lifecycle switching, automatic-switch policy, notifications and request history.
