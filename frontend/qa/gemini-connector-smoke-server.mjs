// Explicit opt-in bridge for synthetic local integration tests. Never deploy.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGeminiDatabase } from './gemini-connector-database.mjs';

export async function startGeminiSmokeServer() {
  const db = await createGeminiDatabase();
  await db.reset();
  const operations = [];
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    try {
      if (req.method === 'GET' && req.url === '/test-state') {
        const submissions = (await db.pg.query('select id,grant_id,survey_id,job_id,result_revision,configured_task_model from rg_mcp.submissions order by created_at,id')).rows;
        res.end(JSON.stringify({ protected_rows: await db.protectedRows(), submissions, operations }));
        return;
      }
      if (req.method !== 'POST' || req.url !== '/rpc') {
        res.statusCode = 404; res.end('{"error":"not_found"}'); return;
      }
      let body = '', size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) { res.statusCode = 413; res.end('{"error":"body_limit"}'); return; }
        body += chunk.toString('utf8');
      }
      const input = JSON.parse(body);
      if (typeof input.p_operation !== 'string' || !input.p_input || typeof input.p_input !== 'object' || Array.isArray(input.p_input)) {
        res.statusCode = 400; res.end('{"error":"invalid_fixture_request"}'); return;
      }
      operations.push(input.p_operation); // Names only; never credentials or payloads.
      try {
        const data = await db.execute(input.p_operation, input.p_input);
        res.end(JSON.stringify({ data, error: null }));
      } catch {
        res.end(JSON.stringify({ data: null, error: { code: 'fixture_store_denied', message: 'Fixture operation denied' } }));
      }
    } catch {
      res.statusCode = 500; res.end('{"error":"fixture_failure"}');
    }
  });
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Loopback binding required');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => { await new Promise((done, reject) => server.close(error => error ? reject(error) : done())); await db.pg.close(); },
  };
}

// Importing this module cannot open a server. A separate explicit CLI flag is required.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--fixture-server') {
    process.stderr.write('Use --fixture-server for the synthetic loopback fixture.\n');
    process.exitCode = 2;
  } else {
    try {
      const bridge = await startGeminiSmokeServer();
      process.stdout.write(JSON.stringify({ url: bridge.url }) + '\n');
      let closing = false;
      const close = async () => { if (closing) return; closing = true; await bridge.close(); };
      process.once('SIGTERM', () => { void close(); });
      process.once('SIGINT', () => { void close(); });
    } catch {
      process.stderr.write('Synthetic fixture startup failed.\n');
      process.exitCode = 1;
    }
  }
}
