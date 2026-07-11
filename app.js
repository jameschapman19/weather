import {
  CONFIG, WEDDING_DAYS, MODELS, OP_MODELS,
  pct, processRaw, processRawOp, daytimeSummary, dayName, tempDesc, windDesc, multiModelAgreement,
} from './lib.js?v=12';

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchModel(key) {
  const u = new URL('https://ensemble-api.open-meteo.com/v1/ensemble');
  u.searchParams.set('latitude',   CONFIG.lat);
  u.searchParams.set('longitude',  CONFIG.lon);
  u.searchParams.set('hourly',     'temperature_2m,windspeed_10m');
  u.searchParams.set('models',     key);
  u.searchParams.set('start_date', CONFIG.start);
  u.searchParams.set('end_date',   CONFIG.end);
  u.searchParams.set('timezone',   CONFIG.tz);
  const r = await fetch(u.toString());
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} for "${key}"${body ? ' — ' + body.slice(0, 200) : ''}`);
  }
  return r.json();
}

async function fetchOpModel(model) {
  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude',   CONFIG.lat);
  u.searchParams.set('longitude',  CONFIG.lon);
  u.searchParams.set('hourly',     'temperature_2m,windspeed_10m');
  u.searchParams.set('models',     model.key);
  u.searchParams.set('start_date', CONFIG.start);
  u.searchParams.set('end_date',   CONFIG.end);
  u.searchParams.set('timezone',   CONFIG.tz);
  const r = await fetch(u.toString());
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} for op "${model.key}"${body ? ' — ' + body.slice(0, 200) : ''}`);
  }
  const raw = await r.json();
  return { model, data: processRawOp(raw) };
}

async function fetchFirstWorking(model) {
  let lastErr;
  for (const key of model.keys) {
    try {
      const raw  = await fetchModel(key);
      console.log(`[weather] ${key} hourly keys:`, Object.keys(raw.hourly).join(', '));
      const data = processRaw(raw);
      console.log(`[weather] ${key} times[0]=${data.times[0]}, windStats=${data.windStats ? `${data.windStats.length} pts, first p50=${data.windStats[0]?.p50}` : 'null'}`);
      return { data, key };
    } catch (err) {
      console.warn(`[weather] ${key} failed: ${err.message}`);
      lastErr = err;
    }
  }
  throw lastErr;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const fmtT   = v => v == null ? '–' : `${Math.round(v)}°`;
const fmtW   = v => v == null ? '–' : `${Math.round(v)} km/h`;
const hourOf = t => parseInt(t.slice(11, 13), 10);

function tooltipDateFn(times) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return items => {
    const t = times[items[0].dataIndex];
    if (!t) return '';
    const d  = parseInt(t.slice(8, 10), 10);
    const mo = parseInt(t.slice(5, 7),  10);
    return `${dayName(t.slice(0,10)).slice(0,3)}, ${d} ${MONTHS[mo-1]}  ·  ${t.slice(11,16)}`;
  };
}

// ─── Glance section ───────────────────────────────────────────────────────────

