# COSMOS-X — Intelligent Space Exploration
**Explore. Discover. Experiment. Understand.**

An AI-powered interactive space exploration and scientific discovery
platform: space simulator, scientific laboratory and guided adventure in
one browser file.

A real-time 3D astronomy simulator that runs in a browser. Every celestial
object is generated procedurally from a single integer seed, and all orbital
motion is solved live from Kepler's laws rather than replayed as animation.

---

## Running it

**Fastest path — no install, no server, no internet after first load:**

Open `cosmos-x.html` by double-clicking it. That's the whole deployment.

The single file contains the entire application. It pulls Three.js from a CDN
on first load; after that the browser caches it. For a guaranteed-offline demo,
download `three.min.js` once and change the `<script src="…">` tag to point at
the local copy.

**For development**, use the modular source (`index.html` + `engine.js` +
`render.js` + `app.js`). ES modules require a server:

```bash
python3 -m http.server 8000    # then open http://localhost:8000
```

Rebuild the single-file bundle after editing with `python3 bundle.py`.

**Requirements:** any WebGL2 browser (Chrome, Firefox, Edge, Safari 15+).
Works on desktop and touch devices. No GPU beyond integrated graphics needed.

---

## Presenting this

Press **Demo** in the top bar. An eight-beat cinematic sequence runs unattended
for about 75 seconds:

Earth → Solar System → Milky Way → deep-space warp → nebula →
generated exoplanet → black hole → return to Earth

Each beat gets a title card and a caption with real numbers in it. Press
**Exit demo** or `Esc` to take manual control at any point.

Three things are worth pointing out to an audience:

1. **The orbits are computed, not animated.** Push the time rate to
   `1 yr/s` and the planets separate at their correct relative velocities —
   Mercury laps Neptune roughly 685 times. Nothing is on a loop.
2. **The scale ladder on the left** tracks your position across 28 orders of
   magnitude, from metres to gigaparsecs, in one continuous space.
3. **The green and cyan provenance tags** on every info panel separate measured
   data from generated data. Sol and its planets carry real published values;
   everything else is labelled as simulated.

---

## Controls

| Input | Action |
|---|---|
| Drag | Look around |
| Scroll / pinch | Change distance — crosses scale tiers automatically |
| Click object | Select, open data panel, set as target |
| `W` / `S` | Throttle up / down |
| `Shift` | Warp drive (interstellar distances) |
| `Q` / `E` | Roll |
| `X` | Brake |
| `F` | Autopilot to target |
| `Space` | Pause / resume simulation clock |
| `,` / `.` | Time rate down / up (real time → 1 Myr/s) |
| `L` | Log discovery |
| `C` | Add to comparison tray |
| `[` / `]` | Step scale tier down / up |
| `M` | Missions |
| `H` | Help |
| `Esc` | Close panels |

Touch devices get an on-screen stick and throttle buttons automatically.

---

## Architecture

```
engine.js    Physics + generation. No rendering dependency — testable in Node.
  RNG          mulberry32, seeded, deterministic
  Physics      Kepler solver, gravity, temperature, ESI, relativity
  Universe     lazy hierarchical generation, cached by seed hash
  SimClock     time control, 12 rates from −1 yr/s to +1 Myr/s

render.js    Three.js scene construction
  procedural texture synthesis (FBM noise → canvas → GPU)
  shader materials: stars, atmospheres, accretion discs, lensing
  Spacecraft   flight model, warp, autopilot
  MISSIONS, DEMO_SEQUENCE   content definitions

app.js       Application controller
  tier management (floating origin + LOD swap)
  input, picking, UI binding, demo director
```

### The scale problem, and how this solves it

Rendering 10²⁸ metres of range into one float32 depth buffer produces z-fighting
and coordinate collapse. AETHER renders **one scale tier at a time**, each with
its own metres-per-unit constant, and re-origins the camera on tier change:

| Tier | Metres per render unit |
|---|---|
| System | 10⁹ |
| Stellar | 3×10¹⁵ |
| Galactic | 10¹⁹ |
| Cosmic | 10²³ |

Zooming past a tier boundary swaps the scene graph and rescales the camera.
Near and far planes track camera distance every frame, so float precision stays
in a usable band regardless of where you are.

### Verified physics

Run the checks in the transcript, or verify by hand — every formula is in
`Physics` and produces published values:

| Quantity | Computed | Published |
|---|---|---|
| Earth orbital period | 365.251 d | 365.256 d |
| Earth surface gravity | 9.8203 m/s² | 9.820 m/s² |
| Earth escape velocity | 11.186 km/s | 11.186 km/s |
| Solar Schwarzschild radius | 2.9533 km | 2.953 km |
| Earth equilibrium temperature | 254.59 K | 254.6 K |
| Solar habitable zone | 0.953–1.374 AU | ~0.95–1.37 AU |
| Earth ESI | 1.0000 | 1.000 |

Kepler's equation converges to 3.3×10⁻¹⁶ residual at e = 0.98.
Orbits close to within 6.8×10⁻⁵ AU after a full simulated year.

Generation was scanned across 1,336 planets in six galaxies: zero malformed
values, 256 worlds above ESI 0.70.

---

## What is real and what is generated

This distinction is enforced in the UI, because a simulator that blurs it
teaches the wrong thing.

**Observed data** (green tag) — the eight Solar System planets and the Moon
carry published masses, radii, orbital elements, rotation periods, axial tilts,
temperatures and atmospheric compositions. Sol's parameters and Sagittarius A*'s
mass are likewise real.

**Procedurally generated** (cyan tag) — everything else. Generated objects are
not arbitrary: stellar masses follow the observed initial mass function (76.5%
M-dwarfs), luminosity follows the mass–luminosity relation, radii follow the
empirical mass–radius relation with its regime change near 4 M⊕, and planet
types are selected by insolation so you do not get ice worlds at 0.1 AU.

