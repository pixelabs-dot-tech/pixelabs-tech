/* ==========================================================================
   Jeetak Rush: a ride through the 24 villages Jeetak delivers to.
   Tap, click or press Space to jump; jump again in mid-air for a double jump.
   ========================================================================== */
(function (factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else if (typeof document !== 'undefined') {
    const go = () => api.mount(document.getElementById('jkGame'));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }
})(function () {
  'use strict';

  /* ------------------------------------------------------------ helpers */
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
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

  /* ------------------------------------------------------------ the villages
     Elevations in metres, from Wikipedia and the NGA GEOnet Names Server
     (via IndexMundi). Qoubbei has no published figure; it sits between
     Saoufar and Chbaniyeh, so it uses an estimate from those two. */
  const ELEV = {
    'Arsoun': 795, 'Bhamdoun': 1150, 'Bmariam': 815, 'Btebyat': 725, 'Btekhnay': 1000, 'Bzebdine': 1027,
    'Chbaniyeh': 860, 'Deir El Harf': 976, 'Dlaibeh': 551, 'Falougha': 1250, 'Hammana': 1200,
    'Jouar El Haouz': 1250, 'Kfar Selouan': 1380, 'Khalwet': 1262, 'Khraybeh': 994, 'Kornayel': 1160,
    'Qalaa': 1132, 'Qortada': 520, 'Qoubbei': 1080, 'Qraiyeh': 1171, 'Qseibe': 595, 'Ras El Maten': 900,
    'Salima': 810, 'Saoufar': 1300
  };
  // A real driving loop through all 24 (shortest tour on their coordinates, about 46 km).
  const ROUTE = ['Btekhnay', 'Btebyat', 'Deir El Harf', 'Arsoun', 'Salima', 'Dlaibeh', 'Qseibe', 'Qortada',
    'Ras El Maten', 'Bhamdoun', 'Qraiyeh', 'Saoufar', 'Qoubbei', 'Chbaniyeh', 'Khraybeh', 'Bmariam', 'Hammana',
    'Qalaa', 'Khalwet', 'Falougha', 'Kfar Selouan', 'Jouar El Haouz', 'Bzebdine', 'Kornayel'];
  // Snow from about 1,100 m and full cover from 1,240 m; low villages look out to the coast.
  const envFor = e => ({ e, snow: smooth(1100, 1240, e), coast: 1 - smooth(600, 720, e), alpine: smooth(980, 1150, e) });

  /* ------------------------------------------------------------ world rules (world units, seconds) */
  const PH = { g: 2300, jump: 780, djump: 700, bounce: 660, buffer: 0.13 };
  const AIR = 2 * PH.jump / PH.g;              // time in the air for one jump
  const FRONT = 99;                            // scooter length
  const WHEEL = [21.8, 88.4];                  // wheel contact points
  const BODY = [6, 94, 4, 58];                 // body box: x0, x1, y0, y1
  const REACH = 78;                            // top of the rider (for pickups)
  const AHEAD = 1900;                          // things appear this far ahead of the scooter
  const SEG = 15;                              // seconds between villages
  const STEP = 1 / 120;
  const HOLE_EDGE = 8;                         // forgiving pothole edges
  const SHRINK = 4;                            // forgiving solid edges
  const KINDS = {
    goat: { w: 52, h: 40 }, snowman: { w: 40, h: 50 }, goats: { w: 112, h: 40 },
    car: { w: 124, h: 46 }, van: { w: 140, h: 58 }, truck: { w: 190, h: 58 }
  };
  const POWERS = ['helmet', 'turbo', 'magnet', 'double'];
  const POWER_TIME = { turbo: 4.5, magnet: 9, double: 10 };

  const play = { a: 330, b: 290, c: 80 };      // speed(t) = a + b(1 - e^(-t/c))
  // difficulty: 0 at the start, 1 after 80 s, then keeps climbing until about 6 minutes
  const diffAt = t => (t <= 80 ? t / 80 : Math.min(2.5, 1 + (t - 80) / 190));
  // how long the jump window is for a pothole, by difficulty (seconds)
  const targetWin = d => 0.42 - 0.15 * Math.min(d, 1) - 0.07 * clamp(d - 1, 0, 1.5);

  // time span y(τ) >= h for one jump from the ground
  function above(h) {
    const disc = PH.jump * PH.jump - 2 * PH.g * h;
    if (disc <= 0) return null;
    const r = Math.sqrt(disc);
    return [(PH.jump - r) / PH.g, (PH.jump + r) / PH.g];
  }
  // When a jump has to start, relative to the moment the hazard's left edge reaches the scooter's nose.
  function windowFor(kind, w, h, T, vx) {
    if (kind === 'hole') {
      return [(FRONT - WHEEL[0] + w - HOLE_EDGE) / T - AIR, (FRONT - WHEEL[1] + HOLE_EDGE) / T];
    }
    const V = T + (vx ? -vx : 0);
    const span = above(h - SHRINK - BODY[2]);
    return [(FRONT - BODY[0] + w - SHRINK) / V - span[1], (FRONT - BODY[1] + SHRINK) / V - span[0]];
  }

  /* ------------------------------------------------------------ simulation */
  class Sim {
    constructor() { this.events = []; this.reset({ mode: 'attract', seed: 1, start: 0 }); }

    reset(o) {
      this.mode = o.mode || 'play';
      this.R = rng(o.seed || 1);
      this.t = 0; this.dist = 0; this.speed = 0; this.baseSpeed = 0; this.alive = true; this.deadT = 0;
      this.attractSpeed = o.speed || 300;
      this.p = { y: 0, vy: 0, prevY: 0, ground: true, jumps: 0, buffer: 0, inv: 0, helmets: this.mode === 'play' ? 1 : 0, landT: 9, airT: 0 };
      this.objs = []; this.gid = 0;
      this.score = 0; this.coins = 0; this.rare = 0; this.villages = 0; this.bonus = 0;
      this.power = { turbo: 0, magnet: 0, double: 0 };
      this.turboK = 0;
      this.route = o.start || 0;                     // index into ROUTE of the current village
      this.envFrom = this.envTo = envFor(ELEV[ROUTE[this.route]]);
      this.envK = 1;
      this.nextSignX = this.travel(0, SEG);
      this.signMade = false;
      // planner
      this.lastWin = this.t + 1.6;                   // the jump window of the last hazard ends here
      this.lastWinLen = 0.3;
      this.lastArrive = 0;
      this.acc = 0; this.sweep = 0;
      this.firstHazard = true;
      this.nextPower = 5 + this.R() * 4;
      this.nextRare = 16 + this.R() * 10;
      this.nextBreather = 22 + this.R() * 8;
      this.lastHazardKind = '';
      this.events.length = 0;
    }

    get village() { return ROUTE[this.route]; }
    get env() {
      const a = this.envFrom, b = this.envTo, k = this.envK;
      return { e: lerp(a.e, b.e, k), snow: lerp(a.snow, b.snow, k), coast: lerp(a.coast, b.coast, k), alpine: lerp(a.alpine, b.alpine, k) };
    }
    get difficulty() { return this.mode === 'play' ? diffAt(this.t) : 0.3; }

    speedAt(t) { return this.mode === 'play' ? play.a + play.b * (1 - Math.exp(-t / play.c)) : this.attractSpeed; }
    // distance travelled between t0 and t1 at the base speed
    travel(t0, t1) {
      if (this.mode !== 'play') return this.attractSpeed * (t1 - t0);
      return (play.a + play.b) * (t1 - t0) + play.b * play.c * (Math.exp(-t1 / play.c) - Math.exp(-t0 / play.c));
    }

    emit(type, data) { const e = data || {}; e.type = type; this.events.push(e); }

    /* --------------------------------------------- input */
    jump() {
      if (!this.alive) return false;
      const p = this.p;
      if (p.ground) {
        p.vy = PH.jump; p.ground = false; p.jumps = 1; p.airT = 0;
        this.emit('jump');
        return true;
      }
      if (p.jumps < 2) {
        p.vy = PH.djump + Math.max(0, p.vy) * 0.35; p.jumps = 2;
        this.emit('djump');
        return true;
      }
      p.buffer = PH.buffer;
      return false;
    }

    /* --------------------------------------------- main step */
    update(dt) {
      this.acc = Math.min(this.acc + dt, STEP * 12);
      while (this.acc >= STEP) { this.acc -= STEP; this.step(STEP); }
    }

    step(h) {
      const p = this.p;
      if (!this.alive) {
        this.deadT += h;
        this.speed *= Math.exp(-h * 3.2);
        this.dist += this.speed * h;
        for (const o of this.objs) if (o.vx) o.x += o.vx * h * 0.25;
        if (!p.ground) { p.vy -= PH.g * h; p.y += p.vy * h; if (p.y <= 0) { p.y = 0; p.vy = 0; p.ground = true; } }
        return;
      }
      this.t += h;
      this.baseSpeed = this.mode === 'play' ? this.speedAt(this.t) : this.attractSpeed;
      this.turboK += ((this.power.turbo > 0 ? 1 : 0) - this.turboK) * Math.min(1, h * 5);
      this.speed = this.baseSpeed * (1 + 0.6 * this.turboK);
      this.dist += this.speed * h;
      if (this.mode === 'play') this.score += this.speed * h / 10;

      // timers
      p.inv = Math.max(0, p.inv - h);
      p.buffer = Math.max(0, p.buffer - h);
      p.landT += h;
      for (const k of ['turbo', 'magnet', 'double']) {
        if (this.power[k] > 0) {
          this.power[k] -= h;
          if (this.power[k] <= 0) {
            this.power[k] = 0;
            this.emit('powerEnd', { power: k });
            if (k === 'turbo') this.afterTurbo();
          }
        }
      }
      if (this.envK < 1) this.envK = Math.min(1, this.envK + h / 2.4);

      // scooter
      p.prevY = p.y;
      if (!p.ground) {
        p.airT += h;
        p.vy -= PH.g * h;
        p.y += p.vy * h;
        if (p.y <= 0) {
          p.y = 0; p.vy = 0; p.ground = true; p.jumps = 0; p.landT = 0;
          this.emit('land');
          if (p.buffer > 0) { p.buffer = 0; this.jump(); }
        }
      }

      // world
      for (const o of this.objs) if (o.vx) o.x += o.vx * h;
      this.plan();
      this.signs();
      this.collide();
      this.warnings();
      if (++this.sweep >= 30) {
        this.sweep = 0;
        const cut = this.dist - 400;
        this.objs = this.objs.filter(o => o.x + (o.w || 0) >= cut);
      }
    }

    /* --------------------------------------------- villages */
    signs() {
      if (!this.signMade && this.nextSignX - this.dist < AHEAD + 300) {
        const next = (this.route + 1) % ROUTE.length;
        this.objs.push({ kind: 'sign', x: this.nextSignX, w: 0, v: ROUTE[next], route: next });
        this.signMade = true;
      }
      for (const o of this.objs) {
        if (o.kind !== 'sign' || o.passed || this.dist + FRONT * 0.6 < o.x) continue;
        o.passed = true;
        this.route = o.route;
        this.envFrom = this.env; this.envTo = envFor(ELEV[o.v]); this.envK = 0;
        this.nextSignX = o.x + this.travel(this.t, this.t + SEG);
        this.signMade = false;
        if (this.mode === 'play') { this.villages += 1; this.addScore(100, o.x, 120, 'village'); }
        this.emit('village', { name: o.v, elev: ELEV[o.v] });
      }
    }

    addScore(n, x, y, why) {
      this.bonus += n; this.score += n;
      this.emit('points', { n, x, y, why });
    }

    /* --------------------------------------------- planning hazards, coins and power-ups */
    worldX(at) { return this.dist + FRONT + this.travel(this.t, at); }
    envAt(x) { return x >= this.nextSignX ? envFor(ELEV[ROUTE[(this.route + 1) % ROUTE.length]]) : this.envTo; }

    plan() {
      if (this.power.turbo > 0) { this.planRush(); return; }
      const T = this.baseSpeed;
      let guard = 0;
      while (this.lastArrive - this.t < AHEAD / T + 0.6 && guard++ < 4) this.planHazard();
    }

    pickKind(d, env) {
      const snow = env.snow > 0.55;
      const W = [
        ['hole', 1.0],
        ['manhole', d >= 0.04 ? 0.45 : 0],
        [snow ? 'snowman' : 'goat', d >= 0.1 ? 0.55 : 0],
        ['holes', d >= 0.25 ? 0.4 : 0],
        ['car', d >= 0.18 ? 0.2 + 0.5 * Math.min(d, 1) : 0],
        ['van', d >= 0.5 ? 0.3 * Math.min(d, 1) : 0],
        ['goats', d >= 0.6 && !snow ? 0.25 : 0],
        ['truck', d >= 1.05 ? 0.12 + 0.1 * (d - 1) : 0]
      ];
      if (this.mode !== 'play') { W[4][1] = 0.25; W[5][1] = 0; W[6][1] = 0; W[3][1] = 0; W[7][1] = 0; }
      let sum = 0;
      for (const w of W) { if (w[0] === this.lastHazardKind && (w[0] === 'car' || w[0] === 'van' || w[0] === 'truck')) w[1] *= 0.35; sum += w[1]; }
      let r = this.R() * sum;
      for (const w of W) { r -= w[1]; if (r <= 0) return w[0]; }
      return 'hole';
    }

    planHazard() {
      const R = this.R;
      const guessAt = this.firstHazard ? this.t + 2.4 : this.lastWin + AIR + 0.6;
      const d = this.mode === 'play' ? diffAt(guessAt) : 0.3;
      const dd = Math.min(1, d);
      const T = this.speedAt(guessAt);
      const env = this.envAt(this.worldX(guessAt));
      const kind = this.pickKind(d, env);
      const H = { kind, parts: [], vx: 0 };
      const win0 = targetWin(d) * (0.85 + R() * 0.4);
      if (kind === 'hole') {
        const w = clamp(T * (AIR - win0) - 50.6, 30, 220 + 40 * clamp(d - 1.5, 0, 1));
        H.parts.push({ kind: 'hole', dx: 0, w, deco: 'pothole' });
        H.w = w; H.h = 0;
      } else if (kind === 'manhole') {
        const w = 56 + R() * 10;
        H.parts.push({ kind: 'hole', dx: 0, w, deco: 'manhole', item: ['branch', 'tire', 'cone'][Math.floor(R() * 3)] });
        H.w = w; H.h = 0;
      } else if (kind === 'holes') {
        const W = clamp(T * (AIR - win0 * 1.05) - 50.6, 96, 220 + 40 * clamp(d - 1.5, 0, 1));
        const w1 = W * (0.3 + R() * 0.1), w2 = W * (0.3 + R() * 0.1), gap = W - w1 - w2;
        H.parts.push({ kind: 'hole', dx: 0, w: w1, deco: 'pothole' }, { kind: 'hole', dx: w1 + gap, w: w2, deco: 'pothole' });
        H.w = w1 + gap + w2; H.h = 0;
      } else {
        const g = KINDS[kind];
        H.w = g.w; H.h = g.h;
        if (kind === 'car' || kind === 'van' || kind === 'truck') H.vx = -(110 + 170 * Math.min(d, 1.2) + R() * 30);
        H.parts.push({ kind, dx: 0, w: g.w, h: g.h, tint: Math.floor(R() * 5), taxi: R() < 0.35 });
      }
      const holey = H.parts[0].kind === 'hole';
      const off = windowFor(holey ? 'hole' : 'solid', H.w, H.h, T, H.vx);
      const win = off[1] - off[0];

      // spacing: the gap between landing from the last hazard (at its latest jump) and this one's earliest jump
      let s;
      if (this.firstHazard) s = 0;
      else {
        const over = clamp(d - 1, 0, 1);
        const sMin = this.mode === 'play' ? lerp(0.32, -0.12, dd) - 0.06 * over : 0.5;
        const sMax = this.mode === 'play' ? lerp(1.6, 0.5, dd) - 0.12 * over : 1.8;
        s = sMin + (sMax - sMin) * Math.pow(R(), 1.35);
        s = Math.max(s, 0.14 - this.lastWinLen - win, -0.24);
        if (this.mode === 'play' && this.t + 4 > this.nextBreather) { s += 1.3; this.nextBreather = this.t + 20 + R() * 10; H.breather = true; }
      }
      const prevEnd = this.lastWin + AIR;              // latest landing after the previous hazard
      const arrive = this.firstHazard ? Math.max(this.t + 2.4, this.t + 0.9 - off[0]) : prevEnd + s - off[0];
      this.firstHazard = false;
      const g = ++this.gid;
      const x = this.worldX(arrive) + (H.vx ? -H.vx * (arrive - this.t) : 0);
      for (const part of H.parts) {
        const o = Object.assign({}, part, { x: x + part.dx, g, vx: H.vx, h: part.h || 0 });
        delete o.dx;
        this.objs.push(o);
      }
      const gapStart = prevEnd, gapEnd = arrive + off[0];

      // what fills the gap before this hazard
      if (this.mode === 'play') this.fillGap(gapStart, gapEnd, T);
      // a coin arc over the hazard, following a well-timed jump
      if (R() < (H.vx ? 0.3 : 0.42)) this.coinArc(arrive + (off[0] + off[1]) / 2, H);
      // a rare Phoenician coin high above a car
      if (this.mode === 'play' && H.vx && this.t > this.nextRare - 6 && R() < 0.6) {
        this.nextRare = this.t + 18 + R() * 12;
        const at = arrive + (off[0] + off[1]) / 2 + AIR * 0.5;
        this.objs.push({ kind: 'rare', x: this.worldX(at) + 50, y: 205, r: 15 });
      }
      this.lastWin = arrive + off[1];
      this.lastWinLen = win;
      this.lastArrive = arrive;
      this.lastHazardKind = kind;
    }

    coinArc(j, H) {
      const n = 5;
      for (let k = 0; k < n; k++) {
        const tau = AIR * (0.12 + 0.76 * k / (n - 1));
        const y = PH.jump * tau - PH.g / 2 * tau * tau + 32;
        this.objs.push({ kind: 'coin', x: this.worldX(j + tau) + 50, y, r: 12 });
      }
    }

    fillGap(t0, t1, T) {
      const span = t1 - t0;
      const R = this.R;
      if (span > 0.55 && this.t > this.nextPower - 4) {
        // power-up in the middle of the gap: at hop height when there is room for a hop, else on the road
        this.nextPower = this.t + 13 + R() * 6;
        const kind = this.pickPower();
        const y = span > AIR + 0.25 && R() < 0.65 ? 70 + R() * 40 : 34;
        this.objs.push({ kind: 'power', power: kind, x: this.worldX((t0 + t1) / 2) + 50, y, r: 18 });
        return;
      }
      if (span > 1.3 && this.mode === 'play' && this.t > this.nextRare && R() < 0.6) {
        // rare coin only a double jump reaches
        this.nextRare = this.t + 18 + R() * 12;
        this.objs.push({ kind: 'rare', x: this.worldX((t0 + t1) / 2) + 50, y: 245 + R() * 30, r: 15 });
        return;
      }
      if (span > 0.45 && R() < 0.5) {
        // a line of coins on the road
        const n = Math.min(6, Math.floor(span * 5));
        const a = t0 + 0.08, b = t1 - 0.08;
        for (let k = 0; k < n; k++) {
          const at = n === 1 ? (a + b) / 2 : a + (b - a) * k / (n - 1);
          this.objs.push({ kind: 'coin', x: this.worldX(at) + 50, y: 26, r: 12 });
        }
      }
    }

    pickPower() {
      const R = this.R, p = this.p;
      const W = [
        ['helmet', p.helmets === 0 ? 3 : p.helmets === 1 ? 1.4 : p.helmets === 2 ? 0.6 : 0.2],
        ['turbo', 1.1], ['magnet', 1.2], ['double', 1.0]
      ];
      let sum = 0; for (const w of W) sum += w[1];
      let r = R() * sum;
      for (const w of W) { r -= w[1]; if (r <= 0) return w[0]; }
      return 'magnet';
    }

    planRush() {
      // during turbo: no hazards, just a stream of coins
      const ahead = this.dist + AHEAD;
      if (!this.rushX || this.rushX < this.dist) this.rushX = this.dist + 600;
      while (this.rushX < ahead) {
        const y = 26 + 60 * (0.5 + 0.5 * Math.sin(this.rushX / 160));
        this.objs.push({ kind: 'coin', x: this.rushX, y, r: 12 });
        this.rushX += 74;
      }
    }

    afterTurbo() {
      this.p.inv = Math.max(this.p.inv, 1.1);
      this.rushX = 0;
      this.lastWin = this.t + 1.2;
      this.lastWinLen = 0.3;
      this.lastArrive = this.t;
    }

    startTurbo() {
      // clear the road ahead
      for (const o of this.objs) {
        if ((o.kind === 'hole' || KINDS[o.kind]) && o.x + o.w > this.dist - 10 && !o.gone) {
          o.gone = true;
          if (o.x - this.dist < 1600) this.emit('poof', { x: o.x + o.w / 2, y: (o.h || 0) / 2, kind: o.kind });
        }
      }
      this.objs = this.objs.filter(o => !o.gone);
      this.lastArrive = this.t + 99;
      this.rushX = 0;
    }

    /* --------------------------------------------- collisions */
    collide() {
      const p = this.p, px = this.dist;
      const bx0 = px + BODY[0], bx1 = px + BODY[1], by0 = p.y + BODY[2], by1 = p.y + BODY[3];
      const pull = this.power.magnet > 0 || this.power.turbo > 0;
      for (const o of this.objs) {
        if (o.done) continue;
        if (o.kind === 'hole') {
          if (!p.ground) continue;
          const a = o.x + HOLE_EDGE, b = o.x + o.w - HOLE_EDGE;
          for (const w of WHEEL) { const wx = px + w; if (wx > a && wx < b) { this.hit(o); break; } }
        } else if (KINDS[o.kind]) {
          const ox0 = o.x + SHRINK, ox1 = o.x + o.w - SHRINK, top = o.h - SHRINK;
          if (bx1 > ox0 && bx0 < ox1 && by0 < top) {
            if (p.vy <= 0 && p.prevY + BODY[2] >= top - 8) this.bounceOff(o, top);
            else this.hit(o);
          }
        } else if (o.kind === 'coin' || o.kind === 'rare' || o.kind === 'power') {
          if (pull && o.kind !== 'power') {
            const cx = px + 50, cy = p.y + 36, dx = cx - o.x, dy = cy - o.y, dd = Math.hypot(dx, dy);
            if (dd < 300 && o.x > px - 60) {
              const k = Math.min(1, STEP * (8 + 1400 / Math.max(40, dd)));
              o.x += dx * k; o.y += dy * k; o.pulled = true;
            }
          }
          const r = o.r + 4;
          if (o.x + r > bx0 && o.x - r < bx1 && o.y + r > p.y && o.y - r < p.y + REACH) this.take(o);
        }
      }
    }

    take(o) {
      o.done = true;
      const dbl = this.power.double > 0 ? 2 : 1;
      if (o.kind === 'coin') {
        this.coins += 1;
        if (this.mode === 'play') this.addScore(10 * dbl, o.x, o.y, 'coin');
        this.emit('coin', { x: o.x, y: o.y });
      } else if (o.kind === 'rare') {
        this.rare += 1;
        if (this.mode === 'play') this.addScore(150 * dbl, o.x, o.y, 'rare');
        this.emit('rare', { x: o.x, y: o.y });
      } else if (o.kind === 'power') {
        const k = o.power;
        if (k === 'helmet') {
          if (this.p.helmets < 3) this.p.helmets += 1;
          else if (this.mode === 'play') this.addScore(250, o.x, o.y, 'helmet');
        } else {
          this.power[k] = POWER_TIME[k];
          if (k === 'turbo') this.startTurbo();
        }
        this.emit('power', { power: k, x: o.x, y: o.y });
      }
    }

    bounceOff(o, top) {
      const p = this.p;
      p.y = top - BODY[2]; p.vy = PH.bounce; p.jumps = 1; p.ground = false;
      o.bumped = this.t;
      if (this.mode === 'play') this.addScore(o.kind === 'car' || o.kind === 'van' ? 50 : 30, o.x + o.w / 2, top + 20, 'bounce');
      this.emit('bounce', { kind: o.kind, x: o.x + o.w / 2, y: top });
    }

    hit(o) {
      const p = this.p;
      if (p.inv > 0 || this.mode !== 'play') { if (this.mode !== 'play') o.done = true; return; }
      o.done = true;
      if (p.helmets > 0) {
        p.helmets -= 1;
        p.inv = 1.6;
        this.emit('helmetLost', { kind: o.kind, x: o.x });
        return;
      }
      this.alive = false;
      this.deadT = 0;
      this.crashKind = o.kind;
      this.emit('crash', { kind: o.kind, village: this.village });
    }

    /* --------------------------------------------- oncoming traffic warning */
    warnings() {
      for (const o of this.objs) {
        if (!o.vx || o.done || o.warnAt !== undefined) continue;
        const rel = this.speed - o.vx;
        const eta = (o.x - (this.dist + FRONT)) / rel;
        if (eta < 2.6) { o.warnAt = this.t; this.emit('honk', { kind: o.kind }); }
      }
    }

    /* --------------------------------------------- final stats */
    stats() {
      return { score: Math.floor(this.score), coins: this.coins, rare: this.rare, villages: this.villages, village: this.village, time: this.t };
    }
  }

  /* ------------------------------------------------------------ autopilot (attract mode, tests) */
  function liveWindow(sim, o) {
    const T = sim.speed;
    if (o.kind === 'hole') {
      const arrive = sim.t + (o.x - (sim.dist + FRONT)) / T;
      const off = windowFor('hole', o.w, 0, T, 0);
      return [arrive + off[0], arrive + off[1]];
    }
    const V = T - (o.vx || 0);
    const arrive = sim.t + (o.x - (sim.dist + FRONT)) / V;
    const off = windowFor('solid', o.w, o.h, T, o.vx);
    return [arrive + off[0], arrive + off[1]];
  }
  function autopilot(sim, jitter) {
    if (!sim.alive) return;
    const groups = new Map();
    for (const o of sim.objs) {
      if (o.done || !(o.kind === 'hole' || KINDS[o.kind])) continue;
      if (o.x + o.w < sim.dist) continue;
      const w = liveWindow(sim, o);
      if (w[1] < sim.t - 0.02) continue;
      const g = groups.get(o.g);
      if (g) { g.w[0] = Math.max(g.w[0], w[0]); g.w[1] = Math.min(g.w[1], w[1]); }
      else groups.set(o.g, { w, o });
    }
    let best = null;
    for (const g of groups.values()) if (!best || g.w[0] < best.w[0]) best = g;
    if (!best) return;
    const o = best.o;
    if (o.botJ === undefined) o.botJ = jitter ? jitter() : 0;
    const target = (best.w[0] + best.w[1]) / 2 + o.botJ;
    if (sim.p.ground && sim.t >= target) sim.jump();
  }

  /* ===================================================================== colours */
  const hex = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const rgb = (c, a) => (a === undefined
    ? 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'
    : 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a.toFixed(3) + ')');
  const hexAll = o => { const r = {}; for (const k in o) r[k] = typeof o[k] === 'string' ? hex(o[k]) : o[k]; return r; };

  const BRAND = hexAll({ cream: '#FFFAE6', stone: '#EFE3C4', ink: '#15271E', pine: '#1D3D2F', deep: '#10241B', orange: '#E23C0E', lit: '#FF7A45', glow: '#FFD88A', warm: '#FFA064' });

  // sky through a day; p = 0 golden hour, 0.09 sunset, 0.27 to 0.55 night, 0.64 dawn, 0.82 midday
  const SKY = [
    { p: 0.00, top: '#4C7D8E', mid: '#DDAA73', bot: '#F7C98C', dark: 0.12, warm: 0.8, sun: 0.24, moon: 0, stars: 0 },
    { p: 0.09, top: '#2E4463', mid: '#B4637A', bot: '#F28D5C', dark: 0.34, warm: 1, sun: 0.03, moon: 0, stars: 0.05 },
    { p: 0.18, top: '#15283C', mid: '#2C465C', bot: '#6F5872', dark: 0.74, warm: 0.3, sun: -0.3, moon: 0.5, stars: 0.55 },
    { p: 0.27, top: '#0B1A14', mid: '#122A20', bot: '#1F4132', dark: 1, warm: 0, sun: -1, moon: 1, stars: 1 },
    { p: 0.55, top: '#0B1A14', mid: '#122A20', bot: '#1F4132', dark: 1, warm: 0, sun: -1, moon: 1, stars: 1 },
    { p: 0.64, top: '#20374F', mid: '#7C7096', bot: '#F0AA8F', dark: 0.55, warm: 0.65, sun: 0.0, moon: 0.25, stars: 0.2 },
    { p: 0.73, top: '#5D9BB6', mid: '#B9D4CE', bot: '#F5DDBA', dark: 0.12, warm: 0.3, sun: 0.35, moon: 0, stars: 0 },
    { p: 0.82, top: '#73B1C4', mid: '#BEDCD4', bot: '#F2EAD0', dark: 0, warm: 0, sun: 0.7, moon: 0, stars: 0 },
    { p: 0.92, top: '#6BA5BA', mid: '#CBDBC9', bot: '#F4E2BD', dark: 0.03, warm: 0.22, sun: 0.5, moon: 0, stars: 0 },
    { p: 1.00, top: '#4C7D8E', mid: '#DDAA73', bot: '#F7C98C', dark: 0.12, warm: 0.8, sun: 0.24, moon: 0, stars: 0 }
  ].map(hexAll);
  const SKY_KEYS = ['dark', 'warm', 'sun', 'moon', 'stars'];
  function mixSky(a, b, k) {
    const o = { top: mixc(a.top, b.top, k), mid: mixc(a.mid, b.mid, k), bot: mixc(a.bot, b.bot, k) };
    for (const key of SKY_KEYS) o[key] = lerp(a[key], b[key], k);
    return o;
  }
  function skyAt(p) {
    p = ((p % 1) + 1) % 1;
    let i = 0;
    while (i < SKY.length - 2 && SKY[i + 1].p < p) i++;
    const a = SKY[i], b = SKY[i + 1];
    return mixSky(a, b, smooth(0, 1, (p - a.p) / (b.p - a.p)));
  }

  // land colours by zone, for full daylight and for night
  const LAND = {
    pine: hexAll({ far: '#6F99A0', cap: '#F1F5F4', mid: '#4D7B57', near: '#2F5C3F', tree: '#1E472F', ground: '#567B3D', fg: '#3C6230', road: '#3F4645', wall: '#E7DABE', roof: '#B5533A', trunk: '#5A4030' }),
    coast: hexAll({ far: '#8AAAB5', cap: '#F1F5F4', mid: '#7F9058', near: '#5F7445', tree: '#4A5E32', ground: '#8E8D50', fg: '#707A3D', road: '#444A47', wall: '#EADCC0', roof: '#B9573C', trunk: '#6A5038' }),
    snow: hexAll({ far: '#C8D7E1', cap: '#FFFFFF', mid: '#DCE6EC', near: '#EEF3F6', tree: '#2C4A42', ground: '#F4F7F9', fg: '#E3EBF0', road: '#4B5254', wall: '#E5DCC8', roof: '#F2F5F7', trunk: '#4E3B2E' })
  };
  const NIGHT = {
    pine: hexAll({ far: '#2B4A40', cap: '#7F978F', mid: '#21423A', near: '#173327', tree: '#0E251A', ground: '#183024', fg: '#0F2319', road: '#0F2219', wall: '#2E3E36', roof: '#3A2721', trunk: '#1C1712' }),
    coast: hexAll({ far: '#2C474C', cap: '#7F978F', mid: '#283F32', near: '#1C3325', tree: '#12261A', ground: '#203527', fg: '#15271C', road: '#11241B', wall: '#33413A', roof: '#3D2A23', trunk: '#1E1913' }),
    snow: hexAll({ far: '#5B7285', cap: '#AFC2D0', mid: '#7A90A3', near: '#91A6B7', tree: '#14302A', ground: '#A1B4C4', fg: '#8AA0B2', road: '#1B2B2A', wall: '#3B4A48', roof: '#B5C6D3', trunk: '#17130F' })
  };
  function landPal(env, sk) {
    const o = {};
    const warm = sk.warm * 0.14 * (1 - sk.dark * 0.6);
    for (const k in LAND.pine) {
      const d = mixc(mixc(LAND.pine[k], LAND.coast[k], env.coast), LAND.snow[k], env.snow);
      const n = mixc(mixc(NIGHT.pine[k], NIGHT.coast[k], env.coast), NIGHT.snow[k], env.snow);
      o[k] = mixc(mixc(d, n, sk.dark), BRAND.warm, warm);
    }
    o.farHaze = mixc(o.far, sk.bot, 0.38 * (1 - sk.dark * 0.5));
    o.capHaze = mixc(o.cap, sk.bot, 0.3 * (1 - sk.dark * 0.4));
    o.midHaze = mixc(o.mid, sk.bot, 0.16);
    return o;
  }

  /* ===================================================================== drawing helpers */
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
  const ridge = (x, seed, f) => 0.55 * Math.sin(x * f + seed) + 0.3 * Math.sin(x * f * 2.3 + seed * 1.7) + 0.15 * Math.sin(x * f * 5.1 + seed * 3.1);
  // 0..1, with sharp summits: the Mount Lebanon range in the distance
  const peaks = x => {
    const a = 1 - Math.abs(Math.sin(x * 0.0019 + 0.7)), b = 1 - Math.abs(Math.sin(x * 0.0043 + 2.1)), c = 1 - Math.abs(Math.sin(x * 0.0097 + 4.4));
    return 0.58 * a * a + 0.3 * b * b * b + 0.12 * c;
  };

  // trees, drawn as silhouettes; (x, y) is the foot of the trunk, z the height in px
  function fir(ctx, x, y, z) {
    ctx.beginPath();
    ctx.moveTo(x, y - z);
    ctx.lineTo(x + z * 0.2, y - z * 0.62); ctx.lineTo(x + z * 0.11, y - z * 0.62);
    ctx.lineTo(x + z * 0.3, y - z * 0.32); ctx.lineTo(x + z * 0.16, y - z * 0.32);
    ctx.lineTo(x + z * 0.36, y - z * 0.1); ctx.lineTo(x - z * 0.36, y - z * 0.1);
    ctx.lineTo(x - z * 0.16, y - z * 0.32); ctx.lineTo(x - z * 0.3, y - z * 0.32);
    ctx.lineTo(x - z * 0.11, y - z * 0.62); ctx.lineTo(x - z * 0.2, y - z * 0.62);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(x - z * 0.035, y - z * 0.12, z * 0.07, z * 0.12);
  }
  function firSnow(ctx, x, y, z) {
    ctx.beginPath();
    ctx.moveTo(x, y - z); ctx.lineTo(x + z * 0.12, y - z * 0.78); ctx.lineTo(x - z * 0.12, y - z * 0.78); ctx.closePath();
    ctx.moveTo(x - z * 0.2, y - z * 0.6); ctx.lineTo(x + z * 0.2, y - z * 0.6); ctx.lineTo(x + z * 0.1, y - z * 0.54); ctx.lineTo(x - z * 0.1, y - z * 0.54); ctx.closePath();
    ctx.moveTo(x - z * 0.3, y - z * 0.31); ctx.lineTo(x + z * 0.3, y - z * 0.31); ctx.lineTo(x + z * 0.18, y - z * 0.25); ctx.lineTo(x - z * 0.18, y - z * 0.25); ctx.closePath();
    ctx.fill();
  }
  function umbrella(ctx, x, y, z, lean) { // stone pine
    const tx = x + lean * z * 0.18;
    ctx.beginPath();
    ctx.moveTo(x - z * 0.03, y); ctx.quadraticCurveTo(x + lean * z * 0.05, y - z * 0.4, tx - z * 0.02, y - z * 0.72);
    ctx.lineTo(tx + z * 0.03, y - z * 0.72); ctx.quadraticCurveTo(x + lean * z * 0.1, y - z * 0.4, x + z * 0.04, y);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.ellipse(tx, y - z * 0.8, z * 0.42, z * 0.15, 0, 0, TAU);
    ctx.ellipse(tx - z * 0.2, y - z * 0.86, z * 0.22, z * 0.12, 0, 0, TAU);
    ctx.ellipse(tx + z * 0.18, y - z * 0.88, z * 0.24, z * 0.12, 0, 0, TAU);
    ctx.fill();
  }
  function umbrellaSnow(ctx, x, y, z, lean) {
    const tx = x + lean * z * 0.18;
    ctx.beginPath();
    ctx.ellipse(tx - z * 0.18, y - z * 0.93, z * 0.2, z * 0.05, 0, 0, TAU);
    ctx.ellipse(tx + z * 0.18, y - z * 0.95, z * 0.2, z * 0.05, 0, 0, TAU);
    ctx.ellipse(tx, y - z * 0.89, z * 0.36, z * 0.05, 0, 0, TAU);
    ctx.fill();
  }
  function cypress(ctx, x, y, z) {
    ctx.beginPath();
    ctx.moveTo(x, y - z);
    ctx.bezierCurveTo(x + z * 0.13, y - z * 0.75, x + z * 0.12, y - z * 0.2, x + z * 0.04, y - z * 0.04);
    ctx.lineTo(x - z * 0.04, y - z * 0.04);
    ctx.bezierCurveTo(x - z * 0.12, y - z * 0.2, x - z * 0.13, y - z * 0.75, x, y - z);
    ctx.fill();
    ctx.fillRect(x - z * 0.02, y - z * 0.06, z * 0.04, z * 0.06);
  }
  function olive(ctx, x, y, z) {
    ctx.beginPath();
    ctx.moveTo(x - z * 0.06, y); ctx.lineTo(x - z * 0.03, y - z * 0.4); ctx.lineTo(x + z * 0.03, y - z * 0.4); ctx.lineTo(x + z * 0.07, y);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y - z * 0.56, z * 0.36, z * 0.22, 0, 0, TAU);
    ctx.ellipse(x - z * 0.24, y - z * 0.5, z * 0.2, z * 0.15, 0, 0, TAU);
    ctx.ellipse(x + z * 0.24, y - z * 0.52, z * 0.2, z * 0.16, 0, 0, TAU);
    ctx.ellipse(x + z * 0.05, y - z * 0.74, z * 0.22, z * 0.14, 0, 0, TAU);
    ctx.fill();
  }
  // which tree grows here, by elevation
  function treeKind(env, h1, h2) {
    if (h1 < env.coast * 0.9) return h2 < 0.55 ? 'olive' : 'cypress';
    if (h2 < 0.15 + env.alpine * 0.8 || env.snow > 0.5) return 'fir';
    return 'umbrella';
  }
  function tree(ctx, kind, x, y, z, lean, snowA, snowC, col) {
    ctx.fillStyle = col;
    if (kind === 'fir') fir(ctx, x, y, z);
    else if (kind === 'umbrella') umbrella(ctx, x, y, z, lean);
    else if (kind === 'cypress') cypress(ctx, x, y, z * 1.1);
    else olive(ctx, x, y, z * 0.7);
    if (snowA > 0.04 && (kind === 'fir' || kind === 'umbrella')) {
      ctx.globalAlpha = snowA; ctx.fillStyle = snowC;
      if (kind === 'fir') firSnow(ctx, x, y, z); else umbrellaSnow(ctx, x, y, z, lean);
      ctx.globalAlpha = 1;
    }
  }

  // a stone house with a red tile roof and the classic triple arched window
  function house(ctx, x, y, w, h, P, lit, snow, big) {
    const roofH = h * 0.42;
    ctx.fillStyle = rgb(P.wall);
    ctx.fillRect(x, y - h, w, h);
    ctx.fillStyle = rgb(mixc(P.roof, [245, 248, 250], snow * 0.9));
    ctx.beginPath(); ctx.moveTo(x - w * 0.08, y - h); ctx.lineTo(x + w * 0.22, y - h - roofH); ctx.lineTo(x + w * 0.78, y - h - roofH); ctx.lineTo(x + w * 1.08, y - h); ctx.closePath(); ctx.fill();
    const win = lit > 0.05 ? rgb(mixc([70, 58, 46], BRAND.glow, lit)) : 'rgb(70,58,46)';
    ctx.fillStyle = win;
    if (big) {
      const ww = w * 0.12, wh = h * 0.42, wy = y - h * 0.78;
      for (let i = 0; i < 3; i++) {
        const wx = x + w * 0.3 + i * w * 0.15;
        ctx.beginPath(); ctx.moveTo(wx, wy + wh); ctx.lineTo(wx, wy + ww * 0.5); ctx.arc(wx + ww / 2, wy + ww * 0.5, ww / 2, Math.PI, 0); ctx.lineTo(wx + ww, wy + wh); ctx.closePath(); ctx.fill();
      }
      ctx.fillRect(x + w * 0.1, y - h * 0.62, w * 0.1, h * 0.3);
      ctx.fillRect(x + w * 0.8, y - h * 0.62, w * 0.1, h * 0.3);
    } else {
      ctx.fillRect(x + w * 0.2, y - h * 0.65, w * 0.18, h * 0.3);
      ctx.fillRect(x + w * 0.6, y - h * 0.65, w * 0.18, h * 0.3);
    }
    if (lit > 0.3) {
      ctx.globalAlpha = (lit - 0.3) * 0.5;
      ctx.fillStyle = 'rgba(255,216,138,.45)';
      ctx.beginPath(); ctx.ellipse(x + w / 2, y - h * 0.5, w * 0.7, h * 0.55, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // the Lebanese cedar, as on the old lira coins and the flag
  function cedar(ctx, x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    const tiers = [[0.28, -0.62], [0.5, -0.3], [0.72, 0.02], [0.9, 0.34]];
    for (const [w, ty] of tiers) { ctx.lineTo(x + r * w, y + r * ty); ctx.lineTo(x + r * w * 0.45, y + r * (ty - 0.04)); }
    ctx.lineTo(x + r * 0.12, y + r * 0.34); ctx.lineTo(x + r * 0.12, y + r * 0.62); ctx.lineTo(x - r * 0.12, y + r * 0.62); ctx.lineTo(x - r * 0.12, y + r * 0.34);
    for (let i = tiers.length - 1; i >= 0; i--) { const [w, ty] = tiers[i]; ctx.lineTo(x - r * w * 0.45, y + r * (ty - 0.04)); ctx.lineTo(x - r * w, y + r * ty); }
    ctx.closePath(); ctx.fill();
  }
  function liraCoin(ctx, x, y, r, spin) {
    const c = Math.cos(spin), sx = Math.max(0.14, Math.abs(c));
    ctx.save(); ctx.translate(x, y); ctx.scale(sx, 1);
    ctx.fillStyle = '#8A5D17'; ctx.beginPath(); ctx.arc(c > 0 ? -r * 0.12 : r * 0.12, 0, r, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#FFF0B8'); g.addColorStop(0.45, '#E9BE58'); g.addColorStop(1, '#B07F25');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 0.94, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(122,82,18,.75)'; ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath(); ctx.arc(0, 0, r * 0.74, 0, TAU); ctx.stroke();
    if (sx > 0.42) { ctx.fillStyle = 'rgba(120,80,16,.9)'; cedar(ctx, 0, -r * 0.04, r * 0.52); }
    ctx.restore();
  }
  function phoenicianCoin(ctx, x, y, r, t, glow) {
    if (glow) {
      const g = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 2.4);
      g.addColorStop(0, 'rgba(160,60,190,.55)'); g.addColorStop(1, 'rgba(120,40,150,0)');
      ctx.fillStyle = g; ctx.fillRect(x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
    }
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 1.7) * 0.25);
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * TAU, rr = r * (0.9 + 0.1 * hash(i * 3.7));
      if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    const g2 = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
    g2.addColorStop(0, '#FFFFFF'); g2.addColorStop(0.5, '#C9D1D8'); g2.addColorStop(1, '#7D8790');
    ctx.fillStyle = g2; ctx.fill();
    ctx.strokeStyle = '#5E6870'; ctx.lineWidth = Math.max(1, r * 0.08); ctx.lineCap = 'round';
    // a Phoenician galley: hull, mast, square sail and oars
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, r * 0.12); ctx.quadraticCurveTo(0, r * 0.45, r * 0.62, r * 0.1);
    ctx.moveTo(-r * 0.62, r * 0.12); ctx.lineTo(-r * 0.72, -r * 0.08);
    ctx.moveTo(r * 0.62, r * 0.1); ctx.quadraticCurveTo(r * 0.8, -r * 0.05, r * 0.7, -r * 0.2);
    ctx.moveTo(0, r * 0.18); ctx.lineTo(0, -r * 0.58);
    for (let i = -2; i <= 2; i++) { ctx.moveTo(i * r * 0.18, r * 0.26); ctx.lineTo(i * r * 0.18 - r * 0.1, r * 0.5); }
    ctx.stroke();
    ctx.fillStyle = '#6E7881';
    ctx.fillRect(-r * 0.3, -r * 0.55, r * 0.6, r * 0.42);
    ctx.restore();
    // sparkle
    const k = (t * 1.3) % 1;
    if (k < 0.5) {
      const a = Math.sin(k / 0.5 * Math.PI), sx = x + r * 0.55, sy = y - r * 0.55, q = r * 0.55 * a;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * a).toFixed(2) + ')';
      ctx.beginPath(); ctx.moveTo(sx, sy - q); ctx.lineTo(sx + q * 0.22, sy); ctx.lineTo(sx, sy + q); ctx.lineTo(sx - q * 0.22, sy); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(sx - q, sy); ctx.lineTo(sx, sy + q * 0.22); ctx.lineTo(sx + q, sy); ctx.lineTo(sx, sy - q * 0.22); ctx.closePath(); ctx.fill();
    }
  }
  const POWER_COL = { helmet: '#FFD88A', turbo: '#FF7A45', magnet: '#7FD3FF', double: '#FFE27A' };
  function helmetIcon(ctx, x, y, r, dark) {
    ctx.fillStyle = '#FFFAE6';
    ctx.beginPath(); ctx.moveTo(x - r, y + r * 0.45); ctx.bezierCurveTo(x - r * 1.05, y - r * 0.9, x + r * 0.9, y - r * 1.05, x + r, y + r * 0.45); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#E23C0E';
    ctx.beginPath(); ctx.moveTo(x - r * 0.82, y - r * 0.05); ctx.bezierCurveTo(x - r * 0.6, y - r * 0.75, x + r * 0.35, y - r * 0.85, x + r * 0.62, y - r * 0.5); ctx.lineTo(x + r * 0.5, y - r * 0.3); ctx.bezierCurveTo(x + r * 0.2, y - r * 0.6, x - r * 0.45, y - r * 0.5, x - r * 0.62, y + r * 0.05); ctx.closePath(); ctx.fill();
    ctx.fillStyle = dark || '#173229';
    ctx.beginPath(); ctx.moveTo(x + r * 0.25, y - r * 0.1); ctx.lineTo(x + r * 1.05, y + r * 0.02); ctx.lineTo(x + r * 0.98, y + r * 0.45); ctx.lineTo(x + r * 0.2, y + r * 0.4); ctx.closePath(); ctx.fill();
  }
  function powerIcon(ctx, kind, x, y, r) {
    if (kind === 'helmet') { helmetIcon(ctx, x - r * 0.08, y + r * 0.08, r * 0.62); return; }
    if (kind === 'turbo') {
      ctx.fillStyle = '#FFB547';
      ctx.beginPath(); ctx.moveTo(x + r * 0.12, y - r * 0.72); ctx.lineTo(x - r * 0.42, y + r * 0.1); ctx.lineTo(x - r * 0.02, y + r * 0.1); ctx.lineTo(x - r * 0.16, y + r * 0.74); ctx.lineTo(x + r * 0.44, y - r * 0.12); ctx.lineTo(x + r * 0.04, y - r * 0.12); ctx.closePath(); ctx.fill();
      return;
    }
    if (kind === 'magnet') {
      ctx.lineWidth = r * 0.34; ctx.lineCap = 'butt';
      ctx.strokeStyle = '#E8473A';
      ctx.beginPath(); ctx.arc(x, y - r * 0.05, r * 0.42, Math.PI, 0, true); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r * 0.42, y - r * 0.05); ctx.lineTo(x - r * 0.42, y - r * 0.32); ctx.moveTo(x + r * 0.42, y - r * 0.05); ctx.lineTo(x + r * 0.42, y - r * 0.32); ctx.stroke();
      ctx.strokeStyle = '#E9EEF2';
      ctx.beginPath(); ctx.moveTo(x - r * 0.42, y - r * 0.32); ctx.lineTo(x - r * 0.42, y - r * 0.6); ctx.moveTo(x + r * 0.42, y - r * 0.32); ctx.lineTo(x + r * 0.42, y - r * 0.6); ctx.stroke();
      return;
    }
    ctx.fillStyle = '#FFE27A';
    ctx.font = '800 ' + (r * 0.95).toFixed(1) + 'px "Doto", "Instrument Sans", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('×2', x, y + r * 0.06);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  function badge(ctx, kind, x, y, r, t) {
    const col = POWER_COL[kind];
    const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 1.9);
    g.addColorStop(0, col + '66'); g.addColorStop(1, col + '00');
    ctx.fillStyle = g; ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
    ctx.fillStyle = '#10241B'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.beginPath(); ctx.arc(x, y, r * 0.9, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6);
    ctx.beginPath(); ctx.arc(x, y, r * 0.9, t * 3, t * 3 + 1.2); ctx.stroke();
    ctx.globalAlpha = 1;
    powerIcon(ctx, kind, x, y, r);
  }

  // hazards. (x, y) = left end at road level, k = px per unit
  function potholeShape(ctx, cx, cy, rx, ry, seed, grow) {
    ctx.beginPath();
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const a = i / n * TAU, j = 1 + (hash(seed + i * 1.37) - 0.5) * 0.22 + grow;
      const px = cx + Math.cos(a) * rx * j, py = cy + Math.sin(a) * ry * j;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  function drawHole(ctx, o, x, y, k, P, sk, env) {
    const w = o.w * k, cx = x + w / 2, rx = w / 2, ry = Math.min(10, 4 + o.w / 18) * k, cy = y + 1.5 * k;
    const seed = o.g * 7.1 + o.w;
    if (o.deco === 'manhole') {
      ctx.fillStyle = 'rgba(0,0,0,.25)'; potholeShape(ctx, cx, cy + ry * 0.2, rx * 0.98, ry * 1.1, seed, 0); ctx.fill();
      ctx.fillStyle = '#7E878A'; ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.86, ry * 0.95, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#040A07'; ctx.beginPath(); ctx.ellipse(cx, cy + ry * 0.08, rx * 0.74, ry * 0.75, 0, 0, TAU); ctx.fill();
      // the cover, lying on the road
      const lx = x + w + 4 * k, lw = o.w * 0.78 * k, lc = lx + lw / 2;
      ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(lc + 2 * k, cy + 4 * k, lw / 2, 3.4 * k, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#4A5254'; ctx.fillRect(lc - lw / 2, cy - 0.5 * k, lw, 2.6 * k);
      ctx.fillStyle = '#7C8588'; ctx.beginPath(); ctx.ellipse(lc, cy - 0.6 * k, lw / 2, 3.4 * k, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#5A6265'; ctx.lineWidth = Math.max(1, 0.9 * k);
      ctx.beginPath();
      for (let i = -2; i <= 2; i++) { ctx.moveTo(lc + i * lw * 0.14 - lw * 0.05, cy - 2.4 * k); ctx.lineTo(lc + i * lw * 0.14 + lw * 0.05, cy + 1.2 * k); }
      ctx.stroke();
      const hx = cx, hy = cy;
      if (o.item === 'branch') {
        ctx.strokeStyle = '#5B3F26'; ctx.lineWidth = 2.6 * k; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + 3 * k, hy - 30 * k); ctx.moveTo(hx + 2 * k, hy - 16 * k); ctx.lineTo(hx - 9 * k, hy - 26 * k); ctx.moveTo(hx + 3 * k, hy - 24 * k); ctx.lineTo(hx + 12 * k, hy - 33 * k); ctx.stroke();
        ctx.fillStyle = rgb(mixc(hex('#4E7A3A'), hex('#1A3022'), sk.dark * 0.8));
        for (const [ax, ay, ar] of [[-10, -28, 6], [3, -33, 7], [13, -35, 6], [-4, -24, 5]]) { ctx.beginPath(); ctx.ellipse(hx + ax * k, hy + ay * k, ar * k, ar * 0.7 * k, 0.4, 0, TAU); ctx.fill(); }
      } else if (o.item === 'tire') {
        ctx.strokeStyle = '#141414'; ctx.lineWidth = 5 * k;
        ctx.beginPath(); ctx.ellipse(hx, hy - 9 * k, 7 * k, 11 * k, 0, 0, TAU); ctx.stroke();
      } else {
        ctx.fillStyle = '#F06A1E';
        ctx.beginPath(); ctx.moveTo(hx - 9 * k, hy); ctx.lineTo(hx - 2.5 * k, hy - 26 * k); ctx.lineTo(hx + 2.5 * k, hy - 26 * k); ctx.lineTo(hx + 9 * k, hy); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#FFFAE6';
        ctx.beginPath(); ctx.moveTo(hx - 6.6 * k, hy - 8 * k); ctx.lineTo(hx - 4.8 * k, hy - 15 * k); ctx.lineTo(hx + 4.8 * k, hy - 15 * k); ctx.lineTo(hx + 6.6 * k, hy - 8 * k); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2B2B2B'; ctx.fillRect(hx - 11 * k, hy - 1.5 * k, 22 * k, 3 * k);
      }
      return;
    }
    // pothole: broken rim, dark hole, a bit of depth, maybe water or slush
    ctx.fillStyle = rgb(mixc(P.road, [255, 255, 255], 0.12));
    potholeShape(ctx, cx, cy, rx, ry, seed, 0.12); ctx.fill();
    ctx.fillStyle = '#060D09';
    potholeShape(ctx, cx, cy, rx, ry, seed + 9, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.ellipse(cx, cy + ry * 0.35, rx * 0.8, ry * 0.45, 0, 0, Math.PI); ctx.fill();
    if (env.snow > 0.3) {
      ctx.globalAlpha = env.snow * 0.85; ctx.fillStyle = '#F2F6F8';
      for (let i = 0; i < 5; i++) { const a = Math.PI + 0.3 + i * 0.6; ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * rx * 1.02, cy + Math.sin(a) * ry, rx * 0.16, ry * 0.32, 0, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    } else if (sk.dark > 0.5) {
      ctx.fillStyle = 'rgba(255,216,138,' + (0.16 * sk.dark).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(cx + rx * 0.25, cy, rx * 0.22, ry * 0.18, 0, 0, TAU); ctx.fill();
    }
  }
  function goat(ctx, x, y, k, t, bump, dark, flip) {
    const b = bump > 0 ? Math.min(1, bump) : 0;
    ctx.save();
    ctx.translate(x + 26 * k, y - b * 40 * k);
    if (b) ctx.rotate(-b * 0.5);
    if (flip) ctx.scale(-1, 1);
    const step = Math.sin(t * 5) * 1.5 * k;
    ctx.strokeStyle = '#1C1612'; ctx.lineWidth = 3.2 * k; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-12 * k, -14 * k); ctx.lineTo(-13 * k + step, 0);
    ctx.moveTo(-6 * k, -14 * k); ctx.lineTo(-5 * k - step, 0);
    ctx.moveTo(8 * k, -14 * k); ctx.lineTo(7 * k + step, 0);
    ctx.moveTo(13 * k, -14 * k); ctx.lineTo(14 * k - step, 0);
    ctx.stroke();
    ctx.fillStyle = '#241D18';
    ctx.beginPath(); ctx.ellipse(0, -20 * k, 18 * k, 9 * k, 0, 0, TAU); ctx.fill();
    // tail
    ctx.beginPath(); ctx.moveTo(16 * k, -24 * k); ctx.lineTo(21 * k, -31 * k); ctx.lineTo(18 * k, -22 * k); ctx.fill();
    // neck and head (facing left)
    ctx.beginPath(); ctx.moveTo(-12 * k, -24 * k); ctx.lineTo(-20 * k, -33 * k); ctx.lineTo(-14 * k, -36 * k); ctx.lineTo(-6 * k, -25 * k); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-21 * k, -33 * k, 6.5 * k, 4.4 * k, -0.35, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4A3C31';
    ctx.beginPath(); ctx.ellipse(-26 * k, -31 * k, 2.6 * k, 2.2 * k, 0, 0, TAU); ctx.fill();
    // long droopy ear, horns, beard
    ctx.fillStyle = '#16110D';
    ctx.beginPath(); ctx.ellipse(-15 * k, -29 * k, 2.4 * k, 6.5 * k, 0.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#8C7A62'; ctx.lineWidth = 2 * k;
    ctx.beginPath(); ctx.moveTo(-18 * k, -37 * k); ctx.quadraticCurveTo(-13 * k, -44 * k, -8 * k, -40 * k); ctx.stroke();
    ctx.strokeStyle = '#16110D'; ctx.lineWidth = 1.6 * k;
    ctx.beginPath(); ctx.moveTo(-24 * k, -29 * k); ctx.lineTo(-25 * k, -24 * k); ctx.stroke();
    if (dark > 0.5) { ctx.fillStyle = 'rgba(200,255,150,' + (0.8 * dark).toFixed(2) + ')'; ctx.beginPath(); ctx.arc(-22 * k, -34.5 * k, 1.1 * k, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  function snowman(ctx, x, y, k, bump) {
    const b = bump > 0 ? Math.min(1, bump) : 0;
    const cx = x + 20 * k;
    ctx.save();
    if (b) { ctx.translate(cx, y); ctx.rotate(-b * 0.9); ctx.translate(-cx, -y); }
    ctx.fillStyle = '#F7FAFC'; ctx.strokeStyle = 'rgba(120,140,160,.5)'; ctx.lineWidth = k;
    for (const [cy, r] of [[13, 13], [32, 9.5], [46, 7]]) { ctx.beginPath(); ctx.arc(cx, y - cy * k, r * k, 0, TAU); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = '#E23C0E'; ctx.fillRect(cx - 8 * k, y - 40 * k, 16 * k, 3.4 * k); ctx.fillRect(cx + 2 * k, y - 40 * k, 3.4 * k, 10 * k);
    ctx.fillStyle = '#F07A1E'; ctx.beginPath(); ctx.moveTo(cx - 5 * k, y - 46 * k); ctx.lineTo(cx - 14 * k, y - 45 * k); ctx.lineTo(cx - 5 * k, y - 44 * k); ctx.fill();
    ctx.fillStyle = '#1A1A1A';
    for (const [dx, dy] of [[-3, -49], [2, -49], [0, -33], [0, -28]]) { ctx.beginPath(); ctx.arc(cx + dx * k, y + dy * k, 1.1 * k, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = '#5B3F26'; ctx.lineWidth = 1.6 * k;
    ctx.beginPath(); ctx.moveTo(cx - 8 * k, y - 33 * k); ctx.lineTo(cx - 19 * k, y - 40 * k); ctx.moveTo(cx + 8 * k, y - 33 * k); ctx.lineTo(cx + 18 * k, y - 41 * k); ctx.stroke();
    ctx.restore();
  }
  const CAR_COLS = ['#E9E2CF', '#C9CED1', '#8E2E2B', '#2F4B6E', '#D9A441'];
  function vehicle(ctx, o, x, y, k, sk, t) {
    const w = o.w * k, h = o.h * k;
    const body = hex(o.kind === 'van' ? '#ECEAE2' : o.kind === 'truck' ? '#3D6FA8' : CAR_COLS[o.tint % CAR_COLS.length]);
    const bodyC = rgb(mixc(body, [12, 26, 20], sk.dark * 0.55));
    const glass = rgb(mixc(hex('#9FC3CF'), hex('#122028'), sk.dark * 0.85));
    const squash = o.bumped ? Math.max(0, 1 - (t - o.bumped) * 4) : 0;
    ctx.save();
    ctx.translate(0, squash * 3 * k);
    // headlight beam at night
    if (sk.dark > 0.3) {
      const g = ctx.createLinearGradient(x, 0, x - 220 * k, 0);
      g.addColorStop(0, 'rgba(255,230,160,' + (0.32 * sk.dark).toFixed(3) + ')'); g.addColorStop(1, 'rgba(255,230,160,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x + 4 * k, y - 22 * k); ctx.lineTo(x - 220 * k, y - 46 * k); ctx.lineTo(x - 220 * k, y + 6 * k); ctx.lineTo(x + 4 * k, y - 14 * k); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(x + w / 2, y + 1.5 * k, w * 0.52, 3.5 * k, 0, 0, TAU); ctx.fill();
    if (o.kind === 'car') {
      ctx.fillStyle = bodyC;
      rrect(ctx, x + 1 * k, y - 29 * k, w - 2 * k, 21 * k, 5 * k); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 24 * k, y - 28 * k); ctx.lineTo(x + 40 * k, y - 44 * k); ctx.lineTo(x + w - 36 * k, y - 44 * k); ctx.lineTo(x + w - 20 * k, y - 28 * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = glass;
      ctx.beginPath(); ctx.moveTo(x + 30 * k, y - 29 * k); ctx.lineTo(x + 42 * k, y - 41 * k); ctx.lineTo(x + 60 * k, y - 41 * k); ctx.lineTo(x + 60 * k, y - 29 * k); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 64 * k, y - 29 * k); ctx.lineTo(x + 64 * k, y - 41 * k); ctx.lineTo(x + w - 38 * k, y - 41 * k); ctx.lineTo(x + w - 26 * k, y - 29 * k); ctx.closePath(); ctx.fill();
      if (o.taxi) { ctx.fillStyle = '#F2C230'; ctx.fillRect(x + w * 0.42, y - 49 * k, 16 * k, 5 * k); }
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x + 3 * k, y - 21 * k, w - 6 * k, 1.5 * k);
    } else if (o.kind === 'van') {
      ctx.fillStyle = bodyC;
      rrect(ctx, x + 1 * k, y - 54 * k, w - 2 * k, 46 * k, 6 * k); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + 1 * k, y - 30 * k); ctx.lineTo(x + 14 * k, y - 54 * k); ctx.lineTo(x + 30 * k, y - 54 * k); ctx.lineTo(x + 30 * k, y - 30 * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = glass;
      ctx.beginPath(); ctx.moveTo(x + 6 * k, y - 32 * k); ctx.lineTo(x + 16 * k, y - 50 * k); ctx.lineTo(x + 28 * k, y - 50 * k); ctx.lineTo(x + 28 * k, y - 32 * k); ctx.closePath(); ctx.fill();
      for (let i = 0; i < 3; i++) ctx.fillRect(x + (36 + i * 32) * k, y - 50 * k, 26 * k, 14 * k);
      ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = k; ctx.beginPath(); ctx.moveTo(x + 66 * k, y - 34 * k); ctx.lineTo(x + 66 * k, y - 12 * k); ctx.stroke();
      ctx.fillStyle = '#E23C0E'; ctx.fillRect(x + 32 * k, y - 26 * k, w - 40 * k, 3 * k);
    } else {
      // pickup truck with a covered load
      ctx.fillStyle = bodyC;
      rrect(ctx, x + 1 * k, y - 26 * k, w - 2 * k, 18 * k, 4 * k); ctx.fill();
      rrect(ctx, x + 2 * k, y - 52 * k, 42 * k, 28 * k, 6 * k); ctx.fill();
      ctx.fillStyle = glass;
      ctx.beginPath(); ctx.moveTo(x + 6 * k, y - 30 * k); ctx.lineTo(x + 10 * k, y - 48 * k); ctx.lineTo(x + 28 * k, y - 48 * k); ctx.lineTo(x + 28 * k, y - 30 * k); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgb(mixc(hex('#2F6B4F'), [10, 20, 15], sk.dark * 0.6));
      rrect(ctx, x + 48 * k, y - 58 * k, w - 52 * k, 34 * k, 5 * k); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = 1.2 * k;
      ctx.beginPath(); for (let i = 1; i < 5; i++) { ctx.moveTo(x + (48 + i * (o.w - 52) / 5) * k, y - 58 * k); ctx.lineTo(x + (48 + i * (o.w - 52) / 5) * k, y - 24 * k); } ctx.stroke();
    }
    // wheels
    const wr = 10.5 * k;
    for (const wx of [x + 24 * k, x + w - 26 * k]) {
      ctx.fillStyle = '#121414'; ctx.beginPath(); ctx.arc(wx, y - wr, wr, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9AA2A4'; ctx.beginPath(); ctx.arc(wx, y - wr, wr * 0.45, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3A3F40'; ctx.lineWidth = k;
      const a = -t * 14;
      ctx.beginPath(); ctx.moveTo(wx + Math.cos(a) * wr * 0.4, y - wr + Math.sin(a) * wr * 0.4); ctx.lineTo(wx - Math.cos(a) * wr * 0.4, y - wr - Math.sin(a) * wr * 0.4); ctx.stroke();
    }
    // red public plate, chrome bumper, headlight
    ctx.fillStyle = '#C8CDD0'; ctx.fillRect(x - 1 * k, y - 14 * k, 8 * k, 4 * k);
    ctx.fillStyle = '#C62828'; ctx.fillRect(x + 1 * k, y - 20 * k, 9 * k, 5 * k);
    ctx.fillStyle = sk.dark > 0.3 ? '#FFF2C4' : '#F4E9C8';
    ctx.beginPath(); ctx.ellipse(x + 3 * k, y - 24 * k, 2.6 * k, 3.2 * k, 0, 0, TAU); ctx.fill();
    if (sk.dark > 0.3) {
      const g = ctx.createRadialGradient(x + 3 * k, y - 24 * k, 0, x + 3 * k, y - 24 * k, 16 * k);
      g.addColorStop(0, 'rgba(255,240,190,.75)'); g.addColorStop(1, 'rgba(255,240,190,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 13 * k, y - 40 * k, 32 * k, 32 * k);
    }
    ctx.restore();
  }

  // the village sign: same board as before, now standing at the edge of the road
  function villageSign(ctx, x, roadY, en, ar, k, sk) {
    const fsE = clamp(15.5 * k, 11, 19), fsA = fsE * 1.05;
    ctx.font = 'italic 600 ' + fsE + 'px "Kanit", "Instrument Sans", sans-serif';
    const wE = ctx.measureText(en).width;
    ctx.font = '600 ' + fsA + 'px "Baloo Bhaijaan 2", "Geeza Pro", sans-serif';
    const wA = ctx.measureText(ar).width;
    const bw = Math.max(wE, wA) + fsE * 1.6, bh = fsE * 3.1;
    const postH = 44 * k;
    const top = roadY - postH - bh;
    const dim = sk.dark * 0.35;
    ctx.fillStyle = rgb(mixc(BRAND.stone, [20, 35, 28], dim)); ctx.fillRect(x - 2, roadY - postH - 2, 4, postH + 4);
    ctx.fillStyle = rgb(mixc(BRAND.cream, [40, 60, 50], dim)); rrect(ctx, x - bw / 2, top, bw, bh, 5); ctx.fill();
    ctx.strokeStyle = '#1D3D2F'; ctx.lineWidth = 1.5; rrect(ctx, x - bw / 2 + 3, top + 3, bw - 6, bh - 6, 3); ctx.stroke();
    ctx.fillStyle = '#15271E'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'italic 600 ' + fsE + 'px "Kanit", "Instrument Sans", sans-serif';
    ctx.fillText(en, x, top + bh * 0.34);
    ctx.font = '600 ' + fsA + 'px "Baloo Bhaijaan 2", "Geeza Pro", sans-serif';
    ctx.fillText(ar, x, top + bh * 0.7);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  /* ===================================================================== sound (made on the fly, no files) */
  function makeSound() {
    let ac = null, master = null, noise = null, muted = false;
    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        ac = new AC();
        master = ac.createGain(); master.gain.value = muted ? 0 : 0.2; master.connect(ac.destination);
        noise = ac.createBuffer(1, ac.sampleRate * 0.6, ac.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ac = null; }
    }
    function tone(f0, f1, dur, type, vol, delay) {
      if (!ac || muted) return;
      const t0 = ac.currentTime + (delay || 0);
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function hiss(dur, vol, freq, delay, q) {
      if (!ac || muted) return;
      const t0 = ac.currentTime + (delay || 0);
      const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      s.buffer = noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 0.8;
      g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t0); s.stop(t0 + dur + 0.02);
    }
    function bleat() {
      if (!ac || muted) return;
      const t0 = ac.currentTime;
      const o = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain(), g = ac.createGain(), f = ac.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(330, t0); o.frequency.linearRampToValueAtTime(290, t0 + 0.4);
      lfo.frequency.value = 26; lg.gain.value = 28; lfo.connect(lg); lg.connect(o.frequency);
      f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 1.4;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.32, t0 + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
      o.connect(f); f.connect(g); g.connect(master);
      o.start(t0); lfo.start(t0); o.stop(t0 + 0.45); lfo.stop(t0 + 0.45);
    }
    const SFX = {
      jump: () => tone(360, 720, 0.13, 'square', 0.12),
      djump: () => tone(520, 1040, 0.13, 'square', 0.11),
      land: () => hiss(0.06, 0.12, 900),
      coin: () => { tone(988, 988, 0.07, 'square', 0.08); tone(1319, 1319, 0.16, 'square', 0.08, 0.065); },
      rare: () => { [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, f, 0.14, 'triangle', 0.16, i * 0.065)); },
      power: () => { tone(300, 1200, 0.28, 'triangle', 0.18); tone(600, 1800, 0.22, 'square', 0.05, 0.1); },
      helmet: () => { hiss(0.18, 0.4, 2400, 0, 2); tone(240, 110, 0.3, 'sawtooth', 0.16); },
      crash: () => { hiss(0.55, 0.5, 700); tone(320, 55, 0.7, 'sawtooth', 0.2); },
      honk: () => { tone(415, 415, 0.12, 'square', 0.08); tone(523, 523, 0.12, 'square', 0.06); tone(415, 415, 0.16, 'square', 0.08, 0.17); tone(523, 523, 0.16, 'square', 0.06, 0.17); },
      bounce: () => tone(220, 560, 0.16, 'sine', 0.3),
      goat: bleat,
      village: () => { tone(659, 659, 0.35, 'sine', 0.18); tone(880, 880, 0.5, 'sine', 0.16, 0.12); },
      start: () => { [523, 659, 784].forEach((f, i) => tone(f, f, 0.12, 'square', 0.08, i * 0.09)); },
      poof: () => hiss(0.25, 0.25, 500)
    };
    return {
      init,
      get muted() { return muted; },
      set muted(v) { muted = !!v; if (master) master.gain.value = muted ? 0 : 0.2; },
      play(name) { try { if (SFX[name]) SFX[name](); } catch (e) { /* ignore */ } }
    };
  }

  /* ===================================================================== names
     The same lists the leaderboard server uses (src/names.json, inlined at build),
     so a rude name is refused here too, including in the on-device list. */
  const NAME_LISTS = /*@@NAMES@@*/ null;
  function makeNameCheck(L) {
    if (!L) return () => false;
    const dedup = s => s.replace(/(.)\1+/gu, '$1');
    const single = w => dedup(w) === w;
    const any = L.anywhere, anyD = any.filter(single), start = L.starts, startD = start.filter(single);
    const word = new Set(L.words), wordD = new Set(L.words.filter(single));
    const AR = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ؤ': 'و', 'ئ': 'ي' };
    const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '€': 'e', '+': 't' };
    const fold = s => String(s).normalize('NFKD').toLowerCase()
      .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640\u200b-\u200f]/g, '')
      .replace(/[أإآٱةىؤئ]/g, c => AR[c]);
    return function rude(name) {
      const raw = fold(name);
      const leet = raw.replace(/[01345789@$!|€+]/g, c => LEET[c]);
      for (const v of [raw, leet]) {
        const squash = v.replace(/[^\p{L}\p{N}]+/gu, '');
        if (!squash) continue;
        const squashD = dedup(squash);
        if (any.some(w => squash.includes(w)) || anyD.some(w => squashD.includes(w))) return true;
        const tokens = v.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        tokens.push(squash);
        for (const t of tokens) {
          for (const [x, wl, sl] of [[t, word, start], [dedup(t), wordD, startD]]) {
            const bare = x.replace(/\d+$/u, '');
            if (wl.has(x) || (bare && wl.has(bare))) return true;
            if (sl.some(w => x.startsWith(w))) return true;
          }
        }
      }
      return false;
    };
  }
  const rudeName = makeNameCheck(NAME_LISTS);

  /* ===================================================================== storage that never throws */
  const store = {
    get(k, d) { try { const v = window.localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  /* ===================================================================== the game on the page */
  function mount(root) {
    if (!root || root.dataset.ready) return;
    root.dataset.ready = '1';
    const REDUCE = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const q = s => root.querySelector(s);
    const world = q('.jg-world'), fxc = q('.jg-fx'), scootEl = q('.jg-scooter');
    const wctx = world.getContext('2d'), fctx = fxc.getContext('2d');
    const AR = {};
    try { for (const v of JSON.parse(root.dataset.villages || '[]')) AR[v[0]] = v[1]; } catch (e) { /* ignore */ }
    const API = root.dataset.api || '';
    const ui = {
      start: q('#jgStart'), paused: q('#jgPaused'), over: q('#jgOver'), hud: q('.jg-hud'), toast: q('#jgToast'),
      score: q('#jgScore'), coins: q('#jgCoins'), rare: q('#jgRare'), rareWrap: q('.jg-rare'), helmets: q('#jgHelmets'), powers: q('#jgPowers'),
      place: q('#jgVillage'), elev: q('#jgElev'), best: q('#jgBest'), play: q('#jgPlay'), resume: q('#jgResume'), again: q('#jgAgain'),
      pause: q('#jgPause'), mute: q('#jgMute'), where: q('#jgOverWhere'), final: q('#jgFinal'), stats: q('#jgStats'),
      form: q('#jgForm'), name: q('#jgName'), save: q('#jgSave'), msg: q('#jgMsg'), newBest: q('#jgNewBest'),
      board: document.getElementById('jgBoard'), boardNote: document.getElementById('jgBoardNote')
    };
    const sound = makeSound();
    sound.muted = !!store.get('jkRush.muted', false);
    const sim = new Sim();
    sim.reset({ mode: 'attract', seed: 7, start: Math.floor(Math.random() * ROUTE.length), speed: 280 });

    let state = 'attract';        // attract | play | paused | crashing | over
    let W = 0, H = 0, k = 1, gy = 0, horizon = 0, viewW = 0, scootX = 110, dpr = 1;
    let shake = 0, flash = 0, lastFrame = 0, running = false, visible = false, ratio = 0;
    let quality = 1, perfT = 0, perfN = 0;     // drawing resolution adapts to how fast this device draws
    let skyBlend = null, skyBlendK = 1;
    let token = null, tokenAt = 0, savedThisRun = false, crashAt = 0;
    let scrollKick = 0, lastScrollY = window.scrollY || 0;
    const parts = [], floats = [], flakes = [], stars = [];
    const R = rng(4242);
    for (let i = 0; i < 80; i++) stars.push([R(), R() * 0.62, 0.5 + R() * 1.2, R() * 10]);

    /* ---------------------------------------------- layout */
    function fit(cv, ctx, r) {
      const pw = Math.max(1, Math.round(W * r)), ph = Math.max(1, Math.round(H * r));
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      ctx.setTransform(pw / W, 0, 0, ph / H, 0, 0);
    }
    function layout() {
      const r = root.getBoundingClientRect();
      W = Math.max(1, r.width); H = Math.max(1, r.height);
      // keep the canvas under about two million pixels so big screens stay smooth
      dpr = Math.max(0.7, Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(2.0e6 / (W * H))) * quality);
      fit(world, wctx, dpr); fit(fxc, fctx, Math.min(dpr, 1.5));
      k = Math.max(Math.min(H / 380, W / 620), W / 2200);
      gy = H - 46 * k;
      horizon = gy - Math.max(176 * k, gy * 0.42);
      viewW = W / k;
      scootX = clamp(viewW - 900, 110, 520);
      const u = 0.68 * k;
      scootEl.style.width = (208 * u).toFixed(2) + 'px';
      scootEl.style.transformOrigin = (86 * u).toFixed(2) + 'px ' + (130 * u).toFixed(2) + 'px';
      const n = Math.round(clamp(W * H / 5200, 40, 220));
      while (flakes.length < n) flakes.push({ x: Math.random() * W, y: Math.random() * H, z: 0.3 + Math.random() * 0.7, w: Math.random() * TAU });
      flakes.length = n;
      if (!running) draw(0);
    }
    const X = wx => (wx - sim.dist + scootX) * k;
    const Y = wy => gy - wy * k;

    /* ---------------------------------------------- time of day */
    function currentSky() {
      const target = state === 'attract' ? skyAt(0.4) : skyAt(0.86 + sim.t / 150);
      if (skyBlend && skyBlendK < 1) return mixSky(skyBlend, target, smooth(0, 1, skyBlendK));
      return target;
    }

    /* ---------------------------------------------- scenery */
    function drawScene(t) {
      const ctx = wctx;
      const sk = currentSky();
      const env = sim.env;
      const P = landPal(env, sk);
      const d = sim.dist;
      ctx.save();
      if (shake > 0 && !REDUCE) ctx.translate((Math.random() - 0.5) * shake * 10, (Math.random() - 0.5) * shake * 6);

      // sky
      const g = ctx.createLinearGradient(0, 0, 0, horizon + 30 * k);
      g.addColorStop(0, rgb(sk.top)); g.addColorStop(0.62, rgb(sk.mid)); g.addColorStop(1, rgb(sk.bot));
      ctx.fillStyle = g; ctx.fillRect(-20, -20, W + 40, H + 40);
      if (sk.stars > 0.02) {
        ctx.fillStyle = '#FFFAE6';
        for (const s of stars) {
          ctx.globalAlpha = sk.stars * (0.3 + 0.25 * Math.sin(t * s[2] + s[3]));
          ctx.fillRect(((s[0] * W * 1.2 - d * 0.004 * k) % W + W) % W, s[1] * horizon, 1.5, 1.5);
        }
        ctx.globalAlpha = 1;
      }
      // sun and moon
      const mr = Math.max(10, 20 * k);
      if (sk.moon > 0.02) {
        const mx = W * 0.82, my = Math.max(mr * 2, horizon * 0.34);
        const halo = ctx.createRadialGradient(mx, my, mr * 0.5, mx, my, mr * 4);
        halo.addColorStop(0, 'rgba(255,216,138,' + (0.3 * sk.moon).toFixed(3) + ')'); halo.addColorStop(1, 'rgba(255,216,138,0)');
        ctx.fillStyle = halo; ctx.fillRect(mx - mr * 4, my - mr * 4, mr * 8, mr * 8);
        ctx.globalAlpha = sk.moon; ctx.fillStyle = '#FFD88A'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
      if (sk.sun > -0.15) {
        const sx = W * 0.74, sy = horizon - sk.sun * horizon * 0.9, sr = mr * 1.25;
        const warm = sk.warm;
        const core = mixc(hex('#FFF6DA'), hex('#FFB067'), warm);
        const halo = ctx.createRadialGradient(sx, sy, sr * 0.4, sx, sy, sr * 6);
        halo.addColorStop(0, rgb(core, 0.5)); halo.addColorStop(1, rgb(core, 0));
        ctx.fillStyle = halo; ctx.fillRect(sx - sr * 6, sy - sr * 6, sr * 12, sr * 12);
        ctx.fillStyle = rgb(core); ctx.beginPath(); ctx.arc(sx, sy, sr, 0, TAU); ctx.fill();
      }

      // the sea and Beirut, seen from the low villages
      if (env.coast > 0.02) {
        const top = horizon - 2 * k;
        ctx.globalAlpha = env.coast;
        const sea = mixc(mixc(hex('#7FA9BC'), hex('#10263A'), sk.dark), BRAND.warm, sk.warm * 0.25 * (1 - sk.dark));
        ctx.fillStyle = rgb(sea); ctx.fillRect(0, top, W, gy - top);
        ctx.fillStyle = rgb(mixc(sea, [255, 255, 255], 0.25));
        for (let i = 0; i < 26; i++) {
          const x = ((hash(i * 4.1) * W * 1.3 - d * 0.01 * k) % (W * 1.3) + W * 1.3) % (W * 1.3) - W * 0.15;
          ctx.fillRect(x, top + 6 * k + hash(i) * 18 * k, (8 + hash(i + 2) * 22) * k, 1);
        }
        ctx.globalAlpha = 1;
      }

      // Mount Lebanon behind everything, snow on the high ridges (hidden where the coast is in view)
      const farA = 1 - 0.9 * env.coast;
      if (farA > 0.02) {
        const farAmp = (118 + 34 * env.alpine) * k;
        const farBase = horizon + 10 * k;
        const offF = d * 0.035;
        ctx.globalAlpha = farA;
        ctx.beginPath(); ctx.moveTo(-10, gy);
        for (let x = -10; x <= W + 10; x += 6) ctx.lineTo(x, farBase - farAmp * (0.18 + 0.82 * peaks(x / k + offF)));
        ctx.lineTo(W + 10, gy); ctx.closePath();
        ctx.fillStyle = rgb(P.farHaze); ctx.fill();
        ctx.save(); ctx.clip();
        const snowLine = farBase - farAmp * (0.78 - 0.5 * env.snow);
        ctx.fillStyle = rgb(P.capHaze);
        ctx.beginPath(); ctx.moveTo(-10, -10);
        for (let x = -10; x <= W + 10; x += 8) ctx.lineTo(x, snowLine + (Math.sin((x / k + offF) * 0.045) * 7 + Math.sin((x / k + offF) * 0.13) * 4) * k);
        ctx.lineTo(W + 10, -10); ctx.closePath(); ctx.fill();
        // a little shading on the far side of each summit
        ctx.fillStyle = 'rgba(10,25,30,' + (0.12 + 0.08 * sk.dark).toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(-10, gy);
        for (let x = -10; x <= W + 10; x += 6) {
          const xw = x / k + offF, y0 = farBase - farAmp * (0.18 + 0.82 * peaks(xw));
          const slope = peaks(xw + 3) - peaks(xw - 3);
          ctx.lineTo(x, slope < 0 ? y0 : y0 + 40 * k);
        }
        ctx.lineTo(W + 10, gy); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      }

      // middle ridge with small trees and villages
      const offM = d * 0.12;
      const midBase = horizon + (34 + 34 * env.coast) * k, midAmp = 44 * k * (1 - 0.45 * env.coast);
      const yM = x => midBase - midAmp * (0.5 + 0.5 * ridge(x / k + offM, 4.1, 0.0052));
      ctx.beginPath(); ctx.moveTo(-10, gy);
      for (let x = -10; x <= W + 10; x += 8) ctx.lineTo(x, yM(x));
      ctx.lineTo(W + 10, gy); ctx.closePath();
      ctx.fillStyle = rgb(P.midHaze); ctx.fill();
      // Beirut's lights spread over the low hills by the sea at night
      if (env.coast > 0.05 && sk.dark > 0.25) {
        ctx.fillStyle = 'rgba(255,214,140,' + (0.85 * sk.dark * env.coast).toFixed(3) + ')';
        for (let i = Math.floor(offM / 9) - 1; (i * 9 - offM) * k < W + 10; i++) {
          if (hash(i * 1.71) > 0.55) continue;
          const x = (i * 9 - offM) * k;
          ctx.fillRect(x, yM(x) + (2 + hash(i * 3.9) * 26) * k, 1.6, 1.6);
        }
      }
      const treeM = rgb(mixc(P.tree, P.midHaze, 0.45)), snowM = rgb(mixc(P.cap, P.midHaze, 0.2));
      for (let i = Math.floor(offM / 20) - 1; (i * 20 - offM) * k < W + 30; i++) {
        const h1 = hash(i * 7.31 + 4.1);
        if (h1 < 0.32) continue;
        const x = (i * 20 - offM + (h1 - 0.5) * 16) * k;
        const z = (13 + hash(i * 1.7) * 9) * k;
        tree(ctx, treeKind(env, hash(i * 3.3), hash(i * 5.9)), x, yM(x) + z * 0.2, z, hash(i) - 0.5, env.snow, snowM, treeM);
      }
      for (let i = Math.floor(offM / 70) - 1; (i * 70 - offM) * k < W + 40; i++) {
        if (hash(i * 2.91 + 0.7) > 0.28) continue;
        const x = (i * 70 - offM) * k;
        house(ctx, x, yM(x) + 4 * k, 15 * k, 9 * k, { wall: mixc(P.wall, P.midHaze, 0.35), roof: mixc(P.roof, P.midHaze, 0.3) }, sk.dark, env.snow, false);
      }

      // near hill: terraces, bigger trees, stone houses
      const offN = d * 0.3;
      const nearBase = gy - 50 * k, nearAmp = 34 * k;
      const yN = x => nearBase - nearAmp * (0.5 + 0.5 * ridge(x / k + offN, 2.7, 0.0085));
      ctx.beginPath(); ctx.moveTo(-10, gy);
      for (let x = -10; x <= W + 10; x += 8) ctx.lineTo(x, yN(x));
      ctx.lineTo(W + 10, gy); ctx.closePath();
      ctx.fillStyle = rgb(P.near); ctx.fill();
      ctx.strokeStyle = rgb(mixc(P.near, [0, 0, 0], 0.18)); ctx.lineWidth = Math.max(1, 1.4 * k);
      ctx.beginPath();
      for (let row = 1; row <= 3; row++) {
        for (let x = -10; x <= W + 10; x += 12) {
          const y = yN(x) + row * 9 * k + Math.sin((x / k + offN) * 0.02 + row) * 2 * k;
          if (x === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      for (let i = Math.floor(offN / 150) - 1; (i * 150 - offN) * k < W + 60; i++) {
        const h = hash(i * 5.17 + 2.2);
        if (h > 0.34) continue;
        const x = (i * 150 - offN + h * 60) * k;
        house(ctx, x, yN(x + 16 * k) + 7 * k, 34 * k, 22 * k, P, sk.dark, env.snow, true);
      }
      const treeN = rgb(P.tree), snowN = rgb(P.cap);
      for (let i = Math.floor(offN / 36) - 1; (i * 36 - offN) * k < W + 40; i++) {
        const h1 = hash(i * 3.71 + 9.2);
        if (h1 < 0.42) continue;
        const x = (i * 36 - offN + (h1 - 0.5) * 24) * k;
        const z = (24 + hash(i * 2.3) * 16) * k;
        tree(ctx, treeKind(env, hash(i * 6.1), hash(i * 8.7)), x, yN(x) + z * 0.18, z, hash(i * 1.1) - 0.5, env.snow, snowN, treeN);
      }

      // roadside: trees, electricity poles with their tangle of wires, street lamps
      const roadTop = gy - 14 * k;
      const offR = d * 0.65;
      for (let i = Math.floor(offR / 64) - 1; (i * 64 - offR) * k < W + 60; i++) {
        const h1 = hash(i * 3.17 + 9);
        if (h1 < 0.5) continue;
        const x = (i * 64 - offR + (h1 - 0.5) * 30) * k;
        const z = (48 + hash(i * 1.7) * 30) * k;
        tree(ctx, treeKind(env, hash(i * 4.4), hash(i * 7.7)), x, roadTop + 2 * k, z, hash(i * 2.2) - 0.5, env.snow, snowN, rgb(mixc(P.tree, [0, 0, 0], 0.25)));
      }
      const poleGap = 300, poles = [];
      for (let i = Math.floor(offR / poleGap) - 1; (i * poleGap - offR) * k < W + poleGap * k; i++) poles.push([(i * poleGap - offR) * k, i]);
      const poleC = rgb(mixc(hex('#4A4038'), [10, 18, 14], sk.dark * 0.6));
      ctx.strokeStyle = 'rgba(15,20,18,.75)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let j = 0; j + 1 < poles.length; j++) {
        const [ax] = poles[j], [bx] = poles[j + 1];
        for (let wi = 0; wi < 3; wi++) {
          const ay = roadTop - (104 - wi * 6) * k, sag = (16 + wi * 5 + hash(poles[j][1] + wi) * 8) * k;
          ctx.moveTo(ax + 4 * k, ay); ctx.quadraticCurveTo((ax + bx) / 2, ay + sag, bx + 4 * k, ay);
        }
      }
      ctx.stroke();
      for (const [px, i] of poles) {
        ctx.fillStyle = poleC;
        ctx.fillRect(px, roadTop - 112 * k, 4 * k, 112 * k);
        ctx.fillRect(px - 10 * k, roadTop - 106 * k, 24 * k, 2.5 * k);
        if (hash(i * 3.3) < 0.55) {
          ctx.fillRect(px + 2 * k, roadTop - 92 * k, 20 * k, 2.2 * k);
          const lx = px + 22 * k, ly = roadTop - 90 * k;
          ctx.fillStyle = sk.dark > 0.4 ? '#FFC877' : '#D7D2C4';
          ctx.fillRect(lx - 5 * k, ly, 10 * k, 3 * k);
          if (sk.dark > 0.4) {
            const lg = ctx.createRadialGradient(lx, ly + 2 * k, 0, lx, ly + 2 * k, 60 * k);
            lg.addColorStop(0, 'rgba(255,190,110,' + (0.38 * sk.dark).toFixed(3) + ')'); lg.addColorStop(1, 'rgba(255,190,110,0)');
            ctx.fillStyle = lg; ctx.fillRect(lx - 60 * k, ly - 58 * k, 120 * k, 120 * k);
          }
        }
        if (hash(i * 7.9) < 0.3) { // the famous tangle
          ctx.strokeStyle = 'rgba(15,20,18,.85)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.ellipse(px + 14 * k, roadTop - 97 * k, 9 * k, 5 * k, 0.3, 0, TAU); ctx.ellipse(px + 18 * k, roadTop - 95 * k, 6 * k, 7 * k, -0.5, 0, TAU); ctx.stroke();
        }
      }

      // village signs
      for (const o of sim.objs) {
        if (o.kind !== 'sign') continue;
        const x = X(o.x);
        if (x < -220 || x > W + 220) continue;
        villageSign(ctx, x, roadTop + 3 * k, o.v, AR[o.v] || '', k, sk);
      }

      // the road
      ctx.fillStyle = rgb(P.road); ctx.fillRect(-20, roadTop, W + 40, H - roadTop + 20);
      ctx.fillStyle = rgb(mixc(P.road, [0, 0, 0], 0.18));
      for (let i = Math.floor(d / 140) - 1; (i * 140 - d) * k < W + 140 * k; i++) {
        const h = hash(i * 1.93 + 0.4);
        if (h > 0.45) continue;
        ctx.beginPath(); ctx.ellipse((i * 140 - d + scootX + h * 60) * k, gy + (6 + h * 20) * k, (16 + h * 30) * k, 2.4 * k, 0, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = rgb(mixc(P.road, [255, 255, 255], 0.22)); ctx.fillRect(-20, roadTop, W + 40, Math.max(1.5, 1.6 * k));
      ctx.fillStyle = rgb(mixc(BRAND.stone, P.road, 0.35 + sk.dark * 0.25));
      const dash = 30, dgap = 26, ly = gy + 16 * k;
      for (let x = -(((d - scootX) % (dash + dgap)) + dash + dgap) * k; x < W; x += (dash + dgap) * k) ctx.fillRect(x, ly, dash * k, Math.max(2, 2.6 * k));
      const nearEdge = gy + 33 * k;
      ctx.fillStyle = rgb(P.fg); ctx.fillRect(-20, nearEdge, W + 40, H - nearEdge + 20);
      ctx.fillStyle = rgb(mixc(BRAND.stone, P.fg, 0.4 + sk.dark * 0.3)); ctx.fillRect(-20, nearEdge, W + 40, Math.max(2, 2.5 * k));
      if (env.snow > 0.05) {
        ctx.globalAlpha = env.snow; ctx.fillStyle = rgb(P.cap);
        for (let i = Math.floor((d * 0.98) / 46) - 1; (i * 46 - d * 0.98) * k < W + 50 * k; i++) {
          const x = (i * 46 - d * 0.98) * k, r = (12 + hash(i * 2.7) * 14) * k;
          ctx.beginPath(); ctx.ellipse(x, roadTop + 1 * k, r, r * 0.34, 0, Math.PI, 0); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // hazards, coins and power-ups
      for (const o of sim.objs) {
        if (o.kind === 'hole') {
          const x = X(o.x);
          if (x > W + 40 || x + o.w * k < -80) continue;
          drawHole(ctx, o, x, gy, k, P, sk, env);
        }
      }
      for (const o of sim.objs) {
        if (!KINDS[o.kind]) continue;
        const x = X(o.x);
        if (x > W + 260 * k || x + o.w * k < -60) continue;
        const bump = o.bumped ? (sim.t - o.bumped) * 2.4 : 0;
        if (o.kind === 'goat') goat(ctx, x, gy, k, t + o.x, bump, sk.dark, false);
        else if (o.kind === 'goats') { goat(ctx, x, gy, k, t + o.x, bump, sk.dark, false); goat(ctx, x + 60 * k, gy, k, t + o.x + 1.3, bump, sk.dark, true); }
        else if (o.kind === 'snowman') snowman(ctx, x, gy, k, bump);
        else vehicle(ctx, o, x, gy, k, sk, t);
      }
      for (const o of sim.objs) {
        if (o.done) continue;
        if (o.kind !== 'coin' && o.kind !== 'rare' && o.kind !== 'power') continue;
        const x = X(o.x), y = Y(o.y);
        if (x < -40 || x > W + 40) continue;
        if (o.kind === 'coin') liraCoin(ctx, x, y, o.r * k, t * 5 + o.x * 0.02);
        else if (o.kind === 'rare') phoenicianCoin(ctx, x, y, o.r * k, t + o.x * 0.01, true);
        else badge(ctx, o.power, x, y + Math.sin(t * 3 + o.x) * 3 * k, o.r * k, t);
      }

      // foreground verge
      const offF2 = d * 1.25;
      ctx.fillStyle = rgb(mixc(P.fg, [0, 0, 0], 0.22));
      for (let i = Math.floor(offF2 / 38) - 1; (i * 38 - offF2) * k < W + 40; i++) {
        const h = hash(i * 1.37 + 3);
        if (h < 0.35) continue;
        const x = (i * 38 - offF2) * k, by = H + 2;
        if (env.snow > 0.5) { ctx.beginPath(); ctx.ellipse(x, by, (14 + h * 18) * k, (7 + h * 7) * k, 0, Math.PI, 0); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(x - 5 * k, by); ctx.lineTo(x - 2 * k, by - (8 + h * 10) * k); ctx.lineTo(x, by); ctx.lineTo(x + 3 * k, by - (6 + h * 12) * k); ctx.lineTo(x + 6 * k, by); ctx.closePath(); ctx.fill(); }
      }
      ctx.restore();
      return sk;
    }

    /* ---------------------------------------------- effects layer (above the scooter) */
    function burst(x, y, n, cols, speed, life, size, grav) {
      if (REDUCE) n = Math.ceil(n / 3);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, v = speed * (0.3 + Math.random() * 0.7);
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.2, life, max: life, size: size * (0.6 + Math.random() * 0.6), col: cols[i % cols.length], grav: grav || 0, world: true });
      }
    }
    function floatText(text, wx, wy, col) { floats.push({ text, x: wx, y: wy, life: 1, col: col || '#FFFAE6' }); }
    function drawFx(dt, sk, t) {
      const ctx = fctx;
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      if (shake > 0 && !REDUCE) ctx.translate((Math.random() - 0.5) * shake * 10, (Math.random() - 0.5) * shake * 6);
      const p = sim.p;
      // turbo flames and streaks
      if (sim.turboK > 0.05 && sim.alive) {
        const ex = X(sim.dist + 4), ey = Y(p.y + 10);
        for (let i = 0; i < 3; i++) {
          const L = (26 + Math.random() * 22) * k * sim.turboK;
          ctx.fillStyle = i ? 'rgba(255,190,80,.85)' : 'rgba(226,60,14,.9)';
          ctx.beginPath(); ctx.moveTo(ex, ey - 5 * k); ctx.quadraticCurveTo(ex - L * 0.6, ey - 8 * k + i * 3 * k, ex - L, ey + (Math.random() - 0.5) * 4 * k); ctx.quadraticCurveTo(ex - L * 0.6, ey + 6 * k, ex, ey + 5 * k); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(255,250,230,' + (0.35 * sim.turboK).toFixed(2) + ')'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 9; i++) { const y = H * (0.15 + 0.08 * i) + Math.sin(t * 9 + i) * 6, x = (W - ((t * 1900 + i * 397) % (W + 300))); ctx.moveTo(x, y); ctx.lineTo(x + 120, y); }
        ctx.stroke();
      }
      // magnet ring
      if (sim.power.magnet > 0 && sim.alive) {
        ctx.strokeStyle = 'rgba(127,211,255,' + (0.25 + 0.15 * Math.sin(t * 8)).toFixed(2) + ')'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(sim.dist + 50), Y(p.y + 38), (70 + 8 * Math.sin(t * 6)) * k, 0, TAU); ctx.stroke();
      }
      // dust from the back wheel
      if (sim.alive && p.ground && state !== 'paused' && Math.random() < dt * 22) {
        const env = sim.env;
        parts.push({ x: sim.dist + 14, y: 3, vx: -60 - Math.random() * 60, vy: 14 + Math.random() * 30, life: 0.32, max: 0.32, size: 1.6 + Math.random() * 1.8, col: env.snow > 0.5 ? '#F4F7F9' : '#C9B994', grav: -40, world: true, soft: true });
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const q2 = parts[i];
        q2.life -= dt;
        if (q2.life <= 0) { parts.splice(i, 1); continue; }
        q2.x += q2.vx * dt; q2.y += q2.vy * dt; q2.vy -= (q2.grav || 0) * dt;
        const a = q2.life / q2.max;
        ctx.globalAlpha = q2.soft ? a * 0.45 : a;
        ctx.fillStyle = q2.col;
        const sx = X(q2.x), sy = Y(q2.y), r = q2.size * k * (q2.soft ? 2 - a : 1);
        if (q2.star) { ctx.beginPath(); ctx.moveTo(sx, sy - r * 2); ctx.lineTo(sx + r * 0.5, sy); ctx.lineTo(sx, sy + r * 2); ctx.lineTo(sx - r * 0.5, sy); ctx.closePath(); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      // flying helmet
      for (const f of floats) {
        if (f.helmet) {
          f.life -= dt * 0.8; f.x += f.vx * dt; f.y += f.vy * dt; f.vy -= 1400 * dt; f.rot += f.vr * dt;
          ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 2)); ctx.translate(X(f.x), Y(f.y)); ctx.rotate(f.rot);
          helmetIcon(ctx, 0, 0, 12 * k); ctx.restore();
          continue;
        }
        f.life -= dt * 0.9; f.y += 60 * dt;
        ctx.globalAlpha = Math.max(0, Math.min(1, f.life * 1.6));
        ctx.font = '800 ' + Math.round(clamp(15 * k, 12, 20)) + 'px "Doto", "Instrument Sans", monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(16,36,27,.75)'; ctx.strokeText(f.text, X(f.x), Y(f.y));
        ctx.fillStyle = f.col; ctx.fillText(f.text, X(f.x), Y(f.y));
        ctx.textAlign = 'left';
      }
      ctx.globalAlpha = 1;
      for (let i = floats.length - 1; i >= 0; i--) if (floats[i].life <= 0) floats.splice(i, 1);
      // oncoming traffic warning at the right edge
      if (state === 'play') {
        for (const o of sim.objs) {
          if (o.warnAt === undefined || o.done) continue;
          const x = X(o.x);
          if (x < W - 10) continue;
          const age = sim.t - o.warnAt, a = 0.55 + 0.45 * Math.sin(age * 14);
          const wx = W - 30 * Math.max(0.8, k), wy = Y(o.h * 0.6);
          const sz = clamp(15 * k, 12, 20);
          const hg = ctx.createRadialGradient(W, wy, 0, W, wy, 90 * k);
          hg.addColorStop(0, 'rgba(255,236,170,' + (0.45 * a).toFixed(2) + ')'); hg.addColorStop(1, 'rgba(255,236,170,0)');
          ctx.fillStyle = hg; ctx.fillRect(W - 90 * k, wy - 90 * k, 90 * k, 180 * k);
          ctx.globalAlpha = a;
          ctx.fillStyle = '#E23C0E';
          ctx.beginPath(); ctx.moveTo(wx, wy - sz); ctx.lineTo(wx + sz * 0.95, wy + sz * 0.7); ctx.lineTo(wx - sz * 0.95, wy + sz * 0.7); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#FFFAE6'; ctx.font = '800 ' + Math.round(sz * 1.05) + 'px "Instrument Sans", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('!', wx, wy + sz * 0.12);
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
        }
      }
      // falling snow
      const env = sim.env;
      const want = REDUCE ? 0 : env.snow;
      if (want > 0.02) {
        const n = Math.floor(flakes.length * want);
        const night = sk.dark;
        ctx.fillStyle = night > 0.5 ? 'rgba(220,232,245,.85)' : 'rgba(255,255,255,.92)';
        const drift = (sim.speed || 0) * k;
        for (let i = 0; i < n; i++) {
          const f = flakes[i];
          f.x -= (drift * 0.45 * f.z + 14 * k) * dt;
          f.y += (24 + 46 * f.z) * k * dt;
          f.w += dt * 2;
          if (f.x < -10) { f.x += W + 20; f.y = Math.random() * H; }
          if (f.y > H + 6) { f.y = -6; f.x = Math.random() * (W + 20); }
          ctx.globalAlpha = 0.35 + 0.6 * f.z;
          ctx.beginPath(); ctx.arc(f.x + Math.sin(f.w) * 4 * k, f.y, (0.8 + f.z * 1.8) * Math.max(1, k * 0.9), 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (flash > 0) { ctx.fillStyle = 'rgba(255,250,230,' + (flash * 0.6).toFixed(2) + ')'; ctx.fillRect(0, 0, W, H); }
      ctx.restore();
    }

    /* ---------------------------------------------- the scooter (DOM, so the brand art stays crisp) */
    let lastT = '', blink = false, helmetShown = null;
    function placeScooter(t) {
      const p = sim.p, u = 0.68 * k;
      let tilt = 0, dy = 0;
      if (!p.ground) tilt = clamp(-p.vy / PH.jump * 9, -11, 13);
      else if (state !== 'paused' && !REDUCE) dy = Math.sin(t * 26) * 0.5;
      if (!sim.alive) tilt = -Math.min(1, sim.deadT * 2.2) * 28;
      const x = scootX * k - 54 * u, y = gy - p.y * k - 130 * u + dy;
      const tr = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + tilt.toFixed(1) + 'deg)';
      if (tr !== lastT) { scootEl.style.transform = tr; lastT = tr; }
      const b = p.inv > 0 && state === 'play' && Math.floor(p.inv * 12) % 2 === 0;
      if (b !== blink) { scootEl.classList.toggle('blink', b); blink = b; }
      const hs = p.helmets > 0 || state === 'attract';
      if (hs !== helmetShown) { scootEl.classList.toggle('no-helmet', !hs); helmetShown = hs; }
      scootEl.classList.toggle('turbo', sim.turboK > 0.3);
      const wheel = clamp(36 / Math.max(40, sim.speed * 0.32), 0.08, 0.6).toFixed(2) + 's';
      if (scootEl.dataset.wheel !== wheel) { scootEl.dataset.wheel = wheel; root.style.setProperty('--wheel', wheel); }
    }

    /* ---------------------------------------------- HUD */
    const hudCache = {};
    function setText(el, key, v) { if (el && hudCache[key] !== v) { hudCache[key] = v; el.textContent = v; } }
    const fmt = n => Math.floor(n).toLocaleString('en-US');
    function hud() {
      setText(ui.score, 'score', fmt(sim.score));
      setText(ui.coins, 'coins', String(sim.coins));
      setText(ui.rare, 'rare', String(sim.rare));
      if (ui.rareWrap) ui.rareWrap.hidden = sim.rare === 0;
      const hk = String(sim.p.helmets);
      if (hudCache.helmets !== hk && ui.helmets) {
        hudCache.helmets = hk;
        ui.helmets.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < sim.p.helmets));
        ui.helmets.setAttribute('aria-label', sim.p.helmets + ' helmets');
      }
      setText(ui.place, 'place', sim.village);
      setText(ui.elev, 'elev', ELEV[sim.village].toLocaleString('en-US') + ' m');
      if (ui.powers) {
        for (const key of ['turbo', 'magnet', 'double']) {
          const el = ui.powers.querySelector('[data-p="' + key + '"]');
          if (!el) continue;
          const left = sim.power[key];
          const on = left > 0;
          if (el.hidden === on) el.hidden = !on;
          if (on) el.style.setProperty('--left', (left / POWER_TIME[key]).toFixed(3));
        }
      }
    }
    let toastTimer = 0;
    function toast(main, sub, tone, ar) {
      if (!ui.toast) return;
      ui.toast.innerHTML = '';
      const b = document.createElement('b'); b.textContent = main; ui.toast.appendChild(b);
      if (sub || ar) {
        const s2 = document.createElement('span');
        if (ar) { const bd = document.createElement('bdi'); bd.lang = 'ar'; bd.textContent = ar; s2.appendChild(bd); if (sub) s2.appendChild(document.createTextNode(' · ')); }
        if (sub) s2.appendChild(document.createTextNode(sub));
        ui.toast.appendChild(s2);
      }
      ui.toast.className = 'jg-toast show' + (tone ? ' ' + tone : '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { ui.toast.className = 'jg-toast'; }, 2300);
    }

    /* ---------------------------------------------- events from the simulation */
    const POWER_NAME = { helmet: 'Helmet', turbo: 'Turbo', magnet: 'Magnet', double: 'Lira ×2' };
    const POWER_HINT = { helmet: 'An extra life', turbo: 'Clear road, full speed', magnet: 'Coins come to you', double: 'Every coin counts twice' };
    function handleEvents() {
      const live = state === 'play' || state === 'crashing';
      for (const e of sim.events) {
        switch (e.type) {
          case 'jump': if (live) sound.play('jump'); burst(sim.dist + 30, 2, 5, ['#C9B994'], 70, 0.35, 2.4, -60); break;
          case 'djump': if (live) sound.play('djump'); burst(sim.dist + 40, sim.p.y, 6, ['#FFFAE6', '#FFD88A'], 90, 0.35, 2, 0); break;
          case 'land': if (live) sound.play('land'); burst(sim.dist + 50, 2, 6, [sim.env.snow > 0.5 ? '#F4F7F9' : '#C9B994'], 80, 0.4, 3, -40); break;
          case 'coin': { if (live) sound.play('coin'); const n0 = parts.length; burst(e.x, e.y, 6, ['#FFE7A0', '#E9BE58'], 120, 0.35, 1.6, 0); for (let i = n0; i < parts.length; i++) parts[i].star = true; break; }
          case 'rare': if (live) { sound.play('rare'); toast('Phoenician coin', '+' + (150 * (sim.power.double > 0 ? 2 : 1)) + ' points', 'rare'); } burst(e.x, e.y, 18, ['#C58BE0', '#FFFFFF', '#E9BE58'], 200, 0.7, 2.2, 0); break;
          case 'power': if (live) { sound.play('power'); toast(POWER_NAME[e.power], e.power === 'helmet' && sim.p.helmets >= 3 && sim.bonus ? 'Helmets full: +250' : POWER_HINT[e.power], 'power'); } burst(e.x, e.y, 16, [POWER_COL[e.power], '#FFFAE6'], 220, 0.6, 2.4, 0); break;
          case 'powerEnd': break;
          case 'poof': if (live) sound.play('poof'); burst(e.x, e.y + 10, 12, ['#D9D4C7', '#A9A396'], 140, 0.6, 4, -30); break;
          case 'bounce':
            if (live) { sound.play('bounce'); if (e.kind === 'goat' || e.kind === 'goats') sound.play('goat'); else if (e.kind !== 'snowman') sound.play('honk'); }
            burst(e.x, e.y, 8, ['#FFFAE6'], 120, 0.4, 2.4, 0);
            break;
          case 'points': if (e.why === 'bounce') floatText('+' + e.n, e.x, e.y + 26, '#FFD88A'); else if (e.why === 'rare') floatText('+' + e.n, e.x, e.y + 22, '#E2B8F2'); break;
          case 'helmetLost':
            sound.play('helmet'); shake = 0.7; flash = 0.5;
            floats.push({ helmet: true, x: sim.dist + 68, y: sim.p.y + 82, vx: -140, vy: 520, rot: 0, vr: -9, life: 1.4 });
            toast('Helmet saved you', sim.p.helmets ? sim.p.helmets + ' left' : 'No helmets left. Careful!', 'warn');
            break;
          case 'crash':
            sound.play('crash'); shake = 1.2; flash = 0.7;
            burst(sim.dist + 70, 20, 26, ['#E23C0E', '#FFFAE6', '#C9B994', '#10241B'], 260, 0.9, 3, 500);
            sim.p.vy = 420; sim.p.ground = false;
            state = 'crashing'; crashAt = performance.now();
            break;
          case 'village':
            if (state === 'play') {
              sound.play('village');
              const el = ELEV[e.name];
              const env = envFor(el);
              toast('Welcome to ' + e.name, el.toLocaleString('en-US') + ' m' + (env.snow > 0.55 ? ' · snow' : env.coast > 0.5 ? ' · sea view' : ''), 'village', AR[e.name]);
              floatText('+100', sim.dist + 50, sim.p.y + 110, '#FFD88A');
            }
            break;
          case 'honk': if (state === 'play') sound.play('honk'); break;
        }
      }
      sim.events.length = 0;
    }

    /* ---------------------------------------------- frame loop */
    function draw(dt) {
      const t = performance.now() / 1000;
      const sk = drawScene(t);
      drawFx(dt, sk, t);
      placeScooter(t);
    }
    function frame(ms) {
      if (!running) return;
      const raw = lastFrame ? (ms - lastFrame) / 1000 : 0;
      const dt = Math.min(0.05, raw);
      lastFrame = ms;
      if (raw > 0 && raw < 0.25) {
        perfT += raw; perfN++;
        if (perfN >= 50) {
          const avg = perfT / perfN; perfT = 0; perfN = 0;
          if (avg > 0.024 && quality > 0.5) { quality = Math.max(0.5, quality * 0.8); layout(); }
          else if (avg < 0.0172 && quality < 1) { quality = Math.min(1, quality * 1.12); layout(); }
        }
      }
      if (state === 'attract') {
        if (!REDUCE) {
          const target = 280 + scrollKick * 0.5;
          sim.attractSpeed = target;
          scrollKick *= Math.exp(-dt * 2.2);
          autopilot(sim, () => (Math.random() - 0.5) * 0.06);
          sim.update(dt);
        }
      } else if (state === 'play' || state === 'crashing' || state === 'over') {
        sim.update(dt);
      }
      if (skyBlendK < 1) skyBlendK = Math.min(1, skyBlendK + dt / 1.6);
      shake = Math.max(0, shake - dt * 2.4);
      flash = Math.max(0, flash - dt * 2.5);
      handleEvents();
      if (state === 'play' || state === 'crashing') hud();
      if (state === 'crashing' && performance.now() - crashAt > 1150) showOver();
      draw(state === 'paused' ? 0 : dt);
      if (REDUCE && state === 'attract') { running = false; return; }
      requestAnimationFrame(frame);
    }
    function run() {
      if (running) return;
      running = true; lastFrame = 0;
      requestAnimationFrame(frame);
    }
    function halt() { running = false; }

    /* ---------------------------------------------- game states */
    function show(el, on) { if (el) el.hidden = !on; }
    function startGame() {
      sound.init();
      skyBlend = currentSky(); skyBlendK = 0;
      sim.reset({ mode: 'play', seed: (Math.random() * 1e9) >>> 0, start: Math.floor(Math.random() * ROUTE.length) });
      parts.length = 0; floats.length = 0;
      state = 'play'; savedThisRun = false; token = null; tokenAt = 0;
      root.classList.add('playing'); root.classList.remove('is-over', 'is-paused');
      show(ui.start, false); show(ui.over, false); show(ui.paused, false); show(ui.hud, true);
      for (const key in hudCache) delete hudCache[key];
      hud();
      toast(sim.village, ELEV[sim.village].toLocaleString('en-US') + ' m', 'village', AR[sim.village]);
      sound.play('start');
      fetchToken();
      try { root.focus({ preventScroll: true }); } catch (e) { root.focus(); }
      run();
    }
    function pause() {
      if (state !== 'play') return;
      state = 'paused';
      root.classList.add('is-paused');
      show(ui.paused, true);
      if (ui.resume) ui.resume.focus({ preventScroll: true });
    }
    function resume() {
      if (state !== 'paused') return;
      state = 'play';
      root.classList.remove('is-paused');
      show(ui.paused, false);
      lastFrame = 0;
      try { root.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      run();
    }
    function showOver() {
      state = 'over';
      root.classList.add('is-over'); root.classList.remove('playing');
      const st = sim.stats();
      const best = store.get('jkRush.best', 0);
      const isBest = st.score > best;
      if (isBest) store.set('jkRush.best', st.score);
      const what = { hole: 'a pothole', manhole: 'an open manhole', goat: 'a goat', goats: 'two goats', snowman: 'a snowman', car: 'an oncoming car', van: 'a van', truck: 'a pickup truck' };
      const mins = Math.floor(st.time / 60), secs = Math.floor(st.time % 60);
      setText(ui.where, 'where', 'Hit ' + (what[sim.crashKind] || 'trouble') + ' in ' + st.village);
      setText(ui.final, 'final', fmt(st.score));
      setText(ui.stats, 'stats', st.coins + ' lira · ' + st.rare + ' Phoenician · ' + st.villages + (st.villages === 1 ? ' village' : ' villages') + ' · ' + mins + ':' + String(secs).padStart(2, '0'));
      if (ui.newBest) ui.newBest.hidden = !isBest || st.score < 100;
      if (ui.best) ui.best.textContent = 'Your best: ' + fmt(Math.max(best, st.score));
      if (ui.form) { ui.form.hidden = st.score < 100 || st.time < 3.5; ui.msg.textContent = ''; ui.msg.className = 'jg-msg'; ui.save.disabled = false; ui.save.textContent = 'Save score'; }
      if (ui.name && !ui.name.value) { const saved = store.get('jkRush.name', ''); ui.name.value = saved && !rudeName(saved) ? saved : ''; }
      if (ui.name && rudeName(ui.name.value)) ui.name.value = '';
      show(ui.hud, false); show(ui.over, true);
      // don't let a held Space bar skip the results
      if (ui.again) { ui.again.disabled = true; setTimeout(() => { ui.again.disabled = false; }, 700); }
      try { ui.over.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      saveLocal(st);
    }

    /* ---------------------------------------------- leaderboard */
    async function api(path, opts) {
      if (!API) throw new Error('offline');
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => ctl && ctl.abort(), 7000);
      try {
        const res = await fetch(API + path, Object.assign({ cache: 'no-store', mode: 'cors', credentials: 'omit', signal: ctl ? ctl.signal : undefined }, opts || {}));
        const data = await res.json().catch(() => ({ ok: false, error: 'Unexpected reply.' }));
        if (!res.ok && data.ok === undefined) data.ok = false;
        return data;
      } finally { clearTimeout(timer); }
    }
    function fetchToken() {
      const startedAt = sim.t;
      api('?a=start&_=' + Date.now()).then(d => { if (d && d.ok && state !== 'attract' && startedAt <= sim.t) { token = d.token; tokenAt = sim.t; } }).catch(() => {});
    }
    let online = null;
    function saveLocal(st) {
      if (st.score < 100) return;
      const list = store.get('jkRush.local', []);
      const saved = store.get('jkRush.name', '');
      list.push({ n: saved && !rudeName(saved) ? saved : 'You', s: st.score, v: st.village, t: Date.now() / 1000 | 0, me: true });
      list.sort((a, b) => b.s - a.s);
      store.set('jkRush.local', list.slice(0, 10));
      if (online === false) renderBoard(store.get('jkRush.local', []), 'local');
    }
    function renderBoard(rows, mode, mineKey) {
      if (!ui.board) return;
      ui.board.innerHTML = '';
      if (!rows.length) {
        const li = document.createElement('li'); li.className = 'empty';
        li.textContent = mode === 'local' ? 'No scores on this device yet. Be the first!' : 'No scores yet. Be the first!';
        ui.board.appendChild(li);
      }
      rows.slice(0, 10).forEach((r, i) => {
        const li = document.createElement('li');
        if (mineKey && keyOf(r.n) === mineKey) li.className = 'me';
        const a = document.createElement('span'); a.className = 'r'; a.textContent = String(i + 1);
        const b = document.createElement('span'); b.className = 'n'; b.textContent = rudeName(r.n) ? 'Rider' : r.n;
        const c = document.createElement('span'); c.className = 'v'; c.textContent = r.v || '';
        const d2 = document.createElement('span'); d2.className = 's'; d2.textContent = fmt(r.s);
        li.append(a, b, c, d2);
        ui.board.appendChild(li);
      });
      if (ui.boardNote) {
        ui.boardNote.textContent = mode === 'local'
          ? 'The online leaderboard is not reachable from here, so these are the best runs on this device.'
          : 'Top 10 of all time. One entry per name, best score counts.';
      }
    }
    const keyOf = n => String(n || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    function loadBoard() {
      if (!ui.board) return;
      api('?a=top&n=10&_=' + Date.now())
        .then(d => { if (!d || !d.ok) throw new Error('bad'); online = true; renderBoard(d.top || [], 'online'); })
        .catch(() => { online = false; renderBoard(store.get('jkRush.local', []), 'local'); });
    }
    function validName(n) {
      if (n.length < 2) return 'Use at least 2 characters.';
      if (n.length > 16) return 'Use 16 characters or fewer.';
      if (!/^[\p{L}\p{M}\p{N} ._'-]+$/u.test(n)) return 'Use letters, numbers and spaces only.';
      return '';
    }
    async function submitScore(ev) {
      ev.preventDefault();
      if (savedThisRun) return;
      const name = ui.name.value.replace(/\s+/g, ' ').trim();
      const bad = validName(name) || (rudeName(name) ? 'Please pick a different name.' : '');
      ui.msg.className = 'jg-msg';
      if (bad) { ui.msg.textContent = bad; ui.msg.className = 'jg-msg err'; ui.name.focus(); return; }
      store.set('jkRush.name', name);
      const st = sim.stats();
      // fix the local copy's name too
      const local = store.get('jkRush.local', []);
      for (const r of local) if (r.me && r.s === st.score && (!r.n || r.n === 'You')) r.n = name;
      store.set('jkRush.local', local);
      if (!token) {
        if (online === false || !API) { ui.msg.textContent = 'Saved on this device. The online leaderboard is not reachable from here.'; ui.msg.className = 'jg-msg ok'; renderBoard(store.get('jkRush.local', []), 'local', keyOf(name)); savedThisRun = true; return; }
        ui.msg.textContent = 'This run could not be verified with the leaderboard, so it was saved on this device only.'; ui.msg.className = 'jg-msg err'; return;
      }
      ui.save.disabled = true; ui.msg.textContent = 'Saving…';
      const played = Math.min(st.time, sim.t - tokenAt + 2);
      try {
        const d = await api('?a=submit&_=' + Date.now(), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ name, score: st.score, coins: st.coins, rare: st.rare, villages: st.villages, village: st.village, time: Math.round(played * 10) / 10, token }) });
        if (d && d.ok) {
          savedThisRun = true;
          online = true;
          ui.save.textContent = 'Saved';
          ui.msg.className = 'jg-msg ok';
          ui.msg.textContent = d.improved === false
            ? 'Saved. Your best of ' + fmt(d.previous) + ' still stands. This run ranks #' + d.rank + '.'
            : (d.onBoard ? 'Saved. You are #' + d.rank + ' on the leaderboard.' : 'Saved. You are #' + d.rank + '.');
          renderBoard(d.top || [], 'online', keyOf(name));
        } else {
          ui.save.disabled = false;
          ui.msg.className = 'jg-msg err';
          ui.msg.textContent = (d && d.error) || 'Could not save right now. Try again.';
        }
      } catch (e) {
        ui.save.disabled = false;
        ui.msg.className = 'jg-msg err';
        ui.msg.textContent = 'Could not reach the leaderboard. Check your connection and try again.';
      }
    }

    /* ---------------------------------------------- input */
    function isUi(target) { return !!(target && target.closest && target.closest('button, a, input, label, form, .jg-panel')); }
    root.addEventListener('pointerdown', e => {
      if (state !== 'play' || isUi(e.target)) return;
      if (e.button !== undefined && e.button > 0) return;
      sim.jump();
      if (e.pointerType !== 'touch') e.preventDefault();
    });
    window.addEventListener('keydown', e => {
      const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable);
      if (typing) return;
      const jumpKey = e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW';
      if (state === 'play' && ratio > 0.3) {
        if (jumpKey) { e.preventDefault(); if (!e.repeat) sim.jump(); return; }
        if (e.code === 'KeyP' || e.code === 'Escape') { e.preventDefault(); pause(); return; }
      } else if (state === 'paused' && (e.code === 'KeyP' || e.code === 'Escape' || e.code === 'Space')) {
        e.preventDefault(); resume();
      }
    });
    if (ui.play) ui.play.addEventListener('click', startGame);
    if (ui.again) ui.again.addEventListener('click', startGame);
    if (ui.resume) ui.resume.addEventListener('click', resume);
    if (ui.pause) ui.pause.addEventListener('click', () => (state === 'paused' ? resume() : pause()));
    if (ui.form) ui.form.addEventListener('submit', submitScore);
    function syncMute() {
      if (!ui.mute) return;
      ui.mute.setAttribute('aria-pressed', sound.muted ? 'true' : 'false');
      ui.mute.setAttribute('aria-label', sound.muted ? 'Turn sound on' : 'Turn sound off');
      ui.mute.classList.toggle('off', sound.muted);
    }
    if (ui.mute) ui.mute.addEventListener('click', () => { sound.muted = !sound.muted; store.set('jkRush.muted', sound.muted); if (!sound.muted) sound.init(); syncMute(); });
    syncMute();
    if (ui.best) { const b = store.get('jkRush.best', 0); ui.best.textContent = b ? 'Your best: ' + fmt(b) : ''; }

    /* ---------------------------------------------- visibility */
    window.addEventListener('scroll', () => {
      const y = window.scrollY || 0;
      scrollKick = Math.min(1100, scrollKick + Math.abs(y - lastScrollY) * 2.4);
      lastScrollY = y;
    }, { passive: true });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => {
        for (const e of es) {
          ratio = e.intersectionRatio; visible = e.isIntersecting;
          if (state === 'play' && ratio < 0.35) pause();
          if (visible) { if (!REDUCE || state !== 'attract') run(); else draw(0); }
          else if (state !== 'play') halt();
        }
      }, { threshold: [0, 0.35, 0.6, 1] }).observe(root);
    } else { visible = true; ratio = 1; run(); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
    if ('ResizeObserver' in window) new ResizeObserver(() => layout()).observe(root);
    else window.addEventListener('resize', layout);
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) root.__jg = { sim, start: startGame, state: () => state, autopilot, envFor, ELEV, ROUTE, draw, wctx, fctx, quality: () => quality };
    layout();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!running) draw(0); });
    loadBoard();
    drawLegend();
  }

  /* ===================================================================== legend icons under the game */
  function drawLegend() {
    for (const cv of document.querySelectorAll('canvas[data-jg-icon]')) {
      const kind = cv.dataset.jgIcon;
      const css = 40, d = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = css * d; cv.height = css * d;
      const ctx = cv.getContext('2d');
      ctx.setTransform(d, 0, 0, d, 0, 0);
      const P = landPal(envFor(900), skyAt(0.4));
      const sk = skyAt(0.4);
      if (kind === 'lira') liraCoin(ctx, 20, 20, 14, 0.2);
      else if (kind === 'rare') phoenicianCoin(ctx, 20, 20, 14, 0.4, true);
      else if (POWER_COL[kind]) badge(ctx, kind, 20, 20, 15, 1);
      else if (kind === 'hole') {
        ctx.fillStyle = rgb(P.road); rrect(ctx, 0, 14, 40, 18, 4); ctx.fill();
        drawHole(ctx, { w: 30, g: 3, deco: 'pothole' }, 5, 22, 1, P, sk, envFor(900));
      }
      else if (kind === 'goat') goat(ctx, 4, 34, 0.68, 0, 0, 0, false);
      else if (kind === 'car') vehicle(ctx, { kind: 'car', w: 124, h: 46, tint: 0 }, 1, 34, 0.31, skyAt(0.82), 0);
    }
  }

  return {
    Sim, autopilot, ROUTE, ELEV, envFor, AIR, PH, FRONT, WHEEL, BODY, KINDS, POWERS, POWER_TIME, SEG,
    makeNameCheck, mount
  };

});
