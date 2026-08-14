/* ============================================================
   COSMOS-X — orion.js
   ORION: Intelligent Space Exploration Assistant
   ============================================================
   Design note: ORION derives every answer from the object's
   actual computed physical values. It is not a chatbot with a
   script — it classifies the question, pulls the relevant
   quantities, and reasons over them numerically. That means it
   works offline, answers instantly, and can never contradict
   the simulation, because it reads the same numbers the
   renderer does.

   An optional Claude API path is available (see askRemote) for
   open-ended conversation. The demo path never touches it.
   ============================================================ */
import { Physics, AU, SOLAR_MASS, EARTH_MASS, EARTH_RADIUS, C } from './engine.js';

/* "CO₂" contains the substring "O₂", so a naive includes('O₂')
   test reports a carbon dioxide atmosphere as breathable oxygen.
   Strip the carbon dioxide (and carbon monoxide) tokens first,
   then look for free molecular oxygen in what remains. */
export function hasFreeOxygen(atm) {
  if (!atm || atm === 'None') return false;
  return atm.replace(/CO₂/g, '').replace(/CO\b/g, '').includes('O₂');
}

export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

/* ============================================================
   POPULATION STATISTICS
   Used for outlier detection — "what makes this unusual" must
   compare against the real generated population, not a guess.
   ============================================================ */
let POP = null;

export function buildPopulationStats(uni, galaxies = 4, systemsEach = 40) {
  if (POP) return POP;
  const vals = { radiusE: [], massE: [], temp: [], esi: [], ecc: [], grav: [], period: [] };
  let n = 0;
  for (let g = 0; g < galaxies; g++) {
    const systems = uni.getSystems(g);
    for (let i = 0; i < Math.min(systemsEach, systems.length); i++) {
      for (const p of uni.getPlanets(systems[i])) {
        vals.radiusE.push(p.radiusE); vals.massE.push(p.massE);
        vals.temp.push(p.temp); vals.esi.push(p.esi);
        vals.ecc.push(p.orbit.e); vals.grav.push(p.gravity);
        vals.period.push(p.orbitalPeriodDays);
        n++;
      }
    }
  }
  const stat = a => {
    const s = [...a].sort((x, y) => x - y);
    const mean = a.reduce((p, c) => p + c, 0) / a.length;
    const sd = Math.sqrt(a.reduce((p, c) => p + (c - mean) ** 2, 0) / a.length);
    return { mean, sd, med: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], p10: s[Math.floor(s.length * 0.1)] };
  };
  POP = { n };
  for (const k in vals) POP[k] = stat(vals[k]);
  return POP;
}

/* ============================================================
   PHYSICAL DERIVATIONS ORION USES
   ============================================================ */

/* Surface colour cause, from composition and temperature */
function colourCause(b) {
  const t = b.type;
  if (t === 'Desert') return {
    tone: 'red-orange',
    cause: 'oxidised iron in the surface dust — the same chemistry as rust',
    detail: 'Iron-bearing minerals weathered in the presence of oxygen or water form iron(III) oxides, which absorb blue and green wavelengths and reflect red.',
  };
  if (t === 'Molten') return {
    tone: 'red-orange, self-luminous',
    cause: `thermal emission — at ${b.temp} K the surface glows on its own`,
    detail: `A blackbody at ${b.temp} K peaks near ${(2.898e6 / b.temp).toFixed(0)} nm. That is why it looks red rather than reflecting a colour from its star.`,
  };
  if (t === 'Ocean' || t === 'Terrestrial') return {
    tone: 'blue and white',
    cause: 'liquid water absorbing red light, plus Rayleigh scattering in the atmosphere',
    detail: 'Water absorbs strongly in the infrared and red. Short wavelengths scatter roughly as λ⁻⁴ in a nitrogen atmosphere, so the limb is blue and the clouds are white.',
  };
  if (t === 'Ice') return {
    tone: 'white to pale blue',
    cause: 'high-albedo water and methane ice reflecting most incident light',
    detail: `Albedo near 0.6 means most starlight is reflected rather than absorbed, which is part of why the surface stays at ${b.temp} K.`,
  };
  if (t === 'Gas giant') return {
    tone: 'banded cream and ochre',
    cause: 'ammonia ice clouds over deeper sulphur and phosphorus compounds',
    detail: 'The bands are zonal jets. Rising ammonia freezes into bright white zones; sinking gas exposes darker chromophores in the belts below.',
  };
  if (t === 'Ice giant') return {
    tone: 'blue-green',
    cause: 'methane in the upper atmosphere absorbing red light',
    detail: 'CH₄ has strong absorption bands in the red and near-infrared. Removing red from reflected sunlight leaves the cyan you see.',
  };
  if (t === 'Barren rock') return {
    tone: 'grey-brown',
    cause: 'unweathered silicate rock with no atmosphere to scatter light',
    detail: 'Without air or water there is no chemical weathering to produce coloured oxides, and no scattering to tint the sky.',
  };
  return {
    tone: 'muted',
    cause: 'a mixed silicate and volatile surface',
    detail: 'Composition and grain size dominate the reflectance spectrum here.',
  };
}