**Educational approximations** — three things are deliberately not to scale, and
saying so is more honest than pretending otherwise:

- Planet radii are exaggerated on a log curve at system scale. At true scale
  Earth is sub-pixel from anywhere you can see the whole orbit.
- Black hole Schwarzschild radii are exaggerated at stellar tier. A 10 M☉ hole
  is 30 km across and would be invisible.
- Gravitational lensing is a screen-space approximation keyed to the photon
  sphere, not geodesic ray integration. It reproduces the Einstein ring and the
  disc's Doppler asymmetry convincingly, but it is not a relativistic solver.

---

## Extension points

The architecture leaves these open and they are the natural next pieces of work:

- **Real catalogue ingestion.** `Universe.getSystems()` is the seam. Feed it
  Gaia DR3 or the NASA Exoplanet Archive and real stars flow through the same
  rendering path with `real: true` set — the provenance UI already handles them.
- **Geodesic lensing.** Replace the shader in `buildBlackHole()` with a cubemap
  raymarcher integrating null geodesics in Schwarzschild coordinates.
- **Raymarched nebulae.** The current billboard stack approximates volume; a
  3D texture with a raymarch loop would be correct.
- **Surface landing.** `SCALES` already defines a `surface` tier below
  `planet`; it needs a terrain generator to become navigable.
- **Persistent saves.** Discovery log and mission state are in `state` and
  serialise cleanly; only the storage call is missing.

---

## Design notes

The interface is built as an **observatory instrument panel** rather than a
science-fiction HUD — amber-on-charcoal readouts, monospace throughout because
every number shown is a measurement, hairline rules borrowed from spectrograph
plates. The one deliberate flourish is the scale ladder: it is the element that
makes 28 orders of magnitude legible instead of merely traversable, and
everything else stays quiet so it reads.


---

## COSMOS-X features

### ORION — the assistant

ORION answers from the **actual computed values** of whatever is selected.
It classifies the question, pulls the relevant quantities, and reasons over
them numerically. There is no script and no network call, so it works offline
and can never contradict the simulation.

Ask it things like:

- *Why is this planet red?* — traces the answer to composition and temperature
- *Can humans survive here?* — runs a five-factor audit with hard blockers
- *Find me a planet similar to Earth* — searches the generated catalogue by ESI
- *Why does this star appear blue?* — Wien's law from the star's temperature
- *What makes this planet unusual?* — z-scores the object against the surveyed population
- *Compare this planet with Earth* — computed differentials, not stock text

Three explanation depths (**Beginner / Intermediate / Advanced**) switch from
the header. ORION also volunteers suggestions when it notices something —
an anomalously dense atmosphere, a retrograde spin, a high-ESI world.

**Optional live model.** Setting `window.__COSMOSX_API = true` routes questions
to the Claude API instead. The demo path never uses it, deliberately.

### Research Lab

A five-stage scientific workflow: **Scan → Analyse → Compare → Hypothesise → Report.**
The report is a proper seven-section document — overview, collected data,
habitability analysis, anomalies, findings, interpretation, recommendations —
and copies to the clipboard for use as a student submission.

### What-If Universe

Seven parameter experiments with computed consequences, each showing
**Original → Parameter changed → Consequences**:

| Experiment | What it computes |
|---|---|
| Gravity ×2 | Mass, escape velocity, scale height, jump height, orbital velocity, launch feasibility |
| Rotation stopped | Day length, Coriolis, equatorial bulge relaxation, dynamo collapse |
| Moon removed | Tidal range, obliquity stability, day-lengthening rate |
| Orbit changed | Insolation, equilibrium temperature, runaway greenhouse threshold |
| Atmosphere ×2 | Pressure, logarithmic greenhouse forcing, boiling point, drag |
| Supernova | Progenitor lifetime, energy budget, remnant class, sterilising radius |
| Black hole approach | Tidal stretching, time dilation, photon sphere, ISCO |

### Missions, progression, journey

Ten staged missions across 44 objectives, tied to real actions — you complete
a stage by scanning, analysing, comparing, or asking the right question, not by
clicking through. Eight achievements, ten explorer levels.

**Journey** (top bar) is the signature presentation mode: eight cinematic beats
from a human body to the observable universe. Use this one for leadership.

---

## Verified behaviour

Beyond the eight physics checks above, the COSMOS-X layer was tested:

| Check | Result |
|---|---|
| ORION intent classification | 9/9 correct |
| Free-oxygen detection | 6/6 (incl. the CO₂/O₂ substring trap) |
| Survival verdicts | Earth unprotected, Venus lethal, Jupiter lethal |
| Habitability scoring | Earth 92%, Mars 36%, Venus 29%, Jupiter 18% |
| What-If experiments | 7/7 produce finite, complete output |
| Research report | All 7 sections populate |
| Mission evaluation | Fires correctly against live context |

Three bugs were caught and fixed during testing, worth recording because they
would each have been visible on stage:

1. **Intent regexes used trailing `\b` on stems**, so `surviv` never matched
   "survive" — the single most likely demo question fell through to the generic
   handler.
2. **Star-colour questions were caught by the planet-colour pattern**, giving a
   surface-composition answer to a stellar-temperature question.
3. **`"CO₂".includes("O₂")` is `true`.** Venus's atmosphere was scoring as
   breathable oxygen, which inflated its habitability and rated a 737 K
   sulphuric-acid world as survivable in a pressure suit.

---

## Controls (additions)

| Key | Action |
|---|---|
| `O` | ORION |
| `R` | Research Lab |
| `I` | What-If Universe |
| `P` | Progress and achievements |
| `J` | Journey (story mode) |
| `M` | Mission dashboard |
