# Otter Deorbit-as-a-Service Planner (concept)

**Live demo:** https://mohith26.github.io/starfish-otter-campaign-planner/

An unofficial concept feature for Starfish Space's Otter: a campaign planner for multi-satellite
end-of-life disposal in a LEO constellation. It answers the question a Deorbit-as-a-Service contract
turns on: *how many satellites can one Otter dispose of on one tank, in what order, and how long does
each failed satellite wait?*

Built by Mohith Gajjela. Not affiliated with Starfish Space. All data is synthetic.

## Why

Starfish's SDA contract is an initial deorbit "with options for multiple additional deorbits", and
Trevor Bennett has said one Otter's capacity "gets closer to 10" disposals. With electric propulsion,
plane changes between constellation planes are far too expensive to burn directly (a 30° node change at
53° is roughly 4.8 km/s with Edelbaum's formula), so moving between planes has to come from J2
differential precession. The key observation the planner uses: **the tow itself is a drift
manoeuvre.** Dragging a client from the shell down to the release altitude already moves Otter west
in the shell's nodal frame. If Otter waits at the release altitude after letting go, instead of
climbing straight back, it reaches the next plane with no separate descend-drift-climb excursion.

## What the demo shows

Synthetic shell: 240 satellites, 12 planes, 900 km, 53°. Random failures (Weibull per satellite)
over a 3-year contract starting 1 Jan 2028, including a backlog of satellites that failed before
the contract began. Otter-class vehicle: 235 kg dry + 100 kg xenon (335 kg wet), 60 mN, 1500 s,
250 kg clients released at 450 km.

Monte Carlo over 400 failure histories, same online rule for every policy:

| Policy | Order | Disposals per tank (P10-P90) | Xenon per disposal | Failure-to-deorbit P50 / P90 |
|---|---|---|---|---|
| Return-and-park | oldest failure first | 3.6 (3-4) | 22.3 kg | 806 / 1129 d |
| Return-and-park | soonest plane | 4.0 (4-4) | 22.1 kg | 422 / 752 d |
| Drift-coupled | oldest failure first | 4.3 (3-6) | 14.5 kg | 798 / 1127 d |
| **Drift-coupled** | **soonest plane** | **6.7 (6-7)** | **13.8 kg** | **419 / 731 d** |

So with identical assumptions, coupling the tow with the plane change raises capacity from 4.0 to
6.7 disposals per tank (+67%), and the order rule (serve the client whose plane comes up next, the
"RAAN walk") roughly halves the wait compared with first-come-first-served. At about 24 expected
failures in three years, that is 4 Otters instead of 6 to clear demand (simple demand / capacity
ratio).

The page computes every number on load from `data/constellation.js` with `core/planner.js`, and the
assumptions panel re-runs the plan and the Monte Carlo in the browser.

## How it works

* **Frame.** All planes share altitude and inclination, so they precess together. The planner works
  in the shell's nodal frame, where each plane is a fixed angle and a vehicle below the shell
  regresses west at `Ω̇(h) − Ω̇(shell)` (secular J2, circular orbits).
* **Spirals.** Each altitude change is a coplanar Edelbaum spiral at constant thrust with falling
  mass: `v(t) = v0 ± c·ln(m0/m(t))`. The relative node drift during the spiral is integrated with
  Simpson's rule (converged to 1e-6°).
* **Cycle.** reach plane → hold until the client is handed over → RPO allowance (14 d, 12 m/s) →
  tow the stack to 450 km → release. Drift-coupled: dwell low for exactly the time that makes the
  climb's own drift land on the next plane (solved with a mass-aware fixed-point iteration, closure
  < 1e-6°), paying drag make-up while low. Return-and-park: climb back immediately, then do a
  dedicated descend-drift-climb excursion for the next plane.
* **Order.** Online: Otter only knows about failures that have happened. "Soonest plane" picks the
  known client whose disposal can complete first from the current state. I also tested a depth 2-4
  lookahead over the known queue; in this online setting it did not beat the greedy rule (5.8 to 6.5 vs
  6.7 mean disposals), so the greedy rule ships.
* **Uncertainty.** Each Monte Carlo history redraws every satellite's time to failure and replays the
  contract, so capacity and wait time are distributions, not one plan.

## Tests

```
node --test tests/planner.test.cjs
```

10 tests: committed data equals the seeded generator output; J2 rate reproduces a sun-synchronous
orbit (+0.9856°/day at 700 km, 98.19°); spiral matches the rocket equation, constant-thrust timing
and a 1024-step drift integral; 200 random cycles close on the target plane to < 1e-6° and respect
handover time with exact propellant bookkeeping; coupling never uses more xenon than return-and-park
over two consecutive disposals; the soonest-plane rule equals a brute-force argmin; simulation
invariants (no client twice, reserve kept, horizon respected, causal ordering); Monte Carlo is
deterministic and coupling raises capacity.

Regenerate the data with `node data/generate.js`.

## Honest limitations

* Vehicle numbers (dry mass, xenon load, thrust, Isp, client mass, release altitude, RPO allowance,
  drag make-up) are my order-of-magnitude guesses, not Starfish data. The 6.7 figure moves with them;
  the relative gain from coupling is the robust part. With heavier clients or a smaller tank the
  absolute count drops.
* Circular orbits and secular J2 only. No eccentric perigee-lowering disposal, no along-track phasing
  model (a fixed RPO allowance stands in for it), no eclipse or duty-cycle limits on the thruster,
  no conjunction screening during the tow, and drag is a constant make-up rate.
* One Otter per shell. "Otters to clear demand" is a demand / capacity ratio, not a multi-vehicle
  assignment.
* The failure model is a single Weibull for random failures that leave a satellite unable to dispose
  of itself; real fleets have correlated failures by batch.

## Novelty note

Using differential nodal precession to move between planes is well known in the debris-removal
literature (GTOC9, Edelbaum + J2 tour planners, and the "RAAN walk" structure of optimal sequences),
and Astroscale's ELSA-M describes RAAN matching before each client. What I did not find in Starfish's
public material (press releases, mission pages, SBIR abstracts, FCC filings) is a planner that treats
the client tow as the drift leg and reports per-tank capacity and failure-to-deorbit time as
distributions over random failure histories.

## Files

* `core/planner.js` - orbital mechanics, cycle model, policies, simulation, Monte Carlo (browser + Node)
* `data/generate.js` - seeded generator; `data/constellation.{json,js}` - committed output
* `index.html`, `styles.css`, `app.js` - the page, styled after starfishspace.com
* `tests/planner.test.cjs` - unit tests
