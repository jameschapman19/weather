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

test('ecmwf_ifs04 — is deterministic-only (no member columns)', async () => {
  // Confirmed by CI: ecmwf_ifs04 returns only `time` + `temperature_2m`.
  // It is NOT an ensemble key. The app uses ecmwf_ifs025 instead.
  const raw = await callApi('ecmwf_ifs04');
  inspectResponse(raw, 'ecmwf_ifs04');
  const memberKeys = Object.keys(raw.hourly).filter(k => /^temperature_2m_member\d+$/.test(k));
  assert.equal(memberKeys.length, 0, `ecmwf_ifs04 unexpectedly returned ${memberKeys.length} member columns — the app key list may need updating`);
});

test('ecmwf_ifs025 — returns 50 ensemble members and can be processed', async () => {
  const raw = await callApi('ecmwf_ifs025');
  const { memberKeys } = inspectResponse(raw, 'ecmwf_ifs025');
  assert.ok(memberKeys.length >= 1,
    `Expected ≥1 member column. All keys: ${Object.keys(raw.hourly).join(', ')}`);
  assert.equal(memberKeys.length, 50, `Expected 50 members, got ${memberKeys.length}`);
  const result = processRaw(raw);
  assert.ok(result.count >= 1);
  // IFS025 is 3-hourly so ~2/3 of timesteps have null stats — check ≥33% are non-null
  const nonNull = result.stats.filter(s => s.p50 !== null).length;
  assert.ok(nonNull / result.stats.length >= 0.33,
    `Only ${nonNull}/${result.stats.length} timesteps have non-null p50 (expected ≥33%)`);
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

// ── Additional provider probes ────────────────────────────────────────────────
// These tests are informational — they document what's available so we can
// decide which models to add to the app. A "pass" means ensemble members
// were returned; a "fail" usually means the key is deterministic-only.

// Member counts confirmed by CI on 2026-06-29.
// UKMO: ukmo_seamless is deterministic-only; ukmo_global/mogreps_g return HTTP 400 — not available.
const PROBE_MODELS = [
  { key: 'icon_eu',                     provider: 'DWD (Germany)',      expectedMembers: 39 },
  { key: 'icon_seamless',               provider: 'DWD seamless',       expectedMembers: 39 },
  { key: 'gfs025',                      provider: 'NOAA GFS 0.25°',     expectedMembers: 30 },
  { key: 'gfs_seamless',               provider: 'NOAA GFS seamless',   expectedMembers: 30 },
  { key: 'gem_global',                  provider: 'CMC (Canada)',        expectedMembers: 20 },
  { key: 'meteofrance_seamless',        provider: 'Météo-France',        expectedMembers: null },
  { key: 'meteofrance_arpege_world',   provider: 'MF ARPEGE World',     expectedMembers: null },
  { key: 'bom_access_global_ensemble', provider: 'BOM (Australia)',      expectedMembers: 17 },
  { key: 'ukmo_seamless',              provider: 'UKMO (det. only)',     expectedMembers: null },
];

test('additional provider probe — logs member counts for candidate models', async () => {
  console.log('\n  Model availability probe:');
  for (const { key, provider, expectedMembers } of PROBE_MODELS) {
    let raw;
    try { raw = await callApi(key); }
    catch (e) { console.log(`  ✗ ${key.padEnd(30)} [${provider}]  HTTP error: ${e.message.slice(0,80)}`); continue; }

    const { memberKeys } = inspectResponse(raw, key);
    const status = memberKeys.length > 0 ? '✓ ensemble' : '✗ deterministic-only';
    const memberNote = memberKeys.length > 0
      ? `${memberKeys.length} members  (expected ${expectedMembers ?? '?'})`
      : `keys: ${Object.keys(raw.hourly).filter(k => k !== 'time').join(', ')}`;
    console.log(`  ${status}  ${key.padEnd(30)} [${provider}]  ${memberNote}`);
  }
  // Always pass — this is a discovery test, not a correctness check.
  assert.ok(true, 'probe completed');
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

test('wind speed variable naming — logs available wind keys for debugging', async () => {
  const u = new URL(BASE);
  u.searchParams.set('latitude',   CONFIG.lat);
  u.searchParams.set('longitude',  CONFIG.lon);
  u.searchParams.set('hourly',     'temperature_2m,windspeed_10m,wind_speed_10m');
  u.searchParams.set('models',     'ecmwf_aifs025');
  u.searchParams.set('start_date', CONFIG.start);
  u.searchParams.set('end_date',   CONFIG.start); // one day is enough
  u.searchParams.set('timezone',   CONFIG.tz);
  console.log(`  → GET ${u.toString()}`);
  const res = await fetch(u.toString());
  const text = await res.text();
  if (!res.ok) { console.log(`  HTTP ${res.status}: ${text.slice(0, 200)}`); assert.ok(true); return; }
  const raw = JSON.parse(text);
  const allKeys = Object.keys(raw.hourly);
  const windKeys = allKeys.filter(k => k.toLowerCase().includes('wind'));
  console.log(`  All wind keys (${windKeys.length}): ${windKeys.slice(0, 10).join(', ')}`);
  console.log(`  wind_?speed_10m_member keys: ${windKeys.filter(k => /^wind_?speed_10m_member/.test(k)).length}`);
  assert.ok(true, 'diagnostic only — check logs for wind key names');
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
