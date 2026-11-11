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
    { id: "gurugram", name: "Gurugram", st: "Haryana", country: "IN", region: "north", zone: "plains", lat: 28.4595, lon: 77.0266, elevation_m: 217 },
    { id: "delhi", name: "Delhi", st: "Delhi", country: "IN", region: "north", zone: "plains", lat: 28.6139, lon: 77.209, elevation_m: 216 },
    { id: "jaipur", name: "Jaipur", st: "Rajasthan", country: "IN", region: "north", zone: "plains", lat: 26.9124, lon: 75.7873, elevation_m: 431 },
    { id: "srinagar", name: "Srinagar", st: "Jammu & Kashmir", country: "IN", region: "north", zone: "hills", lat: 34.0837, lon: 74.7973, elevation_m: 1585 },
    { id: "leh", name: "Leh", st: "Ladakh", country: "IN", region: "north", zone: "hills", lat: 34.1526, lon: 77.5771, elevation_m: 3500 },
    { id: "shimla", name: "Shimla", st: "Himachal Pradesh", country: "IN", region: "north", zone: "hills", lat: 31.1048, lon: 77.1734, elevation_m: 2276 },
    { id: "chandigarh", name: "Chandigarh", st: "Chandigarh", country: "IN", region: "north", zone: "plains", lat: 30.7333, lon: 76.7794, elevation_m: 321 },
    { id: "amritsar", name: "Amritsar", st: "Punjab", country: "IN", region: "north", zone: "plains", lat: 31.634, lon: 74.8723, elevation_m: 234 },
    { id: "dehradun", name: "Dehradun", st: "Uttarakhand", country: "IN", region: "north", zone: "hills", lat: 30.3165, lon: 78.0322, elevation_m: 640 },
    { id: "lucknow", name: "Lucknow", st: "Uttar Pradesh", country: "IN", region: "north", zone: "plains", lat: 26.8467, lon: 80.9462, elevation_m: 123 },
    { id: "patna", name: "Patna", st: "Bihar", country: "IN", region: "east", zone: "plains", lat: 25.5941, lon: 85.1376, elevation_m: 53 },
    { id: "ranchi", name: "Ranchi", st: "Jharkhand", country: "IN", region: "east", zone: "plains", lat: 23.3441, lon: 85.3096, elevation_m: 651 },
    { id: "kolkata", name: "Kolkata", st: "West Bengal", country: "IN", region: "east", zone: "plains", lat: 22.5726, lon: 88.3639, elevation_m: 9 },
    { id: "bhubaneswar", name: "Bhubaneswar", st: "Odisha", country: "IN", region: "east", zone: "coastal", lat: 20.2961, lon: 85.8245, elevation_m: 45 },
    { id: "raipur", name: "Raipur", st: "Chhattisgarh", country: "IN", region: "central", zone: "plains", lat: 21.2514, lon: 81.6296, elevation_m: 298 },
    { id: "bhopal", name: "Bhopal", st: "Madhya Pradesh", country: "IN", region: "central", zone: "plains", lat: 23.2599, lon: 77.4126, elevation_m: 500 },
    { id: "nagpur", name: "Nagpur", st: "Maharashtra", country: "IN", region: "central", zone: "plains", lat: 21.1458, lon: 79.0882, elevation_m: 310 },
    { id: "mumbai", name: "Mumbai", st: "Maharashtra", country: "IN", region: "west", zone: "coastal", lat: 19.076, lon: 72.8777, elevation_m: 14 },
    { id: "panaji", name: "Panaji", st: "Goa", country: "IN", region: "west", zone: "coastal", lat: 15.4909, lon: 73.8278, elevation_m: 7 },
    { id: "ahmedabad", name: "Ahmedabad", st: "Gujarat", country: "IN", region: "west", zone: "plains", lat: 23.0225, lon: 72.5714, elevation_m: 53 },
    { id: "daman", name: "Daman", st: "Dadra & Nagar Haveli and Daman & Diu", country: "IN", region: "west", zone: "coastal", lat: 20.3974, lon: 72.8328, elevation_m: 5 },
    { id: "itanagar", name: "Itanagar", st: "Arunachal Pradesh", country: "IN", region: "northeast", zone: "plains", lat: 27.0844, lon: 93.6053, elevation_m: 440 },
    { id: "guwahati", name: "Guwahati", st: "Assam", country: "IN", region: "northeast", zone: "plains", lat: 26.1445, lon: 91.7362, elevation_m: 55 },
    { id: "shillong", name: "Shillong", st: "Meghalaya", country: "IN", region: "northeast", zone: "hills", lat: 25.5788, lon: 91.8933, elevation_m: 1496 },
    { id: "imphal", name: "Imphal", st: "Manipur", country: "IN", region: "northeast", zone: "plains", lat: 24.817, lon: 93.9368, elevation_m: 786 },
    { id: "aizawl", name: "Aizawl", st: "Mizoram", country: "IN", region: "northeast", zone: "hills", lat: 23.7271, lon: 92.7176, elevation_m: 1132 },
    { id: "kohima", name: "Kohima", st: "Nagaland", country: "IN", region: "northeast", zone: "hills", lat: 25.6751, lon: 94.1086, elevation_m: 1444 },
    { id: "agartala", name: "Agartala", st: "Tripura", country: "IN", region: "northeast", zone: "plains", lat: 23.8315, lon: 91.2868, elevation_m: 16 },
    { id: "gangtok", name: "Gangtok", st: "Sikkim", country: "IN", region: "northeast", zone: "hills", lat: 27.3389, lon: 88.6065, elevation_m: 1650 },
    { id: "hyderabad", name: "Hyderabad", st: "Telangana", country: "IN", region: "south", zone: "plains", lat: 17.385, lon: 78.4867, elevation_m: 542 },
    { id: "amaravati", name: "Amaravati", st: "Andhra Pradesh", country: "IN", region: "south", zone: "coastal", lat: 16.5131, lon: 80.5165, elevation_m: 23 },
    { id: "visakhapatnam", name: "Visakhapatnam", st: "Andhra Pradesh", country: "IN", region: "south", zone: "coastal", lat: 17.6868, lon: 83.2185, elevation_m: 45 },
    { id: "chennai", name: "Chennai", st: "Tamil Nadu", country: "IN", region: "south", zone: "coastal", lat: 13.0827, lon: 80.2707, elevation_m: 6 },
    { id: "bengaluru", name: "Bengaluru", st: "Karnataka", country: "IN", region: "south", zone: "plains", lat: 12.9716, lon: 77.5946, elevation_m: 920 },
    { id: "trivandrum", name: "Thiruvananthapuram", st: "Kerala", country: "IN", region: "south", zone: "coastal", lat: 8.5241, lon: 76.9366, elevation_m: 10 },
    { id: "puducherry", name: "Puducherry", st: "Puducherry", country: "IN", region: "south", zone: "coastal", lat: 11.9416, lon: 79.8083, elevation_m: 3 },
    { id: "portblair", name: "Port Blair", st: "Andaman & Nicobar Islands", country: "IN", region: "south", zone: "coastal", lat: 11.6234, lon: 92.7265, elevation_m: 16 },
    { id: "kavaratti", name: "Kavaratti", st: "Lakshadweep", country: "IN", region: "south", zone: "coastal", lat: 10.5669, lon: 72.642, elevation_m: 2 },
    { id: "karachi", name: "Karachi", st: "Sindh", country: "PK", region: "neighbours", zone: "coastal", lat: 24.8607, lon: 67.0011, elevation_m: 8 },
    { id: "dhaka", name: "Dhaka", st: "Dhaka", country: "BD", region: "neighbours", zone: "plains", lat: 23.8103, lon: 90.4125, elevation_m: 4 },
    { id: "kathmandu", name: "Kathmandu", st: "Bagmati", country: "NP", region: "neighbours", zone: "hills", lat: 27.7172, lon: 85.324, elevation_m: 1400 },
    { id: "colombo", name: "Colombo", st: "Western", country: "LK", region: "neighbours", zone: "coastal", lat: 6.9271, lon: 79.8612, elevation_m: 7 }
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