/* Human survivability audit — every factor computed, not asserted */
export function survivalAudit(b) {
  const f = [];
  const G_E = 9.82;

  // Gravity
  const gr = b.gravity / G_E;
  f.push({
    factor: 'Gravity', value: `${b.gravity.toFixed(2)} m/s² (${gr.toFixed(2)}× Earth)`,
    ok: gr > 0.4 && gr < 1.6,
    note: gr > 3 ? 'Standing would be impossible; the cardiovascular system cannot pump blood against this gradient.'
      : gr > 1.6 ? 'Survivable briefly, but chronic skeletal and cardiac strain.'
      : gr < 0.15 ? 'Severe bone density and muscle loss over months. Movement is possible but disorienting.'
      : gr < 0.4 ? 'Long-term health effects similar to but worse than microgravity.'
      : 'Within the range the human body tolerates indefinitely.',
  });

  // Temperature
  const c = b.temp - 273.15;
  f.push({
    factor: 'Temperature', value: `${b.temp} K (${c.toFixed(0)} °C)`,
    ok: b.temp > 253 && b.temp < 323,
    note: b.temp > 373 ? 'Above the boiling point of water. Unprotected exposure is fatal in seconds.'
      : b.temp > 323 ? 'Beyond sustained human tolerance; hyperthermia within hours.'
      : b.temp < 200 ? 'Deep cryogenic. Exposed tissue freezes almost immediately.'
      : b.temp < 253 ? 'Survivable only in heated pressure suits.'
      : 'Within the range humans inhabit on Earth.',
  });

  // Atmosphere
  const atm = b.atmosphere || 'None';
  const breathable = hasFreeOxygen(atm) && atm.includes('N₂');
  f.push({
    factor: 'Atmosphere', value: atm,
    ok: breathable,
    note: atm === 'None' ? 'Vacuum. Consciousness is lost in about 15 seconds.'
      : atm.includes('CO₂') ? 'Carbon dioxide dominant. Lethal within minutes — CO₂ is toxic well below asphyxiation levels.'
      : atm.includes('H₂') && !hasFreeOxygen(atm) ? 'Hydrogen and helium. No oxygen and no surface to stand on.'
      : breathable ? 'Nitrogen–oxygen mix. This is the composition your lungs evolved for.'
      : 'Non-breathable. Pressurised oxygen supply required.',
  });

  // Escape velocity as a proxy for atmospheric retention
  f.push({
    factor: 'Atmospheric retention', value: `${b.escapeVel.toFixed(2)} km/s escape velocity`,
    ok: b.escapeVel > 5,
    note: b.escapeVel < 2.5 ? 'Too weak to hold an atmosphere against thermal escape over geological time.'
      : b.escapeVel < 5 ? 'Marginal. Light gases are lost steadily to space.'
      : 'Sufficient to retain nitrogen and oxygen over billions of years.',
  });

  // Stellar radiation environment
  if (b.star) {
    const insol = b.star.luminosity / (b.distanceAU ** 2);
    f.push({
      factor: 'Stellar flux', value: `${insol.toFixed(3)}× Earth's insolation`,
      ok: insol > 0.35 && insol < 1.8,
      note: b.star.spectralClass === 'M' ? 'Red dwarf host. Flare activity delivers periodic hard UV and X-ray doses that would strip an unshielded atmosphere.'
        : b.star.spectralClass === 'O' || b.star.spectralClass === 'B' ? 'Hot, short-lived star. Intense ultraviolet, and the system will not last long enough for complex chemistry.'
        : insol > 1.8 ? 'Excess flux drives water loss through photodissociation.'
        : insol < 0.35 ? 'Too little energy to keep surface water liquid without a strong greenhouse.'
        : 'Comparable to the energy budget Earth receives.',
    });
  }

  const passed = f.filter(x => x.ok).length;

  /* Not all failures are equal. A world can pass most factors and
     still kill you instantly — Venus passes gravity and escape
     velocity while sitting at 737 K under 92 bar of CO2. These are
     hard blockers and they dominate the verdict. */
  const blockers = [];
  if (b.temp > 373) blockers.push('surface above the boiling point of water');
  if (b.temp < 200) blockers.push('cryogenic surface temperature');
  if (atm === 'None') blockers.push('no atmosphere');
  if (atm.includes('CO₂') && !hasFreeOxygen(atm)) blockers.push('carbon dioxide atmosphere');
  if (atm.includes('H₂') && !hasFreeOxygen(atm)) blockers.push('hydrogen–helium envelope with no surface');
  if ((b.gravity ?? 0) / 9.82 > 3) blockers.push('crushing surface gravity');

  return {
    factors: f, passed, total: f.length, blockers,
    verdict: verdictFor(passed, f.length, blockers),
  };
}

function verdictFor(passed, total, blockers = []) {
  if (blockers.length >= 2) return { text: 'Immediately lethal', tone: 'bad' };
  if (blockers.length === 1) return { text: 'Requires a sealed habitat', tone: 'bad' };
  const r = passed / total;
  if (r === 1) return { text: 'Survivable unprotected', tone: 'good' };
  if (r >= 0.6) return { text: 'Survivable with a pressure suit and shelter', tone: 'warn' };
  if (r >= 0.3) return { text: 'Requires a sealed habitat', tone: 'warn' };
  return { text: 'Immediately lethal', tone: 'bad' };
}

