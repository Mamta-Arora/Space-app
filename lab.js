/* ============================================================
   COSMOS-X — lab.js
   Research Lab · What-If Universe · Habitability · Progression
   ============================================================
   Every consequence in the What-If engine is computed from a
   real relation, not asserted. Where a result depends on a
   model rather than a closed form, it is labelled as such.
   ============================================================ */
import { Physics, AU, SOLAR_MASS, EARTH_MASS, EARTH_RADIUS, G, C } from './engine.js';
import { hasFreeOxygen } from './orion.js';

/* ============================================================
   HABITABILITY ENGINE (§7)
   Six weighted factors, each scored 0–1 with an explicit reason.
   ============================================================ */
export function habitability(b) {
  if (!b || (b.kind !== 'planet' && b.kind !== 'moon')) return null;
  const F = [];

  // Temperature — plateau across the liquid water range
  const t = b.temp;
  let ts;
  if (t >= 273 && t <= 323) ts = 1;
  else if (t > 323) ts = Math.max(0, 1 - (t - 323) / 120);
  else ts = Math.max(0, 1 - (273 - t) / 120);
  F.push({ name: 'Temperature', score: ts, value: `${t} K (${(t - 273.15).toFixed(0)} °C)`,
    why: ts > 0.8 ? 'Within the liquid-water range at Earth-like pressure.'
      : t > 323 ? 'Too hot to retain surface liquid water without extreme pressure.'
      : 'Below freezing; surface water would be permanently locked as ice.' });

  // Gravity — tolerance band around 1 g
  const gr = (b.gravity ?? 0) / 9.82;
  const gs = Math.max(0, 1 - Math.abs(Math.log(Math.max(gr, 0.01))) / 1.4);
  F.push({ name: 'Gravity', score: gs, value: `${(b.gravity ?? 0).toFixed(2)} m/s² (${gr.toFixed(2)}×)`,
    why: gs > 0.8 ? 'Close enough to Earth for indefinite human tolerance.'
      : gr > 1 ? 'High enough to cause chronic cardiovascular and skeletal strain.'
      : 'Low enough that bone and muscle loss become long-term problems.' });

  // Atmosphere
  const atm = b.atmosphere || 'None';
  const as = atm === 'None' ? 0 : hasFreeOxygen(atm) ? 1
    : atm.includes('CO₂') ? 0.20 : atm.includes('H₂') ? 0.05
    : atm.includes('N₂') ? 0.55 : 0.3;
  F.push({ name: 'Atmosphere', score: as, value: atm,
    why: as === 1 ? 'Free molecular oxygen present — directly breathable.'
      : as === 0 ? 'No atmosphere at all.'
      : 'Present but not breathable; a sealed supply would be required.' });

  // Water potential
  const ws = b.type === 'Ocean' ? 1 : b.type === 'Terrestrial' ? 0.85
    : b.type === 'Ice' ? 0.45 : b.type === 'Desert' ? 0.25
    : b.type.includes('giant') ? 0.1 : 0.15;
  F.push({ name: 'Water potential', score: ws, value: b.type,
    why: ws > 0.8 ? 'Surface classification indicates a substantial hydrosphere.'
      : ws > 0.4 ? 'Water present, but frozen or subsurface.'
      : 'Little indication of accessible water.' });

  // Habitable zone position
  let hs = 0, hv = 'No host star';
  if (b.star) {
    const hz = Physics.habitableZone(b.star.luminosity);
    const d = b.distanceM;
    const mid = (hz.inner + hz.outer) / 2, half = (hz.outer - hz.inner) / 2;
    hs = Math.max(0, 1 - Math.abs(d - mid) / (half * 2.2));
    hv = d < hz.inner ? `${((hz.inner - d) / AU).toFixed(3)} AU inside the zone`
      : d > hz.outer ? `${((d - hz.outer) / AU).toFixed(3)} AU beyond the zone`
      : 'Within the zone';
  }
  F.push({ name: 'Habitable zone', score: hs, value: hv,
    why: hs > 0.8 ? 'Sits near the centre of the conservative habitable zone.'
      : hs > 0.3 ? 'Near the edge of the zone; climate stability is marginal.'
      : 'Well outside the range where surface liquid water is expected.' });

  // Host star suitability
  let ss = 0.5, sv = '—';
  if (b.star) {
    const cls = b.star.spectralClass;
    ss = { G: 1, K: 0.9, F: 0.75, M: 0.45, A: 0.3, B: 0.1, O: 0.05 }[cls] ?? 0.4;
    sv = `${b.star.spectral}, ${b.star.age.toFixed(1)} Gyr`;
  }
  F.push({ name: 'Host star', score: ss, value: sv,
    why: ss > 0.85 ? 'Stable, long-lived star with a steady energy output.'
      : ss > 0.5 ? 'Workable host, with some long-term stability concerns.'
      : 'Poor host — either too short-lived or too variable for stable conditions.' });

  const W = [0.24, 0.14, 0.22, 0.16, 0.16, 0.08];
  const total = F.reduce((s, f, i) => s + f.score * W[i], 0);
  const pct = Math.round(total * 100);

  return {
    factors: F, weights: W, score: total, percent: pct,
    esi: b.esi,
    priority: pct >= 75 ? 'Very high' : pct >= 55 ? 'High' : pct >= 35 ? 'Moderate' : 'Low',
    tone: pct >= 70 ? 'good' : pct >= 40 ? 'warn' : 'bad',
  };
}

