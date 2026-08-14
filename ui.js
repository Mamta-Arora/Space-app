/* ============================================================
   COSMOS-X — ui.js
   ORION panel · Research Lab · What-If · Progress · Story
   ============================================================
   These panels own their own DOM. app.js provides `S` (shared
   state) and a small set of callbacks so the panels never reach
   into the renderer directly.
   ============================================================ */
import { ask, proactive, systemBriefing, LEVELS, findAnomalies } from './orion.js';
import {
  habitability, EXPERIMENTS, LAB_STAGES, scanData, buildReport,
  ACHIEVEMENTS, XP, levelFor, STORY,
} from './lab.js';
import { MISSIONS } from './missions.js';
import { AU, Physics } from './engine.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let S = null, CB = {};
export function bindUI(state, callbacks) { S = state; CB = callbacks; }

/* ============================================================
   ORION PANEL
   ============================================================ */
export function orionSay(text, opts = {}) {
  const log = $('orion-log');
  if (!log) return;
  const d = document.createElement('div');
  d.className = `o-msg o-orion${opts.proactive ? ' o-pro' : ''}`;
  d.innerHTML = `<div class="o-who">ORION${opts.proactive ? ' · suggestion' : ''}</div>
    <div class="o-body">${esc(text).replace(/\n/g, '<br>')}</div>`;
  log.appendChild(d);
  if (opts.suggestions?.length) {
    const s = document.createElement('div');
    s.className = 'o-chips';
    s.innerHTML = opts.suggestions.map(x => `<button class="o-chip">${esc(x)}</button>`).join('');
    s.querySelectorAll('.o-chip').forEach(b => {
      b.onclick = () => { $('orion-in').value = b.textContent; orionSubmit(); };
    });
    log.appendChild(s);
  }
  log.scrollTop = log.scrollHeight;
}