/* Outlier detection against the generated population */
export function findAnomalies(b, uni) {
  const p = buildPopulationStats(uni);
  const out = [];
  const z = (v, s) => (v - s.mean) / (s.sd || 1);

  const ze = z(b.orbit.e, p.ecc);
  if (b.orbit.e > 0.2) out.push({
    label: 'Highly eccentric orbit', level: b.orbit.e > 0.25 ? 'high' : 'moderate',
    text: `Eccentricity ${b.orbit.e.toFixed(4)} against a population mean of ${p.ecc.mean.toFixed(4)}. Insolation varies by a factor of ${(((1 + b.orbit.e) / (1 - b.orbit.e)) ** 2).toFixed(1)} between perihelion and aphelion — the seasons here are driven by distance, not tilt.`,
  });

  if (b.rotationHours < 0) out.push({
    label: 'Retrograde rotation', level: 'high',
    text: `This world spins backwards relative to its orbit. The most likely cause is a giant impact early in its history, or tidal despinning by its star.`,
  });

  if (Math.abs(b.rotationHours) > 200) out.push({
    label: 'Extremely slow rotation', level: 'high',
    text: `A single day lasts ${(Math.abs(b.rotationHours) / 24).toFixed(1)} Earth days. Likely approaching a tidally locked state, which suppresses any magnetic dynamo.`,
  });

  if (b.axialTilt > 50) out.push({
    label: 'Extreme axial tilt', level: 'high',
    text: `A ${b.axialTilt.toFixed(1)}° tilt means the poles receive more annual energy than the equator. Seasons would be violent and hemispheric.`,
  });

  const dens = b.massE / (b.radiusE ** 3);
  if (dens > 2.2) out.push({
    label: 'Anomalously dense', level: 'high',
    text: `Bulk density ${dens.toFixed(2)}× Earth's. This implies an oversized iron core — consistent with a mantle stripped by a collision.`,
  });
  if (dens < 0.25 && !b.type.includes('giant')) out.push({
    label: 'Anomalously low density', level: 'high',
    text: `Bulk density only ${dens.toFixed(2)}× Earth's. Either a deep volatile envelope or a substantially inflated atmosphere.`,
  });

  if (b.esi > p.esi.p90 && b.esi > 0.7) out.push({
    label: 'High Earth similarity', level: 'high',
    text: `ESI ${b.esi.toFixed(3)} places this world in the top decile of everything surveyed so far. Research priority.`,
  });

  if (b.moonCount > 20) out.push({
    label: 'Rich satellite system', level: 'moderate',
    text: `${b.moonCount} satellites. A system this large usually means efficient capture from a circumplanetary disc.`,
  });

  if (b.hasRings && !b.type.includes('giant')) out.push({
    label: 'Rings on a terrestrial world', level: 'high',
    text: `Uncommon. Rings around a rocky planet are usually short-lived debris from a disrupted moon inside the Roche limit.`,
  });

  if (b.star && b.star.spectralClass === 'M' && b.distanceAU < 0.15) out.push({
    label: 'Tidally locked candidate', level: 'moderate',
    text: `At ${b.distanceAU.toFixed(3)} AU from an M-dwarf, tidal locking is likely within a few hundred million years. One hemisphere in permanent day, one in permanent night.`,
  });

  if (!out.length) out.push({
    label: 'Unremarkable', level: 'low',
    text: `Every measured parameter sits within one standard deviation of the surveyed population of ${p.n.toLocaleString()} worlds. That is itself useful — it makes this a good baseline for comparison.`,
  });

  return out;
}

/* ============================================================
   INTENT CLASSIFICATION
   ============================================================ */
/* Order matters: the first match wins, so the most specific
   patterns are tested first. Stems are deliberately left open at
   the right-hand end (\bsurviv, not \bsurviv\b) so that
   "survive", "survival" and "surviving" all match. */
const INTENTS = [
  { id: 'findlike', re: /\b(find|search|locate|show|any).{0,24}(similar|like earth|earth-?like|habitable|another earth|second earth)/i },
  { id: 'starcol',  re: /\b(star|sun|it)\b.{0,30}\b(blue|red|yellow|orange|white|colou?r|appear|look)/i },
  { id: 'survive',  re: /\b(surviv|live there|liveable|livable|habitab|breath|inhabit|settle|coloni|safe (to|for)|humans?)/i },
  { id: 'compare',  re: /\b(compare|comparison|versus|vs\.?|difference|against earth)|how does.{0,20}earth/i },
  { id: 'unusual',  re: /\b(unusual|strange|weird|odd|special|remarkable|anomal|stand ?out|interesting)/i },
  { id: 'colour',   re: /\b(why|what|how).{0,30}\b(red|blue|green|orange|white|brown|colou?r)|\bcolou?r\b/i },
  { id: 'water',    re: /\b(water|ocean|ice|liquid|hydro)/i },
  { id: 'moons',    re: /\b(moon|satellite|ring)/i },
  { id: 'age',      re: /\b(age|old|young|lifetime|evolve|die|future|how long will)/i },
  { id: 'time',     re: /\b(how long|travel time|how far|reach|get there)/i },
  { id: 'explain',  re: /\b(explain|what is|tell me|describe|overview|about)/i },
];

export function classify(q) {
  for (const i of INTENTS) if (i.re.test(q)) return i.id;
  return 'explain';
}

/* ============================================================
   ANSWER GENERATION — three depth levels
   ============================================================ */
export function ask(question, ctx) {
  const { body, uni, level } = ctx;
  const L = level || 0;
  const intent = classify(question);

  if (intent === 'findlike') return answerFindLike(ctx, L);
  if (!body) return {
    text: 'Select an object first and I can work from its measured values. Click any planet, star or nebula in the view, or use the search bar.',
    suggestions: ['Find me a planet similar to Earth'],
  };

  switch (intent) {
    case 'colour':  return answerColour(body, L);
    case 'survive': return answerSurvive(body, L);
    case 'starcol': return answerStarColour(body, L);
    case 'compare': return answerCompare(body, L);
    case 'unusual': return answerUnusual(body, uni, L);
    case 'water':   return answerWater(body, L);
    case 'moons':   return answerMoons(body, L);
    case 'age':     return answerAge(body, L);
    default:        return answerExplain(body, uni, L);
  }
}

function pack(text, suggestions = [], data = null) { return { text, suggestions, data }; }

/* ---- colour ---- */
function answerColour(b, L) {
  if (b.kind === 'star') return answerStarColour(b, L);
  if (b.kind !== 'planet' && b.kind !== 'moon') return answerExplain(b, null, L);
  const c = colourCause(b);
  const T = [
    `${b.name} looks ${c.tone} because of ${c.cause}.`,
    `${b.name} appears ${c.tone}. The cause is ${c.cause}. ${c.detail}`,
    `${b.name} presents as ${c.tone}. ${c.detail} Surface composition here is ${b.composition.toLowerCase()}, at an equilibrium temperature of ${b.temp} K. The reflectance spectrum follows directly from that combination.`,
  ];
  return pack(T[L], ['What makes this planet unusual?', 'Can humans survive here?']);
}

