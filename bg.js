"use strict";
/* ============================================================
   ZENTRIX — animated backgrounds (canvas, no deps)
   Modes: pcb (dot grid + traces + pulses), tron (lightcycle
   runs with fading trails), static (single rendered frame).
   Honors prefers-reduced-motion, pauses on hidden tab.
   Settings via window.ZENTRIX_BG.apply({ mode, accentRgb }).
   ============================================================ */
(function () {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const GRID_STEP = 30;
  const TRACE_ALPHA = 0.07;               // static traces, barely visible
  const VIA_ALPHA = 0.16;
  const PULSE_SPEED_MIN = 40;             // px/s
  const PULSE_SPEED_MAX = 95;
  const TRAIL_MIN = 28;                   // px
  const TRAIL_MAX = 70;
  const RING_MAX = 26;                    // via-glow radius

  /* tron tuning */
  let TRON_TARGET = 4;                    // desired concurrent cycles
  const CYCLE_SPEED = 150;                // px/s
  const ORANGE = "255, 140, 60";          // second cycle identity
  const CYCLE_TURN_P = 0.28;              // turn probability per crossing
  const CYCLE_TRAIL_MAX = 90;             // trail segments kept per cycle
  const CYCLE_FADE_T = 2.2;               // seconds until a trail segment is gone

  let W = 0, H = 0, dpr = 1;
  let bgImage = null;                     // custom background Image (mode "custom")
  let bgImageUrl = null;                  // data-URL of the custom background
  /* starfield state */
  let stars = [];                         // [{x, y, r, a, tw}]  tw = twinkle phase
  let asteroids = [];                     // [{x, y, ang, speed, size, rot, rotV, trail: []}]
  let ACCENT = "78, 225, 160";            // raw rgb, override via apply()
  let mode = "pcb";
  let staticLayer = null;                 // offscreen canvas: grid + traces + vias
  let traces = [];                        // [{pts, len}]
  let pulses = [];                        // [{ti, dir, d, speed, trail}]
  let rings = [];                         // [{x, y, r, a}]
  /* tron state */
  let cycles = [];                        // [{x, y, dir, trail: [{x1,y1,x2,y2,a0,born}]}]
  let rafId = 0;
  let lastT = 0;
  let running = false;

  const rand = (min, max) => min + Math.random() * (max - min);

  /* orthogonal dirs: R, D, L, U */
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  function snap(v, step) { return Math.round(v / step) * step; }

  /* ------------------------------------------------ pcb mode */
  function makeTrace() {
    let x = rand(30, W - 30);
    let y = rand(30, H - 30);
    const pts = [{ x, y }];
    let dir = Math.floor(Math.random() * 4);
    const segs = 3 + Math.floor(Math.random() * 3);
    for (let s = 0; s < segs; s++) {
      const len = rand(70, 260);
      if (Math.random() < 0.35) {
        /* PCB-style 45° bend: half diagonal, half orthogonal */
        const diag = rand(24, len / 2);
        x += DIRS[dir][0] * diag; y += DIRS[dir][1] * diag;
        pts.push({ x, y });
        dir = (dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
        const rest = len - diag;
        x += DIRS[dir][0] * rest; y += DIRS[dir][1] * rest;
      } else {
        x += DIRS[dir][0] * len; y += DIRS[dir][1] * len;
      }
      pts.push({ x, y });
      dir = (dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
      /* steer back toward canvas when drifting out */
      if (x < 10 || x > W - 10) dir = x < W / 2 ? 0 : 2;
      if (y < 10 || y > H - 10) dir = y < H / 2 ? 1 : 3;
    }
    return pts;
  }

  function pathLen(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) {
      L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return L;
  }

  /* sample points along polyline from d0 to d1 (absolute distance) */
  function slicePath(pts, d0, d1) {
    const out = [];
    if (d1 <= 0 || d0 >= d1) return out;
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      const segStart = acc, segEnd = acc + seg;
      acc = segEnd;
      if (segEnd < d0 || segStart > d1) continue;
      const from = Math.max(d0, segStart), to = Math.min(d1, segEnd);
      for (let d = from; d <= to; d += 6) {
        const t = seg === 0 ? 0 : (d - segStart) / seg;
        out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t });
      }
      const tEnd = seg === 0 ? 0 : (to - segStart) / seg;
      out.push({ x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * tEnd, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * tEnd });
      if (acc >= d1) break;
    }
    return out;
  }

  function pointAt(pts, d) {
    d = Math.max(0, Math.min(d, pathLen(pts)));
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (d <= acc + seg) {
        const t = seg === 0 ? 0 : (d - acc) / seg;
        return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
      }
      acc += seg;
    }
    return pts[pts.length - 1];
  }

  function spawnPulse(initial) {
    if (!traces.length) return;
    const ti = Math.floor(Math.random() * traces.length);
    const t = traces[ti];
    pulses.push({
      ti,
      dir: Math.random() < 0.5 ? 1 : -1,
      d: initial ? rand(0, t.len) : (Math.random() < 0.5 ? 0 : t.len),
      speed: rand(PULSE_SPEED_MIN, PULSE_SPEED_MAX),
      trail: rand(TRAIL_MIN, TRAIL_MAX)
    });
  }

  function buildStatic() {
    staticLayer = document.createElement("canvas");
    if (!staticLayer.getContext || !staticLayer.getContext("2d")) { staticLayer = null; return; }
    staticLayer.width = Math.max(1, Math.round(W * dpr));
    staticLayer.height = Math.max(1, Math.round(H * dpr));
    const s = staticLayer.getContext("2d");
    if (!s) { staticLayer = null; return; }
    s.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* dot grid */
    s.fillStyle = `rgba(154, 164, 178, 0.035)`;
    for (let gx = GRID_STEP / 2; gx < W; gx += GRID_STEP) {
      for (let gy = GRID_STEP / 2; gy < H; gy += GRID_STEP) {
        s.fillRect(gx, gy, 1, 1);
      }
    }

    if (mode === "tron") {
      /* tron: plain black — no grid, no traces, no vias */
      return;
    }

    /* traces */
    traces = [];
    const count = Math.round((W * H) / 34000);
    s.lineWidth = 1;
    for (let i = 0; i < count; i++) {
      const pts = makeTrace();
      traces.push({ pts, len: pathLen(pts) });
      s.strokeStyle = `rgba(${ACCENT}, ${TRACE_ALPHA})`;
      s.beginPath();
      s.moveTo(pts[0].x, pts[0].y);
      for (let p = 1; p < pts.length; p++) s.lineTo(pts[p].x, pts[p].y);
      s.stroke();
      /* vias at both ends */
      for (const end of [pts[0], pts[pts.length - 1]]) {
        s.strokeStyle = `rgba(${ACCENT}, ${VIA_ALPHA})`;
        s.beginPath();
        s.arc(end.x, end.y, 2.4, 0, Math.PI * 2);
        s.stroke();
      }
    }
  }

  /* ------------------------------------------------ tron mode */
  const CYCLE_RESPAWN_DELAY = 1.2;        /* seconds until a new cycle enters */
  const EXPLOSION_PARTICLES = 14;
  const EXPLOSION_LIFE = 0.9;             /* seconds */
  let explosions = [];                    /* [{x, y, color, t}] */

  /* color identity: keep cyan/orange counts balanced — always spawn the
     color that is currently under-represented among *active* (non-spawning)
     cycles, falling back to the global alternate when tied. */
  function pickCycleColor() {
    let cyan = 0, orange = 0;
    for (const c of cycles) {
      if (c.color === ORANGE) orange++; else cyan++;
    }
    if (orange < cyan) return ORANGE;
    if (cyan < orange) return ACCENT;
    /* tied (or empty): give the minority that died last, else alternate by count */
    return cycles.length % 2 === 0 ? ACCENT : ORANGE;
  }

  function spawnCycle(initial) {
    const gx = Math.max(1, Math.floor(W / (GRID_STEP * 2)));
    const gy = Math.max(1, Math.floor(H / (GRID_STEP * 2)));
    const x = snap(rand(GRID_STEP * 2, W - GRID_STEP * 2), GRID_STEP * 2);
    const y = snap(rand(GRID_STEP * 2, H - GRID_STEP * 2), GRID_STEP * 2);
    cycles.push({
      x, y,
      dir: Math.floor(Math.random() * 4),
      /* balanced identity color: cyan/orange like the film */
      color: pickCycleColor(),
      trail: [],
      turnCooldown: 0,
      _spawned: initial ? rand(0, 2) : 0   /* stagger initial spawns */
    });
  }

  /* spawn a new cycle away from all other trails/heads */
  function respawnCycle() {
    const grid = GRID_STEP * 2;
    let best = null, bestDist = -1;
    for (let attempt = 0; attempt < 24; attempt++) {
      const x = snap(rand(grid, W - grid), grid);
      const y = snap(rand(grid, H - grid), grid);
      let minD = Infinity;
      for (const c of cycles) {
        minD = Math.min(minD, Math.hypot(c.x - x, c.y - y));
        for (const seg of c.trail) {
          const mx = (seg.x1 + seg.x2) / 2, my = (seg.y1 + seg.y2) / 2;
          minD = Math.min(minD, Math.hypot(mx - x, my - y));
        }
      }
      if (minD > bestDist) { bestDist = minD; best = { x, y }; }
      if (bestDist > 180) break; /* far enough */
    }
    cycles.push({
      x: best ? best.x : snap(W / 2, grid),
      y: best ? best.y : snap(H / 2, grid),
      dir: Math.floor(Math.random() * 4),
      color: pickCycleColor(),
      trail: [],
      turnCooldown: 0,
      _spawned: CYCLE_RESPAWN_DELAY
    });
  }

  function explodeCycle(idx, hitColor) {
    const c = cycles[idx];
    explosions.push({ x: c.x, y: c.y, color: c.color, t: 0,
      particles: Array.from({ length: EXPLOSION_PARTICLES }, () => ({
        /* random flight direction, mostly along the grid axes like shattering light */
        ang: Math.random() < 0.5
          ? Math.floor(Math.random() * 4) * (Math.PI / 2) + rand(-0.4, 0.4)
          : rand(0, Math.PI * 2),
        speed: rand(40, 140),
        len: rand(3, 9)
      }))
    });
    /* flash ring at the crash site */
    rings.push({ x: c.x, y: c.y, r: 3, a: 0.9, color: c.color });
    cycles.splice(idx, 1);
  }

  /* does point (x,y) hit a trail segment of cycle `owner` (or any cycle except skip)? */
  function hitsTrail(x, y, skipIdx, pad) {
    for (let i = 0; i < cycles.length; i++) {
      if (i === skipIdx) continue;
      const tr = cycles[i].trail;
      for (let s = 0; s < tr.length; s++) {
        const seg = tr[s];
        const x1 = Math.min(seg.x1, seg.x2) - pad, x2 = Math.max(seg.x1, seg.x2) + pad;
        const y1 = Math.min(seg.y1, seg.y2) - pad, y2 = Math.max(seg.y1, seg.y2) + pad;
        if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return { cycle: i, seg: s };
      }
    }
    return null;
  }

  function stepCycle(c, dt) {
    if (c._spawned > 0) { c._spawned -= dt; return; }
    const step = CYCLE_SPEED * dt;
    const nx = c.x + DIRS[c.dir][0] * step;
    const ny = c.y + DIRS[c.dir][1] * step;
    /* crash into another cycle's (or own remaining) trail → explode */
    const hit = hitsTrail(nx, ny, cycles.indexOf(c), 2.5);
    if (hit) {
      explodeCycle(cycles.indexOf(c), null);
      return;
    }
    /* wall ahead → 90° turn along the wall (no bouncing back over own trail).
       Both turn options checked; if one leads into the wall/trail too, take the other;
       if both are blocked → crash like in the film. */
    const atWallX = nx < 0 || nx > W;
    const atWallY = ny < 0 || ny > H;
    if (atWallX || atWallY) {
      const idx = cycles.indexOf(c);
      /* perpendicular directions to current travel */
      const left = (c.dir + 3) % 4, right = (c.dir + 1) % 4;
      const opts = [];
      for (const d of [left, right]) {
        /* reach the wall/grid line by projecting as far as possible, then sample ahead */
        let ok = true;
        for (let dist = step; dist <= 60; dist += 12) {
          const px = c.x + DIRS[d][0] * dist, py = c.y + DIRS[d][1] * dist;
          if (px < 0 || px > W || py < 0 || py > H) { ok = false; break; }
          if (hitsTrail(px, py, idx, 2.5)) { ok = false; break; }
        }
        if (ok) opts.push(d);
      }
      if (opts.length) {
        c.dir = opts[Math.floor(Math.random() * opts.length)];
      } else {
        /* trapped in the corner: explode */
        explodeCycle(idx, null);
      }
      return;
    }
    c.x = nx; c.y = ny;
    /* turn at grid crossings — only 90° left/right, never straight back */
    c.turnCooldown -= step;
    const onCrossing = Math.abs(c.x % (GRID_STEP * 2)) < 1 && Math.abs(c.y % (GRID_STEP * 2)) < 1;
    if (onCrossing && c.turnCooldown <= 0 && Math.random() < CYCLE_TURN_P) {
      const idx = cycles.indexOf(c);
      /* candidate turns: ±90° only. A 180° reversal is impossible by construction. */
      const left = (c.dir + 3) % 4, right = (c.dir + 1) % 4;
      /* prefer a direction that stays free for the next ~60 px */
      const good = [];
      for (const d of [left, right]) {
        let ok = true;
        for (let dist = step; dist <= 60; dist += 12) {
          const px = c.x + DIRS[d][0] * dist, py = c.y + DIRS[d][1] * dist;
          if (px < 0 || px > W || py < 0 || py > H) { ok = false; break; }
          if (hitsTrail(px, py, idx, 2.5)) { ok = false; break; }
        }
        if (ok) good.push(d);
      }
      if (good.length) {
        c.dir = good[Math.floor(Math.random() * good.length)];
        c.turnCooldown = 24; /* min px before next turn */
      }
      /* if neither turn is free, keep driving straight — the crash check above
         will explode the cycle when it reaches the obstacle */
    }
    /* append trail segment */
    const last = c.trail[c.trail.length - 1];
    if (last && last.x2 === c.x && last.y2 === c.y) return;
    c.trail.push({ x1: last ? last.x2 : c.x, y1: last ? last.y2 : c.y, x2: c.x, y2: c.y, born: performance.now() });
    if (c.trail.length > CYCLE_TRAIL_MAX) c.trail.shift();
  }

  function drawLightcycle(dt) {
    /* fade + draw trails (oldest first) */
    const now = performance.now();
    for (const c of cycles) {
      for (let i = c.trail.length - 1; i >= 0; i--) {
        const seg = c.trail[i];
        const age = (now - seg.born) / 1000;
        if (age > CYCLE_FADE_T) { c.trail.splice(i, 1); continue; }
        const a = 0.55 * (1 - age / CYCLE_FADE_T);
        ctx.strokeStyle = `rgba(${c.color}, ${a})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();
        /* bright core */
        ctx.strokeStyle = `rgba(255, 255, 255, ${a * 0.35})`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(seg.x1, seg.y1);
        ctx.lineTo(seg.x2, seg.y2);
        ctx.stroke();
      }
      /* cycle head */
      if (c._spawned <= 0) {
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 9);
        g.addColorStop(0, `rgba(${c.color}, 0.7)`);
        g.addColorStop(1, `rgba(${c.color}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(c.x, c.y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255, 255, 255, 0.95)`;
        ctx.beginPath(); ctx.arc(c.x, c.y, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }

    /* explosions: expanding shattering light fragments */
    for (let i = explosions.length - 1; i >= 0; i--) {
      const ex = explosions[i];
      ex.t += dt;
      if (ex.t >= EXPLOSION_LIFE) { explosions.splice(i, 1); continue; }
      const p = ex.t / EXPLOSION_LIFE;             /* 0..1 progress */
      const dist = 40 * p;                          /* fragment travel */
      const a = 0.9 * (1 - p);
      for (const pt of ex.particles) {
        const x2 = ex.x + Math.cos(pt.ang) * dist;
        const y2 = ex.y + Math.sin(pt.ang) * dist;
        const x1 = x2 - Math.cos(pt.ang) * pt.len * (1 - p * 0.5);
        const y1 = y2 - Math.sin(pt.ang) * pt.len * (1 - p * 0.5);
        ctx.strokeStyle = `rgba(${ex.color}, ${a})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.strokeStyle = `rgba(255, 255, 255, ${a * 0.5})`;
        ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
      /* bright flash core, shrinking */
      const g = ctx.createRadialGradient(ex.x, ex.y, 0, ex.x, ex.y, 16 * (1 - p) + 2);
      g.addColorStop(0, `rgba(255, 255, 255, ${0.8 * (1 - p)})`);
      g.addColorStop(1, `rgba(${ex.color}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(ex.x, ex.y, 16 * (1 - p) + 2, 0, Math.PI * 2); ctx.fill();
    }

    /* keep population constant: replace exploded cycles after a delay */
    if (cycles.length < TRON_TARGET && explosions.length < 3) {
      /* respawn with the under-represented color (keeps cyan/orange balanced) */
      respawnCycle();
    }
  }

  /* ------------------------------------------------ pcb draw */
  function drawPCB(dt) {
    if (staticLayer) ctx.drawImage(staticLayer, 0, 0, W, H);

    for (const p of pulses) {
      const t = traces[p.ti];
      if (!t) continue;
      p.d += p.dir * p.speed * dt;
      if (p.d <= 0 || p.d >= t.len) {
        const endPt = p.d <= 0 ? t.pts[0] : t.pts[t.pts.length - 1];
        rings.push({ x: endPt.x, y: endPt.y, r: 2, a: 0.5 });
        p.ti = Math.floor(Math.random() * traces.length);
        p.dir = Math.random() < 0.5 ? 1 : -1;
        p.d = p.dir === 1 ? 0 : traces[p.ti].len;
        p.speed = rand(PULSE_SPEED_MIN, PULSE_SPEED_MAX);
        p.trail = rand(TRAIL_MIN, TRAIL_MAX);
      }
      const t2 = traces[p.ti];
      const head = pointAt(t2.pts, p.d);
      const tailD = p.dir === 1 ? Math.max(0, p.d - p.trail) : Math.min(t2.len, p.d + p.trail);
      const trail = slicePath(t2.pts, Math.min(p.d, tailD), Math.max(p.d, tailD));
      if (trail.length > 1) {
        for (const [width, alpha] of [[3, 0.10], [1.5, 0.28]]) {
          ctx.strokeStyle = `rgba(${ACCENT}, ${alpha})`;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(trail[0].x, trail[0].y);
          for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
          ctx.stroke();
        }
      }
      const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 7);
      g.addColorStop(0, `rgba(${ACCENT}, 0.55)`);
      g.addColorStop(1, `rgba(${ACCENT}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(${ACCENT}, 0.9)`;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.r += 22 * dt;
      r.a -= 1.1 * dt;
      if (r.a <= 0) { rings.splice(i, 1); continue; }
      ctx.strokeStyle = `rgba(${r.color || ACCENT}, ${r.a})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.min(r.r, RING_MAX), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /* ------------------------------------------------ starfield mode */
  function spawnAsteroid(initial) {
    /* enter from a random edge on a shallow flight path across the screen */
    const edge = Math.floor(Math.random() * 4);
    const margin = 40;
    let x, y, ang;
    if (edge === 0)      { x = rand(0, W); y = -margin; ang = Math.PI / 2 + rand(-0.5, 0.5); }
    else if (edge === 1) { x = W + margin; y = rand(0, H); ang = Math.PI + rand(-0.5, 0.5); }
    else if (edge === 2) { x = rand(0, W); y = H + margin; ang = -Math.PI / 2 + rand(-0.5, 0.5); }
    else                 { x = -margin; y = rand(0, H); ang = rand(-0.5, 0.5); }
    asteroids.push({
      x, y, ang,
      speed: rand(14, 42),                 /* px/s — slow drift */
      size: rand(1.6, 3.4),
      rot: rand(0, Math.PI * 2),
      rotV: rand(-0.35, 0.35),
      /* irregular rock shape: 8 vertices with jittered radius */
      shape: Array.from({ length: 8 }, () => rand(0.7, 1.25)),
      trail: [],
      trailMax: 26
    });
    if (initial) asteroids[asteroids.length - 1].x = rand(0, W);  /* pre-populate */
  }

  function stepStarfield(dt) {
    /* twinkle stars */
    for (const st of stars) st.tw += dt * rand(0.8, 1.8);
    /* asteroids drift + leave faint flight trails */
    for (const a of asteroids) {
      const nx = a.x + Math.cos(a.ang) * a.speed * dt;
      const ny = a.y + Math.sin(a.ang) * a.speed * dt;
      a.rot += a.rotV * dt;
      /* gentle path curvature (gravity-ish) */
      a.ang += Math.sin(a.x / 320 + a.y / 240) * 0.04 * dt;
      a.trail.push({ x: nx, y: ny, born: performance.now() });
      if (a.trail.length > a.trailMax) a.trail.shift();
      a.x = nx; a.y = ny;
      /* off-screen far enough → respawn from an edge */
      if (a.x < -80 || a.x > W + 80 || a.y < -80 || a.y > H + 80) {
        const idx = asteroids.indexOf(a);
        asteroids.splice(idx, 1);
        spawnAsteroid(false);
      }
    }
  }

  function drawStarfield(dt) {
    /* stars */
    const now = performance.now();
    for (const st of stars) {
      const tw = 0.65 + 0.35 * Math.sin(st.tw);
      ctx.fillStyle = `rgba(235, 240, 255, ${st.a * tw})`;
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    /* asteroid flight trails: faint fading lines */
    for (const a of asteroids) {
      for (let i = 1; i < a.trail.length; i++) {
        const p0 = a.trail[i - 1], p1 = a.trail[i];
        const age = (now - p1.born) / 1000;
        const alpha = Math.max(0, 0.16 * (1 - i / a.trail.length));
        ctx.strokeStyle = `rgba(150, 165, 210, ${alpha})`;
        ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
      /* the asteroid: small irregular rotating polygon with soft glow */
      const g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, a.size * 4);
      g.addColorStop(0, "rgba(190, 200, 235, 0.5)");
      g.addColorStop(1, "rgba(190, 200, 235, 0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(a.x, a.y, a.size * 4, 0, Math.PI * 2); ctx.fill();

      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.beginPath();
      for (let v = 0; v < 8; v++) {
        const ang = (v / 8) * Math.PI * 2;
        const rr = a.size * a.shape[v];
        const px = Math.cos(ang) * rr, py = Math.sin(ang) * rr;
        if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(168, 178, 205, 0.85)";
      ctx.fill();
      ctx.strokeStyle = "rgba(220, 228, 250, 0.5)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ------------------------------------------------ lifecycle */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStatic();
    if (mode === "pcb") {
      const target = Math.max(6, Math.min(14, Math.round((W * H) / 130000)));
      pulses = [];
      for (let i = 0; i < target; i++) spawnPulse(true);
      rings = [];
    } else if (mode === "tron") {
      cycles = [];
      explosions = [];
      TRON_TARGET = Math.max(3, Math.min(5, Math.round((W * H) / 500000)));
      for (let i = 0; i < TRON_TARGET; i++) spawnCycle(true);
    } else if (mode === "starfield") {
      stars = []; asteroids = [];
      const starCount = Math.max(90, Math.min(220, Math.round((W * H) / 9000)));
      for (let i = 0; i < starCount; i++) {
        stars.push({ x: Math.random() * W, y: Math.random() * H,
                     r: rand(0.4, 1.6), a: rand(0.25, 0.9), tw: rand(0, Math.PI * 2) });
      }
      const astCount = Math.max(5, Math.min(11, Math.round((W * H) / 300000)));
      for (let i = 0; i < astCount; i++) spawnAsteroid(true);
    }
    if (reducedMotion || mode === "static" || mode === "custom") drawFrame(0); /* single static frame */
  }

  function drawCustom() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (!bgImage) return;
    /* cover-fit like CSS background-size: cover */
    const iw = bgImage.naturalWidth || bgImage.width;
    const ih = bgImage.naturalHeight || bgImage.height;
    if (!iw || !ih) return;
    const scale = Math.max(W / iw, H / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(bgImage, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  function drawFrame(dt) {
    ctx.clearRect(0, 0, W, H);
    if (mode === "pcb") drawPCB(dt);
    else if (mode === "tron") drawLightcycle(dt);
    else if (mode === "custom") drawCustom();
    else if (mode === "starfield") { ctx.fillStyle = "#05060f"; ctx.fillRect(0, 0, W, H); drawStarfield(dt); }
    else if (staticLayer) ctx.drawImage(staticLayer, 0, 0, W, H);
  }

  function loop(t) {
    if (!running) return;
    const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016);
    lastT = t;
    if (mode === "tron") for (const c of cycles) stepCycle(c, dt);
    else if (mode === "starfield") stepStarfield(dt);
    drawFrame(dt);
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    if (running || reducedMotion || mode === "static" || mode === "custom") return;
    running = true;
    lastT = 0;
    rafId = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop(); else start();
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  /* external control (settings panel) */
  window.ZENTRIX_BG = {
    apply(opts) {
      let needRebuild = false;
      if (opts && typeof opts.accentRgb === "string" && /^\d{1,3}, \d{1,3}, \d{1,3}$/.test(opts.accentRgb) && opts.accentRgb !== ACCENT) {
        ACCENT = opts.accentRgb;
        needRebuild = true;
      }
      if (opts && typeof opts.mode === "string" && ["pcb", "tron", "static", "custom", "starfield"].includes(opts.mode) && opts.mode !== mode) {
        mode = opts.mode;
        needRebuild = true;
      }
      if (opts && "imageUrl" in opts) {
        /* opts.imageUrl: data-URL or null (clear) */
        bgImageUrl = opts.imageUrl || null;
        if (bgImageUrl) {
          const img = new Image();
          img.onload = () => {
            bgImage = img;
            if (mode === "custom") { stop(); drawFrame(0); }
            try { document.dispatchEvent(new CustomEvent("zentrix-bg-loaded")); } catch (e) {}
          };
          img.onerror = () => { bgImage = null; };
          img.src = bgImageUrl;
        } else {
          bgImage = null;
          if (mode === "custom") drawFrame(0);
        }
      }
      if (needRebuild) {
        pulses = []; rings = []; cycles = []; explosions = [];
        resize();
        if (mode === "custom") { stop(); drawFrame(0); }
        else if (mode === "static" || reducedMotion) stop(); else start();
      }
    },
    mode() { return mode; },
    /* custom background Image element (for the header contrast sampler) */
    image() { return mode === "custom" ? bgImage : null; }
  };

  resize();
  if (!reducedMotion) start();
})();
