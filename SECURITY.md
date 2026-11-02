# Security policy

Codex Manager is preview software. It has not undergone an independent security
audit, and its current validation should not be interpreted as one.

## Report privately

Use GitHub's private vulnerability reporting for this repository when available.
If it is unavailable, contact the repository owner through a private channel;
do not post credentials or exploit details in a public issue.

Include the affected version, platform, reproduction and impact. Redact secrets.
A response-time or maintenance-service guarantee is not currently offered.

## Protect local credentials

- Manager encrypts stored account bundles in its SQLite database using a separate local key.
- The key file is not an OS hardware-backed vault. Access to both files can expose credentials.
- Codex auth files and credential exports contain readable credentials.
- Do not publish the database, `secret.key`, auth files or credential exports.
- If credentials are exposed, revoke the affected session through the provider and sign in again.

## Local API scope

The gateway and management API bind to loopback. Gateway calls require a local
API key, and browser management origins are checked. This does not defend against
all software already running as the same local user. Do not expose the service
through an unauthenticated proxy or public port forwarding.

## Preview distribution

Packages are unsigned, and macOS builds are not notarized. Verify downloads
against the SHA-256 file from the corresponding release. Windows installation
and startup still require platform testing. Automatic updates are not included.
