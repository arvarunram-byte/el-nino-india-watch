-- ═══════════════════════════════════════════════════════════════════════════
--  ENI · El Niño / India watch — Supabase schema
--  Apply with:  supabase db push   (or paste into the SQL editor)
--  All objects are namespaced `eni_` so they can live beside other apps in
--  the same project without collisions.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ── station register ───────────────────────────────────────────────────────
-- The console reads this at boot; adding a row adds a station to the map,
-- the table, the aggregates and the CSV export.
create table if not exists public.eni_stations (
  id          text primary key,
  name        text        not null,
  country     text        not null default 'IN',
  region      text        not null check (region in ('north','west','central','east','northeast','south','neighbours')),
  zone        text        not null check (zone in ('plains','coastal','hills')),
  lat         double precision not null check (lat between -90 and 90),
  lon         double precision not null check (lon between -180 and 180),
  elevation_m integer,
  active      boolean     not null default true,
  sort_order  integer     not null default 100,
  created_at  timestamptz not null default now()
);
create index if not exists eni_stations_region_idx on public.eni_stations (region) where active;

-- ── IMD thresholds ─────────────────────────────────────────────────────────
-- Data-driven alert rules. `kind='heat'` uses zone; `kind='rain'` uses min/max.
create table if not exists public.eni_thresholds (
  id         text primary key,
  kind       text not null check (kind in ('heat','rain')),
  zone       text check (zone in ('plains','coastal','hills')),
  label      text not null,
  min_value  numeric not null,
  max_value  numeric,
  severity   integer not null default 1 check (severity between 0 and 5),
  note       text
);

-- ── ENSO record ────────────────────────────────────────────────────────────
-- One row per overlapping 3-month season. `roni` is the operational index
-- since Feb 2026; `oni` is kept where the classic index is published.
create table if not exists public.eni_enso_seasons (
  season       text not null check (season in ('DJF','JFM','FMA','MAM','AMJ','MJJ','JJA','JAS','ASO','SON','OND','NDJ')),
  year         integer not null,
  season_order integer not null,
  roni         numeric,
  oni          numeric,
  phase        text not null check (phase in ('el_nino','la_nina','neutral')),
  source       text not null default 'NOAA CPC',
  primary key (season, year)
);
create index if not exists eni_enso_recent_idx on public.eni_enso_seasons (year desc, season_order desc);

create table if not exists public.eni_nino_regions (
  name        text primary key,
  departure   numeric not null,
  lat_min     numeric, lat_max numeric,
  lon_min     numeric, lon_max numeric,
  sort_order  integer not null default 100,
  observed_on date not null default current_date
);

create table if not exists public.eni_outlook (
  period       text primary key,
  probability  integer not null check (probability between 0 and 100),
  statement    text not null,
  issued_on    date not null default current_date
);

-- ── observation archive (write-only for the browser) ───────────────────────
create table if not exists public.eni_snapshots (
  id               bigserial primary key,
  captured_at      timestamptz not null default now(),
  region           text not null default 'all',
  station_count    integer,
  mean_rain_today  numeric,
  mean_tmax        numeric,
  mean_feels       numeric,
  payload          jsonb,
  client           text default 'eni-web'
);
create index if not exists eni_snapshots_time_idx on public.eni_snapshots (captured_at desc);

create table if not exists public.eni_feedback (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  kind         text not null default 'other',
  message      text not null check (char_length(message) between 3 and 600),
  contact      text,
  page_region  text
);

-- ═══════════════════════════════════════════════════════════════════════════
--  Row-level security
--  Reference tables: world-readable, service-role writable.
--  Archive tables:   insert-only for the browser, never readable by it.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.eni_stations     enable row level security;
alter table public.eni_thresholds   enable row level security;
alter table public.eni_enso_seasons enable row level security;
alter table public.eni_nino_regions enable row level security;
alter table public.eni_outlook      enable row level security;
alter table public.eni_snapshots    enable row level security;
alter table public.eni_feedback     enable row level security;

drop policy if exists "eni_stations_read"     on public.eni_stations;
drop policy if exists "eni_thresholds_read"   on public.eni_thresholds;
drop policy if exists "eni_enso_read"         on public.eni_enso_seasons;
drop policy if exists "eni_nino_read"         on public.eni_nino_regions;
drop policy if exists "eni_outlook_read"      on public.eni_outlook;
drop policy if exists "eni_snapshots_insert"  on public.eni_snapshots;
drop policy if exists "eni_feedback_insert"   on public.eni_feedback;

create policy "eni_stations_read"   on public.eni_stations     for select using (true);
create policy "eni_thresholds_read" on public.eni_thresholds   for select using (true);
create policy "eni_enso_read"       on public.eni_enso_seasons for select using (true);
create policy "eni_nino_read"       on public.eni_nino_regions for select using (true);
create policy "eni_outlook_read"    on public.eni_outlook      for select using (true);

-- anonymous clients may append, but never read back
create policy "eni_snapshots_insert" on public.eni_snapshots for insert with check (
  station_count is null or station_count between 0 and 500
);
create policy "eni_feedback_insert" on public.eni_feedback for insert with check (
  char_length(message) between 3 and 600
);

grant select on public.eni_stations, public.eni_thresholds, public.eni_enso_seasons,
                public.eni_nino_regions, public.eni_outlook to anon, authenticated;
grant insert on public.eni_snapshots, public.eni_feedback to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- ── convenience view: latest state of the ENSO record ──────────────────────
create or replace view public.eni_enso_latest
with (security_invoker = true) as
select season, year, roni, oni, phase, source
from public.eni_enso_seasons
order by year desc, season_order desc
limit 12;

grant select on public.eni_enso_latest to anon, authenticated;
