/* ============================================================
   AETHER — Interactive Universe Simulator
   engine.js : universe generation, physics, scale management
   ============================================================
   Module boundaries (see ARCHITECTURE.md):
     RNG        deterministic seeded noise
     Universe   procedural galaxy/system/body generation
     Physics    Keplerian orbits, rotation, time dilation of sim clock
     ScaleMgr   floating-origin + LOD tier management
   ============================================================ */

/* ---------- Deterministic seeded RNG (mulberry32) ---------- */
export class RNG {
  constructor(seed) { this.s = seed >>> 0; }
  next() {
    this.s = (this.s + 0x6D2B79F5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + this.next() * (b - a); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[this.int(0, arr.length - 1)]; }
  gauss(mean, sd) {
    const u = 1 - this.next(), v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

/* ---------- Astronomical constants (SI unless noted) ---------- */
export const AU = 1.495978707e11;
export const LY = 9.4607e15;
export const PC = 3.0857e16;
export const SOLAR_MASS = 1.98847e30;
export const SOLAR_RADIUS = 6.957e8;
export const EARTH_MASS = 5.9722e24;
export const EARTH_RADIUS = 6.371e6;
export const G = 6.67430e-11;
export const C = 2.99792458e8;

/* ---------- Stellar classification table ---------- */
const SPECTRAL = [
  { c: 'O', tMin: 30000, tMax: 50000, mMin: 16, mMax: 90, col: 0x9bb0ff, w: 0.00003 },
  { c: 'B', tMin: 10000, tMax: 30000, mMin: 2.1, mMax: 16, col: 0xaabfff, w: 0.0013 },
  { c: 'A', tMin: 7500, tMax: 10000, mMin: 1.4, mMax: 2.1, col: 0xcad7ff, w: 0.006 },
  { c: 'F', tMin: 6000, tMax: 7500, mMin: 1.04, mMax: 1.4, col: 0xf8f7ff, w: 0.03 },
  { c: 'G', tMin: 5200, tMax: 6000, mMin: 0.8, mMax: 1.04, col: 0xfff4ea, w: 0.076 },
  { c: 'K', tMin: 3700, tMax: 5200, mMin: 0.45, mMax: 0.8, col: 0xffd2a1, w: 0.121 },
  { c: 'M', tMin: 2400, tMax: 3700, mMin: 0.08, mMax: 0.45, col: 0xffcc6f, w: 0.765 },
];

function pickSpectral(rng) {
  let r = rng.next(), acc = 0;
  const total = SPECTRAL.reduce((s, x) => s + x.w, 0);
  for (const s of SPECTRAL) { acc += s.w / total; if (r <= acc) return s; }
  return SPECTRAL[SPECTRAL.length - 1];
}

/* ---------- Planet archetypes ---------- */
const PLANET_TYPES = [
  { type: 'Molten',      mMin: 0.1,  mMax: 3,   atm: ['None', 'Trace silicate vapour'],           col: 0xd9532b },
  { type: 'Barren rock', mMin: 0.02, mMax: 2,   atm: ['None', 'Trace CO₂'],                       col: 0x8a8577 },
  { type: 'Terrestrial', mMin: 0.3,  mMax: 4,   atm: ['N₂–O₂', 'CO₂–N₂', 'N₂–CH₄'],               col: 0x4a7c9b },
  { type: 'Ocean',       mMin: 0.5,  mMax: 6,   atm: ['N₂–H₂O', 'CO₂–H₂O'],                       col: 0x1f5f8b },
  { type: 'Desert',      mMin: 0.2,  mMax: 3,   atm: ['CO₂', 'N₂–CO₂'],                           col: 0xc09256 },
  { type: 'Ice',         mMin: 0.05, mMax: 2,   atm: ['None', 'N₂', 'CH₄'],                       col: 0xc8dce8 },
  { type: 'Gas giant',   mMin: 30,   mMax: 900, atm: ['H₂–He', 'H₂–He–CH₄'],                      col: 0xd6b183 },
  { type: 'Ice giant',   mMin: 10,   mMax: 60,  atm: ['H₂–He–CH₄'],                               col: 0x6fb6c9 },
  { type: 'Sub-Neptune', mMin: 4,    mMax: 15,  atm: ['H₂–He', 'H₂O-rich'],                       col: 0x87a9b8 },
];

/* ---------- Name generation ---------- */
const GREEK = ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Iota','Kappa','Lambda','Mu','Nu','Xi','Omicron','Pi','Rho','Sigma','Tau','Upsilon','Phi','Chi','Psi','Omega'];
const CATALOG = ['HD','HIP','GJ','TYC','KIC','TOI','WASP','KELT'];
const CONSTELL = ['Andromedae','Aquilae','Aurigae','Boötis','Carinae','Cassiopeiae','Centauri','Cygni','Draconis','Eridani','Herculis','Hydrae','Leonis','Lyrae','Ophiuchi','Orionis','Pegasi','Persei','Scorpii','Serpentis','Tauri','Ursae','Velorum','Virginis'];
const NEBULA_N = ['Veil','Ember','Cinder','Lantern','Kestrel','Meridian','Halcyon','Vantage','Cradle','Threnody','Aurora','Basilisk','Corvid','Drift'];

function starName(rng) {
  return rng.next() < 0.45
    ? `${rng.pick(GREEK)} ${rng.pick(CONSTELL)}`
    : `${rng.pick(CATALOG)} ${rng.int(1000, 99999)}`;
}

/* ============================================================
   PHYSICS — orbital mechanics
   ============================================================ */
export const Physics = {
  /* Solve Kepler's equation M = E - e·sin(E) by Newton–Raphson */
  eccentricAnomaly(M, e) {
    let E = M;
    for (let i = 0; i < 6; i++) {
      const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= d;
      if (Math.abs(d) < 1e-10) break;
    }
    return E;
  },

  /* Position in orbital plane at simulation time t (seconds) */
  orbitalPosition(orbit, t) {
    const n = (2 * Math.PI) / orbit.period;          // mean motion
    const M = orbit.M0 + n * t;
    const E = this.eccentricAnomaly(M, orbit.e);
    const x = orbit.a * (Math.cos(E) - orbit.e);
    const y = orbit.a * Math.sqrt(1 - orbit.e * orbit.e) * Math.sin(E);
    // rotate by argument of periapsis, then inclination
    const cw = Math.cos(orbit.w), sw = Math.sin(orbit.w);
    const xr = x * cw - y * sw, yr = x * sw + y * cw;
    const ci = Math.cos(orbit.i), si = Math.sin(orbit.i);
    return { x: xr, y: yr * si, z: yr * ci };
  },

  /* Kepler's third law — period from semi-major axis and central mass */
  period(a, centralMass) {
    return 2 * Math.PI * Math.sqrt((a * a * a) / (G * centralMass));
  },

  surfaceGravity(massKg, radiusM) { return (G * massKg) / (radiusM * radiusM); },

  escapeVelocity(massKg, radiusM) { return Math.sqrt((2 * G * massKg) / radiusM); },

  schwarzschildRadius(massKg) { return (2 * G * massKg) / (C * C); },

  /* Equilibrium temperature, albedo-corrected, no greenhouse term */
  equilibriumTemp(luminosityW, distM, albedo = 0.3) {
    const SB = 5.670374419e-8;
    return Math.pow((luminosityW * (1 - albedo)) / (16 * Math.PI * SB * distM * distM), 0.25);
  },

  /* Conservative habitable zone (Kopparapu-style scaling, simplified) */
  habitableZone(luminositySolar) {
    return {
      inner: Math.sqrt(luminositySolar / 1.10) * AU,
      outer: Math.sqrt(luminositySolar / 0.53) * AU,
    };
  },

  /* Earth Similarity Index — radius, density, escape velocity, temperature */
  esi(radiusE, massE, tempK) {
    const dens = massE / Math.pow(radiusE, 3);
    const vesc = Math.sqrt(massE / radiusE);
    const terms = [
      [radiusE, 1, 0.57], [dens, 1, 1.07], [vesc, 1, 0.70], [tempK, 288, 5.58],
    ];
    let p = 1;
    for (const [x, ref, w] of terms) {
      p *= Math.pow(1 - Math.abs((x - ref) / (x + ref)), w / 4);
    }
    return Math.max(0, Math.min(1, p));
  },

  /* Roche limit for a rigid satellite — used for ring generation */
  rocheLimit(primaryRadius, densPrimary, densSat) {
    return primaryRadius * 1.26 * Math.pow(densPrimary / densSat, 1 / 3);
  },

  /* Tidal acceleration differential across a body */
  tidalAccel(mPrimary, dist, radius) {
    return (2 * G * mPrimary * radius) / Math.pow(dist, 3);
  },

  /* Gravitational time dilation factor near a mass (for BH readouts) */
  timeDilation(massKg, r) {
    const rs = this.schwarzschildRadius(massKg);
    return r > rs ? Math.sqrt(1 - rs / r) : 0;
  },
};

/* ============================================================
   UNIVERSE — procedural generation
   ============================================================
   Generation is lazy and deterministic: any object's full
   properties derive from (universeSeed, galaxyIdx, systemIdx, …)
   so nothing needs storing and everything is reproducible.
   ============================================================ */

export class Universe {
  constructor(seed = 20260812) {
    this.seed = seed;
    this.galaxyCache = new Map();
    this.systemCache = new Map();
    this.galaxies = this.generateGalaxyField(140);
  }

  hash(...parts) {
    let h = this.seed >>> 0;
    for (const p of parts) { h = (Math.imul(h ^ p, 2654435761) + 0x9E3779B9) >>> 0; }
    return h;
  }

  /* ---------- Galaxy field ---------- */
  generateGalaxyField(count) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const rng = new RNG(this.hash(i, 7717));
      const types = ['Spiral', 'Barred spiral', 'Elliptical', 'Irregular', 'Lenticular'];
      const wts = [0.34, 0.26, 0.22, 0.13, 0.05];
      let r = rng.next(), acc = 0, type = 'Spiral';
      for (let k = 0; k < types.length; k++) { acc += wts[k]; if (r <= acc) { type = types[k]; break; } }

      const isMW = i === 0;
      const diameterLy = isMW ? 105700 : Math.round(rng.range(3000, 240000));
      const starCount = isMW ? 2.0e11 : Math.round(rng.range(1e8, 1.2e12));
      const bhMass = isMW ? 4.297e6 : Math.round(rng.range(1e5, 6.6e9));

      // Position on a shell — distances in light years
      const dist = isMW ? 0 : rng.range(2.5e6, 1.2e10);
      const th = rng.range(0, Math.PI * 2), ph = Math.acos(rng.range(-1, 1));

      out.push({
        kind: 'galaxy', idx: i, real: isMW,
        name: isMW ? 'Milky Way' : `${rng.pick(['NGC','IC','PGC','UGC'])} ${rng.int(100, 9999)}`,
        type: isMW ? 'Barred spiral (SBbc)' : type,
        diameterLy, starCount, bhMass,
        distanceLy: dist,
        armCount: type.includes('Spiral') ? rng.int(2, 6) : 0,
        redshift: dist > 0 ? +(dist / 1.4e10 * 1.6).toFixed(4) : 0,
        pos: {
          x: dist * Math.sin(ph) * Math.cos(th),
          y: dist * Math.cos(ph) * 0.35,
          z: dist * Math.sin(ph) * Math.sin(th),
        },
        color: [0xbfd4ff, 0xffd9a8, 0xffc9c9, 0xd8ffe6][rng.int(0, 3)],
        systemCount: Math.max(60, Math.min(400, Math.round(diameterLy / 400))),
      });
    }
    return out;
  }

  /* ---------- Star systems within a galaxy ---------- */
  getSystems(galaxyIdx) {
    if (this.systemCache.has(galaxyIdx)) return this.systemCache.get(galaxyIdx);
    const gal = this.galaxies[galaxyIdx];
    const out = [];
    const n = gal.systemCount;

    for (let i = 0; i < n; i++) {
      const rng = new RNG(this.hash(galaxyIdx, i, 3313));
      // Sol is pinned as system 0 of the Milky Way
      const isSol = gal.real && i === 0;
      const sp = isSol ? SPECTRAL[4] : pickSpectral(rng);

      const mass = isSol ? 1.0 : +rng.range(sp.mMin, sp.mMax).toFixed(3);
      const temp = isSol ? 5772 : Math.round(rng.range(sp.tMin, sp.tMax));
      // Mass–luminosity relation
      const lum = isSol ? 1.0 : +Math.pow(mass, mass < 0.43 ? 2.3 : 3.5).toFixed(4);
      const radius = isSol ? 1.0 : +Math.pow(mass, mass < 1 ? 0.8 : 0.57).toFixed(3);
      // Main-sequence lifetime, then a plausible current age
      const lifeGyr = 10 * Math.pow(mass, -2.5);
      const age = isSol ? 4.603 : +rng.range(0.05, Math.min(lifeGyr, 13.4)).toFixed(2);

      // Spiral-arm placement
      const arm = gal.armCount ? rng.int(0, gal.armCount - 1) : 0;
      const rFrac = Math.pow(rng.next(), 0.6);
      const rad = rFrac * gal.diameterLy * 0.5;
      const armAngle = gal.armCount
        ? (arm / gal.armCount) * Math.PI * 2 + rFrac * 4.2 + rng.gauss(0, 0.16)
        : rng.range(0, Math.PI * 2);
      const thick = gal.type === 'Elliptical' ? 0.55 : 0.06;

      out.push({
        kind: 'star', galaxyIdx, idx: i, real: isSol,
        name: isSol ? 'Sol' : starName(rng),
        spectral: isSol ? 'G2V' : `${sp.c}${rng.int(0, 9)}V`,
        spectralClass: sp.c,
        temp, mass, luminosity: lum, radius, age,
        color: isSol ? 0xfff4ea : sp.col,
        pos: {
          x: rad * Math.cos(armAngle),
          y: rng.gauss(0, gal.diameterLy * thick * 0.25),
          z: rad * Math.sin(armAngle),
        },
        planetCount: isSol ? 8 : rng.int(0, 9),
        hasBlackHole: !isSol && rng.next() < 0.012,
      });
    }
    this.systemCache.set(galaxyIdx, out);
    return out;
  }

  /* ---------- Planets within a system ---------- */
  getPlanets(star) {
    const key = `${star.galaxyIdx}:${star.idx}`;
    if (this.galaxyCache.has(key)) return this.galaxyCache.get(key);
    const out = [];

    if (star.real) {
      out.push(...this.solSystem(star));
    } else {
      const rng = new RNG(this.hash(star.galaxyIdx, star.idx, 991));
      const hz = Physics.habitableZone(star.luminosity);
      let a = rng.range(0.04, 0.35) * AU;

      for (let i = 0; i < star.planetCount; i++) {
        // Titius–Bode-like geometric spacing with jitter
        a *= rng.range(1.35, 2.1);
        const inHZ = a > hz.inner && a < hz.outer;

        // Type selection biased by insolation
        let pool = PLANET_TYPES;
        const insol = star.luminosity / Math.pow(a / AU, 2);
        if (insol > 8) pool = PLANET_TYPES.filter(p => ['Molten','Barren rock','Desert'].includes(p.type));
        else if (insol < 0.1) pool = PLANET_TYPES.filter(p => ['Ice','Gas giant','Ice giant','Barren rock'].includes(p.type));
        else if (inHZ && rng.next() < 0.42) pool = PLANET_TYPES.filter(p => ['Terrestrial','Ocean','Desert'].includes(p.type));

        const pt = rng.pick(pool);
        const massE = +rng.range(pt.mMin, pt.mMax).toFixed(3);
        // Mass–radius relation switches regime above ~4 M⊕
        const radE = massE < 4
          ? +Math.pow(massE, 0.27).toFixed(3)
          : +(1.0 * Math.pow(massE, 0.55)).toFixed(3);

        out.push(this.buildPlanet(star, {
          rng, a, pt, massE, radE, index: i,
          name: `${star.name} ${String.fromCharCode(98 + i)}`,
        }));
      }
    }
    this.galaxyCache.set(key, out);
    return out;
  }

  buildPlanet(star, o) {
    const { rng, a, pt, massE, radE } = o;
    const massKg = massE * EARTH_MASS;
    const radM = radE * EARTH_RADIUS;
    const lumW = star.luminosity * 3.828e26;
    const albedo = pt.type === 'Ice' ? 0.62 : pt.type === 'Ocean' ? 0.28 : 0.3;
    const teq = Physics.equilibriumTemp(lumW, a, albedo);
    // Crude greenhouse offset by atmosphere class
    const atm = rng.pick(pt.atm);
    const green = atm === 'None' ? 0 : atm.includes('CO₂') ? rng.range(15, 90) : rng.range(5, 40);
    const temp = Math.round(teq + green);
    const period = Physics.period(a, star.mass * SOLAR_MASS);
    const isGiant = pt.type.includes('giant') || pt.type === 'Sub-Neptune';

    const moonCount = isGiant ? rng.int(2, 42) : (a > AU * 0.4 ? rng.int(0, 4) : rng.int(0, 1));
    const hasRings = isGiant ? rng.next() < 0.55 : rng.next() < 0.04;

    return {
      kind: 'planet', star, idx: o.index, real: false,
      name: o.name, type: pt.type, color: pt.col,
      massE, radiusE: radE, massKg, radiusM: radM,
      gravity: +Physics.surfaceGravity(massKg, radM).toFixed(2),
      escapeVel: +(Physics.escapeVelocity(massKg, radM) / 1000).toFixed(2),
      distanceAU: +(a / AU).toFixed(4), distanceM: a,
      orbitalPeriodDays: +(period / 86400).toFixed(2),
      rotationHours: +rng.range(6, isGiant ? 20 : 240).toFixed(2),
      axialTilt: +rng.range(0, 65).toFixed(1),
      temp, atmosphere: atm,
      composition: isGiant ? 'H/He envelope, rock–ice core'
        : rng.pick(['Silicate mantle, Fe core', 'Basaltic crust, Fe–Ni core', 'Water–ice mantle, rocky core', 'Carbonaceous silicate']),
      moonCount, hasRings,
      esi: +Physics.esi(radE, massE, temp).toFixed(3),
      orbit: {
        a, e: +rng.range(0, 0.28).toFixed(4),
        i: rng.gauss(0, 0.05), w: rng.range(0, Math.PI * 2),
        M0: rng.range(0, Math.PI * 2), period,
      },
      moons: this.buildMoons(rng, moonCount, radM, massKg, o.name),
    };
  }

  buildMoons(rng, count, primaryRadius, primaryMass, parentName) {
    const out = [];
    const n = Math.min(count, 8); // only the largest are modelled individually
    for (let i = 0; i < n; i++) {
      const a = primaryRadius * rng.range(2.6, 60);
      const radE = +rng.range(0.005, 0.4).toFixed(4);
      const massE = +Math.pow(radE, 3.7).toFixed(6);
      out.push({
        kind: 'moon', name: `${parentName} ${['I','II','III','IV','V','VI','VII','VIII'][i]}`,
        radiusE: radE, massE,
        distanceKm: Math.round(a / 1000),
        orbitalPeriodDays: +(Physics.period(a, primaryMass) / 86400).toFixed(3),
        type: rng.pick(['Rocky', 'Icy', 'Captured asteroid', 'Cryovolcanic', 'Tidally heated']),
        orbit: { a, e: +rng.range(0, 0.05).toFixed(4), i: rng.gauss(0, 0.08), w: rng.range(0, 6.28), M0: rng.range(0, 6.28), period: Physics.period(a, primaryMass) },
        color: 0x9a9a92,
      });
    }
    return out;
  }

  /* ---------- Real Solar System data (labelled OBSERVED) ---------- */
  solSystem(star) {
    const D = [
      // name, massE, radiusE, a(AU), e, periodDays, rotH, tilt, tempK, atm, moons, rings, colour
      ['Mercury', 0.0553, 0.3829, 0.387, 0.2056, 87.97, 1407.6, 0.03, 440, 'Trace Na–O₂', 0, false, 0x8c8681, 'Silicate mantle, large Fe core'],
      ['Venus', 0.815, 0.9499, 0.723, 0.0068, 224.70, -5832.5, 177.4, 737, 'CO₂ 96.5%, N₂ 3.5%', 0, false, 0xd9b46a, 'Basaltic crust, Fe core'],
      ['Earth', 1.0, 1.0, 1.000, 0.0167, 365.26, 23.93, 23.44, 288, 'N₂ 78%, O₂ 21%', 1, false, 0x3f7fbf, 'Silicate mantle, Fe–Ni core'],
      ['Mars', 0.107, 0.5320, 1.524, 0.0934, 686.98, 24.62, 25.19, 210, 'CO₂ 95%, N₂ 2.6%', 2, false, 0xc1440e, 'Basaltic crust, partially liquid core'],
      ['Jupiter', 317.8, 11.209, 5.204, 0.0489, 4332.6, 9.93, 3.13, 165, 'H₂ 89%, He 10%', 95, true, 0xd8ca9d, 'H/He envelope, dilute core'],
      ['Saturn', 95.16, 9.449, 9.583, 0.0565, 10759, 10.66, 26.73, 134, 'H₂ 96%, He 3%', 274, true, 0xe3d9a5, 'H/He envelope, rock–ice core'],
      ['Uranus', 14.54, 4.007, 19.19, 0.0463, 30689, -17.24, 97.77, 76, 'H₂ 83%, He 15%, CH₄ 2%', 28, true, 0x9fd4de, 'Water–ammonia–methane mantle'],
      ['Neptune', 17.15, 3.883, 30.07, 0.0086, 60195, 16.11, 28.32, 72, 'H₂ 80%, He 19%, CH₄ 1.5%', 16, true, 0x3f66c9, 'Water–ammonia–methane mantle'],
    ];
    const rng = new RNG(this.hash(0, 0, 42));
    return D.map((d, i) => {
      const [name, massE, radE, aAU, e, perD, rotH, tilt, temp, atm, moons, rings, col, comp] = d;
      const a = aAU * AU;
      const massKg = massE * EARTH_MASS, radM = radE * EARTH_RADIUS;
      return {
        kind: 'planet', star, idx: i, real: true,
        name, type: this.classifySol(name), color: col,
        massE, radiusE: radE, massKg, radiusM: radM,
        gravity: +Physics.surfaceGravity(massKg, radM).toFixed(2),
        escapeVel: +(Physics.escapeVelocity(massKg, radM) / 1000).toFixed(2),
        distanceAU: aAU, distanceM: a,
        orbitalPeriodDays: perD, rotationHours: rotH, axialTilt: tilt,
        temp, atmosphere: atm, composition: comp,
        moonCount: moons, hasRings: rings,
        esi: +Physics.esi(radE, massE, temp).toFixed(3),
        orbit: { a, e, i: rng.gauss(0, 0.03), w: rng.range(0, 6.28), M0: rng.range(0, 6.28), period: perD * 86400 },
        moons: name === 'Earth'
          ? [{ kind: 'moon', name: 'Moon', real: true, radiusE: 0.2727, massE: 0.0123, distanceKm: 384400, orbitalPeriodDays: 27.32, type: 'Rocky', color: 0x9a9a92,
               orbit: { a: 3.844e8, e: 0.0549, i: 0.089, w: 0, M0: rng.range(0, 6.28), period: 27.32 * 86400 } }]
          : this.buildMoons(rng, Math.min(moons, 4), radM, massKg, name),
      };
    });
  }

  classifySol(n) {
    if (['Mercury'].includes(n)) return 'Barren rock';
    if (['Venus'].includes(n)) return 'Molten';
    if (['Earth'].includes(n)) return 'Terrestrial';
    if (['Mars'].includes(n)) return 'Desert';
    if (['Jupiter', 'Saturn'].includes(n)) return 'Gas giant';
    return 'Ice giant';
  }

  /* ---------- Nebulae ---------- */
  getNebulae(galaxyIdx) {
    const gal = this.galaxies[galaxyIdx];
    const rng = new RNG(this.hash(galaxyIdx, 5501));
    const out = [];
    const n = rng.int(4, 9);
    for (let i = 0; i < n; i++) {
      const r = new RNG(this.hash(galaxyIdx, i, 8823));
      const type = r.pick(['Emission', 'Reflection', 'Planetary', 'Dark', 'Supernova remnant']);
      const rad = Math.pow(r.next(), 0.6) * gal.diameterLy * 0.42;
      const ang = r.range(0, Math.PI * 2);
      out.push({
        kind: 'nebula', galaxyIdx, idx: i,
        name: `${r.pick(NEBULA_N)} Nebula`,
        type,
        diameterLy: +r.range(1.5, 320).toFixed(1),
        pos: { x: rad * Math.cos(ang), y: r.gauss(0, gal.diameterLy * 0.02), z: rad * Math.sin(ang) },
        color: { Emission: 0xff5a7a, Reflection: 0x6a9bff, Planetary: 0x4fe0c0, Dark: 0x2a2438, 'Supernova remnant': 0xffa94f }[type],
        composition: type === 'Dark' ? 'Cold molecular H₂, silicate dust' : 'Ionised H II, He, trace O III',
        temp: type === 'Dark' ? Math.round(r.range(10, 50)) : Math.round(r.range(6000, 14000)),
        density: `~${r.int(10, 9000)} particles/cm³`,
        starForming: ['Emission', 'Dark'].includes(type),
      });
    }
    return out;
  }

  /* ---------- Black holes ---------- */
  getBlackHoles(galaxyIdx) {
    const gal = this.galaxies[galaxyIdx];
    const rng = new RNG(this.hash(galaxyIdx, 6602));
    const out = [{
      kind: 'blackhole', galaxyIdx, idx: 0, supermassive: true,
      name: gal.real ? 'Sagittarius A*' : `${gal.name} core`,
      real: gal.real,
      massSolar: gal.bhMass,
      pos: { x: 0, y: 0, z: 0 },
      spin: +rng.range(0.1, 0.998).toFixed(3),
      accretionRate: +rng.range(1e-9, 1e-4).toExponential(2),
    }];
    const n = rng.int(2, 5);
    for (let i = 1; i <= n; i++) {
      const r = new RNG(this.hash(galaxyIdx, i, 7714));
      const rad = Math.pow(r.next(), 0.5) * gal.diameterLy * 0.4;
      const ang = r.range(0, Math.PI * 2);
      out.push({
        kind: 'blackhole', galaxyIdx, idx: i, supermassive: false,
        name: `BH ${gal.name.replace(/\s/g, '')}-${i}`,
        massSolar: +r.range(4, 78).toFixed(1),
        pos: { x: rad * Math.cos(ang), y: r.gauss(0, gal.diameterLy * 0.02), z: rad * Math.sin(ang) },
        spin: +r.range(0, 0.99).toFixed(3),
        accretionRate: +r.range(1e-12, 1e-7).toExponential(2),
      });
    }
    return out;
  }

  /* ---------- Small bodies ---------- */
  getSmallBodies(star) {
    const rng = new RNG(this.hash(star.galaxyIdx, star.idx, 4404));
    const belts = [];
    const nb = rng.int(1, 2);
    for (let i = 0; i < nb; i++) {
      const inner = rng.range(1.8, 4) * AU * (i + 1);
      belts.push({
        kind: 'belt', name: i === 0 ? 'Main asteroid belt' : 'Outer debris belt',
        innerAU: +(inner / AU).toFixed(2),
        outerAU: +((inner * rng.range(1.3, 2.2)) / AU).toFixed(2),
        count: rng.int(20000, 1900000),
      });
    }
    const comets = [];
    for (let i = 0; i < rng.int(3, 8); i++) {
      const r = new RNG(this.hash(star.galaxyIdx, star.idx, i, 3301));
      const q = r.range(0.3, 3) * AU;
      const e = r.range(0.72, 0.987);
      const a = q / (1 - e);
      comets.push({
        kind: 'comet', name: `C/${r.int(2020, 2099)} ${String.fromCharCode(65 + r.int(0, 25))}${r.int(1, 9)}`,
        perihelionAU: +(q / AU).toFixed(3),
        aphelionAU: +((a * (1 + e)) / AU).toFixed(2),
        e: +e.toFixed(4),
        periodYears: +(Physics.period(a, star.mass * SOLAR_MASS) / 3.156e7).toFixed(2),
        nucleusKm: +r.range(0.4, 60).toFixed(1),
        orbit: { a, e, i: r.gauss(0, 0.6), w: r.range(0, 6.28), M0: r.range(0, 6.28), period: Physics.period(a, star.mass * SOLAR_MASS) },
      });
    }
    return { belts, comets };
  }

  /* ---------- Search index ---------- */
  search(query, limit = 24) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits = [];
    for (const g of this.galaxies) {
      if (g.name.toLowerCase().includes(q)) hits.push({ ...g, _label: g.type });
      if (hits.length > limit * 3) break;
    }
    const scanGal = this.galaxies.slice(0, 12);
    for (const g of scanGal) {
      for (const s of this.getSystems(g.idx)) {
        if (s.name.toLowerCase().includes(q)) hits.push({ ...s, _label: `${s.spectral} star · ${g.name}` });
        if (hits.length > limit * 3) break;
      }
      for (const n of this.getNebulae(g.idx)) {
        if (n.name.toLowerCase().includes(q)) hits.push({ ...n, _label: `${n.type} nebula` });
      }
      for (const b of this.getBlackHoles(g.idx)) {
        if (b.name.toLowerCase().includes(q)) hits.push({ ...b, _label: b.supermassive ? 'Supermassive black hole' : 'Stellar-mass black hole' });
      }
    }
    // Planets of the pinned Sol system, always searchable
    const sol = this.getSystems(0)[0];
    for (const p of this.getPlanets(sol)) {
      if (p.name.toLowerCase().includes(q)) hits.push({ ...p, _label: `${p.type} · Sol` });
      for (const m of p.moons) {
        if (m.name.toLowerCase().includes(q)) hits.push({ ...m, _label: `Moon of ${p.name}`, parent: p });
      }
    }
    return hits.slice(0, limit);
  }
}

