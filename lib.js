// Pure functions — no DOM or side-effects. Imported by app.js and the test suite.

export const CONFIG = {
  lat:   44.275,
  lon:   4.527,
  start: '2026-07-05',
  end:   '2026-07-15',
  tz:    'Europe/Paris',
};

export const WEDDING_DAYS = [
  { date: '2026-07-13', display: '13 July' },
  { date: '2026-07-14', display: '14 July' },
  { date: '2026-07-15', display: '15 July' },
];

// All ensemble models. `keys` are tried in order; first success wins.
// `detail: true` → gets its own plume chart. All models appear in comparison.
// Member counts confirmed by CI probe on 2026-06-29 / CSV on 2026-07-02.
// Note: ecmwf_ifs025 output is 3-hourly so some timesteps will have null stats.
// Note: ecmwf_ifs04 is deterministic-only — do NOT add it here.
// Note: meteofrance_seamless / meteofrance_arpege_world are deterministic-only.
// Range notes (as of 2026-07-02): ifs025/aifs025 → ~15d, gefs_seamless/gem/gefs05 → 31d,
//   icon_seamless_eps → ~8d, icon_eu_eps → ~5d, ukmo/aigefs/gefs025 → ~10d.
//   Shorter-range models will gain wedding-date coverage as we approach July 13.
export const MODELS = [
  { keys: ['ecmwf_ifs025_ensemble',  'ecmwf_ifs025'],              id: 'ifs',   name: 'ECMWF IFS',    shortName: 'IFS',  members: 50, r: 37,  g: 99,  b: 235 },
  { keys: ['ecmwf_aifs025_ensemble', 'ecmwf_aifs025'],             id: 'aifs',  name: 'ECMWF AIFS',   shortName: 'AIFS', members: 50, r: 22,  g: 163, b: 74  },
  { keys: ['icon_seamless_eps', 'icon_eu_eps', 'icon_eu'],         id: 'icon',  name: 'DWD ICON',     shortName: 'ICON', members: 39, r: 234, g: 88,  b: 12  },
  { keys: ['ncep_gefs_seamless', 'ncep_gefs025', 'gfs025'],        id: 'gfs',   name: 'NOAA GEFS',    shortName: 'GEFS', members: 30, r: 147, g: 51,  b: 234 },
  { keys: ['ukmo_global_ensemble_20km'],                            id: 'ukmo',  name: 'UK Met Office',shortName: 'UKMO', members: 17, r: 20,  g: 184, b: 166 },
  { keys: ['gem_global_ensemble'],                                  id: 'gem',   name: 'CMC GEM',      shortName: 'GEM',  members: 20, r: 245, g: 158, b: 11  },
  // AIGEFS (experimental AI model, short range ~9d) and BOM (no data for this region) excluded.
];

// Deterministic (operational) models from the regular forecast API.
export const OP_MODELS = [
  { key: 'ecmwf_ifs',               name: 'ECMWF IFS',    shortName: 'IFS',    r: 37,  g: 99,  b: 235 },
  { key: 'dwd_icon_seamless',        name: 'DWD ICON',     shortName: 'ICON',   r: 234, g: 88,  b: 12  },
  { key: 'cmc_gem_seamless',         name: 'CMC GEM',      shortName: 'GEM',    r: 245, g: 158, b: 11  },
  { key: 'meteofrance_seamless',     name: 'Météo-France', shortName: 'MF',     r: 219, g: 39,  b: 119 },
  { key: 'meteoswiss_icon_seamless', name: 'MeteoSwiss',   shortName: 'MSwiss', r: 5,   g: 150, b: 105 },
];

// ─── Stats ─────────────────────────────────────────────────────────────────────

