import { AccountError, ensureFresh } from './accounts.js';
import { getAccount } from './db.js';
import { withClientMutation } from './clientMutation.js';
import { t3SyncController } from './t3Sync.js';

/** One stable profile follows Manager selections after a one-time T3 provider setup. */
export async function prepareT3Code(id: string) {
  return withClientMutation(async () => {
    const account = getAccount(id);
    if (!account) throw new AccountError('Account not found', 404, 'not_found');
    const tokens = await ensureFresh(account);
    const link = await t3SyncController.select(tokens, id, true);
    if (link.state === 'failed') throw new AccountError(link.message, 409, 't3_switch_failed');
    return { ok: true, status: 'prepared' as const,
      account: { id: account.id, email: account.email }, codex_home: link.codex_home,
      shadow_home: '', connection_verified: false, link };
  });
}
