// The hosted Worker reads every upstream through fetchTextEdge, which asks Cloudflare to cache the answer at the edge.
// A plain cf.cacheTtl caches every status, so one upstream 403 or 5xx was served to every caller until the TTL ran out
// (measured 2026-11-17 on hospital-ratings-cms-star-ratings-mcp: cf-cache-status HIT on a data.cms.gov 403).
// Only 2xx answers may be cached; any other status gets TTL 0, so the next call goes back to the upstream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTextEdge } from '../dist/worker.js';

async function withUpstream(status, fn) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), cf: init?.cf });
    return new Response(status === 200 ? '{"ok":true}' : 'upstream error', { status });
  };
  try { await fn(); } finally { globalThis.fetch = real; }
  return seen;
}

function assertOnly2xxCached(cf, ttl) {
  assert.ok(cf, 'the edge fetch passes cf cache options');
  assert.equal(cf.cacheTtl, undefined, 'cf.cacheTtl caches every status, errors included');
  assert.deepEqual(cf.cacheTtlByStatus, { '200-299': ttl, '300-599': 0 });
}

test('edge cache: a 2xx answer is returned and cached for the requested TTL', async () => {
  let body;
  const seen = await withUpstream(200, async () => { body = await fetchTextEdge('https://upstream.test/ok', { cacheTtl: 3600 }); });
  assert.equal(body, '{"ok":true}');
  assert.equal(seen.length, 1);
  assertOnly2xxCached(seen[0].cf, 3600);
});

test('edge cache: an upstream 403 or 503 is an error and is not cached', async () => {
  for (const status of [403, 503]) {
    const seen = await withUpstream(status, async () => {
      await assert.rejects(fetchTextEdge(`https://upstream.test/${status}`, { cacheTtl: 3600 }), new RegExp(`HTTP ${status}`));
    });
    assert.ok(seen.length >= 1);
    for (const s of seen) assertOnly2xxCached(s.cf, 3600);
  }
});
