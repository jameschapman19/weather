// Pure functions — no DOM or side-effects. Imported by app.js and the test suite.

export const CONFIG = {
  lat:   44.275,
  lon:   4.527,
  start: '2026-07-13',
  end:   '2026-07-15',
  tz:    'Europe/Paris',
};

export const WEDDING_DAYS = [
  { date: '2026-07-13', display: '13 July' },
  { date: '2026-07-14', display: '14 July' },
  { date: '2026-07-15', display: '15 July' },
];

// ecmwf_ifs04 is deterministic-only; ecmwf_ifs025 is the ensemble key (50 members).
export const IFS_MODEL_KEYS  = ['ecmwf_ifs025'];
export const AIFS_MODEL_KEYS = ['ecmwf_aifs025'];

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
  const memberKeys = Object.keys(hourly)
    .filter(k => /^temperature_2m_member\d+$/.test(k))
    .sort();
  if (!memberKeys.length) {
    const allKeys = Object.keys(hourly).join(', ');
    throw new Error(`No member columns found. Available keys: ${allKeys}`);
  }
  const members = memberKeys.map(k => hourly[k]);
  const stats   = times.map((_, i) => statsAt(members, i));
  return { times, stats, count: memberKeys.length };
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
  if (medianC == null) return { label: 'Unknown',       colour: '#94a3b8', advice: '' };
  if (medianC < 18)   return { label: 'Cool',           colour: '#60a5fa', advice: 'Light layers may be welcome in the evening.' };
  if (medianC < 23)   return { label: 'Mild',           colour: '#4ade80', advice: 'Comfortable weather for outdoor celebrations.' };
  if (medianC < 27)   return { label: 'Warm',           colour: '#a3e635', advice: 'A lovely warm day — ideal for outdoor events.' };
  if (medianC < 31)   return { label: 'Hot',            colour: '#facc15', advice: 'Plan for shade and keep guests well hydrated.' };
  if (medianC < 35)   return { label: 'Very Hot',       colour: '#fb923c', advice: 'Ensure ample shade, fans, and cold drinks.' };
  return               { label: 'Extremely Hot',         colour: '#f87171', advice: 'Prioritise cooling — misters or air-conditioned spaces will help.' };
}

export function modelAgreement(ifsSummary, aifsSummary) {
  if (!ifsSummary?.all || !aifsSummary?.all) return null;
  const diff = Math.abs(ifsSummary.all.med - aifsSummary.all.med);
  if (diff < 1)  return { label: 'Excellent agreement', detail: `Medians within ${diff.toFixed(1)}°C` };
  if (diff < 2)  return { label: 'Good agreement',      detail: `Medians within ${diff.toFixed(1)}°C` };
  if (diff < 4)  return { label: 'Moderate spread',     detail: `Medians differ by ${diff.toFixed(1)}°C` };
  return          { label: 'Models diverge',            detail: `Medians differ by ${diff.toFixed(1)}°C — forecast is less certain` };
}
