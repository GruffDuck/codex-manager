/**
 * Local stand-in for the ChatGPT Codex backend. Used by `npm run test:e2e`
 * so the gateway's failover, quota parsing and SSE relay can be exercised
 * without spending real quota.
 *
 *   node scripts/mock-upstream.mjs [port]
 */
import http from 'node:http';

const port = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 8099);
const starts = Date.now();

function quotaHeaders(primary, secondary, plan = 'plus') {
  return {
    'x-codex-plan-type': plan,
    'x-codex-active-limit': 'primary',
    'x-codex-primary-used-percent': String(primary),
    'x-codex-secondary-used-percent': String(secondary),
    'x-codex-primary-window-minutes': '300',
    'x-codex-secondary-window-minutes': '10080',
    'x-codex-primary-reset-after-seconds': '3600',
    'x-codex-secondary-reset-after-seconds': '86400',
    'x-codex-primary-reset-at': String(Math.floor(Date.now() / 1000) + 3600),
    'x-codex-secondary-reset-at': String(Math.floor(Date.now() / 1000) + 86400),
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  const account = req.headers['chatgpt-account-id'] ?? 'unknown';

  if (url.pathname.endsWith('/wham/usage')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        account_id: account,
        email: `${String(account).slice(0, 6)}@mock.local`,
        plan_type: 'plus',
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: { used_percent: 5, limit_window_seconds: 18000, reset_after_seconds: 3600, reset_at: Math.floor(Date.now() / 1000) + 3600 },
          secondary_window: { used_percent: 2, limit_window_seconds: 604800, reset_after_seconds: 86400, reset_at: Math.floor(Date.now() / 1000) + 86400 },
        },
        credits: { has_credits: false, unlimited: false, balance: '0' },
      }),
    );
    return;
  }

  if (url.pathname.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json', ...quotaHeaders(5, 2) });
    res.end(
      JSON.stringify({
        object: 'list',
        data: [
          { id: 'mock-codex-large', object: 'model', owned_by: 'openai' },
          { id: 'mock-codex-mini', object: 'model', owned_by: 'openai' },
        ],
      }),
    );
    return;
  }

  if (url.pathname.endsWith('/responses')) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        /* ignore */
      }

      if (String(parsed.model ?? '').includes('limited')) {
        res.writeHead(429, { 'content-type': 'application/json', ...quotaHeaders(100, 80) });
        res.end(JSON.stringify({ error: { message: 'mock limit reached', code: 'rate_limit_exceeded' } }));
        return;
      }

      if (parsed.model === 'echo-headers') {
        res.writeHead(200, { 'content-type': 'application/json', ...quotaHeaders(7, 4) });
        res.end(
          JSON.stringify({
            echo: {
              authorization: req.headers.authorization,
              account,
              originator: req.headers.originator,
              body: parsed,
            },
          }),
        );
        return;
      }

      if (parsed.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json', ...quotaHeaders(9, 3) });
        res.end(
          JSON.stringify({
            id: 'resp_mock',
            object: 'response',
            model: parsed.model,
            output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'mock reply' }] }],
            usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
          }),
        );
        return;
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        ...quotaHeaders(4, 1),
      });
      const events = [
        { type: 'response.created', response: { id: 'resp_mock', model: parsed.model } },
        { type: 'response.output_text.delta', delta: 'mock ' },
        { type: 'response.output_text.delta', delta: 'stream' },
        { type: 'response.completed', response: { id: 'resp_mock', usage: { total_tokens: 6 } } },
      ];
      let index = 0;
      const timer = setInterval(() => {
        if (index >= events.length) {
          clearInterval(timer);
          res.end('data: [DONE]\n\n');
          return;
        }
        res.write(`event: ${events[index].type}\ndata: ${JSON.stringify(events[index])}\n\n`);
        index += 1;
      }, 30);
      res.on('close', () => clearInterval(timer));
    });
    return;
  }

  if (url.pathname === '/__stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ uptime_ms: Date.now() - starts }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`mock codex upstream on http://127.0.0.1:${port}\n`);
});