function answerStarColour(b, L) {
  const s = b.kind === 'star' ? b : b.star;
  if (!s) return answerExplain(b, null, L);
  const peak = 2.898e6 / s.temp;
  const hot = s.temp > 7500;
  const T = [
    `${s.name} looks ${hot ? 'blue-white' : s.temp > 5500 ? 'yellow-white' : 'orange-red'} because it is ${hot ? 'very hot' : s.temp > 5500 ? 'moderately hot' : 'relatively cool'} — about ${s.temp.toLocaleString()} K at the surface. Hotter stars glow bluer, cooler stars glow redder.`,
    `${s.name} is a ${s.spectral} star at ${s.temp.toLocaleString()} K. Its thermal emission peaks near ${peak.toFixed(0)} nm, which is ${peak < 450 ? 'in the ultraviolet, so the visible tail we see is blue' : peak < 600 ? 'in the visible band' : 'in the infrared, so we see the red end of the curve'}. Colour is a direct readout of temperature.`,
    `${s.name}: spectral class ${s.spectral}, effective temperature ${s.temp.toLocaleString()} K. By Wien's displacement law the emission peak sits at ${peak.toFixed(1)} nm. Luminosity is ${s.luminosity < 0.01 ? s.luminosity.toExponential(3) : s.luminosity.toFixed(4)} L☉ from a radius of ${s.radius.toFixed(3)} R☉ — consistent with the Stefan–Boltzmann relation L ∝ R²T⁴. The letter class reflects hydrogen Balmer line strength, which is why the sequence O B A F G K M is ordered by temperature rather than brightness.`,
  ];
  return pack(T[L], ['How long will this star live?', 'Explain this object to me']);
}

/* ---- survivability ---- */
function answerSurvive(b, L) {
  if (b.kind !== 'planet' && b.kind !== 'moon') {
    return pack(`${b.name} is not a planetary surface, so there is nothing to stand on. Survival questions need a solid or liquid surface and an atmosphere.`, ['Find me a planet similar to Earth']);
  }
  const a = survivalAudit(b);
  const fails = a.factors.filter(f => !f.ok);

  if (L === 0) {
    const t = a.verdict.tone === 'good'
      ? `Yes — ${b.name} is one of the rare places where you could stand outside without a suit.`
      : `No. ${a.verdict.text}. ${a.blockers.length
          ? `The immediate problem${a.blockers.length > 1 ? 's are' : ' is'} ${a.blockers.slice(0, 2).join(' and ')}.`
          : `The main problems are ${fails.slice(0, 2).map(f => f.factor.toLowerCase()).join(' and ')}.`}`;
    return pack(t, ['What makes this planet unusual?', 'Compare this planet with Earth'], { audit: a });
  }
  if (L === 1) {
    const lines = a.factors.map(f => `${f.ok ? '✓' : '✕'} ${f.factor}: ${f.value}`).join('\n');
    return pack(`${a.verdict.text}. ${a.passed} of ${a.total} survivability factors pass${a.blockers.length ? `, but ${a.blockers.length} hard blocker${a.blockers.length > 1 ? 's' : ''} override${a.blockers.length > 1 ? '' : 's'} that count: ${a.blockers.join(', ')}` : ''}.\n\n${lines}\n\n${fails[0]?.note || 'No blocking factor identified.'}`,
      ['Compare this planet with Earth', 'Analyse in the Research Lab'], { audit: a });
  }
  const lines = a.factors.map(f => `${f.ok ? '✓' : '✕'} ${f.factor} — ${f.value}\n    ${f.note}`).join('\n');
  return pack(`Survivability audit for ${b.name}: ${a.verdict.text} (${a.passed}/${a.total}).\n\n${lines}\n\nEarth Similarity Index ${b.esi.toFixed(3)}. Note that ESI weights radius, density, escape velocity and temperature only — it says nothing about atmospheric chemistry, which is usually the binding constraint.`,
    ['Run a What-If experiment', 'Analyse in the Research Lab'], { audit: a });
}

/* ---- find Earth-like ---- */
function answerFindLike(ctx, L) {
  const { uni, galaxyIdx } = ctx;
  const systems = uni.getSystems(galaxyIdx ?? 0);
  const found = [];
  for (let i = 1; i < Math.min(140, systems.length); i++) {
    for (const p of uni.getPlanets(systems[i])) {
      if (p.real) continue;
      if (p.esi > 0.72) found.push(p);
    }
  }
  found.sort((a, b) => b.esi - a.esi);
  const top = found.slice(0, 5);
  if (!top.length) return pack('No world above ESI 0.72 in the systems surveyed so far. Travel to another region and I will keep looking.', []);

  const list = top.map(p => `• ${p.name} — ESI ${p.esi.toFixed(3)}, ${p.radiusE.toFixed(2)} R⊕, ${p.temp} K, ${p.atmosphere}`).join('\n');
  const T = [
    `I found ${found.length} promising worlds. The best match is ${top[0].name} — about the size of Earth, ${top[0].temp} K, with a ${top[0].atmosphere} atmosphere.\n\n${list}`,
    `${found.length} candidates above ESI 0.72 in this region.\n\n${list}\n\n${top[0].name} orbits ${top[0].star.name} (${top[0].star.spectral}) at ${top[0].distanceAU.toFixed(3)} AU.`,
    `Survey returned ${found.length} worlds above the ESI 0.72 threshold.\n\n${list}\n\nLead candidate ${top[0].name}: host ${top[0].star.name}, ${top[0].star.spectral}, ${top[0].star.luminosity.toFixed(4)} L☉, age ${top[0].star.age.toFixed(2)} Gyr. Orbital radius ${top[0].distanceAU.toFixed(4)} AU against a conservative habitable zone of ${(Physics.habitableZone(top[0].star.luminosity).inner / AU).toFixed(3)}–${(Physics.habitableZone(top[0].star.luminosity).outer / AU).toFixed(3)} AU. Caveat: high ESI on an M-dwarf host carries flare and tidal-locking risk that the index does not capture.`,
  ];
  return pack(T[L], ['Travel to the best candidate'], { candidates: top });
}

