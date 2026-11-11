(function () {
  'use strict';
  var L = window.OtterPlanner;
  var D = window.DAAS_DATA;
  var C = JSON.parse(JSON.stringify(D.constellation));
  var P = JSON.parse(JSON.stringify(D.vehicle));
  var MC_RUNS = 400, MC_SEED = 1000;
  var POL = {
    parkFifo: { coupled: false, order: 'fifo', label: 'Return-and-park', orderLabel: 'Oldest failure first' },
    park: { coupled: false, order: 'soonest', label: 'Return-and-park', orderLabel: 'Soonest plane' },
    coupledFifo: { coupled: true, order: 'fifo', label: 'Drift-coupled', orderLabel: 'Oldest failure first' },
    coupled: { coupled: true, order: 'soonest', label: 'Drift-coupled', orderLabel: 'Soonest plane' }
  };
  var view = 'coupled';
  var R = {};

  var $ = function (id) { return document.getElementById(id); };
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dateOf(day) { var d = new Date(Date.UTC(2028, 0, 1) + day * 864e5); return d; }
  function fmtDate(day) { var d = dateOf(day); return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear(); }
  function fmtMonth(day) { var d = dateOf(day); return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
  function f1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
  function wrap(x) { return L.wrap360(x); }

  // ---------------- compute ----------------
  function compute() {
    var jobs = L.sampleJobs(C, C.baseSeed);
    R.jobs = jobs;
    R.plan = { coupled: L.simulate(jobs, P, POL.coupled), park: L.simulate(jobs, P, POL.park) };
    var keys = ['parkFifo', 'park', 'coupledFifo', 'coupled'];
    var mc = L.monteCarlo(C, P, keys.map(function (k) { return POL[k]; }), MC_RUNS, MC_SEED);
    R.mc = {};
    keys.forEach(function (k, i) { R.mc[k] = mc[i]; });
  }

  // ---------------- KPIs ----------------
  function kpiCard(o) {
    return '<article class="card kpi"><div class="card-media"><div class="eyebrow">' + o.eyebrow + '</div>' +
      '<div class="big">' + o.big + (o.unit ? '<small>' + o.unit + '</small>' : '') + '</div>' +
      '<div class="vs">' + o.vs + '</div>' + o.svg + '</div>' +
      '<div class="card-body"><h3>' + o.title + '</h3><div class="meta-row"><p class="meta">' + o.meta + '</p>' +
      '<a class="pill" href="' + o.href + '">' + o.btn + '</a></div></div></article>';
  }
  function barsSvg(a, b, max) {
    var w = 390, h = 92, y1 = 28, y2 = 56, x0 = 26, span = w - 52;
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
      '<rect x="' + x0 + '" y="' + y1 + '" width="' + span * a / max + '" height="10" rx="5" fill="#f26531"/>' +
      '<rect x="' + x0 + '" y="' + y2 + '" width="' + span * b / max + '" height="10" rx="5" fill="rgba(255,255,255,.32)"/>' +
      '</svg>';
  }
  function renderKpis() {
    var c = R.mc.coupled, p = R.mc.park;
    var ottersC = Math.ceil(c.demandMean / c.meanCount), ottersP = Math.ceil(p.demandMean / p.meanCount);
    var gain = Math.round((c.meanCount / p.meanCount - 1) * 100);
    $('kpis').innerHTML = [
      kpiCard({ eyebrow: 'Disposals per tank', big: f1(c.meanCount), unit: 'per ' + P.xenonKg + ' kg Xe',
        vs: 'Return-and-park: <b>' + f1(p.meanCount) + '</b> &nbsp;·&nbsp; P10–P90 ' + c.p10.toFixed(0) + '–' + c.p90.toFixed(0),
        svg: barsSvg(c.meanCount, p.meanCount, Math.max(c.meanCount, p.meanCount) * 1.08),
        title: 'Drift coupling adds ' + gain + '% capacity', meta: 'Mean over ' + MC_RUNS + ' simulated failure histories', href: '#mcTbl', btn: 'Details' }),
      kpiCard({ eyebrow: 'Xenon per disposal', big: f1(c.xenonPerDisposal), unit: 'kg',
        vs: 'Return-and-park: <b>' + f1(p.xenonPerDisposal) + ' kg</b>',
        svg: barsSvg(c.xenonPerDisposal, p.xenonPerDisposal, Math.max(c.xenonPerDisposal, p.xenonPerDisposal) * 1.08),
        title: 'No separate drift excursions', meta: 'Approach, capture, tow and climb, per client', href: '#nodeChart', btn: 'View plan' }),
      kpiCard({ eyebrow: 'Otters to clear demand', big: String(ottersC), unit: 'vehicles',
        vs: 'Return-and-park: <b>' + ottersP + '</b> &nbsp;·&nbsp; ' + f1(c.demandMean) + ' failures expected',
        svg: barsSvg(ottersC, ottersP, Math.max(ottersC, ottersP) * 1.08),
        title: 'Sizing a 3-year disposal contract', meta: C.planes * C.slots + ' satellites, ' + C.planes + ' planes, ' + C.shellKm + ' km, ' + C.incDeg + '°', href: '#assume', btn: 'Assumptions' })
    ].join('');
  }

  // ---------------- node timeline ----------------
  function sizeSvg(svg) {
    var w = svg.clientWidth || 1178, h = svg.clientHeight || 430;
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    return { w: w, h: h };
  }
  function renderNode() {
    var svg = $('nodeChart'), S = sizeSvg(svg);
    var m = { l: 46, r: 12, t: 10, b: 30 }, W = S.w - m.l - m.r, H = S.h - m.t - m.b;
    var X = function (t) { return m.l + W * t / P.horizonDays; };
    var Y = function (phi) { return m.t + H * (1 - wrap(phi) / 360); };
    var g = el('g', {}, svg);
    // year grid
    for (var y = 0; y <= 3; y++) {
      var d = Math.round((Date.UTC(2028 + y, 0, 1) - Date.UTC(2028, 0, 1)) / 864e5);
      el('line', { x1: X(d), x2: X(d), y1: m.t, y2: m.t + H, stroke: 'rgba(84,185,224,.18)', 'stroke-width': 1 }, g);
      if (y < 3) { var tx = el('text', { x: X(d) + 6, y: m.t + H + 20, fill: 'rgba(255,255,255,.6)', 'font-size': 11.5, 'letter-spacing': 1.5 }, g); tx.textContent = String(2028 + y); }
    }
    // planes
    for (var p = 0; p < C.planes; p++) {
      var phi = 360 / C.planes * p;
      el('line', { x1: m.l, x2: m.l + W, y1: Y(phi), y2: Y(phi), stroke: 'rgba(84,185,224,.32)', 'stroke-width': 1 }, g);
      var lb = el('text', { x: m.l - 10, y: Y(phi) + 4, fill: 'rgba(255,255,255,.62)', 'font-size': 11, 'text-anchor': 'end' }, g);
      lb.textContent = 'P' + String(p + 1).padStart(2, '0');
    }
    var plan = R.plan[view];
    // otter path
    var colors = { drift: '#f26531', tow: '#54b9e0', climb: 'rgba(255,255,255,.8)', descend: 'rgba(255,255,255,.8)', hold: 'rgba(255,255,255,.55)', rpo: '#ffffff' };
    plan.legs.forEach(function (lg) {
      if (lg.t0 >= P.horizonDays) return;
      var t1 = Math.min(lg.t1, P.horizonDays);
      var f = (t1 - lg.t0) / Math.max(1e-9, lg.t1 - lg.t0);
      var a = lg.phi0, b = lg.phi0 + (lg.phi1 - lg.phi0) * f;
      // split where the wrapped angle jumps
      var n = Math.max(2, Math.ceil(Math.abs(b - a) / 2) + 1), pts = [], segs = [];
      for (var i = 0; i < n; i++) {
        var s = i / (n - 1), tt = lg.t0 + (t1 - lg.t0) * s, ph = a + (b - a) * s;
        if (pts.length && Math.abs(wrap(ph) - wrap(pts[pts.length - 1][1])) > 180) { segs.push(pts); pts = []; }
        pts.push([tt, ph]);
      }
      segs.push(pts);
      segs.forEach(function (sg) {
        if (sg.length < 2) return;
        el('polyline', { points: sg.map(function (q) { return X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1); }).join(' '), fill: 'none', stroke: colors[lg.kind], 'stroke-width': lg.kind === 'drift' || lg.kind === 'tow' ? 2.2 : 1.6, 'stroke-linecap': 'round' }, g);
      });
    });
    // failures
    R.jobs.forEach(function (j) {
      var x = j.fail < 0 ? m.l + 2 : X(j.fail);
      var c = el('circle', { cx: x, cy: Y(j.phi), r: 4, fill: '#010409', stroke: j.fail < 0 ? 'rgba(255,255,255,.55)' : '#fff', 'stroke-width': 1.4 }, g);
      c.dataset.tip = '<b>' + j.id + '</b> failed ' + (j.fail < 0 ? fmtDate(j.fail) + ' (backlog)' : fmtDate(j.fail));
    });
    // captures
    plan.served.forEach(function (sv, k) {
      var c = el('circle', { cx: X(sv.dock), cy: Y(sv.phi), r: 6, fill: '#f26531', stroke: '#010409', 'stroke-width': 1.5 }, g);
      c.dataset.tip = '<b>#' + (k + 1) + ' ' + sv.id + '</b><br>Captured ' + fmtDate(sv.dock) + '<br>Released at ' + P.releaseKm + ' km ' + fmtDate(sv.release) + '<br>Failure to deorbit: ' + Math.round(sv.latency) + ' days<br>Xenon: ' + f1(sv.prop) + ' kg';
      var t = el('text', { x: X(sv.dock) + 9, y: Y(sv.phi) - 8, fill: '#fff', 'font-size': 11, 'font-weight': 600 }, g);
      t.textContent = '#' + (k + 1) + ' ' + sv.id;
    });
    var other = view === 'coupled' ? R.plan.park : R.plan.coupled;
    $('planTitle').textContent = (view === 'coupled' ? 'Drift-coupled plan: ' : 'Return-and-park plan: ') + plan.served.length + ' disposals before the tank runs dry';
    $('planMeta').innerHTML = 'Failure history #' + C.baseSeed + ': ' + R.jobs.length + ' failed satellites through ' + fmtMonth(P.horizonDays) + '. ' +
      (view === 'coupled' ? 'Otter waits at ' + P.releaseKm + ' km after each release and climbs when the next plane lines up. Return-and-park on the same history: ' + other.served.length + '.'
        : 'Otter climbs back after every release, then descends again to drift to the next plane. Drift-coupled on the same history: ' + other.served.length + '.');
  }

  // ---------------- manifest ----------------
  function renderManifest() {
    var plan = R.plan[view];
    var h = '<tr><th>#</th><th>Client</th><th>Failed</th><th>Captured</th><th>Released</th><th class="num">Failure → deorbit</th><th class="num">Xenon</th></tr>';
    plan.served.forEach(function (s, k) {
      h += '<tr><td>' + (k + 1) + '</td><td>' + s.id + ' <span class="tag">P' + String(s.plane).padStart(2, '0') + '</span></td><td>' + (s.fail < 0 ? fmtMonth(s.fail) : fmtDate(s.fail)) + '</td><td>' + fmtDate(s.dock) + '</td><td>' + fmtDate(s.release) + '</td><td class="num">' + Math.round(s.latency) + ' d</td><td class="num">' + f1(s.prop) + ' kg</td></tr>';
    });
    $('manifestTbl').innerHTML = h;
  }

  // ---------------- altitude / xenon ----------------
  function renderAlt() {
    var svg = $('altChart'), S = sizeSvg(svg);
    var m = { l: 40, r: 34, t: 30, b: 26 }, W = S.w - m.l - m.r, H = S.h - m.t - m.b;
    var plan = R.plan[view];
    var X = function (t) { return m.l + W * Math.min(t, P.horizonDays) / P.horizonDays; };
    var hMin = 400, hMax = 950;
    var Y = function (h) { return m.t + H * (1 - (h - hMin) / (hMax - hMin)); };
    var Yx = function (x) { return m.t + H * (1 - x / P.xenonKg); };
    var g = el('g', {}, svg);
    [450, 600, 750, 900].forEach(function (h) {
      el('line', { x1: m.l, x2: m.l + W, y1: Y(h), y2: Y(h), stroke: 'rgba(84,185,224,.16)' }, g);
      var t = el('text', { x: m.l - 6, y: Y(h) + 4, fill: 'rgba(255,255,255,.6)', 'font-size': 10.5, 'text-anchor': 'end' }, g); t.textContent = h;
    });
    [0, 50, 100].forEach(function (pc) {
      var v = P.xenonKg * pc / 100;
      var t = el('text', { x: m.l + W + 6, y: Yx(v) + 4, fill: 'rgba(84,185,224,.85)', 'font-size': 10.5 }, g); t.textContent = Math.round(v);
    });
    for (var y = 0; y < 3; y++) {
      var d = Math.round((Date.UTC(2028 + y, 0, 1) - Date.UTC(2028, 0, 1)) / 864e5);
      var tx = el('text', { x: X(d) + 4, y: m.t + H + 18, fill: 'rgba(255,255,255,.6)', 'font-size': 10.5 }, g); tx.textContent = 2028 + y;
    }
    var alt = [], xe = [], mass = P.dryKg + P.xenonKg;
    var start = plan.legs.length ? plan.legs[0].t0 : 0;
    alt.push([0, P.releaseKm]); xe.push([0, P.xenonKg]);
    plan.legs.forEach(function (lg) {
      if (lg.t0 > P.horizonDays) return;
      alt.push([lg.t0, lg.h0]); alt.push([lg.t1, lg.h1]);
      mass -= lg.prop; xe.push([lg.t1, mass - P.dryKg]);
    });
    var last = alt[alt.length - 1];
    if (last[0] < P.horizonDays) alt.push([P.horizonDays, last[1]]);
    xe.push([P.horizonDays, xe[xe.length - 1][1]]);
    var altPts = alt.map(function (q) { return X(q[0]).toFixed(1) + ',' + Y(q[1]).toFixed(1); });
    el('polygon', { points: X(0) + ',' + Y(hMin) + ' ' + altPts.join(' ') + ' ' + X(P.horizonDays) + ',' + Y(hMin), fill: 'rgba(242,101,49,.14)' }, g);
    el('polyline', { points: altPts.join(' '), fill: 'none', stroke: '#f26531', 'stroke-width': 1.4, 'stroke-linejoin': 'round' }, g);
    el('polyline', { points: xe.map(function (q) { return X(q[0]).toFixed(1) + ',' + Yx(q[1]).toFixed(1); }).join(' '), fill: 'none', stroke: '#54b9e0', 'stroke-width': 1.8 }, g);
    var t1 = el('text', { x: m.l - 34, y: 12, fill: '#f26531', 'font-size': 10.5, 'font-weight': 600 }, g); t1.textContent = 'ALTITUDE (KM)';
    var t2 = el('text', { x: m.l + W + 30, y: 12, fill: '#54b9e0', 'font-size': 10.5, 'font-weight': 600, 'text-anchor': 'end' }, g); t2.textContent = 'XENON LEFT (KG)';
    var used = plan.propUsed;
    $('altMeta').innerHTML = plan.served.length + ' tows from ' + P.shellKm + ' to ' + P.releaseKm + ' km; ' + f1(used) + ' of ' + P.xenonKg + ' kg used (' + P.reserveKg + ' kg kept for Otter\u2019s own disposal).';
  }

  // ---------------- Monte Carlo ----------------
  function renderMc() {
    var svg = $('mcChart'), S = sizeSvg(svg);
    var m = { l: 34, r: 8, t: 14, b: 32 }, W = S.w - m.l - m.r, H = S.h - m.t - m.b;
    var a = R.mc.coupled.counts, b = R.mc.park.counts;
    var maxK = Math.max.apply(null, a.concat(b)) + 1;
    var minK = Math.max(0, Math.min.apply(null, a.concat(b)) - 1);
    var hist = function (arr) { var hh = new Array(maxK + 1).fill(0); arr.forEach(function (v) { hh[v]++; }); return hh.map(function (v) { return v / arr.length; }); };
    var ha = hist(a), hb = hist(b);
    var g = el('g', {}, svg);
    var bw = W / (maxK - minK + 1);
    [0, .25, .5, .75, 1].forEach(function (v) {
      var yy = m.t + H * (1 - v);
      el('line', { x1: m.l, x2: m.l + W, y1: yy, y2: yy, stroke: 'rgba(84,185,224,.16)' }, g);
      var t = el('text', { x: m.l - 6, y: yy + 4, fill: 'rgba(255,255,255,.55)', 'font-size': 10.5, 'text-anchor': 'end' }, g); t.textContent = Math.round(v * 100) + '%';
    });
    for (var k = minK; k <= maxK; k++) {
      var x0 = m.l + bw * (k - minK);
      if (hb[k]) { var r1 = el('rect', { x: x0 + bw * .14, y: m.t + H * (1 - hb[k]), width: bw * .34, height: H * hb[k], fill: 'rgba(255,255,255,.35)', rx: 2 }, g); r1.dataset.tip = 'Return-and-park: ' + k + ' disposals in ' + Math.round(hb[k] * 100) + '% of histories'; }
      if (ha[k]) { var r2 = el('rect', { x: x0 + bw * .52, y: m.t + H * (1 - ha[k]), width: bw * .34, height: H * ha[k], fill: '#f26531', rx: 2 }, g); r2.dataset.tip = 'Drift-coupled: ' + k + ' disposals in ' + Math.round(ha[k] * 100) + '% of histories'; }
      var t = el('text', { x: x0 + bw / 2, y: m.t + H + 18, fill: 'rgba(255,255,255,.6)', 'font-size': 11, 'text-anchor': 'middle' }, g); t.textContent = k;
    }
    var cap = el('text', { x: m.l + W, y: m.t + H + 30, fill: 'rgba(255,255,255,.45)', 'font-size': 10, 'text-anchor': 'end', 'letter-spacing': 1.2 }, g); cap.textContent = 'DISPOSALS PER TANK';
    var rows = [['parkFifo', false], ['park', false], ['coupledFifo', false], ['coupled', true]];
    var h = '<tr><th>Policy</th><th>Order</th><th class="num">Disposals (P10–P90)</th><th class="num">Xe / disposal</th><th class="num">Failure → deorbit P50 / P90</th></tr>';
    rows.forEach(function (r) {
      var o = R.mc[r[0]], p = POL[r[0]];
      h += '<tr' + (r[1] ? ' class="ours"' : '') + '><td>' + p.label + '</td><td>' + p.orderLabel + '</td><td class="num">' + f1(o.meanCount) + ' (' + o.p10.toFixed(0) + '–' + o.p90.toFixed(0) + ')</td><td class="num">' + f1(o.xenonPerDisposal) + ' kg</td><td class="num">' + Math.round(o.latP50) + ' / ' + Math.round(o.latP90) + ' d</td></tr>';
    });
    $('mcTbl').innerHTML = h;
    $('mcRuns').textContent = MC_RUNS;
    var c = R.mc.coupled;
    $('mcMeta').innerHTML = 'Each history redraws every satellite\u2019s Weibull time to failure (β ' + C.weibullBeta + ', η ' + C.weibullEtaYears + ' yr) and replays the contract with the same online rule. Median wait is set by the precession lap: one plane every ' + Math.round(360 / C.planes / Math.abs(L.raanRate(P.releaseKm, P.incDeg) - L.raanRate(P.shellKm, P.incDeg))) + ' days of drift at ' + P.releaseKm + ' km.';
  }

  // ---------------- assumptions ----------------
  function fillForm() {
    var f = $('assume');
    f.xenonKg.value = P.xenonKg; f.clientKg.value = P.clientKg; f.releaseKm.value = P.releaseKm;
    f.thrustMn.value = Math.round(P.thrustN * 1000); f.ispS.value = P.ispS; f.eta.value = C.weibullEtaYears;
    $('assumeMeta').innerHTML = 'Otter-class: ' + P.dryKg + ' kg dry, ' + P.rpoDays + ' d / ' + P.rpoDv + ' m/s per capture, ' + P.dragMakeupMsPerYr + ' m/s/yr drag make-up while low. Values are public-order-of-magnitude guesses, not Starfish data.';
  }
  function readForm() {
    var f = $('assume');
    var num = function (x, d) { var v = parseFloat(x); return isFinite(v) ? v : d; };
    P.xenonKg = num(f.xenonKg.value, P.xenonKg); P.clientKg = num(f.clientKg.value, P.clientKg);
    P.releaseKm = Math.min(P.shellKm - 50, num(f.releaseKm.value, P.releaseKm));
    P.thrustN = num(f.thrustMn.value, P.thrustN * 1000) / 1000; P.ispS = num(f.ispS.value, P.ispS);
    C.weibullEtaYears = num(f.eta.value, C.weibullEtaYears);
  }

  function renderAll() {
    renderKpis(); renderNode(); renderManifest(); renderAlt(); renderMc(); fillForm();
    $('heroSub').textContent = 'One Otter, one ' + P.xenonKg + ' kg tank, ' + f1(R.mc.coupled.meanCount) + ' disposals on average: plan the tow so precession does the plane changes.';
  }

  // ---------------- interactions ----------------
  document.querySelectorAll('#policySeg button').forEach(function (b) {
    b.addEventListener('click', function () {
      view = b.dataset.p;
      document.querySelectorAll('#policySeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderNode(); renderManifest(); renderAlt();
    });
  });
  $('replan').addEventListener('click', function () { readForm(); compute(); renderAll(); });
  var tip = $('tip');
  document.addEventListener('mousemove', function (e) {
    var t = e.target && e.target.dataset ? e.target.dataset.tip : null;
    if (t) { tip.innerHTML = t; tip.style.display = 'block'; tip.style.left = (e.clientX + 14) + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
    else tip.style.display = 'none';
  });
  window.addEventListener('resize', function () { renderNode(); renderAlt(); renderMc(); });

  compute();
  renderAll();
})();
