'use strict';

// ─── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  lat:   44.275,
  lon:   4.527,
  start: '2026-07-13',
  end:   '2026-07-15',
  tz:    'Europe/Paris',
};

const WEDDING_DAYS = [
  { date: '2026-07-13', display: '13 July' },
  { date: '2026-07-14', display: '14 July' },
  { date: '2026-07-15', display: '15 July' },
];

const MODELS = [
  { key: 'ecmwf_ifs04',   id: 'ifs',  name: 'ECMWF IFS', r: 37,  g: 99,  b: 235 },
  { key: 'ecmwf_aifs025', id: 'aifs', name: 'AIFS',       r: 22,  g: 163, b: 74  },
];

// ─── Statistics ───────────────────────────────────────────────────────────────

function pct(arr, p) {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const i  = (p / 100) * (s.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function statsAt(members, i) {
  const vs = members.map(m => m[i]).filter(Number.isFinite);
  if (!vs.length) return { p10: null, p25: null, p50: null, p75: null, p90: null };
  return {
    p10: pct(vs, 10), p25: pct(vs, 25), p50: pct(vs, 50),
    p75: pct(vs, 75), p90: pct(vs, 90),
  };
}

// ─── Data Fetching & Processing ───────────────────────────────────────────────

async function fetchModel(key) {
  const u = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
  u.searchParams.set('latitude',   CONFIG.lat);
  u.searchParams.set('longitude',  CONFIG.lon);
  u.searchParams.set('hourly',     'temperature_2m');
  u.searchParams.set('models',     key);
  u.searchParams.set('start_date', CONFIG.start);
  u.searchParams.set('end_date',   CONFIG.end);
  u.searchParams.set('timezone',   CONFIG.tz);
  const r = await fetch(u.toString());
  if (!r.ok) {
    const msg = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status}${msg ? ' — ' + msg.slice(0, 120) : ''}`);
  }
  return r.json();
}

function processRaw(raw) {
  const { hourly } = raw;
  const times = hourly.time;
  const memberKeys = Object.keys(hourly)
    .filter(k => /^temperature_2m_member\d+$/.test(k))
    .sort();
  if (!memberKeys.length) throw new Error('No ensemble member columns in response');
  const members = memberKeys.map(k => hourly[k]);
  const stats   = times.map((_, i) => statsAt(members, i));
  return { times, stats, count: memberKeys.length };
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

const fmtT  = v => v == null ? '–' : `${Math.round(v)}°`;
const hour  = t => parseInt(t.slice(11, 13), 10);
const day   = t => parseInt(t.slice(8,  10), 10);

function dayName(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][
    new Date(y, m - 1, d).getDay()
  ];
}

function tooltipDate(times) {
  return items => {
    const t = times[items[0].dataIndex];
    if (!t) return '';
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const d  = parseInt(t.slice(8, 10), 10);
    const mo = parseInt(t.slice(5, 7),  10);
    const h  = t.slice(11, 16);
    return `${dayName(t.slice(0, 10)).slice(0, 3)}, ${d} ${MONTHS[mo - 1]}  ·  ${h}`;
  };
}

// ─── Day Summary Cards ────────────────────────────────────────────────────────

function renderCards(modelData) {
  const container = document.getElementById('day-cards');
  container.innerHTML = '';

  WEDDING_DAYS.forEach(day => {
    const card = document.createElement('div');
    card.className = 'day-card';

    let rows = '';
    for (const { model, data } of modelData) {
      if (!data) {
        rows += `<div class="model-row">
          <div class="model-dot ${model.id}"></div>
          <div class="model-label">${model.id.toUpperCase()}</div>
          <div class="no-data">unavailable</div>
        </div>`;
        continue;
      }

      const idxs = data.times.reduce((acc, t, i) => {
        if (t.startsWith(day.date) && hour(t) >= 7 && hour(t) <= 21) acc.push(i);
        return acc;
      }, []);

      if (!idxs.length) {
        rows += `<div class="model-row"><div class="model-dot ${model.id}"></div>
          <div class="model-label">${model.id.toUpperCase()}</div>
          <div class="no-data">–</div></div>`;
        continue;
      }

      const get = (fn) => idxs.map(i => fn(data.stats[i])).filter(Number.isFinite);

      const lo  = Math.min(...get(s => s.p10));
      const hi  = Math.max(...get(s => s.p90));
      const med = pct(get(s => s.p50), 50);

      rows += `<div class="model-row">
        <div class="model-dot ${model.id}"></div>
        <div class="model-label">${model.id.toUpperCase()}</div>
        <div class="temp-range">
          <span class="temp-lo">${fmtT(lo)}</span>
          <span class="temp-sep">&mdash;</span>
          <span class="temp-med">${fmtT(med)}</span>
          <span class="temp-sep">&mdash;</span>
          <span class="temp-hi">${fmtT(hi)}</span>
        </div>
      </div>`;
    }

    card.innerHTML = `
      <div class="day-name">${dayName(day.date)}</div>
      <div class="day-date">${day.display}</div>
      ${rows}
      <div class="day-hint">10th &middot; median &middot; 90th</div>
    `;
    container.appendChild(card);
  });
}

// ─── Chart Helpers ────────────────────────────────────────────────────────────

const rgba = (r, g, b, a) => `rgba(${r},${g},${b},${a})`;

function xTickFn(times) {
  return (_, idx) => {
    const t = times[idx];
    if (!t) return '';
    const h = hour(t);
    if (h === 0)  return `${day(t)} Jul`;
    if (h % 6 === 0) return `${String(h).padStart(2, '0')}:00`;
    return '';
  };
}

function gridColorFn(times) {
  return ctx => {
    const t = times[ctx.index];
    return (t && hour(t) === 0) ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.04)';
  };
}

function sharedScales(times) {
  return {
    x: {
      ticks: {
        maxRotation: 0,
        font:       { family: "'Jost', sans-serif", size: 11 },
        color:      '#6b5f58',
        callback:   xTickFn(times),
        maxTicksLimit: 48,
      },
      grid:   { color: gridColorFn(times) },
      border: { color: 'rgba(0,0,0,0.1)' },
    },
    y: {
      title: {
        display: true,
        text:    'Temperature (°C)',
        font:    { family: "'Jost', sans-serif", size: 11 },
        color:   '#6b5f58',
      },
      ticks: {
        font:     { family: "'Jost', sans-serif", size: 11 },
        color:    '#6b5f58',
        callback: v => `${v}°C`,
      },
      grid:   { color: 'rgba(0,0,0,0.04)' },
      border: { color: 'rgba(0,0,0,0.1)' },
    },
  };
}

// ─── Plume Chart ──────────────────────────────────────────────────────────────

function buildPlumeDatasets(stats, r, g, b) {
  const c = a => rgba(r, g, b, a);
  return [
    // Index 0 — p10 anchor (invisible)
    {
      label: '_p10',
      data:            stats.map(s => s.p10),
      borderColor:     'transparent',
      backgroundColor: 'transparent',
      borderWidth: 0, pointRadius: 0, tension: 0.35, fill: false,
    },
    // Index 1 — p90 fills back to index 0 → outer band
    {
      label:           '10–90th percentile',
      data:            stats.map(s => s.p90),
      borderColor:     'transparent',
      backgroundColor: c(0.17),
      borderWidth: 0, pointRadius: 0, tension: 0.35, fill: 0,
    },
    // Index 2 — p25 anchor (invisible)
    {
      label: '_p25',
      data:            stats.map(s => s.p25),
      borderColor:     'transparent',
      backgroundColor: 'transparent',
      borderWidth: 0, pointRadius: 0, tension: 0.35, fill: false,
    },
    // Index 3 — p75 fills back to index 2 → inner band
    {
      label:           '25–75th percentile',
      data:            stats.map(s => s.p75),
      borderColor:     'transparent',
      backgroundColor: c(0.36),
      borderWidth: 0, pointRadius: 0, tension: 0.35, fill: 2,
    },
    // Index 4 — median line
    {
      label:           'Median',
      data:            stats.map(s => s.p50),
      borderColor:     c(1),
      backgroundColor: 'transparent',
      borderWidth: 2.5, pointRadius: 0, tension: 0.35, fill: false,
    },
  ];
}

function plumeChart(canvasId, times, stats, r, g, b) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const c = a => rgba(r, g, b, a);

  return new Chart(ctx, {
    type: 'line',
    data: { labels: times, datasets: buildPlumeDatasets(stats, r, g, b) },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            filter: item => !item.text.startsWith('_'),
            font: { family: "'Jost', sans-serif", size: 12 },
            color: '#6b5f58',
            padding: 18,
            usePointStyle: true,
            generateLabels: () => [
              { text: '10–90th percentile', fillStyle: c(0.22), strokeStyle: 'transparent', pointStyle: 'rect', lineWidth: 0 },
              { text: '25–75th percentile', fillStyle: c(0.48), strokeStyle: 'transparent', pointStyle: 'rect', lineWidth: 0 },
              { text: 'Median',             fillStyle: 'transparent', strokeStyle: c(1), pointStyle: 'line', lineWidth: 2.5 },
            ],
          },
        },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.97)',
          borderColor:     c(0.3),
          borderWidth: 1,
          titleColor: '#2c2825',
          bodyColor:  '#6b5f58',
          padding: 13,
          callbacks: {
            title:     tooltipDate(times),
            label:     () => null,
            afterBody: items => {
              const s = stats[items[0].dataIndex];
              return [
                `Median:      ${fmtT(s.p50)}C`,
                `50% range:   ${fmtT(s.p25)}C  –  ${fmtT(s.p75)}C`,
                `80% range:   ${fmtT(s.p10)}C  –  ${fmtT(s.p90)}C`,
              ];
            },
          },
        },
      },
      scales: sharedScales(times),
    },
  });
}

// ─── Comparison Chart ─────────────────────────────────────────────────────────

function comparisonChart(ifsData, aifsData) {
  const ctx = document.getElementById('chart-comparison');
  if (!ctx) return null;

  const times = (ifsData || aifsData).times;
  const nul   = times.map(() => null);

  const ds = [];

  // IFS band
  if (ifsData) {
    ds.push(
      { label: '_ifs_p25', data: ifsData.stats.map(s => s.p25), borderColor: 'transparent', backgroundColor: 'transparent', borderWidth: 0, pointRadius: 0, tension: 0.35, fill: false },
      { label: 'IFS 25–75th %ile', data: ifsData.stats.map(s => s.p75), borderColor: 'transparent', backgroundColor: 'rgba(37,99,235,0.18)', borderWidth: 0, pointRadius: 0, tension: 0.35, fill: ds.length },
      { label: 'IFS Median', data: ifsData.stats.map(s => s.p50), borderColor: 'rgba(37,99,235,1)', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0.35, fill: false },
    );
  }

  // AIFS band
  if (aifsData) {
    const base = ds.length;
    ds.push(
      { label: '_aifs_p25', data: aifsData.stats.map(s => s.p25), borderColor: 'transparent', backgroundColor: 'transparent', borderWidth: 0, pointRadius: 0, tension: 0.35, fill: false },
      { label: 'AIFS 25–75th %ile', data: aifsData.stats.map(s => s.p75), borderColor: 'transparent', backgroundColor: 'rgba(22,163,74,0.18)', borderWidth: 0, pointRadius: 0, tension: 0.35, fill: base },
      { label: 'AIFS Median', data: aifsData.stats.map(s => s.p50), borderColor: 'rgba(22,163,74,1)', backgroundColor: 'transparent', borderWidth: 2.5, pointRadius: 0, tension: 0.35, fill: false },
    );
  }

  const legendEntries = [];
  if (ifsData)  legendEntries.push(
    { text: 'IFS 25–75th percentile', fillStyle: 'rgba(37,99,235,0.28)', strokeStyle: 'transparent', pointStyle: 'rect', lineWidth: 0 },
    { text: 'IFS Median',             fillStyle: 'transparent', strokeStyle: 'rgba(37,99,235,1)', pointStyle: 'line', lineWidth: 2.5 },
  );
  if (aifsData) legendEntries.push(
    { text: 'AIFS 25–75th percentile', fillStyle: 'rgba(22,163,74,0.28)', strokeStyle: 'transparent', pointStyle: 'rect', lineWidth: 0 },
    { text: 'AIFS Median',              fillStyle: 'transparent', strokeStyle: 'rgba(22,163,74,1)', pointStyle: 'line', lineWidth: 2.5 },
  );

  return new Chart(ctx, {
    type: 'line',
    data: { labels: times, datasets: ds },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            filter: item => !item.text.startsWith('_'),
            font: { family: "'Jost', sans-serif", size: 12 },
            color: '#6b5f58',
            padding: 18,
            usePointStyle: true,
            generateLabels: () => legendEntries,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.97)',
          borderColor:     'rgba(0,0,0,0.1)',
          borderWidth: 1,
          titleColor: '#2c2825',
          bodyColor:  '#6b5f58',
          padding: 13,
          callbacks: {
            title:     tooltipDate(times),
            label:     () => null,
            afterBody: items => {
              const i = items[0].dataIndex;
              const lines = [];
              if (ifsData)  { const s = ifsData.stats[i];  lines.push(`IFS:   ${fmtT(s.p50)}C   (${fmtT(s.p25)} – ${fmtT(s.p75)})`); }
              if (aifsData) { const s = aifsData.stats[i]; lines.push(`AIFS:  ${fmtT(s.p50)}C   (${fmtT(s.p25)} – ${fmtT(s.p75)})`); }
              return lines;
            },
          },
        },
      },
      scales: sharedScales(times),
    },
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const $status  = document.getElementById('status');
  const $app     = document.getElementById('app');
  const $error   = document.getElementById('error-state');
  const $errMsg  = document.getElementById('error-msg');

  try {
    const results = await Promise.allSettled(
      MODELS.map(m => fetchModel(m.key).then(processRaw))
    );

    const modelData = MODELS.map((model, i) => ({
      model,
      data:  results[i].status === 'fulfilled' ? results[i].value  : null,
      error: results[i].status === 'rejected'  ? results[i].reason : null,
    }));

    const ifsEntry  = modelData[0];
    const aifsEntry = modelData[1];

    if (!ifsEntry.data && !aifsEntry.data) {
      throw new Error(
        modelData.map(m => m.error?.message).filter(Boolean).join(' | ')
        || 'Both model fetches failed'
      );
    }

    // Day summary cards
    renderCards(modelData);

    // Individual model charts
    for (const { model, data, error } of modelData) {
      if (!data) {
        document.getElementById(`unavail-${model.id}`)?.classList.remove('hidden');
        document.getElementById(`wrap-${model.id}`)?.classList.add('hidden');
        continue;
      }
      plumeChart(`chart-${model.id}`, data.times, data.stats, model.r, model.g, model.b);
    }

    // Comparison chart
    comparisonChart(ifsEntry.data, aifsEntry.data);

    // Timestamp
    const now = new Date();
    document.getElementById('last-updated').textContent =
      `Data loaded at ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} on ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;

    $status.classList.add('hidden');
    $app.classList.remove('hidden');

  } catch (err) {
    console.error(err);
    $status.classList.add('hidden');
    $errMsg.textContent = err.message || 'Could not load forecast data.';
    $error.classList.remove('hidden');
  }
}

main();
