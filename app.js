/* ============================================================
   AETHER — app.js : application controller
   Scene orchestration, input handling, UI binding, demo director
   ============================================================ */
import * as THREE from 'three';
import {
  Universe, Physics, SimClock, SCALES, scaleFor,
  formatDistance, formatTime, formatMass,
  AU, LY, SOLAR_RADIUS, EARTH_RADIUS, SOLAR_MASS, C,
} from './engine.js';
import {
  buildStarfield, buildStar, buildPlanet, buildOrbitLine, buildNebula,
  buildBlackHole, buildGalaxy, planetTexture, radialSprite,
  Spacecraft, DEMO_SEQUENCE, RU,
} from './render.js';
import { MISSIONS, initMissions, evaluate } from './missions.js';
import { buildPopulationStats, findAnomalies } from './orion.js';
import { habitability, ACHIEVEMENTS, XP, levelFor, STORY } from './lab.js';
import * as UI from './ui.js';

/* ============================================================
   BOOT
   ============================================================ */
const $ = id => document.getElementById(id);
const loadBar = $('load-bar').firstElementChild;
const loadTxt = $('load-t');

const steps = [
  'Seeding universe', 'Generating galaxy field', 'Populating star systems',
  'Computing orbital elements', 'Building surfaces', 'Calibrating instruments',
];
let li = 0;
const loadTick = setInterval(() => {
  li++;
  loadBar.style.width = `${Math.min(100, (li / steps.length) * 100)}%`;
  loadTxt.textContent = steps[Math.min(li, steps.length - 1)];
  if (li >= steps.length) clearInterval(loadTick);
}, 260);

/* ---------- Renderer ---------- */
const renderer = new THREE.WebGLRenderer({
  antialias: window.devicePixelRatio < 2, powerPreference: 'high-performance',
  logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 4e6);
scene.add(new THREE.AmbientLight(0x1a2030, 0.55));

/* Distant starfield rides with the camera so it never parallaxes */
const starfield = buildStarfield(24000);
scene.add(starfield);

/* ============================================================
   STATE
   ============================================================ */
const uni = new Universe(20260812);
const clock = new SimClock();
const ship = new Spacecraft();

const state = {
  tier: 'system',              // current scale tier
  galaxyIdx: 0,
  starIdx: 0,
  selected: null,
  target: null,
  targetVec: new THREE.Vector3(),
  log: [],
  compare: [],
  missions: initMissions(),
  activeMission: null,
  badges: [],
  spectralSeen: new Set(),
  galaxiesVisited: new Set([0]),

  /* --- COSMOS-X additions --- */
  uni: null,                     // set after construction
  orionLevel: 1,                 // 0 beginner, 1 intermediate, 2 advanced
  proSeen: new Set(),
  asked: new Set(),
  scanned: new Set(),
  analysed: new Set(),
  reports: new Set(),
  experiments: new Set(),
  logged: new Set(),
  systemsLogged: new Set(),
  xp: 0,
  tracks: { solPlanets: 0, galaxies: 1, exoplanets: 0, blackholes: 0,
            reports: 0, spectral: 0, experiments: 0, logged: 0 },
  lab: null, whatif: null, story: null,
  earthRef: null,
  briefed: new Set(),
  demo: null,
  settings: {
    bloom: true, orbits: true, labels: true, atmosphere: true,
    quality: 'high', showGenerated: true,
  },
  camDist: 40,
  camYaw: 0.4,
  camPitch: 0.3,
  freeCam: true,
};

/* Scene layer groups — swapped by tier so we never render
   10^28 m of range into one depth buffer. */
const L = {
  system: new THREE.Group(),
  stellar: new THREE.Group(),
  galactic: new THREE.Group(),
  cosmic: new THREE.Group(),
};
Object.values(L).forEach(g => scene.add(g));

const pickables = [];   // { mesh, body }

/* ============================================================
   SCENE BUILDERS — one per tier
   ============================================================ */

function clearGroup(g) {
  while (g.children.length) {
    const c = g.children.pop();
    c.traverse?.(o => { o.geometry?.dispose?.(); });
    g.remove(c);
  }
}

/* ---- SYSTEM tier: star + planets + moons, 1 unit = 1e6 m ---- */
const SYS_SCALE = 1e9;   // metres per render unit at system tier
let sysBodies = [];

function buildSystemScene() {
  clearGroup(L.system);
  pickables.length = 0;
  sysBodies = [];

  const star = uni.getSystems(state.galaxyIdx)[state.starIdx];
  const planets = uni.getPlanets(star);
  const small = uni.getSmallBodies(star);

  // Star — exaggerate radius slightly so it reads at system scale
  const sr = Math.max(0.6, (star.radius * SOLAR_RADIUS) / SYS_SCALE * 24);
  const sg = buildStar(star, sr);
  L.system.add(sg);
  sysBodies.push({ obj: sg, body: star, kind: 'star' });
  pickables.push({ mesh: sg.children[0], body: star });

  // Habitable zone annulus
  const hz = Physics.habitableZone(star.luminosity);
  const hzRing = new THREE.Mesh(
    new THREE.RingGeometry(hz.inner / SYS_SCALE, hz.outer / SYS_SCALE, 96),
    new THREE.MeshBasicMaterial({
      color: 0x4fbf7a, transparent: true, opacity: 0.055,
      side: THREE.DoubleSide, depthWrite: false,
    })
  );
  hzRing.rotation.x = Math.PI / 2;
  hzRing.userData.hz = true;
  L.system.add(hzRing);

  // Planets — radius exaggerated on a log curve so small worlds stay visible
  for (const p of planets) {
    const pr = Math.max(0.16, Math.pow(p.radiusE, 0.45) * 1.5);
    const g = buildPlanet(p, pr);
    L.system.add(g);
    sysBodies.push({ obj: g, body: p, kind: 'planet' });
    pickables.push({ mesh: g.userData.surface, body: p });

    if (state.settings.orbits) {
      const line = buildOrbitLine(p.orbit, SYS_SCALE, p.real ? 0x5a7fa0 : 0x4a6b8a);
      line.userData.orbit = true;
      L.system.add(line);
    }

    // Moons
    for (const m of p.moons) {
      const mr = Math.max(0.05, Math.pow(m.radiusE, 0.45) * 0.55);
      const mg = new THREE.Mesh(
        new THREE.SphereGeometry(mr, 24, 16),
        new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.95 })
      );
      L.system.add(mg);
      sysBodies.push({ obj: mg, body: m, kind: 'moon', parent: p });
      pickables.push({ mesh: mg, body: m });
    }
  }

  // Asteroid belts — instanced
  for (const belt of small.belts) {
    const n = 2600;
    const geo = new THREE.IcosahedronGeometry(0.05, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b6156, roughness: 1 });
    const im = new THREE.InstancedMesh(geo, mat, n);
    const d = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const r = THREE.MathUtils.lerp(belt.innerAU, belt.outerAU, Math.random()) * AU / SYS_SCALE;
      const a = Math.random() * Math.PI * 2;
      d.position.set(r * Math.cos(a), (Math.random() - 0.5) * r * 0.05, r * Math.sin(a));
      d.scale.setScalar(0.4 + Math.random() * 1.6);
      d.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    }
    im.userData.belt = belt;
    L.system.add(im);
  }

  // Comets
  for (const c of small.comets) {
    const cg = new THREE.Group();
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xcfe8ff })
    );
    cg.add(head);
    const tail = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialSprite(new THREE.Color(0x9fd8ff)),
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5,
    }));
    tail.scale.setScalar(2.4);
    cg.add(tail);
    cg.userData.tail = tail;
    L.system.add(cg);
    sysBodies.push({ obj: cg, body: c, kind: 'comet' });
    pickables.push({ mesh: head, body: c });
  }

  applySettings();
}

