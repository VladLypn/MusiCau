const canvas = document.getElementById("battle");
const ctx = canvas.getContext("2d", { alpha: false });
const hpFill = document.getElementById("hpFill");
const hpText = document.getElementById("hpText");
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart");
const spellbar = document.getElementById("spellbar");
const micToggle = document.getElementById("micToggle");
const chordNow = document.getElementById("chordNow");
const chordHint = document.getElementById("chordHint");
const cooldownFill = document.getElementById("cooldownFill");
const spellButtons = Array.from(document.querySelectorAll(".spellbar button"));

const bg = new Image();
bg.src = "assets/reference-battle.png";

const maxHp = 1000;
const spells = {
  1: { name: "Fire Comet", chord: "Em", damage: 120, color: "#ff9a3d", accent: "#fff0a8", type: "fire" },
  2: { name: "Frost Seal", chord: "Am", damage: 95, color: "#8df7ff", accent: "#e9ffff", type: "ice" },
  3: { name: "Storm Rift", chord: "D", damage: 145, color: "#d8b3ff", accent: "#ffffff", type: "storm" },
  4: { name: "Shadow Blades", chord: "G", damage: 110, color: "#ff4ca3", accent: "#3b143d", type: "shadow" },
  5: { name: "Solar Ray", chord: "C", damage: 210, color: "#ffe66d", accent: "#fff8cf", type: "beam" }
};
const chordToSpell = Object.fromEntries(
  Object.entries(spells).map(([key, spell]) => [spell.chord, key])
);
const pitchClasses = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const chordProfiles = [
  { chord: "Em", tones: ["E", "G", "B"], root: "E" },
  { chord: "Am", tones: ["A", "C", "E"], root: "A" },
  { chord: "D", tones: ["D", "F#", "A"], root: "D" },
  { chord: "G", tones: ["G", "B", "D"], root: "G" },
  { chord: "C", tones: ["C", "E", "G"], root: "C" }
];
const spellCooldownMs = 2000;
const chordConfirmationFrames = 4;
const chordReleaseMs = 260;
const chordConfidenceThresholds = {
  Em: 0.4,
  Am: 0.6,
  D: 0.58,
  G: 0.45,
  C: 0.6
};
const calibrationMs = 1500;
const noiseFloorAlpha = 0.995;
const thresholdMultiplier = 3;
const minimumRmsThreshold = 0.0012;
const gateHangoverMs = 260;
const chromaSmoothingWindow = 6;
const switchMargin = 0.03;

let state;
let view = { w: 1600, h: 900, scale: 1, dpr: 1, fit: 1, ox: 0, oy: 0 };
let last = nowMs();
let cooldownUntil = 0;
let cooldownActive = false;
let spellsDisabled = false;
let audioState = {
  context: null,
  stream: null,
  analyser: null,
  timeData: null,
  frequencyData: null,
  running: false,
  startedAt: 0,
  noiseFloor: minimumRmsThreshold,
  gateOpenUntil: 0,
  chromaHistory: [],
  candidateChord: null,
  candidateFrames: 0,
  stableChord: null,
  stableConfidence: 0,
  lastCastChord: null,
  lastChordAt: 0,
  lastAnalysisAt: 0
};
const maxFrameStep = 32;
const maxParticles = 260;
const maxScars = 12;
const maxFloatingText = 12;
window.__battleStats = { fps: 0, frameMs: 0, frames: 0 };
const embers = Array.from({ length: 34 }, (_, i) => ({
  x: (i * 257) % 1650,
  y: 40 + ((i * 97) % 650),
  r: 1.2 + (i % 3),
  alpha: 0.13 + (i % 4) * 0.035,
  green: 90 + i * 3
}));
const monsterSpikes = [
  [-150, 75, 0.1], [-130, -90, 1.3], [-92, -42, 2.1], [-75, -188, 3.4],
  [-36, -72, 4.1], [0, -215, 5.5], [35, -78, 6.2], [76, -165, 7.7],
  [91, -34, 8.5], [138, -92, 9.2], [126, 70, 10.8]
];

function resetGame() {
  state = {
    hp: maxHp,
    dead: false,
    castPose: 0,
    castGlow: 0,
    activeSpell: null,
    shake: 0,
    shakePhase: 0,
    hitFlash: 0,
    deathTime: 0,
    projectiles: [],
    particles: [],
    floatingText: [],
    scars: []
  };
  cooldownUntil = 0;
  cooldownActive = false;
  spellsDisabled = false;
  audioState.lastCastChord = null;
  updateHud();
  updateCooldownUi(nowMs());
  setStatus("Press 1-5 or play Em, Am, D, G, C.");
  spellButtons.forEach((button) => {
    button.classList.remove("active");
    button.disabled = false;
  });
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.35);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  const fit = Math.max(rect.width / 1600, rect.height / 900);
  view = {
    w: rect.width,
    h: rect.height,
    dpr,
    scale: Math.min(rect.width / 1600, rect.height / 900),
    fit,
    ox: (rect.width - 1600 * fit) / 2,
    oy: (rect.height - 900 * fit) / 2
  };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function world(x, y) {
  return { x: view.ox + x * view.fit, y: view.oy + y * view.fit, s: view.fit };
}