/* ---- compare with Earth ---- */
function answerCompare(b, L) {
  if (b.kind !== 'planet' && b.kind !== 'moon') return answerExplain(b, null, L);
  const E = { radiusE: 1, massE: 1, gravity: 9.82, temp: 288, escapeVel: 11.19, distanceAU: 1, orbitalPeriodDays: 365.26, rotationHours: 23.93, axialTilt: 23.44 };
  const rows = [
    ['Radius', `${b.radiusE.toFixed(3)} R⊕`, `${(b.radiusE / E.radiusE).toFixed(2)}×`],
    ['Mass', `${b.massE < 0.01 ? b.massE.toExponential(2) : b.massE.toFixed(3)} M⊕`, `${(b.massE / E.massE).toFixed(2)}×`],
    ['Gravity', `${(b.gravity ?? 0).toFixed(2)} m/s²`, `${((b.gravity ?? 0) / E.gravity).toFixed(2)}×`],
    ['Temperature', `${b.temp} K`, `${(b.temp - E.temp > 0 ? '+' : '')}${(b.temp - E.temp).toFixed(0)} K`],
    ['Year length', `${b.orbitalPeriodDays?.toFixed(1) ?? '—'} d`, `${((b.orbitalPeriodDays ?? 0) / E.orbitalPeriodDays).toFixed(2)}×`],
    ['Day length', `${Math.abs(b.rotationHours ?? 0).toFixed(1)} h`, `${(Math.abs(b.rotationHours ?? 0) / E.rotationHours).toFixed(2)}×`],
  ];
  const tbl = rows.map(r => `${r[0].padEnd(14)} ${String(r[1]).padStart(14)}   ${r[2]}`).join('\n');
  const weight = ((b.gravity ?? 0) / E.gravity * 70).toFixed(0);

  const T = [
    `Compared with Earth, ${b.name} is ${b.radiusE > 1 ? 'larger' : 'smaller'} and ${b.temp > 288 ? 'hotter' : 'colder'}. A 70 kg person would weigh about ${weight} kg-force there. Its Earth Similarity Index is ${b.esi.toFixed(3)} out of 1.`,
    `${b.name} against Earth:\n\n${tbl}\n\nESI ${b.esi.toFixed(3)}. Atmosphere: ${b.atmosphere}. A 70 kg person would weigh ${weight} kg-force at the surface.`,
    `${b.name} against Earth:\n\n${tbl}\n\nBulk density ${(b.massE / b.radiusE ** 3).toFixed(3)}× Earth's, implying ${(b.massE / b.radiusE ** 3) > 1.3 ? 'a proportionally larger iron core' : (b.massE / b.radiusE ** 3) < 0.7 ? 'a substantial volatile fraction' : 'a broadly Earth-like internal structure'}. Escape velocity ${b.escapeVel?.toFixed(2)} km/s against Earth's 11.19. ESI ${b.esi.toFixed(3)}, computed over radius, density, escape velocity and surface temperature with Kopparapu-style weighting.`,
  ];
  return pack(T[L], ['Add both to the comparison tray', 'Can humans survive here?']);
}

/* ---- unusual ---- */
function answerUnusual(b, uni, L) {
  if (b.kind !== 'planet') return answerExplain(b, uni, L);
  const an = findAnomalies(b, uni);
  if (L === 0) return pack(`${an[0].label}. ${an[0].text.split('.')[0]}.`, ['Explain that in more detail'], { anomalies: an });
  const body = an.map(a => `▸ ${a.label}\n   ${a.text}`).join('\n\n');
  return pack(`Anomaly scan for ${b.name}:\n\n${body}`, ['Analyse in the Research Lab', 'Run a What-If experiment'], { anomalies: an });
}

/* ---- water ---- */
function answerWater(b, L) {
  if (b.kind !== 'planet' && b.kind !== 'moon') return answerExplain(b, null, L);
  const liquid = b.temp > 273 && b.temp < 373;
  const hasAtm = b.atmosphere && b.atmosphere !== 'None';
  const state = b.temp < 273 ? 'frozen' : b.temp > 373 ? 'vapour, if present at all' : 'potentially liquid';
  const T = [
    `Water on ${b.name} would be ${state}. At ${b.temp} K, ${liquid ? 'it could exist as a liquid on the surface — provided there is enough atmospheric pressure to stop it boiling away.' : b.temp < 273 ? 'it is below the freezing point of water.' : 'it is above the boiling point.'}`,
    `Surface temperature ${b.temp} K (${(b.temp - 273.15).toFixed(0)} °C). Water would be ${state}. ${hasAtm ? `The ${b.atmosphere} atmosphere provides pressure, which matters: below about 6 mbar water sublimes straight from ice to vapour without passing through liquid.` : 'With no atmosphere there is no pressure to sustain liquid water at any temperature.'}`,
    `Thermal state: ${b.temp} K. Water phase would be ${state}. ${hasAtm ? `Atmospheric composition ${b.atmosphere}.` : 'No atmosphere — the triple point of water at 611.657 Pa cannot be reached, so no liquid phase is stable regardless of temperature.'} ${b.type === 'Ocean' ? 'Type classification indicates a substantial global hydrosphere.' : b.type === 'Ice' ? 'Type classification indicates a water-ice dominated surface; subsurface liquid remains possible if tidally heated.' : ''} Note that this simulation models bulk equilibrium temperature only — it does not resolve regional climate, so local liquid water can exist on worlds whose mean temperature falls outside the range.`,
  ];
  return pack(T[L], ['Can humans survive here?', 'Analyse in the Research Lab']);
}