function orionUser(text) {
  const log = $('orion-log');
  const d = document.createElement('div');
  d.className = 'o-msg o-user';
  d.innerHTML = `<div class="o-body">${esc(text)}</div>`;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

export function orionSubmit() {
  const inp = $('orion-in');
  const q = inp.value.trim();
  if (!q) return;
  inp.value = '';
  orionUser(q);

  // Route action-style requests to the panels they refer to
  const lower = q.toLowerCase();
  if (/research lab|analyse in the lab/.test(lower)) { openLab(); return; }
  if (/what-?if|experiment/.test(lower) && !/why/.test(lower)) { openWhatIf(); return; }
  if (/travel to (the )?(best|this)/.test(lower)) { CB.travelBest?.(); return; }

  const r = ask(q, { body: S.selected, uni: S.uni, level: S.orionLevel, galaxyIdx: S.galaxyIdx });
  S.asked.add(require_intent(q));
  setTimeout(() => orionSay(r.text, { suggestions: r.suggestions }), 220);
  CB.onAsk?.();
}

function require_intent(q) {
  // mirrors orion.classify without re-importing; used for mission checks
  if (/\b(star|sun).*(blue|red|colou?r|hot|cold|temperature|appear)\b/i.test(q)) return 'starcol';
  if (/\b(surviv|live|habitab|breath|human)\b/i.test(q)) return 'survive';
  if (/\b(unusual|strange|weird|odd|special|anomal)\b/i.test(q)) return 'unusual';
  if (/\b(compare|versus|vs\.?)\b/i.test(q)) return 'compare';
  if (/\b(colou?r|red|blue)\b/i.test(q)) return 'colour';
  return 'explain';
}

export function renderOrion() {
  const p = $('orion');
  p.innerHTML = `
    <div class="panel-hd o-hd">
      <span><i class="dot o-dot"></i> ORION</span>
      <div class="o-levels">
        ${LEVELS.map((l, i) => `<button class="o-lv ${S.orionLevel === i ? 'on' : ''}" data-l="${i}">${l[0]}</button>`).join('')}
        <button class="o-close" id="orion-x">✕</button>
      </div>
    </div>
    <div id="orion-log" class="o-log"></div>
    <div class="o-input">
      <input id="orion-in" placeholder="Ask ORION anything…" autocomplete="off">
      <button id="orion-go">→</button>
    </div>`;

  p.querySelectorAll('.o-lv').forEach(b => {
    b.onclick = () => {
      S.orionLevel = +b.dataset.l;
      p.querySelectorAll('.o-lv').forEach(x => x.classList.toggle('on', +x.dataset.l === S.orionLevel));
      orionSay(`Explanation level set to ${LEVELS[S.orionLevel]}.`);
    };
  });
  $('orion-x').onclick = () => p.classList.remove('on');
  $('orion-go').onclick = orionSubmit;
  $('orion-in').onkeydown = e => { if (e.key === 'Enter') orionSubmit(); };

  orionSay(
    `ORION online. I read the same physics the simulation runs on, so anything I tell you comes from this object's actual computed values.\n\nAsk me why a world looks the way it does, whether you could survive there, what makes it unusual, or to find you something Earth-like.`,
    { suggestions: ['Explain this object to me', 'Can humans survive here?', 'Find me a planet similar to Earth'] }
  );
}

export function orionProactive() {
  const s = proactive(S.selected, S.uni, S.proSeen);
  if (!s) return;
  S.proSeen.add(S.selected.name);
  if (!$('orion').classList.contains('on')) {
    // Surface as a quiet nudge rather than forcing the panel open
    CB.nudge?.(s.text);
    return;
  }
  orionSay(s.text, { proactive: true, suggestions: ['Yes, go ahead'] });
}

export function orionBriefing(star, planets) {
  const t = systemBriefing(star, planets);
  if ($('orion').classList.contains('on')) orionSay(t, { proactive: true });
  return t;
}

/* ============================================================
   RESEARCH LAB
   ============================================================ */
export function openLab() {
  const b = S.selected;
  if (!b || (b.kind !== 'planet' && b.kind !== 'moon')) {
    CB.nudge?.('Select a planet or moon to analyse in the lab.');
    return;
  }
  S.lab = { body: b, stage: 0 };
  $('lab').classList.add('on');
  renderLab();
}

export function renderLab() {
  const { body: b, stage } = S.lab;
  const hab = habitability(b);
  const anomalies = findAnomalies(b, S.uni);

  const nav = LAB_STAGES.map((s, i) => `
    <button class="lab-step ${i === stage ? 'on' : ''} ${i < stage ? 'done' : ''}" data-i="${i}"
      ${i > stage + 0 && !canAdvance(i) ? 'disabled' : ''}>
      <span class="lab-num">${i < stage ? '✓' : i + 1}</span>
      <span class="lab-lbl">${s.label}</span>
    </button>`).join('');

  let body = '';

  if (stage === 0) {
    const d = scanData(b);
    body = `<div class="lab-desc">${LAB_STAGES[0].desc}</div>
      <div class="lab-grid">${d.map(x => `
        <div class="lab-cell"><span class="lc-k">${esc(x.k)}</span><span class="lc-v">${esc(x.v)}</span></div>`).join('')}</div>
      <button class="pbtn lab-next" data-go="1">Analyse this data →</button>`;
  }

  else if (stage === 1) {
    body = `<div class="lab-desc">${LAB_STAGES[1].desc}</div>
      ${habChart(hab)}
      <div class="lab-factors">${hab.factors.map((f, i) => `
        <div class="lab-fac">
          <div class="lf-top"><span class="lf-n">${esc(f.name)}</span>
            <span class="lf-s" style="color:${scoreCol(f.score)}">${(f.score * 100).toFixed(0)}%</span></div>
          <div class="lf-bar"><i style="width:${f.score * 100}%;background:${scoreCol(f.score)}"></i></div>
          <div class="lf-v">${esc(f.value)}</div>
          <div class="lf-w">${esc(f.why)}</div>
        </div>`).join('')}</div>
      <button class="pbtn lab-next" data-go="2">Compare against Earth →</button>`;
  }

  else if (stage === 2) {
    body = `<div class="lab-desc">${LAB_STAGES[2].desc}</div>
      ${compareChart(b)}
      <button class="pbtn lab-next" data-go="3">Form a hypothesis →</button>`;
  }

  else if (stage === 3) {
    body = `<div class="lab-desc">${LAB_STAGES[3].desc}</div>
      <div class="lab-anom">${anomalies.map(a => `
        <div class="anom anom-${a.level}">
          <div class="an-l">${esc(a.label)}</div>
          <div class="an-t">${esc(a.text)}</div>
        </div>`).join('')}</div>
      <button class="pbtn lab-next" data-go="4">Generate research report →</button>`;
  }

  else {
    const rep = buildReport(b, hab, anomalies, S.uni);
    body = renderReport(rep);
  }

  $('lab').innerHTML = `
    <div class="panel-hd">
      <span><i class="dot"></i> Research Lab — ${esc(b.name)}</span>
      <button class="o-close" id="lab-x">✕</button>
    </div>
    <div class="lab-nav">${nav}</div>
    <div class="lab-body">${body}</div>`;

  $('lab-x').onclick = () => $('lab').classList.remove('on');
  $('lab').querySelectorAll('.lab-step').forEach(s => {
    s.onclick = () => { if (!s.disabled) { S.lab.stage = +s.dataset.i; renderLab(); } };
  });
  const nx = $('lab').querySelector('.lab-next');
  if (nx) nx.onclick = () => {
    const to = +nx.dataset.go;
    S.lab.stage = to;
    if (to >= 1) S.scanned.add(b.name);
    if (to >= 2) S.analysed.add(b.name);
    if (to >= 4) { S.reports.add(b.name); CB.award?.(XP.report, `Research report: ${b.name}`); }
    CB.checkMissions?.();
    renderLab();
  };
  const dl = $('lab').querySelector('#rep-copy');
  if (dl) dl.onclick = () => {
    const rep = buildReport(b, hab, anomalies, S.uni);
    navigator.clipboard?.writeText(reportText(rep));
    CB.nudge?.('Report copied to clipboard');
  };
}

function canAdvance(i) { return i <= (S.lab?.stage ?? 0); }
function scoreCol(s) { return s > 0.7 ? '#7fc98a' : s > 0.4 ? '#ffb454' : '#e0607a'; }

/* Radar-style habitability chart, drawn as inline SVG */
function habChart(hab) {
  const n = hab.factors.length, R = 74, cx = 100, cy = 92;
  const pt = (i, r) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const poly = hab.factors.map((f, i) => pt(i, R * Math.max(0.04, f.score)).join(',')).join(' ');
  const rings = [0.25, 0.5, 0.75, 1].map(k =>
    `<polygon points="${hab.factors.map((_, i) => pt(i, R * k).join(',')).join(' ')}"
      fill="none" stroke="var(--rule)" stroke-width="1"/>`).join('');
  const spokes = hab.factors.map((f, i) => {
    const [x, y] = pt(i, R);
    const [lx, ly] = pt(i, R + 17);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--rule)"/>
      <text x="${lx}" y="${ly}" font-size="7.5" fill="var(--ink-3)" text-anchor="middle"
        dominant-baseline="middle" font-family="var(--f-mono)">${f.name.split(' ')[0]}</text>`;
  }).join('');
  return `<div class="hab-wrap">
    <svg viewBox="0 0 200 190" class="hab-radar">
      ${rings}${spokes}
      <polygon points="${poly}" fill="${scoreCol(hab.score)}33" stroke="${scoreCol(hab.score)}" stroke-width="1.6"/>
    </svg>
    <div class="hab-score">
      <div class="hs-n" style="color:${scoreCol(hab.score)}">${hab.percent}%</div>
      <div class="hs-l">Earth Similarity Score</div>
      <div class="hs-p">Research priority: <b style="color:${scoreCol(hab.score)}">${hab.priority}</b></div>
      <div class="hs-c">Educational assessment from a simplified model — not a prediction of actual habitability.</div>
    </div>
  </div>`;
}

/* Bar comparison against Earth */
function compareChart(b) {
  const rows = [
    ['Radius', b.radiusE, 1, 'R⊕'],
    ['Mass', b.massE, 1, 'M⊕'],
    ['Gravity', b.gravity / 9.82, 1, '×g'],
    ['Temperature', b.temp / 288, 1, '×288K'],
    ['Density', b.massE / b.radiusE ** 3, 1, 'ρ⊕'],
    ['Escape velocity', b.escapeVel / 11.19, 1, '×'],
  ];
  const max = Math.max(2, ...rows.map(r => r[1]));
  return `<div class="cmp">${rows.map(r => {
    const w = Math.min(100, (r[1] / max) * 100), e = (1 / max) * 100;
    return `<div class="cmp-row">
      <div class="cmp-l">${r[0]}</div>
      <div class="cmp-track">
        <i class="cmp-bar" style="width:${w}%;background:${r[1] > 1.4 || r[1] < 0.6 ? '#ffb454' : '#7fc98a'}"></i>
        <i class="cmp-earth" style="left:${e}%"></i>
      </div>
      <div class="cmp-v">${r[1] < 0.01 ? r[1].toExponential(1) : r[1].toFixed(2)}<span>${r[3]}</span></div>
    </div>`;
  }).join('')}
  <div class="cmp-key"><i class="cmp-earth-key"></i> dashed line marks Earth = 1.0</div></div>`;
}

function renderReport(rep) {
  return `<div class="report">
    <div class="rep-hd">
      <div class="rep-t">${esc(rep.title)}</div>
      <div class="rep-m">${rep.meta.map(m => `<span><b>${esc(m[0])}</b> ${esc(m[1])}</span>`).join('')}</div>
    </div>
    <div class="rep-s"><h4>1 · Object overview</h4><p>${esc(rep.overview)}</p></div>
    <div class="rep-s"><h4>2 · Collected data</h4>
      <div class="lab-grid">${rep.observations.map(o =>
        `<div class="lab-cell"><span class="lc-k">${esc(o.k)}</span><span class="lc-v">${esc(o.v)}</span></div>`).join('')}</div></div>
    <div class="rep-s"><h4>3 · Habitability analysis</h4>
      <p>Composite score <b style="color:${scoreCol(rep.habitability.score)}">${rep.habitability.percent}%</b> — research priority ${esc(rep.habitability.priority)}.</p>
      <ul>${rep.habitability.factors.map(f =>
        `<li><b>${esc(f.name)}</b> (${(f.score * 100).toFixed(0)}%) — ${esc(f.why)}</li>`).join('')}</ul></div>
    <div class="rep-s"><h4>4 · Observations and anomalies</h4>
      <ul>${rep.anomalies.map(a => `<li><b>${esc(a.label)}</b> — ${esc(a.text)}</li>`).join('')}</ul></div>
    <div class="rep-s"><h4>5 · Key findings</h4>
      <ol>${rep.findings.map(f => `<li>${esc(f)}</li>`).join('')}</ol></div>
    <div class="rep-s"><h4>6 · Scientific interpretation</h4><p>${esc(rep.interpretation)}</p></div>
    <div class="rep-s"><h4>7 · Research recommendations</h4>
      <ol>${rep.recommendations.map(r => `<li>${esc(r)}</li>`).join('')}</ol></div>
    <div class="rep-caveat">${esc(rep.caveat)}</div>
    <button class="pbtn" id="rep-copy">Copy report to clipboard</button>
  </div>`;
}

function reportText(rep) {
  let t = `${rep.title}\n${'='.repeat(rep.title.length)}\n\n`;
  t += rep.meta.map(m => `${m[0]}: ${m[1]}`).join('\n') + '\n\n';
  t += `1. OBJECT OVERVIEW\n${rep.overview}\n\n`;
  t += `2. COLLECTED DATA\n${rep.observations.map(o => `  ${o.k}: ${o.v}`).join('\n')}\n\n`;
  t += `3. HABITABILITY ANALYSIS\nComposite score ${rep.habitability.percent}% — priority ${rep.habitability.priority}\n`;
  t += rep.habitability.factors.map(f => `  ${f.name} (${(f.score * 100).toFixed(0)}%): ${f.why}`).join('\n') + '\n\n';
  t += `4. OBSERVATIONS AND ANOMALIES\n${rep.anomalies.map(a => `  ${a.label}: ${a.text}`).join('\n')}\n\n`;
  t += `5. KEY FINDINGS\n${rep.findings.map((f, i) => `  ${i + 1}. ${f}`).join('\n')}\n\n`;
  t += `6. SCIENTIFIC INTERPRETATION\n${rep.interpretation}\n\n`;
  t += `7. RECOMMENDATIONS\n${rep.recommendations.map((r, i) => `  ${i + 1}. ${r}`).join('\n')}\n\n`;
  t += `NOTE: ${rep.caveat}\n`;
  return t;
}

/* ============================================================
   WHAT-IF UNIVERSE
   ============================================================ */
export function openWhatIf(id) {
  S.whatif = { id: id || S.whatif?.id || 'gravity2x', k: null };
  $('whatif').classList.add('on');
  renderWhatIf();
}

export function renderWhatIf() {
  const exp = EXPERIMENTS.find(e => e.id === S.whatif.id) || EXPERIMENTS[0];
  const b = S.selected && (S.selected.kind === 'planet' || S.selected.kind === 'blackhole')
    ? S.selected : S.earthRef;
  const k = S.whatif.k ?? exp.param.def;
  const res = exp.run(b, k);

  $('whatif').innerHTML = `
    <div class="panel-hd">
      <span><i class="dot wi-dot"></i> What-If Universe</span>
      <button class="o-close" id="wi-x">✕</button>
    </div>
    <div class="wi-tabs">${EXPERIMENTS.map(e =>
      `<button class="wi-tab ${e.id === exp.id ? 'on' : ''}" data-e="${e.id}">${esc(e.title.replace(/^What (if|happens when) /i, '').replace(/\?$/, ''))}</button>`).join('')}</div>
    <div class="wi-body">
      <div class="wi-h">${esc(exp.title)}</div>
      <div class="wi-b">${esc(exp.blurb)}</div>
      <div class="wi-target">Applied to <b>${esc(b.name)}</b></div>

      <div class="wi-slider">
        <div class="wi-sl-top"><span>${esc(exp.param.label)}</span>
          <span class="wi-val">${k.toFixed(2)}${esc(exp.param.unit)}</span></div>
        <input type="range" id="wi-range" min="${exp.param.min}" max="${exp.param.max}"
          step="${exp.param.step}" value="${k}">
      </div>

      <div class="wi-flow">
        <span class="wf-step">Original</span><span class="wf-ar">→</span>
        <span class="wf-step on">Parameter changed</span><span class="wf-ar">→</span>
        <span class="wf-step">Consequences</span>
      </div>

      <table class="wi-table">
        <thead><tr><th>Quantity</th><th>Original</th><th>Changed</th></tr></thead>
        <tbody>${res.rows.map(r => `<tr>
          <td>${esc(r[0])}</td><td class="wt-o">${esc(r[1])}</td><td class="wt-n">${esc(r[2])}</td></tr>`).join('')}</tbody>
      </table>

      <div class="wi-cons"><div class="wi-cons-t">Simulated consequences</div>
        ${res.consequences.map(c => `<div class="wi-c">${esc(c)}</div>`).join('')}</div>

      <div class="wi-note">${esc(res.note)}</div>
      <button class="pbtn" id="wi-orion">Ask ORION to explain this</button>
    </div>`;

  $('wi-x').onclick = () => $('whatif').classList.remove('on');
  $('whatif').querySelectorAll('.wi-tab').forEach(t => {
    t.onclick = () => { S.whatif = { id: t.dataset.e, k: null }; renderWhatIf(); };
  });
  const r = $('wi-range');
  r.oninput = () => { S.whatif.k = +r.value; renderWhatIf(); };
  r.onchange = () => {
    if (!S.experiments.has(exp.id)) {
      S.experiments.add(exp.id);
      CB.award?.(XP.experiment, `Experiment: ${exp.title}`);
      CB.checkMissions?.();
    }
  };
  $('wi-orion').onclick = () => {
    $('orion').classList.add('on');
    orionSay(`${exp.title}\n\n${res.consequences[0]}\n\n${res.consequences[1] || ''}\n\nNote: ${res.note}`, { proactive: true });
  };

  if (!S.experiments.has(exp.id)) {
    S.experiments.add(exp.id);
    CB.award?.(XP.experiment, `Experiment: ${exp.title}`);
    CB.checkMissions?.();
  }
}

/* ============================================================
   PROGRESSION PANEL
   ============================================================ */
export function renderProgress() {
  const L = levelFor(S.xp);
  const d = $('drawer');
  d.dataset.mode = 'progress';
  d.classList.add('on');

  const ach = ACHIEVEMENTS.map(a => {
    const have = S.tracks[a.track] ?? 0;
    const got = have >= a.need;
    return `<div class="ach ${got ? 'got' : ''}">
      <div class="ach-i">${a.icon}</div>
      <div class="ach-m">
        <div class="ach-n">${esc(a.name)}${got ? ' ✓' : ''}</div>
        <div class="ach-d">${esc(a.desc)}</div>
        <div class="ach-bar"><i style="width:${Math.min(100, (have / a.need) * 100)}%"></i></div>
      </div>
      <div class="ach-c">${Math.min(have, a.need)}/${a.need}</div>
    </div>`;
  }).join('');

  d.innerHTML = `<div class="panel-hd"><span><i class="dot"></i> Explorer Progress</span>
      <span>${S.xp.toLocaleString()} XP</span></div>
    <div class="lvl">
      <div class="lvl-top"><span class="lvl-n">Level ${L.level}</span>
        <span class="lvl-t">${esc(L.title)}</span></div>
      <div class="lvl-bar"><i style="width:${L.pct}%"></i></div>
      <div class="lvl-x">${L.into} / ${L.span} XP to level ${L.level + 1}</div>
    </div>
    <div class="ach-list">${ach}</div>`;
}

/* ============================================================
   MISSION DASHBOARD
   ============================================================ */
export function renderMissions() {
  const d = $('drawer');
  d.dataset.mode = 'missions';
  d.classList.add('on');
  const doneN = S.missions.filter(m => m.done).length;

  d.innerHTML = `<div class="panel-hd"><span><i class="dot"></i> Mission Dashboard</span>
      <span>${doneN}/${S.missions.length}</span></div>` +
    S.missions.map((m, i) => {
      const def = MISSIONS.find(x => x.id === m.id);
      const open = S.activeMission === i;
      const pct = (m.progress.size / def.stages.length) * 100;
      return `<div class="mission ${m.done ? 'done' : ''} ${open ? 'active' : ''}" data-i="${i}">
        <div class="m-top">
          <span class="m-t">${def.icon} ${esc(def.title)}</span>
          <span class="m-b">${m.done ? '✓ ' : ''}${esc(def.badge)}</span>
        </div>
        <div class="m-cat">${esc(def.category)}</div>
        <div class="m-d">${esc(def.brief)}</div>
        <div class="m-prog"><i class="m-fill" style="width:${pct}%"></i></div>
        <div class="m-pct">${m.progress.size} of ${def.stages.length} stages</div>
        ${open ? `<div class="m-stages">${def.stages.map((s, k) => `
          <div class="m-stage ${m.progress.has(k) ? 'hit' : ''}">
            <span class="ms-i">${m.progress.has(k) ? '✓' : k + 1}</span>
            <span class="ms-b"><b>${esc(s.label)}</b><br>${esc(s.desc)}</span>
          </div>`).join('')}</div>
          <div class="m-fact">${esc(def.fact)}</div>` : ''}
      </div>`;
    }).join('');

  d.querySelectorAll('.mission').forEach(el => {
    el.onclick = () => {
      S.activeMission = S.activeMission === +el.dataset.i ? null : +el.dataset.i;
      renderMissions();
    };
  });
}

/* ============================================================
   DISCOVERY JOURNAL
   ============================================================ */
export function renderJournal() {
  const d = $('drawer');
  d.dataset.mode = 'log';
  d.classList.add('on');
  d.innerHTML = `<div class="panel-hd"><span><i class="dot"></i> Discovery Journal</span>
      <span>${S.log.length} entries</span></div>` +
    (S.log.length
      ? S.log.map((e, i) => `<div class="logitem" data-i="${i}">
          <div><div class="log-n">${esc(e.name)}</div><div class="log-m">${esc(e.meta)}</div></div>
          <div class="log-e">${esc(e.stamp)}</div></div>`).join('')
      : `<div class="empty"><div class="empty-t">Nothing logged yet.</div>
         <div class="empty-h">Select an object and press L</div></div>`);
  d.querySelectorAll('.logitem').forEach(el => {
    el.onclick = () => CB.select?.(S.log[+el.dataset.i].body);
  });
}

/* ============================================================
   STORY MODE — Earth to Universe (§6)
   ============================================================ */
export function startStory() {
  S.story = { step: -1, t: 0 };
  $('story').classList.add('on');
  ['info', 'drawer', 'settings', 'orion', 'lab', 'whatif', 'compare'].forEach(x => $(x)?.classList.remove('on'));
  nextStory();
}

export function nextStory() {
  const st = S.story;
  if (!st) return;
  st.step++;
  if (st.step >= STORY.length) { endStory(); return; }
  const s = STORY[st.step];
  st.t = 0; st.dwell = s.dwell;

  const card = $('story-card');
  card.classList.remove('show');
  setTimeout(() => {
    $('story-scale').textContent = s.scale;
    $('story-title').textContent = s.title;
    $('story-text').textContent = s.text;
    card.classList.add('show');
  }, 480);

  CB.storyTarget?.(s);
}

export function endStory() {
  S.story = null;
  $('story').classList.remove('on');
  $('story-card').classList.remove('show');
  CB.nudge?.('Journey complete');
}

export function tickStory(dt) {
  if (!S.story) return;
  S.story.t += dt;
  const total = STORY.length;
  $('story-prog').firstElementChild.style.width =
    `${((S.story.step + S.story.t / S.story.dwell) / total) * 100}%`;
  if (S.story.t >= S.story.dwell) nextStory();
}