function requestCastSpell(key, source = "key") {
  if (!spells[key]) return;
  if (state.dead) {
    resetGame();
    return;
  }

  const now = nowMs();
  if (now < cooldownUntil) {
    const remaining = Math.ceil((cooldownUntil - now) / 100) / 10;
    const spell = spells[key];
    setStatus(`${spell.chord || key}: magic recharging ${remaining.toFixed(1)}s`);
    return;
  }

  castSpell(key, source);
  cooldownUntil = now + spellCooldownMs;
  cooldownActive = true;
  updateCooldownUi(now);
}

function castSpell(key, source = "key") {
  if (!spells[key]) return;
  const spell = spells[key];
  const start = { x: 1246, y: 628 };
  const target = { x: 495, y: 330 };

  state.activeSpell = key;
  state.castPose = 1;
  state.castGlow = 1;
  state.shake = Math.max(state.shake, key === "5" ? 20 : 10);

  spellButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.spell === key);
  });

  if (spell.type === "beam") {
    state.projectiles.push({ spell, damage: spell.damage, start, target, age: 0, life: 520, beam: true, hit: false });
  } else if (spell.type === "storm") {
    for (let i = 0; i < 4; i++) {
      state.projectiles.push({
        spell,
        damage: splitDamage(spell.damage, 4, i),
        start: { x: start.x - i * 24, y: start.y - i * 10 },
        target: { x: target.x + 70 - i * 38, y: target.y - 90 + i * 36 },
        age: -i * 75,
        life: 650,
        seed: i * 17.31,
        hit: false
      });
    }
  } else if (spell.type === "shadow") {
    for (let i = 0; i < 5; i++) {
      state.projectiles.push({
        spell,
        damage: splitDamage(spell.damage, 5, i),
        start: { x: start.x - 15 + i * 11, y: start.y - 24 + i * 14 },
        target: { x: target.x - 76 + i * 36, y: target.y + 40 - i * 12 },
        age: -i * 42,
        life: 560,
        seed: i * 12.7,
        blade: true,
        hit: false
      });
    }
  } else {
    state.projectiles.push({ spell, damage: spell.damage, start, target, age: 0, life: spell.type === "ice" ? 760 : 640, hit: false });
  }

  setStatus(`${spell.chord} -> ${spell.name}: -${spell.damage} HP${source === "chord" ? " · chord" : ""}`);
}

function applyDamage(spell, target, damage = spell.damage) {
  if (state.dead) return;
  state.hp = Math.max(0, state.hp - damage);
  state.hitFlash = 1;
  state.shake = Math.max(state.shake, spell.type === "beam" ? 24 : 15);
  state.floatingText.push({ text: `-${damage}`, x: target.x, y: target.y - 70, age: 0, color: spell.color });
  if (state.floatingText.length > maxFloatingText) state.floatingText.shift();
  state.scars.push({ x: target.x + rand(-70, 60), y: target.y + rand(-45, 55), age: 0, color: spell.color });
  if (state.scars.length > maxScars) state.scars.shift();
  burst(target.x, target.y, spell.color, spell.accent, spell.type === "beam" ? 58 : 32);

  if (state.hp <= 0) {
    state.dead = true;
    state.deathTime = 0;
    setStatus("Monster defeated. Press any 1-5 key or button to restart.");
    burst(target.x, target.y, "#ff5d72", "#fff1a8", 96);
  }
  updateHud();
}

function burst(x, y, color, accent, count) {
  const fps = window.__battleStats.fps || 60;
  const qualityScale = fps < 42 ? 0.58 : fps < 52 ? 0.76 : 1;
  const available = Math.max(0, maxParticles - state.particles.length);
  const particleCount = Math.min(available, Math.max(8, Math.round(count * qualityScale)));

  for (let i = 0; i < particleCount; i++) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(60, 420);
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - rand(20, 140),
      r: rand(1.5, 6),
      age: 0,
      life: rand(460, 1150),
      color: Math.random() > 0.28 ? color : accent,
      glow: rand(6, 24)
    });
  }
}

