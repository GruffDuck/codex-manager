# Gateway configuration and API

## Enable or disable routing

Open **Gateway** and choose **Enable gateway**. Manager backs up
`$CODEX_HOME/config.toml` and adds managed root keys plus a provider table.
Existing root model selection is preserved. Quit and reopen Codex to load the
configuration. **Disable gateway** removes the managed regions and restores
preserved root keys.

The configuration backup is `config.toml.codex-manager.bak`. Repeated gateway
updates preserve the previous model and root settings. Desktop account restart
switching removes Manager gateway mode so the saved ChatGPT login is used
directly.

A generated provider has this shape; use the key shown in your own Manager UI:

```toml
model_provider = "codex_manager"

[model_providers.codex_manager]
name = "Codex Manager"
base_url = "http://127.0.0.1:8055/v1"
wire_api = "responses"
requires_openai_auth = false
http_headers = { Authorization = "Bearer <your-local-manager-key>" }
```

This example is illustrative. Let the configuration writer place root keys
before TOML tables instead of pasting root assignments into an existing table.
Profiles and external configuration can override the selected provider.

## Request endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/responses` | Proxy Responses API requests; SSE or JSON. |
| `GET /v1/models` | Proxy the upstream model catalog, with a five-minute cache. |
| `GET /v1/usage` | Account quota summaries. |
| `GET /healthz` | Basic service health and management API version. |

`/v1/*` requests require the local Bearer API key. The service listens on
`127.0.0.1`, port 8055 by default. Set `CODEX_MANAGER_PORT` to use another port.

Use `x-codex-account: <id | account_id | email>` to pin a request. An unknown or
unavailable account fails explicitly instead of silently selecting another.
`x-codex-manager-*` response headers identify the chosen account and attempts.

## Selection and recovery

Eligible accounts are active accounts, or accounts whose supported cooldown has
elapsed. Expired logins are excluded. Smooth weighted round-robin favors
accounts with more reported quota without requiring the same account on every
request.

| Result | Behavior |
| --- | --- |
| `401` | Refresh once; a repeated rejection expires the account. |
| `429` | Record quota headers, apply cooldown and try another eligible account. |
| `5xx` / network failure | Try another account within the attempt limit. |
| Attempts exhausted | Return the last available error and retry information. |

Bodies and SSE are forwarded without protocol translation. Only gateway
credential/routing headers are replaced as needed. Chat Completions conversion
and WebSocket forwarding are not implemented.

## Management API

The UI uses local `/api/*` routes. Browser origins must match the local host;
management routes are not designed for a public network deployment.

| Area | Routes |
| --- | --- |
| State | `GET /api/state`, `GET /api/events`, `GET /api/requests` |
| Accounts | `POST /api/accounts/import`, `POST /api/accounts/import-bulk`, `POST /api/accounts/json`, `GET /api/accounts/export`, `DELETE /api/accounts/:id` |
| Quotas | `POST /api/accounts/:id/refresh`, `POST /api/accounts/refresh-all` |
| Desktop restart | `POST /api/accounts/:id/use-in-codex`, `GET /api/codex/restart` |
| File-only login | `POST /api/accounts/:id/prepare`, `POST /api/accounts/:id/use-in-cli` |
| Sign-in | `POST /api/login/start`, `POST /api/login/cancel` |
| Settings | `GET /api/settings`, `PATCH /api/settings`, `POST /api/auto-switch/check` |
| Configuration | `PATCH /api/config`, `POST /api/codex/config`, `DELETE /api/codex/config` |
| Local key | `POST /api/key/rotate` |
| Diagnostics | `GET /api/diagnostics` |
