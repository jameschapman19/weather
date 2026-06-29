import {
  CONFIG, WEDDING_DAYS, MODELS,
  pct, processRaw, daytimeSummary, dayName, tempDesc, multiModelAgreement,
} from './lib.js';

// ─── API ──────────────────────────────────────────────────────────────────────

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
    const body = await r.text().catch(() => '');
    throw new Error(`HTTP ${r.status} for "${key}"${body ? ' — ' + body.slice(0, 200) : ''}`);
  }
  return r.json();
}

async function fetchFirstWorking(model) {
  let lastErr;
  for (const key of model.keys) {
    try {
      const raw  = await fetchModel(key);
      const data = processRaw(raw);
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
    const pLo  = lo != null ? scale(lo)         : 20;
    const pHi  = hi != null ? scale(hi)         : 80;
    const pMed = overallMed  != null ? scale(overallMed) : 50;

    // Time-of-day: prefer IFS, fallback through models
    const tod = (slot) => summaries.find(s => s?.[slot]?.med != null)?.[slot]?.med ?? null;

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

function sharedScales(times) {
  return {
    x: {
      ticks: { maxRotation:0, font:{family:"'Jost',sans-serif",size:11}, color:'#6b5f58', callback:xTickFn(times), maxTicksLimit:48 },
      grid:   { color: gridColorFn(times) },
      border: { color: 'rgba(0,0,0,0.1)' },
    },
    y: {
      title: { display:true, text:'Temperature (°C)', font:{family:"'Jost',sans-serif",size:11}, color:'#6b5f58' },
      ticks: { font:{family:"'Jost',sans-serif",size:11}, color:'#6b5f58', callback:v=>`${v}°C` },
      grid:   { color: 'rgba(0,0,0,0.04)' },
      border: { color: 'rgba(0,0,0,0.1)' },
    },
  };
}

// ─── Plume chart ──────────────────────────────────────────────────────────────

function plumeChart(canvasId, times, stats, r, g, b) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const c = a => rgba(r, g, b, a);

  const ds = [
    { label:'_p10', data:stats.map(s=>s.p10), borderWidth:0, borderColor:'transparent', backgroundColor:'transparent', pointRadius:0, tension:0.35, fill:false },
    { label:'10–90th percentile', data:stats.map(s=>s.p90), borderWidth:0, borderColor:'transparent', backgroundColor:c(0.17), pointRadius:0, tension:0.35, fill:0 },
    { label:'_p25', data:stats.map(s=>s.p25), borderWidth:0, borderColor:'transparent', backgroundColor:'transparent', pointRadius:0, tension:0.35, fill:false },
    { label:'25–75th percentile', data:stats.map(s=>s.p75), borderWidth:0, borderColor:'transparent', backgroundColor:c(0.36), pointRadius:0, tension:0.35, fill:2 },
    { label:'Median', data:stats.map(s=>s.p50), borderColor:c(1), backgroundColor:'transparent', borderWidth:2.5, pointRadius:0, tension:0.35, fill:false },
  ];

  return new Chart(ctx, {
    type: 'line',
    data: { labels: times, datasets: ds },
    options: {
      responsive:true, maintainAspectRatio:false, animation:{duration:500},
      interaction:{ mode:'index', intersect:false },
      plugins: {
        legend: {
          labels: {
            filter: item => !item.text.startsWith('_'),
            font:{family:"'Jost',sans-serif",size:12}, color:'#6b5f58', padding:18, usePointStyle:true,
            generateLabels: () => [
              { text:'10–90th percentile', fillStyle:c(0.22), strokeStyle:'transparent', pointStyle:'rect', lineWidth:0 },
              { text:'25–75th percentile', fillStyle:c(0.48), strokeStyle:'transparent', pointStyle:'rect', lineWidth:0 },
              { text:'Median',             fillStyle:'transparent', strokeStyle:c(1), pointStyle:'line', lineWidth:2.5 },
            ],
          },
        },
        tooltip: {
          backgroundColor:'rgba(255,255,255,0.97)', borderColor:c(0.3), borderWidth:1,
          titleColor:'#2c2825', bodyColor:'#6b5f58', padding:13,
          callbacks: {
            title: tooltipDateFn(times),
            label: () => null,
            afterBody: items => {
              const s = stats[items[0].dataIndex];
              return [`Median: ${fmtT(s.p50)}C`, `50% range: ${fmtT(s.p25)}–${fmtT(s.p75)}C`, `80% range: ${fmtT(s.p10)}–${fmtT(s.p90)}C`];
            },
          },
        },
      },
      scales: sharedScales(times),
    },
  });
}

// ─── Multi-model comparison chart ────────────────────────────────────────────

function comparisonChart(results) {
  const ctx = document.getElementById('chart-comparison');
  if (!ctx) return null;

  const available = results.filter(r => r.data);
  if (!available.length) return null;
  const times = available[0].data.times;

  const ds = [];
  const legendEntries = [];

  for (const { model, data } of available) {
    const { r, g, b, name } = model;
    const base = ds.length;
    ds.push(
      { label:`_${model.id}_p25`, data:data.stats.map(s=>s.p25), borderWidth:0, borderColor:'transparent', backgroundColor:'transparent', pointRadius:0, tension:0.35, fill:false },
      { label:`${name} 25–75th`, data:data.stats.map(s=>s.p75), borderWidth:0, borderColor:'transparent', backgroundColor:rgba(r,g,b,0.18), pointRadius:0, tension:0.35, fill:base },
      { label:`${name} Median`,  data:data.stats.map(s=>s.p50), borderColor:rgba(r,g,b,1), backgroundColor:'transparent', borderWidth:2.5, pointRadius:0, tension:0.35, fill:false },
    );
    legendEntries.push(
      { text:`${name} 25–75th`, fillStyle:rgba(r,g,b,0.28), strokeStyle:'transparent', pointStyle:'rect', lineWidth:0 },
      { text:`${name} Median`,  fillStyle:'transparent', strokeStyle:rgba(r,g,b,1), pointStyle:'line', lineWidth:2.5 },
    );
  }

  return new Chart(ctx, {
    type:'line',
    data:{ labels:times, datasets:ds },
    options:{
      responsive:true, maintainAspectRatio:false, animation:{duration:500},
      interaction:{ mode:'index', intersect:false },
      plugins:{
        legend:{ labels:{ filter:i=>!i.text.startsWith('_'), font:{family:"'Jost',sans-serif",size:12}, color:'#6b5f58', padding:18, usePointStyle:true, generateLabels:()=>legendEntries } },
        tooltip:{
          backgroundColor:'rgba(255,255,255,0.97)', borderColor:'rgba(0,0,0,0.1)', borderWidth:1,
          titleColor:'#2c2825', bodyColor:'#6b5f58', padding:13,
          callbacks:{
            title: tooltipDateFn(times),
            label: ()=>null,
            afterBody: items => {
              const i = items[0].dataIndex;
              return available.map(({ model, data }) => {
                const s = data.stats[i];
                return `${model.shortName.padEnd(5)}: ${fmtT(s.p50)}C  (${fmtT(s.p25)}–${fmtT(s.p75)})`;
              });
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
  const $status = document.getElementById('status');
  const $app    = document.getElementById('app');
  const $error  = document.getElementById('error-state');
  const $errMsg = document.getElementById('error-msg');

  try {
    const settled = await Promise.allSettled(MODELS.map(fetchFirstWorking));

    const results = MODELS.map((model, i) => ({
      model,
      data:  settled[i].status === 'fulfilled' ? settled[i].value.data  : null,
      key:   settled[i].status === 'fulfilled' ? settled[i].value.key   : null,
      error: settled[i].status === 'rejected'  ? settled[i].reason      : null,
    }));

    if (results.every(r => !r.data)) {
      throw new Error(results.map(r => r.error?.message).filter(Boolean).join(' | '));
    }

    // Glance section
    renderGlance(results);

    // Individual plume charts for models with detail:true
    for (const { model, data, key, error } of results) {
      if (!model.detail) continue;
      const unavail = document.getElementById(`unavail-${model.id}`);
      const wrap    = document.getElementById(`wrap-${model.id}`);
      if (!data) {
        if (unavail) { unavail.textContent = `Could not load ${model.name} (${model.keys.join('/')}) — ${error?.message ?? 'unknown'}`; unavail.classList.remove('hidden'); }
        wrap?.classList.add('hidden');
        continue;
      }
      // Show which key succeeded
      document.getElementById(`${model.id}-key-badge`)?.replaceChildren(
        Object.assign(document.createElement('code'), { textContent: key })
      );
      plumeChart(`chart-${model.id}`, data.times, data.stats, model.r, model.g, model.b);
    }

    // Comparison chart (all models)
    comparisonChart(results);

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
