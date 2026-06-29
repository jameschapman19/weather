import {
  CONFIG, WEDDING_DAYS, IFS_MODEL_KEYS, AIFS_MODEL_KEYS,
  pct, processRaw, daytimeSummary, dayName, tempDesc, modelAgreement,
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

// Try each key in sequence, return first success with the winning key attached.
async function fetchFirstWorking(keys) {
  let lastErr;
  for (const key of keys) {
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

// ─── Formatting helpers ───────────────────────────────────────────────────────

const fmtT   = v => v == null ? '–' : `${Math.round(v)}°`;
const hourOf = t => parseInt(t.slice(11, 13), 10);

function tooltipDateFn(times) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return items => {
    const t = times[items[0].dataIndex];
    if (!t) return '';
    const d  = parseInt(t.slice(8,  10), 10);
    const mo = parseInt(t.slice(5,  7),  10);
    const dn = dayName(t.slice(0, 10)).slice(0, 3);
    return `${dn}, ${d} ${MONTHS[mo - 1]}  ·  ${t.slice(11, 16)}`;
  };
}

// ─── Glance section (non-technical) ──────────────────────────────────────────

function renderGlance(ifsEntry, aifsEntry) {
  const container = document.getElementById('glance-cards');
  container.innerHTML = '';

  WEDDING_DAYS.forEach(day => {
    const ifsSumm  = ifsEntry?.data  ? daytimeSummary(ifsEntry.data,  day.date) : null;
    const aifsSumm = aifsEntry?.data ? daytimeSummary(aifsEntry.data, day.date) : null;

    // Pick best available median
    const allMed = ifsSumm?.all?.med ?? aifsSumm?.all?.all?.med ?? null;
    const desc   = tempDesc(ifsSumm?.all?.med ?? aifsSumm?.all?.med ?? null);

    // Ensemble range across both models (or whichever is available)
    const lo = Math.min(...[ifsSumm?.all?.lo, aifsSumm?.all?.lo].filter(Number.isFinite));
    const hi = Math.max(...[ifsSumm?.all?.hi, aifsSumm?.all?.hi].filter(Number.isFinite));

    const morning   = ifsSumm?.morning?.med   ?? aifsSumm?.morning?.med;
    const afternoon = ifsSumm?.afternoon?.med ?? aifsSumm?.afternoon?.med;
    const evening   = ifsSumm?.evening?.med   ?? aifsSumm?.evening?.med;

    const agree = modelAgreement(ifsSumm, aifsSumm);

    // Temperature bar: map lo–hi onto a 20–42°C scale
    const scale = (v) => Math.max(0, Math.min(100, ((v - 18) / 24) * 100));
    const pLo   = scale(isFinite(lo) ? lo : 20);
    const pHi   = scale(isFinite(hi) ? hi : 35);
    const pMed  = scale(ifsSumm?.all?.med ?? aifsSumm?.all?.med ?? 28);

    const card = document.createElement('div');
    card.className = 'glance-card';
    card.innerHTML = `
      <div class="glance-heat-label" style="background:${desc.colour}20;color:${desc.colour};border-color:${desc.colour}40">
        ${desc.label}
      </div>
      <div class="glance-dayname">${dayName(day.date)}</div>
      <div class="glance-date">${day.display}</div>

      <div class="glance-median">${fmtT(ifsSumm?.all?.med ?? aifsSumm?.all?.med)}C</div>
      <div class="glance-median-label">median daytime temperature</div>

      <div class="temp-bar-wrap">
        <div class="temp-bar-track">
          <div class="temp-bar-fill"
               style="left:${pLo}%;width:${pHi - pLo}%;background:linear-gradient(90deg,${desc.colour}60,${desc.colour})">
          </div>
          <div class="temp-bar-median" style="left:${pMed}%"></div>
        </div>
        <div class="temp-bar-labels">
          <span>${fmtT(isFinite(lo) ? lo : null)}</span>
          <span>ensemble range</span>
          <span>${fmtT(isFinite(hi) ? hi : null)}</span>
        </div>
      </div>

      <div class="glance-tod">
        <div class="tod-item">
          <div class="tod-label">Morning</div>
          <div class="tod-temp">${fmtT(morning)}C</div>
        </div>
        <div class="tod-sep">→</div>
        <div class="tod-item">
          <div class="tod-label">Afternoon</div>
          <div class="tod-temp tod-peak">${fmtT(afternoon)}C</div>
        </div>
        <div class="tod-sep">→</div>
        <div class="tod-item">
          <div class="tod-label">Evening</div>
          <div class="tod-temp">${fmtT(evening)}C</div>
        </div>
      </div>

      ${agree ? `<div class="glance-agree">${agree.label} · ${agree.detail}</div>` : ''}
      ${desc.advice ? `<div class="glance-advice">${desc.advice}</div>` : ''}
    `;
    container.appendChild(card);
  });
}

// ─── Technical day cards ──────────────────────────────────────────────────────

function renderModelRows(ifsEntry, aifsEntry) {
  const container = document.getElementById('model-rows');
  container.innerHTML = '';

  const entries = [
    { entry: ifsEntry,  id: 'ifs',  label: 'IFS' },
    { entry: aifsEntry, id: 'aifs', label: 'AIFS' },
  ];

  WEDDING_DAYS.forEach(day => {
    const row = document.createElement('div');
    row.className = 'model-day-row';

    const dateHead = document.createElement('div');
    dateHead.className = 'model-day-head';
    dateHead.textContent = `${dayName(day.date).slice(0,3)} ${day.display}`;
    row.appendChild(dateHead);

    for (const { entry, id, label } of entries) {
      const cell = document.createElement('div');
      cell.className = `model-day-cell cell-${id}`;
      if (!entry?.data) {
        cell.innerHTML = `<span class="cell-unavail">unavailable</span>`;
      } else {
        const s = daytimeSummary(entry.data, day.date).all;
        cell.innerHTML = s
          ? `<span class="cell-model ${id}">${label}</span>
             <span class="cell-lo">${fmtT(s.lo)}</span>
             <span class="cell-sep">–</span>
             <span class="cell-med">${fmtT(s.med)}</span>
             <span class="cell-sep">–</span>
             <span class="cell-hi">${fmtT(s.hi)}</span>
             <span class="cell-unit">C</span>`
          : `<span class="cell-unavail">–</span>`;
      }
      row.appendChild(cell);
    }
    container.appendChild(row);
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

// ─── Comparison chart ─────────────────────────────────────────────────────────

function comparisonChart(ifsData, aifsData) {
  const ctx = document.getElementById('chart-comparison');
  if (!ctx) return null;

  const times = (ifsData || aifsData).times;
  const ds = [];
  const legendEntries = [];

  if (ifsData) {
    ds.push(
      { label:'_ip25', data:ifsData.stats.map(s=>s.p25), borderWidth:0, borderColor:'transparent', backgroundColor:'transparent', pointRadius:0, tension:0.35, fill:false },
      { label:'IFS 25–75th %ile', data:ifsData.stats.map(s=>s.p75), borderWidth:0, borderColor:'transparent', backgroundColor:'rgba(37,99,235,0.18)', pointRadius:0, tension:0.35, fill:0 },
      { label:'IFS Median', data:ifsData.stats.map(s=>s.p50), borderColor:'rgba(37,99,235,1)', backgroundColor:'transparent', borderWidth:2.5, pointRadius:0, tension:0.35, fill:false },
    );
    legendEntries.push(
      { text:'IFS 25–75th percentile', fillStyle:'rgba(37,99,235,0.28)', strokeStyle:'transparent', pointStyle:'rect', lineWidth:0 },
      { text:'IFS Median', fillStyle:'transparent', strokeStyle:'rgba(37,99,235,1)', pointStyle:'line', lineWidth:2.5 },
    );
  }
  if (aifsData) {
    const base = ds.length;
    ds.push(
      { label:'_ap25', data:aifsData.stats.map(s=>s.p25), borderWidth:0, borderColor:'transparent', backgroundColor:'transparent', pointRadius:0, tension:0.35, fill:false },
      { label:'AIFS 25–75th %ile', data:aifsData.stats.map(s=>s.p75), borderWidth:0, borderColor:'transparent', backgroundColor:'rgba(22,163,74,0.18)', pointRadius:0, tension:0.35, fill:base },
      { label:'AIFS Median', data:aifsData.stats.map(s=>s.p50), borderColor:'rgba(22,163,74,1)', backgroundColor:'transparent', borderWidth:2.5, pointRadius:0, tension:0.35, fill:false },
    );
    legendEntries.push(
      { text:'AIFS 25–75th percentile', fillStyle:'rgba(22,163,74,0.28)', strokeStyle:'transparent', pointStyle:'rect', lineWidth:0 },
      { text:'AIFS Median', fillStyle:'transparent', strokeStyle:'rgba(22,163,74,1)', pointStyle:'line', lineWidth:2.5 },
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
              const lines = [];
              if (ifsData)  { const s=ifsData.stats[i];  lines.push(`IFS:   ${fmtT(s.p50)}C  (${fmtT(s.p25)}–${fmtT(s.p75)})`); }
              if (aifsData) { const s=aifsData.stats[i]; lines.push(`AIFS:  ${fmtT(s.p50)}C  (${fmtT(s.p25)}–${fmtT(s.p75)})`); }
              return lines;
            },
          },
        },
      },
      scales: sharedScales(times),
    },
  });
}