/* ============================================================
   WHAT-IF UNIVERSE (§4)
   Each experiment returns computed consequences.
   ============================================================ */
export const EXPERIMENTS = [
  {
    id: 'gravity2x', title: 'What if gravity doubled?',
    blurb: 'Double the surface gravity and hold radius fixed. Mass, escape velocity, atmosphere and orbits all follow.',
    param: { label: 'Gravity multiplier', min: 0.1, max: 5, step: 0.1, def: 2, unit: '×' },
    run(b, k) {
      const g0 = b.gravity ?? 9.82, g1 = g0 * k;
      const m1 = b.massE * k;                                   // R fixed → M ∝ g
      const ve0 = b.escapeVel, ve1 = ve0 * Math.sqrt(k);
      const H0 = 8500, H1 = H0 / k;                             // scale height ∝ 1/g
      const weight = 70 * k;
      const jump0 = 0.5, jump1 = jump0 / k;
      const orbV = Math.sqrt(g1 * (b.radiusM ?? EARTH_RADIUS)) / 1000;
      return {
        rows: [
          ['Surface gravity', `${g0.toFixed(2)} m/s²`, `${g1.toFixed(2)} m/s²`],
          ['Planet mass', `${b.massE.toFixed(3)} M⊕`, `${m1.toFixed(3)} M⊕`],
          ['Escape velocity', `${ve0.toFixed(2)} km/s`, `${ve1.toFixed(2)} km/s`],
          ['Your weight (70 kg)', '70 kgf', `${weight.toFixed(0)} kgf`],
          ['Standing jump height', `${(jump0 * 100).toFixed(0)} cm`, `${(jump1 * 100).toFixed(0)} cm`],
          ['Atmospheric scale height', `${(H0 / 1000).toFixed(1)} km`, `${(H1 / 1000).toFixed(1)} km`],
          ['Low-orbit velocity', `${(Math.sqrt(g0 * (b.radiusM ?? EARTH_RADIUS)) / 1000).toFixed(2)} km/s`, `${orbV.toFixed(2)} km/s`],
        ],
        consequences: [
          k > 1
            ? `Your body would carry ${((k - 1) * 100).toFixed(0)}% more load. Above about 1.5×, the heart cannot sustain cerebral perfusion while standing — chronic exposure would be disabling.`
            : `At ${k.toFixed(1)}× gravity, bone density and muscle mass decline over months, as seen in long-duration spaceflight.`,
          `The atmosphere compresses. Scale height falls to ${(H1 / 1000).toFixed(1)} km, so surface pressure rises and the sky becomes ${k > 1 ? 'thicker and hazier near the ground' : 'thinner and the horizon sharper'}.`,
          `Oceans redistribute. Tidal amplitude scales inversely with surface gravity, so tides ${k > 1 ? 'shrink' : 'grow'} by roughly ${Math.abs(1 - 1 / k) * 100 | 0}%.`,
          `Every satellite in orbit is now on the wrong trajectory. Low orbit requires ${orbV.toFixed(2)} km/s instead of ${(Math.sqrt(g0 * (b.radiusM ?? EARTH_RADIUS)) / 1000).toFixed(2)} — anything already up there ${k > 1 ? 'falls' : 'escapes'}.`,
          `Launching to orbit becomes ${k > 1 ? 'far harder' : 'far easier'}: required delta-v scales with √g, and rocket mass ratio scales exponentially with delta-v. At ${k.toFixed(1)}×, a chemical rocket ${k > 1.5 ? 'may not be able to reach orbit at all' : 'needs substantially more propellant'}.`,
        ],
        note: 'Holds radius constant and varies mass. Real planets follow a mass–radius relation, so a genuinely higher-gravity world would also be physically larger.',
      };
    },
  },

  {
    id: 'stoprotation', title: 'What if rotation stopped?',
    blurb: 'Halt the spin and watch the day, the winds, the magnetic field and the oceans respond.',
    param: { label: 'Rotation rate', min: 0, max: 3, step: 0.1, def: 0, unit: '×' },
    run(b, k) {
      const h0 = Math.abs(b.rotationHours ?? 24), h1 = k === 0 ? Infinity : h0 / k;
      const R = b.radiusM ?? EARTH_RADIUS;
      const v0 = (2 * Math.PI * R) / (h0 * 3600), v1 = k === 0 ? 0 : v0 * k;
      const flat0 = (v0 ** 2) / ((b.gravity ?? 9.82) * R);
      const flat1 = k === 0 ? 0 : (v1 ** 2) / ((b.gravity ?? 9.82) * R);
      return {
        rows: [
          ['Day length', `${h0.toFixed(1)} h`, k === 0 ? 'Permanent (1 year)' : `${h1.toFixed(1)} h`],
          ['Equatorial surface speed', `${v0.toFixed(0)} m/s`, `${v1.toFixed(0)} m/s`],
          ['Rotational flattening', flat0.toExponential(2), k === 0 ? '0' : flat1.toExponential(2)],
          ['Coriolis parameter', 'Normal', k === 0 ? 'Zero' : `${k.toFixed(1)}×`],
        ],
        consequences: [
          k === 0
            ? `Day and night each last half a year. The sunlit hemisphere bakes while the dark side freezes — a temperature contrast of hundreds of kelvin drives permanent hurricane-force winds across the terminator.`
            : `A day now lasts ${h1.toFixed(1)} hours. ${k > 1 ? 'Faster spin strengthens Coriolis deflection, producing more, narrower circulation cells.' : 'Slower spin weakens Coriolis deflection, merging the circulation into fewer, broader cells.'}`,
          k === 0
            ? `The equatorial bulge relaxes. Earth's equator currently sits about 21 km further from the centre than the poles; removing rotation lets that water flow poleward, forming two polar oceans and exposing an equatorial continent.`
            : `Equatorial bulge changes by a factor of ${(flat1 / (flat0 || 1)).toFixed(2)}.`,
          k === 0
            ? `The magnetic dynamo fails. Convection in the liquid core is organised by rotation; without it the field collapses over geological time and the atmosphere is progressively stripped by the stellar wind.`
            : `Dynamo strength scales roughly with rotation rate — the magnetic field ${k > 1 ? 'strengthens' : 'weakens'}.`,
          `Weather systems ${k === 0 ? 'no longer rotate at all — no cyclones, no jet streams, only direct day-to-night flow' : k > 1 ? 'become tighter and more numerous' : 'become sluggish and continent-scale'}.`,
        ],
        note: 'Ocean redistribution and dynamo response are qualitative model results, not closed-form calculations.',
      };
    },
  },

  {
    id: 'nomoon', title: 'What if the Moon disappeared?',
    blurb: 'Remove the largest satellite and trace the effect on tides, axial stability and day length.',
    param: { label: 'Moon mass', min: 0, max: 2, step: 0.1, def: 0, unit: '×' },
    run(b, k) {
      const mMoon = 7.342e22 * k, aMoon = 3.844e8;
      const mSun = SOLAR_MASS, aSun = AU;
      const tideM = (mMoon / aMoon ** 3), tideS = (mSun / aSun ** 3);
      const ratio = tideS ? tideM / tideS : 0;
      const total = k === 0 ? 1 : (tideM + tideS) / (7.342e22 / aMoon ** 3 + tideS);
      return {
        rows: [
          ['Lunar tidal force', '1.00 (reference)', `${(tideM / (7.342e22 / aMoon ** 3)).toFixed(2)}`],
          ['Lunar : solar tide ratio', '2.21 : 1', k === 0 ? '0 : 1' : `${ratio.toFixed(2)} : 1`],
          ['Peak tidal range', '~12 m (Fundy)', k === 0 ? '~3.7 m' : `~${(12 * total).toFixed(1)} m`],
          ['Axial tilt stability', 'Stabilised', k === 0 ? 'Chaotic over ~Myr' : k < 0.5 ? 'Weakly stabilised' : 'Stabilised'],
          ['Day lengthening', '+1.8 ms/century', k === 0 ? 'Halted' : `+${(1.8 * k).toFixed(1)} ms/century`],
        ],
        consequences: [
          k === 0
            ? `Tides fall to about a third of their current range — the Sun still raises them, but weakly. Intertidal ecosystems, which depend on regular exposure, would largely collapse.`
            : `Tidal range scales with the satellite's mass over distance cubed. At ${k.toFixed(1)}× lunar mass, tides run about ${(total * 100).toFixed(0)}% of present.`,
          k === 0
            ? `Axial tilt destabilises. The Moon currently damps Earth's obliquity to within about ±1.3°; without it, simulations show chaotic wandering between roughly 0° and 85° over millions of years. Climate zones would migrate catastrophically.`
            : `Obliquity damping ${k > 1 ? 'strengthens' : 'weakens'}, ${k > 1 ? 'locking the tilt more tightly' : 'permitting wider excursions'}.`,
          k === 0
            ? `The day stops lengthening. Tidal friction currently transfers angular momentum from Earth's spin to the lunar orbit, adding about 1.8 ms per century. Remove the Moon and that transfer ends.`
            : `Angular momentum transfer scales with the tide, so day lengthening runs at about ${(1.8 * k).toFixed(1)} ms per century.`,
          `Nights become ${k === 0 ? 'genuinely dark — the brightest natural night-time object would be Venus' : `${(k * 100).toFixed(0)}% as bright as now at full phase`}.`,
        ],
        note: 'Obliquity chaos is drawn from published N-body results (Laskar et al.), not simulated here.',
      };
    },
  },

  {
    id: 'closer', title: 'What if this world moved closer to its star?',
    blurb: 'Change the orbital radius and follow insolation, temperature, year length and the runaway greenhouse threshold.',
    param: { label: 'Orbital radius', min: 0.15, max: 3, step: 0.05, def: 0.7, unit: '×' },
    run(b, k) {
      const a0 = b.distanceM ?? AU, a1 = a0 * k;
      const L = (b.star?.luminosity ?? 1) * 3.828e26;
      const T0 = Physics.equilibriumTemp(L, a0, 0.3), T1 = Physics.equilibriumTemp(L, a1, 0.3);
      const insol = 1 / (k * k);
      const M = (b.star?.mass ?? 1) * SOLAR_MASS;
      const P0 = Physics.period(a0, M) / 86400, P1 = Physics.period(a1, M) / 86400;
      const hz = Physics.habitableZone(b.star?.luminosity ?? 1);
      const inside = a1 < hz.inner;
      const greenhouse = (b.temp ?? 288) - T0;
      const Tsurf = T1 + greenhouse;
      return {
        rows: [
          ['Orbital radius', `${(a0 / AU).toFixed(3)} AU`, `${(a1 / AU).toFixed(3)} AU`],
          ['Insolation', '1.00×', `${insol.toFixed(2)}×`],
          ['Equilibrium temperature', `${T0.toFixed(0)} K`, `${T1.toFixed(0)} K`],
          ['Estimated surface temperature', `${(b.temp ?? 288)} K`, `${Tsurf.toFixed(0)} K`],
          ['Year length', `${P0.toFixed(1)} d`, `${P1.toFixed(1)} d`],
          ['Habitable zone', 'Reference', inside ? 'Inside inner edge' : a1 > hz.outer ? 'Beyond outer edge' : 'Within zone'],
        ],
        consequences: [
          `Insolation follows the inverse square law exactly: at ${k.toFixed(2)}× the distance, the world receives ${insol.toFixed(2)}× the energy.`,
          Tsurf > 373
            ? `Surface temperature reaches ${Tsurf.toFixed(0)} K — above the boiling point of water. Oceans evaporate, and water vapour is itself a powerful greenhouse gas, so the warming accelerates. This is the runaway greenhouse, and it is what happened to Venus.`
            : Tsurf < 273
            ? `Surface temperature falls to ${Tsurf.toFixed(0)} K. Water freezes, raising albedo, which reflects more light and cools it further — the runaway glaciation feedback.`
            : `Surface temperature settles near ${Tsurf.toFixed(0)} K, still within the liquid water range.`,
          `The year shortens to ${P1.toFixed(1)} days by Kepler's third law, P ∝ a^{3/2}.`,
          k < 0.4 ? `At this distance tidal locking becomes likely within a few hundred million years, giving permanent day and night hemispheres.` : `Tidal locking timescales remain long at this separation.`,
        ],
        note: 'Greenhouse offset is held fixed at the planet\'s current value. A real atmosphere would respond nonlinearly — this understates the runaway.',
      };
    },
  },

  {
    id: 'atm2x', title: 'What if the atmosphere doubled in density?',
    blurb: 'Scale atmospheric mass and follow pressure, greenhouse forcing, drag and sky colour.',
    param: { label: 'Atmospheric mass', min: 0.1, max: 10, step: 0.1, def: 2, unit: '×' },
    run(b, k) {
      const P0 = 101325, P1 = P0 * k;
      const dT = 33 * Math.log2(Math.max(k, 0.01)) * 0.6;   // log forcing, damped
      const T1 = (b.temp ?? 288) + dT;
      const boil = 373.15 + 28 * Math.log2(Math.max(k, 0.01));
      return {
        rows: [
          ['Surface pressure', `${(P0 / 1000).toFixed(1)} kPa`, `${(P1 / 1000).toFixed(1)} kPa`],
          ['Pressure in atmospheres', '1.00 atm', `${k.toFixed(2)} atm`],
          ['Greenhouse shift', '—', `${dT >= 0 ? '+' : ''}${dT.toFixed(1)} K`],
          ['Surface temperature', `${b.temp ?? 288} K`, `${T1.toFixed(0)} K`],
          ['Boiling point of water', '373 K', `${boil.toFixed(0)} K`],
          ['Aerodynamic drag', '1.00×', `${k.toFixed(2)}×`],
        ],
        consequences: [
          k > 1
            ? `Breathing becomes harder work — at ${k.toFixed(1)} atm, nitrogen narcosis sets in for humans somewhere around 4 atm, and oxygen becomes toxic above roughly 1.6 atm partial pressure.`
            : `At ${k.toFixed(1)} atm, partial pressure of oxygen falls below what unacclimatised humans can use. Above about 0.5 atm total, supplementary oxygen becomes necessary.`,
          `Greenhouse forcing is logarithmic in column mass, not linear, so doubling the atmosphere adds roughly ${dT.toFixed(1)} K rather than doubling the current 33 K greenhouse effect.`,
          `Water boils at ${boil.toFixed(0)} K instead of 373 K — higher pressure raises the boiling point, which is why liquid water can persist at temperatures that would flash to steam at 1 atm.`,
          `Drag scales linearly with density. Flight becomes ${k > 1 ? 'far easier — wings generate more lift at lower speed, and large flying animals become viable' : 'much harder; powered flight would require far higher speeds'}.`,
          `The sky ${k > 1 ? 'deepens in colour and the horizon hazes over, as Rayleigh scattering accumulates over a longer optical path' : 'darkens toward black and the stars become visible in daylight'}.`,
        ],
        note: 'Greenhouse response uses a logarithmic forcing approximation calibrated to Earth\'s 33 K effect.',
      };
    },
  },

  {
    id: 'supernova', title: 'What happens when a star goes supernova?',
    blurb: 'Set a progenitor mass and follow the collapse, the energy release, the remnant and the danger radius.',
    param: { label: 'Progenitor mass', min: 0.5, max: 60, step: 0.5, def: 20, unit: ' M☉' },
    run(b, k) {
      const willGo = k >= 8;
      const E = 1e44 * (k / 20);                       // ~10^44 J kinetic
      const Enu = E * 100;                             // ~99% escapes as neutrinos
      const remnant = k < 8 ? 'White dwarf (no supernova)'
        : k < 20 ? 'Neutron star (~1.4 M☉, ~20 km diameter)'
        : k < 40 ? 'Neutron star or black hole, depending on fallback'
        : 'Black hole';
      const life = 10 * Math.pow(k, -2.5) * 1000;      // Myr
      const peakL = 1e10;                              // ~10^10 L☉ at peak
      const dangerLy = 50 * Math.sqrt(k / 20);
      return {
        rows: [
          ['Progenitor mass', '—', `${k.toFixed(1)} M☉`],
          ['Main-sequence lifetime', '—', life > 1000 ? `${(life / 1000).toFixed(2)} Gyr` : `${life.toFixed(0)} Myr`],
          ['Fate', '—', willGo ? 'Core-collapse supernova' : 'Planetary nebula, no explosion'],
          ['Kinetic energy released', '—', willGo ? `${E.toExponential(2)} J` : '—'],
          ['Neutrino energy', '—', willGo ? `${Enu.toExponential(2)} J` : '—'],
          ['Peak luminosity', '—', willGo ? `~${peakL.toExponential(0)} L☉` : '—'],
          ['Remnant', '—', remnant],
          ['Sterilising radius', '—', willGo ? `~${dangerLy.toFixed(0)} ly` : '—'],
        ],
        consequences: willGo ? [
          `Above 8 M☉ the core fuses all the way to iron. Iron fusion consumes energy rather than releasing it, so the pressure support vanishes and the core collapses in under a second.`,
          `Collapse halts when the core reaches nuclear density. The infalling envelope rebounds off it, and a shock — reinforced by the escaping neutrino flux — unbinds the star.`,
          `Around 99% of the energy leaves as neutrinos: ${Enu.toExponential(2)} J against ${E.toExponential(2)} J of kinetic energy. For a few seconds the star outshines its entire galaxy in neutrinos alone.`,
          `Peak optical output reaches roughly 10¹⁰ L☉ — comparable to a small galaxy — then fades over months as radioactive nickel-56 decays to cobalt and then iron.`,
          `Every element heavier than iron in the universe was made in events like this, or in neutron star mergers. The calcium in your bones and the iron in your blood were assembled in a star that died before the Sun formed.`,
          `A supernova within about ${dangerLy.toFixed(0)} light years would strip a planet's ozone layer with gamma and cosmic rays. No star currently within that distance of Earth is a candidate.`,
        ] : [
          `At ${k.toFixed(1)} M☉ this star never reaches the 8 M☉ threshold for core collapse.`,
          `It will instead swell into a red giant, shed its outer layers as a planetary nebula, and leave a white dwarf behind — a carbon–oxygen core about the size of Earth holding most of the original mass.`,
          `Electron degeneracy pressure supports the remnant indefinitely, provided it stays below the Chandrasekhar limit of 1.44 M☉.`,
          `It will then cool for longer than the current age of the universe.`,
        ],
        note: 'Energies are order-of-magnitude figures for a canonical core-collapse event.',
      };
    },
  },

  {
    id: 'tidal', title: 'What if you approached a black hole?',
    blurb: 'Set a distance from the event horizon and compute tidal stretching and time dilation.',
    param: { label: 'Distance', min: 1.01, max: 50, step: 0.5, def: 5, unit: ' rₛ' },
    run(b, k) {
      const M = (b.kind === 'blackhole' ? b.massSolar : 10) * SOLAR_MASS;
      const rs = Physics.schwarzschildRadius(M);
      const r = rs * k;
      const tidal = Physics.tidalAccel(M, r, 1.8);       // across a 1.8 m human
      const dil = Physics.timeDilation(M, r);
      const gees = tidal / 9.82;
      return {
        rows: [
          ['Black hole mass', '—', `${(M / SOLAR_MASS).toExponential(2)} M☉`],
          ['Schwarzschild radius', '—', rs > AU ? `${(rs / AU).toFixed(4)} AU` : `${(rs / 1000).toFixed(1)} km`],
          ['Your distance', '—', `${k.toFixed(2)} rₛ`],
          ['Tidal stretch across 1.8 m', '—', `${gees.toExponential(2)} g`],
          ['Time dilation factor', '1.0000', dil.toFixed(6)],
          ['1 hour here equals', '1 hour', dil > 0 ? `${(1 / dil).toFixed(3)} hours far away` : '∞'],
        ],
        consequences: [
          gees > 10
            ? `Tidal force across your body reaches ${gees.toExponential(2)} g. You are pulled apart lengthwise and compressed sideways — spaghettification. This is lethal well before the horizon.`
            : `Tidal force across your body is ${gees.toExponential(2)} g — survivable. Counter-intuitively, larger black holes are gentler at the horizon, because tidal force scales as M/r³ while the horizon itself scales as M.`,
          `Time runs at ${dil.toFixed(4)} of its distant rate. An hour spent here corresponds to ${dil > 0 ? (1 / dil).toFixed(2) : '∞'} hours for someone watching from far away.`,
          k < 1.5
            ? `You are inside the photon sphere at 1.5 rₛ. Light itself orbits here — looking forward, you would see the back of your own head.`
            : `At ${k.toFixed(1)} rₛ you are outside the photon sphere. Background stars are visibly displaced by gravitational lensing.`,
          k < 3
            ? `Below 3 rₛ there is no stable circular orbit. Anything here spirals inward regardless of its velocity.`
            : `Stable circular orbits exist out here; the innermost is at 3 rₛ for a non-rotating hole.`,
        ],
        note: 'Schwarzschild metric, non-rotating. A spinning Kerr hole moves the ISCO inward and changes the horizon structure.',
      };
    },
  },
];

