# Build and packaging

## Requirements

Use Node.js 24 and npm. macOS lifecycle-helper builds require Xcode Command Line Tools. End users do not need Node or npm: desktop packages include a dedicated Node runtime.

```sh
npm ci
npm run package
```

For an unpacked application directory, use `npm run package:dir`. Outputs are written to `release/`. macOS targets are APP, DMG and ZIP; Linux targets are AppImage and tar.gz. Build host-native macOS/Linux architectures on a matching machine. Linux execution has not been validated.

## Windows preview

```sh
npm run package:win
```

This creates `release/Codex Manager-Setup-0.1.0-preview.3-win-x64.exe` and `release/Codex Manager-0.1.0-preview.3-win-x64.zip`. Extract the entire ZIP; the application EXE depends on adjacent files. `npm run package:win -- arm64` selects Windows ARM64, which has not been built in this validation.

The Windows package includes account management, quota tracking and gateway code, plus the official Windows Node runtime. Automatic Codex close/reopen uses a macOS-only helper and is unavailable on Windows. The Windows installer and startup have not been run on Windows; cross-building and archive inspection do not validate runtime behavior.

The cross-build uses electron-builder's ARM-compatible NSIS toolset 1.2.1. Executable resource editing is enabled to embed the application icon and version metadata. Code signing remains disabled until a signing identity is configured.

## Bundled runtime

`prepare-runtime.mjs` downloads a pinned official Node.js 24 runtime and checks its SHA-256 against the list from the same official HTTPS source. Source and checksum information are included in `runtime/manifest.json`, with the Node license at `runtime/NODE-LICENSE`.

This verification relies on TLS and checksums; it does not separately verify Node release-key signatures.

## Distribution status

The [published preview](https://github.com/GruffDuck/codex-manager/releases/tag/v0.1.0-preview.3) contains macOS Apple Silicon DMG/ZIP and Windows x64 EXE/ZIP assets with `SHA256SUMS.txt`.

Packages are **unsigned**. Windows Authenticode, Apple Developer ID and macOS notarization are not configured. There is no automatic updater. Package commands use `--publish never`; publication is a separate step.

Before a stable release, validate each target platform, configure signing/notarization and complete the outstanding asset provenance and distribution-notice review described in [third-party notices](../THIRD_PARTY_NOTICES.md).

Accounts and settings remain in the user's `~/.codex-manager` directory and are not included in release packages. The project license is CC BY-NC-SA 4.0; third-party components retain their own licenses.

## Native documentation screenshots

Build the production UI, start the synthetic read-only server, then open its native Electron preview in another terminal:

```sh
npm run build:ui
node scripts/docs-demo.mjs
```

```sh
npx electron electron/docs-preview.cjs
```

Capture the **application window**, using only its synthetic accounts. The preview uses isolated temporary Electron user data and never opens Manager's real database. It does not perform sign-ins, account changes or gateway requests. Do not substitute browser captures or publish screenshots of private accounts.
