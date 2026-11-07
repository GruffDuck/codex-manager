# Feature guide

## Accounts

**Add account** offers **Open browser** for the default browser and **In app** for a separate sandboxed sign-in window in desktop builds. The waiting screen can reopen the browser or copy the sign-in link. Browser sign-in keeps Manager open while the local callback completes. It also accepts an existing Codex auth file /
credential bundle. Manager stores credentials encrypted on this computer.
**Refresh quotas** fetches the service's current usage windows. A refresh error
is shown on the account instead of being silently treated as available quota.

The quota bars show **remaining** capacity. Reset times and plan labels come
from the service. Different plans may expose different windows.

## Use in Codex / Restart Codex

On macOS, **Use in Codex** closes Codex, saves the chosen login and opens
Codex again. The selected account's **Restart Codex** button repeats that
sequence for the same login. Both can interrupt an active reply.

Manager checks the saved auth file and whether Codex remains running after
startup. This is not an independent read of the account shown inside Codex.
See [switching details](desktop-integration.md).

## Prepare login and Use in CLI

The account menu contains explicit file-only actions:

- **Prepare login for restart** writes the selected credentials and removes
  Manager's gateway configuration. You reopen Codex yourself.
- **Use in CLI** writes the credentials without changing gateway configuration.
  It does not force an already running desktop session to reload them.

These actions do not claim that the open Codex app has changed account. If T3 linked switching is enabled, the linked T3 desktop follows the selection using its own restart sequence.

## T3 Code

**Use in T3 Code** is directly below the Codex button on every account. Connect
the fixed linked profile once, then keep using that same provider instance in
T3. Subsequent Manager Codex/CLI account changes, including quota-triggered
changes, update the linked login. On macOS an open T3 desktop is asked to quit
and is reopened after its processes exit and the login is saved. A closed app
stays closed; active replies are not resumed automatically.

The link can be disconnected without deleting T3's files. Refused quits leave
the old T3 login unchanged; failed launches attempt recovery. The status is
visible in Manager and does not silently turn a T3 failure into a successful
T3 switch. Linked desktop switching requires macOS; Windows users should use
T3's own account management. See the [setup and migration guide](../README.md#t3-code).

## Automatic switching

Under **Settings**, the **Restart Codex** target uses the same close/write/reopen
operation as the account button. Set the threshold to 0% to switch at exhaustion.
The default check interval is 60 seconds. Only eligible alternatives with known
quota above the threshold are considered.

If all accounts are exhausted, none is selected. If Codex is closed, automatic
switching leaves it closed. A failed restart pauses automatic retries for at
least ten minutes and is recorded for attention.

**CLI only** prepares a login file without restarting Codex. This target has a
`prepared` result rather than a confirmed desktop switch.

## Gateway

The optional local gateway distributes Responses API calls across eligible
accounts. Accounts with more headroom receive more traffic through weighted
round-robin. A strict account pin is available for callers that need one login.

This is separate from desktop account switching: a gateway request may use a
different account from the one displayed in Codex. [Gateway reference](gateway.md).

## Traffic

The **Traffic** page shows retained request records: account, model, status,
latency and routing notes. Filter by result or search the visible records.
This is a local diagnostic view, not a billing ledger.

## Notifications

Desktop notifications can report automatic switches, low quota and account
errors. They require the desktop app to be running and remain subject to OS
notification permissions. Equivalent events appear in the activity section.

## Import, export and diagnostics

Metadata exports omit credentials. Credential exports require an explicit
choice and contain readable live credentials. Diagnostics mask credentials,
but may still contain account metadata; review them before sharing.

## Appearance

Light and dark themes use the same layout. The chosen theme is remembered
locally. README screenshots use demonstration accounts in a native app window.

## Startup feedback

The desktop shell displays a branded opening screen before waiting for the local core. Quota and tray requests start after the dashboard loads, and the bundled runtime version is read from its manifest instead of launching Node a second time. `startup.log` in Electron's user-data directory records elapsed startup stages without account details or sign-in URLs. Windows cold-start timing still requires measurement on Windows.

## Windows tray and closing the app

Left-clicking or double-clicking the notification-area icon shows the main Manager window and restores it if minimized. Right-click the icon for **Open Codex Manager** and **Quit Codex Manager**. Windows uses its native tray menu instead of the macOS popover, avoiding a popup being placed below a bottom taskbar.

The title-bar **X** hides Manager in the tray so quota checks can continue. **Quit Codex Manager** exits the desktop app and stops the core process it started. Launching Manager a second time restores the existing window. On macOS, the menu-bar quota popover remains available.
