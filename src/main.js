(() => {
  'use strict';

  /* ------------------------------------------------------------ helpers */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const mq = q => !!(window.matchMedia && window.matchMedia(q).matches);
  const REDUCE = mq('(prefers-reduced-motion: reduce)');
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const debounce = (fn, ms) => { let id; return (...a) => { clearTimeout(id); id = setTimeout(() => fn(...a), ms); }; };
  const hash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mix(h1, h2, k) {
    const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
    const r = Math.round(lerp(a >> 16, b >> 16, k)), g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, k)), bl = Math.round(lerp(a & 255, b & 255, k));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function circ(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
  function dot(ctx, x, y, r, c) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  const pick = (R, arr) => arr[Math.floor(R() * arr.length)];

  /* visibility + one shared frame loop */
  const seen = new WeakMap();
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(es => { for (const e of es) seen.set(e.target, e.isIntersecting); }, { rootMargin: '80px 0px' })
    : null;
  const watch = el => { if (io) io.observe(el); else seen.set(el, true); };
  const onScreen = el => seen.get(el) === true;
  const tasks = [];
  let lastMs = 0;
  function frame(ms) {
    const t = ms / 1000;
    const dt = lastMs ? Math.min(0.05, (ms - lastMs) / 1000) : 0;
    lastMs = ms;
    for (const k of tasks) {
      if (k.off || !onScreen(k.el)) continue;
      try { k.tick(t, dt); } catch (err) { k.off = true; console.error(err); }
    }
    requestAnimationFrame(frame);
  }

  function fit(cv, ctx, cap = 2) {
    const r = cv.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const d = Math.min(window.devicePixelRatio || 1, cap);
    const pw = Math.max(1, Math.round(w * d)), ph = Math.max(1, Math.round(h * d));
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    ctx.setTransform(pw / w, 0, 0, ph / h, 0, 0);
    return { w, h };
  }

  const fontsReady = (document.fonts && document.fonts.load)
    ? Promise.race([
        Promise.all([
          document.fonts.load('700 64px "Instrument Sans"'),
          document.fonts.load('800 32px "Doto"'),
          document.fonts.load('italic 600 20px "Kanit"'),
          document.fonts.load('600 20px "Baloo Bhaijaan 2"', 'حمّانا')
        ]).catch(() => {}),
        new Promise(r => setTimeout(r, 2400))
      ])
    : Promise.resolve();
  const redrawOnFonts = [];

  /* ------------------------------------------------------------ hero: subpixel lettering */
  function hero() {
    const box = $('#heroScreen');
    if (!box) return;
    const cv = $('#heroCanvas'), gl = $('#heroGlow');
    const ctx = cv.getContext('2d'), gx = gl.getContext('2d');
    const WORDS = [
      { t: 'pixelabs', c: [1, 1, 1], hold: 4.6 },
      { t: 'websites', c: [0.3, 0.78, 1], hold: 2.6 },
      { t: 'apps', c: [1, 0.84, 0.22], hold: 2.4 },
      { t: 'brands', c: [1, 0.3, 0.64], hold: 2.6 },
      { t: 'jeetak', c: [1, 0.42, 0.2], hold: 3 }
    ];
    const SUB = ['#ff2a40', '#2bff72', '#2f6bff'];
    const R = rng(42);
    const P = [];
    let tg = [], W = 0, H = 0, cell = 8, cols = 0, rows = 0, ox = 0, oy = 0;
    let wi = 0, next = Infinity, ready = false;
    const ptr = { x: 0, y: 0, on: false };

    function raster(text) {
      const S = 6, cw = cols * S, ch = rows * S;
      const oc = document.createElement('canvas');
      oc.width = cw; oc.height = ch;
      const o = oc.getContext('2d', { willReadFrequently: true });
      const fam = '"Instrument Sans", system-ui, -apple-system, "Segoe UI", sans-serif';
      let fs = ch * 0.9;
      o.font = '700 ' + fs + 'px ' + fam;
      let m = o.measureText(text);
      let asc = m.actualBoundingBoxAscent || fs * 0.74, des = m.actualBoundingBoxDescent || fs * 0.22;
      fs *= Math.min((cw * 0.9) / m.width, (ch * 0.84) / (asc + des));
      o.font = '700 ' + fs + 'px ' + fam;
      m = o.measureText(text);
      asc = m.actualBoundingBoxAscent || fs * 0.74; des = m.actualBoundingBoxDescent || fs * 0.22;
      o.fillStyle = '#fff'; o.textAlign = 'center'; o.textBaseline = 'alphabetic';
      o.fillText(text, cw / 2, (ch - (asc + des)) / 2 + asc);
      const d = o.getImageData(0, 0, cw, ch).data;
      const pts = [], need = S * S * 255 * 0.42;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let s = 0;
          for (let yy = 0; yy < S; yy++) {
            let i = ((r * S + yy) * cw + c * S) * 4 + 3;
            for (let xx = 0; xx < S; xx++, i += 4) s += d[i];
          }
          if (s > need) pts.push([ox + c * cell + cell / 2, oy + r * cell + cell / 2]);
        }
      }
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      return pts;
    }

    function layout() {
      const r = box.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) return false;
      W = r.width; H = r.height;
      cell = clamp(Math.round(W / 64), 5, 12);
      cols = Math.floor(W / cell); rows = Math.floor(H / cell);
      ox = Math.floor((W - cols * cell) / 2); oy = Math.floor((H - rows * cell) / 2);
      box.style.setProperty('--cell', cell + 'px');
      box.style.setProperty('--gx', ox + 'px');
      box.style.setProperty('--gy', oy + 'px');
      fit(cv, ctx);
      gl.width = Math.max(1, Math.round(W / 4)); gl.height = Math.max(1, Math.round(H / 4));
      tg = WORDS.map(w => raster(w.t));
      const need = Math.max(1, ...tg.map(a => a.length));
      while (P.length < need) P.push({ x: R() * W, y: R() * H, vx: 0, vy: 0, hx: 0, hy: 0, a: 0, ta: 0, r: 1, g: 1, b: 1, sp: 0, fl: 0, tc: WORDS[0].c });
      target(wi);
      return true;
    }
    function target(ix) {
      const t = tg[ix], c = WORDS[ix].c;
      if (!t || !t.length) return;
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        const q = t[i % t.length];
        p.hx = q[0]; p.hy = q[1]; p.ta = i < t.length ? 1 : 0; p.tc = c;
      }
    }
    function scatter() {
      for (const p of P) { p.x = R() * W; p.y = R() * H; p.vx = (R() - 0.5) * 320; p.vy = (R() - 0.5) * 320; p.sp = 0.6 + R() * 0.4; p.a = 0; }
    }
    function snap() {
      for (const p of P) { p.x = p.hx; p.y = p.hy; p.vx = p.vy = 0; p.a = p.ta; p.r = p.tc[0]; p.g = p.tc[1]; p.b = p.tc[2]; p.sp = 0; p.fl = 0; }
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      const third = cell / 3, bw = third * 0.72, bh = cell * 0.84, pad = (third - bw) / 2;
      for (let ch = 0; ch < 3; ch++) {
        ctx.fillStyle = SUB[ch];
        const sg = ch - 1;
        for (let i = 0; i < P.length; i++) {
          const p = P[i];
          if (p.a < 0.02) continue;
          const v = (ch === 0 ? p.r : ch === 1 ? p.g : p.b) * p.a * (1 - p.fl * 0.75);
          if (v < 0.02) continue;
          ctx.globalAlpha = v > 1 ? 1 : v;
          ctx.fillRect(p.x - cell / 2 + ch * third + pad + sg * p.sp * cell * 0.95, p.y - bh / 2 + sg * p.sp * cell * 0.25, bw, bh);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      gx.clearRect(0, 0, gl.width, gl.height);
      gx.drawImage(cv, 0, 0, gl.width, gl.height);
    }

    const K = 42, D = 8.5;
    function tick(t, dt) {
      if (!ready) return;
      if (t > next) {
        wi = (wi + 1) % WORDS.length;
        target(wi);
        for (const p of P) { p.vx += (R() - 0.5) * 170; p.vy += (R() - 0.5) * 170; }
        next = t + WORDS[wi].hold;
      }
      const h = Math.min(dt, 1 / 30);
      const rad = clamp(W * 0.085, 56, 130), rad2 = rad * rad;
      const k6 = Math.min(1, h * 6), k3 = Math.min(1, h * 3), dSp = Math.exp(-h * 2.4), dFl = Math.exp(-h * 6);
      for (let i = 0; i < P.length; i++) {
        const p = P[i];
        let ax = (p.hx - p.x) * K - p.vx * D, ay = (p.hy - p.y) * K - p.vy * D;
        if (ptr.on) {
          const dx = p.x - ptr.x, dy = p.y - ptr.y, d2 = dx * dx + dy * dy;
          if (d2 < rad2) {
            const d = Math.sqrt(d2) || 1, f = 1 - d / rad;
            ax += (dx / d) * f * f * 7200; ay += (dy / d) * f * f * 7200;
            if (f > p.sp) p.sp = f;
          }
        }
        p.vx += ax * h; p.vy += ay * h; p.x += p.vx * h; p.y += p.vy * h;
        p.a += (p.ta - p.a) * k6;
        p.r += (p.tc[0] - p.r) * k3; p.g += (p.tc[1] - p.g) * k3; p.b += (p.tc[2] - p.b) * k3;
        p.sp *= dSp; p.fl *= dFl;
      }
      for (let n = 0; n < 2; n++) { const p = P[(R() * P.length) | 0]; if (p && R() < 0.5) p.fl = 1; }
      draw();
    }

    function burst(x, y) {
      const rad = clamp(W * 0.16, 90, 220);
      for (const p of P) {
        const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy) || 1;
        if (d < rad) { const f = 1 - d / rad; p.vx += (dx / d) * f * 1150; p.vy += (dy / d) * f * 1150; if (f > p.sp) p.sp = f; }
      }
    }
    const pos = e => { const r = box.getBoundingClientRect(); ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top; };
    if (!REDUCE) {
      box.addEventListener('pointermove', e => { pos(e); ptr.on = true; });
      box.addEventListener('pointerleave', () => { ptr.on = false; });
      box.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') ptr.on = false; });
      box.addEventListener('pointercancel', () => { ptr.on = false; });
      box.addEventListener('pointerdown', e => { pos(e); burst(ptr.x, ptr.y); });
    }

    const rebuild = () => {
      if (!layout()) return;
      if (REDUCE) { snap(); draw(); }
    };
    fontsReady.then(() => {
      if (!layout()) return;
      if (REDUCE) { snap(); draw(); }
      else { scatter(); next = performance.now() / 1000 + WORDS[0].hold + 1.2; }
      ready = true;
      if ('ResizeObserver' in window) new ResizeObserver(debounce(rebuild, 160)).observe(box);
      else window.addEventListener('resize', debounce(rebuild, 160));
      if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', debounce(rebuild, 200));
    });
    if (!REDUCE) tasks.push({ el: box, tick });
    watch(box);
  }

  /* ------------------------------------------------------------ header, Jeetak panel, timeline */
  let scrollKick = 0;
  function scrollFx() {
    const head = $('#top'), jk = $('#jeetak'), tl = $('#timeline');
    let lastY = window.scrollY, ticking = false;
    function update() {
      ticking = false;
      const y = window.scrollY, vh = window.innerHeight;
      head.classList.toggle('scrolled', y > 8);
      if (y > lastY + 4 && y > 360) head.classList.add('hide');
      else if (y < lastY - 4 || y < 360) head.classList.remove('hide');
      scrollKick = Math.min(1100, scrollKick + Math.abs(y - lastY) * 2.4);
      lastY = y;
      if (REDUCE) return;
      if (jk) {
        const r = jk.getBoundingClientRect();
        jk.style.setProperty('--p', easeOut(clamp((vh - r.top) / (vh * 0.8), 0, 1)).toFixed(3));
      }
      if (tl) {
        const r = tl.getBoundingClientRect();
        tl.style.setProperty('--tl', clamp((vh * 0.72 - r.top) / Math.max(1, r.height), 0, 1).toFixed(3));
      }
    }
    window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ------------------------------------------------------------ Jeetak: order tracker in the phone */
  function tracker() {
    const list = $('#jkSteps');
    if (!list) return;
    const items = $$('li', list);
    const route = $('#jkRoute'), done = $('#jkRouteDone'), shop = $('#jkShop'), home = $('#jkHome'), rider = $('#jkRider'), label = $('#jkMapLabel');
    const rc = $('#jkGame');
    const V = JSON.parse((rc && rc.dataset.villages) || '[]');
    const byName = n => V.find(v => v[0] === n);
    const pairs = [['Hammana', 'Falougha'], ['Bhamdoun', 'Ras El Maten'], ['Khalwet', 'Qortada'], ['Saoufar', 'Bzebdine'], ['Salima', 'Arsoun'], ['Kfar Selouan', 'Btekhnay']]
      .map(p => p.map(byName)).filter(p => p[0] && p[1]);
    if (!pairs.length) return;
    let len = 1, pi = 0;
    function setRoute(i) {
      const [a, b] = pairs[i % pairs.length];
      const ax = a[2] * 1000, ay = a[3] * 670, bx = b[2] * 1000, by = b[3] * 670;
      const dx = bx - ax, dy = by - ay;
      const cx = (ax + bx) / 2 - dy * 0.28, cy = (ay + by) / 2 + dx * 0.28;
      const d = 'M' + ax.toFixed(1) + ' ' + ay.toFixed(1) + 'Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + bx.toFixed(1) + ' ' + by.toFixed(1);
      route.setAttribute('d', d); done.setAttribute('d', d);
      shop.setAttribute('cx', ax); shop.setAttribute('cy', ay);
      home.setAttribute('cx', bx); home.setAttribute('cy', by);
      len = route.getTotalLength ? route.getTotalLength() : 1;
      done.style.strokeDasharray = len + ' ' + len;
      label.textContent = a[0] + ' to ' + b[0];
    }
    function progress(k) {
      const pt = route.getPointAtLength(len * k);
      rider.setAttribute('transform', 'translate(' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1) + ')');
      done.style.strokeDashoffset = String(len * (1 - k));
    }
    function show(n) {
      items.forEach((li, i) => {
        li.classList.toggle('done', i < n || n === 4);
        li.classList.toggle('now', i === n && n !== 4);
      });
      list.dataset.step = String(n);
    }
    setRoute(0); show(3); progress(0.55);
    if (REDUCE) return;
    const DUR = [1.0, 1.0, 1.1, 3.6, 2.2];
    let s = 3, t0 = -1;
    tasks.push({
      el: list,
      tick(t) {
        if (t0 < 0) t0 = t - DUR[3] * 0.55;
        if (t - t0 > DUR[s]) {
          s = (s + 1) % 5; t0 = t;
          if (s === 0) { pi += 1; setRoute(pi); }
          show(s);
        }
        progress(s < 3 ? 0 : s === 3 ? easeInOut(clamp((t - t0) / DUR[3], 0, 1)) : 1);
      }
    });
    watch(list);
  }

  /* ------------------------------------------------------------ cover scenes */
  const SCENES = {};

  // Transimed: patient monitor
  function ecgV(time) {
    const P = 0.82, p = ((time % P) + P) % P / P;
    const G = (m, s) => Math.exp(-((p - m) * (p - m)) / (2 * s * s));
    return 0.1 * G(0.12, 0.025) - 0.1 * G(0.25, 0.008) + G(0.27, 0.009) - 0.28 * G(0.295, 0.01) + 0.22 * G(0.5, 0.045);
  }
  function plethV(time) {
    const P = 0.82, p = (((time - 0.14) % P) + P) % P / P;
    return Math.exp(-((p - 0.3) * (p - 0.3)) / 0.012) * 0.9 + Math.exp(-((p - 0.56) * (p - 0.56)) / 0.006) * 0.3 - 0.4;
  }
  function trace(ctx, w, t, speed, head, base, amp, fn, color, lw, glow) {
    const gap = Math.max(12, w * 0.03), chunk = 16;
    ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = color;
    ctx.shadowColor = color; ctx.shadowBlur = glow;
    for (let x0 = 0; x0 < w; x0 += chunk) {
      const x1 = Math.min(w, x0 + chunk);
      const ageMid = (((head - (x0 + x1) / 2) % w) + w) % w;
      ctx.globalAlpha = Math.max(0.1, 1 - (ageMid / w) * 0.9);
      ctx.beginPath();
      let pen = false;
      for (let x = x0; x <= x1; x += 2) {
        const age = (((head - x) % w) + w) % w;
        if (age > w - gap) { pen = false; continue; }
        const y = base - fn(t - age / speed) * amp;
        if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }
  SCENES.ecg = {
    draw(s, t) {
      const { ctx, w, h } = s;
      ctx.fillStyle = '#03130f'; ctx.fillRect(0, 0, w, h);
      const g = Math.max(16, Math.round(Math.min(w, h) / 11));
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(80,255,190,.07)';
      ctx.beginPath();
      for (let x = ((w % g) / 2) | 0; x < w; x += g) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
      for (let y = ((h % g) / 2) | 0; y < h; y += g) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
      ctx.stroke();
      const speed = w / 3.2, head = (t * speed) % w;
      trace(ctx, w, t, speed, head, h * 0.44, h * 0.26, ecgV, '#46ffb5', 2.2, 8);
      trace(ctx, w, t, speed, head, h * 0.82, h * 0.08, plethV, '#53c7ff', 1.6, 0);
      const fs = Math.round(clamp(h * 0.13, 18, 52));
      const beat = Math.exp(-((((t - 0.27 * 0.82) % 0.82) + 0.82) % 0.82) * 7);
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'right';
      ctx.fillStyle = '#46ffb5';
      ctx.font = '800 ' + fs + 'px "Doto", "Instrument Sans", monospace';
      ctx.fillText('72', w - fs * 0.5, fs * 1.25);
      ctx.font = '600 ' + Math.round(fs * 0.28) + 'px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText('BPM', w - fs * 0.5, fs * 1.62);
      ctx.fillStyle = '#53c7ff';
      ctx.font = '800 ' + Math.round(fs * 0.62) + 'px "Doto", "Instrument Sans", monospace';
      ctx.fillText('98', w - fs * 0.5, h * 0.72);
      ctx.font = '600 ' + Math.round(fs * 0.24) + 'px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText('SpO2 %', w - fs * 0.5, h * 0.72 + fs * 0.34);
      ctx.textAlign = 'left';
      const hx = w - fs * 2.6, hy = fs * 0.85, hs = fs * 0.2 * (1 + beat * 0.35);
      ctx.fillStyle = 'rgba(70,255,181,' + (0.45 + beat * 0.55) + ')';
      heart(ctx, hx, hy, hs);
    }
  };
  function heart(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.9);
    ctx.bezierCurveTo(x - s * 1.6, y - s * 0.2, x - s * 0.7, y - s * 1.4, x, y - s * 0.5);
    ctx.bezierCurveTo(x + s * 0.7, y - s * 1.4, x + s * 1.6, y - s * 0.2, x, y + s * 0.9);
    ctx.fill();
  }

  // Glitch Burgers: a smashed burger that glitches
  const SESAME = [[-0.5, -0.36, 0.3], [-0.18, -0.48, -0.2], [0.16, -0.46, 0.4], [0.48, -0.34, -0.3], [-0.3, -0.22, 0.1], [0.05, -0.28, -0.5], [0.34, -0.2, 0.2]];
  function cheese(c, x, y, w, hgt, s, seed, col) {
    c.fillStyle = col;
    rrect(c, x, y, w, hgt, hgt / 2); c.fill();
    for (let i = 0; i < 5; i++) {
      const px = x + w * (0.12 + i * 0.19) + (hash(i + seed) - 0.5) * w * 0.05;
      const L = s * (0.06 + hash(i * 7.1 + seed) * 0.12), dw = s * 0.07;
      rrect(c, px - dw / 2, y + hgt * 0.5, dw, L, dw / 2); c.fill();
    }
  }
  function burger(c, x, y, s, sm) {
    c.save(); c.translate(x, y); c.scale(1 + sm * 0.2, 1 - sm * 0.38);
    const W = s;
    c.fillStyle = '#d58c43'; rrect(c, -W * 0.96, s * 0.44, W * 1.92, s * 0.26, s * 0.13); c.fill();
    c.fillStyle = '#3a2015'; rrect(c, -W * 1.05, s * 0.27, W * 2.1, s * 0.17, s * 0.085); c.fill();
    cheese(c, -W * 1.02, s * 0.2, W * 2.04, s * 0.08, s, 3, '#ffbf2e');
    c.fillStyle = '#47271a'; rrect(c, -W * 1.05, s * 0.03, W * 2.1, s * 0.17, s * 0.085); c.fill();
    c.fillStyle = 'rgba(255,190,120,.22)';
    for (let i = 0; i < 9; i++) c.fillRect(-W + i * W * 0.24, s * 0.06, W * 0.08, s * 0.02);
    cheese(c, -W * 1.02, -s * 0.03, W * 2.04, s * 0.08, s, 9, '#ffcf45');
    c.beginPath(); c.moveTo(-W, -s * 0.02); c.bezierCurveTo(-W * 1.02, -s * 0.78, W * 1.02, -s * 0.78, W, -s * 0.02); c.closePath();
    const g = c.createLinearGradient(0, -s * 0.6, 0, 0);
    g.addColorStop(0, '#efb064'); g.addColorStop(1, '#cf8338');
    c.fillStyle = g; c.fill();
    c.fillStyle = 'rgba(255,255,255,.2)'; c.beginPath(); c.ellipse(-W * 0.38, -s * 0.42, W * 0.3, s * 0.07, -0.35, 0, TAU); c.fill();
    c.fillStyle = '#fff1d2';
    for (const [px, py, a] of SESAME) { c.beginPath(); c.ellipse(px * W, py * s, s * 0.036, s * 0.019, a, 0, TAU); c.fill(); }
    c.restore();
  }
  function tint(dst, src, color) {
    const x = dst.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, dst.width, dst.height);
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, dst.width, dst.height);
    x.globalCompositeOperation = 'source-over';
  }
  SCENES.glitch = {
    init(s) {
      s.d = Math.min(window.devicePixelRatio || 1, 2);
      s.oc = s.oc || document.createElement('canvas'); s.tr = s.tr || document.createElement('canvas'); s.tc = s.tc || document.createElement('canvas');
      for (const c of [s.oc, s.tr, s.tc]) { c.width = Math.max(1, Math.round(s.w * s.d)); c.height = Math.max(1, Math.round(s.h * s.d)); }
      s.R = rng(61);
    },
    draw(s, t) {
      const { ctx, w, h } = s, o = s.oc.getContext('2d');
      o.setTransform(s.d, 0, 0, s.d, 0, 0); o.clearRect(0, 0, w, h);
      const cyc = t % 4.6, sm = cyc > 3.7 && cyc < 4.3 ? Math.sin(((cyc - 3.7) / 0.6) * Math.PI) : 0;
      burger(o, w / 2, h * 0.56 + Math.sin(t * 2.2) * h * 0.008, Math.min(w * 0.26, h * 0.34), sm);
      ctx.fillStyle = '#060606'; ctx.fillRect(0, 0, w, h);
      const gl = ctx.createRadialGradient(w / 2, h * 0.55, 0, w / 2, h * 0.55, Math.max(w, h) * 0.55);
      gl.addColorStop(0, 'rgba(255,30,50,.3)'); gl.addColorStop(1, 'rgba(255,30,50,0)');
      ctx.fillStyle = gl; ctx.fillRect(0, 0, w, h);
      const burst = (t % 2.4) < 0.34 || sm > 0.6;
      if (!burst) ctx.drawImage(s.oc, 0, 0, w, h);
      else {
        tint(s.tr, s.oc, '#ff1f3d'); tint(s.tc, s.oc, '#1fe0ff');
        const k = w * (0.008 + s.R() * 0.018);
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(s.tr, -k, 0, w, h); ctx.drawImage(s.tc, k, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 6; i++) {
          const y = s.R() * h * 0.92, sh = 3 + s.R() * h * 0.07, dx = (s.R() - 0.5) * w * 0.14;
          ctx.drawImage(s.oc, 0, Math.round(y * s.d), s.oc.width, Math.max(1, Math.round(sh * s.d)), dx, y, w, sh);
        }
      }
      ctx.fillStyle = 'rgba(255,40,60,.06)';
      for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    }
  };

  // El King: "craving calling", slide to answer
  SCENES.call = {
    draw(s, t) {
      const { ctx, w, h } = s;
      ctx.fillStyle = '#0c0b08'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,212,0,.07)';
      const gp = Math.max(10, w / 34);
      for (let y = gp / 2, row = 0; y < h; y += gp, row++) for (let x = (row % 2) * gp / 2; x < w; x += gp) { ctx.beginPath(); ctx.arc(x, y, gp * 0.16, 0, TAU); ctx.fill(); }
      const cyc = t % 5, ans = cyc > 4.1;
      const cx = w / 2, cy = h * 0.34, r = Math.min(w, h) * 0.13;
      for (let i = 0; i < 3; i++) {
        const k = (t * 0.9 + i / 3) % 1;
        ctx.strokeStyle = 'rgba(255,212,0,' + (0.5 * (1 - k)).toFixed(3) + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, r * (1.1 + k * 0.9), 0, TAU); ctx.stroke();
      }
      const shake = ans ? 0 : Math.sin(t * 42) * r * 0.035 * (Math.sin(t * 3.2) > 0 ? 1 : 0);
      ctx.save(); ctx.translate(cx + shake, cy);
      dot(ctx, 0, 0, r, '#FFD400');
      ctx.fillStyle = '#0c0b08';
      ctx.beginPath(); ctx.moveTo(-r * 0.55, -r * 0.05); ctx.bezierCurveTo(-r * 0.55, -r * 0.62, r * 0.55, -r * 0.62, r * 0.55, -r * 0.05); ctx.closePath(); ctx.fill();
      rrect(ctx, -r * 0.6, r * 0.03, r * 1.2, r * 0.13, r * 0.065); ctx.fill();
      rrect(ctx, -r * 0.55, r * 0.23, r * 1.1, r * 0.18, r * 0.08); ctx.fill();
      ctx.fillStyle = '#FFD400';
      for (const [px, py] of [[-0.25, -0.3], [0.05, -0.38], [0.3, -0.26]]) { ctx.beginPath(); ctx.ellipse(px * r, py * r, r * 0.05, r * 0.025, 0.3, 0, TAU); ctx.fill(); }
      ctx.restore();
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#fffbe6';
      ctx.font = '700 ' + Math.round(clamp(h * 0.1, 16, 46)) + 'px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText('Craving', cx, cy + r * 2);
      ctx.fillStyle = '#FFD400';
      ctx.font = '600 ' + Math.round(clamp(h * 0.055, 11, 22)) + 'px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText(ans ? 'connected' : 'calling' + '.'.repeat(1 + Math.floor((t * 2.5) % 3)), cx, cy + r * 2.55);
      const pw = Math.min(w * 0.72, 420), ph = Math.max(40, h * 0.12), px = cx - pw / 2, py = h - ph - h * 0.08;
      const prog = ans ? 1 : easeInOut(clamp((cyc - 1.6) / 2.3, 0, 1));
      ctx.fillStyle = 'rgba(255,255,255,.1)'; rrect(ctx, px, py, pw, ph, ph / 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,212,0,.25)'; rrect(ctx, px, py, ph + (pw - ph) * prog, ph, ph / 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,251,230,' + (0.7 * (1 - prog)).toFixed(3) + ')';
      ctx.font = '600 ' + Math.round(ph * 0.3) + 'px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText('slide to answer', cx + ph * 0.3, py + ph * 0.6);
      const kx = px + ph / 2 + (pw - ph) * prog, ky = py + ph / 2;
      dot(ctx, kx, ky, ph * 0.42, '#FFD400');
      ctx.save(); ctx.translate(kx, ky); ctx.rotate(-0.8 + prog * 0.8);
      ctx.strokeStyle = '#0c0b08'; ctx.lineWidth = ph * 0.11; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(0, 0, ph * 0.16, Math.PI * 0.75, Math.PI * 1.75); ctx.stroke();
      ctx.restore();
      if (ans) { ctx.fillStyle = 'rgba(255,212,0,' + (0.22 * (1 - (cyc - 4.1) / 0.9)).toFixed(3) + ')'; ctx.fillRect(0, 0, w, h); }
      ctx.textAlign = 'left';
    }
  };

  // Jad Market: Nawilne, a bag handed to a car window at night
  const PRODUCTS = ['#d6402f', '#f2b134', '#2e7d4f', '#2f5fa8', '#e8e2d4', '#7a3b8f', '#ef7d34', '#1f1f1f'];
  function car(ctx, x, base, cw, rot) {
    const ch = cw * 0.34, wr = ch * 0.3, top = base - wr;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x + cw / 2, base + 2, cw * 0.52, wr * 0.35, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#35505f';
    ctx.beginPath(); ctx.moveTo(x + cw * 0.18, top - ch * 0.5); ctx.lineTo(x + cw * 0.32, top - ch); ctx.lineTo(x + cw * 0.7, top - ch); ctx.lineTo(x + cw * 0.86, top - ch * 0.5); ctx.closePath(); ctx.fill();
    rrect(ctx, x, top - ch * 0.56, cw, ch * 0.56, ch * 0.16); ctx.fill();
    ctx.fillStyle = '#a9c0d1';
    ctx.beginPath(); ctx.moveTo(x + cw * 0.26, top - ch * 0.52); ctx.lineTo(x + cw * 0.35, top - ch * 0.92); ctx.lineTo(x + cw * 0.49, top - ch * 0.92); ctx.lineTo(x + cw * 0.49, top - ch * 0.52); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + cw * 0.53, top - ch * 0.52); ctx.lineTo(x + cw * 0.53, top - ch * 0.92); ctx.lineTo(x + cw * 0.67, top - ch * 0.92); ctx.lineTo(x + cw * 0.78, top - ch * 0.52); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff1b8'; ctx.fillRect(x + cw - 6, top - ch * 0.42, 6, ch * 0.12);
    ctx.fillStyle = '#d6402f'; ctx.fillRect(x, top - ch * 0.42, 4, ch * 0.12);
    for (const wx of [x + cw * 0.22, x + cw * 0.78]) {
      dot(ctx, wx, top, wr, '#121212'); dot(ctx, wx, top, wr * 0.52, '#8d929b');
      ctx.strokeStyle = '#121212'; ctx.lineWidth = Math.max(1, wr * 0.12);
      for (let k = 0; k < 3; k++) { const a = rot + (k * TAU) / 3; ctx.beginPath(); ctx.moveTo(wx, top); ctx.lineTo(wx + Math.cos(a) * wr * 0.5, top + Math.sin(a) * wr * 0.5); ctx.stroke(); }
    }
  }
  function bag(ctx, x, y, s) {
    ctx.fillStyle = '#c99a5d'; ctx.beginPath(); ctx.moveTo(x - s * 0.5, y - s * 0.6); ctx.lineTo(x + s * 0.5, y - s * 0.6); ctx.lineTo(x + s * 0.44, y + s * 0.5); ctx.lineTo(x - s * 0.44, y + s * 0.5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#8a6334'; ctx.lineWidth = Math.max(1, s * 0.08);
    ctx.beginPath(); ctx.arc(x, y - s * 0.6, s * 0.22, Math.PI, 0); ctx.stroke();
    dot(ctx, x, y - s * 0.05, s * 0.16, '#762A30');
  }
  SCENES.nawilne = {
    draw(s, t) {
      const { ctx, w, h } = s;
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#0c0506'); sky.addColorStop(1, '#25100f');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
      const ground = h * 0.76;
      const bx = w * 0.14, bw = w * 0.72, by = h * 0.12, bh = ground - by;
      ctx.fillStyle = '#762A30'; ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = '#4C171C'; ctx.fillRect(bx, by, bw, bh * 0.17);
      ctx.fillStyle = '#FEF8F0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 ' + Math.round(clamp(bh * 0.09, 10, 26)) + 'px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText('JAD MARKET', bx + bw / 2, by + bh * 0.088);
      const wx = bx + bw * 0.06, wy = by + bh * 0.26, ww = bw * 0.52, wh = bh * 0.52;
      const glow = ctx.createLinearGradient(0, wy, 0, wy + wh);
      glow.addColorStop(0, '#fff3dc'); glow.addColorStop(1, '#f2d29c');
      ctx.fillStyle = glow; ctx.fillRect(wx, wy, ww, wh);
      const R = rng(71);
      for (let r = 0; r < 3; r++) {
        const sy = wy + wh * (0.33 + r * 0.31);
        let x = wx + 4;
        while (x < wx + ww - 10) {
          const pw = 5 + R() * 10, ph = wh * (0.08 + R() * 0.14);
          ctx.fillStyle = PRODUCTS[(R() * PRODUCTS.length) | 0]; ctx.fillRect(x, sy - ph, pw, ph);
          x += pw + 2;
        }
        ctx.fillStyle = '#b58e5c'; ctx.fillRect(wx, sy, ww, 3);
      }
      const flick = (Math.sin(t * 17) > 0.95 || (t % 6) > 5.8) ? 0.3 : 1;
      ctx.save(); ctx.shadowColor = '#FF5577'; ctx.shadowBlur = 14 * flick;
      ctx.fillStyle = 'rgba(255,85,119,' + flick + ')';
      ctx.font = '800 ' + Math.round(clamp(wh * 0.16, 9, 24)) + 'px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText('OPEN', wx + ww * 0.78, wy + wh * 0.13);
      ctx.restore();
      const dx = bx + bw * 0.66, dw = bw * 0.26, dy = by + bh * 0.26, dh = bh * 0.74;
      ctx.fillStyle = '#ffe6bd'; ctx.fillRect(dx, dy, dw, dh);
      ctx.fillStyle = '#4C171C'; ctx.fillRect(dx + dw * 0.48, dy, dw * 0.04, dh);
      ctx.fillStyle = '#120809'; ctx.fillRect(0, ground, w, h - ground);
      const spill = ctx.createRadialGradient(dx + dw / 2, ground, 0, dx + dw / 2, ground, w * 0.45);
      spill.addColorStop(0, 'rgba(255,214,150,.28)'); spill.addColorStop(1, 'rgba(255,214,150,0)');
      ctx.fillStyle = spill; ctx.fillRect(0, ground, w, h - ground);
      ctx.fillStyle = 'rgba(254,248,240,.22)';
      for (let x = 10; x < w; x += 44) ctx.fillRect(x, ground + (h - ground) * 0.72, 22, 2);
      const T = 8, k = t % T, cw = Math.min(w * 0.4, h * 1.05), base = ground + (h - ground) * 0.5;
      const stopX = dx + dw / 2 - cw * 0.6;
      let cx, rot;
      if (k < 1.6) { const e = easeOut(k / 1.6); cx = lerp(-cw * 1.1, stopX, e); rot = e * 9; }
      else if (k < 5.2) { cx = stopX; rot = 9; }
      else if (k < 6.8) { const e = Math.pow((k - 5.2) / 1.6, 2.2); cx = lerp(stopX, w + cw * 0.2, e); rot = 9 + e * 12; }
      else { cx = w + cw; rot = 0; }
      car(ctx, cx, base, cw, rot);
      if (k > 2.2 && k < 4.6) {
        const e = easeInOut(clamp((k - 2.2) / 1.6, 0, 1));
        const sx = dx + dw / 2, sy = dy + dh * 0.62, ex = cx + cw * 0.42, ey = base - cw * 0.34 * 0.3 - cw * 0.34 * 0.72;
        const bs = Math.max(10, h * 0.08) * (k > 4 ? 1 - (k - 4) / 0.6 : 1);
        if (bs > 1) bag(ctx, lerp(sx, ex, e), lerp(sy, ey, e) - Math.sin(e * Math.PI) * h * 0.06, bs);
        if (k > 3.4) {
          const bx2 = ex + cw * 0.05, by2 = ey - h * 0.16, fs = Math.round(clamp(h * 0.05, 9, 18));
          ctx.font = '700 ' + fs + 'px "Instrument Sans", system-ui, sans-serif';
          const tw = ctx.measureText('Nawilne!').width;
          ctx.fillStyle = '#FEF8F0'; rrect(ctx, bx2 - tw / 2 - 10, by2 - fs * 0.9, tw + 20, fs * 1.8, fs * 0.9); ctx.fill();
          ctx.fillStyle = '#762A30'; ctx.fillText('Nawilne!', bx2, by2);
        }
      }
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  };

  // Freddy's Snack: farrouj turning on the rotisserie
  function chicken(ctx, x, y, r, a) {
    const ry = r * (0.62 + Math.abs(Math.cos(a)) * 0.1);
    const legY = y - ry * 0.3 + Math.cos(a) * r * 0.32, behind = Math.sin(a) < 0;
    const leg = dir => {
      ctx.save(); ctx.translate(x + dir * r * 0.6, legY); ctx.scale(dir, 1); ctx.rotate(-0.75);
      ctx.fillStyle = '#9c4a17'; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.52, r * 0.28, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f3e3c4'; ctx.fillRect(r * 0.42, -r * 0.05, r * 0.24, r * 0.1);
      dot(ctx, r * 0.68, -r * 0.065, r * 0.075, '#f3e3c4'); dot(ctx, r * 0.68, r * 0.065, r * 0.075, '#f3e3c4');
      ctx.restore();
    };
    if (behind) { leg(-1); leg(1); }
    const g = ctx.createLinearGradient(0, y - ry, 0, y + ry);
    g.addColorStop(0, '#f2b45a'); g.addColorStop(0.45, '#d07a2b'); g.addColorStop(1, '#7f3b12');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, ry, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,200,.42)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.1, y - ry * 0.2 + Math.sin(a) * ry * 0.4, r * 0.55, ry * 0.15, -0.1, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(90,40,10,.4)';
    for (let i = 0; i < 6; i++) { const px = x + (hash(i * 3.3) - 0.5) * r * 1.4, py = y + Math.sin(a + i * 1.1) * ry * 0.55; ctx.beginPath(); ctx.arc(px, py, r * 0.04, 0, TAU); ctx.fill(); }
    if (!behind) { leg(-1); leg(1); }
  }
  SCENES.farrouj = {
    draw(s, t) {
      const { ctx, w, h } = s;
      ctx.fillStyle = '#2B33A0'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,244,225,.07)';
      const gp = Math.max(10, w / 30);
      for (let y = gp / 2, row = 0; y < h; y += gp, row++) for (let x = (row % 2) * gp / 2; x < w; x += gp) { ctx.beginPath(); ctx.arc(x, y, gp * 0.14, 0, TAU); ctx.fill(); }
      const ox = w * 0.12, ow = w * 0.76, oy = h * 0.12, oh = h * 0.74;
      ctx.fillStyle = '#141A5C'; rrect(ctx, ox - 8, oy - 8, ow + 16, oh + 16, 18); ctx.fill();
      ctx.fillStyle = '#0d1140'; rrect(ctx, ox, oy, ow, oh, 12); ctx.fill();
      const fl = 0.85 + 0.15 * Math.sin(t * 6);
      const heat = ctx.createRadialGradient(ox + ow / 2, oy + oh / 2, 0, ox + ow / 2, oy + oh / 2, ow * 0.62);
      heat.addColorStop(0, 'rgba(255,120,40,' + (0.32 * fl).toFixed(3) + ')'); heat.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = heat; ctx.fillRect(ox, oy, ow, oh);
      ctx.fillStyle = 'rgba(255,150,70,' + (0.85 * fl).toFixed(3) + ')';
      rrect(ctx, ox + ow * 0.06, oy + oh * 0.05, ow * 0.88, 6, 3); ctx.fill();
      ctx.fillStyle = 'rgba(255,150,70,' + (0.55 * fl).toFixed(3) + ')';
      rrect(ctx, ox + ow * 0.06, oy + oh * 0.92, ow * 0.88, 5, 2.5); ctx.fill();
      const r = Math.min(ow * 0.13, oh * 0.17);
      for (let row = 0; row < 2; row++) {
        const sy = oy + oh * (0.32 + row * 0.38), ang = t * 2.1 + row * 1.3;
        ctx.strokeStyle = '#c9ccd8'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(ox - 4, sy); ctx.lineTo(ox + ow + 4, sy); ctx.stroke();
        for (let i = 0; i < 3; i++) chicken(ctx, ox + ow * (0.2 + i * 0.3), sy, r, ang + i * 0.9);
      }
      for (let i = 0; i < 5; i++) {
        const k = (t * 0.7 + i * 0.37) % 1, dxp = ox + ow * (0.2 + (i % 3) * 0.3) + (hash(i) - 0.5) * r;
        ctx.fillStyle = 'rgba(255,214,140,' + (0.8 * (1 - k)).toFixed(3) + ')';
        ctx.fillRect(dxp, oy + oh * 0.4 + k * oh * 0.5, 2, 4);
      }
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      ctx.beginPath(); ctx.moveTo(ox + ow * 0.12, oy); ctx.lineTo(ox + ow * 0.3, oy); ctx.lineTo(ox + ow * 0.16, oy + oh); ctx.lineTo(ox - ow * 0.02, oy + oh); ctx.closePath(); ctx.fill();
    }
  };

  // ORA For Men: a rail of the first drop, swaying
  function hanger(ctx, s) {
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = Math.max(1.5, s * 0.012); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -s * 0.035, s * 0.03, Math.PI, Math.PI * 2.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -s * 0.005); ctx.lineTo(-s * 0.28, s * 0.09); ctx.moveTo(0, -s * 0.005); ctx.lineTo(s * 0.28, s * 0.09); ctx.stroke();
  }
  function garmentTop(ctx, s, fill, line, kind, swing) {
    const sh = s * 0.3;
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(-s * 0.08, s * 0.05);
    ctx.lineTo(-sh, s * 0.1); ctx.lineTo(-sh - s * 0.05, s * 0.62); ctx.lineTo(-sh + s * 0.05, s * 0.64);
    ctx.lineTo(-sh + s * 0.07, s * 0.3); ctx.lineTo(-sh + s * 0.08, s * 0.78); ctx.lineTo(sh - s * 0.08, s * 0.78);
    ctx.lineTo(sh - s * 0.07, s * 0.3); ctx.lineTo(sh - s * 0.05, s * 0.64); ctx.lineTo(sh + s * 0.05, s * 0.62); ctx.lineTo(sh, s * 0.1);
    ctx.lineTo(s * 0.08, s * 0.05); ctx.closePath(); ctx.fill();
    if (line) { ctx.strokeStyle = line; ctx.lineWidth = 1.5; ctx.stroke(); }
    if (kind === 'hoodie') {
      ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(0, s * 0.05, s * 0.13, s * 0.09, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.08)'; rrect(ctx, -s * 0.13, s * 0.48, s * 0.26, s * 0.14, s * 0.03); ctx.fill();
      ctx.strokeStyle = '#d9d6cf'; ctx.lineWidth = Math.max(1, s * 0.01);
      for (const sx of [-0.04, 0.04]) { const tip = s * 0.24, a = -swing * 2.2; ctx.beginPath(); ctx.moveTo(sx * s, s * 0.09); ctx.lineTo(sx * s + Math.sin(a) * tip, s * 0.09 + Math.cos(a) * tip); ctx.stroke(); }
    } else if (kind === 'jacket') {
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, s * 0.06); ctx.lineTo(0, s * 0.78); ctx.stroke();
      ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(-s * 0.1, s * 0.02); ctx.lineTo(0, s * 0.14); ctx.lineTo(s * 0.1, s * 0.02); ctx.closePath(); ctx.fill();
    } else {
      ctx.strokeStyle = line || 'rgba(0,0,0,.2)'; ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) { const y = s * (0.72 + i * 0.015); ctx.beginPath(); ctx.moveTo(-sh + s * 0.09, y); ctx.lineTo(sh - s * 0.09, y); ctx.stroke(); }
    }
  }
  function jeans(ctx, s) {
    ctx.fillStyle = '#2d3a4e';
    ctx.beginPath();
    ctx.moveTo(-s * 0.22, s * 0.1); ctx.lineTo(s * 0.22, s * 0.1); ctx.lineTo(s * 0.28, s * 0.86); ctx.lineTo(s * 0.04, s * 0.86);
    ctx.lineTo(0, s * 0.36); ctx.lineTo(-s * 0.04, s * 0.86); ctx.lineTo(-s * 0.28, s * 0.86); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-s * 0.22, s * 0.16); ctx.lineTo(s * 0.22, s * 0.16); ctx.stroke();
    ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = Math.max(1.5, s * 0.012);
    ctx.beginPath(); ctx.moveTo(-s * 0.24, s * 0.1); ctx.lineTo(s * 0.24, s * 0.1); ctx.moveTo(0, s * 0.1); ctx.lineTo(0, -s * 0.01); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, -s * 0.035, s * 0.03, Math.PI, Math.PI * 2.1); ctx.stroke();
  }
  SCENES.rail = {
    draw(s, t) {
      const { ctx, w, h } = s;
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#efede8'); bg.addColorStop(1, '#d9d6cf');
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fillRect(0, h * 0.9, w, h * 0.1);
      const ry = h * 0.22, x0 = w * 0.08, x1 = w * 0.92;
      ctx.fillStyle = '#1b1b1b';
      ctx.fillRect(x0, ry - 2, x1 - x0, 4); ctx.fillRect(x0, ry - 2, 3, h * 0.9 - ry); ctx.fillRect(x1 - 3, ry - 2, 3, h * 0.9 - ry);
      const kinds = ['hoodie', 'knit', 'jeans'], n = kinds.length, gap = (x1 - x0) / n;
      const size = Math.min(gap * 1.75, h * 0.72);
      kinds.forEach((k, i) => {
        const sw = Math.sin(t * 1.3 + i * 1.7) * 0.05;
        ctx.save(); ctx.translate(x0 + gap * (i + 0.5), ry); ctx.rotate(sw);
        if (k === 'jeans') jeans(ctx, size);
        else {
          hanger(ctx, size);
          if (k === 'hoodie') garmentTop(ctx, size, '#161616', null, 'hoodie', sw);
          else if (k === 'jacket') garmentTop(ctx, size, '#3b3a38', null, 'jacket', sw);
          else garmentTop(ctx, size, '#f4f1ea', '#1b1b1b', 'knit', sw);
        }
        ctx.restore();
      });
      const tagX = x0 + gap * 0.5 + size * 0.2, tagY = ry + size * 0.42;
      ctx.save(); ctx.translate(tagX, tagY); ctx.rotate(Math.sin(t * 1.3) * 0.12);
      ctx.fillStyle = '#ffffff'; rrect(ctx, -size * 0.06, 0, size * 0.12, size * 0.16, 2); ctx.fill();
      ctx.fillStyle = '#161616'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 ' + Math.max(7, Math.round(size * 0.045)) + 'px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText('01', 0, size * 0.09);
      ctx.restore();
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  };

  // Dar El Chimal: an open book turning its pages
  function pageLines(seed) {
    const R = rng(seed * 9301 + 49297), out = [];
    let v = 0.1;
    out.push([0.16, v, 0.16 + 0.3 + R() * 0.25, v + 0.035]); v += 0.08;
    if (R() < 0.4) { out.push([0.16, v, 0.86, v + 0.24, 1]); v += 0.29; }
    while (v < 0.88) {
      const n = 2 + Math.floor(R() * 4);
      for (let i = 0; i < n && v < 0.88; i++) { out.push([0.16, v, i === n - 1 ? 0.16 + 0.25 + R() * 0.4 : 0.86, v + 0.018]); v += 0.048; }
      v += 0.035;
    }
    return out;
  }
  function pageQuads(ctx, map, lines, alpha) {
    for (const L of lines) {
      ctx.fillStyle = L[4] ? 'rgba(80,110,190,' + (alpha * 0.55).toFixed(3) + ')' : 'rgba(40,44,70,' + alpha.toFixed(3) + ')';
      const a = map(L[0], L[1]), b = map(L[2], L[1]), c = map(L[2], L[3]), d = map(L[0], L[3]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
    }
  }
  SCENES.book = {
    draw(s, t) {
      const { ctx, w, h } = s;
      ctx.fillStyle = '#0f1c3f'; ctx.fillRect(0, 0, w, h);
      const lg = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.6);
      lg.addColorStop(0, 'rgba(120,150,255,.18)'); lg.addColorStop(1, 'rgba(15,28,63,0)');
      ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h);
      const pw = Math.min(w * 0.4, h * 0.52), ph = pw * 1.32, cx = w / 2, top = h * 0.46 - ph / 2;
      const cycle = 3.4, n = Math.floor(t / cycle), k = (t % cycle) / cycle;
      const f = clamp((k - 0.3) / 0.45, 0, 1), th = easeInOut(f) * Math.PI;
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.ellipse(cx, top + ph * 1.04, pw * 1.08, ph * 0.05, 0, 0, TAU); ctx.fill();
      const flat = (sgn) => (u, v) => [cx + sgn * pw * u, top + v * ph];
      for (const sgn of [-1, 1]) {
        const g = ctx.createLinearGradient(cx, 0, cx + sgn * pw, 0);
        g.addColorStop(0, '#d9cfb8'); g.addColorStop(0.12, '#f4ecdb'); g.addColorStop(1, '#f8f1e3');
        ctx.fillStyle = g;
        ctx.fillRect(sgn < 0 ? cx - pw : cx, top, pw, ph);
      }
      pageQuads(ctx, flat(-1), pageLines(f >= 1 ? n * 2 + 2 : n * 2), 0.32);
      pageQuads(ctx, flat(1), pageLines(f > 0 ? n * 2 + 3 : n * 2 + 1), 0.32);
      if (f > 0 && f < 1) {
        const c = Math.cos(th), lift = Math.sin(th) * ph * 0.05;
        const map = (u, v) => [cx + c * pw * u, top + v * ph + (v - 0.5) * 2 * lift * u];
        const shade = Math.abs(c);
        const a = map(0, 0), b = map(1, 0), cc = map(1, 1), d = map(0, 1);
        ctx.fillStyle = mix('#f8f1e3', th < Math.PI / 2 ? '#bdb29a' : '#cfc5ad', 1 - shade);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(cc[0], cc[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
        pageQuads(ctx, map, pageLines(th < Math.PI / 2 ? n * 2 + 1 : n * 2 + 2), 0.32 * shade + 0.04);
      }
      const sg = ctx.createLinearGradient(cx - pw * 0.1, 0, cx + pw * 0.1, 0);
      sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(0.5, 'rgba(0,0,0,.2)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg; ctx.fillRect(cx - pw * 0.1, top, pw * 0.2, ph);
      const bw = pw * 1.5, bx = cx - bw / 2, by = top + ph + ph * 0.12;
      ctx.fillStyle = 'rgba(255,255,255,.14)'; rrect(ctx, bx, by, bw, 4, 2); ctx.fill();
      ctx.fillStyle = '#ffcf5a'; rrect(ctx, bx, by, Math.max(4, bw * (((n % 12) + f) / 12)), 4, 2); ctx.fill();
    }
  };

  // Admiral909: a record and a level meter
  SCENES.vinyl = {
    init(s) { const R = rng(17); s.ph = Array.from({ length: 24 }, () => [R() * TAU, R() * TAU, R() * TAU]); s.peak = new Float32Array(24); },
    draw(s, t, dt) {
      const { ctx, w, h } = s;
      ctx.fillStyle = '#0b0807'; ctx.fillRect(0, 0, w, h);
      const wide = w > h * 1.15;
      const r = wide ? Math.min(h * 0.37, w * 0.24) : Math.min(w * 0.3, h * 0.25);
      const cx = wide ? w * 0.3 : w * 0.5, cy = wide ? h * 0.5 : h * 0.36;
      const gl = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 1.6);
      gl.addColorStop(0, 'rgba(255,176,0,.12)'); gl.addColorStop(1, 'rgba(255,176,0,0)');
      ctx.fillStyle = gl; ctx.fillRect(0, 0, w, h);
      dot(ctx, cx, cy, r, '#121212');
      ctx.lineWidth = 1;
      for (let rr = r * 0.4, i = 0; rr < r * 0.97; rr += 3, i++) {
        ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.35)';
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
      }
      if (ctx.createConicGradient) {
        const cg = ctx.createConicGradient(-0.6, cx, cy);
        cg.addColorStop(0, 'rgba(255,255,255,0)'); cg.addColorStop(0.06, 'rgba(255,255,255,.1)'); cg.addColorStop(0.12, 'rgba(255,255,255,0)');
        cg.addColorStop(0.5, 'rgba(255,255,255,0)'); cg.addColorStop(0.56, 'rgba(255,255,255,.08)'); cg.addColorStop(0.62, 'rgba(255,255,255,0)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      }
      dot(ctx, cx, cy, r * 0.33, '#ffb000');
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * TAU * 0.55);
      ctx.fillStyle = '#1a1206';
      ctx.fillRect(-r * 0.2, -r * 0.05, r * 0.4, r * 0.03); ctx.fillRect(-r * 0.13, r * 0.03, r * 0.26, r * 0.024);
      ctx.beginPath(); ctx.arc(r * 0.19, -r * 0.17, r * 0.03, 0, TAU); ctx.fill();
      ctx.restore();
      dot(ctx, cx, cy, Math.max(1.5, r * 0.03), '#0b0807');
      const px = cx + r * 1.08, py = cy - r * 0.92, sx = cx + r * 0.62, sy = cy + r * 0.12;
      ctx.strokeStyle = '#cfc8bd'; ctx.lineWidth = Math.max(2, r * 0.035); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx, sy); ctx.stroke();
      dot(ctx, px, py, r * 0.07, '#cfc8bd');
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(-0.4); ctx.fillStyle = '#cfc8bd'; ctx.fillRect(-r * 0.05, -r * 0.03, r * 0.15, r * 0.07); ctx.restore();
      const N = wide ? 18 : 16;
      const x0 = wide ? w * 0.6 : w * 0.1, x1 = wide ? w * 0.93 : w * 0.9;
      const yb = wide ? h * 0.8 : h * 0.92, ht = wide ? h * 0.6 : h * 0.3;
      const bw = (x1 - x0) / N, beat = Math.exp(-((t % 0.5) * 9));
      const segH = Math.max(4, ht / 16), gp = Math.max(1.5, segH * 0.35), nseg = Math.floor(ht / segH);
      for (let i = 0; i < N; i++) {
        const p = s.ph[i];
        let v = 0.38 + 0.2 * Math.sin(t * 3.1 + p[0]) + 0.14 * Math.sin(t * 7.3 + p[1]) + 0.1 * Math.sin(t * 12.7 + p[2]);
        v += beat * 0.45 * Math.max(0, 1 - i / (N * 0.35));
        v = clamp(v * (1 - (i / N) * 0.35), 0.05, 1);
        s.peak[i] = Math.max(v, s.peak[i] - dt * 0.5);
        const on = Math.round(v * nseg);
        for (let k = 0; k < on; k++) {
          ctx.fillStyle = k > nseg * 0.82 ? '#ff4d2e' : k > nseg * 0.62 ? '#ffd23f' : '#ffb000';
          ctx.globalAlpha = 0.55 + 0.45 * (k / nseg);
          ctx.fillRect(x0 + i * bw + bw * 0.14, yb - (k + 1) * segH, bw * 0.72, segH - gp);
        }
        ctx.globalAlpha = 1;
        const pk = Math.round(s.peak[i] * nseg);
        ctx.fillStyle = '#fff3d6';
        ctx.fillRect(x0 + i * bw + bw * 0.14, yb - (pk + 1) * segH, bw * 0.72, Math.max(1.5, (segH - gp) * 0.5));
      }
    }
  };

  // Swedish Fika: pick-and-mix candy falling into a pile, in the brand's two colours
  const CANDY = ['#1C49A6', '#123478', '#4762AE', '#1C49A6', '#ffffff'];
  function candyStep(s, dt) {
    const { w, h } = s, g = h * 3;
    if (s.state === 0) {
      s.spawn -= dt;
      if (s.spawn <= 0 && s.b.length < s.max) {
        s.spawn = 0.07;
        const r = s.unit * (0.75 + s.R() * 0.45);
        s.b.push({ x: r + s.R() * (w - 2 * r), y: -r * 2, vx: (s.R() - 0.5) * 80, vy: 0, r, type: pick(s.R, ['fish', 'drop', 'ring', 'bear', 'fish', 'drop']), c: pick(s.R, CANDY), a: s.R() * TAU, va: (s.R() - 0.5) * 2 });
      }
      if (s.b.length >= s.max) { s.timer += dt; if (s.timer > 2.6) { s.state = 1; s.timer = 0; } }
    } else if (!s.b.length) { s.state = 0; s.timer = 0; }
    const floor = s.state === 1 ? Infinity : h;
    for (const b of s.b) {
      b.vy += g * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.va * dt; b.va *= 0.985;
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.4; }
      if (b.x > w - b.r) { b.x = w - b.r; b.vx = -Math.abs(b.vx) * 0.4; }
      if (b.y > floor - b.r) { b.y = floor - b.r; b.vy = -Math.abs(b.vy) * 0.22; b.vx *= 0.9; b.va = b.vx / b.r; }
    }
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < s.b.length; i++) {
        const A = s.b[i];
        for (let j = i + 1; j < s.b.length; j++) {
          const B = s.b[j], dx = B.x - A.x, dy = B.y - A.y, rr = (A.r + B.r) * 0.92, d2 = dx * dx + dy * dy;
          if (d2 >= rr * rr || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = (rr - d) / 2;
          A.x -= nx * ov; A.y -= ny * ov; B.x += nx * ov; B.y += ny * ov;
          const rv = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
          if (rv < 0) { const imp = -rv * 0.6; A.vx -= nx * imp; A.vy -= ny * imp; B.vx += nx * imp; B.vy += ny * imp; }
        }
      }
    }
    for (const b of s.b) if (b.y > floor - b.r) b.y = floor - b.r;
    if (s.state === 1) s.b = s.b.filter(b => b.y < h + b.r * 3);
  }
  function candy(ctx, b) {
    const r = b.r;
    if (b.type === 'fish') {
      ctx.fillStyle = b.c;
      ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 1.05, r * 0.62, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r * 0.75, 0); ctx.lineTo(r * 1.32, -r * 0.5); ctx.lineTo(r * 1.32, r * 0.5); ctx.closePath(); ctx.fill();
      if (b.c === '#ffffff') { ctx.strokeStyle = '#1C49A6'; ctx.lineWidth = Math.max(1.2, r * 0.1); ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 1.05, r * 0.62, 0, 0, TAU); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.26, r * 0.36, r * 0.12, -0.2, 0, TAU); ctx.fill();
      dot(ctx, -r * 0.62, -r * 0.1, r * 0.08, b.c === '#ffffff' ? '#1C49A6' : 'rgba(247,234,241,.9)');
    } else if (b.type === 'drop') {
      ctx.fillStyle = b.c;
      ctx.beginPath(); ctx.moveTo(-r * 0.95, r * 0.55); ctx.bezierCurveTo(-r, -r * 0.95, r, -r * 0.95, r * 0.95, r * 0.55); ctx.quadraticCurveTo(0, r * 0.8, -r * 0.95, r * 0.55); ctx.fill();
      if (b.c === '#ffffff') { ctx.strokeStyle = '#1C49A6'; ctx.lineWidth = Math.max(1.2, r * 0.1); ctx.stroke(); }
      ctx.fillStyle = b.c === '#ffffff' ? 'rgba(28,73,166,.7)' : 'rgba(247,234,241,.85)';
      for (let k = 0; k < 7; k++) { const a = k * 2.4, rr = r * (0.2 + (k % 3) * 0.2); ctx.fillRect(Math.cos(a) * rr - 1, Math.sin(a) * rr * 0.6 - r * 0.1 - 1, 2.2, 2.2); }
    } else if (b.type === 'ring') {
      ctx.fillStyle = b.c === '#ffffff' ? '#1C49A6' : b.c;
      ctx.beginPath(); circ(ctx, 0, 0, r); ctx.moveTo(r * 0.42, 0); ctx.arc(0, 0, r * 0.42, 0, TAU, true); ctx.fill();
      ctx.strokeStyle = 'rgba(247,234,241,.55)'; ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.beginPath(); ctx.arc(0, 0, r * 0.71, -2.4, -0.9); ctx.stroke();
    } else {
      ctx.fillStyle = b.c === '#ffffff' ? '#4762AE' : b.c; ctx.globalAlpha = 0.92;
      ctx.beginPath();
      circ(ctx, 0, -r * 0.45, r * 0.42); circ(ctx, -r * 0.32, -r * 0.8, r * 0.17); circ(ctx, r * 0.32, -r * 0.8, r * 0.17);
      ctx.moveTo(r * 0.55, r * 0.25); ctx.ellipse(0, r * 0.25, r * 0.55, r * 0.62, 0, 0, TAU);
      circ(ctx, -r * 0.5, r * 0.05, r * 0.18); circ(ctx, r * 0.5, r * 0.05, r * 0.18); circ(ctx, -r * 0.3, r * 0.8, r * 0.2); circ(ctx, r * 0.3, r * 0.8, r * 0.2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.ellipse(-r * 0.15, r * 0.05, r * 0.12, r * 0.25, -0.3, 0, TAU); ctx.fill();
    }
  }
  SCENES.candy = {
    init(s) {
      s.R = rng(23); s.b = []; s.state = 0; s.timer = 0; s.spawn = 0;
      s.unit = clamp(Math.sqrt(s.w * s.h) / 13, 12, 40);
      s.max = Math.round(clamp((s.w * s.h) / (s.unit * s.unit * 3.4), 14, 70));
      for (let i = 0; i < 260; i++) candyStep(s, 1 / 30);
    },
    draw(s, t, dt) {
      if (dt) { const n = dt > 1 / 45 ? 2 : 1; for (let i = 0; i < n; i++) candyStep(s, dt / n); }
      const { ctx, w, h } = s;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#FFF8FB'); g.addColorStop(1, '#EFD6E4');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (const b of s.b) { ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); candy(ctx, b); ctx.restore(); }
    }
  };

  // TrekTrakkr: a trail drawn over contour lines
  function catmull(pts, seg) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let k = 0; k < seg; k++) {
        const t = k / seg, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
      }
    }
    out.push(pts[pts.length - 1].slice());
    return out;
  }
  SCENES.trail = {
    init(s) {
      const { w, h } = s, R = rng(31);
      const peaks = [[0.28, 0.32, 7], [0.76, 0.55, 6], [0.3, 0.8, 5]].map(([x, y, n]) => ({ x: x * w, y: y * h, n, ph: R() * TAU, ph2: R() * TAU }));
      const step = Math.min(w, h) * 0.056;
      s.contours = [];
      for (const p of peaks) {
        for (let k = 1; k <= p.n; k++) {
          const path = new Path2D();
          for (let a = 0; a <= 72; a++) {
            const th = (a / 72) * TAU;
            const rr = k * step * (1 + 0.2 * Math.sin(3 * th + p.ph) + 0.1 * Math.sin(5 * th + p.ph2) + 0.05 * Math.sin(7 * th + k));
            const x = p.x + Math.cos(th) * rr * 1.15, y = p.y + Math.sin(th) * rr * 0.85;
            if (a) path.lineTo(x, y); else path.moveTo(x, y);
          }
          path.closePath();
          s.contours.push({ path, idx: k % 4 === 0 });
        }
      }
      s.path = catmull([[0.18, 0.96], [0.32, 0.86], [0.55, 0.74], [0.5, 0.6], [0.6, 0.45], [0.44, 0.33], [0.3, 0.24], [0.36, 0.12]].map(([x, y]) => [x * w, y * h]), 14);
      s.len = [0];
      for (let i = 1; i < s.path.length; i++) s.len.push(s.len[i - 1] + Math.hypot(s.path[i][0] - s.path[i - 1][0], s.path[i][1] - s.path[i - 1][1]));
    },
    draw(s, t) {
      const { ctx, w, h } = s;
      ctx.fillStyle = '#0c2117'; ctx.fillRect(0, 0, w, h);
      for (const c of s.contours) { ctx.strokeStyle = c.idx ? '#3f7357' : '#24493a'; ctx.lineWidth = c.idx ? 1.4 : 1; ctx.stroke(c.path); }
      const T = 9, kk = clamp(((t % T) / T) * 1.15, 0, 1), k = easeInOut(kk);
      const total = s.len[s.len.length - 1], L = total * k;
      ctx.setLineDash([4, 6]); ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 2;
      ctx.beginPath(); s.path.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      let hx = s.path[0][0], hy = s.path[0][1];
      ctx.moveTo(hx, hy);
      for (let i = 1; i < s.path.length; i++) {
        if (s.len[i] <= L) { hx = s.path[i][0]; hy = s.path[i][1]; ctx.lineTo(hx, hy); }
        else { const f = (L - s.len[i - 1]) / (s.len[i] - s.len[i - 1] || 1); hx = lerp(s.path[i - 1][0], s.path[i][0], f); hy = lerp(s.path[i - 1][1], s.path[i][1], f); ctx.lineTo(hx, hy); break; }
      }
      ctx.stroke();
      dot(ctx, s.path[0][0], s.path[0][1], 5, '#5fe39a');
      const end = s.path[s.path.length - 1];
      ctx.fillStyle = '#ff7a45'; ctx.fillRect(end[0] - 1, end[1] - 16, 2, 16);
      ctx.beginPath(); ctx.moveTo(end[0] + 1, end[1] - 16); ctx.lineTo(end[0] + 12, end[1] - 12); ctx.lineTo(end[0] + 1, end[1] - 8); ctx.closePath(); ctx.fill();
      const pu = (t * 1.2) % 1;
      dot(ctx, hx, hy, 6 + pu * 14, 'rgba(255,255,255,' + (0.35 * (1 - pu)).toFixed(3) + ')');
      dot(ctx, hx, hy, 6, '#ffffff'); dot(ctx, hx, hy, 3, '#ff7a45');
      const pad = w * 0.07, cw = w - pad * 2, ct = h * 0.05, chh = Math.max(44, h * 0.1);
      ctx.fillStyle = 'rgba(6,20,13,.86)'; rrect(ctx, pad, ct, cw, chh, 12); ctx.fill();
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#9fb8aa'; ctx.font = '600 ' + Math.round(clamp(w * 0.045, 9, 13)) + 'px "Instrument Sans", system-ui, sans-serif';
      ctx.fillText('Distance', pad + cw * 0.08, ct + chh * 0.16); ctx.fillText('Climb', pad + cw * 0.56, ct + chh * 0.16);
      ctx.fillStyle = '#ffffff'; ctx.font = '800 ' + Math.round(clamp(w * 0.08, 14, 24)) + 'px "Doto", "Instrument Sans", monospace';
      ctx.fillText((k * 6.4).toFixed(1) + ' km', pad + cw * 0.08, ct + chh * 0.46); ctx.fillText('+' + Math.round(k * 410) + ' m', pad + cw * 0.56, ct + chh * 0.46);
      ctx.textBaseline = 'alphabetic';
    }
  };

  // Mortben: a feed scrolling inside an app frame
  SCENES.feed = {
    init(s) {
      const R = rng(41);
      s.cards = Array.from({ length: 8 }, (_, i) => ({ c: ['#1f8a7a', '#ff8466', '#f2b94b', '#6c4a6e', '#3d6fd8'][i % 5], l2: 0.55 + R() * 0.35, l3: 0.3 + R() * 0.35, img: i % 3 !== 2 }));
    },
    draw(s, t) {
      const { ctx, w, h } = s;
      ctx.fillStyle = '#f3efe7'; ctx.fillRect(0, 0, w, h);
      const pad = w * 0.07, top = h * 0.13, tab = h * 0.09, cardW = w - pad * 2, gap = w * 0.05;
      const sp = 24;
      ctx.save(); ctx.beginPath(); ctx.rect(0, top, w, h - top - tab); ctx.clip();
      let y = top + pad * 0.6 - (t * sp) % (cardW * 0.82 + gap);
      let idx = Math.floor((t * sp) / (cardW * 0.82 + gap));
      while (y < h) {
        const c = s.cards[((idx % 8) + 8) % 8], ch = c.img ? cardW * 0.82 : cardW * 0.42;
        ctx.fillStyle = '#ffffff'; rrect(ctx, pad, y, cardW, ch, 14); ctx.fill();
        let ly = y + 12;
        if (c.img) {
          ctx.fillStyle = c.c; rrect(ctx, pad + 10, ly, cardW - 20, ch * 0.56, 10); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.arc(pad + cardW * 0.7, ly + ch * 0.22, ch * 0.12, 0, TAU); ctx.fill();
          ly += ch * 0.56 + 12;
        }
        ctx.fillStyle = '#2a312f'; rrect(ctx, pad + 12, ly, (cardW - 24) * 0.7, 8, 4); ctx.fill();
        ctx.fillStyle = '#c8c1b5'; rrect(ctx, pad + 12, ly + 16, (cardW - 24) * c.l2, 6, 3); ctx.fill();
        rrect(ctx, pad + 12, ly + 28, (cardW - 24) * c.l3, 6, 3); ctx.fill();
        y += ch + gap; idx++;
      }
      ctx.restore();
      ctx.fillStyle = '#f3efe7'; ctx.fillRect(0, 0, w, top);
      ctx.fillStyle = '#20302c'; rrect(ctx, pad, top * 0.48, w * 0.34, Math.max(6, top * 0.16), 4); ctx.fill();
      dot(ctx, w - pad - top * 0.14, top * 0.56, top * 0.14, '#1f8a7a');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, h - tab, w, tab);
      ctx.fillStyle = 'rgba(0,0,0,.07)'; ctx.fillRect(0, h - tab, w, 1);
      const act = Math.floor(t / 2.2) % 4, ic = w * 0.075;
      for (let k = 0; k < 4; k++) { const x = (w * (k + 0.5)) / 4; ctx.fillStyle = k === act ? '#1f8a7a' : '#bdb6aa'; rrect(ctx, x - ic / 2, h - tab * 0.66, ic, ic, ic * 0.28); ctx.fill(); }
      const ax = (w * (act + 0.5)) / 4;
      ctx.fillStyle = '#1f8a7a'; rrect(ctx, ax - w * 0.05, h - tab + 4, w * 0.1, 3, 1.5); ctx.fill();
    }
  };

  // Brothers Taxi: a ride across a city grid
  function polylen(pts) { const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return L; }
  function along(pts, L, k) {
    const d = L[L.length - 1] * k;
    for (let i = 1; i < pts.length; i++) {
      if (L[i] >= d) {
        const f = (d - L[i - 1]) / (L[i] - L[i - 1] || 1);
        return { x: lerp(pts[i - 1][0], pts[i][0], f), y: lerp(pts[i - 1][1], pts[i][1], f), a: Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]) };
      }
    }
    const n = pts.length - 1;
    return { x: pts[n][0], y: pts[n][1], a: Math.atan2(pts[n][1] - pts[n - 1][1], pts[n][0] - pts[n - 1][0]) };
  }
  function pin(ctx, x, y, s, c) {
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x - s * 1.2, y - s * 1.3, x - s, y - s * 2.6, x, y - s * 2.6); ctx.bezierCurveTo(x + s, y - s * 2.6, x + s * 1.2, y - s * 1.3, x, y); ctx.fill();
    dot(ctx, x, y - s * 1.75, s * 0.42, '#ffffff');
  }
  SCENES.taxi = {
    init(s) {
      const { w, h } = s;
      s.cols = [0.16, 0.4, 0.64, 0.88].map(v => v * w);
      s.rows = [0.14, 0.31, 0.49, 0.67, 0.84].map(v => v * h);
      const C = s.cols, Rw = s.rows;
      s.route = [[C[0], Rw[4] + h * 0.05], [C[0], Rw[3]], [C[1], Rw[3]], [C[1], Rw[1]], [C[2], Rw[1]], [C[2], Rw[0] - h * 0.02]];
      s.L = polylen(s.route);
    },
    draw(s, t) {
      const { ctx, w, h } = s;
      ctx.fillStyle = '#1b1e23'; ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2, h / 2); ctx.rotate(-0.12); ctx.translate(-w / 2, -h / 2);
      ctx.fillStyle = '#13263a';
      ctx.beginPath(); ctx.moveTo(-w, -h); ctx.lineTo(w * 0.05, -h); ctx.lineTo(w * 0.02, h * 0.35); ctx.lineTo(-w * 0.03, h * 2); ctx.lineTo(-w, h * 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1f3527'; ctx.fillRect(s.cols[1] + 8, s.rows[2] + 8, s.cols[2] - s.cols[1] - 16, s.rows[3] - s.rows[2] - 16);
      ctx.fillStyle = '#22262c';
      for (let i = 0; i < 4; i++) ctx.fillRect(s.cols[i % 3] + 12, s.rows[(i * 2) % 4] + 12, (s.cols[1] - s.cols[0]) * 0.4, (s.rows[1] - s.rows[0]) * 0.45);
      ctx.strokeStyle = '#2d3139'; ctx.lineWidth = Math.max(5, w * 0.032);
      for (const x of s.cols) { ctx.beginPath(); ctx.moveTo(x, -h); ctx.lineTo(x, h * 2); ctx.stroke(); }
      for (const y of s.rows) { ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w * 2, y); ctx.stroke(); }
      ctx.lineWidth = Math.max(2, w * 0.012); ctx.strokeStyle = '#262a31';
      for (let i = 0; i < s.cols.length - 1; i++) { const x = (s.cols[i] + s.cols[i + 1]) / 2; ctx.beginPath(); ctx.moveTo(x, -h); ctx.lineTo(x, h * 2); ctx.stroke(); }
      const line = () => { ctx.beginPath(); s.route.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); };
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,212,0,.22)'; ctx.lineWidth = Math.max(8, w * 0.045); line(); ctx.stroke();
      ctx.strokeStyle = '#ffd400'; ctx.lineWidth = Math.max(2.5, w * 0.014); line(); ctx.stroke();
      const ps = Math.max(6, w * 0.035);
      const st = s.route[0], en = s.route[s.route.length - 1];
      dot(ctx, st[0], st[1], ps * 0.7, '#3ddc84'); dot(ctx, st[0], st[1], ps * 0.3, '#ffffff');
      const T = 7, k = easeInOut(clamp((t % T) / (T * 0.85), 0, 1));
      const c = along(s.route, s.L, k);
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
      const Lc = Math.max(16, w * 0.09), Wc = Lc * 0.52;
      const hg = ctx.createRadialGradient(Lc * 0.6, 0, 0, Lc * 0.6, 0, Lc * 1.8);
      hg.addColorStop(0, 'rgba(255,240,180,.35)'); hg.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.moveTo(Lc * 0.5, -Wc * 0.3); ctx.lineTo(Lc * 2.3, -Wc * 1.25); ctx.lineTo(Lc * 2.3, Wc * 1.25); ctx.lineTo(Lc * 0.5, Wc * 0.3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffd400'; rrect(ctx, -Lc / 2, -Wc / 2, Lc, Wc, Wc * 0.3); ctx.fill();
      ctx.fillStyle = '#1b1d22'; rrect(ctx, -Lc * 0.18, -Wc * 0.38, Lc * 0.42, Wc * 0.76, Wc * 0.18); ctx.fill();
      ctx.fillStyle = '#fff6d0'; ctx.fillRect(Lc * 0.44, -Wc * 0.4, Lc * 0.05, Wc * 0.2); ctx.fillRect(Lc * 0.44, Wc * 0.2, Lc * 0.05, Wc * 0.2);
      ctx.restore();
      ctx.restore();
      // destination pin drawn upright, in screen space
      const ca = Math.cos(-0.12), sa = Math.sin(-0.12);
      const ex = w / 2 + (en[0] - w / 2) * ca - (en[1] - h / 2) * sa, ey = h / 2 + (en[0] - w / 2) * sa + (en[1] - h / 2) * ca;
      pin(ctx, ex, ey, ps, '#ff4d4d');
      const mins = Math.max(1, Math.ceil((1 - k) * 9));
      const cw = w * 0.74, chh = Math.max(30, h * 0.075), cx = (w - cw) / 2, cy = h - chh - h * 0.05;
      ctx.fillStyle = 'rgba(255,255,255,.96)'; rrect(ctx, cx, cy, cw, chh, chh / 2); ctx.fill();
      ctx.fillStyle = '#16181c'; ctx.font = '700 ' + Math.round(chh * 0.36) + 'px "Instrument Sans", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(k >= 1 ? 'You have arrived' : mins + ' min to your stop', w / 2, cy + chh / 2);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }
  };

  // Hammana Artist House: a profile grid of artworks, with likes coming in
  const ART = ['#ef6f3c', '#2f5d50', '#f2c14e', '#1f3a5f', '#e8d5b7', '#c84b31', '#7a9e7e', '#d9a5b3', '#14213d'];
  function art(ctx, x, y, s, p) {
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, s, s); ctx.clip();
    ctx.fillStyle = p.bg; ctx.fillRect(x, y, s, s);
    ctx.fillStyle = p.a;
    if (p.type === 0) { dot(ctx, x + s * 0.5, y + s * 0.55, s * 0.3, p.a); }
    else if (p.type === 1) { ctx.beginPath(); ctx.arc(x + s * 0.5, y + s, s * 0.45, Math.PI, 0); ctx.fill(); ctx.fillStyle = p.b; ctx.fillRect(x, y + s * 0.18, s, s * 0.08); }
    else if (p.type === 2) { for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? p.a : p.b; ctx.fillRect(x, y + (i * s) / 4, s, s / 8); } }
    else if (p.type === 3) { ctx.beginPath(); ctx.moveTo(x + s * 0.15, y + s * 0.85); ctx.lineTo(x + s * 0.5, y + s * 0.18); ctx.lineTo(x + s * 0.85, y + s * 0.85); ctx.closePath(); ctx.fill(); }
    else { ctx.lineWidth = s * 0.08; for (let i = 0; i < 3; i++) { ctx.strokeStyle = i % 2 ? p.b : p.a; ctx.beginPath(); ctx.arc(x + s * 0.5, y + s * 0.95, s * (0.2 + i * 0.13), Math.PI, 0); ctx.stroke(); } }
    ctx.restore();
  }
  SCENES.social = {
    init(s) {
      const R = rng(51);
      s.posts = Array.from({ length: 18 }, () => { const bg = pick(R, ART); let a = pick(R, ART); if (a === bg) a = ART[(ART.indexOf(bg) + 3) % ART.length]; return { bg, a, b: pick(R, ART), type: Math.floor(R() * 5) }; });
      s.hearts = []; s.nextHeart = 0; s.R = R;
    },
    draw(s, t, dt) {
      const { ctx, w, h } = s;
      ctx.fillStyle = '#fbf8f3'; ctx.fillRect(0, 0, w, h);
      const pad = w * 0.07, av = w * 0.19, ay = h * 0.09;
      const ring = ctx.createLinearGradient(pad, ay, pad + av, ay + av);
      ring.addColorStop(0, '#ef6f3c'); ring.addColorStop(1, '#c84b31');
      ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(pad + av / 2, ay + av / 2, av / 2, 0, TAU); ctx.fill();
      dot(ctx, pad + av / 2, ay + av / 2, av * 0.42, '#fbf8f3');
      dot(ctx, pad + av / 2, ay + av / 2, av * 0.36, '#2f5d50');
      ctx.fillStyle = '#e8d5b7'; ctx.beginPath(); ctx.arc(pad + av / 2, ay + av * 0.62, av * 0.16, Math.PI, 0); ctx.fill();
      const sx = pad + av + w * 0.06, sw = (w - sx - pad) / 3;
      for (let i = 0; i < 3; i++) {
        const mx = sx + sw * (i + 0.5);
        ctx.fillStyle = '#1d1d1b'; rrect(ctx, mx - sw * 0.2, ay + av * 0.34, sw * 0.4, 8, 4); ctx.fill();
        ctx.fillStyle = '#c9c1b4'; rrect(ctx, mx - sw * 0.3, ay + av * 0.6, sw * 0.6, 4, 2); ctx.fill();
      }
      ctx.fillStyle = '#1d1d1b'; rrect(ctx, pad, ay + av + h * 0.03, w * 0.5, 7, 3.5); ctx.fill();
      ctx.fillStyle = '#c9c1b4'; rrect(ctx, pad, ay + av + h * 0.03 + 14, w * 0.7, 5, 2.5); ctx.fill();
      rrect(ctx, pad, ay + av + h * 0.03 + 24, w * 0.55, 5, 2.5); ctx.fill();
      const gy = ay + av + h * 0.11, gap = 2, cs = (w - gap * 2) / 3;
      for (let i = 0; i < 15; i++) {
        const x = (i % 3) * (cs + gap), y = gy + Math.floor(i / 3) * (cs + gap);
        if (y > h) break;
        art(ctx, x, y, cs, s.posts[i]);
      }
      if (dt) {
        s.nextHeart -= dt;
        if (s.nextHeart <= 0) {
          s.nextHeart = 0.75;
          const i = Math.floor(s.R() * 9);
          s.hearts.push({ x: (i % 3) * (cs + gap) + cs * (0.3 + s.R() * 0.4), y: gy + Math.floor(i / 3) * (cs + gap) + cs * (0.4 + s.R() * 0.3), age: 0 });
        }
      }
      for (let i = s.hearts.length - 1; i >= 0; i--) {
        const hh = s.hearts[i];
        hh.age += dt;
        if (hh.age > 1.3) { s.hearts.splice(i, 1); continue; }
        const k = hh.age / 1.3, sc = k < 0.2 ? easeOut(k / 0.2) * 1.2 : 1.2 - (k - 0.2) * 0.25;
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.fillStyle = '#ffffff';
        heart(ctx, hh.x, hh.y - k * cs * 0.25, cs * 0.14 * sc + 1.5);
        ctx.fillStyle = '#ff3b5c';
        heart(ctx, hh.x, hh.y - k * cs * 0.25, cs * 0.14 * sc);
        ctx.globalAlpha = 1;
      }
    }
  };

  function scenes() {
    for (const cv of $$('canvas[data-scene]')) {
      const S = SCENES[cv.dataset.scene];
      if (!S) continue;
      const ctx = cv.getContext('2d');
      const st = { ctx, w: 0, h: 0 };
      let lastT = 2.2;
      const resize = () => {
        const s = fit(cv, ctx);
        const changed = Math.abs(s.w - st.w) > 1 || Math.abs(s.h - st.h) > 1;
        st.w = s.w; st.h = s.h;
        if (changed && S.init) S.init(st);
        S.draw(st, lastT, 0);
      };
      resize();
      if ('ResizeObserver' in window) new ResizeObserver(debounce(resize, 80)).observe(cv);
      redrawOnFonts.push(() => S.draw(st, lastT, 0));
      if (!REDUCE) tasks.push({ el: cv, tick(t, dt) { lastT = t; S.draw(st, t, dt); } });
      watch(cv);
    }
  }

  /* ------------------------------------------------------------ numbers */
  function counters() {
    if (REDUCE || !io) return;
    for (const el of $$('[data-count]')) {
      const to = +el.dataset.count, suf = el.dataset.suffix || '';
      const fmt = n => n.toLocaleString('en-US') + suf;
      let ran = false;
      const ob = new IntersectionObserver(es => {
        if (!es[0].isIntersecting || ran) return;
        ran = true; ob.disconnect();
        const t0 = performance.now(), dur = 1300 + Math.min(1, to / 50000) * 700;
        const step = now => {
          const k = clamp((now - t0) / dur, 0, 1);
          el.textContent = fmt(Math.round(to * easeOut(k)));
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, { threshold: 0.6 });
      ob.observe(el);
    }
  }

  /* ------------------------------------------------------------ contact QR: pixels fly into place */
  function qr() {
    const box = $('#qrBox');
    if (!box || REDUCE || !io) return;
    const cv = $('#qrCanvas'), svg = $('#qrSvg'), ctx = cv.getContext('2d');
    const rows = JSON.parse(box.dataset.m || '[]'), n = rows.length, N = n + 8;
    if (!n) return;
    const R = rng(9), mods = [];
    rows.forEach((row, y) => {
      for (let x = 0; x < n; x++) {
        if (row[x] !== '1') continue;
        const a = R() * TAU, dist = N * (0.7 + R() * 0.8);
        mods.push({ x, y, sx: n / 2 + Math.cos(a) * dist, sy: n / 2 + Math.sin(a) * dist, d: R() * 0.35 + (Math.hypot(x - n / 2, y - n / 2) / n) * 0.5 });
      }
    });
    const run = () => {
      const { w } = fit(cv, ctx), u = w / N, t0 = performance.now();
      svg.style.opacity = '0'; cv.style.opacity = '1';
      const f = now => {
        const T = (now - t0) / 1000;
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, w);
        ctx.fillStyle = '#000000';
        let all = true;
        for (const m of mods) {
          const k = clamp((T - m.d) / 0.9, 0, 1);
          if (k < 1) all = false;
          if (k <= 0) continue;
          const e = easeOut(k);
          ctx.fillRect((lerp(m.sx, m.x, e) + 4) * u, (lerp(m.sy, m.y, e) + 4) * u, u + 0.5, u + 0.5);
        }
        if (!all) requestAnimationFrame(f);
        else { svg.style.opacity = ''; cv.style.opacity = '0'; }
      };
      requestAnimationFrame(f);
    };
    const ob = new IntersectionObserver(es => { if (es[0].isIntersecting) { ob.disconnect(); run(); } }, { threshold: 0.6 });
    ob.observe(box);
    box.addEventListener('click', run);
  }

  /* ------------------------------------------------------------ business card, form, copy */
  function bits() {
    const bc = $('#bcard');
    if (bc) bc.addEventListener('click', () => bc.setAttribute('aria-pressed', bc.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'));

    const form = $('#contactForm');
    if (form) {
      const wa = $('#waSend'), em = $('#emailSend');
      const phone = wa.getAttribute('href').replace(/\D/g, '');
      const email = em.getAttribute('href').replace(/^mailto:/, '');
      const update = () => {
        const name = $('#cName').value.trim();
        const needEl = form.querySelector('input[name="need"]:checked');
        const need = needEl ? needEl.value : '';
        const msg = $('#cMsg').value.trim();
        const lines = ['Hi Cesar' + (name ? ', this is ' + name : '') + '.'];
        if (need) lines.push('I need help with ' + need + '.');
        if (msg) lines.push(msg);
        const text = lines.join('\n');
        wa.href = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(text);
        em.href = 'mailto:' + email + '?subject=' + encodeURIComponent('Project inquiry' + (need ? ': ' + need : '')) + '&body=' + encodeURIComponent(text);
      };
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      form.addEventListener('submit', e => { e.preventDefault(); wa.click(); });
      update();
    }

    for (const btn of $$('[data-copy]')) {
      btn.addEventListener('click', () => {
        const text = btn.dataset.copy;
        const done = label => { btn.textContent = label; btn.classList.add('ok'); setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('ok'); }, 1600); };
        const fallback = () => {
          const el = document.getElementById(btn.dataset.target);
          if (el && window.getSelection) { const r = document.createRange(); r.selectNodeContents(el); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
          done('Selected');
        };
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done('Copied'), fallback);
          else fallback();
        } catch (err) { fallback(); }
      });
    }
  }

  /* ------------------------------------------------------------ start */
  hero();
  scrollFx();
  tracker();
  scenes();
  counters();
  qr();
  bits();
  fontsReady.then(() => { for (const fn of redrawOnFonts) { try { fn(); } catch (e) { /* ignore */ } } });
  requestAnimationFrame(frame);
})();
