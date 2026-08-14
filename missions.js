/* ============================================================
   COSMOS-X — missions.js
   Staged scientific missions (§2)
   ============================================================
   Each mission is a sequence of stages. A stage completes when
   its check() returns true against the live mission context —
   so progress is earned by actually doing the science, not by
   clicking through a menu.

   Context shape (maintained by app.js):
     body        currently selected object
     star        current host star
     tier        current scale tier
     galaxyIdx   current galaxy
     logged      Set of logged object names
     reports     Set of names with a completed research report
     scanned     Set of names scanned in the lab
     analysed    Set of names analysed in the lab
     experiments Set of experiment ids run
     spectral    Set of spectral classes observed
     galaxies    Set of galaxy indices visited
     compare     array in the comparison tray
   ============================================================ */

const has = (s, n) => s && s.has(n);

export const MISSIONS = [
  /* ---------------------------------------------------------- */
  {
    id: 'habitable', icon: '🌍', category: 'Astrobiology',
    title: 'Find a Habitable World', badge: 'Astrobiology Researcher',
    brief: 'Locate a world outside the Solar System that could plausibly support liquid water, and submit a full research report on it.',
    fact: 'Of roughly 6,000 confirmed exoplanets, only a few dozen sit in the conservative habitable zone of their host star — and none has been confirmed to hold surface water.',
    stages: [
      { id: 'travel', label: 'Leave the Solar System', desc: 'Travel to any star system other than Sol.',
        check: c => c.star && c.star.name !== 'Sol' },
      { id: 'locate', label: 'Locate a candidate', desc: 'Select a planet with an Earth Similarity Index above 0.60.',
        check: c => c.body?.kind === 'planet' && c.body.esi > 0.60 },
      { id: 'scan', label: 'Scan the planet', desc: 'Run a lab scan on the candidate.',
        check: c => c.body && has(c.scanned, c.body.name) },
      { id: 'atmos', label: 'Analyse the atmosphere', desc: 'Complete the analysis stage on a world with an atmosphere.',
        check: c => c.body && has(c.analysed, c.body.name) && c.body.atmosphere !== 'None' },
      { id: 'water', label: 'Detect water indicators', desc: 'Analyse a world whose temperature permits liquid water.',
        check: c => c.body && has(c.analysed, c.body.name) && c.body.temp > 260 && c.body.temp < 340 },
      { id: 'report', label: 'Submit a research report', desc: 'Generate the full report for the candidate.',
        check: c => c.body && has(c.reports, c.body.name) },
    ],
  },

  /* ---------------------------------------------------------- */
  {
    id: 'mars', icon: '🔴', category: 'Planetary science',
    title: 'Mars Exploration', badge: 'Areographer',
    brief: 'Survey Mars, characterise its atmosphere and temperature, and determine why it lost the water it once had.',
    fact: 'Mars once had liquid water at the surface. It lost its magnetic field around 4 billion years ago, and the solar wind has been stripping its atmosphere ever since.',
    stages: [
      { id: 'reach', label: 'Reach Mars', desc: 'Select Mars.', check: c => c.body?.name === 'Mars' },
      { id: 'scan', label: 'Scan the surface', desc: 'Run a lab scan on Mars.',
        check: c => has(c.scanned, 'Mars') },
      { id: 'analyse', label: 'Analyse conditions', desc: 'Complete the analysis stage for Mars.',
        check: c => has(c.analysed, 'Mars') },
      { id: 'compare', label: 'Compare with Earth', desc: 'Place Mars and Earth in the comparison tray together.',
        check: c => c.compare?.some(x => x.name === 'Mars') && c.compare?.some(x => x.name === 'Earth') },
      { id: 'report', label: 'File the survey', desc: 'Generate a research report for Mars.',
        check: c => has(c.reports, 'Mars') },
    ],
  },

  /* ---------------------------------------------------------- */
  {
    id: 'moon', icon: '🌙', category: 'Planetary science',
    title: 'Lunar Survey', badge: 'First Step',
    brief: 'Reach the Moon and establish what it does for Earth beyond lighting the night.',
    fact: 'Tidal friction transfers Earth\'s rotational angular momentum to the lunar orbit. The Moon recedes 3.8 cm per year and our day lengthens by 1.8 milliseconds per century.',
    stages: [
      { id: 'earth', label: 'Depart from Earth', desc: 'Select Earth.', check: c => c.body?.name === 'Earth' },
      { id: 'moon', label: 'Reach the Moon', desc: 'Select the Moon.', check: c => c.body?.name === 'Moon' },
      { id: 'log', label: 'Log the discovery', desc: 'Record the Moon in your journal.',
        check: c => has(c.logged, 'Moon') },
      { id: 'exp', label: 'Run the removal experiment', desc: 'Use the What-If lab to remove the Moon and observe the consequences.',
        check: c => has(c.experiments, 'nomoon') },
    ],
  },

  /* ---------------------------------------------------------- */
  {
    id: 'exohunt', icon: '🔭', category: 'Survey',
    title: 'Exoplanet Hunt', badge: 'Exoplanet Hunter',
    brief: 'Build a survey catalogue. Log fifteen worlds beyond the Solar System across at least three separate star systems.',
    fact: 'The first confirmed exoplanet around a main-sequence star was 51 Pegasi b in 1995 — a gas giant orbiting closer than Mercury, which nobody had predicted was possible.',
    stages: [
      { id: 'first', label: 'Log your first exoplanet', desc: 'Record any planet outside the Solar System.',
        check: c => c.exoLogged >= 1 },
      { id: 'five', label: 'Log five exoplanets', desc: 'Build the catalogue.', check: c => c.exoLogged >= 5 },
      { id: 'systems', label: 'Survey three systems', desc: 'Log planets from at least three different stars.',
        check: c => (c.systemsLogged?.size ?? 0) >= 3 },
      { id: 'fifteen', label: 'Log fifteen exoplanets', desc: 'Complete the survey.', check: c => c.exoLogged >= 15 },
    ],
  },

  /* ---------------------------------------------------------- */
  {
    id: 'spectra', icon: '⭐', category: 'Stellar astrophysics',
    title: 'Stellar Classification', badge: 'Spectroscopist',
    brief: 'Observe stars across the full spectral sequence and record how temperature drives everything else.',
    fact: 'The sequence O B A F G K M is ordered by temperature, but it was originally assigned alphabetically by hydrogen line strength. The letters were reshuffled once Annie Jump Cannon worked out what they actually meant.',
    stages: [
      { id: 'three', label: 'Observe three classes', desc: 'Select stars of three different spectral classes.',
        check: c => (c.spectral?.size ?? 0) >= 3 },
      { id: 'five', label: 'Observe five classes', desc: 'Continue the survey.', check: c => (c.spectral?.size ?? 0) >= 5 },
      { id: 'seven', label: 'Complete the sequence', desc: 'Observe all seven classes: O B A F G K M.',
        check: c => (c.spectral?.size ?? 0) >= 7 },
      { id: 'ask', label: 'Understand the cause', desc: 'Ask ORION why a star appears the colour it does.',
        check: c => has(c.asked, 'starcol') },
    ],
  },

  /* ---------------------------------------------------------- */
  {
    id: 'nebula', icon: '☁️', category: 'Interstellar medium',
    title: 'Nebula Investigation', badge: 'Stellar Midwife',
    brief: 'Enter a star-forming region and determine what conditions cause a cloud of gas to collapse into stars.',
    fact: 'Nebular gas is thinner than any vacuum achievable in a laboratory. What you see is emission integrated over light-years of path length, not density.',
    stages: [
      { id: 'reach', label: 'Reach a nebula', desc: 'Select any nebula.', check: c => c.body?.kind === 'nebula' },
      { id: 'forming', label: 'Find a star-forming region', desc: 'Select a nebula with active star formation.',
        check: c => c.body?.kind === 'nebula' && c.body.starForming },
      { id: 'log', label: 'Record the observation', desc: 'Log the nebula in your journal.',
        check: c => c.nebulaeLogged >= 1 },
      { id: 'ask', label: 'Consult ORION', desc: 'Ask ORION to explain the object.',
        check: c => has(c.asked, 'explain') },
    ],
  },

  /* ---------------------------------------------------------- */
  {
    id: 'blackhole', icon: '🕳', category: 'Relativity',
    title: 'Black Hole Investigation', badge: 'Black Hole Specialist',
    brief: 'Approach an event horizon, measure the relativistic effects, and work out why the accretion disc is brighter on one side.',
    fact: 'At the photon sphere — 1.5 Schwarzschild radii out — light itself can orbit. Facing forward, you would see the back of your own head.',
    stages: [
      { id: 'reach', label: 'Reach a black hole', desc: 'Select any black hole.',
        check: c => c.body?.kind === 'blackhole' },
      { id: 'smbh', label: 'Find a supermassive one', desc: 'Select a galactic-core black hole.',
        check: c => c.body?.kind === 'blackhole' && c.body.supermassive },
      { id: 'exp', label: 'Measure tidal forces', desc: 'Run the approach experiment in the What-If lab.',
        check: c => has(c.experiments, 'tidal') },
      { id: 'log', label: 'Log three black holes', desc: 'Record three separate objects.',
        check: c => c.bhLogged >= 3 },
    ],
  },

  /* ---------------------------------------------------------- */
  {
    id: 'galactic', icon: '🌌', category: 'Cosmology',
    title: 'Intergalactic Voyage', badge: 'Galaxy Explorer',
    brief: 'Leave the Milky Way entirely and characterise another galaxy.',
    fact: 'Andromeda is approaching at 110 km/s. In about 4.5 billion years the two galaxies will merge — though the stars themselves are so far apart that almost none will collide.',
    stages: [
      { id: 'cosmic', label: 'Reach intergalactic scale', desc: 'Zoom out to the intergalactic tier.',
        check: c => c.tier === 'cosmic' },
      { id: 'select', label: 'Select another galaxy', desc: 'Choose a galaxy other than the Milky Way.',
        check: c => c.body?.kind === 'galaxy' && c.body.idx !== 0 },
      { id: 'travel', label: 'Travel there', desc: 'Arrive at a second galaxy.',
        check: c => (c.galaxies?.size ?? 0) >= 2 },
      { id: 'survey', label: 'Survey a star there', desc: 'Select a star in the new galaxy.',
        check: c => c.body?.kind === 'star' && c.galaxyIdx !== 0 },
    ],
  },

  /* ---------------------------------------------------------- */
  {
    id: 'experimenter', icon: '⚗️', category: 'Theory',
    title: 'Virtual Astronomy Laboratory', badge: 'Experimentalist',
    brief: 'Use the What-If lab to test how sensitive a world is to its own parameters.',
    fact: 'Habitability is a narrow target. Change Earth\'s orbital radius by 5% inward and a runaway greenhouse becomes plausible; 20% outward and runaway glaciation does.',
    stages: [
      { id: 'first', label: 'Run any experiment', desc: 'Open the What-If lab and run one.',
        check: c => (c.experiments?.size ?? 0) >= 1 },
      { id: 'gravity', label: 'Test gravity', desc: 'Run the gravity experiment.',
        check: c => has(c.experiments, 'gravity2x') },
      { id: 'orbit', label: 'Test orbital distance', desc: 'Run the orbital radius experiment.',
        check: c => has(c.experiments, 'closer') },
      { id: 'four', label: 'Run four experiments', desc: 'Explore the parameter space.',
        check: c => (c.experiments?.size ?? 0) >= 4 },
      { id: 'six', label: 'Run all six core experiments', desc: 'Complete the laboratory course.',
        check: c => (c.experiments?.size ?? 0) >= 6 },
    ],
  },

  /* ---------------------------------------------------------- */
  {
    id: 'solar', icon: '🚀', category: 'Survey',
    title: 'Solar System Survey', badge: 'Solar Explorer',
    brief: 'Visit and log every planet orbiting the Sun.',
    fact: 'The eight planets together carry 0.14% of the Solar System\'s mass. The Sun holds the other 99.86%.',
    stages: [
      { id: 'inner', label: 'Survey the inner planets', desc: 'Log Mercury, Venus, Earth and Mars.',
        check: c => ['Mercury', 'Venus', 'Earth', 'Mars'].every(n => has(c.logged, n)) },
      { id: 'giants', label: 'Survey the gas giants', desc: 'Log Jupiter and Saturn.',
        check: c => ['Jupiter', 'Saturn'].every(n => has(c.logged, n)) },
      { id: 'ice', label: 'Survey the ice giants', desc: 'Log Uranus and Neptune.',
        check: c => ['Uranus', 'Neptune'].every(n => has(c.logged, n)) },
      { id: 'compare', label: 'Compare three worlds', desc: 'Put three terrestrial planets in the comparison tray.',
        check: c => (c.compare?.filter(x => ['Terrestrial', 'Desert', 'Molten'].includes(x.type)).length ?? 0) >= 3 },
    ],
  },
];

/* Evaluate all missions against the current context.
   Returns the list of stages newly completed this call. */
export function evaluate(missions, ctx) {
  const completed = [];
  for (const m of missions) {
    if (m.done) continue;
    const def = MISSIONS.find(x => x.id === m.id);
    for (let i = 0; i < def.stages.length; i++) {
      if (m.progress.has(i)) continue;
      let ok = false;
      try { ok = def.stages[i].check(ctx); } catch { ok = false; }
      if (ok) {
        m.progress.add(i);
        completed.push({ mission: def, stage: def.stages[i], index: i });
      }
    }
    if (m.progress.size === def.stages.length && !m.done) {
      m.done = true;
      completed.push({ mission: def, complete: true });
    }
  }
  return completed;
}

export function initMissions() {
  return MISSIONS.map(m => ({ id: m.id, progress: new Set(), done: false }));
}