/* ---- STELLAR tier: neighbouring stars as points ---- */
const STELLAR_SCALE = 3e15;  // metres per unit (~0.3 ly)
function buildStellarScene() {
  clearGroup(L.stellar);
  const systems = uni.getSystems(state.galaxyIdx);
  const home = systems[state.starIdx];

  const n = systems.length;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), siz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = systems[i];
    // Position relative to the home star, converted ly → units
    pos[i * 3] = ((s.pos.x - home.pos.x) * LY) / STELLAR_SCALE;
    pos[i * 3 + 1] = ((s.pos.y - home.pos.y) * LY) / STELLAR_SCALE;
    pos[i * 3 + 2] = ((s.pos.z - home.pos.z) * LY) / STELLAR_SCALE;
    const c = new THREE.Color(s.color);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    siz[i] = 60 + Math.pow(s.luminosity, 0.22) * 190;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));

  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    vertexShader: `attribute float aSize; varying vec3 vC;
      void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0);
      gl_PointSize=aSize*(300.0/-mv.z); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC;
      void main(){ float r=length(gl_PointCoord-0.5); if(r>0.5) discard;
      float c=smoothstep(0.5,0.0,r); float h=pow(c,3.0);
      gl_FragColor=vec4(vC*(h*2.6+c*0.3), h); }`,
    transparent: true, vertexColors: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  pts.userData.systems = systems;
  pts.userData.home = home;
  L.stellar.add(pts);

  // Nebulae at this tier
  for (const neb of uni.getNebulae(state.galaxyIdx)) {
    const ng = buildNebula(neb, (neb.diameterLy * LY) / STELLAR_SCALE * 1.4);
    ng.position.set(
      ((neb.pos.x - home.pos.x) * LY) / STELLAR_SCALE,
      ((neb.pos.y - home.pos.y) * LY) / STELLAR_SCALE,
      ((neb.pos.z - home.pos.z) * LY) / STELLAR_SCALE
    );
    ng.userData.body = neb;
    L.stellar.add(ng);
  }

  // Black holes
  for (const bh of uni.getBlackHoles(state.galaxyIdx)) {
    const rs = Physics.schwarzschildRadius(bh.massSolar * SOLAR_MASS);
    // Exaggerate — a stellar-mass Rs is ~30 km, invisible at this tier
    const ru = Math.max(0.8, (rs / STELLAR_SCALE) * 4e7);
    const bg = buildBlackHole(bh, ru);
    bg.position.set(
      ((bh.pos.x - home.pos.x) * LY) / STELLAR_SCALE,
      ((bh.pos.y - home.pos.y) * LY) / STELLAR_SCALE,
      ((bh.pos.z - home.pos.z) * LY) / STELLAR_SCALE
    );
    bg.userData.body = bh;
    L.stellar.add(bg);
  }
}

/* ---- GALACTIC tier ---- */
const GALACTIC_SCALE = 1e19;
function buildGalacticScene() {
  clearGroup(L.galactic);
  const gal = uni.galaxies[state.galaxyIdx];
  const size = (gal.diameterLy * LY) / GALACTIC_SCALE;
  const gg = buildGalaxy(gal, size);
  gg.userData.body = gal;
  L.galactic.add(gg);
}

/* ---- COSMIC tier ---- */
const COSMIC_SCALE = 1e23;
function buildCosmicScene() {
  clearGroup(L.cosmic);
  const home = uni.galaxies[state.galaxyIdx];
  for (const g of uni.galaxies) {
    const size = Math.max(1.2, (g.diameterLy * LY) / COSMIC_SCALE * 900);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialSprite(new THREE.Color(g.color)),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0.8,
    }));
    sp.scale.setScalar(size);
    sp.position.set(
      ((g.pos.x - home.pos.x) * LY) / COSMIC_SCALE,
      ((g.pos.y - home.pos.y) * LY) / COSMIC_SCALE,
      ((g.pos.z - home.pos.z) * LY) / COSMIC_SCALE
    );
    sp.userData.body = g;
    L.cosmic.add(sp);
  }
}

/* ============================================================
   TIER SWITCHING
   ============================================================ */
const TIER_SCALE = {
  system: SYS_SCALE, stellar: STELLAR_SCALE,
  galactic: GALACTIC_SCALE, cosmic: COSMIC_SCALE,
};

function setTier(t, opts = {}) {
  if (state.tier === t && !opts.force) return;
  state.tier = t;
  L.system.visible = t === 'system';
  L.stellar.visible = t === 'stellar';
  L.galactic.visible = t === 'galactic';
  L.cosmic.visible = t === 'cosmic';

  if (t === 'system' && !L.system.children.length) buildSystemScene();
  if (t === 'stellar' && !L.stellar.children.length) buildStellarScene();
  if (t === 'galactic' && !L.galactic.children.length) buildGalacticScene();
  if (t === 'cosmic' && !L.cosmic.children.length) buildCosmicScene();

  // Reset camera distance to a sensible default for the tier
  if (!opts.keepDist) {
    state.camDist = { system: 40, stellar: 900, galactic: 2600, cosmic: 5200 }[t];
  }
  renderLadder();
}

/* Map render distance → the astronomical scale it represents */
function currentMetricDistance() {
  return state.camDist * TIER_SCALE[state.tier];
}

/* ============================================================
   ORBITAL UPDATE (§2, §7)
   ============================================================ */
function updateOrbits() {
  if (state.tier !== 'system') return;
  const t = clock.t;

  for (const e of sysBodies) {
    if (e.kind === 'star') continue;

    if (e.kind === 'moon') {
      // Moon position is parent position + local orbit
      const pe = sysBodies.find(x => x.body === e.parent);
      if (!pe) continue;
      const lp = Physics.orbitalPosition(e.body.orbit, t);
      e.obj.position.set(
        pe.obj.position.x + lp.x / SYS_SCALE,
        pe.obj.position.y + lp.y / SYS_SCALE,
        pe.obj.position.z + lp.z / SYS_SCALE
      );
      continue;
    }

    const p = Physics.orbitalPosition(e.body.orbit, t);
    e.obj.position.set(p.x / SYS_SCALE, p.y / SYS_SCALE, p.z / SYS_SCALE);

    // Axial rotation
    if (e.kind === 'planet' && e.obj.userData.surface) {
      const rotPeriod = e.body.rotationHours * 3600;
      e.obj.userData.surface.rotation.y = (t / rotPeriod) * Math.PI * 2;
    }

    // Comet tail points away from the star, length scales with 1/r²
    if (e.kind === 'comet' && e.obj.userData.tail) {
      const d = e.obj.position.length();
      const act = THREE.MathUtils.clamp(90 / (d * d), 0, 1);
      e.obj.userData.tail.scale.setScalar(1 + act * 9);
      e.obj.userData.tail.material.opacity = 0.15 + act * 0.65;
    }
  }

  // Sun direction for atmospheric shaders
  for (const e of sysBodies) {
    if (e.kind === 'planet' && e.obj.userData.atmosphere) {
      const dir = e.obj.position.clone().negate().normalize();
      e.obj.userData.atmosphere.material.uniforms.uSun.value.copy(dir);
    }
  }
}

/* ============================================================
   INPUT
   ============================================================ */
const keys = {};
/* Declared here rather than beside the touch handlers: the frame loop
   reads it, and `let` in the later block would be in its temporal dead
   zone on the first frames. */
let stickVec = { x: 0, y: 0 };
let dragging = false, lastX = 0, lastY = 0;
const isTouch = matchMedia('(pointer: coarse)').matches;
if (isTouch) $('touch').classList.add('on', 'avail');

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  handleKey(e);
});
addEventListener('keyup', e => { keys[e.code] = false; });

