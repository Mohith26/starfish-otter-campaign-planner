/*
 * Otter Deorbit-as-a-Service campaign planner (core).
 *
 * Units: time in days, angles in degrees, delta-v in m/s, mass in kg, altitude in km.
 * Relative RAAN (phi) is measured against the constellation's own nodal frame, which
 * precesses at the J2 rate of the operational shell. Every constellation plane is
 * therefore a fixed phi; a vehicle flying below the shell regresses westward (phi decreases).
 *
 * Works in the browser (window.OtterPlanner) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var MU = 398600.4418;        // km^3/s^2
  var RE = 6378.137;           // km
  var J2 = 1.08262668e-3;
  var G0 = 9.80665;            // m/s^2
  var DEG = 180 / Math.PI;
  var DAY = 86400;

  // ---------- orbital mechanics ----------
  function vcirc(hKm) { return Math.sqrt(MU / (RE + hKm)) * 1000; } // m/s

  // Secular J2 nodal rate for a circular orbit, deg/day (negative for i < 90 deg).
  function raanRate(hKm, incDeg) {
    var a = RE + hKm;
    var n = Math.sqrt(MU / (a * a * a));
    var r = -1.5 * J2 * (RE / a) * (RE / a) * n * Math.cos(incDeg / DEG);
    return r * DEG * DAY;
  }

  // Wrap to [0, 360).
  function wrap360(x) { var y = x % 360; return y < 0 ? y + 360 : y; }

  // Tsiolkovsky propellant for a burn of dv on initial mass m0.
  function propFor(m0, dv, isp) { return m0 * (1 - Math.exp(-dv / (G0 * isp))); }

  // Constant-thrust circular spiral between two altitudes (Edelbaum, coplanar).
  // Returns dv, prop, duration and the relative-RAAN change accumulated during the
  // spiral w.r.t. the shell frame at hRef. Mass decreases continuously.
  function spiral(m0, hFrom, hTo, P, nSteps) {
    var isp = P.ispS, F = P.thrustN, c = G0 * isp;
    var v0 = vcirc(hFrom), v1 = vcirc(hTo);
    var dv = Math.abs(v1 - v0);
    var mdot = F / c;                                  // kg/s
    var mf = m0 * Math.exp(-dv / c);
    var T = (m0 - mf) / mdot;                          // s
    var refRate = raanRate(P.shellKm, P.incDeg);
    var N = nSteps || 64;                              // Simpson, even
    var sgn = v1 > v0 ? 1 : -1;
    var sum = 0;
    for (var k = 0; k <= N; k++) {
      var t = T * k / N;
      var m = m0 - mdot * t;
      var v = v0 + sgn * c * Math.log(m0 / m);
      var h = MU / Math.pow(v / 1000, 2) - RE;
      var f = raanRate(h, P.incDeg) - refRate;         // deg/day
      var w = (k === 0 || k === N) ? 1 : (k % 2 ? 4 : 2);
      sum += w * f;
    }
    var drift = (T / DAY) * sum / (3 * N);             // deg
    return { dv: dv, prop: m0 - mf, days: T / DAY, drift: drift };
  }

  // Memoised spiral (mass rounded to 0.25 kg) so Monte Carlo stays fast.
  function makeSpiralCache(P) {
    var cache = {};
    return function (m0, hFrom, hTo) {
      var key = hFrom + '>' + hTo + '@' + Math.round(m0 * 4);
      var r = cache[key];
      if (!r) { r = spiral(Math.round(m0 * 4) / 4, hFrom, hTo, P); cache[key] = r; }
      return r;
    };
  }

  // ---------- one service cycle ----------
  // state: { low: bool, phi, t, m }  (Otter is free, either at the release altitude or parked in the shell)
  // job:   { id, phi, ready, fail }
  // coupled: if true, Otter stays low after release and times its climb to the next plane;
  //          otherwise it climbs straight back and parks in the shell (return-and-park).
  function cycle(state, job, coupled, P, sp) {
    var low = P.releaseKm, hi = P.shellKm;
    var rhoLow = raanRate(low, P.incDeg) - raanRate(hi, P.incDeg); // deg/day, < 0
    var t = state.t, m = state.m, phi = state.phi, prop = 0, legs = [];
    var dragPerDay = P.dragMakeupMsPerYr / 365.25;

    function dwell(tau) {
      if (tau <= 0) return;
      var dv = dragPerDay * tau;
      var p = propFor(m, dv, P.ispS);
      legs.push({ kind: 'drift', t0: t, t1: t + tau, h0: low, h1: low, phi0: phi, phi1: phi + rhoLow * tau, prop: p });
      m -= p; prop += p; phi += rhoLow * tau; t += tau;
    }
    function fly(hFrom, hTo, mass, kind) {
      var s = sp(mass, hFrom, hTo);
      legs.push({ kind: kind, t0: t, t1: t + s.days, h0: hFrom, h1: hTo, phi0: phi, phi1: phi + s.drift, prop: s.prop });
      t += s.days; phi += s.drift; prop += s.prop;
      return s;
    }

    // 1) reach the client's plane in the shell
    var closure = 0;
    var samePlane = !state.low && Math.abs(wrap360(phi - job.phi + 180) - 180) < 1e-6;
    if (!samePlane) {
      if (!state.low) { // parked: dedicated drift excursion (descend alone)
        var d = fly(hi, low, m, 'descend'); m -= d.prop;
      }
      // Dwell so that the climb's own drift lands exactly on the target plane. The climb
      // drift depends on mass, which drag make-up during the dwell reduces, so iterate.
      var mClimb = m, tau = 0;
      for (var it = 0; it < 3; it++) {
        var W = wrap360(phi + spiral(mClimb, low, hi, P, 32).drift - job.phi);
        tau = W / Math.abs(rhoLow);
        mClimb = m - propFor(m, dragPerDay * tau, P.ispS);
      }
      dwell(tau);
      var cs = spiral(m, low, hi, P, 32);
      legs.push({ kind: 'climb', t0: t, t1: t + cs.days, h0: low, h1: hi, phi0: phi, phi1: phi + cs.drift, prop: cs.prop });
      t += cs.days; phi += cs.drift; prop += cs.prop; m -= cs.prop;
      closure = wrap360(phi - job.phi + 180) - 180; // residual plane error before snapping, deg
      phi = job.phi;
    }
    // 2) wait in-plane for the client to be passivated and handed over, then RPO + dock
    if (t < job.ready) { legs.push({ kind: 'hold', t0: t, t1: job.ready, h0: hi, h1: hi, phi0: phi, phi1: phi, prop: 0 }); t = job.ready; }
    var pr = propFor(m, P.rpoDv, P.ispS);
    legs.push({ kind: 'rpo', t0: t, t1: t + P.rpoDays, h0: hi, h1: hi, phi0: phi, phi1: phi, prop: pr });
    m -= pr; prop += pr; t += P.rpoDays;
    var tDock = t;
    // 3) tow the stack down to the release altitude
    var stack = m + P.clientKg;
    var tw = sp(stack, hi, low);
    legs.push({ kind: 'tow', t0: t, t1: t + tw.days, h0: hi, h1: low, phi0: phi, phi1: phi + tw.drift, prop: tw.prop });
    t += tw.days; phi += tw.drift; prop += tw.prop; m -= tw.prop;
    var tRelease = t;
    var out = { low: true, phi: phi, t: t, m: m };
    // 4) return-and-park climbs straight back
    if (!coupled) {
      var cb = sp(m, low, hi);
      legs.push({ kind: 'climb', t0: t, t1: t + cb.days, h0: low, h1: hi, phi0: phi, phi1: phi + cb.drift, prop: cb.prop });
      out = { low: false, phi: phi + cb.drift, t: t + cb.days, m: m - cb.prop };
      prop += cb.prop;
    }
    return { state: out, prop: prop, tDock: tDock, tRelease: tRelease, legs: legs, job: job, closure: closure };
  }

  // Propellant needed to finish a cycle must leave the self-disposal reserve.
  function feasible(res, P) { return res.state.m >= P.dryKg + P.reserveKg - 1e-9; }

  // ---------- order selection ----------
  // FIFO: oldest failure first.
  function pickFifo(state, known, coupled, P, sp) {
    var best = null;
    for (var i = 0; i < known.length; i++) if (!best || known[i].fail < best.fail) best = known[i];
    return best;
  }
  // Lookahead: depth-limited search over the known queue minimising the sum of release times
  // (equivalently total failure-to-deorbit latency of the jobs considered). Branching is
  // restricted to the `width` jobs that can be released soonest from each node.
  function pickLookahead(state, known, coupled, P, sp, depth, width) {
    depth = depth || 3; width = width || 5;
    var best = { cost: Infinity, first: null };
    function rec(st, remaining, d, acc, first) {
      if (d === 0 || remaining.length === 0) {
        // normalise by number of jobs scheduled so shorter tails don't win by default
        var cost = acc;
        if (cost < best.cost) best = { cost: cost, first: first };
        return;
      }
      var opts = [];
      for (var i = 0; i < remaining.length; i++) {
        var r = cycle(st, remaining[i], coupled, P, sp);
        if (feasible(r, P)) opts.push({ r: r, i: i });
      }
      if (!opts.length) { if (acc < best.cost && first) best = { cost: acc + 1e6 * d, first: first }; return; }
      opts.sort(function (a, b) { return a.r.tRelease - b.r.tRelease; });
      opts = opts.slice(0, width);
      for (var k = 0; k < opts.length; k++) {
        var o = opts[k];
        var rest = remaining.slice(0, o.i).concat(remaining.slice(o.i + 1));
        rec(o.r.state, rest, d - 1, P.lookObjective === 'sum' ? acc + o.r.tRelease : o.r.tRelease - 1e-3 * d, first || o.r.job);
      }
    }
    rec(state, known, Math.min(depth, known.length), 0, null);
    return best.first;
  }

  // Soonest-plane rule ("RAAN walk"): serve the known client whose disposal can be
  // completed first from the current state. Deeper lookahead (depth 2-4) was tested in
  // Monte Carlo and did not beat it in this online setting; see README.
  function pickSoonest(state, known, coupled, P, sp) {
    var best = null, bestT = Infinity;
    for (var i = 0; i < known.length; i++) {
      var r = cycle(state, known[i], coupled, P, sp);
      if (feasible(r, P) && r.tRelease < bestT) { bestT = r.tRelease; best = known[i]; }
    }
    return best;
  }

  // ---------- event simulation of a disposal contract ----------
  // jobs: [{id, phi, fail, ready}] (fail may be < 0: backlog at campaign start)
  // policy: { coupled: bool, order: 'fifo' | 'lookahead' }
  function simulate(jobs, P, policy, sp) {
    sp = sp || makeSpiralCache(P);
    var state = { low: true, phi: P.launchPhi, t: 0, m: P.dryKg + P.xenonKg };
    var pending = jobs.slice().sort(function (a, b) { return a.fail - b.fail; });
    var served = [], legsAll = [], stop = 'horizon';
    var known = [];
    var rhoLow = raanRate(P.releaseKm, P.incDeg) - raanRate(P.shellKm, P.incDeg);
    var guard = 0;
    while (state.t < P.horizonDays && guard++ < 500) {
      // a failure is known to the operator (and Starfish) once it happens
      while (pending.length && pending[0].fail <= state.t) known.push(pending.shift());
      if (!known.length) {
        if (!pending.length) { stop = 'no-demand'; break; }
        var tNext = Math.min(pending[0].fail, P.horizonDays);
        // idle: a low Otter keeps drifting (paying drag make-up); a parked Otter holds in-plane
        if (state.low) {
          var tau = tNext - state.t, dv = (P.dragMakeupMsPerYr / 365.25) * tau, p = propFor(state.m, dv, P.ispS);
          legsAll.push({ kind: 'drift', t0: state.t, t1: tNext, h0: P.releaseKm, h1: P.releaseKm, phi0: state.phi, phi1: state.phi + rhoLow * tau, prop: p });
          state = { low: true, phi: state.phi + rhoLow * tau, t: tNext, m: state.m - p };
        } else {
          legsAll.push({ kind: 'hold', t0: state.t, t1: tNext, h0: P.shellKm, h1: P.shellKm, phi0: state.phi, phi1: state.phi, prop: 0 });
          state = { low: false, phi: state.phi, t: tNext, m: state.m };
        }
        continue;
      }
      var job = policy.order === 'fifo' ? pickFifo(state, known, policy.coupled, P, sp)
        : policy.order === 'soonest' ? pickSoonest(state, known, policy.coupled, P, sp)
        : pickLookahead(state, known, policy.coupled, P, sp, P.lookDepth, P.lookWidth);
      if (!job) { stop = 'propellant'; break; }
      var res = cycle(state, job, policy.coupled, P, sp);
      if (!feasible(res, P)) { stop = 'propellant'; break; }
      if (res.tRelease > P.horizonDays) { stop = 'horizon'; break; }
      served.push({ id: job.id, plane: job.plane, slot: job.slot, phi: job.phi, fail: job.fail, ready: job.ready, dock: res.tDock, release: res.tRelease, latency: res.tRelease - job.fail, prop: res.prop, massAfter: res.state.m });
      legsAll = legsAll.concat(res.legs);
      state = res.state;
      known.splice(known.indexOf(job), 1);
    }
    var propUsed = P.dryKg + P.xenonKg - state.m;
    var failedInHorizon = jobs.filter(function (j) { return j.fail <= P.horizonDays; }).length;
    return { served: served, legs: legsAll, stop: stop, propUsed: propUsed, finalState: state, demand: failedInHorizon };
  }

  // ---------- statistics ----------
  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // Seeded PRNG (mulberry32) shared by the data generator and the Monte Carlo.
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Sample one failure history for a constellation. Each satellite gets a Weibull time to
  // failure measured from its launch; failures inside [-backlogDays, horizon] become jobs.
  function sampleJobs(C, seed) {
    var R = rng(seed), jobs = [];
    for (var s = 0; s < C.sats.length; s++) {
      var sat = C.sats[s];
      var u = R();
      var ttfYears = C.weibullEtaYears * Math.pow(-Math.log(1 - u), 1 / C.weibullBeta);
      var fail = sat.launchDay + ttfYears * 365.25;
      if (fail <= C.horizonDays) {
        jobs.push({ id: sat.id, plane: sat.plane, slot: sat.slot, phi: sat.phi, fail: fail, ready: Math.max(0, fail + C.handoverDays) });
      }
    }
    return jobs;
  }

  function monteCarlo(C, P, policies, nRuns, seed0) {
    var sp = makeSpiralCache(P);
    var out = policies.map(function () { return { count: [], lat: [], within: 0, total: 0, prop: [], stops: {}, propServed: 0 }; });
    for (var r = 0; r < nRuns; r++) {
      var jobs = sampleJobs(C, (seed0 || 1000) + r);
      for (var k = 0; k < policies.length; k++) {
        var sim = simulate(jobs, P, policies[k], sp);
        var o = out[k];
        o.count.push(sim.served.length);
        o.prop.push(sim.propUsed);
        o.stops[sim.stop] = (o.stops[sim.stop] || 0) + 1;
        for (var j = 0; j < sim.served.length; j++) {
          o.propServed += sim.served[j].prop;
          o.lat.push(sim.served[j].latency);
          if (sim.served[j].latency <= P.slaDays) o.within++;
        }
        o.total += sim.demand;
      }
    }
    return out.map(function (o, k) {
      var c = o.count.slice().sort(function (a, b) { return a - b; });
      var l = o.lat.slice().sort(function (a, b) { return a - b; });
      return {
        policy: policies[k],
        counts: o.count,
        meanCount: o.count.reduce(function (a, b) { return a + b; }, 0) / nRuns,
        p10: quantile(c, 0.1), p50: quantile(c, 0.5), p90: quantile(c, 0.9),
        latP50: quantile(l, 0.5), latP90: quantile(l, 0.9),
        slaShare: o.total ? o.within / o.total : 0,
        demandMean: o.total / nRuns,
        xenonPerDisposal: o.lat.length ? o.propServed / o.lat.length : NaN,
        stops: o.stops
      };
    });
  }

  var api = {
    MU: MU, RE: RE, J2: J2, G0: G0,
    vcirc: vcirc, raanRate: raanRate, wrap360: wrap360, propFor: propFor,
    spiral: spiral, makeSpiralCache: makeSpiralCache, cycle: cycle, feasible: feasible,
    pickFifo: pickFifo, pickSoonest: pickSoonest, pickLookahead: pickLookahead, simulate: simulate,
    quantile: quantile, rng: rng, sampleJobs: sampleJobs, monteCarlo: monteCarlo
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OtterPlanner = api;
})(typeof window !== 'undefined' ? window : this);
