/* ═══════════════════════════════════════════════════════════════════════════
   ENI · El Niño / India watch — application
   ---------------------------------------------------------------------------
   Layers, in boot order:
     1. paint from embedded reference data (assets/data.js) — instant, never blank
     2. merge the Supabase register (stations / thresholds / ENSO record)
     3. poll live feeds every 60 s (Open-Meteo weather, marine, CMIP6 climate)
     4. write one compact observation snapshot back to Supabase per session
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var REF = window.ENI;
  var SB = REF.SUPABASE;
  var RING_LEN = 72.88;
  var POLL_SECONDS = 60;

  var state = {
    stations: REF.STATIONS.slice(),
    thresholds: { heat: REF.HEAT, rain: REF.RAIN },
    seasons: REF.ENSO_SEASONS.slice(),
    nino: REF.NINO_REGIONS.slice(),
    outlook: REF.OUTLOOK.slice(),
    region: "all",
    sort: { key: "p7", dir: -1 },
    rows: [],
    byId: {},
    layer: "precip",
    sceneOffset: 1,
    cycle: 0,
    busy: false,
    nextTick: POLL_SECONDS,
    backend: "unknown",   // 'live' | 'fallback'
    selected: null
  };

  /* ── utilities ───────────────────────────────────────────────────────── */
  function getJSON(url, ms) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, ms || 22000);
    return fetch(url, { signal: ctl.signal, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .finally(function () { clearTimeout(t); });
  }
  function sum(a) { return a.reduce(function (x, y) { return x + (isFinite(y) ? y : 0); }, 0); }
  function mean(a) { return a.length ? sum(a) / a.length : NaN; }
  function num(v) { return typeof v === "number" && isFinite(v); }
  function fx(v, d) { d = d === undefined ? 1 : d; return num(v) ? v.toFixed(d) : "—"; }
  function sgn(v, d) { d = d === undefined ? 1 : d; return num(v) ? (v > 0 ? "+" : "") + v.toFixed(d) : "—"; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined) e.textContent = txt;
    return e;
  }
  function setText(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
  function setHTML(id, v) { var e = document.getElementById(id); if (e) e.innerHTML = v; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var store = {
    get: function (k, fb) { try { var v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  function toast(msg) {
    var t = $("#toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("is-on"); }, 2400);
  }

  /* ── Supabase REST ───────────────────────────────────────────────────── */
  function sbHeaders(extra) {
    var h = {
      "apikey": SB.key,
      "Authorization": "Bearer " + SB.key,
      "Content-Type": "application/json"
    };
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }
  function sbGet(path, ms) {
    return getJSON(SB.url + "/rest/v1/" + path, ms || 9000);
  }
  function sbPost(table, body) {
    return fetch(SB.url + "/rest/v1/" + table, {
      method: "POST",
      headers: sbHeaders({ "Prefer": "return=minimal" }),
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error("HTTP " + r.status + " " + t.slice(0, 160)); });
      return true;
    });
  }

  /* ── 1 · backend merge ───────────────────────────────────────────────── */
  function loadBackend() {
    var stationsP = sbGet("eni_stations?select=*&active=eq.true&order=sort_order.asc")
      .then(function (rows) {
        if (!Array.isArray(rows) || !rows.length) throw new Error("empty");
        return rows.map(function (r) {
          return {
            id: r.id, name: r.name, country: r.country, region: r.region, zone: r.zone,
            lat: +r.lat, lon: +r.lon, elevation_m: r.elevation_m
          };
        });
      });

    var ensoP = sbGet("eni_enso_seasons?select=*&order=year.asc,season_order.asc")
      .then(function (rows) { return Array.isArray(rows) && rows.length ? rows : null; });

    var ninoP = sbGet("eni_nino_regions?select=*&order=sort_order.asc")
      .then(function (rows) { return Array.isArray(rows) && rows.length ? rows : null; });

    var thrP = sbGet("eni_thresholds?select=*&order=kind.asc,min_value.asc")
      .then(function (rows) { return Array.isArray(rows) && rows.length ? rows : null; });

    return Promise.all([stationsP, ensoP, ninoP, thrP]).then(function (res) {
      state.stations = res[0];
      if (res[1]) {
        state.seasons = res[1].map(function (r) {
          return { season: r.season, year: r.year, roni: r.roni === null ? null : +r.roni, oni: r.oni === null ? null : +r.oni, phase: r.phase };
        });
      }
      if (res[2]) state.nino = res[2].map(function (r) { return { name: r.name, departure: +r.departure }; });
      if (res[3]) {
        var heat = {};
        var rain = [];
        res[3].forEach(function (r) {
          if (r.kind === "heat") heat[r.zone] = +r.min_value;
          if (r.kind === "rain") rain.push({ id: r.id, label: r.label, min: +r.min_value, max: r.max_value === null ? null : +r.max_value, severity: r.severity });
        });
        state.thresholds = { heat: Object.keys(heat).length ? heat : REF.HEAT, rain: rain.length ? rain : REF.RAIN };
      }
      state.backend = "live";
      setText("backendMeta", "supabase · live register");
      var host = $("#sbHost");
      if (host) host.textContent = SB.url.replace("https://", "") + "/rest/v1";
      renderStatic();
      return true;
    });
  }

  /* ── 2 · weather ─────────────────────────────────────────────────────── */
  function fetchWeatherGroup(list) {
    var lat = list.map(function (c) { return c.lat; }).join(",");
    var lon = list.map(function (c) { return c.lon; }).join(",");
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon
      + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m"
      + "&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,apparent_temperature_max"
      + "&past_days=92&forecast_days=7&timezone=Asia%2FKolkata";
    return getJSON(url).then(function (j) { return Array.isArray(j) ? j : [j]; });
  }

  function loadWeather() {
    var all = state.stations;
    var groups = [];
    for (var i = 0; i < all.length; i += 8) groups.push(all.slice(i, i + 8));

    return Promise.all(groups.map(function (g) {
      return fetchWeatherGroup(g).then(function (v) { return { ok: true, list: g, value: v }; },
        function (e) { return { ok: false, list: g, error: e }; });
    })).then(function (res) {
      var rows = [];
      res.forEach(function (r) {
        if (!r.ok) return;
        r.value.forEach(function (d, i) {
          var st = r.list[i];
          if (!st || !d || !d.daily) return;
          rows.push(buildRow(st, d));
        });
      });
      if (!rows.length) throw new Error("weather feeds unreachable");
      return rows;
    });
  }

  function buildRow(st, d) {
    var dl = d.daily || {};
    var p = (dl.precipitation_sum || []).map(function (v) { return num(v) ? v : 0; });
    var tmax = (dl.temperature_2m_max || []).map(function (v) { return num(v) ? v : NaN; });
    var tmin = (dl.temperature_2m_min || []).map(function (v) { return num(v) ? v : NaN; });
    var times = dl.time || [];
    var cur = d.current || {};
    var todayMax = tmax[92];
    var past7 = tmax.slice(85, 92).filter(num);
    var wkMean = past7.length ? mean(past7) : NaN;
    var anom = (num(todayMax) && num(wkMean)) ? todayMax - wkMean : NaN;
    var thr = state.thresholds.heat[st.zone] || 40;
    var flag = "normal";
    if (num(todayMax) && todayMax >= thr) flag = "heat";
    else if (num(anom) && anom >= 3) flag = "hot";
    else if (num(anom) && anom <= -3) flag = "cool";

    return {
      station: st,
      now: num(cur.precipitation) ? cur.precipitation : 0,
      today: p[92] || 0,
      p7: sum(p.slice(86, 93)),
      p30: sum(p.slice(63, 93)),
      pPrev30: sum(p.slice(33, 63)),
      p92: sum(p.slice(0, 92)),
      tmaxToday: todayMax,
      tminToday: tmin[92],
      feels: num(cur.apparent_temperature) ? cur.apparent_temperature : NaN,
      temp: num(cur.temperature_2m) ? cur.temperature_2m : NaN,
      rh: num(cur.relative_humidity_2m) ? cur.relative_humidity_2m : NaN,
      wind: num(cur.wind_speed_10m) ? cur.wind_speed_10m : NaN,
      anom7: anom,
      flag: flag,
      threshold: thr,
      precip: p,
      tmax: tmax,
      times: times,
      fcstRain: p.slice(93, 100),
      fcstMax: tmax.slice(93, 100),
      fcstTimes: times.slice(93, 100)
    };
  }

  /* ── 3 · Pacific SST ─────────────────────────────────────────────────── */
  var NINO_BOX = [
    { k: "Niño 4",   lat: 0,  lon: -175, c: "#5b8fb0" },
    { k: "Niño 3.4", lat: 0,  lon: -145, c: "#d0533f" },
    { k: "Niño 3",   lat: 0,  lon: -120, c: "#e08a2e" },
    { k: "Niño 1+2", lat: -5, lon: -85,  c: "#3fa9b8" }
  ];

  function buildSst(arr) {
    return arr.map(function (d, i) {
      var h = (d && d.hourly) || {};
      var times = h.time || [], vals = h.sea_surface_temperature || [];
      var daily = {};
      times.forEach(function (t, k) {
        var v = vals[k];
        if (!num(v)) return;
        var day = t.slice(0, 10);
        if (!daily[day]) daily[day] = { s: 0, n: 0 };
        daily[day].s += v; daily[day].n++;
      });
      var days = Object.keys(daily).sort();
      var series = days.map(function (dd) { return +(daily[dd].s / daily[dd].n).toFixed(2); });
      var box = NINO_BOX[i] || { k: "—", c: "#8e98a4" };
      return { k: box.k, c: box.c, series: series, labels: days, last: series.length ? series[series.length - 1] : NaN };
    }).filter(function (b) { return b.series.length > 3; });
  }

  function loadSst() {
    var q = "&hourly=sea_surface_temperature&past_days=31&forecast_days=1&timezone=GMT";
    var multi = "https://marine-api.open-meteo.com/v1/marine?latitude="
      + NINO_BOX.map(function (b) { return b.lat; }).join(",")
      + "&longitude=" + NINO_BOX.map(function (b) { return b.lon; }).join(",") + q;

    return getJSON(multi, 15000).then(function (j) {
      if (!Array.isArray(j) || j.length < 2) throw new Error("no multi");
      var built = buildSst(j);
      if (built.length >= 2) return built;
      throw new Error("empty multi");
    }).catch(function () {
      return Promise.all(NINO_BOX.map(function (b) {
        var u = "https://marine-api.open-meteo.com/v1/marine?latitude=" + b.lat + "&longitude=" + b.lon + q;
        return getJSON(u, 12000).catch(function () { return null; });
      })).then(function (arr) {
        var built = buildSst(arr);
        if (!built.length) throw new Error("pacific feed unreachable");
        return built;
      });
    });
  }

  /* ── 4 · climate ─────────────────────────────────────────────────────── */
  var CLIM_KEY = "eni.climate.v1";
  var CLIM_PT = "https://climate-api.open-meteo.com/v1/climate?latitude=22.0&longitude=79.0&models=MRI_AGCM3_2_S&daily=";
  function climURL(v, a, b) { return CLIM_PT + v + "&start_date=" + a + "&end_date=" + b; }

  function annualTotals(j) {
    var d = j && j.daily;
    if (!d || !d.time || !d.precipitation_sum) return [];
    var by = {};
    d.time.forEach(function (t, i) {
      var v = d.precipitation_sum[i];
      if (!num(v)) return;
      var y = t.slice(0, 4);
      by[y] = (by[y] || 0) + v;
    });
    return Object.keys(by).map(function (k) { return by[k]; }).filter(function (v) { return v > 1; });
  }

  function loadClimate() {
    var cached = store.get(CLIM_KEY, null);
    if (cached && cached.t && Date.now() - cached.t < 864e5 && cached.temp) return Promise.resolve(cached);

    var spans = [["1961-01-01", "2050-12-31"], ["1981-01-01", "2050-12-31"], ["1991-01-01", "2050-12-31"]];
    var chain = Promise.reject(new Error("start"));
    spans.forEach(function (span) {
      chain = chain.catch(function () { return getJSON(climURL("temperature_2m_mean", span[0], span[1]), 45000); });
    });

    return chain.then(function (temp) {
      return Promise.all([
        getJSON(climURL("precipitation_sum", "1961-01-01", "1990-12-31"), 30000).catch(function () { return null; }),
        getJSON(climURL("precipitation_sum", "2046-01-01", "2050-12-31"), 20000).catch(function () { return null; })
      ]).then(function (pr) {
        var o = {
          t: Date.now(),
          temp: temp,
          rainBase: pr[0] ? mean(annualTotals(pr[0])) : NaN,
          rainEnd: pr[1] ? mean(annualTotals(pr[1])) : NaN
        };
        store.set(CLIM_KEY, o);
        return o;
      });
    });
  }

  /* ═════════════════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════════════════ */

  function currentRoni() {
    var s = state.seasons.filter(function (x) { return isFinite(x.roni); });
    return s.length ? s[s.length - 1] : { roni: REF.STATUS.roni, season: "ASO", year: 2026 };
  }

  function renderStatic() {
    renderHero();
    renderStrip();
    renderProbs();
    renderNinoBars();
    renderChips();
    renderMap();
    var host = $("#sbHost");
    if (host && state.backend === "fallback") host.textContent = SB.url.replace("https://", "") + "/rest/v1";
  }

  /* ── hero ────────────────────────────────────────────────────────────── */
  function renderHero() {
    var cur = currentRoni();
    setText("roniPeriod", cur.season + " " + cur.year);
    setHTML("heroRoni", sgn(cur.roni, 1) + "<small>°C</small>");
    setHTML("heroN34", sgn(REF.STATUS.weekly_nino34, 1) + "<small>°C</small>");
    setHTML("heroN12", sgn(REF.STATUS.weekly_nino12, 1) + "<small>°C</small>");
    setText("dialValue", sgn(cur.roni, 1));
    drawDial(cur.roni);
  }

  function drawDial(v) {
    var svg = $("#dialSvg");
    if (!svg) return;
    var W = 300, H = 206, cx = 150, cy = 138, r = 112;
    var a = function (val) { return Math.PI * (1 - (clamp(val, -3, 3) + 3) / 6); };
    function arcPath(a0, a1) {
      var p0 = [cx + r * Math.cos(a0), cy - r * Math.sin(a0)];
      var p1 = [cx + r * Math.cos(a1), cy - r * Math.sin(a1)];
      return "M" + p0[0].toFixed(2) + " " + p0[1].toFixed(2) + "A" + r + " " + r + " 0 0 0 " + p1[0].toFixed(2) + " " + p1[1].toFixed(2);
    }
    var segs = [
      { a0: a(-3), a1: a(-0.5), c: "#5b8fb0", o: .55 },
      { a0: a(-0.5), a1: a(0.5), c: "#8e98a4", o: .4 },
      { a0: a(0.5), a1: a(3), c: "#d0533f", o: .85 }
    ];
    var g = "";
    segs.forEach(function (s) {
      g += '<path d="' + arcPath(s.a0, s.a1) + '" fill="none" stroke="' + s.c + '" stroke-width="10" stroke-linecap="butt" opacity="' + s.o + '"/>';
    });
    [-3, -2, -1, 0, 1, 2, 3].forEach(function (t) {
      var ang = a(t), r0 = r + 8, r1 = r + (t === 0 ? 15 : 12);
      var x0 = cx + r0 * Math.cos(ang), y0 = cy - r0 * Math.sin(ang);
      var x1 = cx + r1 * Math.cos(ang), y1 = cy - r1 * Math.sin(ang);
      g += '<line x1="' + x0.toFixed(1) + '" y1="' + y0.toFixed(1) + '" x2="' + x1.toFixed(1) + '" y2="' + y1.toFixed(1)
        + '" stroke="currentColor" stroke-width="1" opacity=".35"/>';
      var lx = cx + (r + 26) * Math.cos(ang), ly = cy - (r + 26) * Math.sin(ang) + 3;
      g += '<text x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" fill="currentColor" opacity=".55" font-family="JetBrains Mono, monospace" font-size="9" text-anchor="middle">' + t + '</text>';
    });
    var na = a(v);
    var nx = cx + (r - 16) * Math.cos(na), ny = cy - (r - 16) * Math.sin(na);
    g += '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1)
      + '" stroke="#d0533f" stroke-width="2.4" stroke-linecap="round"/>';
    g += '<circle cx="' + cx + '" cy="' + cy + '" r="3.4" fill="#d0533f"/>';
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.style.color = getComputedStyle(document.documentElement).getPropertyValue("--dim");
    svg.innerHTML = g;
  }

  function renderStrip() {
    var host = $("#roniStrip");
    if (!host) return;
    var data = state.seasons.filter(function (s) { return isFinite(s.roni); }).slice(-7);
    if (!data.length) return;
    var vals = data.map(function (d) { return d.roni; });
    var lo = Math.min.apply(null, vals.concat([-0.3])) - 0.3;
    var hi = Math.max.apply(null, vals.concat([0.5]));
    host.style.gridTemplateColumns = "repeat(" + data.length + ", minmax(0,1fr))";
    host.innerHTML = data.map(function (d) {
      var h = clamp(((d.roni - lo) / (hi - lo)) * 100, 5, 100);
      var neg = d.roni < 0;
      var bg = neg
        ? "linear-gradient(180deg,var(--cool),rgba(91,143,176,.22))"
        : "linear-gradient(180deg,var(--enso),rgba(208,83,63,.26))";
      return '<div class="strip__col">'
        + '<div class="strip__val" style="color:' + (neg ? "var(--cool)" : "var(--dim)") + '">' + sgn(d.roni, 1) + '</div>'
        + '<div class="strip__track"><div class="strip__bar" style="height:' + h + '%;background:' + bg + '"></div></div>'
        + '<div class="strip__lab">' + esc(d.season) + '</div>'
        + '</div>';
    }).join("");
  }

  function renderProbs() {
    var host = $("#probs");
    if (!host) return;
    host.innerHTML = state.outlook.map(function (o) {
      return '<span class="prob">' + esc(o.window) + ' <b>' + o.probability + '%</b></span>';
    }).join("");
  }

  function renderNinoBars() {
    var host = $("#ensoBars");
    if (!host) return;
    var maxAbs = Math.max.apply(null, state.nino.map(function (d) { return Math.abs(d.departure); }).concat([1]));
    host.innerHTML = state.nino.map(function (d) {
      var w = clamp((Math.abs(d.departure) / maxAbs) * 50, 0.5, 50);
      var style = d.departure >= 0
        ? "left:50%;width:" + w + "%;background:linear-gradient(90deg,rgba(208,83,63,.5),var(--enso))"
        : "right:50%;width:" + w + "%;background:linear-gradient(270deg,rgba(91,143,176,.5),var(--cool))";
      return '<div class="erow">'
        + '<div class="erow__n">' + esc(d.name) + '</div>'
        + '<div class="erow__track"><div class="erow__fill" style="' + style + '"></div></div>'
        + '<div class="erow__v" style="color:' + (d.departure >= 0 ? "var(--enso)" : "var(--cool)") + '">' + sgn(d.departure, 1) + '</div>'
        + '</div>';
    }).join("");
  }

  /* ── chips ───────────────────────────────────────────────────────────── */
  function renderChips() {
    var host = $("#regionChips");
    if (!host) return;
    host.innerHTML = REF.REGIONS.map(function (r) {
      var on = r.id === state.region;
      return '<button class="chip" type="button" data-region="' + r.id + '" aria-pressed="' + on + '">' + esc(r.label) + '</button>';
    }).join("");
  }

  function filtered() {
    if (state.region === "all") return state.rows;
    return state.rows.filter(function (r) { return r.station.region === state.region; });
  }

  /* ── alerts ──────────────────────────────────────────────────────────── */
  function renderAlerts(rows) {
    var host = $("#alerts"), list = $("#alertList");
    if (!host || !list) return;
    var out = [];
    var cur = currentRoni();

    out.push({ cls: "alert--enso", text: '<b>El Niño advisory</b> · RONI ' + sgn(cur.roni, 1) + ' °C' });

    var wettest = rows.slice().sort(function (a, b) { return b.today - a.today; })[0];
    if (wettest && wettest.today >= 35.6) {
      out.push({ cls: "alert--rain", text: '<b>' + esc(wettest.station.name) + '</b> ' + fx(wettest.today, 1) + ' mm · ' + catOf(wettest.today).label });
    } else if (wettest && wettest.today >= 7.6) {
      out.push({ cls: "alert--rain", text: '<b>' + esc(wettest.station.name) + '</b> ' + fx(wettest.today, 1) + ' mm · heavy' });
    }

    var hot = rows.filter(function (r) { return r.flag === "heat"; }).sort(function (a, b) { return b.tmaxToday - a.tmaxToday; })[0];
    if (hot) out.push({ cls: "alert--heat", text: '<b>' + esc(hot.station.name) + '</b> ' + fx(hot.tmaxToday, 1) + ' °C · at IMD threshold' });

    var dry = rows.filter(function (r) { return r.p30 < 10; });
    if (dry.length) out.push({ cls: "alert--dry", text: '<b>' + dry.length + '</b> station' + (dry.length > 1 ? "s" : "") + ' under 10 mm in 30 d' });

    host.hidden = false;
    list.innerHTML = out.map(function (o) { return '<span class="alert ' + o.cls + '">' + o.text + '</span>'; }).join("");
  }

  /* ── rain ────────────────────────────────────────────────────────────── */
  function catOf(mm) {
    var list = state.thresholds.rain;
    for (var i = list.length - 1; i >= 0; i--) {
      if (isFinite(mm) && mm >= list[i].min) return list[i];
    }
    return list[0];
  }

  function renderRain(rows) {
    if (!rows.length) return;
    var meanToday = mean(rows.map(function (c) { return c.today; }));
    var mean7 = mean(rows.map(function (c) { return c.p7; }));
    var s30 = sum(rows.map(function (c) { return c.p30; }));
    var sPrev = sum(rows.map(function (c) { return c.pPrev30; }));
    var anom = sPrev > 0.5 ? ((s30 - sPrev) / sPrev) * 100 : NaN;
    var wettest = rows.slice().sort(function (a, b) { return b.today - a.today; })[0];

    setHTML("rainToday", fx(meanToday, 1) + "<small> mm</small>");
    setText("rain7", fx(mean7, 1));
    setHTML("rainAnom", (isFinite(anom) ? sgn(anom, 0) : "—") + "<small> %</small>");
    setText("rainAnomS", isFinite(anom) ? (anom >= 0 ? "wetter than prior 30 d" : "drier than prior 30 d") : "in-record change");
    setText("rainWet", wettest.station.name);
    setText("rainWetS", fx(wettest.today, 1) + " mm · " + wettest.station.country);

    var n = 100, series = [];
    for (var i = 0; i < n; i++) {
      var vals = rows.map(function (c) { return c.precip[i]; }).filter(isFinite);
      series.push(vals.length ? mean(vals) : 0);
    }
    var maxV = Math.max.apply(null, series.concat([1]));
    var host = $("#rainChart");
    if (host) {
      host.innerHTML = series.map(function (v, k) {
        var h = clamp((v / maxV) * 100, v > 0 ? 2 : 0, 100);
        var fc = k >= 93 ? " bars__b--fc" : "";
        return '<div class="bars__b' + fc + '" style="height:' + h + '%" title="' + (k >= 93 ? "forecast" : "observed") + " · " + fx(v, 1) + ' mm"></div>';
      }).join("");
    }
    renderTable(rows);
    setText("rainMeta", rows.length + " stations · 92 d history · 7 d forecast");
  }

  function renderTable(rows) {
    var body = $("#rainBody");
    if (!body) return;
    var key = state.sort.key, dir = state.sort.dir;
    var sorted = rows.slice().sort(function (a, b) {
      var av = key === "name" ? a.station.name : a[key];
      var bv = key === "name" ? b.station.name : b[key];
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return ((isFinite(av) ? av : -1e9) - (isFinite(bv) ? bv : -1e9)) * dir;
    });

    body.innerHTML = sorted.map(function (r) {
      var c = catOf(r.today);
      var cls = c.severity >= 4 ? "tag--sev" : c.severity >= 2 ? "tag--wet" : "";
      return '<tr data-id="' + r.station.id + '"' + (state.selected === r.station.id ? ' class="is-selected"' : "") + '>'
        + '<td class="s-left">' + esc(r.station.name) + '<span class="city-sub">' + r.station.country + '</span></td>'
        + '<td>' + fx(r.now, 1) + '</td>'
        + '<td>' + fx(r.today, 1) + '</td>'
        + '<td>' + fx(r.p7, 1) + '</td>'
        + '<td>' + fx(r.p30, 0) + '</td>'
        + '<td class="s-left"><span class="tag ' + cls + '">' + esc(c.label) + '</span></td>'
        + '</tr>';
    }).join("");

    $$("#rainTable thead th[data-sort]").forEach(function (th) {
      th.classList.toggle("is-sorted", th.dataset.sort === key);
      th.classList.toggle("asc", th.dataset.sort === key && dir === 1);
    });
  }

  /* ── heat ────────────────────────────────────────────────────────────── */
  function renderHeat(rows) {
    var data = rows.filter(function (r) { return num(r.tmaxToday); });
    if (!data.length) return;
    var hottest = data.slice().sort(function (a, b) { return b.tmaxToday - a.tmaxToday; })[0];
    var meanMax = mean(data.map(function (d) { return d.tmaxToday; }));
    var peak = data.filter(function (d) { return num(d.feels); }).sort(function (a, b) { return b.feels - a.feels; })[0];

    setText("heatHot", hottest.station.name);
    setText("heatHotS", fx(hottest.tmaxToday, 1) + " °C max today");
    setHTML("heatMean", fx(meanMax, 1) + "<small> °C</small>");
    setHTML("heatFeels", peak ? fx(peak.feels, 1) + "<small> °C</small>" : "—");

    var list = $("#heatList");
    if (list) {
      list.innerHTML = data.slice().sort(function (a, b) { return b.tmaxToday - a.tmaxToday; }).slice(0, 9).map(function (d) {
        var w = clamp((d.tmaxToday / 45) * 100, 3, 100);
        var hot = d.flag === "heat", warm = d.flag === "hot";
        var bar = hot ? "linear-gradient(90deg,rgba(224,138,46,.5),var(--heat))"
          : warm ? "linear-gradient(90deg,rgba(208,83,63,.4),var(--enso))"
          : "linear-gradient(90deg,rgba(224,138,46,.24),rgba(224,138,46,.7))";
        var tail = hot
          ? '<div class="hrow__d" style="color:var(--heat)">HEAT</div>'
          : '<div class="hrow__d" style="color:' + (warm ? "var(--enso)" : "var(--faint)") + '">' + (isFinite(d.anom7) ? sgn(d.anom7, 1) : "—") + '</div>';
        return '<div class="hrow" data-id="' + d.station.id + '">'
          + '<div class="hrow__n">' + esc(d.station.name) + '</div>'
          + '<div class="hrow__track"><div class="hrow__fill" style="width:' + w + '%;background:' + bar + '"></div></div>'
          + '<div class="hrow__v" style="color:' + (hot ? "var(--heat)" : "var(--text)") + '">' + fx(d.tmaxToday, 1) + '°</div>'
          + tail + '</div>';
      }).join("");
    }

    var svg = $("#heatForecast");
    if (svg && hottest.fcstMax.length) {
      var vals = hottest.fcstMax.filter(num);
      if (vals.length) {
        var lo = Math.min.apply(null, vals) - 2, hi = Math.max.apply(null, vals) + 2;
        var W = 400, H = 96, pad = 7;
        var pts = hottest.fcstMax.map(function (v, i) {
          var x = pad + (i / Math.max(hottest.fcstMax.length - 1, 1)) * (W - pad * 2);
          var y = H - pad - ((v - lo) / Math.max(hi - lo, 0.1)) * (H - pad * 2);
          return [x, y];
        }).filter(function (p) { return isFinite(p[1]); });
        if (pts.length) {
          var dPath = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
          var area = dPath + " L" + pts[pts.length - 1][0].toFixed(1) + " " + H + " L" + pts[0][0].toFixed(1) + " " + H + " Z";
          svg.innerHTML = '<defs><linearGradient id="hgrad" x1="0" y1="0" x2="0" y2="1">'
            + '<stop offset="0%" stop-color="#e08a2e" stop-opacity=".34"/>'
            + '<stop offset="100%" stop-color="#e08a2e" stop-opacity="0"/></linearGradient></defs>'
            + '<path d="' + area + '" fill="url(#hgrad)"/>'
            + '<path d="' + dPath + '" fill="none" stroke="#e08a2e" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>'
            + pts.map(function (p) { return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.4" fill="#e08a2e"/>'; }).join("");
        }
        setText("heatFcLabel", "7-day peak max — " + hottest.station.name);
        var axis = $("#heatFcAxis");
        if (axis) {
          axis.innerHTML = hottest.fcstTimes.map(function (t) {
            var d2 = new Date(t + "T00:00:00");
            return "<span>" + d2.toLocaleDateString("en-GB", { weekday: "short" }) + "</span>";
          }).join("");
        }
      }
    }
    setText("heatMeta", data.length + " stations · IMD thresholds");
  }

  /* ── climate ─────────────────────────────────────────────────────────── */
  function renderClimate(clim) {
    var daily = clim.temp && clim.temp.daily;
    if (!daily || !daily.time) throw new Error("no series");
    var times = daily.time, temps = daily.temperature_2m_mean || [];

    var byYear = {};
    for (var i = 0; i < times.length; i++) {
      var v = temps[i];
      if (!num(v)) continue;
      var y = +times[i].slice(0, 4);
      if (!byYear[y]) byYear[y] = { s: 0, n: 0 };
      byYear[y].s += v; byYear[y].n++;
    }
    var years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
    var annual = years.map(function (y) { return byYear[y].s / byYear[y].n; });

    var baseIdx = [];
    years.forEach(function (y, i) { if (y >= 1961 && y <= 1990) baseIdx.push(i); });
    var base = baseIdx.length ? mean(baseIdx.map(function (i) { return annual[i]; })) : mean(annual.slice(0, 30));
    var baseLabel = baseIdx.length ? "1961–90" : years[0] + "–" + (years[0] + 29);
    setText("climAnomS", "vs " + baseLabel);
    setText("climRainS", "vs " + baseLabel);

    var bins = [];
    for (var yb = Math.ceil(years[0] / 5) * 5; yb + 4 <= years[years.length - 1]; yb += 5) {
      var vals = [];
      for (var k = yb; k < yb + 5; k++) {
        var idx = years.indexOf(k);
        if (idx >= 0) vals.push(annual[idx]);
      }
      if (vals.length >= 3) bins.push({ label: yb + "–" + String(yb + 4).slice(2), v: mean(vals) - base });
    }
    if (bins.length < 4) throw new Error("short series");

    var n = annual.length, xm = (n - 1) / 2, ym = mean(annual), sxy = 0, sxx = 0;
    annual.forEach(function (v2, i2) { sxy += (i2 - xm) * (v2 - ym); sxx += (i2 - xm) * (i2 - xm); });
    var slope = sxx ? sxy / sxx : 0;

    function anomOf(a, b) {
      var vv = [];
      years.forEach(function (y2, i3) { if (y2 >= a && y2 <= b) vv.push(annual[i3] - base); });
      return vv.length ? mean(vv) : NaN;
    }

    setHTML("climRate", (slope * 10 >= 0 ? "+" : "") + fx(slope * 10, 2));
    setHTML("climAnom", sgn(anomOf(2021, 2025), 2) + "<small> °C</small>");
    setHTML("climProj", sgn(anomOf(2046, 2050), 2) + "<small> °C</small>");

    if (isFinite(clim.rainBase) && isFinite(clim.rainEnd) && clim.rainBase > 1) {
      var pct = ((clim.rainEnd - clim.rainBase) / clim.rainBase) * 100;
      setHTML("climRain", (pct >= 0 ? "+" : "") + fx(pct, 0) + "<small> %</small>");
    } else setText("climRain", "—");

    var svg = $("#climChart");
    if (svg) {
      var W = 700, H = 200, padL = 4, padR = 4, padT = 16, padB = 16;
      var vs = bins.map(function (b) { return b.v; });
      var lo = Math.min.apply(null, vs.concat([0])) - 0.25;
      var hi = Math.max.apply(null, vs.concat([0.5])) + 0.25;
      var X = function (i4) { return padL + (i4 / Math.max(bins.length - 1, 1)) * (W - padL - padR); };
      var Y = function (v3) { return H - padB - ((v3 - lo) / (hi - lo)) * (H - padT - padB); };
      var dP = bins.map(function (b, i5) { return (i5 ? "L" : "M") + X(i5).toFixed(1) + " " + Y(b.v).toFixed(1); }).join(" ");
      var area = dP + " L" + X(bins.length - 1).toFixed(1) + " " + Y(0) + " L" + X(0).toFixed(1) + " " + Y(0) + " Z";
      var ticks = [lo + 0.25, (lo + hi) / 2, hi - 0.25];
      svg.innerHTML = '<defs><linearGradient id="cgrad" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0%" stop-color="#8aa872" stop-opacity=".32"/>'
        + '<stop offset="100%" stop-color="#8aa872" stop-opacity="0"/></linearGradient></defs>'
        + ticks.map(function (t) {
            return '<line x1="0" y1="' + Y(t).toFixed(1) + '" x2="' + W + '" y2="' + Y(t).toFixed(1)
              + '" stroke="currentColor" stroke-width="1" opacity=".13" vector-effect="non-scaling-stroke"/>';
          }).join("")
        + '<line x1="0" y1="' + Y(0).toFixed(1) + '" x2="' + W + '" y2="' + Y(0).toFixed(1)
        + '" stroke="currentColor" stroke-width="1" stroke-dasharray="3 3" opacity=".4" vector-effect="non-scaling-stroke"/>'
        + '<path d="' + area + '" fill="url(#cgrad)"/>'
        + '<path d="' + dP + '" fill="none" stroke="#8aa872" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>'
        + '<circle cx="' + X(bins.length - 1).toFixed(1) + '" cy="' + Y(bins[bins.length - 1].v).toFixed(1) + '" r="3.4" fill="#8aa872"/>';
      svg.style.color = getComputedStyle(document.documentElement).getPropertyValue("--faint");
    }

    var axis = $("#climAxis");
    if (axis) {
      var marks = [bins[0], bins[Math.floor(bins.length / 2)], bins[bins.length - 1]];
      axis.innerHTML = marks.map(function (b) { return "<span>" + b.label + "</span>"; }).join("");
    }

    var per = $("#climPeriods");
    if (per) {
      var rowsP = [
        { k: "1991–2020", s: "recent past" },
        { k: "2021–2050", s: "this generation" },
        { k: "2046–2050", s: "end of record" }
      ];
      per.innerHTML = rowsP.map(function (r) {
        var ab = r.k.split("–");
        return '<div class="per"><div class="per__k">' + r.k + '</div>'
          + '<div class="per__v">' + sgn(anomOf(+ab[0], +ab[1]), 2) + ' °C</div>'
          + '<div class="per__s">' + r.s + '</div></div>';
      }).join("");
    }

    setText("climMeta", "CMIP6 · central India · " + years[0] + "–" + years[years.length - 1]);
  }

  /* ── SST ─────────────────────────────────────────────────────────────── */
  function renderSst(enso) {
    var svg = $("#sstChart");
    if (!svg || !enso || !enso.length) return;
    var W = 400, H = 130, padT = 8, padB = 8;
    var all = [];
    enso.forEach(function (b) { all = all.concat(b.series); });
    var lo = Math.min.apply(null, all) - 0.6, hi = Math.max.apply(null, all) + 0.6;
    var maxLen = Math.max.apply(null, enso.map(function (b) { return b.series.length; }));
    var X = function (i) { return (i / Math.max(maxLen - 1, 1)) * W; };
    var Y = function (v) { return H - padB - ((v - lo) / (hi - lo)) * (H - padT - padB); };
    svg.innerHTML = enso.map(function (b) {
      var d = b.series.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join(" ");
      return '<path d="' + d + '" fill="none" stroke="' + b.c + '" stroke-width="1.8" vector-effect="non-scaling-stroke" stroke-linejoin="round" opacity=".92"/>';
    }).join("");

    var axis = $("#sstAxis");
    if (axis && enso[0].labels.length) {
      var L = enso[0].labels;
      axis.innerHTML = [L[0], L[Math.floor(L.length / 2)], L[L.length - 1]]
        .map(function (t) { return "<span>" + t.slice(5) + "</span>"; }).join("");
    }
    var leg = $("#sstLegend");
    if (leg) {
      leg.innerHTML = enso.map(function (b) {
        return '<span><i style="background:' + b.c + '"></i>' + esc(b.k) + " " + fx(b.last, 1) + "°</span>";
      }).join("");
    }
  }

  /* ── map ─────────────────────────────────────────────────────────────── */
  var latNorm = function (lat) {
    var r = clamp(lat, -85, 85) * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
  };
  var latFromNorm = function (y) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI; };
  var lonFromX = function (x) { return x * 360 - 180; };
  var GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

  function mapView(W, H) {
    var z = (H >= 600 && W >= 700) ? 5 : 4;
    var world = 256 * Math.pow(2, z);
    var nx = (REF.MAP_CENTRE.lon + 180) / 360;
    var ny = latNorm(REF.MAP_CENTRE.lat);
    var xLeft = nx - (W / world) / 2;
    var yTop = ny - (H / world) / 2;
    return {
      z: z, world: world, xLeft: xLeft, yTop: yTop,
      w: lonFromX(xLeft), e: lonFromX(xLeft + W / world),
      n: latFromNorm(yTop), s: latFromNorm(yTop + H / world)
    };
  }

  var LAYERS = {
    precip: {
      maxZ: 6,
      url: function (z, y, x, d) { return GIBS + "/IMERG_Precipitation_Rate_30min/default/" + d + "/GoogleMapsCompatible_Level6/" + z + "/" + y + "/" + x + ".png"; },
      opacity: 0.8,
      label: "IMERG precipitation rate",
      note: "NASA IMERG 30-minute precipitation-rate mosaic. Granules land with roughly 6–12 hours of latency, so the newest usable scene is usually yesterday."
    },
    lst: {
      maxZ: 7,
      url: function (z, y, x, d) { return GIBS + "/MODIS_Terra_Land_Surface_Temp_Day/default/" + d + "/GoogleMapsCompatible_Level7/" + z + "/" + y + "/" + x + ".png"; },
      opacity: 0.75,
      label: "MODIS land-surface temperature",
      note: "MODIS Terra daytime land-surface temperature, daily composite — the skin of the ground, which runs far hotter than the air above it."
    },
    none: { maxZ: 9, url: null, opacity: 0, label: "Bare chart", note: "Coastlines and station markers only." }
  };

  function sceneDate() {
    var d = new Date();
    d.setUTCDate(d.getUTCDate() - state.sceneOffset);
    return d.toISOString().slice(0, 10);
  }

  function renderMap() {
    var host = $("#mapTiles"), svg = $("#mapSvg");
    if (!host || !svg) return;
    var W = host.clientWidth, H = host.clientHeight;
    if (!W || !H) return;

    var V = mapView(W, H);
    var cfg = LAYERS[state.layer] || LAYERS.none;
    var date = sceneDate();
    var lz = Math.min(V.z, cfg.maxZ);

    var xPix = V.xLeft * V.world, yPix = V.yTop * V.world;
    var tx0 = Math.floor(xPix / 256), tx1 = Math.floor((xPix + W) / 256);
    var ty0 = Math.floor(yPix / 256), ty1 = Math.floor((yPix + H) / 256);

    var tiles = [];
    for (var ty = ty0; ty <= ty1; ty++) {
      for (var tx = tx0; tx <= tx1; tx++) {
        var left = (tx * 256 - xPix).toFixed(1), top = (ty * 256 - yPix).toFixed(1);
        tiles.push('<img src="' + GIBS + "/Coastlines/default/2020-01-01/GoogleMapsCompatible_Level9/" + V.z + "/" + ty + "/" + tx
          + '.png" style="left:' + left + "px;top:" + top + 'px;opacity:.85;filter:invert(1) saturate(0) brightness(1.35)" alt="" loading="lazy">');
        if (cfg.url) {
          tiles.push('<img src="' + cfg.url(lz, ty, tx, date) + '" style="left:' + left + "px;top:" + top
            + "px;opacity:" + cfg.opacity + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">');
        }
      }
    }
    host.innerHTML = tiles.join("");
    host.appendChild(svg);

    var px = function (lon) { return ((lon + 180) / 360 - V.xLeft) * V.world; };
    var py = function (lat) { return (latNorm(lat) - V.yTop) * V.world; };

    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);

    var g = "";
    for (var lon = Math.ceil(V.w / 10) * 10; lon <= V.e; lon += 10) {
      g += '<line x1="' + px(lon).toFixed(1) + '" y1="0" x2="' + px(lon).toFixed(1) + '" y2="' + H
        + '" stroke="rgba(180,200,215,.14)" stroke-width="1" stroke-dasharray="2 4"/>'
        + '<text x="' + (px(lon) + 3).toFixed(1) + '" y="' + (H - 6)
        + '" fill="rgba(180,200,215,.42)" font-family="JetBrains Mono, monospace" font-size="8">' + lon + "°E</text>";
    }
    for (var lat = Math.ceil(V.s / 10) * 10; lat <= V.n; lat += 10) {
      g += '<line x1="0" y1="' + py(lat).toFixed(1) + '" x2="' + W + '" y2="' + py(lat).toFixed(1)
        + '" stroke="rgba(180,200,215,.14)" stroke-width="1" stroke-dasharray="2 4"/>'
        + '<text x="4" y="' + (py(lat) - 4).toFixed(1)
        + '" fill="rgba(180,200,215,.42)" font-family="JetBrains Mono, monospace" font-size="8">' + lat + "°N</text>";
    }

    state.stations.forEach(function (c) {
      if (c.lon < V.w || c.lon > V.e || c.lat < V.s || c.lat > V.n) return;
      var cx = px(c.lon), cy = py(c.lat);
      var rec = state.byId[c.id];
      var dim = state.region !== "all" && c.region !== state.region;
      var col = "#d8dee6", r = 2.9;
      if (rec) {
        if (rec.today >= 7.6) { col = "#3fa9b8"; r = 4.4; }
        else if (rec.tmaxToday >= 35) { col = "#e08a2e"; r = 4; }
        else if (rec.tmaxToday >= 30) { col = "#c9a15f"; r = 3.3; }
      }
      var op = dim ? 0.28 : 1;
      g += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (r + 1.7) + '" fill="rgba(6,9,12,.6)" opacity="' + op + '"/>';
      g += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r + '" fill="' + col + '" opacity="' + op
        + '" data-station="' + c.id + '"><title>' + esc(c.name) + "</title></circle>";
      if (c.country === "IN" && !dim) {
        g += '<text x="' + (cx + 6).toFixed(1) + '" y="' + (cy + 3).toFixed(1)
          + '" fill="rgba(232,238,244,.9)" font-family="JetBrains Mono, monospace" font-size="9"'
          + ' style="paint-order:stroke;stroke:rgba(6,9,12,.85);stroke-width:2.6px">' + esc(c.name) + "</text>";
      }
    });
    svg.innerHTML = g;

    var hud = $("#mapHud");
    if (hud) {
      hud.innerHTML = "SCENE <b>" + date + "</b> · Z" + V.z + " · " + cfg.label.toUpperCase()
        + "<br>" + V.w.toFixed(0) + "°E–" + V.e.toFixed(0) + "°E · " + V.s.toFixed(0) + "°N–" + V.n.toFixed(0) + "°N";
    }
    setText("sceneDate", date);

    var leg = $("#mapLegend");
    if (leg) {
      if (state.layer === "precip") {
        leg.innerHTML = "<span>dry</span>"
          + '<span class="legend__bar" style="background:linear-gradient(90deg,#0d1116,#5aa9c9 20%,#4f9d5b 45%,#d8c443 68%,#d9663a 86%,#b8322c)"></span>'
          + "<span>heavy</span><span>0.1 → 30+ mm h⁻¹</span>";
      } else if (state.layer === "lst") {
        leg.innerHTML = "<span>cool</span>"
          + '<span class="legend__bar" style="background:linear-gradient(90deg,#2b3a8c,#3fa9b8 25%,#8aa872 48%,#e0b23a 70%,#d0533f 88%,#7d1f18)"></span>'
          + "<span>hot</span><span>−10 → 45+ °C skin</span>";
      } else {
        leg.innerHTML = "<span>Coastlines · station markers only</span>";
      }
    }
    var note = $("#mapNote");
    if (note) note.innerHTML = "<b>" + cfg.label + ".</b> " + cfg.note
      + " Dots: cyan = wet (≥7.5 mm today), amber = hot (≥35 °C max), white = quiet. Click a dot to open the station.";
  }

  /* ── drawer ──────────────────────────────────────────────────────────── */
  function openStation(id) {
    var r = state.byId[id];
    if (!r) return;
    state.selected = id;
    renderTable(filtered());

    var d = $("#drawer"), body = $("#drawerBody");
    setText("drawerTitle", r.station.name);
    setText("drawerRegion", r.station.region + " · " + r.station.zone + " · " + r.station.country);

    var c = catOf(r.today);
    var cells = [
      ["Today", fx(r.today, 1) + "<small> mm</small>"],
      ["Last 7 d", fx(r.p7, 1) + "<small> mm</small>"],
      ["Max today", fx(r.tmaxToday, 1) + "<small> °C</small>"],
      ["Feels like", fx(r.feels, 1) + "<small> °C</small>"],
      ["Humidity", fx(r.rh, 0) + "<small> %</small>"],
      ["Wind", fx(r.wind, 1) + "<small> km/h</small>"],
      ["30 d total", fx(r.p30, 0) + "<small> mm</small>"],
      ["vs 7-d mean", sgn(r.anom7, 1) + "<small> °C</small>"]
    ];

    var html = '<div class="dgrid">' + cells.map(function (c2) {
      return '<div class="dcell"><div class="dcell__k">' + c2[0] + '</div><div class="dcell__v">' + c2[1] + "</div></div>";
    }).join("") + "</div>";

    html += '<div><div class="dsec__h">Category today · ' + esc(c.label) + "</div>"
      + '<div class="tbl-wrap" style="max-height:none"><table class="tbl"><thead><tr>'
      + '<th class="s-left">Day</th><th>Rain mm</th><th>Max °C</th></tr></thead><tbody>'
      + r.fcstTimes.map(function (t, i) {
          var dd = new Date(t + "T00:00:00");
          return '<tr><td class="s-left">' + dd.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }) + "</td>"
            + "<td>" + fx(r.fcstRain[i], 1) + "</td><td>" + fx(r.fcstMax[i], 1) + "</td></tr>";
        }).join("")
      + "</tbody></table></div></div>";

    // 92-day rainfall bars
    var last = r.precip.slice(0, 93);
    var mx = Math.max.apply(null, last.concat([1]));
    html += '<div><div class="dsec__h">Rainfall, last 92 days</div><div class="bars" style="height:70px">'
      + last.map(function (v) {
          return '<div class="bars__b" style="height:' + clamp((v / mx) * 100, v > 0 ? 3 : 0, 100) + '%" title="' + fx(v, 1) + ' mm"></div>';
        }).join("") + "</div></div>";

    html += '<p class="footnote">' + r.station.lat.toFixed(3) + "°N " + r.station.lon.toFixed(3) + "°E"
      + (r.station.elevation_m ? " · " + r.station.elevation_m + " m" : "")
      + " · IMD heat threshold for " + r.station.zone + " is " + r.threshold + " °C</p>";

    body.innerHTML = html;
    d.hidden = false;
    document.body.style.overflow = "hidden";
    $("#drawerClose").focus();
  }

  function closeStation() {
    var d = $("#drawer");
    if (!d) return;
    d.hidden = true;
    state.selected = null;
    document.body.style.overflow = "";
    renderTable(filtered());
  }

  /* ── table sorting / export / share ──────────────────────────────────── */
  function wireTable() {
    $$("#rainTable thead th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.dataset.sort;
        if (state.sort.key === k) state.sort.dir *= -1;
        else { state.sort.key = k; state.sort.dir = -1; }
        renderTable(filtered());
      });
    });
    $("#rainBody").addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-id]");
      if (tr) openStation(tr.dataset.id);
    });
    $("#heatList").addEventListener("click", function (e) {
      var row = e.target.closest(".hrow[data-id]");
      if (row) openStation(row.dataset.id);
    });
    $("#mapSvg").addEventListener("click", function (e) {
      var c = e.target.closest("circle[data-station]");
      if (c) openStation(c.getAttribute("data-station"));
    });
  }

  function exportCsv() {
    var rows = filtered();
    if (!rows.length) { toast("Nothing to export yet"); return; }
    var head = ["station", "country", "region", "zone", "lat", "lon", "rain_now_mm", "rain_today_mm", "rain_7d_mm", "rain_30d_mm", "tmax_today_c", "feels_c"];
    var lines = [head.join(",")];
    rows.forEach(function (r) {
      lines.push([r.station.name, r.station.country, r.station.region, r.station.zone,
        r.station.lat, r.station.lon, fx(r.now, 2), fx(r.today, 2), fx(r.p7, 2), fx(r.p30, 2),
        fx(r.tmaxToday, 2), fx(r.feels, 2)].join(","));
    });
    var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "eni-stations-" + state.region + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast("Exported " + rows.length + " stations");
  }

  function shareView() {
    var url = location.origin + location.pathname + (state.region === "all" ? "" : "?region=" + state.region);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast("Link copied"); },
        function () { toast(url); });
    } else toast(url);
  }

  /* ── feedback + snapshot ─────────────────────────────────────────────── */
  function wireFeedback() {
    var form = $("#fbForm");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = $("#fbMsg").value.trim();
      var status = $("#fbStatus");
      if (msg.length < 3) {
        status.textContent = "Add a little more detail.";
        status.className = "feedback__status is-err";
        return;
      }
      var btn = $("#fbSubmit");
      btn.disabled = true;
      status.textContent = "sending…";
      status.className = "feedback__status";
      sbPost("eni_feedback", {
        kind: $("#fbKind").value,
        message: msg,
        contact: $("#fbContact").value.trim() || null,
        page_region: state.region
      }).then(function () {
        status.textContent = "Received — written to eni_feedback.";
        status.className = "feedback__status is-ok";
        form.reset();
      }).catch(function (err) {
        status.textContent = "Could not send: " + err.message;
        status.className = "feedback__status is-err";
      }).finally(function () { btn.disabled = false; });
    });
  }

  function writeSnapshot() {
    if (state.backend !== "live" || !state.rows.length) return;
    var last = store.get("eni.snapshot.at", 0);
    if (Date.now() - last < 30 * 60 * 1000) return;
    var rows = state.rows;
    var payload = {
      stations: rows.length,
      region: state.region,
      top: rows.slice().sort(function (a, b) { return b.today - a.today; }).slice(0, 5)
        .map(function (r) { return [r.station.id, +r.today.toFixed(1)]; })
    };
    sbPost("eni_snapshots", {
      region: state.region,
      station_count: rows.length,
      mean_rain_today: +mean(rows.map(function (r) { return r.today; })).toFixed(2),
      mean_tmax: +mean(rows.map(function (r) { return r.tmaxToday; })).toFixed(2),
      mean_feels: +mean(rows.filter(function (r) { return num(r.feels); }).map(function (r) { return r.feels; })).toFixed(2),
      payload: payload,
      client: "eni-web"
    }).then(function () { store.set("eni.snapshot.at", Date.now()); })
      .catch(function () { /* archive is best-effort */ });
  }

  /* ── clock + ring ────────────────────────────────────────────────────── */
  function tickClock() {
    var t = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(new Date());
    setText("clock", t + " IST");
  }
  function tickRing() {
    state.nextTick = Math.max(0, state.nextTick - 1);
    setText("countdown", String(state.nextTick));
    var fg = $("#ringFg");
    if (fg) fg.setAttribute("stroke-dashoffset", String(RING_LEN * (1 - state.nextTick / POLL_SECONDS)));
    if (state.nextTick <= 0 && !state.busy) { state.nextTick = POLL_SECONDS; refresh(false); }
  }

  /* ── orchestration ───────────────────────────────────────────────────── */
  function refresh(initial) {
    if (state.busy) return;
    state.busy = true;
    state.cycle++;

    var wantSst = initial || !state.sst || state.cycle % 5 === 0;

    Promise.all([
      loadWeather().then(function (r) { return { ok: true, rows: r }; }, function (e) { return { ok: false, e: e }; }),
      wantSst ? loadSst().then(function (s) { return { ok: true, sst: s }; }, function (e) { return { ok: false, e: e }; })
              : Promise.resolve({ ok: true, sst: state.sst })
    ]).then(function (res) {
      if (res[0].ok) {
        state.rows = res[0].rows;
        state.byId = {};
        state.rows.forEach(function (r) { state.byId[r.station.id] = r; });
        store.set("eni.lastRows", { at: Date.now(), region: state.region, rows: slim(state.rows) });

        var rows = filtered();
        renderAlerts(rows);
        renderRain(rows);
        renderHeat(rows);
        renderMap();
        setText("stationCount", rows.length + " of " + state.rows.length + " stations");
      } else {
        setText("stationCount", "feed unavailable");
        var body = $("#rainBody");
        if (body) body.innerHTML = '<tr><td colspan="6" class="loading err">Weather feed unreachable — retrying in 60 s</td></tr>';
      }

      if (res[1].ok && res[1].sst) {
        state.sst = res[1].sst;
        renderSst(state.sst);
      }

      var t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
      setText("lastSync", "synced " + t);
      setText("footStamp", "rendered " + t + " IST · polls every 60 s");
      writeSnapshot();

      if (initial) {
        loadClimate().then(function (c) { state.clim = c; renderClimate(c); })
          .catch(function () {
            setText("climRate", "n/a");
            setText("climAnom", "n/a"); setText("climProj", "n/a"); setText("climRain", "n/a");
          });
      }
    }).finally(function () {
      state.busy = false;
      state.nextTick = POLL_SECONDS;
    });
  }

  function slim(rows) {
    return rows.map(function (r) {
      return {
        id: r.station.id, today: r.today, p7: r.p7, p30: r.p30,
        tmax: r.tmaxToday, feels: r.feels
      };
    });
  }

  /* ── theme + region + nav ────────────────────────────────────────────── */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    store.set("eni.theme", t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", t === "light" ? "#f4f1ea" : "#080b0f");
    drawDial(currentRoni().roni);
    if (state.clim) { try { renderClimate(state.clim); } catch (e) {} }
    renderMap();
  }

  function setRegion(id) {
    state.region = id;
    renderChips();
    if (state.rows.length) {
      var rows = filtered();
      renderAlerts(rows);
      renderRain(rows);
      renderHeat(rows);
      setText("stationCount", rows.length + " of " + state.rows.length + " stations");
    }
    renderMap();
    history.replaceState(null, "", id === "all" ? location.pathname : "?region=" + id);
  }

  function wire() {
    document.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip[data-region]");
      if (chip) setRegion(chip.dataset.region);
    });

    $$(".lbtn").forEach(function (b) {
      b.addEventListener("click", function () {
        state.layer = b.dataset.layer;
        $$(".lbtn").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        renderMap();
      });
    });

    $("#scenePrev").addEventListener("click", function () { state.sceneOffset = clamp(state.sceneOffset + 1, 1, 6); renderMap(); });
    $("#sceneNext").addEventListener("click", function () { state.sceneOffset = clamp(state.sceneOffset - 1, 1, 6); renderMap(); });
    $("#refreshBtn").addEventListener("click", function () { if (!state.busy) { state.nextTick = POLL_SECONDS; refresh(false); } });
    $("#themeBtn").addEventListener("click", function () {
      applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
    });
    $("#exportBtn").addEventListener("click", exportCsv);
    $("#shareBtn").addEventListener("click", shareView);
    $("#drawerClose").addEventListener("click", closeStation);
    $("#drawerScrim").addEventListener("click", closeStation);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !$("#drawer").hidden) closeStation();
      if (e.target.matches("input, select, textarea")) return;
      if (e.key === "r" || e.key === "R") { if (!state.busy) { state.nextTick = POLL_SECONDS; refresh(false); } }
      if (e.key === "t" || e.key === "T") {
        applyTheme(document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light");
      }
    });

    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(renderMap, 200);
    });

    // section nav highlight
    var links = $$("#sectNav a");
    var secs = links.map(function (a) { return document.querySelector(a.getAttribute("href")); }).filter(Boolean);
    if ("IntersectionObserver" in window && secs.length) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("href") === "#" + en.target.id); });
        });
      }, { rootMargin: "-140px 0px -60% 0px", threshold: 0 });
      secs.forEach(function (s) { io.observe(s); });
    }
  }

  /* ── boot ────────────────────────────────────────────────────────────── */
  function boot() {
    var params = new URLSearchParams(location.search);
    var reg = params.get("region");
    if (reg && REF.REGIONS.some(function (r) { return r.id === reg; })) state.region = reg;

    var theme = store.get("eni.theme", null);
    if (!theme) theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);

    renderStatic();
    wire();
    wireTable();
    wireFeedback();
    tickClock();
    setInterval(tickClock, 1000);
    setInterval(tickRing, 1000);

    loadBackend().catch(function () {
      state.backend = "fallback";
      setText("backendMeta", "supabase unreachable · embedded register");
      renderStatic();
    }).finally(function () {
      refresh(true);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
