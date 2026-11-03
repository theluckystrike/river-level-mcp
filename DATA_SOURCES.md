# Data sources

All sources below were fetched on 2026-11-03 while building version 1.0.0. Every number in a tool result is read at call time from these APIs; nothing is hard-coded except the parameter codes and US state names.

| Data | URL | Notes |
|---|---|---|
| Latest stage (00065), discharge (00060), water temperature (00010) | https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items | USGS Water Data OGC API. Keyless; an optional api.data.gov key raises the rate limit (https://api.waterdata.usgs.gov/docs/ogcapi/keys/). Edge cache 300 s. |
| Daily mean values (statistic 00003) | https://api.waterdata.usgs.gov/ogcapi/v0/collections/daily/items | Edge cache 3600 s. |
| Site name, state, county, coordinates, drainage area, gauge datum; name search | https://api.waterdata.usgs.gov/ogcapi/v0/collections/monitoring-locations/items | CQL text filter with CASEI() for case-insensitive name search. Edge cache 1 day. |
| Flood stages, record crests, NWS status | https://api.water.noaa.gov/nwps/v1/gauges/{lid or USGS id} | NOAA National Water Prediction Service. Accepts the NWS id or the USGS site number. Edge cache 300 s. |
| NWS observed and forecast stage and flow | https://api.water.noaa.gov/nwps/v1/gauges/{lid}/stageflow | Edge cache 300 s. API docs: https://api.water.noaa.gov/nwps/v1/docs/ |
| Legacy service shutdown date | https://waterservices.usgs.gov/ | Page states: "WaterServices will be permanently shut down on February 22nd, 2027 ... Users must migrate to https://api.waterdata.usgs.gov." |

Test fixtures in `test/fixtures/` are the raw payloads for the Mississippi River at St. Louis (USGS 07010000, NWS EADM7) saved on 2026-11-03 (the NWPS observed series is trimmed to the last 96 points).
