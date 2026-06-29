import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pct, statsAt, processRaw, daytimeSummary, dayName, tempDesc, multiModelAgreement } from '../lib.js';

// ─── pct() ────────────────────────────────────────────────────────────────────

test('pct: min and max of sorted array', () => {
  assert.equal(pct([1,2,3,4,5], 0),   1);
  assert.equal(pct([1,2,3,4,5], 100), 5);
});

test('pct: median of odd-length array', () => {
  assert.equal(pct([1,2,3,4,5], 50), 3);
});

test('pct: interpolates at 25th percentile of [0,100]', () => {
  assert.equal(pct([0,100], 25), 25);
});

test('pct: filters out null, undefined, NaN', () => {
  assert.equal(pct([1, null, NaN, 3, undefined], 50), 2);
});

test('pct: returns null for empty input', () => {
  assert.equal(pct([], 50), null);
  assert.equal(pct([null, NaN, undefined], 50), null);
});

test('pct: order invariant — unsorted input gives same result', () => {
  assert.equal(pct([5,3,1,2,4], 50), pct([1,2,3,4,5], 50));
});

// ─── statsAt() ────────────────────────────────────────────────────────────────

test('statsAt: percentile ordering p10 < p25 < p50 < p75 < p90', () => {
  const members = Array.from({length: 100}, (_, i) => [i + 1]);
  const s = statsAt(members, 0);
  assert.ok(s.p10 < s.p25,  `p10 ${s.p10} should be < p25 ${s.p25}`);
  assert.ok(s.p25 < s.p50,  `p25 ${s.p25} should be < p50 ${s.p50}`);
  assert.ok(s.p50 < s.p75,  `p50 ${s.p50} should be < p75 ${s.p75}`);
  assert.ok(s.p75 < s.p90,  `p75 ${s.p75} should be < p90 ${s.p90}`);
});

test('statsAt: all nulls returns null stats', () => {
  const members = [[null], [null], [null]];
  const s = statsAt(members, 0);
  assert.equal(s.p50, null);
  assert.equal(s.p10, null);
});

test('statsAt: single member returns same value for all percentiles', () => {
  const members = [[25.0]];
  const s = statsAt(members, 0);
  assert.equal(s.p10, 25);
  assert.equal(s.p90, 25);
});

// ─── processRaw() ─────────────────────────────────────────────────────────────

const makeRaw = (memberData) => ({
  hourly: {
    time: memberData[0].map((_, i) => `2026-07-13T${String(i).padStart(2,'0')}:00`),
    ...Object.fromEntries(memberData.map((d, i) => [`temperature_2m_member${String(i+1).padStart(2,'0')}`, d])),
  }
});

test('processRaw: extracts correct member count', () => {
  const raw = makeRaw([[20,21,22], [21,22,23], [19,20,21]]);
  const result = processRaw(raw);
  assert.equal(result.count, 3);
});

test('processRaw: correct number of time points', () => {
  const raw = makeRaw([[20,21,22,23,24]]);
  const result = processRaw(raw);
  assert.equal(result.times.length, 5);
  assert.equal(result.stats.length, 5);
});

test('processRaw: computes non-null stats', () => {
  const raw = makeRaw([[20,21], [22,23], [24,25]]);
  const result = processRaw(raw);
  assert.notEqual(result.stats[0].p50, null);
  assert.notEqual(result.stats[1].p50, null);
});

test('processRaw: throws with useful message when no member columns present', () => {
  const raw = { hourly: { time: ['2026-07-13T00:00'], temperature_2m: [20] } };
  assert.throws(() => processRaw(raw), /No member columns found/);
});

test('processRaw: works with member00 naming (0-indexed)', () => {
  const raw = { hourly: { time: ['2026-07-13T00:00'], temperature_2m_member00: [20], temperature_2m_member01: [22] } };
  const result = processRaw(raw);
  assert.equal(result.count, 2);
});

// ─── daytimeSummary() ─────────────────────────────────────────────────────────

test('daytimeSummary: all windows return non-null for full-day data', () => {
  const hours = Array.from({length: 24}, (_, h) => h);
  const raw = makeRaw([hours.map(h => 20 + h * 0.5)]);
  const data = processRaw(raw);
  // Adjust times to use the correct date
  data.times = hours.map(h => `2026-07-13T${String(h).padStart(2,'0')}:00`);
  const s = daytimeSummary(data, '2026-07-13');
  assert.notEqual(s.morning,   null, 'morning should be present');
  assert.notEqual(s.afternoon, null, 'afternoon should be present');
  assert.notEqual(s.evening,   null, 'evening should be present');
  assert.notEqual(s.all,       null, 'all should be present');
});

test('daytimeSummary: returns null for a date with no data', () => {
  const raw = makeRaw([[20, 21]]);
  const data = processRaw(raw);
  data.times = ['2026-07-13T00:00', '2026-07-13T01:00'];
  const s = daytimeSummary(data, '2026-07-14');
  // No data for Jul 14
  assert.equal(s.morning, null);
  assert.equal(s.all,     null);
});

// ─── dayName() ────────────────────────────────────────────────────────────────

test('dayName: correct day for wedding dates', () => {
  assert.equal(dayName('2026-07-13'), 'Monday');
  assert.equal(dayName('2026-07-14'), 'Tuesday');
  assert.equal(dayName('2026-07-15'), 'Wednesday');
});

test('dayName: known reference date (2026-01-01 is Thursday)', () => {
  assert.equal(dayName('2026-01-01'), 'Thursday');
});

// ─── tempDesc() ───────────────────────────────────────────────────────────────

test('tempDesc: null input returns Unknown', () => {
  assert.equal(tempDesc(null).label, 'Unknown');
});

test('tempDesc: 17°C is Cool', () => {
  assert.equal(tempDesc(17).label, 'Cool');
});

test('tempDesc: 32°C is Very Hot', () => {
  assert.equal(tempDesc(32).label, 'Very Hot');
});

test('tempDesc: 36°C is Extremely Hot', () => {
  assert.equal(tempDesc(36).label, 'Extremely Hot');
});

test('tempDesc: 26°C is Warm', () => {
  assert.equal(tempDesc(26).label, 'Warm');
});

test('tempDesc: all labels have non-empty advice', () => {
  for (const t of [10, 18, 22, 26, 30, 33, 37]) {
    const d = tempDesc(t);
    assert.ok(d.label.length > 0,  `label missing for ${t}°C`);
    assert.ok(d.colour.length > 0, `colour missing for ${t}°C`);
  }
});

// ─── multiModelAgreement() ────────────────────────────────────────────────────

test('multiModelAgreement: excellent when medians identical', () => {
  const summ = { all: { med: 28 } };
  const result = multiModelAgreement([summ, summ]);
  assert.ok(result.label.toLowerCase().includes('excellent'));
});

test('multiModelAgreement: diverge when medians differ by 5°C', () => {
  const a = { all: { med: 28 } };
  const b = { all: { med: 33 } };
  assert.ok(multiModelAgreement([a, b]).label.toLowerCase().includes('diverge'));
});

test('multiModelAgreement: returns null when fewer than 2 valid summaries', () => {
  assert.equal(multiModelAgreement([null, { all: { med: 28 } }]), null);
  assert.equal(multiModelAgreement([{ all: { med: 28 } }]), null);
});
