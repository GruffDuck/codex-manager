let busy = false;
/** Do not let a CLI write or second restart race an in-progress account change. */
export async function withClientMutation<T>(work: () => Promise<T>): Promise<T> {
  if (busy) throw Object.assign(new Error('An account change is already in progress. Wait for it to finish.'), { status: 409, code: 'account_change_busy' });
  busy = true;
  try { return await work(); } finally { busy = false; }
}
