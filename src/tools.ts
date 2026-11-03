// Tool registry shared by the stdio and Worker entries.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InputError, MAX_HISTORY_DAYS, REPO, SITE, findRiverGauges, getFloodForecast, getRiverHistory, getRiverLevel } from './core.js';
import type { FetchText } from './types.js';

export const VERSION = '1.0.0';

export const TOOL_INFO = [
  { name: 'find_river_gauges', blurb: 'Find active USGS river and stream gauges by river and place name, state, or latitude and longitude, with their current stage and flow.' },
  { name: 'get_river_level', blurb: 'Current river stage (gage height, ft), streamflow (ft3/s) and water temperature from a USGS gauge, with NWS flood stages and feet below flood stage.' },
  { name: 'get_river_history', blurb: 'Daily mean streamflow or stage for 2 to 366 days with first, last, low, high, mean and change.' },
  { name: 'get_flood_forecast', blurb: 'NWS river forecast for a gauge: forecast crest, flood category, flood stages and record crest.' },
];

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function ok(data: Record<string, unknown> & { summary: string }) {
  return { content: [{ type: 'text' as const, text: `${data.summary}\n\n${JSON.stringify(data, null, 2)}` }], structuredContent: data };
}
function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: 'text' as const, text: `${e instanceof InputError ? 'Error' : 'Upstream gauge error'}: ${msg}` }] };
}

const site = z.string().min(3).max(24).describe('USGS site number (for example "07010000" for the Mississippi River at St. Louis) or an NWS gauge id (for example "EADM7"). Use find_river_gauges to look one up.');

export function createServer(fetchText: FetchText): McpServer {
  const server = new McpServer({ name: REPO, version: VERSION, websiteUrl: SITE } as any, {
    instructions:
      'Live US river levels and streamflow read at call time from USGS stream gauges (api.waterdata.usgs.gov), with NOAA National Water Prediction Service flood stages and forecasts. ' +
      'Use find_river_gauges to get a site number, then get_river_level. River levels change by the hour; never answer a current river level or flood status from memory.',
  });

  server.registerTool('find_river_gauges', {
    title: 'Find river gauges',
    description:
      'Search USGS stream gauges nationwide by river and place name (for example "mississippi st louis", "potomac little falls"), by state, or within a radius of a latitude and longitude. ' +
      'Returns site numbers with whether each is reporting now and its latest stage and flow, active gauges first.',
    inputSchema: {
      query: z.string().max(80).optional().describe('Words from the gauge name: river plus town, for example "colorado river austin". Words like river, at and near are ignored.'),
      state: z.string().max(30).optional().describe('Two-letter state code (MO) or full state name (Missouri).'),
      latitude: z.number().min(-90).max(90).optional().describe('Latitude for a nearby search, for example 38.63.'),
      longitude: z.number().min(-180).max(180).optional().describe('Longitude for a nearby search, for example -90.18.'),
      radius_miles: z.number().min(1).max(100).optional().describe('Radius for a latitude and longitude search, 1 to 100 miles. Default 15.'),
    },
    annotations: { title: 'Find river gauges', ...RO },
  }, async (a) => {
    try { return ok(await findRiverGauges(fetchText, a) as any); } catch (e) { return fail(e); }
  });

  server.registerTool('get_river_level', {
    title: 'Get current river level',
    description:
      'Current river stage (gage height in feet), streamflow (discharge in cubic feet per second) and water temperature where measured, read now from a USGS stream gauge (readings every 5 to 60 minutes). ' +
      'Adds the NWS flood stages (action, minor, moderate, major), the current flood category, feet below flood stage and the record crest when the gauge is an NWS forecast point. Flags readings over 48 hours old. Your training data cannot know today\'s river level.',
    inputSchema: { site },
    annotations: { title: 'Get river level', ...RO },
  }, async ({ site: s }) => {
    try { return ok(await getRiverLevel(fetchText, s) as any); } catch (e) { return fail(e); }
  });

  server.registerTool('get_river_history', {
    title: 'Get river level history',
    description:
      `Daily mean streamflow (default) or stage for a USGS gauge over the last 2 to ${MAX_HISTORY_DAYS} days, with first, last, low, high, mean and change. ` +
      'Use it for trend, drought and "is the river rising" questions. Many gauges publish daily means for discharge only.',
    inputSchema: {
      site,
      days: z.number().int().min(2).max(MAX_HISTORY_DAYS).default(30).describe(`Days back from today, 2 to ${MAX_HISTORY_DAYS}. Default 30.`),
      parameter: z.enum(['discharge', 'gage_height', 'water_temperature']).default('discharge').describe('discharge (streamflow, ft3/s), gage_height (stage, ft) or water_temperature (deg C). Default discharge.'),
    },
    annotations: { title: 'Get river history', ...RO },
  }, async ({ site: s, days, parameter }) => {
    try { return ok(await getRiverHistory(fetchText, s, days ?? 30, parameter ?? 'discharge') as any); } catch (e) { return fail(e); }
  });

  server.registerTool('get_flood_forecast', {
    title: 'Get river flood forecast',
    description:
      'The current NOAA National Water Prediction Service river forecast for a gauge: the forecast stage and flow series, the forecast crest with its flood category, the latest observation, flood stages and the record crest. ' +
      'Works for NWS forecast points (accepts the NWS id or the USGS site number). Forecasts are reissued several times a day.',
    inputSchema: { site },
    annotations: { title: 'Get flood forecast', ...RO },
  }, async ({ site: s }) => {
    try { return ok(await getFloodForecast(fetchText, s) as any); } catch (e) { return fail(e); }
  });

  return server;
}