function handleKey(e) {
  switch (e.code) {
    case 'Space': e.preventDefault(); togglePause(); break;
    case 'Comma': clock.slower(); updateTimeUI(); break;
    case 'Period': clock.faster(); updateTimeUI(); break;
    case 'KeyF': engageAutopilot(); break;
    case 'KeyL': logDiscovery(); break;
    case 'KeyC': addCompare(); break;
    case 'KeyV': cycleView(); break;
    case 'KeyM': toggleDrawer('missions'); break;
    case 'KeyO': $('b-orion').click(); break;
    case 'KeyR': UI.openLab(); break;
    case 'KeyI': UI.openWhatIf(); break;
    case 'KeyP': toggleDrawer('progress'); break;
    case 'KeyJ': state.story ? UI.endStory() : UI.startStory(); break;
    case 'KeyH': $('tut').classList.toggle('on'); break;
    case 'Escape': closeAll(); break;
    case 'BracketLeft': stepTier(-1); break;
    case 'BracketRight': stepTier(1); break;
  }
}

const el = renderer.domElement;
el.addEventListener('pointerdown', e => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  el.setPointerCapture(e.pointerId);
});
el.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  state.camYaw -= dx * 0.0042;
  state.camPitch = THREE.MathUtils.clamp(state.camPitch - dy * 0.0042, -1.5, 1.5);
});
el.addEventListener('pointerup', e => {
  dragging = false;
  el.releasePointerCapture?.(e.pointerId);
});
el.addEventListener('wheel', e => {
  e.preventDefault();
  state.camDist *= Math.pow(1.0016, e.deltaY);
  clampCamDist();
}, { passive: false });

let pinchDist = 0;
el.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    pinchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY);
  }
}, { passive: true });
el.addEventListener('touchmove', e => {
  if (e.touches.length === 2 && pinchDist) {
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY);
    state.camDist *= pinchDist / d;
    pinchDist = d;
    clampCamDist();
  }
}, { passive: true });

function clampCamDist() {
  const lim = { system: [1.2, 90000], stellar: [8, 3e5], galactic: [40, 1.4e6], cosmic: [120, 3e6] }[state.tier];
  state.camDist = THREE.MathUtils.clamp(state.camDist, lim[0], lim[1]);

  // Auto tier promotion / demotion at the boundaries
  const order = ['system', 'stellar', 'galactic', 'cosmic'];
  const i = order.indexOf(state.tier);
  if (state.camDist >= lim[1] * 0.97 && i < order.length - 1) {
    setTier(order[i + 1], { keepDist: false });
  } else if (state.camDist <= lim[0] * 1.03 && i > 0) {
    setTier(order[i - 1], { keepDist: false });
  }
}

function stepTier(dir) {
  const order = ['system', 'stellar', 'galactic', 'cosmic'];
  const i = THREE.MathUtils.clamp(order.indexOf(state.tier) + dir, 0, order.length - 1);
  setTier(order[i]);
}

/* Object picking */
const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = 0, downPos = [0, 0];
el.addEventListener('pointerdown', e => { downAt = performance.now(); downPos = [e.clientX, e.clientY]; });
el.addEventListener('pointerup', e => {
  const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  if (performance.now() - downAt > 380 || moved > 6) return;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(pointer, camera);

  if (state.tier === 'system') {
    const hits = ray.intersectObjects(pickables.map(p => p.mesh), false);
    if (hits.length) {
      const pk = pickables.find(p => p.mesh === hits[0].object);
      if (pk) select(pk.body);
      return;
    }
  }
  // Tier-level picking: nebulae, black holes, galaxies
  const grp = L[state.tier];
  ray.params.Points.threshold = state.camDist * 0.012;
  ray.params.Sprite = { threshold: 0 };
  const hits = ray.intersectObjects(grp.children, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.body) o = o.parent;
    if (o?.userData.body) { select(o.userData.body); return; }
    // Star point cloud
    if (h.object.userData.systems && h.index != null) {
      const s = h.object.userData.systems[h.index];
      if (s) { select(s); return; }
    }
  }
});

/* ============================================================
   SELECTION + INFO PANEL (§6)
   ============================================================ */
function select(body) {
  state.selected = body;
  state.target = body;
  renderInfo(body);
  if (body.spectralClass) state.spectralSeen.add(body.spectralClass);
  if (body.star?.spectralClass) state.spectralSeen.add(body.star.spectralClass);
  checkMissions();
  UI.orionProactive();
}

function provenance(body) {
  return body.real
    ? '<span class="prov obs">● Observed data</span>'
    : '<span class="prov gen">◇ Procedurally generated</span>';
}

function row(label, value, unit = '') {
  return `<div class="row"><dt>${label}</dt><dd>${value}${unit ? `<span class="u">${unit}</span>` : ''}</dd></div>`;
}