export function pct(arr, p) {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const i  = (p / 100) * (s.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export function statsAt(members, idx) {
  const vs = members.map(m => m[idx]).filter(Number.isFinite);
  if (!vs.length) return { p10: null, p25: null, p50: null, p75: null, p90: null };
  return {
    p10: pct(vs, 10),
    p25: pct(vs, 25),
    p50: pct(vs, 50),
    p75: pct(vs, 75),
    p90: pct(vs, 90),
  };
}

// ─── Response parsing ──────────────────────────────────────────────────────────

export function processRaw(raw) {
  const { hourly } = raw;
  const times = hourly.time;

  const tempKeys = Object.keys(hourly)
    .filter(k => /^temperature_2m_member\d+$/.test(k))
    .sort();
  if (!tempKeys.length) {
    const allKeys = Object.keys(hourly).join(', ');
    throw new Error(`No member columns found. Available keys: ${allKeys}`);
  }
  const tempMembers = tempKeys.map(k => hourly[k]);
  const stats = times.map((_, i) => statsAt(tempMembers, i));

  const windKeys = Object.keys(hourly)
    .filter(k => /^wind_?speed_10m_member\d+$/.test(k))
    .sort();
  const windMembers = windKeys.map(k => hourly[k]);
  const windStats = windMembers.length
    ? times.map((_, i) => statsAt(windMembers, i))
    : null;

  return { times, stats, windStats, count: tempKeys.length };
}

// Parse a deterministic (operational) forecast response — no member columns.
export function processRawOp(raw) {
  const { hourly } = raw;
  const times = hourly.time;
  const temps = hourly.temperature_2m ?? [];
  const winds = hourly.windspeed_10m ?? hourly.wind_speed_10m ?? [];
  if (!times?.length) throw new Error('No time array in op response');
  return { times, temps, winds };
}

// ─── Derived summaries ────────────────────────────────────────────────────────

const hourOf = t => parseInt(t.slice(11, 13), 10);

export function daytimeSummary(data, dateStr) {
  const slices = {
    morning:   [7,  11],
    afternoon: [12, 17],
    evening:   [18, 22],
    all:       [7,  22],
  };
  const out = {};
  for (const [name, [from, to]] of Object.entries(slices)) {
    const idxs = data.times.reduce((acc, t, i) => {
      if (t.startsWith(dateStr)) {
        const h = hourOf(t);
        if (h >= from && h <= to) acc.push(i);
      }
      return acc;
    }, []);
    if (!idxs.length) { out[name] = null; continue; }
    const get = fn => idxs.map(i => fn(data.stats[i])).filter(Number.isFinite);
    if (!get(s => s.p50).length) { out[name] = null; continue; }
    out[name] = {
      lo:  Math.min(...get(s => s.p10)),
      hi:  Math.max(...get(s => s.p90)),
      med: pct(get(s => s.p50), 50),
      q25: pct(get(s => s.p25), 25),
      q75: pct(get(s => s.p75), 75),
    };
  }
  return out;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function dayName(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][
    new Date(y, m - 1, d).getDay()
  ];
}

export function tempDesc(medianC) {
  if (medianC == null) return { label: 'Unknown',      colour: '#94a3b8', advice: '' };
  if (medianC < 18)   return { label: 'Cool',          colour: '#60a5fa', advice: 'Light layers may be welcome in the evening.' };
  if (medianC < 23)   return { label: 'Mild',          colour: '#4ade80', advice: 'Comfortable weather for outdoor celebrations.' };
  if (medianC < 27)   return { label: 'Warm',          colour: '#a3e635', advice: 'A lovely warm day — ideal for outdoor events.' };
  if (medianC < 31)   return { label: 'Hot',           colour: '#facc15', advice: 'Plan for shade and keep guests well hydrated.' };
  if (medianC < 35)   return { label: 'Very Hot',      colour: '#fb923c', advice: 'Ensure ample shade, fans, and cold drinks.' };
  return               { label: 'Extremely Hot',        colour: '#f87171', advice: 'Prioritise cooling — misters or air-conditioned spaces will help.' };
}

// Beaufort-inspired wind description (speed in km/h).
export function windDesc(speedKmh) {
  if (speedKmh == null) return { label: 'Unknown',         colour: '#94a3b8', advice: '' };
  if (speedKmh < 6)     return { label: 'Calm',            colour: '#94a3b8', advice: 'Very still — could feel warm with little airflow.' };
  if (speedKmh < 20)    return { label: 'Light breeze',    colour: '#4ade80', advice: 'A pleasant gentle breeze.' };
  if (speedKmh < 29)    return { label: 'Moderate breeze', colour: '#a3e635', advice: 'A lovely refreshing breeze — ideal for outdoor events.' };
  if (speedKmh < 39)    return { label: 'Fresh breeze',    colour: '#facc15', advice: 'Noticeably breezy — light decorations may need securing.' };
  if (speedKmh < 50)    return { label: 'Strong breeze',   colour: '#fb923c', advice: 'Windy — outdoor decorations should be secured.' };
  return                 { label: 'Gale',                   colour: '#f87171', advice: 'Very strong winds — outdoor events could be disrupted.' };
}

// Agreement across all available model medians for a day.
export function multiModelAgreement(summaries) {
  const meds = summaries.map(s => s?.all?.med).filter(Number.isFinite);
  if (meds.length < 2) return null;
  const spread = Math.max(...meds) - Math.min(...meds);
  if (spread < 1)  return { label: 'Excellent agreement', detail: `All models within ${spread.toFixed(1)}°C` };
  if (spread < 2)  return { label: 'Good agreement',      detail: `Spread of ${spread.toFixed(1)}°C across models` };
  if (spread < 4)  return { label: 'Moderate spread',     detail: `Spread of ${spread.toFixed(1)}°C — some uncertainty` };
  return            { label: 'Models diverge',            detail: `Spread of ${spread.toFixed(1)}°C — forecast is less certain` };
}