/* ---- moons ---- */
function answerMoons(b, L) {
  if (b.kind !== 'planet') return answerExplain(b, null, L);
  if (!b.moonCount) return pack(`${b.name} has no natural satellites. ${b.distanceAU < 0.5 ? 'Close-in worlds rarely retain moons — the star\'s tidal influence destabilises their orbits.' : 'Either none formed, or any that did were lost.'}`, []);
  const named = b.moons.map(m => `• ${m.name} — ${m.type}, ${m.orbitalPeriodDays.toFixed(2)} d period`).join('\n');
  const T = [
    `${b.name} has ${b.moonCount} ${b.moonCount === 1 ? 'moon' : 'moons'}${b.hasRings ? ' and a ring system' : ''}. ${b.moons.length} of them are modelled in detail here.`,
    `${b.moonCount} satellites total; ${b.moons.length} modelled individually:\n\n${named}${b.hasRings ? '\n\nA ring system is also present, sitting inside the Roche limit where tidal forces prevent material from coalescing into a moon.' : ''}`,
    `${b.moonCount} satellites. Modelled subset:\n\n${named}\n\nThe Roche limit for a rigid satellite here sits near ${(Physics.rocheLimit(b.radiusM, b.massE / b.radiusE ** 3 * 5514, 3000) / b.radiusM).toFixed(2)} planetary radii — material inside that boundary cannot accrete into a moon, which is where ring systems form.${b.hasRings ? ' A ring system is present, consistent with that mechanism.' : ''}`,
  ];
  return pack(T[L], ['Explain this object to me']);
}

/* ---- age / stellar evolution ---- */
function answerAge(b, L) {
  const s = b.kind === 'star' ? b : b.star;
  if (!s) return answerExplain(b, null, L);
  const life = 10 * Math.pow(s.mass, -2.5);
  const left = life - s.age;
  const fate = s.mass > 8 ? 'core-collapse supernova, leaving a neutron star or black hole'
    : s.mass > 0.5 ? 'red giant phase, then a planetary nebula and a white dwarf remnant'
    : 'slow contraction to a helium white dwarf — though the universe is not yet old enough for any star this small to have finished';
  const T = [
    `${s.name} is about ${s.age.toFixed(2)} billion years old and has roughly ${left > 0 ? left.toFixed(1) : '0'} billion years of stable hydrogen burning left. It will end as a ${fate.split(',')[0]}.`,
    `${s.name}: current age ${s.age.toFixed(2)} Gyr, main-sequence lifetime ${life > 1000 ? life.toExponential(2) : life.toFixed(2)} Gyr, so it is ${((s.age / life) * 100).toFixed(1)}% through its stable life. Final fate: ${fate}.`,
    `${s.name}, ${s.spectral}, ${s.mass.toFixed(3)} M☉. Main-sequence lifetime scales roughly as M⁻²·⁵, giving ${life > 1000 ? life.toExponential(3) : life.toFixed(2)} Gyr; current age ${s.age.toFixed(3)} Gyr places it ${((s.age / life) * 100).toFixed(1)}% through core hydrogen burning, with ${left > 0 ? left.toFixed(2) : '0'} Gyr remaining. Terminal evolution: ${fate}. Any habitable zone migrates outward as luminosity rises during this period, which sets a hard limit on how long a given world stays habitable.`,
  ];
  return pack(T[L], ['Run a supernova experiment', 'Explain this object to me']);
}