/* ============================================================
   SCALE MANAGER — floating origin + LOD tiers
   ============================================================
   Rendering the universe at true scale overflows float32 depth
   buffers. We render one tier at a time and re-origin the camera,
   which is what keeps 10^26 m of range stable at 60fps.
   ============================================================ */
export const SCALES = [
  { id: 'surface',  label: 'Surface',        unit: 'm',   min: 1,      max: 1e7,  desc: 'Human to planetary surface' },
  { id: 'planet',   label: 'Planetary',      unit: 'km',  min: 1e7,    max: 1e10, desc: 'Planet and moon system' },
  { id: 'system',   label: 'Stellar system', unit: 'AU',  min: 1e10,   max: 1e14, desc: 'Orbits and small bodies' },
  { id: 'stellar',  label: 'Interstellar',   unit: 'ly',  min: 1e14,   max: 1e19, desc: 'Neighbouring stars' },
  { id: 'galactic', label: 'Galactic',       unit: 'ly',  min: 1e19,   max: 1e23, desc: 'Spiral arms and core' },
  { id: 'cosmic',   label: 'Intergalactic',  unit: 'Mly', min: 1e23,   max: 1e28, desc: 'Galaxy clusters and voids' },
];

export function scaleFor(distMeters) {
  for (const s of SCALES) if (distMeters < s.max) return s;
  return SCALES[SCALES.length - 1];
}

