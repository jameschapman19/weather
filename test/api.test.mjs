/**
 * Integration tests against the live Open-Meteo ensemble API.
 *
 * Primary diagnostic purpose: confirm which model keys are valid and
 * what the response structure looks like (member key naming, date coverage).
 * Output is intentionally verbose so CI logs serve as a debugging tool.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processRaw, CONFIG } from '../lib.js';

const BASE = 'https://ensemble-api.open-meteo.com/v1/ensemble';

async function callApi(modelKey, startDate, endDate) {
  const u = new URL(BASE);
  u.searchParams.set('latitude',   CONFIG.lat);
  u.searchParams.set('longitude',  CONFIG.lon);
  u.searchParams.set('hourly',     'temperature_2m');
  u.searchParams.set('models',     modelKey);
  u.searchParams.set('start_date', startDate ?? CONFIG.start);
  u.searchParams.set('end_date',   endDate   ?? CONFIG.end);
  u.searchParams.set('timezone',   CONFIG.tz);
  console.log(`  → GET ${u.toString()}`);
  const res = await fetch(u.toString());
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

function inspectResponse(raw, modelKey) {
  const { hourly } = raw;
  const allKeys    = Object.keys(hourly);
  const memberKeys = allKeys.filter(k => /^temperature_2m_member\d+$/.test(k)).sort();
  const times      = hourly.time ?? [];
  console.log(`  model:        ${modelKey}`);
  console.log(`  member keys:  ${memberKeys.length}  (${memberKeys[0] ?? '–'} … ${memberKeys.at(-1) ?? '–'})`);
  console.log(`  time points:  ${times.length}`);
  console.log(`  date range:   ${times[0] ?? '–'} → ${times.at(-1) ?? '–'}`);
  if (!memberKeys.length) {
    console.log(`  ALL hourly keys: ${allKeys.join(', ')}`);
  }
  return { memberKeys, times };
}

// ── IFS model candidates ──────────────────────────────────────────────────────

test('ecmwf_ifs04 — returns member columns and can be processed', async () => {
  const raw = await callApi('ecmwf_ifs04');
  const { memberKeys } = inspectResponse(raw, 'ecmwf_ifs04');
  assert.ok(memberKeys.length >= 1,
    `Expected ≥1 member column, got 0. All keys: ${Object.keys(raw.hourly).join(', ')}`);
  assert.ok(memberKeys.length >= 50, `Expected ≥50 members, got ${memberKeys.length}`);
  const result = processRaw(raw);
  assert.ok(result.stats.every(s => s.p50 !== null), 'Some p50 values are null');
});

test('ecmwf_ifs025 — returns member columns and can be processed', async () => {
  const raw = await callApi('ecmwf_ifs025');
  const { memberKeys } = inspectResponse(raw, 'ecmwf_ifs025');
  assert.ok(memberKeys.length >= 1,
    `Expected ≥1 member column. All keys: ${Object.keys(raw.hourly).join(', ')}`);
  const result = processRaw(raw);
  assert.ok(result.count >= 1);
});

// ── AIFS model ────────────────────────────────────────────────────────────────

test('ecmwf_aifs025 — returns member columns and can be processed', async () => {
  const raw = await callApi('ecmwf_aifs025');
  const { memberKeys } = inspectResponse(raw, 'ecmwf_aifs025');
  assert.ok(memberKeys.length >= 1,
    `Expected ≥1 member column. All keys: ${Object.keys(raw.hourly).join(', ')}`);
  const result = processRaw(raw);
  assert.ok(result.stats.length > 0);
});

// ── Date coverage ─────────────────────────────────────────────────────────────

test('wedding dates coverage — which days are available per model', async () => {
  const models = ['ecmwf_ifs04', 'ecmwf_ifs025', 'ecmwf_aifs025'];
  const dates  = ['2026-07-13', '2026-07-14', '2026-07-15'];

  for (const model of models) {
    let raw;
    try {
      raw = await callApi(model);
    } catch (e) {
      console.log(`  ${model}: FAILED (${e.message})`);
      continue;
    }
    const times = raw.hourly.time ?? [];
    const coverage = dates.map(d => {
      const count = times.filter(t => t.startsWith(d)).length;
      return `${d.slice(5)}: ${count}h`;
    });
    console.log(`  ${model}: ${coverage.join('  |  ')}`);
  }
  // Non-fatal — just informational. The test passes as long as we got here.
  assert.ok(true);
});

// ── Response structure sanity ─────────────────────────────────────────────────

test('response has expected top-level keys', async () => {
  let raw;
  try { raw = await callApi('ecmwf_aifs025'); }
  catch { raw = await callApi('ecmwf_ifs04'); } // whichever works

  assert.ok('latitude'  in raw, 'missing latitude');
  assert.ok('longitude' in raw, 'missing longitude');
  assert.ok('hourly'    in raw, 'missing hourly');
  assert.ok('hourly_units' in raw, 'missing hourly_units');
  assert.ok(Array.isArray(raw.hourly.time), 'hourly.time is not an array');
});

test('temperature values are plausible for summer France (5–50°C)', async () => {
  let raw;
  try { raw = await callApi('ecmwf_aifs025'); }
  catch { raw = await callApi('ecmwf_ifs04'); }

  const result   = processRaw(raw);
  const medians  = result.stats.map(s => s.p50).filter(v => v !== null);
  const outOfRange = medians.filter(v => v < 5 || v > 50);
  console.log(`  Median range: ${Math.min(...medians).toFixed(1)}°C – ${Math.max(...medians).toFixed(1)}°C`);
  assert.equal(outOfRange.length, 0,
    `${outOfRange.length} medians outside 5–50°C: ${outOfRange.slice(0,5)}`);
});
