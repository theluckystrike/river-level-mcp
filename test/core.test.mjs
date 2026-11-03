// Fixtures: saved USGS Water Data API and NOAA NWPS payloads for the Mississippi River at St. Louis
// (USGS 07010000 / NWS EADM7), fetched 2026-11-03, plus hand-checked arithmetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifySite, resolveParam, resolveState, haversineMiles, categoryFor, parseLocation, parseLatest, parseDaily, parseNwpsGauge, parseStageflow, round,
  getRiverLevel, getRiverHistory, getFloodForecast, findRiverGauges, InputError, UpstreamError, UTM,
} from '../dist/core.js';

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-03T08:00:00Z');
const seen = [];
const fake = (over = {}) => async (url) => {
  seen.push(url);
  for (const [k, v] of Object.entries(over)) if (url.includes(k)) { if (v instanceof Error) throw v; return v; }
  if (url.includes('/monitoring-locations/items/USGS-07010000')) return fx('usgs-location-07010000.json');
  if (url.includes('/monitoring-locations/items?')) return fx('usgs-search-mississippi-louis.json');
  if (url.includes('/latest-continuous/')) return fx('usgs-latest-07010000.json');
  if (url.includes('/daily/')) return fx('usgs-daily-07010000-00060.json');
  if (url.endsWith('/stageflow')) return fx('nwps-stageflow-EADM7.json');
  if (/nwps\/v1\/gauges\/(07010000|EADM7)$/.test(url)) return fx('nwps-gauge-EADM7.json');
  if (url.includes('nwps/v1/gauges/')) throw new Error('HTTP 404');
  throw new Error('unexpected url ' + url);
};