export function formatDistance(m) {
  if (m < 1e3) return `${m.toFixed(1)} m`;
  if (m < 1e7) return `${(m / 1e3).toFixed(1)} km`;
  if (m < 0.1 * AU) return `${(m / 1e3).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
  if (m < 1e4 * AU) return `${(m / AU).toFixed(3)} AU`;
  if (m < 1e6 * LY) return `${(m / LY).toLocaleString(undefined, { maximumFractionDigits: 2 })} ly`;
  return `${(m / (1e6 * LY)).toLocaleString(undefined, { maximumFractionDigits: 2 })} Mly`;
}

export function formatTime(seconds) {
  const s = Math.abs(seconds);
  if (s < 60) return `${s.toFixed(1)} s`;
  if (s < 3600) return `${(s / 60).toFixed(1)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(2)} h`;
  if (s < 3.156e7) return `${(s / 86400).toFixed(2)} d`;
  if (s < 3.156e10) return `${(s / 3.156e7).toFixed(2)} yr`;
  return `${(s / 3.156e7).toExponential(2)} yr`;
}

export function formatMass(kg) {
  if (kg > 1e29) return `${(kg / SOLAR_MASS).toPrecision(4)} M☉`;
  return `${(kg / EARTH_MASS).toPrecision(4)} M⊕`;
}

/* ============================================================
   SIM CLOCK — time control (§7)
   ============================================================ */
export class SimClock {
  constructor() {
    this.t = 0;                 // simulation seconds since epoch J2000
    this.rate = 1;              // seconds of sim per second of real time
    this.paused = false;
    this.RATES = [
      { label: '−1 yr/s', v: -3.156e7 }, { label: '−1 d/s', v: -86400 },
      { label: '0.1×', v: 0.1 }, { label: '1×', v: 1 }, { label: '60×', v: 60 },
      { label: '1 h/s', v: 3600 }, { label: '1 d/s', v: 86400 },
      { label: '30 d/s', v: 2.592e6 }, { label: '1 yr/s', v: 3.156e7 },
      { label: '100 yr/s', v: 3.156e9 }, { label: '10 kyr/s', v: 3.156e11 },
      { label: '1 Myr/s', v: 3.156e13 },
    ];
    this.rateIdx = 3;
  }
  step(dtReal) { if (!this.paused) this.t += dtReal * this.rate; }
  setRateIdx(i) { this.rateIdx = Math.max(0, Math.min(this.RATES.length - 1, i)); this.rate = this.RATES[this.rateIdx].v; }
  faster() { this.setRateIdx(this.rateIdx + 1); }
  slower() { this.setRateIdx(this.rateIdx - 1); }
  get rateLabel() { return this.paused ? 'Paused' : this.RATES[this.rateIdx].label; }
  /* Calendar date from J2000 epoch */
  get date() {
    const d = new Date(Date.UTC(2000, 0, 1, 12) + this.t * 1000);
    return isNaN(d.getTime())
      ? `J2000 ${(this.t / 3.156e7).toExponential(3)} yr`
      : d.toISOString().slice(0, 10);
  }
}
