# SmartLoad 2.0

Prototype for SIH1313 (Ministry of Coal). Live loading feedback for payloader
operators at coal sidings.

The claim is **predict → recommend → correct → verify**, not "detect and alert".
Everything below exists to support that claim, and the parts that do not yet
hold up are named as such rather than papered over.

```
npm install
npm run dev        # /operator, /simulator, /demo
npm test           # 210 unit tests over the physics, the estimators and the console
npm run verify:ui  # 52 browser checks (needs `npm run dev` running)
```

---

## ⚠ Unverified constants — read before demoing

**Every physical constant in `src/config/wagons.ts` is a placeholder.** None has
been checked against a primary source. They are order-of-magnitude stand-ins
chosen so the simulator behaves plausibly, and they must be replaced before any
demo or submission that claims accuracy:

| Value | Where | Must come from |
|---|---|---|
| BOXN / BOBRN permissible load limit, tare, overload & underload thresholds | `WAGON_SPECS` | RDSO drawings, IR Wagon Maintenance Manual, IRCA Conference Rules Part III |
| Bucket mass distribution (μ = 4100 kg, σ = 450 kg) | `BUCKET_MODEL` | Measured from an instrumented payloader over a real shift |
| Coal bulk density (850 kg/m³) and angle of repose (38°) | `COAL_MODEL` | Coal rank, size fraction and moisture at the specific siding |
| Load cell noise, impact settling, LiDAR noise | `SENSOR_MODEL` | Datasheets for the chosen hardware |
| Max rail share (55%), sensor disagreement threshold | `TOLERANCES` | CIL / Railways loading standing orders and the bogie load-transfer model |
| Bogie near-rail load share (0.72) | `distribution.ts` | Bogie load transfer model |
| Loading gauge heaping allowance (0.5 m) | `lidar.ts` | Loading gauge diagram |

Two further caveats worth stating out loud:

- **PLL is not one number per wagon type.** It varies with the route's permitted
  axle-load regime (CC, CC+6+2, CC+8+2…). Production must resolve it from
  (wagon type × route class). The flat table here is wrong for that reason too.
- The bucket distribution should be **learned online per (machine, siding)**, not
  read from a constant. `estimateBucketBelief` already does this; the config
  figure only seeds the prior, and it is deliberately given a low effective
  sample size (3) so real data displaces it quickly.

No physical constant is hardcoded anywhere else in the codebase.

---

## The physics (`src/lib/`)

Built and tested before any UI. Nothing here is a counter on a timer.

| Module | What it does |
|---|---|
| `bucketModel.ts` | Discrete bucket drops. The mass curve is a **staircase**, not a ramp: each drop is a step plus an underdamped impact transient (sharp overshoot, damped ring-down over ~2.5 s) plus Gaussian sensor noise. |
| `kalman.ts` | Constant-velocity filter on `[mass, mass_rate]` with an innovation gate. A moving average lags a step by ~window/2 — worst precisely when a bucket has just landed and the operator is deciding. `kalman.test.ts` measures both and asserts the filter wins. |
| `overshoot.ts` | **The calculation the product rests on.** `P(overshoot \| k more buckets)` from the *learned* bucket distribution, with the Kalman uncertainty on current mass folded in. Every recommendation derives from this and nothing else. |
| `conformal.ts` | Split conformal prediction. Final weight is an **interval**, never a point. **The stop rule is: halt when the UPPER bound crosses PLL.** Distribution-free; falls back to a model band and reports `calibrated: false` rather than pretending to a guarantee it lacks. |
| `distribution.ts` | Left/right split from **independent rail load cells** — a mass measurement. Reports `measurable: false` below `MIN_TOTAL_FOR_SPLIT_KG` (100x the per-rail noise): on a near-empty wagon the ratio of two noisy near-zero numbers is not a distribution, and reporting it produced shares of -1027 / 1127%. |
| `lidar.ts` | Longitudinal profile and peak height — **geometry only**. Never used for the mass split. |
| `bulkDensity.ts` | Live `Δmass / Δvolume` per bucket. When the two sensor families disagree beyond the plausible range for coal, that is a **sensor fault, not a real anomaly** — and the *direction* of the error names the suspect sensor. |
| `recommend.ts` | Turns the probabilistic state into one bucket-quantised sentence. |
| `engine.ts` | Everything below the `SENSOR BOUNDARY` comment reads only sensor outputs, never ground truth. Delete the simulator, wire in load cells, and that code is unchanged. |

### Mass and volume are kept strictly separate

Load cells measure **mass**; LiDAR measures **surface geometry**, from which we
integrate a **volume**. Coal of varying density can present an even surface while
sitting unevenly on the rails, and vice versa, so inferring lateral load transfer
from a surface profile is a category error — and lateral imbalance is a
derailment risk. The two live in separate modules and separate contract fields
so the boundary cannot blur by accident.

Their *ratio* is the cross-check: dust on a LiDAR lens makes the wagon look
emptier than it is, and a system that treated that as real would tell the
operator to keep loading an already-full wagon.

---

## Data contract

`src/lib/telemetry.ts` fixes the frame the edge device publishes over MQTT. The
UI consumes exactly this shape, so real hardware replaces the simulator with
zero UI changes. `src/lib/actionSentence.ts` derives the operator's sentence from
`next_best_action` + `explanation` alone — deliberately, so the console needs
nothing the contract does not carry.

`src/lib/dataSource.ts` holds the swappable interface:

- **`SimulatedSource`** — active, drives the physics engine.
- **`MqttSource`** — **NOT IMPLEMENTED.** Every method throws. There is no broker,
  no connection, no reconnect logic. It fixes the interface a real implementation
  must satisfy; faking a connected badge would be the first thing to unravel
  under questioning.