function renderGlance(results) {
  const container = document.getElementById('glance-cards');
  container.innerHTML = '';

  WEDDING_DAYS.forEach(day => {
    const summaries = results.map(({ data }) => data ? daytimeSummary(data, day.date) : null);
    const meds = summaries.map(s => s?.all?.med).filter(Number.isFinite);
    const overallMed = meds.length ? pct(meds, 50) : null;
    const desc  = tempDesc(overallMed);
    const agree = multiModelAgreement(summaries);

    const allLo = summaries.map(s => s?.all?.lo).filter(Number.isFinite);
    const allHi = summaries.map(s => s?.all?.hi).filter(Number.isFinite);
    const lo = allLo.length ? Math.min(...allLo) : null;
    const hi = allHi.length ? Math.max(...allHi) : null;

    const scale = v => Math.max(0, Math.min(100, ((v - 18) / 24) * 100));
    const pLo  = lo != null ? scale(lo)        : 20;
    const pHi  = hi != null ? scale(hi)        : 80;
    const pMed = overallMed != null ? scale(overallMed) : 50;

    // Time-of-day: prefer IFS, fallback through models
    const tod = (slot) => summaries.find(s => s?.[slot]?.med != null)?.[slot]?.med ?? null;

    // Daytime wind median across all models
    const windP50s = [];
    for (const { data } of results) {
      if (!data?.windStats) continue;
      const p50s = data.times.reduce((acc, t, i) => {
        if (t.startsWith(day.date)) {
          const h = hourOf(t);
          if (h >= 7 && h <= 22) {
            const v = data.windStats[i]?.p50;
            if (Number.isFinite(v)) acc.push(v);
          }
        }
        return acc;
      }, []);
      if (p50s.length) windP50s.push(pct(p50s, 50));
    }
    const overallWindMed = windP50s.length ? pct(windP50s, 50) : null;
    const wd = windDesc(overallWindMed);

    // Model rows for the card
    const modelRows = results.map(({ model, data }) => {
      if (!data) return `<div class="model-row"><div class="model-dot" style="background:rgba(${model.r},${model.g},${model.b},1)"></div><div class="model-label">${model.shortName}</div><div class="no-data">–</div></div>`;
      const s = daytimeSummary(data, day.date).all;
      if (!s) return `<div class="model-row"><div class="model-dot" style="background:rgba(${model.r},${model.g},${model.b},1)"></div><div class="model-label">${model.shortName}</div><div class="no-data">–</div></div>`;
      return `<div class="model-row">
        <div class="model-dot" style="background:rgba(${model.r},${model.g},${model.b},1)"></div>
        <div class="model-label">${model.shortName}</div>
        <div class="temp-range">
          <span class="temp-lo">${fmtT(s.lo)}</span>
          <span class="temp-sep">–</span>
          <span class="temp-med">${fmtT(s.med)}</span>
          <span class="temp-sep">–</span>
          <span class="temp-hi">${fmtT(s.hi)}</span>
        </div>
      </div>`;
    }).join('');

    const card = document.createElement('div');
    card.className = 'glance-card';
    card.innerHTML = `
      <div class="glance-heat-label" style="background:${desc.colour}20;color:${desc.colour};border-color:${desc.colour}40">${desc.label}</div>
      <div class="glance-dayname">${dayName(day.date)}</div>
      <div class="glance-date">${day.display}</div>
      <div class="glance-median">${fmtT(overallMed)}C</div>
      <div class="glance-median-label">ensemble median</div>
      <div class="temp-bar-wrap">
        <div class="temp-bar-track">
          <div class="temp-bar-fill" style="left:${pLo}%;width:${pHi-pLo}%;background:linear-gradient(90deg,${desc.colour}60,${desc.colour})"></div>
          <div class="temp-bar-median" style="left:${pMed}%"></div>
        </div>
        <div class="temp-bar-labels">
          <span>${fmtT(lo)}</span><span>ensemble range</span><span>${fmtT(hi)}</span>
        </div>
      </div>
      <div class="glance-tod">
        <div class="tod-item"><div class="tod-label">Morning</div><div class="tod-temp">${fmtT(tod('morning'))}C</div></div>
        <div class="tod-sep">→</div>
        <div class="tod-item"><div class="tod-label">Afternoon</div><div class="tod-temp tod-peak">${fmtT(tod('afternoon'))}C</div></div>
        <div class="tod-sep">→</div>
        <div class="tod-item"><div class="tod-label">Evening</div><div class="tod-temp">${fmtT(tod('evening'))}C</div></div>
      </div>
      ${overallWindMed != null ? `<div class="glance-wind">
        <span class="glance-wind-badge" style="background:${wd.colour}20;color:${wd.colour};border-color:${wd.colour}40">${wd.label} · ~${Math.round(overallWindMed)} km/h</span>
        ${wd.advice ? `<span class="glance-wind-advice">${wd.advice}</span>` : ''}
      </div>` : ''}
      ${modelRows}
      ${agree ? `<div class="glance-agree">${agree.label} · ${agree.detail}</div>` : ''}
      ${desc.advice ? `<div class="glance-advice">${desc.advice}</div>` : ''}
    `;
    container.appendChild(card);
  });
}

// ─── Chart helpers ────────────────────────────────────────────────────────────

const rgba = (r, g, b, a) => `rgba(${r},${g},${b},${a})`;

function xTickFn(times) {
  return (_, idx) => {
    const t = times[idx];
    if (!t) return '';
    const h = hourOf(t);
    if (h === 0)     return `${parseInt(t.slice(8,10),10)} Jul`;
    if (h % 6 === 0) return `${String(h).padStart(2,'0')}:00`;
    return '';
  };
}

function gridColorFn(times) {
  return ctx => (times[ctx.index] && hourOf(times[ctx.index]) === 0)
    ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.04)';
}