function renderInfo(b) {
  const p = $('info');
  let kind = '', sub = '', groups = '';

  if (b.kind === 'planet') {
    kind = 'Planet';
    sub = `${b.type} · orbiting ${b.star.name}`;
    const hz = Physics.habitableZone(b.star.luminosity);
    const inHZ = b.distanceM > hz.inner && b.distanceM < hz.outer;
    const esiCol = b.esi > 0.8 ? '#7fc98a' : b.esi > 0.5 ? '#ffb454' : '#e0607a';

    groups = `
      <div class="grp"><div class="grp-t">Physical</div>
        ${row('Radius', b.radiusE.toFixed(3), 'R⊕')}
        ${row('Diameter', (b.radiusE * 12742).toLocaleString(undefined, { maximumFractionDigits: 0 }), 'km')}
        ${row('Mass', b.massE.toLocaleString(undefined, { maximumFractionDigits: 3 }), 'M⊕')}
        ${row('Surface gravity', b.gravity.toFixed(2), 'm/s²')}
        ${row('Escape velocity', b.escapeVel.toFixed(2), 'km/s')}
        ${row('Composition', `<span style="font-size:10px">${b.composition}</span>`)}
      </div>
      <div class="grp"><div class="grp-t">Orbit &amp; rotation</div>
        ${row('Semi-major axis', b.distanceAU.toFixed(4), 'AU')}
        ${row('Eccentricity', b.orbit.e.toFixed(4))}
        ${row('Orbital period', b.orbitalPeriodDays > 900
            ? `${(b.orbitalPeriodDays / 365.25).toFixed(2)}` : b.orbitalPeriodDays.toFixed(2),
            b.orbitalPeriodDays > 900 ? 'yr' : 'd')}
        ${row('Rotation period', Math.abs(b.rotationHours).toFixed(2) + (b.rotationHours < 0 ? ' (retro)' : ''), 'h')}
        ${row('Axial tilt', b.axialTilt.toFixed(1), '°')}
        ${row('Natural satellites', b.moonCount)}
        ${b.hasRings ? row('Ring system', 'Present') : ''}
      </div>
      <div class="grp"><div class="grp-t">Environment</div>
        ${row('Mean temperature', b.temp, 'K')}
        ${row('', `<span style="color:var(--ink-3);font-size:10px">${(b.temp - 273.15).toFixed(0)} °C</span>`)}
        ${row('Atmosphere', `<span style="font-size:10px">${b.atmosphere}</span>`)}
        ${row('Habitable zone', inHZ
            ? '<span style="color:var(--green)">Within</span>'
            : `<span style="color:var(--ink-3)">${b.distanceM < hz.inner ? 'Interior' : 'Exterior'}</span>`)}
        <div class="meter">
          <div class="meter-l"><span>Earth Similarity Index</span><span>ESI</span></div>
          <div class="meter-t"><i class="meter-f" style="width:${b.esi * 100}%;background:${esiCol}"></i></div>
          <div class="meter-n" style="color:${esiCol}">${b.esi.toFixed(3)}</div>
        </div>
      </div>`;

    if (b.moons.length) {
      groups += `<div class="grp"><div class="grp-t">Modelled satellites</div>` +
        b.moons.map(m => row(m.name, `${m.orbitalPeriodDays.toFixed(2)} d`, '')).join('') + `</div>`;
    }
  }

  else if (b.kind === 'moon') {
    kind = 'Moon';
    sub = b.type;
    groups = `<div class="grp"><div class="grp-t">Physical</div>
      ${row('Radius', b.radiusE.toFixed(4), 'R⊕')}
      ${row('Mass', b.massE.toExponential(3), 'M⊕')}
      ${row('Type', b.type)}
    </div>
    <div class="grp"><div class="grp-t">Orbit</div>
      ${row('Distance from primary', b.distanceKm.toLocaleString(), 'km')}
      ${row('Orbital period', b.orbitalPeriodDays.toFixed(3), 'd')}
      ${row('Eccentricity', b.orbit.e.toFixed(4))}
    </div>`;
  }

  else if (b.kind === 'star') {
    kind = 'Star';
    sub = `${b.spectral} · main sequence`;
    const hz = Physics.habitableZone(b.luminosity);
    const lifeGyr = 10 * Math.pow(b.mass, -2.5);
    groups = `
      <div class="grp"><div class="grp-t">Stellar parameters</div>
        ${row('Spectral type', b.spectral)}
        ${row('Effective temperature', b.temp.toLocaleString(), 'K')}
        ${row('Luminosity', b.luminosity < 0.01 ? b.luminosity.toExponential(3) : b.luminosity.toFixed(4), 'L☉')}
        ${row('Radius', b.radius.toFixed(3), 'R☉')}
        ${row('Mass', b.mass.toFixed(3), 'M☉')}
        ${row('Age', b.age.toFixed(3), 'Gyr')}
        ${row('Main-seq. lifetime', lifeGyr > 1000 ? lifeGyr.toExponential(2) : lifeGyr.toFixed(2), 'Gyr')}
      </div>
      <div class="grp"><div class="grp-t">Planetary system</div>
        ${row('Detected planets', b.planetCount)}
        ${row('Habitable zone', `${(hz.inner / AU).toFixed(3)} – ${(hz.outer / AU).toFixed(3)}`, 'AU')}
        ${row('Galactic radius', Math.hypot(b.pos.x, b.pos.z).toLocaleString(undefined, { maximumFractionDigits: 0 }), 'ly')}
      </div>`;
  }

  else if (b.kind === 'galaxy') {
    kind = 'Galaxy';
    sub = b.type;
    groups = `
      <div class="grp"><div class="grp-t">Structure</div>
        ${row('Morphology', b.type)}
        ${row('Diameter', b.diameterLy.toLocaleString(), 'ly')}
        ${row('Stellar population', b.starCount.toExponential(2), 'stars')}
        ${b.armCount ? row('Spiral arms', b.armCount) : ''}
      </div>
      <div class="grp"><div class="grp-t">Central engine</div>
        ${row('Black hole mass', b.bhMass.toExponential(3), 'M☉')}
        ${row('Schwarzschild radius',
          (Physics.schwarzschildRadius(b.bhMass * SOLAR_MASS) / AU).toFixed(4), 'AU')}
      </div>
      <div class="grp"><div class="grp-t">Position</div>
        ${row('Distance', b.distanceLy === 0 ? 'Host galaxy'
            : `${(b.distanceLy / 1e6).toFixed(2)}`, b.distanceLy === 0 ? '' : 'Mly')}
        ${row('Redshift z', b.redshift.toFixed(4))}
        ${row('Recession velocity', b.distanceLy === 0 ? '—'
            : `${(b.redshift * 299792).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, b.distanceLy === 0 ? '' : 'km/s')}
      </div>`;
  }

  else if (b.kind === 'nebula') {
    kind = 'Nebula';
    sub = `${b.type} nebula`;
    groups = `
      <div class="grp"><div class="grp-t">Properties</div>
        ${row('Class', b.type)}
        ${row('Diameter', b.diameterLy.toFixed(1), 'ly')}
        ${row('Kinetic temperature', b.temp.toLocaleString(), 'K')}
        ${row('Number density', `<span style="font-size:10px">${b.density}</span>`)}
        ${row('Composition', `<span style="font-size:10px">${b.composition}</span>`)}
        ${row('Star forming', b.starForming
            ? '<span style="color:var(--green)">Active</span>' : 'Quiescent')}
      </div>
      <div class="grp"><div class="grp-t">Note</div>
        <div style="font-size:11px;color:var(--ink-2);line-height:1.55">
        Nebular gas is thinner than any laboratory vacuum. The visible structure
        is emission and scattering across light-years of path length, not density.</div>
      </div>`;
  }

  else if (b.kind === 'blackhole') {
    kind = b.supermassive ? 'Supermassive black hole' : 'Stellar-mass black hole';
    sub = `Spin parameter a* = ${b.spin}`;
    const mkg = b.massSolar * SOLAR_MASS;
    const rs = Physics.schwarzschildRadius(mkg);
    const dil = Physics.timeDilation(mkg, rs * 3);
    groups = `
      <div class="grp"><div class="grp-t">Horizon</div>
        ${row('Mass', b.massSolar.toExponential(3), 'M☉')}
        ${row('Schwarzschild radius', rs > AU ? (rs / AU).toFixed(4) : (rs / 1000).toFixed(1),
            rs > AU ? 'AU' : 'km')}
        ${row('Photon sphere', rs > AU ? (rs * 1.5 / AU).toFixed(4) : (rs * 1.5 / 1000).toFixed(1),
            rs > AU ? 'AU' : 'km')}
        ${row('ISCO', rs > AU ? (rs * 3 / AU).toFixed(4) : (rs * 3 / 1000).toFixed(1),
            rs > AU ? 'AU' : 'km')}
        ${row('Spin a*', b.spin.toFixed(3))}
      </div>
      <div class="grp"><div class="grp-t">Relativistic effects</div>
        ${row('Time dilation at ISCO', `×${dil.toFixed(4)}`)}
        ${row('Hawking temperature', (6.17e-8 / b.massSolar).toExponential(3), 'K')}
        ${row('Accretion rate', b.accretionRate, 'M☉/yr')}
      </div>
      <div class="grp"><div class="grp-t">What you are seeing</div>
        <div style="font-size:11px;color:var(--ink-2);line-height:1.55">
        The bright ring sits at 1.5 Schwarzschild radii — the photon sphere, where
        light can orbit. The disc is brighter on one limb because material there
        moves toward you at a large fraction of <i>c</i>, beaming its emission forward.
        <br><br><span style="color:var(--cyan)">Lensing here is a screen-space
        approximation, not geodesic integration.</span></div>
      </div>`;
  }

  else if (b.kind === 'comet') {
    kind = 'Comet';
    sub = 'Periodic';
    groups = `<div class="grp"><div class="grp-t">Orbit</div>
      ${row('Perihelion', b.perihelionAU.toFixed(3), 'AU')}
      ${row('Aphelion', b.aphelionAU.toFixed(2), 'AU')}
      ${row('Eccentricity', b.e.toFixed(4))}
      ${row('Period', b.periodYears.toFixed(2), 'yr')}
      ${row('Nucleus diameter', b.nucleusKm.toFixed(1), 'km')}
    </div>`;
  }

  p.innerHTML = `
    <div id="info-hero">
      <div id="info-kind">${kind}</div>
      <div id="info-name">${b.name}</div>
      <div id="info-sub">${sub}</div>
      ${provenance(b)}
    </div>
    ${groups}
    <div id="info-acts">
      <button class="iact" data-a="goto">Travel here</button>
      <button class="iact" data-a="log">Log discovery</button>
      <button class="iact" data-a="lab">Research Lab</button>
      <button class="iact" data-a="orion">Ask ORION</button>
      <button class="iact" data-a="compare">Compare</button>
      <button class="iact" data-a="close">Close</button>
    </div>`;
  p.classList.add('on');
  p.scrollTop = 0;

  p.querySelectorAll('.iact').forEach(btn => {
    btn.onclick = () => {
      const a = btn.dataset.a;
      if (a === 'goto') engageAutopilot();
      if (a === 'log') logDiscovery();
      if (a === 'compare') addCompare();
      if (a === 'lab') UI.openLab();
      if (a === 'orion') {
        if (!$('orion').classList.contains('on')) $('b-orion').click();
        $('orion-in').value = 'Explain this object to me';
        UI.orionSubmit();
      }
      if (a === 'close') p.classList.remove('on');
    };
  });
}

/* ============================================================
   NAVIGATION (§4)
   ============================================================ */
function bodyWorldPosition(b) {
  // Find its scene object at the current tier
  const e = sysBodies.find(x => x.body === b);
  if (e) return e.obj.position.clone();

  for (const grp of Object.values(L)) {
    for (const c of grp.children) {
      if (c.userData.body === b) return c.position.clone();
    }
  }
  return new THREE.Vector3();
}

function engageAutopilot() {
  if (!state.target) { toast('No target selected'); return; }
  const b = state.target;

  // Cross-tier travel: switch scene first, then approach
  if (b.kind === 'galaxy' && b.idx !== state.galaxyIdx) {
    state.galaxyIdx = b.idx; state.starIdx = 0;
    state.galaxiesVisited.add(b.idx);
    clearGroup(L.system); clearGroup(L.stellar); clearGroup(L.galactic);
    setTier('galactic', { force: true });
    toast(`Arrived: ${b.name}`);
    award(XP.newGalaxy, 'New galaxy reached');
    checkMissions();
    return;
  }
  if (b.kind === 'star' && b.idx !== state.starIdx) {
    state.starIdx = b.idx;
    clearGroup(L.system);
    setTier('system', { force: true });
    toast(`Entered system: ${b.name}`);
    award(XP.newSystem, 'New system');
    announceSystem();
    checkMissions();
    return;
  }
  if ((b.kind === 'planet' || b.kind === 'moon' || b.kind === 'comet') && state.tier !== 'system') {
    setTier('system');
  }
  if ((b.kind === 'nebula' || b.kind === 'blackhole') && state.tier !== 'stellar') {
    setTier('stellar');
  }

  const p = bodyWorldPosition(b);
  ship.autopilot = { target: p, body: b };
  toast(`Autopilot engaged → ${b.name}`);
}

function cycleView() {
  const modes = ['cockpit', 'chase', 'free'];
  ship.view = modes[(modes.indexOf(ship.view) + 1) % 3];
  toast(`View: ${ship.view}`);
}

/* ============================================================
   DISCOVERY LOG + COMPARISON (§5)
   ============================================================ */
function logDiscovery() {
  const b = state.selected;
  if (!b) { toast('Select an object first'); return; }
  if (state.log.some(x => x.name === b.name)) { toast('Already logged'); return; }
  state.log.unshift({
    name: b.name, kind: b.kind, body: b,
    meta: b.kind === 'planet' ? `${b.type} · ESI ${b.esi.toFixed(3)}`
      : b.kind === 'star' ? b.spectral
      : b.kind === 'galaxy' ? b.type
      : b.kind === 'nebula' ? `${b.type} nebula`
      : b.kind === 'blackhole' ? `${b.massSolar.toExponential(2)} M☉` : b.type || '',
    stamp: clock.date,
  });
  state.logged.add(b.name);
  if (b.star) state.systemsLogged.add(b.star.name);
  award(b.kind === 'planet' ? XP.planetLog : XP.discover, `Logged ${b.name}`);
  checkMissions();
  if ($('drawer').dataset.mode === 'log' && $('drawer').classList.contains('on')) UI.renderJournal();
}

function addCompare() {
  const b = state.selected;
  if (!b || !['planet', 'moon'].includes(b.kind)) { toast('Select a planet or moon'); return; }
  if (state.compare.some(x => x.name === b.name)) { toast('Already in comparison'); return; }
  if (state.compare.length >= 3) state.compare.shift();
  state.compare.push(b);
  renderCompare();
  checkMissions();
}

function renderCompare() {
  const wrap = $('compare'), t = $('ctable');
  if (!state.compare.length) { wrap.classList.remove('on'); return; }
  wrap.classList.add('on');
  t.innerHTML = state.compare.map((b, i) => `
    <div class="ccol">
      <div class="ccol-h"><span class="ccol-n">${b.name}</span>
        <button class="ccol-x" data-i="${i}">✕</button></div>
      <div class="crow"><span>Radius</span><span>${b.radiusE.toFixed(3)} R⊕</span></div>
      <div class="crow"><span>Mass</span><span>${b.massE < 0.01 ? b.massE.toExponential(2) : b.massE.toFixed(3)} M⊕</span></div>
      ${b.gravity != null ? `<div class="crow"><span>Gravity</span><span>${b.gravity.toFixed(2)} m/s²</span></div>` : ''}
      ${b.temp != null ? `<div class="crow"><span>Temp</span><span>${b.temp} K</span></div>` : ''}
      ${b.atmosphere ? `<div class="crow"><span>Atmosphere</span><span style="font-size:9px">${b.atmosphere}</span></div>` : ''}
      ${b.esi != null ? `<div class="crow"><span>ESI</span><span style="color:${b.esi > 0.8 ? '#7fc98a' : '#ffb454'}">${b.esi.toFixed(3)}</span></div>` : ''}
      ${b.distanceAU != null ? `<div class="crow"><span>Distance</span><span>${b.distanceAU.toFixed(3)} AU</span></div>` : ''}
      ${b.moonCount != null ? `<div class="crow"><span>Moons</span><span>${b.moonCount}</span></div>` : ''}
    </div>`).join('');
  t.querySelectorAll('.ccol-x').forEach(b => {
    b.onclick = () => { state.compare.splice(+b.dataset.i, 1); renderCompare(); };
  });
}
$('c-clear').onclick = () => { state.compare = []; renderCompare(); };

/* ============================================================
   MISSIONS (§8)
   ============================================================ */
/* ============================================================
   MISSION EVALUATION + PROGRESSION
   ============================================================ */
function missionContext() {
  const star = uni.getSystems(state.galaxyIdx)[state.starIdx];
  return {
    body: state.selected, star, tier: state.tier, galaxyIdx: state.galaxyIdx,
    logged: state.logged, reports: state.reports, scanned: state.scanned,
    analysed: state.analysed, experiments: state.experiments,
    spectral: state.spectralSeen, galaxies: state.galaxiesVisited,
    asked: state.asked, compare: state.compare,
    exoLogged: state.tracks.exoplanets,
    nebulaeLogged: state.log.filter(x => x.kind === 'nebula').length,
    bhLogged: state.log.filter(x => x.kind === 'blackhole').length,
    systemsLogged: state.systemsLogged,
  };
}

function checkMissions() {
  const done = evaluate(state.missions, missionContext());
  for (const d of done) {
    if (d.complete) {
      state.badges.push(d.mission.badge);
      award(XP.missionDone, `Mission complete — ${d.mission.title}`, 'badge');
    } else {
      award(XP.missionStep, `${d.mission.icon} ${d.stage.label}`);
    }
  }
  refreshTracks();
  if ($('drawer').dataset.mode === 'missions' && $('drawer').classList.contains('on')) UI.renderMissions();
  if ($('drawer').dataset.mode === 'progress' && $('drawer').classList.contains('on')) UI.renderProgress();
}

function refreshTracks() {
  const SOL = ['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune'];
  state.tracks.solPlanets = SOL.filter(n => state.logged.has(n)).length;
  state.tracks.galaxies = state.galaxiesVisited.size;
  state.tracks.exoplanets = state.log.filter(x => x.kind === 'planet' && !x.body.real).length;
  state.tracks.blackholes = state.log.filter(x => x.kind === 'blackhole').length;
  state.tracks.reports = state.reports.size;
  state.tracks.spectral = state.spectralSeen.size;
  state.tracks.experiments = state.experiments.size;
  state.tracks.logged = state.log.length;
}

function award(xp, msg, cls = '') {
  const before = levelFor(state.xp).level;
  state.xp += xp;
  const after = levelFor(state.xp).level;
  if (msg) toast(`+${xp} XP · ${msg}`, cls);
  if (after > before) {
    const L = levelFor(state.xp);
    setTimeout(() => toast(`Level ${after} — ${L.title}`, 'badge'), 700);
  }
}

/* ============================================================
   DRAWER (missions / log)
   ============================================================ */
function toggleDrawer(mode) {
  const d = $('drawer');
  if (d.classList.contains('on') && d.dataset.mode === mode) {
    d.classList.remove('on');
    ['b-missions', 'b-log', 'b-progress'].forEach(x => $(x).classList.remove('on'));
    return;
  }
  renderDrawer(mode);
}

function renderDrawer(mode) {
  refreshTracks();
  ['b-missions', 'b-log', 'b-progress'].forEach(x => $(x).classList.remove('on'));
  if (mode === 'missions') { UI.renderMissions(); $('b-missions').classList.add('on'); }
  else if (mode === 'progress') { UI.renderProgress(); $('b-progress').classList.add('on'); }
  else { UI.renderJournal(); $('b-log').classList.add('on'); }
}

/* ============================================================
   SETTINGS (§11)
   ============================================================ */
function renderSettings() {
  const s = state.settings;
  $('settings').innerHTML = `
    <div class="panel-hd"><span><i class="dot"></i> Settings</span></div>
    <div class="setrow"><div><div class="set-l">Orbital paths</div>
      <div class="set-d">Show computed ellipses</div></div>
      <div class="tog ${s.orbits ? 'on' : ''}" data-k="orbits"></div></div>
    <div class="setrow"><div><div class="set-l">Atmospheric scattering</div>
      <div class="set-d">Limb glow on planets</div></div>
      <div class="tog ${s.atmosphere ? 'on' : ''}" data-k="atmosphere"></div></div>
    <div class="setrow"><div><div class="set-l">Bloom</div>
      <div class="set-d">Tone-mapped highlight bleed</div></div>
      <div class="tog ${s.bloom ? 'on' : ''}" data-k="bloom"></div></div>
    <div class="setrow"><div><div class="set-l">Label generated content</div>
      <div class="set-d">Distinguish observed from simulated</div></div>
      <div class="tog ${s.showGenerated ? 'on' : ''}" data-k="showGenerated"></div></div>
    <div class="setrow"><div><div class="set-l">Render quality</div>
      <div class="set-d">Resolution scale</div></div>
      <select class="sel" id="q-sel">
        <option value="low"${s.quality === 'low' ? ' selected' : ''}>Low</option>
        <option value="medium"${s.quality === 'medium' ? ' selected' : ''}>Medium</option>
        <option value="high"${s.quality === 'high' ? ' selected' : ''}>High</option>
      </select></div>
    <div class="setrow"><div><div class="set-l">Universe seed</div>
      <div class="set-d">Regenerates everything</div></div>
      <span style="font-family:var(--f-mono);font-size:11px;color:var(--amber)">${uni.seed}</span></div>`;

  $('settings').querySelectorAll('.tog').forEach(t => {
    t.onclick = () => {
      const k = t.dataset.k;
      state.settings[k] = !state.settings[k];
      t.classList.toggle('on');
      applySettings();
    };
  });
  $('q-sel').onchange = e => {
    state.settings.quality = e.target.value;
    const r = { low: 0.6, medium: 0.85, high: Math.min(devicePixelRatio, 2) }[e.target.value];
    renderer.setPixelRatio(r);
  };
}

function applySettings() {
  L.system.traverse(o => {
    if (o.userData.orbit) o.visible = state.settings.orbits;
  });
  for (const e of sysBodies) {
    if (e.obj.userData?.atmosphere) e.obj.userData.atmosphere.visible = state.settings.atmosphere;
  }
  renderer.toneMappingExposure = state.settings.bloom ? 1.18 : 0.94;
}

/* ============================================================
   SCALE LADDER (signature element)
   ============================================================ */
function renderLadder() {
  const dist = currentMetricDistance();
  const active = scaleFor(dist);
  $('ladder').innerHTML = SCALES.map(s => `
    <button class="rung ${s.id === active.id ? 'on' : ''}" data-s="${s.id}"
            aria-label="${s.label} scale">
      <span class="rung-bar"></span>
      <span class="rung-txt">${s.label}<span class="rung-sub">${s.desc}</span></span>
    </button>`).join('');
  $('ladder').querySelectorAll('.rung').forEach(r => {
    r.onclick = () => {
      const map = { surface: 'system', planet: 'system', system: 'system',
        stellar: 'stellar', galactic: 'galactic', cosmic: 'cosmic' };
      setTier(map[r.dataset.s]);
      if (r.dataset.s === 'surface') state.camDist = 2;
      if (r.dataset.s === 'planet') state.camDist = 8;
    };
  });
}

/* ============================================================
   TOASTS
   ============================================================ */
function toast(msg, cls = '') {
  const t = document.createElement('div');
  t.className = `toast panel ${cls}`;
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .4s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 420);
  }, 2600);
}

/* ============================================================
   SEARCH (§5)
   ============================================================ */
const searchEl = $('search'), resultsEl = $('results');
let searchTimer;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = searchEl.value.trim();
    if (q.length < 2) { resultsEl.classList.remove('on'); return; }
    const hits = uni.search(q);
    if (!hits.length) {
      resultsEl.innerHTML = `<div class="empty">
        <div class="empty-t">No object matches “${q}”.</div>
        <div class="empty-h">Try Earth, Sol, Sagittarius A*, or a catalogue prefix like HD</div></div>`;
      resultsEl.classList.add('on');
      return;
    }
    resultsEl.innerHTML = hits.map((h, i) => `
      <div class="res" data-i="${i}">
        <div><div class="res-n">${h.name}</div><div class="res-l">${h._label}</div></div>
        <div class="res-k">${h.kind}</div>
      </div>`).join('');
    resultsEl.classList.add('on');
    resultsEl.querySelectorAll('.res').forEach(r => {
      r.onclick = () => {
        const h = hits[+r.dataset.i];
        resultsEl.classList.remove('on');
        searchEl.value = '';
        // Navigate to the right tier for the hit
        if (h.kind === 'galaxy') { state.target = h; select(h); engageAutopilot(); }
        else if (h.kind === 'star') { state.target = h; select(h); engageAutopilot(); }
        else { setTier(h.kind === 'nebula' || h.kind === 'blackhole' ? 'stellar' : 'system');
               const live = findLive(h.name); select(live || h); }
      };
    });
  }, 170);
});
searchEl.addEventListener('blur', () => setTimeout(() => resultsEl.classList.remove('on'), 200));

function findLive(name) {
  const e = sysBodies.find(x => x.body.name === name);
  if (e) return e.body;
  for (const grp of Object.values(L)) {
    for (const c of grp.children) if (c.userData.body?.name === name) return c.userData.body;
  }
  return null;
}

/* ============================================================
   TIME UI (§7)
   ============================================================ */
function togglePause() {
  clock.paused = !clock.paused;
  $('t-play').textContent = clock.paused ? '▶' : '❚❚';
  $('t-play').classList.toggle('on', clock.paused);
  updateTimeUI();
}
function updateTimeUI() {
  $('trate').textContent = clock.rateLabel;
  $('tdate').textContent = clock.date;
}
$('t-play').onclick = togglePause;
$('t-slow').onclick = () => { clock.slower(); updateTimeUI(); };
$('t-fast').onclick = () => { clock.faster(); updateTimeUI(); };
$('t-reset').onclick = () => { clock.t = 0; clock.setRateIdx(3); updateTimeUI(); };

/* ============================================================
   DEMO DIRECTOR (§15)
   ============================================================ */
function startDemo() {
  state.demo = { step: -1, t: 0 };
  $('demo').classList.add('on');
  $('info').classList.remove('on');
  $('drawer').classList.remove('on');
  $('compare').classList.remove('on');
  clock.setRateIdx(7);
  clock.paused = false;
  nextDemoStep();
}

function nextDemoStep() {
  const d = state.demo;
  if (!d) return;
  d.step++;
  if (d.step >= DEMO_SEQUENCE.length) { endDemo(); return; }

  const s = DEMO_SEQUENCE[d.step];
  d.t = 0;
  d.dwell = s.dwell;
  state.demoFocus = null;   // cleared per beat; only nebula/BH set it

  const card = $('demo-card');
  card.classList.remove('show');

  setTimeout(() => {
    $('demo-step').textContent = `${String(d.step + 1).padStart(2, '0')} / ${String(DEMO_SEQUENCE.length).padStart(2, '0')}`;
    $('demo-title').textContent = s.title;
    $('demo-cap').textContent = s.caption;
    card.classList.add('show');
  }, 520);

  // Move the camera to the right place for this beat
  const T = s.target;
  if (T.type === 'planet') {
    if (state.galaxyIdx !== 0 || state.starIdx !== 0) {
      state.galaxyIdx = 0; state.starIdx = 0;
      clearGroup(L.system); clearGroup(L.stellar);
    }
    setTier('system', { force: state.tier !== 'system' });
    const b = sysBodies.find(x => x.body.name === T.name);
    if (b) { state.target = b.body; state.selected = b.body; }
    state.camDist = 6;
  }
  else if (T.type === 'system') { setTier('system'); state.camDist = 260; state.target = null; }
  else if (T.type === 'galaxy') {
    state.galaxyIdx = T.idx;
    clearGroup(L.galactic);
    setTier('galactic', { force: true });
    state.camDist = 2400;
  }
  else if (T.type === 'deepspace') { setTier('stellar'); state.camDist = 1800; ship.warp = 4e5; }
  else if (T.type === 'nebula') {
    setTier('stellar');
    ship.warp = 0;
    const neb = L.stellar.children.find(c => c.userData.body?.kind === 'nebula');
    if (neb) { state.target = neb.userData.body; state.demoFocus = neb; }
    state.camDist = 260;
  }
  else if (T.type === 'exoplanet') {
    // Find a GENERATED world with a high ESI.
    // Start at i=1 and require !p.real so Sol's Earth (ESI 1.000)
    // can never win this beat — the point of the shot is that the
    // engine produced a habitable world on its own.
    const systems = uni.getSystems(state.galaxyIdx);
    let best = null, bestP = null;
    for (let i = 1; i < Math.min(120, systems.length); i++) {
      for (const p of uni.getPlanets(systems[i])) {
        if (p.real) continue;
        if (!bestP || p.esi > bestP.esi) { best = systems[i]; bestP = p; }
      }
    }
    if (best) {
      state.starIdx = best.idx;
      clearGroup(L.system);
      setTier('system', { force: true });
      const b = sysBodies.find(x => x.body.name === bestP.name);
      if (b) { state.target = b.body; state.selected = b.body; }
      state.camDist = 7;
    }
  }
  else if (T.type === 'blackhole') {
    setTier('stellar');
    const bh = L.stellar.children.find(c => c.userData.body?.kind === 'blackhole');
    if (bh) { state.target = bh.userData.body; state.demoFocus = bh; }
    state.camDist = 90;
  }
}

function endDemo() {
  state.demo = null;
  ship.warp = 0;
  $('demo').classList.remove('on');
  $('demo-card').classList.remove('show');
  toast('Demo complete');
}
$('demo-exit').onclick = endDemo;
$('b-demo').onclick = () => state.demo ? endDemo() : startDemo();

/* ============================================================
   UI WIRING
   ============================================================ */
$('b-missions').onclick = () => toggleDrawer('missions');
$('b-log').onclick = () => toggleDrawer('log');
$('b-progress').onclick = () => toggleDrawer('progress');
$('b-orion').onclick = () => {
  const o = $('orion');
  o.classList.toggle('on');
  $('b-orion').classList.toggle('on', o.classList.contains('on'));
  if (o.classList.contains('on') && !o.dataset.init) {
    o.dataset.init = '1';
    UI.renderOrion();
  }
};
$('b-lab').onclick = () => UI.openLab();
$('b-whatif').onclick = () => UI.openWhatIf();
$('b-story').onclick = () => state.story ? UI.endStory() : UI.startStory();
$('story-exit').onclick = () => UI.endStory();

/* ---- Story mode camera director ---- */
function storyTarget(s) {
  const T = s.target;
  if (T.type === 'planet') {
    if (state.galaxyIdx !== 0 || state.starIdx !== 0) {
      state.galaxyIdx = 0; state.starIdx = 0;
      clearGroup(L.system); clearGroup(L.stellar); clearGroup(L.galactic);
    }
    setTier('system', { force: state.tier !== 'system' });
    const b = sysBodies.find(x => x.body.name === T.name);
    if (b) { state.target = b.body; state.selected = b.body; }
  } else if (T.type === 'system') { setTier('system'); state.target = null; }
  else if (T.type === 'stellar') { setTier('stellar'); state.target = null; }
  else if (T.type === 'galaxy') { setTier('galactic'); state.target = null; }
  else if (T.type === 'cosmic') { setTier('cosmic'); state.target = null; }
  state.camDist = s.dist;
}

/* ---- System arrival briefing (§8) ---- */
function announceSystem() {
  const star = uni.getSystems(state.galaxyIdx)[state.starIdx];
  if (!star || state.briefed.has(`${state.galaxyIdx}:${star.idx}`)) return;
  state.briefed.add(`${state.galaxyIdx}:${star.idx}`);
  const planets = uni.getPlanets(star);
  const text = UI.orionBriefing(star, planets);
  if (!$('orion').classList.contains('on')) toast(`ORION: ${text.slice(0, 64)}…`, 'orion');
}

/* ---- Bind the UI module to shared state ---- */
state.uni = uni;
UI.bindUI(state, {
  nudge: (t) => toast(t, 'orion'),
  award: (xp, msg) => award(xp, msg),
  checkMissions: () => checkMissions(),
  select: (b) => select(b),
  storyTarget,
  onAsk: () => checkMissions(),
  travelBest: () => { if (state.target) engageAutopilot(); },
});

function closeAll() {
  $('info').classList.remove('on');
  $('drawer').classList.remove('on');
  $('settings').classList.remove('on');
  $('tut').classList.remove('on');
  resultsEl.classList.remove('on');
  ['b-missions', 'b-log', 'b-progress', 'b-orion'].forEach(x => $(x)?.classList.remove('on'));
  $('orion').classList.remove('on');
  $('lab').classList.remove('on');
  $('whatif').classList.remove('on');
}

/* Touch controls */
const stick = $('stick'), knob = stick?.firstElementChild;
if (stick) {
  let sid = null;
  stick.addEventListener('pointerdown', e => { sid = e.pointerId; stick.setPointerCapture(sid); });
  stick.addEventListener('pointermove', e => {
    if (e.pointerId !== sid) return;
    const r = stick.getBoundingClientRect();
    let dx = (e.clientX - r.left - r.width / 2) / (r.width / 2);
    let dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    stickVec = { x: dx, y: dy };
    knob.style.transform = `translate(calc(-50% + ${dx * 32}px), calc(-50% + ${dy * 32}px))`;
  });
  const rel = e => {
    if (e.pointerId !== sid) return;
    sid = null; stickVec = { x: 0, y: 0 };
    knob.style.transform = 'translate(-50%,-50%)';
  };
  stick.addEventListener('pointerup', rel);
  stick.addEventListener('pointercancel', rel);
}
document.querySelectorAll('.tb').forEach(b => {
  b.addEventListener('pointerdown', () => {
    if (b.dataset.t === 'up') keys.KeyW = true;
    if (b.dataset.t === 'down') keys.KeyS = true;
    if (b.dataset.t === 'warp') keys.ShiftLeft = !keys.ShiftLeft;
  });
  b.addEventListener('pointerup', () => {
    if (b.dataset.t === 'up') keys.KeyW = false;
    if (b.dataset.t === 'down') keys.KeyS = false;
  });
});

/* ============================================================
   MAIN LOOP
   ============================================================ */
let last = performance.now();
let fpsAcc = 0, fpsN = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.05, (now - last) / 1000);
  last = now;

  clock.step(dtReal);

  /* --- input --- */
  const input = {
    thrust: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
    pitch: (keys.ArrowUp ? -1 : 0) + (keys.ArrowDown ? 1 : 0) - stickVec.y,
    yaw: (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0) - stickVec.x,
    roll: (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0),
    brake: keys.KeyX,
  };

  if (!state.demo) {
    ship.warp = (keys.ShiftLeft || keys.ShiftRight)
      ? Math.min(ship.maxWarp, 200 + Math.abs(ship.throttle) * 4e5) : 0;
    ship.applyInput(input, dtReal);
  }

  /* --- autopilot --- */
  if (ship.autopilot) {
    const tp = bodyWorldPosition(ship.autopilot.body);
    const camPos = camera.position;
    const to = tp.clone().sub(camPos);
    const dist = to.length();
    const want = Math.max(2.4, dist * 0.06);
    if (Math.abs(state.camDist - want) > 0.2) {
      state.camDist += (want - state.camDist) * Math.min(1, dtReal * 1.5);
    } else {
      toast(`Arrived: ${ship.autopilot.body.name}`);
      checkMissions();
      ship.autopilot = null;
    }
  }

  ship.update(dtReal);
  updateOrbits();

  /* --- camera --- */
  let focus = new THREE.Vector3();
  if (state.target) {
    const fp = bodyWorldPosition(state.target);
    if (fp.lengthSq() > 0 || state.tier === 'system') focus.copy(fp);
  }
  // Nebula and black-hole beats focus a scene object rather than a body
  if (state.demo && state.demoFocus) focus.copy(state.demoFocus.position);

  // Orbital camera around the focus, with ship offset applied in free mode
  const cy = state.camYaw, cp = state.camPitch, cd = state.camDist;
  const off = new THREE.Vector3(
    cd * Math.cos(cp) * Math.sin(cy),
    cd * Math.sin(cp),
    cd * Math.cos(cp) * Math.cos(cy)
  );
  const want = focus.clone().add(off).add(ship.pos);
  camera.position.lerp(want, Math.min(1, dtReal * 6));
  camera.lookAt(focus.clone().add(ship.pos));

  // Near/far follow the camera distance so precision stays usable
  camera.near = Math.max(0.001, cd * 0.0006);
  camera.far = cd * 4200;
  camera.updateProjectionMatrix();

  starfield.position.copy(camera.position);

  /* --- story mode advance --- */
  if (state.story) {
    UI.tickStory(dtReal);
    state.camYaw += dtReal * 0.045;
  }

  /* --- demo advance --- */
  if (state.demo) {
    state.demo.t += dtReal;
    // Slow orbital drift so the shot is never static
    state.camYaw += dtReal * 0.05;
    $('demo-prog').firstElementChild.style.width =
      `${((state.demo.step + state.demo.t / state.demo.dwell) / DEMO_SEQUENCE.length) * 100}%`;
    if (state.demo.t >= state.demo.dwell) nextDemoStep();
  }

  /* --- animated uniforms --- */
  starfield.userData.mat.uniforms.uTime.value = now / 1000;
  L.system.traverse(o => {
    if (o.material?.uniforms?.uTime) o.material.uniforms.uTime.value = now / 1000;
  });
  L.stellar.traverse(o => {
    if (o.material?.uniforms?.uTime) o.material.uniforms.uTime.value = now / 1000;
  });

  updateHUD();
  renderer.render(scene, camera);
}

/* ============================================================
   HUD UPDATE
   ============================================================ */
let hudTick = 0;
function updateHUD() {
  if (++hudTick % 4) return;   // 15 Hz is plenty for text

  const metric = currentMetricDistance();
  const vel = ship.warp > 0
    ? `${(ship.warp * TIER_SCALE[state.tier] / C / 1e3).toExponential(1)} kc`
    : `${(ship.vel.length() * TIER_SCALE[state.tier] / 1000).toExponential(1)} km/s`;
  $('g-vel').textContent = ship.speed < 0.001 ? '0 m/s' : vel;

  $('g-thr').textContent = `${Math.round(ship.throttle * 100)}%`;
  $('g-thrb').style.width = `${Math.abs(ship.throttle) * 100}%`;
  $('g-fuel').textContent = `${Math.round(ship.fuel)}%`;
  $('g-fuelb').style.width = `${ship.fuel}%`;
  $('g-fuelbar').classList.toggle('lo', ship.fuel < 25);
  $('g-pow').textContent = `${Math.round(ship.energy)}%`;
  $('g-powb').style.width = `${ship.energy}%`;
  $('g-powbar').classList.toggle('lo', ship.energy < 25);

  if (state.target) {
    $('g-tgt').textContent = state.target.name.length > 12
      ? state.target.name.slice(0, 11) + '…' : state.target.name;
    const tp = bodyWorldPosition(state.target);
    const d = camera.position.distanceTo(tp) * TIER_SCALE[state.tier];
    const sp = Math.max(1e-6, ship.speed * TIER_SCALE[state.tier]);
    $('g-eta').textContent = ship.speed > 0.01 ? formatTime(d / sp) : formatDistance(d);
    updateLock(tp);
  } else {
    $('g-tgt').textContent = 'None';
    $('g-eta').textContent = '—';
    $('lock').classList.remove('on');
  }

  updateTimeUI();

  // Refresh the ladder only when the tier's active rung would change
  const a = scaleFor(metric).id;
  if (a !== state._lastScale) { state._lastScale = a; renderLadder(); }
}

function updateLock(worldPos) {
  const v = worldPos.clone().project(camera);
  const lock = $('lock');
  if (v.z > 1 || Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.15) {
    lock.classList.remove('on'); return;
  }
  const x = (v.x * 0.5 + 0.5) * innerWidth;
  const y = (-v.y * 0.5 + 0.5) * innerHeight;
  const d = camera.position.distanceTo(worldPos) * TIER_SCALE[state.tier];
  const size = THREE.MathUtils.clamp(2200 / (camera.position.distanceTo(worldPos) + 1), 22, 90);

  lock.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px`;
  lock.classList.add('on');
  lock.innerHTML = `
    <span class="lock-b" style="left:0;top:0;border-right:0;border-bottom:0"></span>
    <span class="lock-b" style="right:0;top:0;border-left:0;border-bottom:0"></span>
    <span class="lock-b" style="left:0;bottom:0;border-right:0;border-top:0"></span>
    <span class="lock-b" style="right:0;bottom:0;border-left:0;border-top:0"></span>
    <span class="lock-l">${state.target.name}</span>
    <span class="lock-d">${formatDistance(d)}</span>`;
}

/* ============================================================
   INIT
   ============================================================ */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function init() {
  buildSystemScene();
  setTier('system', { force: true });

  // Park above Earth
  const earth = sysBodies.find(x => x.body.name === 'Earth');
  if (earth) { state.target = earth.body; state.selected = earth.body; state.earthRef = earth.body; }
  state.camDist = 7;

  // Precompute population statistics so ORION's anomaly scan is
  // instant the first time it is asked.
  buildPopulationStats(uni);
  refreshTracks();

  renderLadder();
  updateTimeUI();
  renderSettings();

  setTimeout(() => {
    $('load').classList.add('out');
    setTimeout(() => { $('load').style.display = 'none'; }, 900);
    if (!localStorage.getItem('aether-seen')) {
      $('tut').classList.add('on');
      localStorage.setItem('aether-seen', '1');
    }
  }, 1500);

  requestAnimationFrame(frame);
}

init();
