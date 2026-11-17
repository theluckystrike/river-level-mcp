// Measured 2026-11-17 on this hosted Worker: tools/list with mcp-protocol-version 2026-07-28 and no initialize
// answered HTTP 400 "Unsupported protocol version". A major MCP client sends that header on tool calls without
// a fresh initialize. A well-formed version newer than the SDK's latest must be served as the latest; malformed
// values and unknown older versions must still be rejected with 400.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/worker.js';

async function toolsList(version) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (version !== undefined) headers['mcp-protocol-version'] = version;
  const res = await worker.fetch(new Request('https://worker.test/mcp', {
    method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  }));
  return { status: res.status, text: await res.text() };
}

test('a well-formed protocol version newer than the SDK knows (2026-07-28) is served, not refused', async () => {
  const r = await toolsList('2026-07-28');
  assert.equal(r.status, 200, r.text);
  assert.ok(JSON.parse(r.text).result.tools.length > 0, r.text);
});

test('a known protocol version and no version header are still served', async () => {
  for (const v of ['2025-06-18', undefined]) {
    const r = await toolsList(v);
    assert.equal(r.status, 200, `${v}: ${r.text}`);
  }
});

test('malformed and unknown older protocol versions are still rejected with 400', async () => {
  for (const v of ['2026-7-28', 'latest', '2026-07-28x', '2024-01-01']) {
    const r = await toolsList(v);
    assert.equal(r.status, 400, `${v}: ${r.text}`);
    assert.match(r.text, /Unsupported protocol version/, v);
  }
});
