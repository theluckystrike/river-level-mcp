// Pure core for river-level-mcp. The only I/O is keyless reads of the USGS Water Data OGC API
// (api.waterdata.usgs.gov) and the NOAA National Water Prediction Service API (api.water.noaa.gov),
// done through an injected fetchText.
import type { FetchText } from './types.js';

export const REPO = 'river-level-mcp';
export const SITE = 'https://lakelevelnow.com';
export const UTM = `utm_source=mcp&utm_medium=${REPO}`;
export const USGS_API = 'https://api.waterdata.usgs.gov/ogcapi/v0/collections';
export const NWPS_API = 'https://api.water.noaa.gov/nwps/v1/gauges';
export const MAX_HISTORY_DAYS = 366;
export const STALE_HOURS = 48;

export class InputError extends Error {}
export class UpstreamError extends Error {}

export const link = (path: string) => `${SITE}${path}?${UTM}`;
export const usgsPage = (num: string) => `https://waterdata.usgs.gov/monitoring-location/USGS-${num}/`;
export const nwpsPage = (lid: string) => `https://water.noaa.gov/gauges/${lid.toLowerCase()}`;

/** Money-site page closest to a river gauge: the state lake page where one exists, else the home page. */
export function moreFor(stateName?: string | null): string {
  if (stateName === 'Texas') return link('/texas-lake-levels/');
  if (stateName === 'California') return link('/california-lake-levels/');
  return link('/');
}

// ---------------------------------------------------------------- parameters

export const PARAMS = {
  '00065': { key: 'gage_height', label: 'gage height (river stage)', unit: 'ft' },
  '00060': { key: 'discharge', label: 'discharge (streamflow)', unit: 'ft3/s' },
  '00010': { key: 'water_temperature', label: 'water temperature', unit: 'deg C' },
} as const;
export type ParamCode = keyof typeof PARAMS;
const PARAM_BY_KEY: Record<string, ParamCode> = { gage_height: '00065', stage: '00065', discharge: '00060', streamflow: '00060', flow: '00060', water_temperature: '00010', temperature: '00010' };

export function resolveParam(p: string): ParamCode {
  const k = p.trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (k in PARAMS) return k as ParamCode;
  const c = PARAM_BY_KEY[k];
  if (!c) throw new InputError(`Unknown parameter "${p}". Use discharge (streamflow, ft3/s), gage_height (stage, ft) or water_temperature.`);
  return c;
}

// ---------------------------------------------------------------- states

export const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico',
};

export function resolveState(s: string): string {
  const t = s.trim();
  if (STATES[t.toUpperCase()]) return STATES[t.toUpperCase()];
  const hit = Object.values(STATES).find((n) => n.toLowerCase() === t.toLowerCase());
  if (!hit) throw new InputError(`Unknown state "${s}". Use a two-letter code such as MO or a full name such as Missouri.`);
  return hit;
}

// ---------------------------------------------------------------- arithmetic