/* ============================================================
   RESEARCH LAB WORKFLOW (§3)
   Scan → Analyse → Compare → Hypothesise → Report
   ============================================================ */
export const LAB_STAGES = [
  { id: 'scan', label: 'Scan', desc: 'Collect raw measurements from the target.' },
  { id: 'analyse', label: 'Analyse', desc: 'Derive secondary quantities and habitability factors.' },
  { id: 'compare', label: 'Compare', desc: 'Position the target against Earth and the surveyed population.' },
  { id: 'hypothesise', label: 'Hypothesise', desc: 'Form an interpretation from the anomalies found.' },
  { id: 'report', label: 'Report', desc: 'Generate the research document.' },
];

export function scanData(b) {
  return [
    { k: 'Radius', v: `${b.radiusE.toFixed(4)} R⊕`, raw: b.radiusE },
    { k: 'Mass', v: `${b.massE.toFixed(4)} M⊕`, raw: b.massE },
    { k: 'Bulk density', v: `${(b.massE / b.radiusE ** 3).toFixed(4)} ρ⊕`, raw: b.massE / b.radiusE ** 3 },
    { k: 'Surface gravity', v: `${b.gravity.toFixed(3)} m/s²`, raw: b.gravity },
    { k: 'Escape velocity', v: `${b.escapeVel.toFixed(3)} km/s`, raw: b.escapeVel },
    { k: 'Equilibrium temperature', v: `${b.temp} K`, raw: b.temp },
    { k: 'Atmosphere', v: b.atmosphere, raw: null },
    { k: 'Semi-major axis', v: `${b.distanceAU.toFixed(4)} AU`, raw: b.distanceAU },
    { k: 'Eccentricity', v: b.orbit.e.toFixed(4), raw: b.orbit.e },
    { k: 'Orbital period', v: `${b.orbitalPeriodDays.toFixed(3)} d`, raw: b.orbitalPeriodDays },
    { k: 'Rotation period', v: `${Math.abs(b.rotationHours).toFixed(3)} h${b.rotationHours < 0 ? ' retrograde' : ''}`, raw: b.rotationHours },
    { k: 'Axial tilt', v: `${b.axialTilt.toFixed(2)}°`, raw: b.axialTilt },
    { k: 'Satellites', v: String(b.moonCount), raw: b.moonCount },
    { k: 'Composition', v: b.composition, raw: null },
  ];
}