---

## Screens

`/` and any unmatched path redirect to `/demo` — the combined stage is what gets
presented, so it is what opens. `/operator` remains the shippable product on its
own route, unchanged.

**`/operator`** — exactly five elements, glanceable from a payloader cab three
metres away. `h-screen overflow-hidden`, so it never scrolls: an operator holding
a loaded bucket cannot scroll a page, and the next-best-action line previously
fell below the fold at 1024x768 — the one instruction the console exists to
deliver, invisible on the smallest target it supports. Verified at 1440x900,
1280x800 and 1024x768, with every element asserted above the fold.

The five are: the weight (tabular numerals, rolling), a one-word status band, the
next best action, a left/right balance meter that shows numbers only when out of
tolerance, and a sensor strip that is invisible until something degrades.
Analytics, history and certificate lists belong on a separate `/analytics` route
— not on the screen someone reads while holding four tonnes of coal in the air.

**`/demo`** — the presentation view for judges, and what `/` opens on: the
operator console at 42% on the left, the physics at 58% on the right
(cross-section, curve, scenario strip). A fixed 1440x900 stage, no scroll.

The certificate overlays the **right column only** and is dismissible, so the
console keeps reporting underneath it — the certificate is the VERIFY step of the
loop, not a modal that ends the demo.

Switching scenario draws a new wagon, which clears the history. Because the
trigger strip sits directly under the curve, that blanks the graph a few
centimetres above the button just pressed — so the blanking is named: a brief
`NEW WAGON — BOXN…` transition. No confirmation dialog; the click is the
decision, and stopping a presenter mid-sentence to ask "are you sure" costs more
than the occasional mis-click.

It is not a rebuild. The five console elements come from the same
`<ConsoleBody>` component `/operator` renders, at a different scale — `compact`
is allowed to change size and nothing else, and a test drives both variants from
one frozen frame and asserts the rendered text matches character for character.
If the demo ever drifted from the product, what judges are shown would stop
being what ships.

**`/simulator`** — exactly four elements: the animated wagon cross-section
(coal settles to the angle of repose from the same cone geometry the LiDAR model
uses), the weight curve, scenario triggers, and the certificate.

All three routes observe **one** telemetry stream (`telemetryStore.ts`) — one
engine, one wagon, one tick — so a fault raised on the simulator appears on the
operator console, and `/demo` needs no state of its own.

### The one animation that matters

On the weight curve, the prediction band's upper edge reaches the PLL line
**while the actual weight curve is still well below it**, and flares at the
intersection. That single visual is the "predict, not detect" claim.

On `/demo` the status band on the left flips in the **same frame** as that flare
on the right. Nothing is scheduled against anything: `telemetryStore` is a
singleton, both panels read one frame, and both evaluate the same condition —
`predicted_final_upper_kg >= pll_kg` while `weight_kg_filtered < pll_kg` — in one
React commit. The console derives it from the published contract rather than the
simulator's internal flag, so the simultaneity survives a swap to real hardware.
It is a property of the architecture, not a tuned timing constant. `npm run
verify:ui` reads both panels in a single page evaluation and asserts it.

### Never a false certainty

Risk percentages saturate at the display layer: below 0.5% they read `<1`, above
99.5% they read `>99`. A bare "0% OVERLOAD RISK" is a promise no probabilistic
system can make, and a bare "100%" says the outcome is already settled. Both are
rounding artefacts that an operator reads as certainties.

`p_overshoot_next_bucket` in the telemetry frame stays the **raw float** —
thresholds, logging and the certificate need the actual number, not a legible
one. Only `pctDisplay()` in `recommend.ts` clamps, and `actionSentence.ts`
carries the qualifier through to the screen rather than stripping it back to a
bare digit.

### The status band reports risk, not activity

`SAFE` / `CAUTION` / `STOP`. It previously read `LOADING` when green, which
described what the payloader was doing — something the operator already knows,
because they are the one doing it — and left the green state saying nothing about
risk at all.

### Recommendations are bucket-quantised

An operator holding a full bucket cannot "reduce the loading rate". The only
available actions are: full scoop, smaller scoop, place it left, place it right,
stop. When a full bucket no longer fits but stopping would strand ~4 t of
headroom, the advice is `HALF BUCKET` — a decision made at the stockpile face,
not a mid-dump modulation of an airborne bucket. That is the **correct** step of
the loop, and it is what keeps the NORMAL scenario from finishing 7% underloaded.

---

## Certificate

Hash-chained: SHA-256 over the canonical record plus the previous record's hash.
Labelled **TAMPER-EVIDENT**, never tamper-proof — a hash chain *detects*
alteration, it does not prevent it, and an adversary who can rewrite every record
can produce a chain that verifies perfectly. `certificate.test.ts` asserts both
properties, including that full-chain forgery passes verification. Making the
chain hard to rewrite requires anchoring the head hash somewhere the forger does
not control (an external append-only log, or countersigning from a secure
element). **Neither is implemented.**

---

## Design system

`design-system/smartload2/MASTER.md` is authoritative, with two documented
departures:

1. Its `PATTERN` section (marketing landing page — hero, CTA, trust signals) is
   ignored. This is an industrial console.
2. `--color-warning: #F59E0B` added. The palette ships green and red but no
   amber, and the system is fundamentally Green / Yellow / Red.

One further addition: `--color-text-muted: #94A3B8`. `--color-border` (#475569)
measures 2.36:1 against the background — fine as a hairline, unreadable as type.
Anything meant to be read uses the new token (6.96:1), and no text sits below the
checklist's 4.5:1 floor.