export const round = (x: number, d = 2) => { const f = 10 ** d; return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f; };
const num = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const sqlQuote = (s: string) => s.replace(/'/g, "''");

export function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.7613; const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function hoursSince(iso: string, nowMs: number): number { return (nowMs - Date.parse(iso)) / 3_600_000; }

// ---------------------------------------------------------------- site ids

/** USGS site number (8 to 15 digits, optional "USGS-" prefix) or an NWS gauge id (for example EADM7). */
export function classifySite(input: string): { kind: 'usgs'; num: string } | { kind: 'nws'; lid: string } {
  const s = input.trim();
  const m = s.match(/^(?:usgs[-:\s]?)?(\d{8,15})$/i);
  if (m) return { kind: 'usgs', num: m[1] };
  if (/^[a-z]{3,4}\d$/i.test(s)) return { kind: 'nws', lid: s.toUpperCase() };
  throw new InputError(`"${input}" is not a USGS site number (8 to 15 digits, for example 07010000) or an NWS gauge id (for example EADM7). Use find_river_gauges to look one up by river and place name.`);
}

// ---------------------------------------------------------------- upstream

const parseJson = (text: string, who: string): any => {
  try { return JSON.parse(text); } catch { throw new UpstreamError(`${who} returned something that is not JSON`); }
};

async function get(fetchText: FetchText, url: string, ttl: number, who: string): Promise<any> {
  let text: string;
  try { text = await fetchText(url, { cacheTtl: ttl, timeoutMs: 20000 }); } catch (e) {
    const msg = (e as Error).message;
    if (/HTTP 404/.test(msg)) throw new InputError(`${who} has no record for this request (HTTP 404).`);
    if (/HTTP 429/.test(msg)) throw new UpstreamError(`${who} is rate limiting requests right now (HTTP 429). Try again in a few minutes. Do not answer a river level from memory.`);
    throw new UpstreamError(`${who} is not answering right now (${msg}). Try again in a few minutes. Do not answer a river level from memory.`);
  }
  const j = parseJson(text, who);
  if (j && typeof j === 'object' && 'code' in j && 'description' in j && !('features' in j) && !('properties' in j)) throw new UpstreamError(`${who} error: ${j.description}`);
  return j;
}

const qs = (p: Record<string, string | number>) => Object.entries(p).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

export const urls = {
  location: (n: string) => `${USGS_API}/monitoring-locations/items/USGS-${n}?f=json`,
  latest: (ids: string[], params: string[] = Object.keys(PARAMS)) =>
    `${USGS_API}/latest-continuous/items?${qs({ f: 'json', monitoring_location_id: ids.map((n) => `USGS-${n}`).join(','), parameter_code: params.join(','), limit: 500, properties: 'monitoring_location_id,parameter_code,time,value,unit_of_measure,approval_status,qualifier' })}`,
  daily: (n: string, p: string, start: string, end: string) =>
    `${USGS_API}/daily/items?${qs({ f: 'json', monitoring_location_id: `USGS-${n}`, parameter_code: p, statistic_id: '00003', datetime: `${start}/${end}`, limit: 1000, properties: 'time,value,approval_status,qualifier' })}`,
  search: (filter: string, bbox?: string) =>
    `${USGS_API}/monitoring-locations/items?${qs({ f: 'json', limit: 60, 'filter-lang': 'cql-text', filter, ...(bbox ? { bbox } : {}), properties: 'monitoring_location_name,state_name,county_name,site_type,drainage_area' })}`,
  nwps: (id: string) => `${NWPS_API}/${id}`,
  stageflow: (lid: string) => `${NWPS_API}/${lid}/stageflow`,
};

// ---------------------------------------------------------------- parsers

export interface Location { id: string; site_number: string; name: string; state: string | null; county: string | null; latitude: number | null; longitude: number | null; drainage_area_sq_mi: number | null; gage_datum_ft: number | null; vertical_datum: string | null; time_zone: string | null; site_type: string | null }

export function parseLocation(j: any): Location {
  const p = j?.properties;
  if (!p || typeof j.id !== 'string') throw new UpstreamError('USGS returned an unexpected monitoring-location payload');
  const [lon, lat] = j.geometry?.coordinates ?? [null, null];
  return {
    id: j.id, site_number: j.id.replace(/^USGS-/, ''), name: String(p.monitoring_location_name ?? j.id), state: p.state_name ?? null, county: p.county_name ?? null,
    latitude: num(lat), longitude: num(lon), drainage_area_sq_mi: num(p.drainage_area), gage_datum_ft: num(p.altitude), vertical_datum: p.vertical_datum ?? null,
    time_zone: p.time_zone_abbreviation ?? null, site_type: p.site_type ?? null,
  };
}

export interface Reading { parameter: string; parameter_code: string; label: string; value: number; unit: string; time: string; approval: string; qualifier: string | null; age_hours: number; stale: boolean }

export function parseLatest(j: any, nowMs: number): Map<string, Reading[]> {
  if (!Array.isArray(j?.features)) throw new UpstreamError('USGS returned an unexpected latest-continuous payload');
  const out = new Map<string, Reading[]>();
  for (const f of j.features) {
    const p = f.properties ?? {};
    const code = p.parameter_code as ParamCode;
    const def = PARAMS[code];
    const v = num(p.value);
    if (!def || v === null || typeof p.time !== 'string') continue;
    const id = String(p.monitoring_location_id).replace(/^USGS-/, '');
    const age = hoursSince(p.time, nowMs);
    const r: Reading = { parameter: def.key, parameter_code: code, label: def.label, value: v, unit: def.unit, time: p.time, approval: String(p.approval_status ?? ''), qualifier: p.qualifier ? String(p.qualifier) : null, age_hours: round(age, 1), stale: age > STALE_HOURS };
    const arr = out.get(id) ?? [];
    // Keep the newest reading per parameter (a site can have more than one sensor for a parameter).
    const i = arr.findIndex((x) => x.parameter_code === code);
    if (i < 0) arr.push(r); else if (r.time > arr[i].time) arr[i] = r;
    out.set(id, arr);
  }
  return out;
}

export interface DailyPoint { date: string; value: number; approval: string }

export function parseDaily(j: any): DailyPoint[] {
  if (!Array.isArray(j?.features)) throw new UpstreamError('USGS returned an unexpected daily-values payload');
  const pts: DailyPoint[] = [];
  for (const f of j.features) {
    const v = num(f.properties?.value);
    const t = f.properties?.time;
    if (v === null || typeof t !== 'string') continue;
    pts.push({ date: t.slice(0, 10), value: v, approval: String(f.properties.approval_status ?? '') });
  }
  pts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return pts.filter((p, i) => i === 0 || p.date !== pts[i - 1].date);
}

export interface FloodInfo {
  lid: string; name: string; usgs_id: string | null; stage_units: string; flow_units: string;
  categories: Record<string, number>; observed: any; forecast: any; observed_category: string | null; forecast_category: string | null;
  record_crest: { stage: number; flow: number | null; date: string } | null; in_service: boolean; page: string;
}

export function parseNwpsGauge(j: any): FloodInfo {
  if (!j || typeof j.lid !== 'string') throw new UpstreamError('NOAA NWPS returned an unexpected gauge payload');
  const cats: Record<string, number> = {};
  for (const k of ['action', 'minor', 'moderate', 'major']) {
    const s = num(j.flood?.categories?.[k]?.stage);
    if (s !== null && s > -9000) cats[k] = s;
  }
  const hist = (j.flood?.crests?.historic ?? []).filter((c: any) => num(c?.stage) !== null && !c.olddatum);
  const top = hist.sort((a: any, b: any) => b.stage - a.stage)[0];
  return {
    lid: j.lid, name: String(j.name ?? j.lid), usgs_id: j.usgsId || null, stage_units: j.flood?.stageUnits ?? 'ft', flow_units: j.flood?.flowUnits ?? 'cfs',
    categories: cats, observed: j.status?.observed ?? null, forecast: j.status?.forecast ?? null,
    observed_category: j.status?.observed?.floodCategory ?? null, forecast_category: j.status?.forecast?.floodCategory ?? null,
    record_crest: top ? { stage: top.stage, flow: num(top.flow), date: String(top.occurredTime).slice(0, 10) } : null,
    in_service: j.inService?.enabled !== false, page: nwpsPage(j.lid),
  };
}

/** Flood category for a stage against NWS thresholds (stage at or above the threshold). */
export function categoryFor(stage: number, cats: Record<string, number>): string {
  for (const k of ['major', 'moderate', 'minor', 'action']) if (cats[k] !== undefined && stage >= cats[k]) return k === 'action' ? 'action (near flood)' : `${k} flood`;
  return Object.keys(cats).length ? 'below flood stage' : 'no flood thresholds published';
}

export interface StagePoint { time: string; stage: number | null; flow: number | null }

export function parseStageflow(j: any): { forecast_issued: string | null; forecast: StagePoint[]; observed: StagePoint[]; flow_units: string; stage_units: string } {
  if (!j || (typeof j !== 'object')) throw new UpstreamError('NOAA NWPS returned an unexpected stageflow payload');
  const pts = (arr: any[]): StagePoint[] => (Array.isArray(arr) ? arr : [])
    .map((d) => ({ time: String(d.validTime), stage: num(d.primary) !== null && Number(d.primary) > -900 ? Number(d.primary) : null, flow: num(d.secondary) !== null && Number(d.secondary) > -900 ? Number(d.secondary) : null }))
    .filter((p) => p.stage !== null || p.flow !== null);
  return {
    forecast_issued: j.forecast?.issuedTime ?? null, forecast: pts(j.forecast?.data), observed: pts(j.observed?.data),
    flow_units: j.forecast?.secondaryUnits ?? j.observed?.secondaryUnits ?? 'kcfs', stage_units: j.forecast?.primaryUnits ?? j.observed?.primaryUnits ?? 'ft',
  };
}

// ---------------------------------------------------------------- resolution

async function resolveSite(fetchText: FetchText, input: string): Promise<{ num: string; nws: any | null }> {
  const c = classifySite(input);
  if (c.kind === 'usgs') return { num: c.num, nws: null };
  const g = await get(fetchText, urls.nwps(c.lid), 3600, 'NOAA NWPS').catch((e) => {
    if (e instanceof InputError) throw new InputError(`NWS gauge "${c.lid}" was not found. Use find_river_gauges to look up the USGS site number.`);
    throw e;
  });
  if (!g?.usgsId) throw new InputError(`NWS gauge ${c.lid} (${g?.name ?? 'unknown'}) has no USGS site attached, so USGS readings are not available. Use get_flood_forecast for the NWS stage.`);
  return { num: String(g.usgsId), nws: g };
}

async function fetchLocation(fetchText: FetchText, n: string): Promise<Location> {
  try { return parseLocation(await get(fetchText, urls.location(n), 86400, 'USGS Water Data API')); } catch (e) {
    if (e instanceof InputError) throw new InputError(`USGS site ${n} does not exist. Use find_river_gauges to look up a site by river and place name.`);
    throw e;
  }
}

async function fetchNwps(fetchText: FetchText, id: string): Promise<FloodInfo | null> {
  try { return parseNwpsGauge(await get(fetchText, urls.nwps(id), 300, 'NOAA NWPS')); } catch (e) {
    if (e instanceof InputError) return null; // no NWS forecast point for this site
    throw e;
  }
}

const fmtN = (x: number, d = 2) => x.toLocaleString('en-US', { maximumFractionDigits: d });
const describe = (r: Reading) => `${r.label} ${fmtN(r.value)} ${r.unit}`;

// ---------------------------------------------------------------- tool cores

export async function getRiverLevel(fetchText: FetchText, siteIn: string, nowMs = Date.now()) {
  const { num: n, nws: nwsRaw } = await resolveSite(fetchText, siteIn);
  const [loc, latestJ, nws] = await Promise.all([
    fetchLocation(fetchText, n),
    get(fetchText, urls.latest([n]), 300, 'USGS Water Data API'),
    nwsRaw ? Promise.resolve(parseNwpsGauge(nwsRaw)) : fetchNwps(fetchText, n).catch(() => null),
  ]);
  const readings = (parseLatest(latestJ, nowMs).get(n) ?? []).sort((a, b) => a.parameter_code.localeCompare(b.parameter_code)).reverse();
  if (!readings.length) throw new InputError(`USGS site ${n} (${loc.name}) reports no current stage, discharge or water temperature. It may be a discontinued, lake, well or water-quality site. Use find_river_gauges to pick an active stream gauge.`);
  const stage = readings.find((r) => r.parameter_code === '00065');
  const flood = nws ? {
    nws_gauge: nws.lid, nws_name: nws.name, thresholds_ft: nws.categories,
    current_category: stage && Object.keys(nws.categories).length ? categoryFor(stage.value, nws.categories) : (nws.observed_category ?? null),
    feet_below_flood_stage: stage && nws.categories.minor !== undefined ? round(nws.categories.minor - stage.value, 2) : null,
    nws_observed: nws.observed, nws_forecast_next: nws.forecast, record_crest: nws.record_crest, page: nws.page,
  } : null;
  const newest = readings.map((r) => r.time).sort().pop() as string;
  const stale = readings.every((r) => r.stale);
  const summary = `${loc.name} (USGS ${n}): ${readings.map(describe).join(', ')}, measured ${newest}${stale ? ` (WARNING: newest reading is over ${STALE_HOURS} hours old; the gauge may be down)` : ''}.` +
    (flood && flood.current_category ? ` NWS flood status: ${flood.current_category}${flood.feet_below_flood_stage !== null ? `, ${fmtN(Math.abs(flood.feet_below_flood_stage))} ft ${flood.feet_below_flood_stage >= 0 ? 'below' : 'above'} flood stage (${nws!.categories.minor} ft)` : ''}.` : ' No NWS flood thresholds are published for this gauge.') +
    ' USGS real-time data are provisional and can be revised.';
  return {
    site: loc, readings, flood, as_of: newest, provisional: readings.some((r) => /provisional/i.test(r.approval)),
    source: usgsPage(n), sources: { usgs_latest: urls.latest([n]), usgs_site: urls.location(n), nws: flood ? urls.nwps(nws!.lid) : null },
    more: moreFor(loc.state), summary,
  };
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function getRiverHistory(fetchText: FetchText, siteIn: string, daysIn = 30, parameter = 'discharge', nowMs = Date.now()) {
  const days = Math.round(daysIn);
  if (!(days >= 2 && days <= MAX_HISTORY_DAYS)) throw new InputError(`days must be from 2 to ${MAX_HISTORY_DAYS}.`);
  const code = resolveParam(parameter);
  const { num: n } = await resolveSite(fetchText, siteIn);
  const end = ymd(nowMs); const start = ymd(nowMs - days * 86_400_000);
  const [loc, dj] = await Promise.all([fetchLocation(fetchText, n), get(fetchText, urls.daily(n, code, start, end), 3600, 'USGS Water Data API')]);
  const pts = parseDaily(dj);
  const def = PARAMS[code];
  if (!pts.length) throw new InputError(`USGS site ${n} (${loc.name}) has no daily mean ${def.label} between ${start} and ${end}. Many gauges publish daily means for discharge only; try parameter "discharge", or "gage_height" for stage.`);
  const vals = pts.map((p) => p.value);
  const lo = pts.reduce((a, b) => (b.value < a.value ? b : a));
  const hi = pts.reduce((a, b) => (b.value > a.value ? b : a));
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const first = pts[0]; const last = pts[pts.length - 1];
  const change = last.value - first.value;
  const summary = `${loc.name} (USGS ${n}) daily mean ${def.label}, ${first.date} to ${last.date} (${pts.length} days): latest daily mean ${fmtN(last.value)} ${def.unit}, ${change >= 0 ? 'up' : 'down'} ${fmtN(Math.abs(change))} ${def.unit}${first.value ? ` (${round((change / first.value) * 100, 1)}%)` : ''} from ${fmtN(first.value)} on ${first.date}; low ${fmtN(lo.value)} on ${lo.date}, high ${fmtN(hi.value)} on ${hi.date}, mean ${fmtN(round(mean, 2))}. Daily values for recent days are provisional.`;
  return {
    site: loc, parameter: def.key, parameter_code: code, unit: def.unit, statistic: 'daily mean (USGS statistic 00003)',
    start: first.date, end: last.date, count: pts.length,
    stats: { first: first.value, last: last.value, change: round(change, 3), change_percent: first.value ? round((change / first.value) * 100, 2) : null, min: lo.value, min_date: lo.date, max: hi.value, max_date: hi.date, mean: round(mean, 3) },
    series: pts, as_of: last.date, source: usgsPage(n), sources: { usgs_daily: urls.daily(n, code, start, end) }, more: moreFor(loc.state), summary,
  };
}

export async function getFloodForecast(fetchText: FetchText, siteIn: string) {
  const c = classifySite(siteIn);
  const id = c.kind === 'usgs' ? c.num : c.lid;
  const nws = await fetchNwps(fetchText, id);
  if (!nws) throw new InputError(`No NWS river forecast point is linked to "${siteIn}". Many USGS stream gauges are not NWS forecast points. get_river_level still gives the current USGS reading.`);
  const sf = parseStageflow(await get(fetchText, urls.stageflow(nws.lid), 300, 'NOAA NWPS'));
  const fc = sf.forecast;
  const peak = fc.filter((p) => p.stage !== null).reduce<StagePoint | null>((a, b) => (!a || (b.stage as number) > (a.stage as number) ? b : a), null);
  const obs = sf.observed.length ? sf.observed[sf.observed.length - 1] : null;
  const cats = nws.categories;
  const peakCat = peak && peak.stage !== null ? categoryFor(peak.stage, cats) : null;
  const obsCat = obs && obs.stage !== null ? categoryFor(obs.stage, cats) : null;
  const summary = `${nws.name} (NWS ${nws.lid}${nws.usgs_id ? `, USGS ${nws.usgs_id}` : ''}): ` +
    (obs ? `observed stage ${obs.stage ?? 'n/a'} ${sf.stage_units}${obs.flow !== null ? `, flow ${fmtN(obs.flow)} ${sf.flow_units}` : ''} at ${obs.time} (${obsCat}). ` : 'no recent observation. ') +
    (peak ? `The NWS forecast issued ${sf.forecast_issued} peaks at ${peak.stage} ${sf.stage_units} on ${peak.time} (${peakCat}); ${fc.length} forecast points to ${fc[fc.length - 1].time}.` : 'NWS publishes no stage forecast for this gauge right now (observation-only point).') +
    (Object.keys(cats).length ? ` Flood stages: ${Object.entries(cats).map(([k, v]) => `${k} ${v} ft`).join(', ')}.` : ' No flood stages are published for this gauge.') +
    (nws.record_crest ? ` Record crest ${nws.record_crest.stage} ft on ${nws.record_crest.date}.` : '') + ' Forecasts change with each issuance; follow local NWS warnings for safety decisions.';
  return {
    nws_gauge: nws.lid, name: nws.name, usgs_id: nws.usgs_id, in_service: nws.in_service, thresholds_ft: cats,
    observed_latest: obs ? { ...obs, category: obsCat } : null,
    forecast_issued: sf.forecast_issued, forecast_peak: peak ? { ...peak, category: peakCat } : null, forecast: fc,
    stage_units: sf.stage_units, flow_units: sf.flow_units, record_crest: nws.record_crest,
    as_of: obs?.time ?? sf.forecast_issued, source: nws.page, sources: { nwps_gauge: urls.nwps(nws.lid), nwps_stageflow: urls.stageflow(nws.lid) },
    more: link('/'), summary,
  };
}

export async function findRiverGauges(fetchText: FetchText, a: { query?: string; state?: string; latitude?: number; longitude?: number; radius_miles?: number }, nowMs = Date.now()) {
  const words = (a.query ?? '').toLowerCase().replace(/[^a-z0-9 .'-]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !['river', 'at', 'near', 'the', 'creek', 'of', 'nr', 'level', 'levels', 'gauge', 'gage'].includes(w) || /^\d+$/.test(w));
  const hasPoint = a.latitude !== undefined && a.longitude !== undefined;
  if (!words.length && !hasPoint && !a.query?.match(/river|creek/i)) throw new InputError('Give a query (river and place, for example "mississippi st louis") and optionally a state, or a latitude and longitude.');
  if ((a.latitude === undefined) !== (a.longitude === undefined)) throw new InputError('Give both latitude and longitude, or neither.');
  const state = a.state ? resolveState(a.state) : null;
  const radius = a.radius_miles ?? 15;
  if (!(radius > 0 && radius <= 100)) throw new InputError('radius_miles must be from 1 to 100.');
  const terms = (words.length ? words : (a.query ?? '').toLowerCase().match(/river|creek/g) ?? []).slice(0, 5);
  const clauses = [`agency_code='USGS'`, `site_type_code LIKE 'ST%'`, ...terms.map((w) => `CASEI(monitoring_location_name) LIKE CASEI('%${sqlQuote(w)}%')`)];
  if (state) clauses.push(`state_name='${sqlQuote(state)}'`);
  let bbox: string | undefined;
  if (hasPoint) {
    const lat = a.latitude as number; const lon = a.longitude as number;
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) throw new InputError('latitude must be -90 to 90 and longitude -180 to 180.');
    const dLat = radius / 69; const dLon = radius / (69 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((x) => round(x, 5)).join(',');
  }
  const sj = await get(fetchText, urls.search(clauses.join(' AND '), bbox), 86400, 'USGS Water Data API');
  if (!Array.isArray(sj?.features)) throw new UpstreamError('USGS returned an unexpected monitoring-locations payload');
  let sites = sj.features.map((f: any) => {
    const [lon, lat] = f.geometry?.coordinates ?? [null, null];
    const id = String(f.id);
    return { site_number: id.replace(/^USGS-/, ''), name: String(f.properties?.monitoring_location_name ?? id), state: f.properties?.state_name ?? null, county: f.properties?.county_name ?? null, latitude: num(lat), longitude: num(lon), drainage_area_sq_mi: num(f.properties?.drainage_area), distance_miles: null as number | null };
  });
  if (hasPoint) {
    sites = sites.map((s: any) => ({ ...s, distance_miles: s.latitude !== null ? round(haversineMiles(a.latitude as number, a.longitude as number, s.latitude, s.longitude), 1) : null }))
      .filter((s: any) => s.distance_miles === null || s.distance_miles <= radius);
  }
  sites = sites.slice(0, 40);
  let latest = new Map<string, Reading[]>();
  if (sites.length) latest = parseLatest(await get(fetchText, urls.latest(sites.map((s: any) => s.site_number), ['00065', '00060']), 300, 'USGS Water Data API'), nowMs);
  const rows = sites.map((s: any) => {
    const r = latest.get(s.site_number) ?? [];
    const newest = r.map((x) => x.time).sort().pop() ?? null;
    return { ...s, active: r.some((x) => !x.stale), latest_time: newest, stage_ft: r.find((x) => x.parameter_code === '00065')?.value ?? null, discharge_cfs: r.find((x) => x.parameter_code === '00060')?.value ?? null, usgs_page: usgsPage(s.site_number) };
  }).sort((x: any, y: any) => Number(y.active) - Number(x.active) || (x.distance_miles ?? 0) - (y.distance_miles ?? 0) || (y.drainage_area_sq_mi ?? 0) - (x.drainage_area_sq_mi ?? 0)).slice(0, 25);
  const act = rows.filter((r: any) => r.active);
  const where = [a.query ? `"${a.query}"` : null, state ? `in ${state}` : null, hasPoint ? `within ${radius} miles of ${a.latitude}, ${a.longitude}` : null].filter(Boolean).join(' ');
  const summary = rows.length
    ? `${act.length} active USGS stream gauge${act.length === 1 ? '' : 's'} (of ${rows.length} matched) for ${where}: ${act.slice(0, 8).map((r: any) => `${r.name} (${r.site_number}${r.stage_ft !== null ? `, ${r.stage_ft} ft` : ''}${r.discharge_cfs !== null ? `, ${fmtN(r.discharge_cfs)} ft3/s` : ''})`).join('; ') || 'none reporting now'}. Pass a site_number to get_river_level.`
    : `No USGS stream gauge matches ${where}. Try fewer words (for example only the river name), drop the state, or search by latitude and longitude.`;
  return { count: rows.length, active_count: act.length, gauges: rows, as_of: new Date(nowMs).toISOString(), source: 'https://api.waterdata.usgs.gov/', sources: { usgs_search: urls.search(clauses.join(' AND '), bbox) }, more: moreFor(state), summary };
}
