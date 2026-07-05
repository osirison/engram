/* memory-haze.js
 * A depth-of-field field of memory fragments you walk through.
 * Periphery is blurred & dim; clarity arrives two ways:
 *   - the cursor acts as a lantern, wiping fog locally
 *   - scrolling walks the focal plane forward through depth
 * Canvas draws faint motes + connective lines; DOM holds legible fragment text.
 */

  const FRAGMENTS = [
    "she prefers concise answers", "the API key rotates every 90 days",
    "the launch moved to Friday", "their dog is named Biscuit",
    "avoid em-dashes in commits", "staging is read-only on weekends",
    "timezone is JST, UTC+9", "invoice totals are in EUR",
    "he takes his coffee black", "the logo keeps 24px clearspace",
    "never deploy on Fridays", "it's spelled Sarah, not Sara",
    "she prefers Postgres over Mongo", "standup moved to 9:45",
    "the client hates jargon", "rate limit is 1000 per minute",
    "ship behind a feature flag", "prod region is eu-west-1",
    "his title is Principal, not Senior", "the contract renews in March",
    "tabs, not spaces", "she's vegetarian", "use British spelling",
    "the demo is 3pm Thursday", "her flight lands at 6am",
    "the retro is async now", "password vault is 1Password",
    "they sign off as 'best, M'", "the API is versioned in the header",
    "keep replies under 200 words", "the db backup runs at 02:00",
  ];

  const TONES = {
    neutral: [236, 234, 228],
    amber: [240, 178, 116],
    cyan: [121, 196, 224],
  };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(t) { return t * t * (3 - 2 * t); }

  // ---- sacred-geometry shape registry --------------------------------------
  // Each draw() is centered at the origin; the caller translates / rotates /
  // scales and sets globalAlpha for crossfades. Stroke alphas are kept faint.
  const WARM = "236,234,228", AMBER = "240,178,116", CYAN = "121,196,224";
  const TAU = Math.PI * 2;

  function col(g, rgb, a) { g.strokeStyle = `rgba(${rgb},${a})`; }
  function ring(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); }
  function poly(g, n, r, rot) {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU, px = Math.cos(a) * r, py = Math.sin(a) * r;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath(); g.stroke();
  }
  function starPoly(g, n, r, rot, step) {
    g.beginPath();
    for (let i = 0; i <= n; i++) {
      const k = (i * step) % n, a = rot + (k / n) * TAU;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.stroke();
  }

  const GEO_SHAPES = [
    { name: "flower", draw(g, R) {
      const r = R / 4, N = 3, span = r * (N + 0.5);
      col(g, WARM, 0.07);
      for (let row = -N; row <= N; row++)
        for (let cl = -N; cl <= N; cl++) {
          const x = r * (cl + row * 0.5), y = r * row * 0.8660254;
          if (Math.hypot(x, y) > span) continue;
          ring(g, x, y, r);
        }
      col(g, AMBER, 0.05); ring(g, 0, 0, r * (N + 1));
      col(g, CYAN, 0.04); ring(g, 0, 0, r * (N + 1.7));
    } },
    { name: "metatron", draw(g, R) {
      const R1 = R * 0.42, R2 = R * 0.84, cr = R1 * 0.5;
      const cs = [[0, 0]];
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU - Math.PI / 2; cs.push([Math.cos(a) * R1, Math.sin(a) * R1]); }
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU - Math.PI / 2; cs.push([Math.cos(a) * R2, Math.sin(a) * R2]); }
      col(g, WARM, 0.04);
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++) {
          g.beginPath(); g.moveTo(cs[i][0], cs[i][1]); g.lineTo(cs[j][0], cs[j][1]); g.stroke();
        }
      col(g, AMBER, 0.06);
      for (const c of cs) ring(g, c[0], c[1], cr);
    } },
    { name: "sriYantra", draw(g, R) {
      col(g, AMBER, 0.06);
      [0.86, 0.6, 0.36].forEach((s) => poly(g, 3, R * s, -Math.PI / 2)); // upward
      col(g, CYAN, 0.06);
      [0.78, 0.52, 0.3].forEach((s) => poly(g, 3, R * s, Math.PI / 2));  // downward
      col(g, WARM, 0.07); ring(g, 0, 0, R * 0.92); ring(g, 0, 0, R * 0.98);
      poly(g, 4, R * 1.02, Math.PI / 4); // bhupura frame
      g.fillStyle = `rgba(${WARM},0.5)`; g.beginPath(); g.arc(0, 0, R * 0.02, 0, TAU); g.fill(); // bindu
    } },
    { name: "hexagram", draw(g, R) {
      col(g, AMBER, 0.07); poly(g, 3, R * 0.82, -Math.PI / 2);
      col(g, CYAN, 0.07); poly(g, 3, R * 0.82, Math.PI / 2);
      col(g, WARM, 0.06); poly(g, 6, R * 0.47, 0); ring(g, 0, 0, R * 0.9);
    } },
    { name: "pentagram", draw(g, R) {
      col(g, AMBER, 0.07); starPoly(g, 5, R * 0.82, -Math.PI / 2, 2);
      col(g, WARM, 0.06); poly(g, 5, R * 0.82, -Math.PI / 2); ring(g, 0, 0, R * 0.9);
    } },
    { name: "torus", draw(g, R, t) {
      const rings = 11, n = 6;
      for (let k = 0; k < rings; k++) {
        const rr = R * (0.16 + 0.82 * k / (rings - 1));
        const a = (k % 2 ? 0.07 : 0.05);
        col(g, k % 3 === 0 ? CYAN : WARM, a);
        poly(g, n, rr, t * 0.12 + k * 0.2);
      }
    } },
  ];

  class MemoryHaze {
    constructor(root, opts) {
      opts = opts || {};
      this.root = root;
      this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);

      // runtime-tweakable parameters (see set())
      this.tweak = {
        resolveOnScroll: false, // OFF = field stays hazy everywhere; only the lantern reveals
        blur: 11,               // base max blur of unlit memories
        lanternRadius: 300,     // px reach of the lantern
        lanternStrength: 1.0,   // how sharply the lantern resolves what it touches
        floatSpeed: 1.0,        // drift speed of unlit memories
        geoOpacity: 1.0,        // sacred-geometry backdrop visibility multiplier
        geoShape: "cycle",      // which shape to show (or auto-cycle through all)
        idleDrift: true,        // lantern auto-drifts across the geometry when idle
      };

      // sacred-geometry backdrop (Flower of Life) — blurred & slowly turning, drawn lowest
      this.geo = document.createElement("canvas");
      this.geo.className = "haze-geo";
      this.gctx = this.geo.getContext("2d");
      root.appendChild(this.geo);

      // canvas (motes + lines)
      this.canvas = document.createElement("canvas");
      this.canvas.className = "haze-canvas";
      this.ctx = this.canvas.getContext("2d");
      root.appendChild(this.canvas);

      // lantern light following the cursor
      this.light = document.createElement("div");
      this.light.className = "haze-light";
      root.appendChild(this.light);

      // fragment layer
      this.layer = document.createElement("div");
      this.layer.className = "haze-layer";
      root.appendChild(this.layer);

      this.frags = [];
      this.motes = [];
      this.fragCount = opts.fragments || 26;
      this.moteCount = opts.motes || 90;

      // foreground text whose footprint must stay clear of readable memories
      this.exclSel = opts.exclude || null;
      this._exclNodes = null;
      this._exclTick = 0;
      this.excl = null;

      this.focal = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.42, tx: 0, ty: 0 };
      this.focal.tx = this.focal.x; this.focal.ty = this.focal.y;
      this.progress = 0;        // scroll 0..1
      this.F = 0.16;            // focal depth (lerps toward target)
      this.Ftarget = 0.16;
      this.t = 0;
      this.running = false;
      this.lastPointerT = -999;   // when the user last moved the pointer (for idle drift)

      this._resize = this._resize.bind(this);
      this._frame = this._frame.bind(this);
      window.addEventListener("resize", this._resize);
      window.addEventListener("pointermove", (e) => {
        this.focal.tx = e.clientX; this.focal.ty = e.clientY; this.focal.active = true;
        this.lastPointerT = this.t;
      }, { passive: true });

      this._resize();
      this._seed();
    }

    _resize() {
      this.w = window.innerWidth; this.h = window.innerHeight;
      for (const c of [this.canvas, this.geo]) {
        c.width = Math.floor(this.w * this.dpr);
        c.height = Math.floor(this.h * this.dpr);
        c.style.width = this.w + "px";
        c.style.height = this.h + "px";
      }
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.gctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    // Sacred geometry backdrop: a chosen shape, or a slow auto-cycle that
    // crossfades from one form into the next. Slow rotation + faint breathing.
    _drawGeo(prog) {
      const g = this.gctx;
      g.clearRect(0, 0, this.w, this.h);
      const cx = this.w / 2, cy = this.h * 0.46;
      const Rmax = Math.min(this.w, this.h) * 0.4;
      const breath = 1 + Math.sin(this.t * 0.12) * 0.03;
      const ang = this.t * 0.012;

      const sel = this.tweak.geoShape || "cycle";
      let draws;
      if (sel === "cycle") {
        const period = 16, fade = 3.5;
        const f = this.t / period;
        const i = Math.floor(f) % GEO_SHAPES.length;
        const j = (i + 1) % GEO_SHAPES.length;
        const into = (f - Math.floor(f)) * period;
        const mix = into > period - fade ? smooth((into - (period - fade)) / fade) : 0;
        draws = [{ s: GEO_SHAPES[i], a: 1 - mix }];
        if (mix > 0) draws.push({ s: GEO_SHAPES[j], a: mix });
      } else {
        draws = [{ s: GEO_SHAPES.find((x) => x.name === sel) || GEO_SHAPES[0], a: 1 }];
      }

      g.save();
      g.translate(cx, cy);
      g.rotate(ang);
      g.scale(breath, breath);
      g.lineWidth = 1;
      for (const d of draws) { g.globalAlpha = d.a; d.s.draw(g, Rmax, this.t); }
      g.globalAlpha = 1;
      g.restore();
      this.geo.style.opacity = ((0.42 + prog * 0.34) * this.tweak.geoOpacity).toFixed(3);
    }

    _seed() {
      // motes
      this.motes = [];
      for (let i = 0; i < this.moteCount; i++) {
        this.motes.push({
          bx: Math.random(), by: Math.random(), z: Math.random(),
          ph: Math.random() * Math.PI * 2, sp: 0.3 + Math.random() * 0.8,
          tone: Math.random() < 0.12 ? "amber" : Math.random() < 0.16 ? "cyan" : "neutral",
        });
      }
      // fragments
      const pool = FRAGMENTS.slice().sort(() => Math.random() - 0.5);
      this.frags = [];
      for (let i = 0; i < this.fragCount; i++) {
        const el = document.createElement("div");
        el.className = "haze-frag";
        const dot = document.createElement("span"); dot.className = "haze-dot";
        const txt = document.createElement("span"); txt.className = "haze-txt";
        txt.textContent = pool[i % pool.length];
        el.appendChild(dot); el.appendChild(txt);
        this.layer.appendChild(el);
        const tone = Math.random() < 0.16 ? "amber" : Math.random() < 0.24 ? "cyan" : "neutral";
        if (tone !== "neutral") dot.style.background = `rgb(${TONES[tone].join(",")})`;
        this.frags.push({
          el, dot,
          bx: Math.random() < 0.6 ? (0.46 + Math.random() * 0.5) : (0.06 + Math.random() * 0.9),
          by: 0.1 + Math.random() * 0.82,
          z: Math.random(),
          ph: Math.random() * Math.PI * 2, sp: 0.25 + Math.random() * 0.7,
          ax: 0.2 + Math.random() * 0.5, ay: 0.2 + Math.random() * 0.5,
          tone, x: 0, y: 0, clarity: 0,
          _b: -1, _o: -1, fresh: 0,
        });
      }
    }

    setProgress(p) { this.progress = clamp(p, 0, 1); this.Ftarget = lerp(0.14, 1.0, this.progress); }

    // merge runtime tweak values
    set(params) { Object.assign(this.tweak, params || {}); }

    // how much a point sits over foreground text (0 = clear, 1 = fully covered).
    // feathered so memories fade out as they drift toward the words, never popping.
    _hideAt(x, y) {
      const ex = this.excl;
      if (!ex || !ex.length) return 0;
      const padX = 74, padY = 18, feather = 48;
      let hide = 0;
      for (let i = 0; i < ex.length; i++) {
        const r = ex[i];
        const left = r.left - padX, right = r.right + padX;
        const top = r.top - padY, bottom = r.bottom + padY;
        if (x < left - feather || x > right + feather || y < top - feather || y > bottom + feather) continue;
        const dx = Math.max(left - x, 0, x - right);
        const dy = Math.max(top - y, 0, y - bottom);
        const d = Math.hypot(dx, dy);
        const f = d <= 0 ? 1 : clamp(1 - d / feather, 0, 1);
        if (f > hide) { hide = f; if (hide >= 1) break; }
      }
      return hide;
    }

    // refresh the rects of foreground text near the viewport (cached, cheap to re-read)
    _updateExclusions() {
      if (!this.exclSel) return;
      if (!this._exclNodes || (this._exclTick++ % 30 === 0)) {
        this._exclNodes = Array.prototype.slice.call(document.querySelectorAll(this.exclSel));
      }
      const arr = [];
      for (let i = 0; i < this._exclNodes.length; i++) {
        const r = this._exclNodes[i].getBoundingClientRect();
        if (r.width > 1 && r.height > 1 && r.bottom > -160 && r.top < this.h + 160) arr.push(r);
      }
      this.excl = arr;
    }

    // spawn a memory the user just typed; it flies in and resolves into focus
    addMemory(text, sx, sy) {
      const el = document.createElement("div");
      el.className = "haze-frag";
      const dot = document.createElement("span"); dot.className = "haze-dot";
      dot.style.background = `rgb(${TONES.amber.join(",")})`;
      const txt = document.createElement("span"); txt.className = "haze-txt";
      txt.textContent = text;
      el.appendChild(dot); el.appendChild(txt);
      this.layer.appendChild(el);
      const f = {
        el, dot,
        bx: clamp((sx || this.w * 0.4) / this.w, 0.1, 0.85),
        by: clamp((sy || this.h * 0.5) / this.h, 0.1, 0.85),
        z: clamp(this.F + (Math.random() - 0.5) * 0.05, 0, 1),
        ph: Math.random() * Math.PI * 2, sp: 0.3, ax: 0.3, ay: 0.3,
        tone: "amber", x: sx || 0, y: sy || 0, clarity: 1,
        _b: -1, _o: -1, fresh: 1,
      };
      this.frags.push(f);
      if (this.frags.length > this.fragCount + 12) {
        const dead = this.frags.shift();
        dead.el.remove();
      }
      return f;
    }

    // pull the strongest match toward the lantern and sharpen it
    recall() {
      // choose a fragment near the focal point, prefer amber/cyan
      let best = null, bestScore = -Infinity;
      for (const f of this.frags) {
        const d = Math.hypot(f.x - this.focal.x, f.y - this.focal.y);
        const score = -d + (f.tone !== "neutral" ? 120 : 0) + Math.random() * 80;
        if (score > bestScore) { bestScore = score; best = f; }
      }
      if (best) { best.recallPull = 1; best.clarity = 1; }
      return best;
    }

    start() {
      if (this.running) return;
      this.running = true;
      if (this.reduced) { this.F = this.Ftarget; this._render(); return; }
      this._raf = requestAnimationFrame(this._frame);
    }
    stop() { this.running = false; if (this._raf) cancelAnimationFrame(this._raf); }

    // rAF driver — note: rAF passes a timestamp arg, so the loop body must NOT
    // treat its first argument as a "render once" flag (that was the original bug).
    _frame() {
      this._render();
      if (this.running) this._raf = requestAnimationFrame(this._frame);
    }

    _render() {
      this.t += 1 / 60;

      // Idle: before the user moves (or after ~2.4s still), the lantern drifts
      // along a rose curve that sweeps across the sacred-geometry shape, so the
      // field self-reveals on load. Any pointer move reclaims control instantly.
      if (this.tweak.idleDrift && (this.t - this.lastPointerT) > 2.4) {
        const cx = this.w / 2, cy = this.h * 0.46;
        const driftR = Math.min(this.w, this.h) * 0.3;
        const u = this.t * 0.17, k = 3;
        const rr = driftR * (0.42 + 0.58 * Math.abs(Math.cos(k * u)));
        this.focal.tx = cx + Math.cos(u) * rr;
        this.focal.ty = cy + Math.sin(u) * rr * 0.82;
      }

      // ease focal lantern + depth
      this.focal.x += (this.focal.tx - this.focal.x) * 0.08;
      this.focal.y += (this.focal.ty - this.focal.y) * 0.08;
      this.F += (this.Ftarget - this.F) * 0.05;

      // global haze parameters. When resolveOnScroll is OFF the field stays at its
      // hazy baseline the whole way down (incl. the bottom) — only the lantern reveals.
      const prog = this.progress;
      const fr = this.tweak.resolveOnScroll ? prog : 0; // field-resolve amount
      const band = lerp(0.17, 0.72, fr);
      const maxBlur = lerp(this.tweak.blur, 1.6, fr);
      const baseOp = lerp(0.06, 0.32, fr);
      const cursorW = lerp(1.0, 0.34, fr) * this.tweak.lanternStrength;
      const cursorR = this.tweak.lanternRadius * lerp(1.0, 0.7, fr);

      this.light.style.transform = `translate(${this.focal.x}px, ${this.focal.y}px)`;
      this.light.style.opacity = (0.5 * cursorW + 0.12).toFixed(3);

      // slow sacred-geometry backdrop
      this._drawGeo(prog);

      // read foreground text footprints first, so all DOM reads batch before writes
      this._updateExclusions();

      // ---- update fragments ----
      for (const f of this.frags) {
        // the lantern stills a memory: when it's lit, it stops floating
        const litPrev = clamp(1 - Math.hypot(f.x - this.focal.x, f.y - this.focal.y) / cursorR, 0, 1) * cursorW;
        const floatGate = 1 - smooth(clamp(litPrev * 1.45, 0, 1));
        f.ph += 0.011 * f.sp * floatGate * this.tweak.floatSpeed;
        const wanderX = Math.cos(f.ph) * f.ax * 0.045;
        const wanderY = Math.sin(f.ph * 0.78 + f.z * 2.0) * f.ay * 0.05;
        // walking forward: near fragments drift down faster with progress
        const travel = (prog * 0.9) * (0.3 + f.z) ;
        let fx = (f.bx + wanderX) ;
        let fy = (f.by + wanderY + travel) % 1.15;
        if (fy < -0.05) fy += 1.15;

        let X = fx * this.w;
        let Y = fy * this.h;

        if (f.fresh) { f.fresh *= 0.93; if (f.fresh < 0.02) f.fresh = 0; }
        if (f.recallPull) {
          X = lerp(X, this.focal.x, f.recallPull * 0.6);
          Y = lerp(Y, this.focal.y, f.recallPull * 0.6);
          f.recallPull *= 0.95; if (f.recallPull < 0.02) f.recallPull = 0;
        }
        f.x = X; f.y = Y;

        // clarity from depth band + cursor lantern. depth-resolve is gated by fr,
        // so with resolveOnScroll OFF the only thing that sharpens a memory is the lantern.
        const dDepth = Math.abs(f.z - this.F);
        const depthClar = clamp(1 - dDepth / band, 0, 1) * fr;
        const dCur = Math.hypot(X - this.focal.x, Y - this.focal.y);
        const curClar = clamp(1 - dCur / cursorR, 0, 1) * cursorW;
        let clarity = clamp(Math.max(depthClar * 0.85, curClar) + (f.fresh || 0) + (f.recallPull || 0), 0, 1);
        // suppress anything that would land on top of foreground text
        const hide = this._hideAt(X, Y);
        clarity *= (1 - hide);
        f.clarity = clarity;

        const blur = (1 - clarity) * (1 - clarity) * maxBlur;
        let op = clamp(baseOp + Math.pow(clarity, 1.3) * (1 - baseOp), 0, 1);
        op *= (1 - hide);  // kill the baseline opacity floor over words — fully invisible there
        const scale = (0.66 + f.z * 0.46) * (0.96 + clarity * 0.12);

        // Style writes are unconditional: the delta-based perf gate that used
        // to wrap this block had been disabled with `|| true`, so it is
        // removed rather than kept as dead code (behavior unchanged).
        f.el.style.transform = `translate(${X}px, ${Y}px) translate(-50%,-50%) scale(${scale.toFixed(3)})`;
        f.el.style.filter = blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : "none";
        f.el.style.opacity = op.toFixed(3);
        f.el.style.textShadow = clarity > 0.55
          ? `0 0 22px rgba(236,234,228,${(clarity * 0.22).toFixed(2)})` : "none";
        f.el.style.zIndex = String(10 + Math.round(f.z * 30));
        f.dot.style.boxShadow = clarity > 0.5
          ? `0 0 ${(clarity * 10).toFixed(0)}px rgba(${TONES[f.tone].join(",")},${(clarity * 0.6).toFixed(2)})` : "none";
        f._b = blur; f._o = op;
      }

      // ---- draw canvas: motes + lines ----
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);

      // motes
      for (const m of this.motes) {
        m.ph += 0.006 * m.sp;
        const travel = (prog * 0.9) * (0.3 + m.z);
        let mx = (m.bx + Math.cos(m.ph) * 0.01) * this.w;
        let my = (((m.by + Math.sin(m.ph) * 0.01 + travel) % 1.1) ) * this.h;
        const dDepth = Math.abs(m.z - this.F);
        const depthClar = clamp(1 - dDepth / band, 0, 1);
        const dCur = Math.hypot(mx - this.focal.x, my - this.focal.y);
        const curClar = clamp(1 - dCur / cursorR, 0, 1) * cursorW;
        const clar = clamp(Math.max(depthClar, curClar), 0, 1);
        const r = (0.5 + m.z * 1.6) * (0.7 + clar);
        const a = (0.05 + clar * 0.5) * (1 - this._hideAt(mx, my));
        const col = TONES[m.tone];
        m.sx = mx; m.sy = my; m.clar = clar;
        const blurFar = (1 - clar) * 4;
        ctx.shadowBlur = blurFar;
        ctx.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},${a})`;
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a})`;
        ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowBlur = 0;

      // connective lines between fragments that are near & in focus (familiar, connected)
      ctx.lineWidth = 1;
      const F = this.frags;
      for (let i = 0; i < F.length; i++) {
        const a = F[i];
        for (let j = i + 1; j < F.length; j++) {
          const b = F[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d > 230) continue;
          const both = a.clarity * b.clarity;
          if (both < 0.05) continue;
          const o = (1 - d / 230) * both * 0.62 * (1 - this._hideAt((a.x + b.x) / 2, (a.y + b.y) / 2));
          if (o < 0.01) continue;
          let col = TONES.neutral;
          if (a.tone === "cyan" || b.tone === "cyan") col = TONES.cyan;
          else if (a.tone === "amber" && b.tone === "amber") col = TONES.amber;
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${o.toFixed(3)})`;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
  }

export { MemoryHaze };