// ─── Model section UI helpers ─────────────────────────────────────────────────

function showModelError(id, key, err) {
  const el = document.getElementById(`unavail-${id}`);
  if (el) {
    el.textContent = `Could not load ${id.toUpperCase()} data (tried: ${key}) — ${err?.message ?? 'unknown error'}`;
    el.classList.remove('hidden');
  }
  document.getElementById(`wrap-${id}`)?.classList.add('hidden');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const $status = document.getElementById('status');
  const $app    = document.getElementById('app');
  const $error  = document.getElementById('error-state');
  const $errMsg = document.getElementById('error-msg');

  try {
    const [ifsResult, aifsResult] = await Promise.allSettled([
      fetchFirstWorking(IFS_MODEL_KEYS),
      fetchFirstWorking(AIFS_MODEL_KEYS),
    ]);

    const ifsEntry  = ifsResult.status  === 'fulfilled' ? ifsResult.value  : null;
    const aifsEntry = aifsResult.status === 'fulfilled' ? aifsResult.value : null;

    if (!ifsEntry && !aifsEntry) {
      throw new Error(
        [ifsResult, aifsResult]
          .map(r => r.status === 'rejected' ? r.reason?.message : null)
          .filter(Boolean).join(' | ')
      );
    }

    if (!ifsEntry)  showModelError('ifs',  IFS_MODEL_KEYS.join('/'),  ifsResult.reason);
    if (!aifsEntry) showModelError('aifs', AIFS_MODEL_KEYS.join('/'), aifsResult.reason);

    // Glance section
    renderGlance(ifsEntry, aifsEntry);
    renderModelRows(ifsEntry, aifsEntry);

    // Plume charts
    if (ifsEntry)  plumeChart('chart-ifs',  ifsEntry.data.times,  ifsEntry.data.stats,  37, 99,  235);
    if (aifsEntry) plumeChart('chart-aifs', aifsEntry.data.times, aifsEntry.data.stats, 22, 163, 74);

    // Comparison
    comparisonChart(ifsEntry?.data, aifsEntry?.data);

    // Model key badges
    if (ifsEntry)  document.getElementById('ifs-key-badge')?.replaceChildren(
      Object.assign(document.createElement('code'), { textContent: ifsEntry.key })
    );
    if (aifsEntry) document.getElementById('aifs-key-badge')?.replaceChildren(
      Object.assign(document.createElement('code'), { textContent: aifsEntry.key })
    );

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