function updateHud() {
  hpFill.style.width = `${(state.hp / maxHp) * 100}%`;
  hpText.textContent = `${state.hp} / ${maxHp} HP`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function drawBackground(t) {
  const p0 = world(0, 0);
  const p1 = world(1600, 900);
  if (bg.complete) {
    ctx.drawImage(bg, p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, view.w, view.h);
    gradient.addColorStop(0, "#1d164b");
    gradient.addColorStop(0.48, "#71306f");
    gradient.addColorStop(1, "#100b2d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  ctx.fillStyle = "rgba(7, 5, 19, 0.22)";
  ctx.fillRect(0, 0, view.w, view.h);

  for (const ember of embers) {
    const x = ((ember.x + t * 0.018) % 1650) - 25;
    const y = ember.y + Math.sin(t / 900 + ember.x) * 6;
    const p = world(x, y);
    ctx.fillStyle = `rgba(255, ${ember.green}, 123, ${ember.alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ember.r * p.s, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWizard(t) {
  const base = world(1245, 640);
  const s = base.s;
  const bob = Math.sin(t / 420) * 5 * s;
  const lean = state.castPose * -18 * s;
  const glow = state.castGlow;

  ctx.save();
  ctx.translate(base.x, base.y + bob);
  ctx.shadowBlur = 34 + glow * 36;
  ctx.shadowColor = "rgba(255, 112, 219, 0.72)";

  ctx.fillStyle = "rgba(13, 8, 31, 0.58)";
  ellipse(35 * s, 118 * s, 86 * s, 24 * s, -0.12);

  ctx.fillStyle = "#24194c";
  ctx.beginPath();
  ctx.moveTo(-36 * s, 15 * s);
  ctx.lineTo(-72 * s, 170 * s);
  ctx.lineTo(48 * s, 170 * s);
  ctx.lineTo(22 * s, 20 * s);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#3d2d79";
  ctx.beginPath();
  ctx.moveTo(-18 * s, 0);
  ctx.lineTo(-50 * s, -58 * s);
  ctx.lineTo(12 * s, -38 * s);
  ctx.lineTo(29 * s, 18 * s);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#ff74bb";
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.moveTo(-18 * s, 45 * s);
  ctx.lineTo(-48 * s + lean, 2 * s);
  ctx.lineTo(-98 * s + lean, -16 * s);
  ctx.stroke();

  ctx.strokeStyle = "#ffe184";
  ctx.lineWidth = 5 * s;
  ctx.beginPath();
  ctx.moveTo(54 * s, 112 * s);
  ctx.lineTo(86 * s, -92 * s);
  ctx.stroke();

  ctx.fillStyle = "#ffcf5c";
  ctx.beginPath();
  ctx.arc(88 * s, -103 * s, (12 + glow * 8) * s, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawMonster(t) {
  const m = world(485, 360);
  const s = m.s * 0.78;
  const death = state.dead ? Math.min(state.deathTime / 1900, 1) : 0;
  const hit = state.hitFlash;
  const breathe = Math.sin(t / 460) * 7 * s;
  const sink = death * 95 * s;
  const alpha = 1 - death * 0.9;

  ctx.save();
  const hitNudge = Math.sin(state.shakePhase * 1.7) * state.hitFlash * 9 * s;
  ctx.translate(m.x + hitNudge, m.y + breathe + sink);
  ctx.scale(1 + hit * 0.035, 1 - hit * 0.025);
  ctx.globalAlpha = alpha;
  ctx.shadowBlur = 42 + hit * 34;
  ctx.shadowColor = hit ? "rgba(255, 120, 87, 0.95)" : "rgba(255, 61, 101, 0.4)";

  ctx.fillStyle = "rgba(5, 3, 15, 0.54)";
  ellipse(10 * s, 184 * s, 210 * s, 35 * s, 0.02);

  ctx.fillStyle = hit ? "#ff7457" : "#120b2c";
  jaggedBody(s, death);

  ctx.fillStyle = hit ? "#ffe083" : "#ff4c63";
  ctx.beginPath();
  ctx.moveTo(-40 * s, -10 * s);
  ctx.lineTo(0, 42 * s);
  ctx.lineTo(40 * s, -10 * s);
  ctx.lineTo(16 * s, 18 * s);
  ctx.lineTo(0, 0);
  ctx.lineTo(-16 * s, 18 * s);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 72, 99, 0.78)";
  ctx.lineWidth = 6 * s;
  ctx.beginPath();
  ctx.moveTo(-82 * s, 44 * s);
  ctx.lineTo(-151 * s, 110 * s);
  ctx.lineTo(-174 * s, 170 * s);
  ctx.moveTo(82 * s, 48 * s);
  ctx.lineTo(148 * s, 108 * s);
  ctx.lineTo(169 * s, 168 * s);
  ctx.stroke();

  const scarStart = Math.max(0, state.scars.length - 9);
  for (let scarIndex = scarStart; scarIndex < state.scars.length; scarIndex++) {
    const scar = state.scars[scarIndex];
    ctx.globalAlpha = alpha * Math.max(0, 1 - scar.age / 1200);
    ctx.strokeStyle = scar.color;
    ctx.lineWidth = 4 * s;
    ctx.beginPath();
    ctx.moveTo((scar.x - 485 - 22) * s, (scar.y - 360 - 12) * s);
    ctx.lineTo((scar.x - 485 + 22) * s, (scar.y - 360 + 12) * s);
    ctx.stroke();
  }

  if (death > 0) {
    ctx.globalAlpha = death;
    ctx.fillStyle = "rgba(255, 70, 94, 0.2)";
    for (let i = 0; i < 28; i++) {
      const a = i * 0.72;
      const r = 50 + death * 280 + (i % 7) * 10;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * s, Math.sin(a) * r * 0.58 * s, (3 + i % 4) * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

function jaggedBody(s, death) {
  ctx.beginPath();
  ctx.moveTo(-130 * s, 96 * s);
  for (const [x, y, seed] of monsterSpikes) {
    const crumble = death * (58 + Math.sin(seed * 2.17) * 34);
    ctx.lineTo(x * s, (y - crumble) * s);
  }
  ctx.lineTo(132 * s, 116 * s);
  ctx.lineTo(78 * s, 174 * s);
  ctx.lineTo(-72 * s, 172 * s);
  ctx.closePath();
  ctx.fill();
}

function drawProjectiles(dt) {
  for (const p of state.projectiles) {
    if (p.age < 0) continue;
    const progress = clamp(p.age / p.life, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const from = world(p.start.x, p.start.y);
    const to = world(p.target.x, p.target.y);
    const x = lerp(from.x, to.x, eased);
    const y = lerp(from.y, to.y, eased) - Math.sin(progress * Math.PI) * 95 * from.s;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = p.spell.color;
    ctx.fillStyle = p.spell.accent;
    ctx.shadowColor = p.spell.color;
    ctx.shadowBlur = 26;

    if (p.beam) {
      ctx.lineCap = "round";
      ctx.lineWidth = (22 + Math.sin(p.age / 36) * 7) * from.s;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.lineWidth = 7 * from.s;
      ctx.strokeStyle = p.spell.accent;
      ctx.stroke();
    } else if (p.blade) {
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(to.y - from.y, to.x - from.x));
      ctx.fillStyle = p.spell.color;
      ctx.beginPath();
      ctx.moveTo(-42 * from.s, -5 * from.s);
      ctx.lineTo(36 * from.s, -2 * from.s);
      ctx.lineTo(52 * from.s, 0);
      ctx.lineTo(36 * from.s, 7 * from.s);
      ctx.lineTo(-42 * from.s, 5 * from.s);
      ctx.closePath();
      ctx.fill();
    } else if (p.spell.type === "ice") {
      ctx.strokeStyle = p.spell.color;
      ctx.lineWidth = 5 * from.s;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI * 2 * i) / 6 + p.age / 220;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * 34 * from.s, y + Math.sin(a) * 34 * from.s);
      }
      ctx.stroke();
      orb(x, y, 17 * from.s, p.spell.accent, p.spell.color);
    } else if (p.spell.type === "storm") {
      ctx.lineWidth = 5 * from.s;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      for (let i = 1; i <= 5; i++) {
        const q = i / 5 * eased;
        const wave = Math.sin(p.age / 42 + p.seed + i * 1.9);
        const wave2 = Math.cos(p.age / 55 + p.seed + i * 2.4);
        ctx.lineTo(
          lerp(from.x, to.x, q) + wave * 24 * from.s,
          lerp(from.y, to.y, q) + wave2 * 34 * from.s
        );
      }
      ctx.stroke();
      orb(x, y, 12 * from.s, p.spell.accent, p.spell.color);
    } else {
      ctx.lineWidth = 7 * from.s;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      orb(x, y, 25 * from.s, p.spell.accent, p.spell.color);
    }
    ctx.restore();

    if (!p.hit && progress >= 0.96) {
      p.hit = true;
      applyDamage(p.spell, p.target, p.damage);
    }
  }

  pruneArray(state.projectiles, (p) => p.age < p.life + 180);
}

function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of state.particles) {
    const a = Math.max(0, 1 - p.age / p.life);
    ctx.globalAlpha = a;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = p.glow;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFloatingText() {
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `900 ${Math.max(18, 36 * view.scale)}px ui-sans-serif, system-ui`;
  for (const item of state.floatingText) {
    const a = Math.max(0, 1 - item.age / 900);
    const p = world(item.x, item.y - item.age * 0.085);
    ctx.globalAlpha = a;
    ctx.fillStyle = item.color;
    ctx.shadowColor = item.color;
    ctx.shadowBlur = 18;
    ctx.fillText(item.text, p.x, p.y);
  }
  ctx.restore();
}

function update(dt) {
  const now = nowMs();
  state.castPose = Math.max(0, state.castPose - dt / 420);
  state.castGlow = Math.max(0, state.castGlow - dt / 520);
  state.shake = Math.max(0, state.shake - dt / 42);
  state.shakePhase += dt / 34;
  state.hitFlash = Math.max(0, state.hitFlash - dt / 240);
  if (state.dead) state.deathTime += dt;

  for (const p of state.projectiles) p.age += dt;
  for (const p of state.particles) {
    p.age += dt;
    p.x += p.vx * dt / 1000;
    p.y += p.vy * dt / 1000;
    p.vy += 380 * dt / 1000;
  }
  for (const item of state.floatingText) item.age += dt;
  for (const scar of state.scars) scar.age += dt;

  pruneArray(state.particles, (p) => p.age < p.life);
  pruneArray(state.floatingText, (item) => item.age < 900);
  pruneArray(state.scars, (scar) => scar.age < 2600);
  updateCooldownUi(now);
  analyzeChordInput(now);
}

function render(now) {
  now = now || nowMs();
  const dt = Math.min(maxFrameStep, now - last);
  last = now;
  window.__battleStats.frames += 1;
  window.__battleStats.frameMs = window.__battleStats.frameMs * 0.94 + dt * 0.06;
  window.__battleStats.fps = window.__battleStats.frameMs > 0 ? Math.round(1000 / window.__battleStats.frameMs) : 0;
  if (window.__battleStats.frames % 30 === 0) {
    document.body.dataset.frames = String(window.__battleStats.frames);
    document.body.dataset.fps = String(window.__battleStats.fps);
  }
  update(dt);

  ctx.save();
  ctx.clearRect(0, 0, view.w, view.h);
  if (state.shake > 0) {
    ctx.translate(
      Math.sin(state.shakePhase) * state.shake,
      Math.cos(state.shakePhase * 1.31) * state.shake * 0.7
    );
  }

  drawBackground(now);
  drawMonster(now);
  drawWizard(now);
  drawProjectiles(dt);
  drawParticles();
  drawFloatingText();

  ctx.restore();
  scheduleFrame(render);
}

function orb(x, y, radius, fill, glow) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.6);
  g.addColorStop(0, fill);
  g.addColorStop(0.36, glow);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius * 2.6, 0, Math.PI * 2);
  ctx.fill();
}

function ellipse(x, y, rx, ry, rot) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function splitDamage(total, parts, index) {
  const base = Math.floor(total / parts);
  return index === parts - 1 ? total - base * (parts - 1) : base;
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function scheduleFrame(callback) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
  } else {
    setTimeout(() => callback(nowMs()), 1000 / 60);
  }
}

async function startChordRecognition() {
  if (audioState.running) {
    stopChordRecognition();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser cannot access the microphone.");
    return;
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass({ latencyHint: "interactive" });
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      },
      video: false
    });
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.12;
    source.connect(analyser);
    if (context.state === "suspended") await context.resume();

    audioState = {
      ...audioState,
      context,
      stream,
      analyser,
      timeData: new Float32Array(analyser.fftSize),
      frequencyData: new Float32Array(analyser.frequencyBinCount),
      running: true,
      startedAt: nowMs(),
      noiseFloor: minimumRmsThreshold,
      gateOpenUntil: 0,
      chromaHistory: [],
      candidateChord: null,
      candidateFrames: 0,
      stableChord: null,
      stableConfidence: 0,
      lastCastChord: null,
      lastChordAt: 0,
      lastAnalysisAt: 0
    };
    micToggle.classList.add("listening");
    micToggle.textContent = "Calibrating...";
    chordHint.textContent = "Stay quiet for 1.5s";
    setStatus("Calibrating room noise. Wait a moment, then play a chord.");
  } catch (error) {
    console.error(error);
    setStatus("Could not enable the microphone. Check browser permission.");
  }
}

function stopChordRecognition() {
  audioState.stream?.getTracks().forEach((track) => track.stop());
  if (audioState.context && audioState.context.state !== "closed") {
    audioState.context.close();
  }
  audioState = {
    ...audioState,
    context: null,
    stream: null,
    analyser: null,
    timeData: null,
    frequencyData: null,
    running: false,
    chromaHistory: [],
    candidateChord: null,
    candidateFrames: 0,
    stableChord: null
  };
  micToggle.classList.remove("listening");
  micToggle.textContent = "Enable chords";
  chordNow.textContent = "--";
  chordHint.textContent = "Em · Am · D · G · C";
}

function analyzeChordInput(now) {
  if (!audioState.running || !audioState.analyser || !audioState.frequencyData || !audioState.timeData) return;
  if (now - audioState.lastAnalysisAt < 90) return;
  audioState.lastAnalysisAt = now;

  audioState.analyser.getFloatTimeDomainData(audioState.timeData);
  audioState.analyser.getFloatFrequencyData(audioState.frequencyData);
  const rms = calculateRms(audioState.timeData);
  const gate = updateAdaptiveGate(rms, audioState.frequencyData, audioState.context.sampleRate, audioState.analyser.fftSize, now);

  if (gate.calibrating) {
    chordNow.textContent = "--";
    chordHint.textContent = `Noise calibration ${Math.round(gate.progress * 100)}%`;
    return;
  }

  if (micToggle.textContent === "Calibrating...") {
    micToggle.textContent = "Chords enabled";
    setStatus("Play Em, Am, D, G, or C to cast spells.");
  }

  if (!gate.open) {
    releaseChordCandidate(now, "Background rejected");
    return;
  }

  const rawChroma = chromaFromFrequencyData(
    audioState.frequencyData,
    audioState.context.sampleRate,
    audioState.analyser.fftSize
  );
  const chroma = smoothChroma(rawChroma);
  const best = correctAmbiguousChord(detectChordFromChroma(chroma), chroma);

  if (!best || best.confidence < confidenceThresholdFor(best.chord)) {
    releaseChordCandidate(now, `Waiting for chord · RMS ${rms.toFixed(4)}`);
    return;
  }

  audioState.lastChordAt = now;
  if (isLikelyCTailMisreadAsEm(best.chord, best.confidence, chroma)) {
    chordNow.textContent = "C";
    chordHint.textContent = "Holding C · chord tail";
    return;
  }

  const currentBeatsStable =
    !audioState.stableChord ||
    best.chord === audioState.stableChord ||
    best.confidence > audioState.stableConfidence + switchMargin;

  if (!currentBeatsStable) {
    chordNow.textContent = audioState.stableChord || best.chord;
    chordHint.textContent = `Holding ${audioState.stableChord} · ${(best.confidence * 100).toFixed(0)}%`;
    return;
  }

  if (audioState.candidateChord === best.chord) {
    audioState.candidateFrames += 1;
  } else {
    audioState.candidateChord = best.chord;
    audioState.candidateFrames = 1;
  }

  chordNow.textContent = best.chord;
  chordHint.textContent = `${Math.round(best.confidence * 100)}% · SNR ${gate.snr.toFixed(1)}x`;

  if (audioState.candidateFrames < chordConfirmationFrames) return;

  audioState.stableChord = best.chord;
  audioState.stableConfidence = best.confidence;
  const spellKey = chordToSpell[best.chord];
  if (!spellKey || audioState.lastCastChord === best.chord) return;

  if (now >= cooldownUntil) {
    audioState.lastCastChord = best.chord;
    requestCastSpell(spellKey, "chord");
  }
}

function chromaFromFrequencyData(frequencyData, sampleRate, fftSize) {
  const chroma = Array.from({ length: 12 }, () => 0);
  const nyquistBinHz = sampleRate / fftSize;
  let maxEnergy = 0;

  for (let bin = 1; bin < frequencyData.length; bin++) {
    const frequency = bin * nyquistBinHz;
    if (frequency < 75 || frequency > 1500) continue;

    const db = frequencyData[bin];
    if (!Number.isFinite(db) || db < -82) continue;

    const midi = 69 + 12 * Math.log2(frequency / 440);
    const nearestMidi = Math.round(midi);
    const cents = Math.abs((midi - nearestMidi) * 100);
    if (cents > 50) continue;

    const pitchClass = ((nearestMidi % 12) + 12) % 12;
    const magnitude = Math.pow(10, db / 20);
    const tuningWeight = Math.cos((cents / 50) * (Math.PI / 2));
    const guitarWeight = frequency < 95 ? 1.4 : frequency < 180 ? 1.18 : 1;
    const energy = magnitude * tuningWeight * guitarWeight;
    chroma[pitchClass] += energy;
    maxEnergy = Math.max(maxEnergy, chroma[pitchClass]);
  }

  if (maxEnergy <= 0) return chroma;
  return chroma.map((value) => value / maxEnergy);
}

function calculateRms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function updateAdaptiveGate(rms, frequencyData, sampleRate, fftSize, now) {
  const elapsed = now - audioState.startedAt;
  const calibrating = elapsed < calibrationMs;
  const threshold = Math.max(audioState.noiseFloor * thresholdMultiplier, minimumRmsThreshold);
  const snr = rms / Math.max(audioState.noiseFloor, 0.000001);
  const speechLike = isLikelySpeechOrClick(frequencyData, sampleRate, fftSize);
  const shouldOpen = !calibrating && rms >= threshold && snr >= 1.55 && !speechLike;

  if (shouldOpen) {
    audioState.gateOpenUntil = now + gateHangoverMs;
  }

  const open =
    shouldOpen ||
    (!calibrating && now <= audioState.gateOpenUntil && snr >= 1.18 && !speechLike);
  const shouldTrackNoise = calibrating || !open || rms < threshold || speechLike;
  const alpha = shouldTrackNoise ? noiseFloorAlpha : 0.9996;
  audioState.noiseFloor = alpha * audioState.noiseFloor + (1 - alpha) * Math.max(rms, minimumRmsThreshold * 0.35);

  return {
    open,
    calibrating,
    snr,
    threshold,
    progress: calibrationMs > 0 ? clamp(elapsed / calibrationMs, 0, 1) : 1
  };
}

function isLikelySpeechOrClick(frequencyData, sampleRate, fftSize) {
  const binHz = sampleRate / fftSize;
  let guitarBand = 0;
  let speechBand = 0;
  let highBand = 0;
  let weightedFrequency = 0;
  let total = 0;

  for (let bin = 1; bin < frequencyData.length; bin++) {
    const frequency = bin * binHz;
    const db = frequencyData[bin];
    if (!Number.isFinite(db) || db < -90) continue;

    const magnitude = Math.pow(10, db / 20);
    total += magnitude;
    weightedFrequency += magnitude * frequency;

    if (frequency >= 75 && frequency <= 1500) guitarBand += magnitude;
    if (frequency >= 300 && frequency <= 3400) speechBand += magnitude;
    if (frequency >= 4200 && frequency <= 9000) highBand += magnitude;
  }

  const centroid = total > 0 ? weightedFrequency / total : 0;
  const speechDominance = speechBand / Math.max(guitarBand, 0.000001);
  const clickDominance = highBand / Math.max(guitarBand + speechBand, 0.000001);

  return (centroid > 1150 && speechDominance > 2.15) || clickDominance > 0.38;
}

function smoothChroma(chroma) {
  audioState.chromaHistory.push(chroma);
  while (audioState.chromaHistory.length > chromaSmoothingWindow) {
    audioState.chromaHistory.shift();
  }

  const smoothed = Array.from({ length: 12 }, () => 0);
  for (const frame of audioState.chromaHistory) {
    for (let i = 0; i < smoothed.length; i++) {
      smoothed[i] += frame[i];
    }
  }

  let max = 0;
  for (let i = 0; i < smoothed.length; i++) {
    smoothed[i] /= audioState.chromaHistory.length;
    max = Math.max(max, smoothed[i]);
  }

  return max > 0 ? smoothed.map((value) => value / max) : smoothed;
}

function releaseChordCandidate(now, hint) {
  if (now - audioState.lastChordAt > chordReleaseMs) {
    audioState.stableChord = null;
    audioState.stableConfidence = 0;
    audioState.candidateChord = null;
    audioState.candidateFrames = 0;
    audioState.lastCastChord = null;
    audioState.chromaHistory.length = 0;
    chordNow.textContent = "--";
    chordHint.textContent = hint;
  }
}

function detectChordFromChroma(chroma) {
  const totalEnergy = chroma.reduce((sum, value) => sum + value, 0);
  if (totalEnergy < 0.22) return null;

  const ranked = chordProfiles
    .map((profile) => {
      const toneIndexes = profile.tones.map((tone) => pitchClasses.indexOf(tone));
      const toneEnergy = toneIndexes.reduce((sum, index) => sum + chroma[index], 0);
      const coverage = toneEnergy / Math.max(totalEnergy, 0.000001);
      const missingPenalty = toneIndexes.reduce((sum, index) => {
        return sum + (chroma[index] < 0.13 ? 0.09 : 0);
      }, 0);
      const extraPenalty = chroma.reduce((sum, energy, index) => {
        return toneIndexes.includes(index) ? sum : sum + Math.max(0, energy - 0.32) * 0.04;
      }, 0);
      const rootSupport = chroma[pitchClasses.indexOf(profile.root)] * 0.12;
      const vector = toneIndexes.map((index) => chroma[index]);
      const balance = Math.min(...vector) / Math.max(...vector, 0.000001);
      const confidence =
        coverage * 0.62 +
        rootSupport +
        balance * 0.18 -
        missingPenalty -
        extraPenalty +
        chordProfileAdjustment(profile, chroma);
      return { chord: profile.chord, confidence: clamp(confidence, 0, 1) };
    })
    .sort((a, b) => b.confidence - a.confidence);

  return ranked[0];
}

function confidenceThresholdFor(chord) {
  return chordConfidenceThresholds[chord] ?? 0.6;
}

function correctAmbiguousChord(best, chroma) {
  if (!best) return best;

  const energy = (pitchClass) => chroma[pitchClasses.indexOf(pitchClass)] || 0;
  const aEnergy = energy("A");
  const cEnergy = energy("C");
  const eEnergy = energy("E");
  const gEnergy = energy("G");
  const amShape =
    aEnergy > 0.08 &&
    Math.min(cEnergy, eEnergy) > 0.14 &&
    gEnergy < Math.max(0.5, aEnergy * 1.8);

  if (best.chord === "C" && amShape) {
    return {
      chord: "Am",
      confidence: Math.max(best.confidence, 0.58)
    };
  }

  return best;
}

function chordProfileAdjustment(profile, chroma) {
  const energy = (pitchClass) => chroma[pitchClasses.indexOf(pitchClass)] || 0;

  if (profile.chord === "Em") {
    const cEnergy = energy("C");
    const eEnergy = energy("E");
    const gEnergy = energy("G");
    const bEnergy = energy("B");
    const looksLikeCTail = cEnergy > 0.16 && Math.min(eEnergy, gEnergy) > 0.22;
    const lacksStrongB = bEnergy < Math.max(0.24, cEnergy * 1.15);

    return looksLikeCTail && lacksStrongB ? -0.18 : 0;
  }

  if (profile.chord === "C") {
    const aEnergy = energy("A");
    const cEnergy = energy("C");
    const eEnergy = energy("E");
    const gEnergy = energy("G");
    const sharedCTones = Math.min(cEnergy, eEnergy);
    const looksLikeAm =
      aEnergy > 0.08 &&
      sharedCTones > 0.14 &&
      gEnergy < Math.max(0.42, aEnergy * 1.45);
    if (looksLikeAm) return -0.34;

    return cEnergy > 0.12 && Math.min(eEnergy, gEnergy) > 0.18 && gEnergy > aEnergy * 1.12
      ? 0.08
      : 0;
  }

  if (profile.chord === "Am") {
    const aEnergy = energy("A");
    const cEnergy = energy("C");
    const eEnergy = energy("E");
    const gEnergy = energy("G");
    const hasAmShape = aEnergy > 0.08 && Math.min(cEnergy, eEnergy) > 0.14;
    const gNotDominant = gEnergy < Math.max(0.48, aEnergy * 1.7);

    return hasAmShape && gNotDominant ? 0.24 : 0;
  }

  return 0;
}

function isLikelyCTailMisreadAsEm(chord, confidence, chroma) {
  if (audioState.stableChord !== "C" || chord !== "Em") return false;

  const energy = (pitchClass) => chroma[pitchClasses.indexOf(pitchClass)] || 0;
  const cEnergy = energy("C");
  const eEnergy = energy("E");
  const gEnergy = energy("G");
  const bEnergy = energy("B");
  const cStillPresent = cEnergy > 0.12 && Math.min(eEnergy, gEnergy) > 0.18;
  const bNotDominant = bEnergy < Math.max(0.28, cEnergy * 1.25);

  return cStillPresent && bNotDominant && confidence < audioState.stableConfidence + 0.16;
}

function updateCooldownUi(now) {
  const remaining = Math.max(0, cooldownUntil - now);
  const progress = remaining / spellCooldownMs;
  cooldownFill.style.width = `${progress * 100}%`;
  const shouldDisableSpells = remaining > 0;
  if (spellsDisabled !== shouldDisableSpells) {
    spellsDisabled = shouldDisableSpells;
    document.body.classList.toggle("spell-cooling", shouldDisableSpells);
    spellButtons.forEach((button) => {
      button.disabled = shouldDisableSpells;
    });
  }

  if (cooldownActive && remaining <= 0) {
    cooldownActive = false;
    if (!state.dead) {
      setStatus(audioState.running ? "Ready. Play the next chord." : "Magic ready.");
    }
  }
}

function pruneArray(items, keep) {
  let write = 0;
  for (let read = 0; read < items.length; read++) {
    const item = items[read];
    if (keep(item)) {
      items[write] = item;
      write += 1;
    }
  }
  items.length = write;
}

window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (spells[event.key]) requestCastSpell(event.key, "key");
});

spellbar.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-spell]");
  if (button) requestCastSpell(button.dataset.spell, "button");
});

restartBtn.addEventListener("click", resetGame);
micToggle.addEventListener("click", () => void startChordRecognition());

resize();
resetGame();
scheduleFrame((now) => {
  last = now;
  render(now);
});
