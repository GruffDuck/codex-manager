# Contributing

Contributions should improve a specific, reproducible user problem. This is an
early preview; platform testing and clear failure reports are particularly useful.

## Development

Use Node.js 24 and npm. On macOS, install Xcode Command Line Tools to build the
native Codex lifecycle helper.

```sh
npm ci
npm run dev
npm test
npm run typecheck
```

`npm run desktop` builds and opens the Electron application. See the
[packaging guide](docs/packaging.md) for installer targets.

## Changes and validation

- Keep file-only login preparation, desktop restart switching and gateway routing distinct.
- Do not report a desktop account switch as verified from an auth-file write alone.
- Add meaningful tests for credential handling, routing or lifecycle changes.
- Use temporary profiles for tests. Never exercise a real account switch as part of a test suite.
- Keep UI text and project documentation in English.
- Use screenshots or image diagrams for visual documentation; do not add ASCII diagrams.
- Update the platform support table when a feature's tested scope changes.

Documentation screenshots must come from a native application window with
synthetic data. Do not publish personal account details or invented screenshots
that imply unsupported functionality.

## Reports

Include your OS, architecture, application version, expected behavior and the
smallest useful reproduction. Redact account emails if unnecessary. Do not attach
auth files, credential exports, local keys or unreviewed diagnostic bundles.

For vulnerabilities or credential exposure, follow [SECURITY.md](SECURITY.md).

## Licensing

Contributions must be compatible with the project's CC BY-NC-SA 4.0 terms and
retain third-party notices where applicable. Do not copy code or assets from
another project without documenting its source, author, license and changes.