function sharedScales(times, yLabel = 'Temperature (°C)', yTick = v => `${v}°C`, yMin, yMax) {
  return {
    x: {
      ticks: { maxRotation:0, font:{family:"'Jost',sans-serif",size:11}, color:'#6b5f58', callback:xTickFn(times), maxTicksLimit:48 },
      grid:   { color: gridColorFn(times) },
      border: { color: 'rgba(0,0,0,0.1)' },
    },
    y: {
      ...(yMin != null && { min: yMin }),
      ...(yMax != null && { max: yMax }),
      title: { display:true, text:yLabel, font:{family:"'Jost',sans-serif",size:11}, color:'#6b5f58' },
      ticks: { font:{family:"'Jost',sans-serif",size:11}, color:'#6b5f58', callback:yTick },
      grid:   { color: 'rgba(0,0,0,0.04)' },
      border: { color: 'rgba(0,0,0,0.1)' },
    },
  };
}

// ─── Multi-model comparison chart ────────────────────────────────────────────

function comparisonChart(canvasId, results, statKey = 'stats', {
  yLabel = 'Temperature (°C)',
  yTick  = v => `${v}°C`,
  fmtVal = v => fmtT(v) + 'C',
  yMin, yMax,
} = {}) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const available = results.filter(r => r.data?.[statKey]);
  if (!available.length) return null;
  const times = available[0].data.times;

  const ds = [];
  const legendEntries = [];

  for (const { model, data } of available) {
    const { r, g, b, shortName } = model;
    const base = ds.length;
    const series = data[statKey];
    ds.push(
      { label:`_${model.id}_p25`, data:series.map(s=>s.p25), borderWidth:0, borderColor:'transparent', backgroundColor:'transparent', pointRadius:0, tension:0.35, fill:false },
      { label:`_${model.id}_p75`, data:series.map(s=>s.p75), borderWidth:0, borderColor:'transparent', backgroundColor:rgba(r,g,b,0.18), pointRadius:0, tension:0.35, fill:base },
      { label: shortName, data:series.map(s=>s.p50), borderColor:rgba(r,g,b,1), backgroundColor:'transparent', borderWidth:2.5, pointRadius:0, tension:0.35, fill:false },
    );
    legendEntries.push(
      { text: shortName, fillStyle: rgba(r,g,b,0.28), strokeStyle: rgba(r,g,b,1), pointStyle:'rectRounded', lineWidth:1.5 },
    );
  }

  return new Chart(ctx, {
    type:'line',
    data:{ labels:times, datasets:ds },
    options:{
      responsive:true, maintainAspectRatio:false, animation:{duration:500},
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ labels:{ font:{family:"'Jost',sans-serif",size:12}, color:'#6b5f58', padding:14, usePointStyle:true, boxWidth:14, boxHeight:10, generateLabels:()=>legendEntries } },
        tooltip:{
          backgroundColor:'rgba(255,255,255,0.97)', borderColor:'rgba(0,0,0,0.1)', borderWidth:1,
          titleColor:'#2c2825', bodyColor:'#6b5f58', padding:13,
          callbacks:{
            title: tooltipDateFn(times),
            label: ()=>null,
            afterBody: items => {
              const i = items[0].dataIndex;
              return available.map(({ model, data }) => {
                const s = data[statKey][i];
                return `${model.shortName.padEnd(5)}: ${fmtVal(s.p50)}  (${fmtVal(s.p25)}–${fmtVal(s.p75)})`;
              });
            },
          },
        },
      },
      scales: sharedScales(times, yLabel, yTick, yMin, yMax),
    },
  });
}

// ─── Operational (deterministic) line chart ───────────────────────────────────

function opLineChart(canvasId, opResults, {
  yLabel  = 'Temperature (°C)',
  yTick   = v => `${v}°C`,
  fmtVal  = v => fmtT(v) + 'C',
  dataKey = 'temps',
  yMin, yMax,
} = {}) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;

  const available = opResults.filter(r => r.data?.[dataKey]?.length);
  if (!available.length) return null;
  const times = available[0].data.times;

  const legendEntries = [];
  const ds = available.map(({ model, data }) => {
    const { r, g, b, shortName } = model;
    legendEntries.push({ text: shortName, fillStyle: 'transparent', strokeStyle: rgba(r,g,b,1), pointStyle:'line', lineWidth:2 });
    return {
      label: shortName,
      data:  data[dataKey],
      borderColor: rgba(r,g,b,1),
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0.35,
      fill: false,
    };
  });

  return new Chart(ctx, {
    type: 'line',
    data: { labels: times, datasets: ds },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { font:{family:"'Jost',sans-serif",size:12}, color:'#6b5f58', padding:14, usePointStyle:true, boxWidth:14, boxHeight:10, generateLabels:()=>legendEntries } },
        tooltip: {
          backgroundColor:'rgba(255,255,255,0.97)', borderColor:'rgba(0,0,0,0.1)', borderWidth:1,
          titleColor:'#2c2825', bodyColor:'#6b5f58', padding:13,
          callbacks: {
            title: tooltipDateFn(times),
            label: ()=>null,
            afterBody: items => {
              const i = items[0].dataIndex;
              return available.map(({ model, data }) => {
                const v = data[dataKey][i];
                return `${model.shortName.padEnd(6)}: ${Number.isFinite(v) ? fmtVal(v) : '–'}`;
              });
            },
          },
        },
      },
      scales: sharedScales(times, yLabel, yTick, yMin, yMax),
    },
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const WIND_YAXIS = {
  yLabel: 'Wind Speed (km/h)',
  yTick:  v => `${Math.round(v)} km/h`,
  fmtVal: fmtW,
};

