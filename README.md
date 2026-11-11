# ENI · India Climate & Water Watch

A live climate and water console for **every state and union territory of India** plus its
neighbourhood: rainfall, heat, groundwater recharge, river flow, wind, satellite imagery, the
state of El Niño, and where the climate is heading. Every panel is fed by an open, verifiable source; the
reference data (stations, IMD thresholds, the ENSO record) lives in Supabase so it can be
edited without touching code.

**Coverage:** 42 stations — all 28 states, all 8 union territories, plus Karachi, Dhaka, Kathmandu
and Colombo. Search by station, state or country.

**Live site:** https://arvarunram-byte.github.io/el-nino-india-watch/

---

## What is on the page

| Unit | What it shows | Source | Cadence |
|---|---|---|---|
| **ENSO state** | RONI gauge, Niño 3.4 / 1+2 departures, 2026 build-up, CPC outlook probabilities | NOAA CPC | weekly + monthly |
| **Rainfall** | 19-station totals (now / today / 7 d / 30 d), IMD category, 92-day observed bars + 7-day forecast | Open-Meteo | 15-min model step |
| **Heat** | Daily maxima, live feels-like, anomaly vs the past week, IMD threshold flags, 7-day forecast | Open-Meteo | 15-min model step |
| **Satellite** | India or **world** extent, an animated IMERG / MODIS loop with a scrubber, the four Niño boxes drawn on the globe, clickable stations | NASA GIBS | 30-min granules / daily |
| **Climate change** | CMIP6 1961–2050 warming rate, anomaly vs 1961–90, projected 2046–50, rainfall change | Open-Meteo Climate | static archive |
| **Pacific detail** | Official Niño-box departures + live 30-day SST curves for all four boxes | NOAA CPC + Open-Meteo Marine | weekly / hourly |
| **Briefing** | Plain-language seasonal read-out in English plus eight Indian languages | written here, translated by Sarvam | static per ENSO update |
| **Water** | Soil-water balance (rain − evaporation) and river discharge per station | Open-Meteo + GloFAS | 30-day window |
| **Air** | 10 m wind speed, direction and prevailing flow | Open-Meteo (ECMWF) | hourly |
| **Verification** | Each station's modelled rain checked against the satellite pixel above it, plus five pipeline self-tests | IMERG pixels + internal | per poll |
| **Data** | Feed inventory, backend status, feedback form | — | — |

Everything re-polls **every 60 seconds**.

### The satellite loop

The map is a time machine, not a single still. Twelve frames are pulled straight from NASA GIBS
as timestamped granules — every 30 minutes for precipitation, every day for land-surface
temperature — and played back in place. Precipitation systems visibly cross the Bay of Bengal,
the Western Ghats and the equatorial Pacific; in world mode the four Niño monitoring boxes are
drawn on the globe so you can see where the El Niño signal actually lives.

Frames load lazily, two ahead of the playhead, so playback never stalls waiting for a tile. The
loop ends a few hours behind now because that is where the satellite data actually is.

### On "real-time, every minute"

The page refreshes every minute; the *underlying* products do not all move at that speed and the
console says so rather than implying otherwise:

- **IMERG** satellite granules arrive every 30 minutes with roughly 6–12 hours of latency.
- **MODIS** composites arrive daily, 1–2 days behind.
- **Station/model** fields step every 15 minutes.
- **NOAA CPC** indices update weekly and monthly.

The header clock is the page's poll, not the age of the pixels. Each panel states its own freshness.

---

## Verification — the part most dashboards skip

A number on a dashboard is a claim. This console tries to make its claims falsifiable.

**Satellite cross-check.** For every station the page computes which IMERG tile and which pixel
covers its coordinates, loads that tile with `crossOrigin="anonymous"` (NASA GIBS sends
`Access-Control-Allow-Origin: *`, so the canvas is readable), and reads the actual RGBA value the
satellite painted there. That pixel is classified against the IMERG colour ramp — clear, light,
moderate, heavy, very heavy — and compared with the forecast model's hourly rain **at the same
granule timestamp**. Where the model says rain and the satellite's pixel is transparent, the row
reads `differs`. That is the point: disagreement is information.

**Five integrity checks** run on every poll, in the browser, against the data already in memory:

1. *Station geometry* — every station inside the 0–40 °N, 55–100 °E box.
2. *Series completeness* — 19 × 99 daily values, no gaps.
3. *Physical bounds* — minimum never above maximum on any day.
4. *Arithmetic re-check* — the 7-day total recomputed from the daily values, not trusted.
5. *Freshness* — every station updated within 36 hours.

What this does **not** prove: that IMERG is right. It proves the two independent chains
(model forecast, satellite retrieval) agree or disagree at a known place and time, and it proves
the arithmetic between what the API returned and what the page displays. Those are different
claims and the panel keeps them separate.

## Architecture

```
browser
  ├── assets/data.js      embedded fallback register (works offline, never a blank shell)
  ├── assets/app.js       Supabase REST client · feed polling · all views
  └── assets/styles.css   design system, dark + light
        │
        ├── Supabase (PostgREST)  ── stations · thresholds · ENSO record · snapshot archive
        ├── Open-Meteo            ── weather, marine SST, CMIP6 climate
        └── NASA GIBS             ── IMERG + MODIS tiles
```

No build step, no bundler, no framework. Three files and a static host.

### Boot order

