// Seeded generator for the synthetic constellation and vehicle assumptions.
// Run: node data/generate.js   (writes data/constellation.json and data/constellation.js)
'use strict';
const fs = require('fs');
const path = require('path');
const { rng } = require('../core/planner.js');

const SEED = 2027;
const R = rng(SEED);

const PLANES = 12, SLOTS = 20;
// Planes are launched two at a time between Mar 2026 and Aug 2027 (day 0 = 1 Jan 2028,
// the start of the disposal contract).
const launchDays = [-660, -660, -570, -570, -480, -480, -390, -390, -300, -300, -200, -200];

const sats = [];
for (let p = 0; p < PLANES; p++) {
  for (let s = 0; s < SLOTS; s++) {
    sats.push({
      id: 'P' + String(p + 1).padStart(2, '0') + '-S' + String(s + 1).padStart(2, '0'),
      plane: p + 1,
      slot: s + 1,
      phi: (360 / PLANES) * p,                 // relative RAAN of the plane, deg
      launchDay: launchDays[p] + Math.round(R() * 20 - 10)
    });
  }
}

const constellation = {
  name: 'Example LEO constellation (synthetic)',
  planes: PLANES, slots: SLOTS,
  shellKm: 900, incDeg: 53,
  // Random (non-wear-out) failures that leave a satellite unable to dispose of itself.
  weibullBeta: 1.3, weibullEtaYears: 24,
  handoverDays: 30,           // operator passivation + handover before Starfish may dock
  horizonDays: 1096,          // 3-year contract, 1 Jan 2028 - 31 Dec 2030
  baseSeed: 7,                // the failure history shown in the plan view
  sats
};

const vehicle = {
  // Otter-class servicer. All values are assumptions for the demo, not Starfish data.
  dryKg: 235, xenonKg: 100,   // 335 kg wet (NASA's published Otter 24C mass)
  thrustN: 0.060, ispS: 1500, // Hall-effect thruster class
  clientKg: 250,
  releaseKm: 450,             // stack released here; client decays naturally
  shellKm: constellation.shellKm, incDeg: constellation.incDeg,
  rpoDays: 14, rpoDv: 12,     // phasing, inspection, approach, capture
  dragMakeupMsPerYr: 25,      // station-keeping at 450 km
  reserveKg: 4,               // kept for Otter's own disposal
  launchPhi: 200,             // rideshare drop-off plane (relative RAAN), 450 km
  horizonDays: constellation.horizonDays,
  slaDays: 365,               // failure-to-deorbit target used in the service-level metric
  lookDepth: 3, lookWidth: 5, lookObjective: 'sum'
};

function build() { return { generated: 'seed ' + SEED, constellation, vehicle }; }
module.exports = { build };
if (require.main === module) {
const out = build();
fs.writeFileSync(path.join(__dirname, 'constellation.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(__dirname, 'constellation.js'), 'window.DAAS_DATA = ' + JSON.stringify(out) + ';\n');
console.log('wrote', sats.length, 'satellites');
}
