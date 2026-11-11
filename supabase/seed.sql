-- ═══════════════════════════════════════════════════════════════════════════
--  ENI · seed data
--  Every figure here is attributed: NOAA CPC for the ENSO record, IMD for the
--  heat and rainfall categories. Nothing in this file is invented.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── stations ───────────────────────────────────────────────────────────────
insert into public.eni_stations (id, name, country, region, zone, lat, lon, elevation_m, sort_order) values
  ('delhi',       'Delhi',              'IN', 'north',      'plains',  28.6139,  77.2090,  216, 10),
  ('jaipur',      'Jaipur',             'IN', 'north',      'plains',  26.9124,  75.7873,  431, 20),
  ('srinagar',    'Srinagar',           'IN', 'north',      'hills',   34.0837,  74.7973, 1585, 30),
  ('mumbai',      'Mumbai',             'IN', 'west',       'coastal', 19.0760,  72.8777,   14, 40),
  ('ahmedabad',   'Ahmedabad',          'IN', 'west',       'plains',  23.0225,  72.5714,   53, 50),
  ('nagpur',      'Nagpur',             'IN', 'central',    'plains',  21.1458,  79.0882,  310, 60),
  ('bhopal',      'Bhopal',             'IN', 'central',    'plains',  23.2599,  77.4126,  500, 70),
  ('kolkata',     'Kolkata',            'IN', 'east',       'plains',  22.5726,  88.3639,    9, 80),
  ('bhubaneswar', 'Bhubaneswar',        'IN', 'east',       'coastal', 20.2961,  85.8245,   45, 90),
  ('patna',       'Patna',              'IN', 'east',       'plains',  25.5941,  85.1376,   53, 100),
  ('guwahati',    'Guwahati',           'IN', 'northeast',  'plains',  26.1445,  91.7362,   55, 110),
  ('chennai',     'Chennai',            'IN', 'south',      'coastal', 13.0827,  80.2707,    6, 120),
  ('bengaluru',   'Bengaluru',          'IN', 'south',      'plains',  12.9716,  77.5946,  920, 130),
  ('hyderabad',   'Hyderabad',          'IN', 'south',      'plains',  17.3850,  78.4867,  542, 140),
  ('trivandrum',  'Thiruvananthapuram', 'IN', 'south',      'coastal',  8.5241,  76.9366,   10, 150),
  ('karachi',     'Karachi',            'PK', 'neighbours', 'coastal', 24.8607,  67.0011,    8, 160),
  ('dhaka',       'Dhaka',              'BD', 'neighbours', 'plains',  23.8103,  90.4125,    4, 170),
  ('kathmandu',   'Kathmandu',          'NP', 'neighbours', 'hills',   27.7172,  85.3240, 1400, 180),
  ('colombo',     'Colombo',            'LK', 'neighbours', 'coastal',  6.9271,  79.8612,    7, 190)
on conflict (id) do update set
  name = excluded.name, country = excluded.country, region = excluded.region,
  zone = excluded.zone, lat = excluded.lat, lon = excluded.lon,
  elevation_m = excluded.elevation_m, sort_order = excluded.sort_order;

-- ── IMD thresholds ─────────────────────────────────────────────────────────
insert into public.eni_thresholds (id, kind, zone, label, min_value, max_value, severity, note) values
  ('heat-plains',  'heat', 'plains',  'Heat wave — plains',  40, null, 3, 'IMD: maximum ≥ 40 °C over the plains'),
  ('heat-coastal', 'heat', 'coastal', 'Heat wave — coastal', 37, null, 3, 'IMD: maximum ≥ 37 °C along the coast'),
  ('heat-hills',   'heat', 'hills',   'Heat wave — hills',   30, null, 3, 'IMD: maximum ≥ 30 °C in the hills'),
  ('rain-dry',     'rain', null, 'Dry',             0,    0.1,  0, 'No measurable rain'),
  ('rain-light',   'rain', null, 'Light',           0.1,  2.5,  1, 'IMD 24 h category'),
  ('rain-mod',     'rain', null, 'Moderate',        2.5,  7.6,  2, 'IMD 24 h category'),
  ('rain-heavy',   'rain', null, 'Heavy',           7.6,  35.6, 3, 'IMD 24 h category'),
  ('rain-vheavy',  'rain', null, 'Very heavy',      35.6, 64.5, 4, 'IMD 24 h category'),
  ('rain-xheavy',  'rain', null, 'Extremely heavy', 64.5, null, 5, 'IMD 24 h category')
