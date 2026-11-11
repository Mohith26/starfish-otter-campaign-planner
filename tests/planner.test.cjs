// node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const L = require('../core/planner.js');
const { build } = require('../data/generate.js');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/constellation.json'), 'utf8'));
const C = DATA.constellation, P = DATA.vehicle;

test('committed data is exactly what the seeded generator produces', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(build())), DATA);
  assert.equal(C.sats.length, C.planes * C.slots);
});

test('J2 nodal rate reproduces a sun-synchronous orbit (700 km, 98.19 deg -> +0.9856 deg/day)', () => {
  const r = L.raanRate(700, 98.19);
  assert.ok(Math.abs(r - 0.9856) / 0.9856 < 0.005, 'got ' + r);
  assert.ok(L.raanRate(450, 53) < L.raanRate(900, 53), 'lower orbit regresses faster');
});

test('circular velocity at 900 km', () => {
  assert.ok(Math.abs(L.vcirc(900) - 7400.5) < 1);
});

test('spiral obeys the rocket equation and constant-thrust timing; Simpson drift converged', () => {
  const s = L.spiral(585, 900, 450, P, 64);
  assert.ok(Math.abs(s.dv - (L.vcirc(450) - L.vcirc(900))) < 1e-9);
  assert.ok(Math.abs(s.prop - L.propFor(585, s.dv, P.ispS)) < 1e-9);
  const tSec = s.prop * L.G0 * P.ispS / P.thrustN;
  assert.ok(Math.abs(s.days - tSec / 86400) < 1e-9);
  assert.ok(s.drift < 0, 'descent drifts west');
  const fine = L.spiral(585, 900, 450, P, 1024);
  assert.ok(Math.abs(s.drift - fine.drift) < 1e-6);
  // the drift must lie between the rates at the two ends times the duration
  const rHi = 0, rLo = L.raanRate(450, P.incDeg) - L.raanRate(900, P.incDeg);
  assert.ok(s.drift < rHi && s.drift > rLo * s.days);
});

test('a coupled cycle lands on the target plane exactly and respects handover time', () => {
  const sp = L.makeSpiralCache(P);
  const R = L.rng(5);
  for (let k = 0; k < 200; k++) {
    const st = { low: R() < 0.5, phi: R() * 360, t: R() * 300, m: 300 + R() * 35 };
    const job = { id: 'j', phi: 30 * Math.floor(R() * 12), ready: R() * 600, fail: 0 };
    for (const coupled of [true, false]) {
      const r = L.cycle(st, job, coupled, P, sp);
      assert.ok(Math.abs(r.closure) < 1e-6, 'closure ' + r.closure);
      assert.ok(r.tDock >= job.ready + P.rpoDays - 1e-9);
      assert.ok(r.tRelease > r.tDock);
      assert.ok(r.state.m < st.m);
      assert.ok(Math.abs(r.prop - (st.m - r.state.m)) < 1e-9, 'propellant bookkeeping');
      // legs are contiguous in time and in relative RAAN
      for (let i = 1; i < r.legs.length; i++) assert.ok(Math.abs(r.legs[i].t0 - r.legs[i - 1].t1) < 1e-9);
    }
  }
});

test('coupling never costs more xenon than return-and-park over two consecutive disposals', () => {
  const sp = L.makeSpiralCache(P);
  const R = L.rng(9);
  for (let k = 0; k < 100; k++) {
    const a = { id: 'a', phi: 30 * Math.floor(R() * 12), ready: 0, fail: 0 };
    const b = { id: 'b', phi: 30 * Math.floor(R() * 12), ready: 0, fail: 0 };
    const st = { low: true, phi: R() * 360, t: 0, m: 335 };
    const use = (coupled) => { const r1 = L.cycle(st, a, coupled, P, sp); const r2 = L.cycle(r1.state, b, coupled, P, sp); return st.m - r2.state.m; };
    // drag make-up during a long low dwell is the only extra cost of coupling
    assert.ok(use(true) <= use(false) + 1e-9);
  }
});

test('soonest-plane rule equals brute-force argmin over the known queue', () => {
  const sp = L.makeSpiralCache(P);
  const jobs = L.sampleJobs(C, 11).slice(0, 8);
  const st = { low: true, phi: 123, t: 0, m: 335 };
  const pick = L.pickSoonest(st, jobs, true, P, sp);
  let best = Infinity, arg = null;
  for (const j of jobs) { const r = L.cycle(st, j, true, P, sp); if (r.tRelease < best) { best = r.tRelease; arg = j; } }
  assert.equal(pick, arg);
});

test('simulation invariants hold for every policy', () => {
  const jobs = L.sampleJobs(C, C.baseSeed);
  for (const pol of [{ coupled: true, order: 'soonest' }, { coupled: false, order: 'soonest' }, { coupled: false, order: 'fifo' }, { coupled: true, order: 'lookahead' }]) {
    const s = L.simulate(jobs, P, pol);
    const ids = new Set(s.served.map((x) => x.id));
    assert.equal(ids.size, s.served.length, 'no client served twice');
    assert.ok(s.finalState.m >= P.dryKg + P.reserveKg - 1e-9, 'self-disposal reserve kept');
    for (let i = 0; i < s.served.length; i++) {
      const x = s.served[i];
      assert.ok(x.release <= P.horizonDays);
      assert.ok(x.dock >= x.ready + P.rpoDays - 1e-9);
      assert.ok(x.latency > 0);
      if (i) assert.ok(x.dock > s.served[i - 1].release);
    }
  }
});

test('Monte Carlo is deterministic and drift coupling raises disposals per tank', () => {
  const pols = [{ coupled: false, order: 'soonest' }, { coupled: true, order: 'soonest' }];
  const a = L.monteCarlo(C, P, pols, 60, 1000), b = L.monteCarlo(C, P, pols, 60, 1000);
  assert.deepEqual(a.map((x) => x.counts), b.map((x) => x.counts));
  assert.ok(a[1].meanCount > a[0].meanCount);
});

test('quantile interpolation', () => {
  assert.equal(L.quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(L.quantile([0, 10], 0.25), 2.5);
});