1. Paint from `assets/data.js` — instant, never blank.
2. Merge the Supabase register (stations, thresholds, ENSO record). If the backend is
   unreachable the console keeps the embedded register and says so in the Data panel.
3. Poll the live feeds; re-render.
4. Write one compact observation snapshot back to Supabase per session (throttled to 30 min).

---

## Supabase backend

Project region: `ap-south-1` (Mumbai). Tables are namespaced `eni_` so they can sit beside
other applications in the same project.

| Table | Purpose | Browser access |
|---|---|---|
| `eni_stations` | Station register (name, state, region, zone, coordinates) — adding a row adds a station everywhere, including the search | read |
| `eni_thresholds` | IMD heat and rainfall categories that drive the alert chips | read |
| `eni_enso_seasons` | RONI/ONI record by 3-month season | read |
| `eni_nino_regions` | Weekly Niño-box departures | read |
| `eni_outlook` | CPC outlook probabilities | read |
| `eni_snapshots` | Append-only archive of what the console observed | **insert only** |
| `eni_feedback` | Feedback form submissions | **insert only** |

Row-level security is on for every table. The browser key is a *publishable* key, so it is
safe to ship — it can only do what the policies allow:

- reference tables: `select` only;
- `eni_snapshots` / `eni_feedback`: `insert` only, and **not readable back** (verified: an
  anonymous select returns 0 rows);
- no write path to the station register at all (verified: an anonymous insert is rejected by RLS).

Apply the schema yourself with:

```bash
psql "$SUPABASE_DB_URL" -f supabase/schema.sql
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

### Adding a station

```sql
insert into public.eni_stations (id, name, country, region, zone, lat, lon, elevation_m, sort_order)
values ('kochi', 'Kochi', 'IN', 'south', 'coastal', 9.9312, 76.2673, 12, 155);
```

It appears in the map, the table, the aggregates and the CSV export on the next page load.

---

## Run locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` from the filesystem also works — the feeds are CORS-enabled.

## Deploy

Static host, no build. On GitHub Pages, Netlify or Vercel: publish the repository root.

- **GitHub Pages** — Settings → Pages → branch `main`, folder `/ (root)`.
- **Netlify** — `netlify.toml` is included; no build command, publish directory `.`.

## Keyboard

| Key | Action |
|---|---|
| `R` | Refresh every feed now |
| `T` | Toggle dark / light |
| `/` | Jump to the station search |
| `Esc` | Close the station drawer |

The map has its own controls: an **India / World** extent switch, a play button, a frame scrubber
and a 12 h / 24 h / 72 h loop span.

**Map navigation.** Drag to pan, pinch to zoom on touch, scroll-wheel or double-click to zoom on
desktop, and the `+` / `−` / `⌖` buttons in the corner for everything else. Tile zoom follows the
scale — push past 1.4× and the map pulls the next zoom level of imagery rather than stretching
what it has. Labels declutter themselves: when two stations would collide, the lower-priority one
drops its label and keeps its dot.

**Search.** The box in the sub-bar matches station name, state or province, country and region —
type `Kerala`, `Maharashtra` or `Odisha` and pick the station. It opens that station's drawer and
flies the map to it.

Region filters and the station drawer are also linkable: `?region=south`.

---

## Data sources and attribution

- **Open-Meteo** — weather, marine and CMIP6 climate APIs (CC-BY 4.0).
- **NASA GIBS / IMERG / MODIS** — satellite imagery (NASA, public domain).
- **NOAA Climate Prediction Center** — RONI, Niño departures, ENSO alert status and outlook.
- **Browserbase** — used to fetch the deployed page from outside the build environment, as an
  external check that the published site serves what the repository contains.
- **Sarvam** — translation of the briefing into eight Indian languages, and transliteration of all
  42 station names into Devanagari, Bengali and Tamil so that `कोलकाता`, `কলকাতা` or `கொல்கத்தா`
  find Kolkata. The English text is written for this console from the CPC record; the translations
  say the same thing and carry the same caveat.

### Listening, not just reading

The briefing has a **Listen** button that speaks the current language out loud, and a **Copy digest**
button that puts the briefing plus today's rain, heat, water and wind figures on the clipboard as a
plain-text summary — ready to paste into Slack, mail or WhatsApp.

The voice is the device's own speech engine (`speechSynthesis`), chosen by language tag. It is not
Sarvam TTS: no text-to-speech endpoint is wired into this build. The interface says so rather than
implying otherwise, and the call is a single function — swap `speakBriefing()` for a Sarvam TTS call
when a key is available and the rest of the page needs no change.
- **India Meteorological Department** — heat-wave thresholds and 24-hour rainfall categories.

Figures quoted in the interface are dated and attributed where they are shown. Nothing in this
repository invents a measurement: where a number is a model projection or a forecast, the panel
says so.

## Limits, stated plainly

- 19 stations is a sample of India, not a gridded analysis. Regional means are means of stations.
- The heat flags use IMD *absolute* thresholds. Departure-based heatwave criteria need 30-year
  normals, which this console does not fabricate; the short-term anomaly (vs the past 7 days) is
  reported separately and labelled as such.
- The climate panel is one downscaled CMIP6 grid point (22.0°N 79.0°E), not a national average.
- El Niño is not a guarantee of any particular Indian season — it shifts the odds.

## Licence

MIT — see [LICENSE](LICENSE).