async function main() {
  const $status = document.getElementById('status');
  const $app    = document.getElementById('app');
  const $error  = document.getElementById('error-state');
  const $errMsg = document.getElementById('error-msg');

  try {
    const [settled, opSettled] = await Promise.all([
      Promise.allSettled(MODELS.map(fetchFirstWorking)),
      Promise.allSettled(OP_MODELS.map(fetchOpModel)),
    ]);

    const results = MODELS.map((model, i) => ({
      model,
      data:  settled[i].status === 'fulfilled' ? settled[i].value.data  : null,
      key:   settled[i].status === 'fulfilled' ? settled[i].value.key   : null,
      error: settled[i].status === 'rejected'  ? settled[i].reason      : null,
    }));

    const opResults = OP_MODELS.map((model, i) => ({
      model,
      data:  opSettled[i].status === 'fulfilled' ? opSettled[i].value.data : null,
      error: opSettled[i].status === 'rejected'  ? opSettled[i].reason     : null,
    }));

    if (results.every(r => !r.data) && opResults.every(r => !r.data)) {
      throw new Error(results.map(r => r.error?.message).filter(Boolean).join(' | '));
    }

    // Shared y-axis bounds across all ensemble models so charts are directly comparable
    const globalBounds = (statKey, forceMinZero = false) => {
      let lo = Infinity, hi = -Infinity;
      for (const { data } of results) {
        if (!data?.[statKey]) continue;
        for (const s of data[statKey]) {
          if (Number.isFinite(s.p10) && s.p10 < lo) lo = s.p10;
          if (Number.isFinite(s.p90) && s.p90 > hi) hi = s.p90;
        }
      }
      if (!isFinite(lo) || !isFinite(hi)) return {};
      const pad = Math.max((hi - lo) * 0.06, 1);
      return { yMin: forceMinZero ? 0 : Math.floor(lo - pad), yMax: Math.ceil(hi + pad) };
    };
    const tempBounds = globalBounds('stats');
    const windBounds = globalBounds('windStats', true);

    // Glance section
    renderGlance(results);

    // Comparison charts (temperature + wind) — ensemble
    comparisonChart('chart-comparison', results, 'stats', tempBounds);
    comparisonChart('chart-wind-comparison', results, 'windStats', { ...WIND_YAXIS, ...windBounds });

    // Operational (deterministic) line charts — include ensemble bounds for comparability
    const opTempBounds = (() => {
      let lo = Infinity, hi = -Infinity;
      for (const { data } of opResults) {
        if (!data?.temps?.length) continue;
        for (const v of data.temps) { if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      }
      if (Number.isFinite(tempBounds.yMin) && tempBounds.yMin < lo) lo = tempBounds.yMin;
      if (Number.isFinite(tempBounds.yMax) && tempBounds.yMax > hi) hi = tempBounds.yMax;
      if (!isFinite(lo)) return tempBounds;
      const pad = Math.max((hi - lo) * 0.06, 1);
      return { yMin: Math.floor(lo - pad), yMax: Math.ceil(hi + pad) };
    })();
    const opWindBounds = (() => {
      let hi = -Infinity;
      for (const { data } of opResults) {
        if (!data?.winds?.length) continue;
        for (const v of data.winds) { if (Number.isFinite(v) && v > hi) hi = v; }
      }
      if (Number.isFinite(windBounds.yMax) && windBounds.yMax > hi) hi = windBounds.yMax;
      if (!isFinite(hi)) return windBounds;
      const pad = Math.max(hi * 0.06, 1);
      return { yMin: 0, yMax: Math.ceil(hi + pad) };
    })();
    opLineChart('chart-op-temp', opResults, { ...opTempBounds });
    opLineChart('chart-op-wind', opResults, { ...WIND_YAXIS, dataKey: 'winds', ...opWindBounds });

    document.getElementById('last-updated').textContent =
      `Loaded ${new Date().toLocaleString('en-GB', { dateStyle:'medium', timeStyle:'short' })}`;

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