export function buildReport(b, hab, anomalies, uni) {
  const d = new Date().toISOString().slice(0, 10);
  const hz = b.star ? Physics.habitableZone(b.star.luminosity) : null;
  const inHZ = hz && b.distanceM > hz.inner && b.distanceM < hz.outer;
  const dens = b.massE / b.radiusE ** 3;

  const findings = [];
  if (hab.percent >= 55) findings.push(`Composite habitability score of ${hab.percent}% places this world in the high-priority category for follow-up observation.`);
  else findings.push(`Composite habitability score of ${hab.percent}% indicates limited prospects for surface habitability as modelled.`);
  if (inHZ) findings.push(`The orbit falls within the conservative habitable zone (${(hz.inner / AU).toFixed(3)}–${(hz.outer / AU).toFixed(3)} AU), so incident stellar flux is compatible with surface liquid water.`);
  else findings.push(`The orbit lies ${b.distanceM < hz.inner ? 'interior to' : 'exterior to'} the conservative habitable zone, constraining surface liquid water without an unusual atmosphere.`);
  findings.push(`Bulk density of ${dens.toFixed(3)} ρ⊕ implies ${dens > 1.3 ? 'an enlarged metallic core relative to Earth' : dens < 0.7 ? 'a significant volatile or gaseous fraction' : 'an internal structure broadly comparable to Earth'}.`);
  const weakest = hab.factors.reduce((a, c) => (c.score < a.score ? c : a));
  findings.push(`The binding constraint on habitability is ${weakest.name.toLowerCase()} (${(weakest.score * 100).toFixed(0)}%): ${weakest.why}`);

  const recs = [];
  if (hab.percent >= 55) recs.push('Prioritise for transit spectroscopy to characterise atmospheric composition directly.');
  if (b.orbit.e > 0.15) recs.push('Model the seasonal insolation cycle; the eccentricity here makes distance, not obliquity, the dominant driver.');
  if (b.star?.spectralClass === 'M') recs.push('Assess stellar flare frequency. M-dwarf activity is the principal threat to atmospheric retention on close-in worlds.');
  if (b.moonCount > 0) recs.push('Evaluate satellite-induced obliquity damping as a climate stability factor.');
  if (Math.abs(b.rotationHours) > 200) recs.push('Test for tidal locking; a synchronised rotation would restructure the entire climate model.');
  recs.push('Repeat the measurement at a second orbital phase to constrain the orbital solution.');

  return {
    title: `Research Report — ${b.name}`,
    meta: [
      ['Object', b.name], ['Classification', b.type],
      ['Host star', b.star?.name ?? '—'], ['Spectral type', b.star?.spectral ?? '—'],
      ['Data provenance', b.real ? 'Observed' : 'Procedurally generated'],
      ['Report date', d],
    ],
    overview: `${b.name} is a ${b.type.toLowerCase()} world orbiting ${b.star?.name ?? 'its host star'} at ${b.distanceAU.toFixed(4)} AU with a period of ${b.orbitalPeriodDays.toFixed(2)} days. It has a radius of ${b.radiusE.toFixed(3)} Earth radii and a mass of ${b.massE.toFixed(3)} Earth masses, giving a surface gravity of ${b.gravity.toFixed(2)} m/s². The modelled equilibrium temperature is ${b.temp} K under ${b.atmosphere === 'None' ? 'no atmosphere' : `a ${b.atmosphere} atmosphere`}.`,
    observations: scanData(b),
    habitability: hab,
    anomalies,
    findings,
    interpretation: `Taken together, the measurements describe ${hab.percent >= 55 ? 'a world of genuine astrobiological interest' : hab.percent >= 30 ? 'a world of moderate interest, limited by specific factors' : 'a world unlikely to support surface life as currently modelled'}. ${anomalies[0].label !== 'Unremarkable' ? `The most notable feature is ${anomalies[0].label.toLowerCase()}: ${anomalies[0].text}` : 'No parameter deviates significantly from the surveyed population.'} Earth Similarity Index stands at ${b.esi.toFixed(3)}.`,
    recommendations: recs,
    caveat: 'This assessment is an educational simulation. Scores are derived from a simplified physical model and are not a prediction of actual habitability. Real habitability assessment requires atmospheric spectroscopy, geological history, and magnetic field measurements that this simulation does not attempt.',
  };
}