/* ---- general explanation ---- */
function answerExplain(b, uni, L) {
  if (b.kind === 'planet') {
    const hz = b.star ? Physics.habitableZone(b.star.luminosity) : null;
    const inHZ = hz && b.distanceM > hz.inner && b.distanceM < hz.outer;
    const T = [
      `${b.name} is a ${b.type.toLowerCase()} world orbiting ${b.star.name}. It is ${b.radiusE.toFixed(2)} times Earth's radius, with a surface temperature of ${b.temp} K and ${b.atmosphere === 'None' ? 'no atmosphere' : `a ${b.atmosphere} atmosphere`}. ${inHZ ? 'It sits inside its star\'s habitable zone.' : ''}`,
      `${b.name} — ${b.type}, orbiting ${b.star.name} (${b.star.spectral}) at ${b.distanceAU.toFixed(3)} AU. Radius ${b.radiusE.toFixed(3)} R⊕, mass ${b.massE.toFixed(3)} M⊕, surface gravity ${b.gravity.toFixed(2)} m/s². Equilibrium temperature ${b.temp} K under a ${b.atmosphere} atmosphere. Year length ${b.orbitalPeriodDays.toFixed(1)} days; day length ${Math.abs(b.rotationHours).toFixed(1)} hours. ESI ${b.esi.toFixed(3)}. ${inHZ ? 'Inside the conservative habitable zone.' : 'Outside the conservative habitable zone.'}`,
      `${b.name}: ${b.type}, ${b.real ? 'observed parameters' : 'procedurally generated'}.\nHost ${b.star.name} — ${b.star.spectral}, ${b.star.luminosity.toFixed(4)} L☉, ${b.star.mass.toFixed(3)} M☉, ${b.star.age.toFixed(2)} Gyr.\nOrbit: a = ${b.distanceAU.toFixed(4)} AU, e = ${b.orbit.e.toFixed(4)}, P = ${b.orbitalPeriodDays.toFixed(2)} d.\nBody: R = ${b.radiusE.toFixed(3)} R⊕, M = ${b.massE.toFixed(3)} M⊕, ρ = ${(b.massE / b.radiusE ** 3).toFixed(3)} ρ⊕, g = ${b.gravity.toFixed(2)} m/s², v_esc = ${b.escapeVel.toFixed(2)} km/s.\nRotation: ${Math.abs(b.rotationHours).toFixed(2)} h${b.rotationHours < 0 ? ' retrograde' : ''}, obliquity ${b.axialTilt.toFixed(1)}°.\nThermal: T_eq = ${b.temp} K under ${b.atmosphere}.\nComposition: ${b.composition}.\nHabitable zone ${(hz.inner / AU).toFixed(3)}–${(hz.outer / AU).toFixed(3)} AU — ${inHZ ? 'inside' : 'outside'}. ESI ${b.esi.toFixed(3)}.`,
    ];
    return pack(T[L], ['What makes this planet unusual?', 'Can humans survive here?', 'Analyse in the Research Lab']);
  }

  if (b.kind === 'star') {
    const hz = Physics.habitableZone(b.luminosity);
    const T = [
      `${b.name} is a ${b.spectral} star — surface temperature about ${b.temp.toLocaleString()} K, ${b.luminosity > 1 ? 'brighter' : 'dimmer'} than the Sun, with ${b.planetCount} planets detected.`,
      `${b.name}: ${b.spectral}, ${b.temp.toLocaleString()} K, ${b.luminosity.toFixed(4)} L☉, ${b.mass.toFixed(3)} M☉, ${b.radius.toFixed(3)} R☉, age ${b.age.toFixed(2)} Gyr. Habitable zone runs ${(hz.inner / AU).toFixed(3)}–${(hz.outer / AU).toFixed(3)} AU. ${b.planetCount} planets.`,
      `${b.name}: spectral class ${b.spectral}, T_eff ${b.temp.toLocaleString()} K, L = ${b.luminosity.toFixed(4)} L☉, M = ${b.mass.toFixed(3)} M☉, R = ${b.radius.toFixed(3)} R☉, age ${b.age.toFixed(3)} Gyr. Main-sequence lifetime ≈ ${(10 * Math.pow(b.mass, -2.5)).toFixed(2)} Gyr. Conservative habitable zone ${(hz.inner / AU).toFixed(3)}–${(hz.outer / AU).toFixed(3)} AU. ${b.planetCount} planets. ${b.spectralClass === 'M' ? 'M-dwarf: expect strong flare activity and tidal locking for any HZ world, since the zone lies very close in.' : b.spectralClass === 'O' || b.spectralClass === 'B' ? 'Massive and short-lived — unlikely to support complex chemistry on any timescale that matters.' : ''}`,
    ];
    return pack(T[L], ['Why does this star appear that colour?', 'How long will this star live?']);
  }

  if (b.kind === 'blackhole') {
    const rs = Physics.schwarzschildRadius(b.massSolar * SOLAR_MASS);
    const T = [
      `${b.name} is a black hole of about ${b.massSolar.toExponential(2)} solar masses. Its event horizon — the boundary nothing escapes from — is ${rs > AU ? `${(rs / AU).toFixed(3)} AU` : `${(rs / 1000).toFixed(1)} km`} across in radius.`,
      `${b.name}: ${b.massSolar.toExponential(3)} M☉, spin parameter a* = ${b.spin}. Schwarzschild radius ${rs > AU ? `${(rs / AU).toFixed(4)} AU` : `${(rs / 1000).toFixed(1)} km`}. The bright ring you see is the photon sphere at 1.5 r_s, where light itself can orbit.`,
      `${b.name}: M = ${b.massSolar.toExponential(3)} M☉, a* = ${b.spin}. r_s = 2GM/c² = ${rs > AU ? `${(rs / AU).toFixed(4)} AU` : `${(rs / 1000).toFixed(2)} km`}. Photon sphere 1.5 r_s; ISCO 3 r_s for a non-spinning hole, moving inward with spin. Time dilation at ISCO is ×${Physics.timeDilation(b.massSolar * SOLAR_MASS, rs * 3).toFixed(4)} relative to infinity. Hawking temperature ${(6.17e-8 / b.massSolar).toExponential(3)} K — far below the CMB, so it gains mass faster than it evaporates. The disc's brightness asymmetry is relativistic Doppler beaming, not a rendering artefact.`,
    ];
    return pack(T[L], ['Run a black hole experiment']);
  }

  if (b.kind === 'nebula') {
    const T = [
      `${b.name} is a ${b.type.toLowerCase()} nebula, about ${b.diameterLy} light years across. ${b.starForming ? 'New stars are forming inside it right now.' : ''}`,
      `${b.name}: ${b.type} nebula, ${b.diameterLy} ly diameter, kinetic temperature ${b.temp.toLocaleString()} K, density ${b.density}. Composition ${b.composition}. ${b.starForming ? 'Actively star-forming.' : 'Quiescent.'}`,
      `${b.name}: ${b.type}, ${b.diameterLy} ly, T_kin ${b.temp.toLocaleString()} K, n ≈ ${b.density}, composition ${b.composition}. For scale, that density is around ten orders of magnitude thinner than Earth's atmosphere at sea level — the structure you see comes from emission integrated over light-years of path length, not from anything you would feel flying through it. ${b.starForming ? 'Jeans instability in the denser cores is driving active collapse.' : ''}`,
    ];
    return pack(T[L], ['Explain how stars form']);
  }

  if (b.kind === 'galaxy') {
    const T = [
      `${b.name} is a ${b.type.toLowerCase()} galaxy holding roughly ${b.starCount.toExponential(1)} stars, about ${b.diameterLy.toLocaleString()} light years across.`,
      `${b.name}: ${b.type}, ${b.diameterLy.toLocaleString()} ly diameter, ~${b.starCount.toExponential(2)} stars, central black hole ${b.bhMass.toExponential(2)} M☉${b.distanceLy ? `, ${(b.distanceLy / 1e6).toFixed(2)} Mly distant` : ''}.`,
      `${b.name}: ${b.type}, D = ${b.diameterLy.toLocaleString()} ly, N★ ≈ ${b.starCount.toExponential(3)}, M_BH = ${b.bhMass.toExponential(3)} M☉${b.armCount ? `, ${b.armCount} spiral arms` : ''}. ${b.distanceLy ? `Distance ${(b.distanceLy / 1e6).toFixed(2)} Mly, redshift z = ${b.redshift.toFixed(4)}, recession velocity ${(b.redshift * 299792).toLocaleString(undefined, { maximumFractionDigits: 0 })} km/s.` : 'Host galaxy.'} The central black hole mass follows the M–σ relation, which ties it to the bulge velocity dispersion rather than to the disc.`,
    ];
    return pack(T[L], ['Travel to this galaxy']);
  }

  return pack(`${b.name}: ${b.type || b.kind}.`, []);
}

