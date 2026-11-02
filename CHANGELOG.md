# Changelog

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