/* ============================================================
   PROGRESSION (§5)
   ============================================================ */
export const ACHIEVEMENTS = [
  { id: 'solar', icon: '🚀', name: 'Solar Explorer', desc: 'Visit every planet in the Solar System', need: 8, track: 'solPlanets' },
  { id: 'galaxy', icon: '🌌', name: 'Galaxy Explorer', desc: 'Reach a second galaxy', need: 2, track: 'galaxies' },
  { id: 'exo', icon: '🔭', name: 'Exoplanet Hunter', desc: 'Log 15 worlds outside the Solar System', need: 15, track: 'exoplanets' },
  { id: 'bh', icon: '🕳', name: 'Black Hole Specialist', desc: 'Investigate 3 black holes', need: 3, track: 'blackholes' },
  { id: 'astro', icon: '🧪', name: 'Astrobiology Researcher', desc: 'Complete 5 research reports', need: 5, track: 'reports' },
  { id: 'spectra', icon: '⭐', name: 'Spectroscopist', desc: 'Observe all 7 spectral classes', need: 7, track: 'spectral' },
  { id: 'experimenter', icon: '⚗️', name: 'Experimentalist', desc: 'Run 6 What-If experiments', need: 6, track: 'experiments' },
  { id: 'cartographer', icon: '🗺', name: 'Cartographer', desc: 'Log 40 objects of any kind', need: 40, track: 'logged' },
];