/* ============================================================
   PROACTIVE SUGGESTIONS
   ORION volunteers these when context warrants it (§1).
   ============================================================ */
export function proactive(body, uni, seen) {
  if (!body) return null;
  const key = `${body.name}`;
  if (seen.has(key)) return null;

  if (body.kind === 'planet') {
    if (body.esi > 0.75) return { text: `${body.name} scores ESI ${body.esi.toFixed(3)} — that is a high-priority research target. Shall I run a habitability analysis?`, action: 'lab' };
    if (body.atmosphere && body.atmosphere !== 'None' && body.massE / body.radiusE ** 3 < 0.4)
      return { text: `${body.name} has an unusually dense atmosphere for its mass. Would you like to perform an atmospheric analysis?`, action: 'lab' };
    if (body.rotationHours < 0) return { text: `${body.name} rotates backwards. That usually means a giant impact in its past. Want the anomaly scan?`, action: 'unusual' };
    if (body.orbit.e > 0.24) return { text: `This orbit is strongly eccentric — insolation swings by a large factor each year. Worth a closer look in the lab.`, action: 'lab' };
    if (body.hasRings && !body.type.includes('giant')) return { text: `Rings around a rocky world are uncommon. Shall I explain how they survive here?`, action: 'unusual' };
  }
  if (body.kind === 'star' && body.spectralClass === 'M')
    return { text: `${body.name} is an M-dwarf. These live for trillions of years but flare violently — a real constraint on habitability. Want the detail?`, action: 'explain' };
  if (body.kind === 'blackhole')
    return { text: `We are near an event horizon. I can walk you through what the lensing is actually showing, or run a tidal-force experiment.`, action: 'whatif' };
  if (body.kind === 'nebula' && body.starForming)
    return { text: `This nebula is actively forming stars. Every heavy element in your body came from a region like this.`, action: 'explain' };
  return null;
}

/* ============================================================
   SYSTEM BRIEFING (§8)
   Generated from the system's real properties on arrival.
   ============================================================ */
export function systemBriefing(star, planets) {
  const hz = Physics.habitableZone(star.luminosity);
  const inHZ = planets.filter(p => p.distanceM > hz.inner && p.distanceM < hz.outer);
  const best = planets.reduce((a, b) => (!a || b.esi > a.esi ? b : a), null);
  const giants = planets.filter(p => p.type.includes('giant')).length;

  let s = `${star.name} — ${star.spectral}, `;
  s += `${star.age < 1 ? `only ${(star.age * 1000).toFixed(0)} million` : `approximately ${star.age.toFixed(1)} billion`} years old. `;

  if (!planets.length) { return s + 'No planets detected. Either none formed, or they were cleared early.'; }

  s += `${planets.length} ${planets.length === 1 ? 'planet' : 'planets'} detected`;
  s += giants ? `, ${giants} of them gas or ice giants. ` : '. ';

  if (inHZ.length) {
    s += `${inHZ.length === 1 ? 'One planet lies' : `${inHZ.length} planets lie`} within the estimated habitable zone (${(hz.inner / AU).toFixed(2)}–${(hz.outer / AU).toFixed(2)} AU). `;
  } else {
    s += `No planet falls inside the habitable zone at ${(hz.inner / AU).toFixed(2)}–${(hz.outer / AU).toFixed(2)} AU. `;
  }

  if (best && best.esi > 0.6) {
    s += `${best.name} has characteristics that make it a high-priority research target — ESI ${best.esi.toFixed(3)}, ${best.temp} K, ${best.atmosphere}.`;
  } else if (best) {
    s += `Best candidate is ${best.name} at ESI ${best.esi.toFixed(3)}; nothing here is close to Earth-like.`;
  }

  if (star.spectralClass === 'M') s += ' Note: M-dwarf host — expect flare activity and tidal locking close in.';
  if (star.spectralClass === 'O' || star.spectralClass === 'B') s += ' Note: this star will exhaust its fuel before complex chemistry could plausibly develop.';

  return s;
}

/* ============================================================
   OPTIONAL REMOTE MODEL
   Only used if the host page exposes a key. The demo path never
   calls this — everything above is local and deterministic.
   ============================================================ */
export async function askRemote(question, ctx) {
  if (typeof fetch !== 'function' || !window.__COSMOSX_API) return null;
  try {
    const b = ctx.body;
    const sys = `You are ORION, the assistant inside COSMOS-X, a space exploration simulator.
Answer in at most 120 words, at a ${LEVELS[ctx.level]} level. Be precise and never invent numbers.
Current context: ${b ? JSON.stringify({
      name: b.name, kind: b.kind, type: b.type, radiusE: b.radiusE, massE: b.massE,
      gravity: b.gravity, temp: b.temp, atmosphere: b.atmosphere, esi: b.esi,
      distanceAU: b.distanceAU, star: b.star?.name, spectral: b.star?.spectral,
    }) : 'nothing selected'}`;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 400,
        system: sys, messages: [{ role: 'user', content: question }],
      }),
    });
    const d = await r.json();
    return d.content.filter(x => x.type === 'text').map(x => x.text).join('\n');
  } catch { return null; }
}
