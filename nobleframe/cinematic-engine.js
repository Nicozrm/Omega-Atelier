/* ═══════════════════════════════════════════════════════════════════════
   NobleFrame Cinematic Engine v3 — Canvas 2D
   ─────────────────────────────────────────────────────────────────────────
   Komplett neu, bewusst OHNE WebGL: reines HTML5 Canvas 2D. Damit gibt es
   keine Shader-Kompilierung, keine Float-Rendertargets, keinen GPU-
   Context-Verlust — die Sequenz läuft zuverlässig auch auf mobilem Safari
   und älteren Geräten (genau dort ist die alte WebGL-Version ausgefallen).

   Bild:  ein unendlicher Korridor aus goldenen Rahmen (NobleFrame-Logo),
          Fluchtpunkt-Licht am Ende, Goldstaub, Spiegelboden-Grid,
          Gold-Bänder, Glyphen-Regen im Code-Kapitel.
   Look:  additives Compositing ('lighter') + Motion-Blur-Trails +
          Zwei-Pass-Bloom (Down-/Upscale) + Vignette. Gold auf Schwarz.
   Steuerung: scroll-gescrubbte Kamerafahrt, 5 Kapitel, Maus-Parallaxe,
          Klick-Schockwellen, Skip, Letterbox + Film-Slate.

   Fallback: ohne JS / ohne Canvas / bei prefers-reduced-motion bleibt der
   statische Hero (CSS). Adaptive Qualität bei schwacher Framerate.
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const root = document.documentElement;
  const wrap = document.querySelector('[data-cine]');
  if (!wrap) return;

  const stage = wrap.querySelector('[data-cine-stage]');
  const canvas = wrap.querySelector('[data-cine-canvas]');
  const chapterEls = [...wrap.querySelectorAll('[data-cine-chapter]')]
    .sort((a, b) => (+a.dataset.cineChapter) - (+b.dataset.cineChapter));
  const barTop = wrap.querySelector('[data-cine-bar-top]');
  const barBot = wrap.querySelector('[data-cine-bar-bottom]');
  const railFill = wrap.querySelector('[data-cine-railfill]');
  const tickEls = [...wrap.querySelectorAll('[data-cine-tick]')];
  const skipBtn = wrap.querySelector('[data-cine-skip]');
  const slateEl = wrap.querySelector('[data-cine-slate]');

  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  const coarseMq = matchMedia('(pointer: coarse)');

  function bail() {
    root.classList.remove('cine-live');
    root.classList.add('cine-fallback');
  }

  if (!stage || !canvas || reducedMq.matches) { bail(); return; }

  let vctx = null;   // sichtbares Canvas (nur Compositing)
  try {
    vctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  } catch (_) { vctx = null; }
  if (!vctx) { try { vctx = canvas.getContext('2d'); } catch (_) { /* s.u. */ } }
  if (!vctx) { bail(); return; }

  // Offscreen-„Szene": wird jedes Frame frisch (transparent) gezeichnet.
  // Dadurch kann das Bloom (das nur aus der Szene liest) nicht mit den
  // Motion-Blur-Trails des sichtbaren Canvas zurückkoppeln → kein Weißbrand.
  const scene = document.createElement('canvas');
  const sctx = scene.getContext('2d');
  const bloom = document.createElement('canvas');
  const bctx = bloom.getContext('2d');
  const bloom2 = document.createElement('canvas');
  const b2ctx = bloom2.getContext('2d');
  // Alle Szenen-Zeichenbefehle (inkl. Helfer) schreiben auf `ctx` = Szene.
  const ctx = sctx;

  /* ── Konfiguration ──────────────────────────────────────────────────── */
  const isMobile = coarseMq.matches || innerWidth < 820;
  const fxLock = new URLSearchParams(location.search).get('cinefx') === 'max';
  const CFG = {
    frames: 60,
    spacing: 3.0,
    halfW: 3.05,
    halfH: 1.92,
    length: 60 * 3.0,
    lightZ: 60 * 3.0 + 20,
    particles: isMobile ? 260 : 620,
    particleSpan: 70,
    glyphs: isMobile ? 90 : 200,
    ribbons: 3,
    ribbonSteps: isMobile ? 40 : 60,
    dprMax: Math.min(devicePixelRatio || 1, isMobile ? 1.6 : 2),
    focal: 0.60,       // * min(cssW,cssH) → Brennweite in px
    grain: true,
  };

  const GOLD = '201,169,98';
  const GOLD_HI = '236,220,178';
  const GLY = 'NOBLEFRAME<>{}[]()=+-*/#@01λΩ∑∆'.split('');

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rnd = (i) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const pathX = (z) => 0.85 * Math.sin(z * 0.028) + 0.42 * Math.sin(z * 0.013 + 2.0);
  const pathY = (z) => 0.30 * Math.sin(z * 0.020 + 1.1);

  /* ── Szenen-Daten ───────────────────────────────────────────────────── */
  const frames = [];
  for (let i = 0; i < CFG.frames; i++) {
    frames.push({
      z: 6 + i * CFG.spacing,
      seed: rnd(i),
      inner: i % 3 === 1,
      cross: i % 3 === 1,
    });
  }
  const particles = [];
  for (let i = 0; i < CFG.particles; i++) {
    particles.push({
      x: (rnd(i * 3 + 11) * 2 - 1) * 8.5,
      y: (rnd(i * 3 + 12) * 2 - 1) * 5.2 + 0.3,
      z: rnd(i * 3 + 13) * CFG.particleSpan,
      r: 0.6 + rnd(i * 5 + 21) * 1.7,
      ph: rnd(i * 5 + 22) * 6.2831,
      hi: rnd(i * 5 + 23) > 0.82,
    });
  }
  const glyphs = [];
  for (let i = 0; i < CFG.glyphs; i++) {
    const wall = rnd(i * 7 + 3) < 0.7;
    const side = rnd(i * 7 + 5) < 0.5 ? -1 : 1;
    glyphs.push({
      x: wall ? side * (7.5 + rnd(i * 7 + 9) * 3.0) : (rnd(i * 7 + 9) * 2 - 1) * 7,
      y0: rnd(i * 7 + 11) * 14,
      z: 10 + rnd(i * 7 + 13) * (CFG.length - 8),
      spd: 1.4 + rnd(i * 7 + 15) * 3.0,
      ch: GLY[Math.floor(rnd(i * 7 + 17) * GLY.length)],
      sz: 0.5 + rnd(i * 7 + 19) * 0.5,
      ph: rnd(i * 7 + 23),
    });
  }

  /* ── Zustand ────────────────────────────────────────────────────────── */
  let dpr = CFG.dprMax;
  let cssW = 0, cssH = 0, W = 0, H = 0, foc = 400;
  let bw = 0, bh = 0;
  let wrapTop = 0, travel = 1;
  let p = 0, pSm = 0, pPrev = 0, warp = 0;
  let mouseX = 0, mouseY = 0, mSmX = 0, mSmY = 0;
  let time = 0, lastT = 0;
  let running = false, inView = true, destroyed = false, lowFX = false;
  let raf = 0;
  const rings = [];
  let perfAcc = 0, perfN = 0, perfCooldown = 0;
  let slatePrev = '';

  function measure() {
    const r = wrap.getBoundingClientRect();
    wrapTop = r.top + scrollY;
    cssW = stage.clientWidth; cssH = stage.clientHeight;
    travel = Math.max(wrap.offsetHeight - cssH, 1);
    resize();
  }
  function resize() {
    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    if (w === W && h === H) return;
    W = w; H = h;
    canvas.width = w; canvas.height = h;
    scene.width = w; scene.height = h;
    bw = Math.max(2, w >> 2); bh = Math.max(2, h >> 2);
    bloom.width = bw; bloom.height = bh;
    bloom2.width = Math.max(2, w >> 3); bloom2.height = Math.max(2, h >> 3);
    // Brennweite an der kleineren Kante, aber im Hochformat großzügiger,
    // damit der Tunnel nicht die ganze Höhe überstrahlt.
    foc = CFG.focal * Math.min(w, h) * (w > h ? 1.15 : 1.55);
  }
  function updateProgress() { p = clamp((scrollY - wrapTop) / travel, 0, 1); }

  /* ── Kapitel-Choreografie (DOM) ─────────────────────────────────────── */
  const chapters = chapterEls.map((el) => ({ el, on: false, vis: false }));
  let curtainDone = false;
  function curtainOpen() {
    if (curtainDone) return true;
    const cu = document.getElementById('curtainOverlay');
    curtainDone = !cu || cu.classList.contains('open');
    return curtainDone;
  }

  function splitWords(el, letters) {
    let i = 0;
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          const parts = letters ? n.textContent.split('') : n.textContent.split(/([^\S ]+)/);
          parts.forEach((part) => {
            if (!part) return;
            if (!letters && /^[^\S ]+$/.test(part)) {
              frag.appendChild(document.createTextNode(part));
            } else {
              const s = document.createElement('span');
              s.className = 'cw';
              s.style.setProperty('--i', i++);
              s.textContent = part;
              frag.appendChild(s);
            }
          });
          node.replaceChild(frag, n);
        } else if (n.nodeType === 1) walk(n);
      });
    };
    walk(el);
    if (!letters) {
      const all = [...el.querySelectorAll('.cw')];
      all.forEach((s, k) => {
        if (k > 0 && /^[.,!?:;]+$/.test(s.textContent)) {
          all[k - 1].textContent += s.textContent;
          s.remove();
        }
      });
    }
  }

  function chapterWindow(i, q) {
    switch (i) {
      case 0: return 1 - sstep(0.055, 0.150, q);
      case 1: return sstep(0.150, 0.215, q) * (1 - sstep(0.345, 0.410, q));
      case 2: return sstep(0.375, 0.440, q) * (1 - sstep(0.565, 0.630, q));
      case 3: return sstep(0.595, 0.660, q) * (1 - sstep(0.775, 0.840, q));
      default: return sstep(0.880, 0.955, q);
    }
  }
  const chapterMid = [0.0, 0.28, 0.50, 0.72, 0.95];
  const tickPos = [0.02, 0.28, 0.50, 0.72, 0.95];
  function currentChapter(q) {
    if (q < 0.165) return 0;
    if (q < 0.395) return 1;
    if (q < 0.61) return 2;
    if (q < 0.845) return 3;
    return 4;
  }

  function updateDom(q) {
    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i];
      const o = chapterWindow(i, q);
      const drift = (chapterMid[i] - q) * (i === 0 ? 900 : 620);
      const ty = i === 4 ? Math.max(drift * 0.25, 0) : drift * 0.35;
      c.el.style.opacity = o.toFixed(3);
      c.el.style.transform = 'translateY(' + ty.toFixed(1) + 'px)';
      const on = o > 0.005;
      if (on !== c.on) {
        c.on = on;
        c.el.style.visibility = on ? 'visible' : 'hidden';
        c.el.classList.toggle('cine-on', on && i === chapters.length - 1);
      }
      const gate = i !== 0 || curtainOpen() || q > 0.02;
      if (!c.vis && o > 0.32 && gate) { c.vis = true; c.el.classList.add('cine-vis'); }
      else if (c.vis && o < 0.04) { c.vis = false; c.el.classList.remove('cine-vis'); }
    }
    const barOut = sstep(0.80, 0.90, q);
    if (barTop) barTop.style.transform = 'translateY(' + (-barOut * 101).toFixed(1) + '%)';
    if (barBot) barBot.style.transform = 'translateY(' + (barOut * 101).toFixed(1) + '%)';
    if (railFill) railFill.style.transform = 'translateX(-50%) scaleY(' + q.toFixed(4) + ')';
    for (let i = 0; i < tickEls.length; i++) tickEls[i].classList.toggle('on', q >= tickPos[i] - 0.012);
    if (skipBtn) {
      const so = 1 - sstep(0.78, 0.85, q);
      skipBtn.style.opacity = so.toFixed(3);
      skipBtn.style.pointerEvents = so < 0.1 ? 'none' : 'auto';
    }
    if (slateEl) {
      const total = q * 96;
      const mm = String(Math.floor(total / 60)).padStart(2, '0');
      const ss = String(Math.floor(total % 60)).padStart(2, '0');
      const ff = String(Math.floor((total % 1) * 24)).padStart(2, '0');
      const txt = 'NF · ' + mm + ':' + ss + ':' + ff + ' · KAPITEL 0' + currentChapter(q) + ' / 04';
      if (txt !== slatePrev) { slatePrev = txt; slateEl.textContent = txt; }
    }
  }

  /* ── Projektion ─────────────────────────────────────────────────────── */
  // Kamera bei (camX,camY,camZ), Blick +z. Rückgabe: [sx, sy, scale] oder null.
  let camX = 0, camY = 0, camZ = 0, rollC = 1, rollS = 0;
  function project(x, y, z) {
    const dz = z - camZ;
    if (dz < 0.35) return null;
    const s = foc / dz;
    let px = (x - camX) * s;
    let py = (y - camY) * s;
    // Kamera-Roll
    const rx = px * rollC - py * rollS;
    const ry = px * rollS + py * rollC;
    return [W * 0.5 + rx, H * 0.5 - ry, s];
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function draw(now) {
    if (destroyed) return;
    raf = requestAnimationFrame(draw);
    if (!lastT) lastT = now;
    const rawDt = (now - lastT) / 1000;
    const dt = clamp(rawDt, 0.001, 0.05);
    const dtW = clamp(rawDt, 0.001, 0.5);
    lastT = now;
    time += dt;

    updateProgress();
    pPrev = pSm;
    pSm += (p - pSm) * (1 - Math.exp(-dtW * 7));
    const vel = Math.abs(pSm - pPrev) / dtW;
    warp += (clamp(vel * 8, 0, 1) - warp) * (1 - Math.exp(-dtW * 5));
    mSmX += (mouseX - mSmX) * (1 - Math.exp(-dtW * 5));
    mSmY += (mouseY - mSmY) * (1 - Math.exp(-dtW * 5));

    const q = pSm;
    updateDom(q);

    // Choreografie
    const eased = q * (0.92 + 0.08 * q);
    camZ = 1 + eased * (CFG.length - 4);
    const twist = Math.exp(-Math.pow((q - 0.50) / 0.14, 2));       // Design: Spirale
    const align = sstep(0.56, 0.66, q) * (1 - sstep(0.80, 0.88, q)); // Code: Grid
    const burst = sstep(0.80, 0.90, q) * (1 - sstep(0.905, 0.97, q));
    const calm = sstep(0.90, 0.975, q);
    const glyphAmt = sstep(0.58, 0.66, q) * (1 - sstep(0.80, 0.88, q));
    const ribbonAmt = sstep(0.10, 0.20, q) * (1 - sstep(0.55, 0.66, q)) + 0.5 * burst;

    // Kamera-Pose
    const shake = burst * (1 - calm) * 6 + warp * 2;
    camX = pathX(camZ) + 0.22 * Math.sin(time * 0.23) + mSmX * 1.1
      + (rnd(Math.floor(time * 60)) - 0.5) * shake * 0.05;
    camY = pathY(camZ) + 0.14 * Math.sin(time * 0.19 + 0.8) + mSmY * 0.7 + 0.15
      + (rnd(Math.floor(time * 60) + 9) - 0.5) * shake * 0.04;
    const bank = (pathX(camZ + 6) - pathX(camZ)) * 0.06 + mSmX * 0.02 + 0.01 * Math.sin(time * 0.16);
    rollC = Math.cos(bank); rollS = Math.sin(bank);

    const foclen = foc;

    /* — Motion-Blur-Trail: statt Clear ein halbtransparentes Schwarz — */
    // Sichtbares Canvas: Motion-Blur-Trail (halbtransparentes Schwarz statt Clear)
    vctx.globalCompositeOperation = 'source-over';
    const fade = clamp(0.40 - warp * 0.16 - burst * 0.05, 0.16, 0.5);
    vctx.fillStyle = 'rgba(4,3,2,' + fade.toFixed(3) + ')';
    vctx.fillRect(0, 0, W, H);

    // Szene frisch & transparent aufbauen (additiv)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';

    // Fluchtpunkt-Licht (radialer Verlauf), leuchtet im Burst auf
    const lp = project(0, 1.0, CFG.lightZ);
    let lightU = 0.5, lightV = 0.42;
    if (lp) {
      lightU = lp[0] / W; lightV = lp[1] / H;
      const lr = (Math.min(W, H) * (0.07 + burst * 0.42)) * (1 - 0.6 * calm);
      const g = ctx.createRadialGradient(lp[0], lp[1], 0, lp[0], lp[1], Math.max(lr, 6));
      const li = (0.42 + burst * 0.7) * (1 - 0.7 * calm);
      g.addColorStop(0, 'rgba(255,247,225,' + clamp(li, 0, 1).toFixed(3) + ')');
      g.addColorStop(0.35, 'rgba(' + GOLD_HI + ',' + (0.32 * li).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + GOLD + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(lp[0], lp[1], Math.max(lr, 6), 0, 6.2832);
      ctx.fill();
    }

    // Spiegelboden-Grid (Code-Kapitel)
    if (align > 0.02) {
      ctx.lineWidth = Math.max(1, dpr);
      const floorY = -2.4;
      for (let gx = -8; gx <= 8; gx += 2) {
        drawWorldLine(gx, floorY, camZ + 1.2, gx, floorY, CFG.length, GOLD, 0.16 * align);
      }
      for (let gz = Math.ceil(camZ); gz < CFG.length; gz += 3) {
        drawWorldLine(-8, floorY, gz, 8, floorY, gz, GOLD, 0.12 * align);
      }
    }

    // Gold-Bänder (Ribbons) als leuchtende Sinuslinien
    if (ribbonAmt > 0.02) {
      for (let r = 0; r < CFG.ribbons; r++) {
        const ph = r * 2.399;
        ctx.beginPath();
        let started = false;
        for (let k = 0; k <= CFG.ribbonSteps; k++) {
          const t = k / CFG.ribbonSteps;
          const z = camZ + 0.5 + t * (CFG.length * 0.85);
          const x = Math.sin(t * 9 + ph + time * 0.3) * (2.6 + 1.2 * Math.sin(t * 3 + ph));
          const y = 0.4 + Math.sin(t * 6 + ph * 2 + time * 0.24) * 1.9;
          const s = project(x, y, z);
          if (!s) { started = false; continue; }
          if (!started) { ctx.moveTo(s[0], s[1]); started = true; }
          else ctx.lineTo(s[0], s[1]);
        }
        ctx.strokeStyle = 'rgba(' + GOLD_HI + ',' + (0.10 * ribbonAmt).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1.5, 3 * dpr);
        ctx.stroke();
      }
    }

    // Rahmen-Korridor (fern → nah, additiv)
    ctx.lineWidth = Math.max(1, 1.4 * dpr);
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      const dz = f.z - camZ;
      if (dz < 0.35) continue;
      const fog = Math.exp(-dz * 0.030);
      const act = Math.exp(-Math.pow((dz - 5) / 5.5, 2));
      let a = fog * (0.30 + act * (0.9 + burst * 0.8));
      if (a < 0.008) continue;
      const rot = twist * (Math.sin(f.seed * 12.9) * 1.1 + f.z * 0.03);
      drawFrame(f, a, rot, act);
    }

    // Glyphen-Regen (Code-Kapitel)
    if (glyphAmt > 0.02) {
      const baseSize = Math.max(10, 12 * dpr);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < glyphs.length; i++) {
        const gl = glyphs[i];
        const dz = gl.z - camZ;
        if (dz < 0.6 || dz > 60) continue;
        const y = 7.5 - ((gl.y0 + time * gl.spd) % 14);
        const s = project(gl.x, y, gl.z);
        if (!s) continue;
        const fog = Math.exp(-dz * 0.04);
        const flick = 0.55 + 0.45 * Math.sin(time * (2 + gl.ph * 2) + gl.ph * 37);
        const a = glyphAmt * fog * flick;
        if (a < 0.02) continue;
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.font = (baseSize * gl.sz * s[2] * 0.5).toFixed(1) + 'px "JetBrains Mono", monospace';
        ctx.fillStyle = gl.hi ? 'rgba(' + GOLD_HI + ',1)' : 'rgba(' + GOLD + ',1)';
        ctx.fillText(gl.ch, s[0], s[1]);
      }
      ctx.globalAlpha = 1;
    }

    // Goldstaub (mit Vortex-Swirl im Design-Kapitel)
    const swirl = twist;
    for (let i = 0; i < particles.length; i++) {
      const pt = particles[i];
      let px = pt.x + Math.sin(time * 0.13 + pt.ph * 17) * 0.7;
      let py = pt.y + Math.sin(time * 0.10 + pt.ph * 23) * 0.5;
      if (swirl > 0.02) {
        const ang = swirl * (time * 0.4 + pt.ph * 1.3);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const ox = px, oy = py - 0.4;
        px = ox * ca - oy * sa;
        py = ox * sa + oy * ca + 0.4;
      }
      const rel = (pt.z + time * 1.4 - camZ) % CFG.particleSpan;
      const zz = camZ + (rel < 0 ? rel + CFG.particleSpan : rel);
      const dz = zz - camZ;
      const s = project(px, py, zz);
      if (!s) continue;
      const fog = Math.exp(-dz * 0.05);
      const tw = 0.5 + 0.5 * Math.sin(time * (1 + pt.ph) + pt.ph * 43);
      const a = fog * tw * (0.5 + burst * 0.5);
      if (a < 0.02) continue;
      const rad = Math.max(0.4, pt.r * s[2] * 0.11);
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = pt.hi ? 'rgba(' + GOLD_HI + ',1)' : 'rgba(' + GOLD + ',1)';
      ctx.beginPath();
      ctx.arc(s[0], s[1], rad, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Schockwellenringe (Klick/Tap)
    for (let i = rings.length - 1; i >= 0; i--) {
      const rg = rings[i];
      const age = (now - rg.start) / 1000;
      if (age > 1.5 || rg.z < camZ + 0.5) { rings.splice(i, 1); continue; }
      const k = age / 1.5;
      const s = project(rg.x, rg.y, rg.z);
      if (!s) continue;
      const rad = (6 + k * 90) * s[2] * 0.06;
      ctx.globalAlpha = Math.pow(1 - k, 2) * 0.9;
      ctx.strokeStyle = 'rgba(' + GOLD_HI + ',1)';
      ctx.lineWidth = Math.max(1, 2 * dpr);
      ctx.beginPath();
      ctx.arc(s[0], s[1], Math.max(rad, 1), 0, 6.2832);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    /* — Komposition aufs sichtbare Canvas — */
    // 1) frische Szene additiv über die Trails
    vctx.globalCompositeOperation = 'lighter';
    vctx.globalAlpha = 1;
    vctx.drawImage(scene, 0, 0, W, H);

    // 2) Bloom NUR aus der frischen Szene (kein Rückkopplungs-Weißbrand)
    if (!lowFX) {
      bctx.clearRect(0, 0, bw, bh);
      bctx.drawImage(scene, 0, 0, bw, bh);
      b2ctx.clearRect(0, 0, bloom2.width, bloom2.height);
      b2ctx.drawImage(bloom, 0, 0, bloom2.width, bloom2.height);
      vctx.globalCompositeOperation = 'lighter';
      vctx.globalAlpha = 0.34 + burst * 0.16;
      vctx.drawImage(bloom, 0, 0, W, H);
      vctx.globalAlpha = 0.22 + burst * 0.18;
      vctx.drawImage(bloom2, 0, 0, W, H);
      vctx.globalAlpha = 1;
    }

    // 3) Vignette
    vctx.globalCompositeOperation = 'source-over';
    const vg = vctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.30,
      W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,' + (0.55 - calm * 0.2).toFixed(3) + ')');
    vctx.fillStyle = vg;
    vctx.fillRect(0, 0, W, H);

    // Adaptive Qualität (Warm-up nicht werten)
    if (fxLock || time < 1.5) { perfAcc = 0; perfN = 0; }
    else {
      perfAcc += Math.min(dtW, 0.25); perfN++;
      if (perfN >= 30) {
        const avg = perfAcc / perfN; perfAcc = 0; perfN = 0;
        if (time > perfCooldown) {
          if (avg > 0.030 && !lowFX) { lowFX = true; perfCooldown = time + 3; }
          else if (avg > 0.030 && dpr > 1.0) { dpr = Math.max(1.0, dpr - 0.25); resize(); perfCooldown = time + 3; }
          else if (avg < 0.016 && lowFX) { lowFX = false; perfCooldown = time + 4; }
          else if (avg < 0.014 && dpr < CFG.dprMax) { dpr = Math.min(CFG.dprMax, dpr + 0.25); resize(); perfCooldown = time + 4; }
        }
      }
    }
  }

  // Rahmen (außen + optional innerer Rahmen + Achsenkreuz), rotiert um z-Achse
  function drawFrame(f, a, rot, act) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const hw = CFG.halfW, hh = CFG.halfH;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    const proj = [];
    for (let k = 0; k < 4; k++) {
      const lx = corners[k][0] * c - corners[k][1] * s;
      const ly = corners[k][0] * s + corners[k][1] * c;
      const pr = project(lx, ly, f.z);
      if (!pr) return;
      proj.push(pr);
    }
    const col = act > 0.4 ? GOLD_HI : GOLD;
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.strokeStyle = 'rgba(' + col + ',1)';
    ctx.beginPath();
    ctx.moveTo(proj[0][0], proj[0][1]);
    for (let k = 1; k < 4; k++) ctx.lineTo(proj[k][0], proj[k][1]);
    ctx.closePath();
    ctx.stroke();

    if (f.inner) {
      const iw = hw * 0.5, ih = hh * 0.5;
      const ic = [[-iw, -ih], [iw, -ih], [iw, ih], [-iw, ih]];
      ctx.globalAlpha = clamp(a * 0.8, 0, 1);
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const lx = ic[k][0] * c - ic[k][1] * s;
        const ly = ic[k][0] * s + ic[k][1] * c;
        const pr = project(lx, ly, f.z);
        if (!pr) { ctx.globalAlpha = 1; return; }
        if (k === 0) ctx.moveTo(pr[0], pr[1]); else ctx.lineTo(pr[0], pr[1]);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawWorldLine(x0, y0, z0, x1, y1, z1, col, a) {
    const s0 = project(x0, y0, z0);
    const s1 = project(x1, y1, z1);
    if (!s0 || !s1) return;
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.strokeStyle = 'rgba(' + col + ',1)';
    ctx.beginPath();
    ctx.moveTo(s0[0], s0[1]);
    ctx.lineTo(s1[0], s1[1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function setRunning(on) {
    if (destroyed) return;
    if (on && !running) { running = true; lastT = 0; raf = requestAnimationFrame(draw); }
    else if (!on && running) { running = false; cancelAnimationFrame(raf); }
  }

  /* ── Events ─────────────────────────────────────────────────────────── */
  function onPointerMove(e) {
    mouseX = clamp(e.clientX / cssW * 2 - 1, -1, 1);
    mouseY = clamp(-(e.clientY / cssH * 2 - 1), -1, 1) * 0.8;
  }
  function onPointerDown(e) {
    if (!running || pSm > 0.97) return;
    if (e.target.closest('a,button')) return;
    if (rings.length >= 5) rings.shift();
    const depth = 12;
    const xn = (e.clientX / cssW) * 2 - 1;
    const yn = 1 - (e.clientY / cssH) * 2;
    // Bildschirm→Welt bei fester Tiefe: invertiere project()-Skala
    const scale = foc / depth;
    rings.push({
      x: camX + (xn * (W * 0.5)) / scale,
      y: camY + (yn * (H * 0.5)) / scale + 0.15,
      z: camZ + depth,
      start: performance.now(),
    });
  }

  function destroy() { destroyed = true; cancelAnimationFrame(raf); bail(); }

  /* ── Init ───────────────────────────────────────────────────────────── */
  try {
    measure();
    // Ersten Frame sofort zeichnen, damit nichts „leer" aufblitzt
    updateProgress(); pSm = p;
  } catch (err) {
    console.error('[NobleFrame Cinematic]', err);
    bail();
    return;
  }

  try {
    chapterEls.forEach((el) => {
      const h = el.querySelector('.cine-h');
      if (h) splitWords(h, false);
      const wm = el.querySelector('.cine-wordmark');
      if (wm) splitWords(wm, true);
    });
  } catch (_) { /* Reveal optional */ }

  root.classList.add('cine-live');
  measure();
  updateProgress(); pSm = p; updateDom(pSm);

  const ro = new ResizeObserver(() => measure());
  ro.observe(stage);
  addEventListener('resize', measure, { passive: true });
  addEventListener('orientationchange', () => setTimeout(measure, 250), { passive: true });

  const io = new IntersectionObserver((entries) => {
    inView = entries[0].isIntersecting;
    setRunning(inView && !document.hidden);
  }, { rootMargin: '120px 0px 120px 0px' });
  io.observe(wrap);

  document.addEventListener('visibilitychange', () => setRunning(inView && !document.hidden));

  if (!isMobile) stage.addEventListener('pointermove', onPointerMove, { passive: true });
  stage.addEventListener('pointerdown', onPointerDown, { passive: true });

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      const prev = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      scrollTo(0, wrapTop + travel + 2);
      root.style.scrollBehavior = prev;
      updateProgress(); pSm = p; updateDom(pSm);
      chapters[chapters.length - 1].el.focus({ preventScroll: true });
    });
  }

  const onReduceChange = () => { if (reducedMq.matches) destroy(); };
  if (reducedMq.addEventListener) reducedMq.addEventListener('change', onReduceChange);

  setRunning(true);
})();