export const XP = {
  discover: 10, planetLog: 15, missionStep: 25, missionDone: 120,
  report: 80, experiment: 40, anomaly: 20, newSystem: 30, newGalaxy: 200,
};

export function levelFor(xp) {
  // Each level costs progressively more: L = floor(sqrt(xp / 45)) + 1
  const lvl = Math.floor(Math.sqrt(xp / 45)) + 1;
  const cur = 45 * (lvl - 1) ** 2, next = 45 * lvl ** 2;
  return { level: lvl, cur, next, into: xp - cur, span: next - cur,
    pct: Math.min(100, ((xp - cur) / (next - cur)) * 100), title: levelTitle(lvl) };
}

function levelTitle(l) {
  const T = ['Cadet', 'Observer', 'Navigator', 'Surveyor', 'Analyst', 'Researcher',
    'Astrogator', 'Senior Researcher', 'Principal Investigator', 'Chief Scientist'];
  return T[Math.min(l - 1, T.length - 1)];
}

/* ============================================================
   STORYTELLING MODE (§6)
   Human → Earth → Moon → Solar System → Milky Way → Local Group → Deep Universe
   ============================================================ */
export const STORY = [
  { id: 'human', scale: '1 metre', title: 'You',
    text: 'Start here. Every atom heavier than hydrogen in your body was manufactured inside a star and scattered when it died. You are, quite literally, assembled from the wreckage of earlier suns.',
    target: { type: 'planet', name: 'Earth' }, dist: 2.4, dwell: 9 },

  { id: 'earth', scale: '12,742 km', title: 'Earth',
    text: 'Our home planet, and the only body known to host life. A thin shell of nitrogen and oxygen, a magnetic field, and liquid water at the surface — the combination appears to be rare.',
    target: { type: 'planet', name: 'Earth' }, dist: 6, dwell: 9 },

  { id: 'moon', scale: '384,400 km', title: 'The Moon',
    text: 'Our satellite stabilises Earth\'s axial tilt to within about a degree. Without it, the tilt would wander chaotically and the climate with it. It recedes from us by 3.8 cm each year.',
    target: { type: 'planet', name: 'Earth' }, dist: 24, dwell: 9 },

  { id: 'system', scale: '30 AU', title: 'The Solar System',
    text: 'Eight planets, hundreds of moons, and millions of smaller bodies orbiting one ordinary star. The Sun holds 99.86% of the mass here; everything else is a rounding error.',
    target: { type: 'system' }, dist: 300, dwell: 10 },

  { id: 'stars', scale: '100 light years', title: 'The Neighbourhood',
    text: 'Sunlight takes eight minutes to reach Earth. It takes four years to reach the nearest other star. The space between stars is overwhelmingly, almost incomprehensibly empty.',
    target: { type: 'stellar' }, dist: 1400, dwell: 9 },

  { id: 'galaxy', scale: '105,700 light years', title: 'The Milky Way',
    text: 'A barred spiral galaxy holding a few hundred billion stars. We sit about 26,000 light years from the centre, in a minor arm, and take 230 million years to complete one orbit.',
    target: { type: 'galaxy' }, dist: 2600, dwell: 10 },

  { id: 'group', scale: '10 million light years', title: 'The Local Group',
    text: 'The Milky Way is one of roughly eighty galaxies bound together by gravity. Andromeda approaches at 110 km/s and will merge with us in about 4.5 billion years.',
    target: { type: 'cosmic' }, dist: 4200, dwell: 9 },

  { id: 'universe', scale: '93 billion light years', title: 'The Observable Universe',
    text: 'Beyond the Local Group, galaxies recede in every direction — not moving through space, but carried by space expanding between them. Everything here came from one seed and one set of physical laws. So did you.',
    target: { type: 'cosmic' }, dist: 9000, dwell: 11 },
];