on conflict (id) do update set
  kind = excluded.kind, zone = excluded.zone, label = excluded.label,
  min_value = excluded.min_value, max_value = excluded.max_value,
  severity = excluded.severity, note = excluded.note;

-- ── ENSO record, 2026 ──────────────────────────────────────────────────────
-- RONI 3-month running means from the NOAA CPC table. ONI is populated only
-- where the classic index has been published for the season.
insert into public.eni_enso_seasons (season, year, season_order, roni, oni, phase, source) values
  ('DJF', 2026,  1, -0.9, null, 'la_nina', 'NOAA CPC'),
  ('MAM', 2026,  4,  0.0, null, 'neutral', 'NOAA CPC'),
  ('AMJ', 2026,  5,  0.5, null, 'el_nino', 'NOAA CPC'),
  ('MJJ', 2026,  6,  1.0, null, 'el_nino', 'NOAA CPC'),
  ('JJA', 2026,  7,  1.4, null, 'el_nino', 'NOAA CPC'),
  ('JAS', 2026,  8,  1.7, null, 'el_nino', 'NOAA CPC'),
  ('ASO', 2026,  9,  2.0, 2.46, 'el_nino', 'NOAA CPC')
on conflict (season, year) do update set
  roni = excluded.roni, oni = excluded.oni, phase = excluded.phase, source = excluded.source;

-- ── Niño monitoring regions, week of 9 Nov 2026 ────────────────────────────
insert into public.eni_nino_regions (name, departure, lat_min, lat_max, lon_min, lon_max, sort_order, observed_on) values
  ('Niño 4',   0.2,  5, -5, 160,  -150, 10, '2026-11-09'),
  ('Niño 3.4', 2.3,  5, -5, -170, -120, 20, '2026-11-09'),
  ('Niño 3',   3.5,  5, -5, -150, -90,  30, '2026-11-09'),
  ('Niño 1+2', 4.7,  0, -10, -90,  -80,  40, '2026-11-09')
on conflict (name) do update set
  departure = excluded.departure, observed_on = excluded.observed_on;

-- ── outlook probabilities, CPC (issued 8 Oct 2026) ─────────────────────────
insert into public.eni_outlook (period, probability, statement, issued_on) values
  ('Sep–Nov 2026', 54, 'RONI at or above +2.5 °C', '2026-10-08'),
  ('Oct–Dec 2026', 83, 'RONI at or above +2.5 °C', '2026-10-08'),
  ('Nov–Jan 2027', 70, 'RONI at or above +2.5 °C', '2026-10-08'),
  ('Jan–Mar 2027', 83, 'strong-to-very-strong event', '2026-10-08')
on conflict (period) do update set
  probability = excluded.probability, statement = excluded.statement, issued_on = excluded.issued_on;

-- ── state / province names (used by the search box) ────────────────────────
alter table public.eni_stations add column if not exists state_name text;

update public.eni_stations s
   set state_name = v.state_name
  from (values
  ('delhi', 'Delhi'),
  ('jaipur', 'Rajasthan'),
  ('srinagar', 'Jammu & Kashmir'),
  ('mumbai', 'Maharashtra'),
  ('ahmedabad', 'Gujarat'),
  ('nagpur', 'Maharashtra'),
  ('bhopal', 'Madhya Pradesh'),
  ('kolkata', 'West Bengal'),
  ('bhubaneswar', 'Odisha'),
  ('patna', 'Bihar'),
  ('guwahati', 'Assam'),
  ('chennai', 'Tamil Nadu'),
  ('bengaluru', 'Karnataka'),
  ('hyderabad', 'Telangana'),
  ('trivandrum', 'Kerala'),
  ('karachi', 'Sindh'),
  ('dhaka', 'Dhaka'),
  ('kathmandu', 'Bagmati'),
  ('colombo', 'Western')
  ) as v(id, state_name)
 where s.id = v.id;