test('site ids: USGS numbers, USGS- prefix, NWS ids, junk rejected', () => {
  assert.deepEqual(classifySite('07010000'), { kind: 'usgs', num: '07010000' });
  assert.deepEqual(classifySite('USGS-01646500'), { kind: 'usgs', num: '01646500' });
  assert.deepEqual(classifySite('eadm7'), { kind: 'nws', lid: 'EADM7' });
  assert.throws(() => classifySite('St Louis'), InputError); assert.throws(() => classifySite('1234'), InputError);
});
test('parameters and states resolve', () => {
  assert.equal(resolveParam('streamflow'), '00060'); assert.equal(resolveParam('stage'), '00065'); assert.equal(resolveParam('00010'), '00010');
  assert.throws(() => resolveParam('turbidity'), InputError);
  assert.equal(resolveState('mo'), 'Missouri'); assert.equal(resolveState('texas'), 'Texas'); assert.throws(() => resolveState('ZZ'), InputError);
});
test('haversine: St. Louis gauge to Little Falls gauge is 702.67 miles (independent python haversine)', () => {
  const d = haversineMiles(38.629, -90.1797777777778, 38.949777777777776, -77.12763888888888);
  assert.equal(round(d, 2), 702.67);
});
test('NWS flood category thresholds (EADM7: action 28, minor 30, moderate 35, major 40)', () => {
  const c = { action: 28, minor: 30, moderate: 35, major: 40 };
  assert.equal(categoryFor(3.59, c), 'below flood stage'); assert.equal(categoryFor(28, c), 'action (near flood)'); assert.equal(categoryFor(30, c), 'minor flood');
  assert.equal(categoryFor(39.99, c), 'moderate flood'); assert.equal(categoryFor(49.58, c), 'major flood'); assert.equal(categoryFor(5, {}), 'no flood thresholds published');
});
test('parse USGS monitoring location 07010000', () => {
  const l = parseLocation(JSON.parse(fx('usgs-location-07010000.json')));
  assert.equal(l.name, 'Mississippi River at St. Louis, MO'); assert.equal(l.state, 'Missouri'); assert.equal(l.drainage_area_sq_mi, 697000); assert.equal(l.gage_datum_ft, 379.58);
});
test('parse USGS latest: stage 3.59 ft and discharge 126,000 ft3/s at 07:30Z, 0.5 h old', () => {
  const r = parseLatest(JSON.parse(fx('usgs-latest-07010000.json')), NOW).get('07010000');
  const st = r.find((x) => x.parameter_code === '00065'); const q = r.find((x) => x.parameter_code === '00060');
  assert.equal(st.value, 3.59); assert.equal(q.value, 126000); assert.equal(st.age_hours, 0.5); assert.equal(st.stale, false);
  assert.equal(parseLatest(JSON.parse(fx('usgs-latest-07010000.json')), NOW + 49 * 3600e3).get('07010000')[0].stale, true);
});
test('parse USGS daily: 29 days sorted, 2026-10-04 290,000 to 2026-11-01 119,000', () => {
  const p = parseDaily(JSON.parse(fx('usgs-daily-07010000-00060.json')));
  assert.equal(p.length, 29); assert.equal(p[0].date, '2026-10-04'); assert.equal(p[0].value, 290000); assert.equal(p.at(-1).value, 119000);
});
test('parse NWPS gauge: thresholds, record crest 49.58 ft on 1993-08-01', () => {
  const g = parseNwpsGauge(JSON.parse(fx('nwps-gauge-EADM7.json')));
  assert.deepEqual(g.categories, { action: 28, minor: 30, moderate: 35, major: 40 }); assert.equal(g.usgs_id, '07010000');
  assert.deepEqual(g.record_crest, { stage: 49.58, flow: 1070000, date: '1993-08-01' });
});
test('parse NWPS stageflow: 56 forecast points, peak 11.1 ft', () => {
  const s = parseStageflow(JSON.parse(fx('nwps-stageflow-EADM7.json')));
  assert.equal(s.forecast.length, 56); assert.equal(Math.max(...s.forecast.map((p) => p.stage)), 11.1); assert.equal(s.forecast_issued, '2026-11-03T02:36:00Z');
});
test('get_river_level: reading + flood status, 26.41 ft below minor flood stage 30', async () => {
  const r = await getRiverLevel(fake(), '07010000', NOW);
  assert.equal(r.flood.feet_below_flood_stage, 26.41); assert.equal(r.flood.current_category, 'below flood stage'); assert.equal(r.as_of, '2026-11-03T07:30:00+00:00');
  assert.ok(r.more.includes(UTM) && r.more.startsWith('https://lakelevelnow.com/')); assert.equal(r.source, 'https://waterdata.usgs.gov/monitoring-location/USGS-07010000/');
  assert.match(r.summary, /126,000 ft3\/s/);
});
test('get_river_level by NWS id resolves to the USGS site', async () => { const r = await getRiverLevel(fake(), 'EADM7', NOW); assert.equal(r.site.site_number, '07010000'); });
test('get_river_level: site without NWS point still answers, flood null', async () => {
  const r = await getRiverLevel(fake({ 'nwps/v1/gauges/07010000': new Error('HTTP 404') }), '07010000', NOW);
  assert.equal(r.flood, null); assert.match(r.summary, /No NWS flood thresholds/);
});
test('get_river_history 30 days: change 119000-290000 = -171000 (-58.97%), mean 215241.379', async () => {
  const r = await getRiverHistory(fake(), '07010000', 30, 'discharge', NOW);
  assert.equal(r.stats.change, -171000); assert.equal(r.stats.change_percent, -58.97); assert.equal(r.stats.mean, 215241.379);
  assert.equal(r.stats.max, 380000); assert.equal(r.stats.max_date, '2026-10-06'); assert.equal(r.stats.min_date, '2026-11-01');
  assert.ok(seen.some((u) => u.includes('datetime=2026-10-04%2F2026-11-03')));
  await assert.rejects(getRiverHistory(fake(), '07010000', 400, 'discharge', NOW), InputError);
});
test('get_flood_forecast: crest 11.1 ft on 2026-11-09T12:00Z, below flood stage', async () => {
  const r = await getFloodForecast(fake(), 'EADM7');
  assert.equal(r.forecast_peak.stage, 11.1); assert.equal(r.forecast_peak.time, '2026-11-09T12:00:00Z'); assert.equal(r.forecast_peak.category, 'below flood stage');
  assert.equal(r.observed_latest.stage, 3.67);
  await assert.rejects(getFloodForecast(fake(), '01646305'), InputError);
});
test('find_river_gauges: CQL filter, active gauges first, stop words dropped', async () => {
  seen.length = 0;
  const r = await findRiverGauges(fake(), { query: 'Mississippi River at St. Louis', state: 'MO' }, NOW);
  const q = decodeURIComponent(seen[0]);
  assert.ok(q.includes("CASEI(monitoring_location_name) LIKE CASEI('%mississippi%')") && q.includes("state_name='Missouri'") && !q.includes("'%river%'"));
  assert.equal(r.gauges[0].site_number, '07010000'); assert.equal(r.gauges[0].active, true); assert.equal(r.active_count, 1);
});
test('upstream failures are honest errors, never numbers', async () => {
  await assert.rejects(getRiverLevel(fake({ '/latest-continuous/': new Error('HTTP 503') }), '07010000', NOW), (e) => e instanceof UpstreamError && /Do not answer/.test(e.message));
  await assert.rejects(getRiverLevel(fake({ '/latest-continuous/': new Error('HTTP 429') }), '07010000', NOW), (e) => e instanceof UpstreamError && /rate limiting/.test(e.message));
  await assert.rejects(getRiverLevel(fake({ '/latest-continuous/': '{"type":"FeatureCollection","features":[]}' }), '07010000', NOW), InputError);
  await assert.rejects(getRiverLevel(fake({ '/monitoring-locations/items/USGS-07010000': new Error('HTTP 404') }), '07010000', NOW), /does not exist/);
});
