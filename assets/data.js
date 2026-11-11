/* ═══════════════════════════════════════════════════════════════════════════
   ENI · El Niño / India Watch — embedded reference data
   ---------------------------------------------------------------------------
   This file is the offline fallback. The live site reads stations, thresholds
   and the ENSO record from Supabase; if the backend is unreachable it renders
   from here instead, so the console never shows an empty shell.
   ═══════════════════════════════════════════════════════════════════════════ */
window.ENI = (function () {
  "use strict";

  /* Supabase — publishable key, safe for the browser. All access is governed
     by row-level security: read-only on reference tables, insert-only on
     snapshots and feedback. See supabase/schema.sql. */
  var SUPABASE = {
    url: "https://iydpxrgouggyqkuzztea.supabase.co",
    key: "sb_publishable_2gpKvcYXHE3vbFYYV5GoUw_aNqVZJUr"
  };

  /* Stations: India plus the immediate neighbourhood. `region` drives the
     filter chips, `zone` drives the IMD heat threshold that applies. */
  var STATIONS = [
    { id: "delhi",         name: "Delhi",              country: "IN", region: "north",      zone: "plains",  lat: 28.6139, lon: 77.2090, elevation_m: 216 },
    { id: "jaipur",        name: "Jaipur",             country: "IN", region: "north",      zone: "plains",  lat: 26.9124, lon: 75.7873, elevation_m: 431 },
    { id: "srinagar",      name: "Srinagar",           country: "IN", region: "north",      zone: "hills",   lat: 34.0837, lon: 74.7973, elevation_m: 1585 },
    { id: "mumbai",        name: "Mumbai",             country: "IN", region: "west",       zone: "coastal", lat: 19.0760, lon: 72.8777, elevation_m: 14 },
    { id: "ahmedabad",     name: "Ahmedabad",          country: "IN", region: "west",       zone: "plains",  lat: 23.0225, lon: 72.5714, elevation_m: 53 },
    { id: "nagpur",        name: "Nagpur",             country: "IN", region: "central",    zone: "plains",  lat: 21.1458, lon: 79.0882, elevation_m: 310 },
    { id: "bhopal",        name: "Bhopal",             country: "IN", region: "central",    zone: "plains",  lat: 23.2599, lon: 77.4126, elevation_m: 500 },
    { id: "kolkata",       name: "Kolkata",            country: "IN", region: "east",       zone: "plains",  lat: 22.5726, lon: 88.3639, elevation_m: 9 },
    { id: "bhubaneswar",   name: "Bhubaneswar",        country: "IN", region: "east",       zone: "coastal", lat: 20.2961, lon: 85.8245, elevation_m: 45 },
    { id: "patna",         name: "Patna",              country: "IN", region: "east",       zone: "plains",  lat: 25.5941, lon: 85.1376, elevation_m: 53 },
    { id: "guwahati",      name: "Guwahati",           country: "IN", region: "northeast",  zone: "plains",  lat: 26.1445, lon: 91.7362, elevation_m: 55 },
    { id: "chennai",       name: "Chennai",            country: "IN", region: "south",      zone: "coastal", lat: 13.0827, lon: 80.2707, elevation_m: 6 },
    { id: "bengaluru",     name: "Bengaluru",          country: "IN", region: "south",      zone: "plains",  lat: 12.9716, lon: 77.5946, elevation_m: 920 },
    { id: "hyderabad",     name: "Hyderabad",          country: "IN", region: "south",      zone: "plains",  lat: 17.3850, lon: 78.4867, elevation_m: 542 },
    { id: "trivandrum",    name: "Thiruvananthapuram", country: "IN", region: "south",      zone: "coastal", lat: 8.5241,  lon: 76.9366, elevation_m: 10 },
    { id: "karachi",       name: "Karachi",            country: "PK", region: "neighbours", zone: "coastal", lat: 24.8607, lon: 67.0011, elevation_m: 8 },
    { id: "dhaka",         name: "Dhaka",              country: "BD", region: "neighbours", zone: "plains",  lat: 23.8103, lon: 90.4125, elevation_m: 4 },
    { id: "kathmandu",     name: "Kathmandu",          country: "NP", region: "neighbours", zone: "hills",   lat: 27.7172, lon: 85.3240, elevation_m: 1400 },
    { id: "colombo",       name: "Colombo",            country: "LK", region: "neighbours", zone: "coastal", lat: 6.9271,  lon: 79.8612, elevation_m: 7 }
  ];

  var REGIONS = [
    { id: "all",        label: "All India +" },
    { id: "north",      label: "North" },
    { id: "west",       label: "West" },
    { id: "central",    label: "Central" },
    { id: "east",       label: "East" },
    { id: "northeast",  label: "North-East" },
    { id: "south",      label: "South" },
    { id: "neighbours", label: "Neighbours" }
  ];

  /* IMD heat thresholds by terrain (air temperature, °C). Departure-based
     heatwave criteria need 30-year normals, which this console does not
     invent — it flags absolute thresholds and reports the short-term anomaly
     separately. */
  var HEAT = { plains: 40, coastal: 37, hills: 30 };

  /* IMD 24-hour rainfall categories, mm. */
  var RAIN = [
    { id: "dry",   label: "Dry",          min: 0,     max: 0.1,   severity: 0 },
    { id: "light", label: "Light",        min: 0.1,   max: 2.5,   severity: 1 },
    { id: "mod",   label: "Moderate",     min: 2.5,   max: 7.6,   severity: 2 },
    { id: "heavy", label: "Heavy",        min: 7.6,   max: 35.6,  severity: 3 },
    { id: "vheavy",label: "Very heavy",   min: 35.6,  max: 64.5,  severity: 4 },
    { id: "xheavy",label: "Extremely heavy", min: 64.5, max: null, severity: 5 }
  ];

  /* NOAA CPC ENSO Diagnostic Discussion, 9 Nov 2026 (weekly OISSTv2.1) */
  var NINO_REGIONS = [
    { name: "Niño 4",   departure: 0.2 },
    { name: "Niño 3.4", departure: 2.3 },
    { name: "Niño 3",   departure: 3.5 },
    { name: "Niño 1+2", departure: 4.7 }
  ];

  /* RONI 3-month running means, 2026 (NOAA CPC table) */
  var ENSO_SEASONS = [
    { season: "DJF", year: 2026, roni: -0.9, oni: null, phase: "la_nina" },
    { season: "MAM", year: 2026, roni: 0.0,  oni: null, phase: "neutral" },
    { season: "AMJ", year: 2026, roni: 0.5,  oni: null, phase: "neutral" },
    { season: "MJJ", year: 2026, roni: 1.0,  oni: null, phase: "el_nino" },
    { season: "JJA", year: 2026, roni: 1.4,  oni: null, phase: "el_nino" },
    { season: "JAS", year: 2026, roni: 1.7,  oni: null, phase: "el_nino" },
    { season: "ASO", year: 2026, roni: 2.0,  oni: 2.46, phase: "el_nino" }
  ];

  var OUTLOOK = [
    { window: "Sep–Nov 2026", probability: 54, statement: "RONI at or above +2.5 °C" },
    { window: "Oct–Dec 2026", probability: 83, statement: "RONI at or above +2.5 °C" },
    { window: "Nov–Jan 2027", probability: 70, statement: "RONI at or above +2.5 °C" },
    { window: "Jan–Mar 2027", probability: 83, statement: "strong-to-very-strong event" }
  ];

  var STATUS = {
    alert: "El Niño Advisory",
    issued: "2026-11-09",
    agency: "NOAA Climate Prediction Center",
    roni: 2.0,
    roniPeriod: "ASO 2026",
    weekly_nino34: 2.3,
    weekly_nino12: 4.7
  };

  return {
    SUPABASE: SUPABASE,
    STATIONS: STATIONS,
    REGIONS: REGIONS,
    HEAT: HEAT,
    RAIN: RAIN,
    NINO_REGIONS: NINO_REGIONS,
    ENSO_SEASONS: ENSO_SEASONS,
    OUTLOOK: OUTLOOK,
    STATUS: STATUS,
    MAP_CENTRE: { lat: 20.5, lon: 79.0 }
  };
})();
