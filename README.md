# river-level-mcp

Live US river levels for AI assistants: river stage, streamflow and water temperature from USGS stream gauges, with NWS flood stages and river forecasts.

This is a Model Context Protocol (MCP) server. It reads the USGS Water Data API and the NOAA National Water Prediction Service at call time. It needs no API key.

## Tools

| Tool | What it returns |
| --- | --- |
| `find_river_gauges` | Active USGS river and stream gauges by river and place name, state, or latitude and longitude, with each gauge's latest stage and flow. Active gauges first. |
| `get_river_level` | Current river stage (gage height, ft), streamflow (discharge, ft3/s) and water temperature where measured, the measurement time, NWS flood stages, current flood category, feet below flood stage and record crest. Flags readings over 48 hours old. |
| `get_river_history` | Daily mean streamflow or stage for 2 to 366 days, with first, last, low, high, mean and change. |
| `get_flood_forecast` | The current NWS river forecast for a gauge: forecast series, forecast crest and its flood category, latest observation, flood stages and record crest. |

Every result has structured JSON, a one-paragraph summary, `as_of`, `source` (the USGS or NWS gauge page) and `more` (a page on [lakelevelnow.com](https://lakelevelnow.com/?utm_source=mcp&utm_medium=river-level-mcp)).

## What it knows that your model does not

- Today's river level. Gauges report every 5 to 60 minutes and a river can rise 10 feet in a day. A model's training data is months old.
- Whether a river is near flood stage right now, using the NWS action, minor, moderate and major flood stages for that gauge.
- The latest NWS river forecast and its crest, reissued several times a day.
- The new USGS Water Data API. The legacy waterservices.usgs.gov service shuts down on February 22, 2027, so code that calls it will stop working. This server already uses api.waterdata.usgs.gov.

## Install

### Hosted (Claude.ai custom connector, ChatGPT developer mode)

Paste this URL. No token, no sign-up.

```
https://river-level-mcp.lipmichal.workers.dev/mcp
```

### Claude Code

```
claude mcp add --transport http river-level https://river-level-mcp.lipmichal.workers.dev/mcp
```

Or run it locally over stdio:

```
claude mcp add river-level -- npx -y github:theluckystrike/river-level-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "river-level": { "command": "npx", "args": ["-y", "github:theluckystrike/river-level-mcp"] }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "river-level": { "url": "https://river-level-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "river-level": { "type": "http", "url": "https://river-level-mcp.lipmichal.workers.dev/mcp" }
  }
}
```

Node 20 or newer is needed for the local stdio version.

## Example prompts

- "What is the Mississippi River level at St. Louis right now?"
- "Is the Potomac at Little Falls near flood stage?"
- "How much water is flowing in the Colorado River at Austin, and how has it changed over the last 90 days?"
- "When will the river crest at EADM7, and will it reach flood stage?"
- "Which stream gauges are within 10 miles of 38.95, -77.13?"

## Data sources

Full list with fetch dates in [DATA_SOURCES.md](DATA_SOURCES.md).

- River stage, streamflow, water temperature, daily means and site details from the [USGS Water Data API](https://api.waterdata.usgs.gov/) (OGC API collections `latest-continuous`, `daily`, `monitoring-locations`).
- Flood stages, record crests and river forecasts from the [NOAA National Water Prediction Service API](https://api.water.noaa.gov/nwps/v1/docs/).
- The hosted server caches readings at the edge for a few minutes and site details for a day, so repeat calls do not reach USGS or NOAA.

## Limitations

- USGS real-time data are provisional and can be revised. The tools say so.
- Only gauges that are NWS forecast points have flood stages and forecasts. Other gauges still return the USGS reading.
- NWS stage and USGS gage height normally use the same gauge datum, but check the NWS gauge page before relying on a threshold comparison for safety. Follow local NWS warnings for flood decisions.
- The USGS API applies a rate limit to keyless callers. When it answers 429 or is down, the tool returns a clear error instead of a stale or remembered number.
- Lakes and reservoirs are covered by [lake-level-mcp](https://github.com/theluckystrike/lake-level-mcp).

## More

Live lake and reservoir levels for Lake Mead, Lake Powell, Lake Travis and more are on [lakelevelnow.com](https://lakelevelnow.com/?utm_source=mcp&utm_medium=river-level-mcp).

Part of the Zovo MCP collection: https://mcp.zovo.one

## Development

```
npm install
npm test            # builds, then runs the fixture tests against saved USGS and NOAA payloads
node scripts/smoke-stdio.mjs   # live stdio check, one real call per tool
npx wrangler deploy            # Cloudflare Worker, Streamable HTTP at /mcp
```

## License

MIT
