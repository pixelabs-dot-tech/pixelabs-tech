/* ==========================================================================
   Visit counting for pixelabs.tech, anonymous and cookie-free.
   Sends to the same small server as the Jeetak Rush leaderboard:
   - a page view, with where the visitor came from (site, campaign), device and time zone
   - how long each part of the page and each project was actually on screen
   - which links and buttons were clicked
   - how games start and end (so finished runs that were never saved show up)
   Nothing is stored on the visitor's device and no names or contacts are sent.
   Browsers that ask not to be tracked (Do Not Track, Global Privacy Control) are skipped.
   ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const nav = window.navigator || {};
  const game = document.getElementById('jkGame');
  const API = game && game.dataset.api;
  if (!API || !window.JSON) return;
  if (nav.globalPrivacyControl === true || nav.doNotTrack === '1' || window.doNotTrack === '1') return;
  if (/bot|crawl|spider|slurp|lighthouse|pagespeed/i.test(nav.userAgent || '')) return;

  const ENDPOINT = API + (API.indexOf('?') >= 0 ? '&' : '?') + 'a=t';
  const visit = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  function send(o) {
    o.v = visit;
    const body = JSON.stringify(o);
    try {
      if (nav.sendBeacon && nav.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }))) return;
    } catch (e) { /* fall through */ }
    try {
      fetch(ENDPOINT, { method: 'POST', body, keepalive: true, mode: 'cors', credentials: 'omit', headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    } catch (e) { /* offline: nothing to do */ }
  }

  /* ---------------------------------------------- the page view */
  const qs = new URLSearchParams(location.search);
  let ref = '';
  try {
    if (document.referrer) {
      const r = new URL(document.referrer);
      if (r.hostname !== location.hostname) ref = r.hostname.replace(/^(www|m|l|lm)\./, '');
    }
  } catch (e) { /* ignore */ }
  if (!ref && qs.has('fbclid')) ref = 'facebook or instagram';
  if (!ref && qs.has('gclid')) ref = 'google ads';
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const short = Math.min(window.screen ? screen.width : 0, window.screen ? screen.height : 0);
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
  send({
    e: 'view', ref, tz,
    dev: coarse ? (short >= 600 ? 'Tablet' : 'Phone') : 'Computer',
    us: qs.get('utm_source') || '', um: qs.get('utm_medium') || '', uc: qs.get('utm_campaign') || ''
  });

  /* ---------------------------------------------- what is on screen, and for how long */
  const nameOf = el => el.dataset.sec || ((el.querySelector('h3, h4') || {}).textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const watched = Array.from(document.querySelectorAll('[data-sec], .proj, .app'));
  const near = new Set();
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => { for (const e of es) { if (e.isIntersecting) near.add(e.target); else near.delete(e.target); } });
    watched.forEach(el => io.observe(el));
  } else watched.forEach(el => near.add(el));

  let lastActive = performance.now();
  const wake = () => { lastActive = performance.now(); };
  ['scroll', 'pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(t => window.addEventListener(t, wake, { passive: true, capture: true }));
  let moveT = 0;
  window.addEventListener('pointermove', () => { const n = performance.now(); if (n - moveT > 1000) { moveT = n; wake(); } }, { passive: true });

  let onScreen = 0, lastTick = performance.now();
  const acc = { sec: {}, item: {} };
  const seen = new Set(), told = new Set(), deep = new Set(), toldDeep = new Set();
  setInterval(() => {
    const now = performance.now(), dt = Math.min(5, (now - lastTick) / 1000);
    lastTick = now;
    if (document.visibilityState !== 'visible' || now - lastActive > 30000) return;   // tab hidden, or nobody there
    onScreen += dt;
    const vh = window.innerHeight || 1;
    for (const el of near) {
      const r = el.getBoundingClientRect();
      const visible = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (visible < Math.min(vh * 0.35, r.height * 0.6)) continue;
      const kind = el.dataset.sec ? 'sec' : 'item', n = nameOf(el);
      if (!n) continue;
      acc[kind][n] = (acc[kind][n] || 0) + dt;
      seen.add(kind + '|' + n);
    }
    const doc = document.documentElement;
    const depth = ((window.scrollY || 0) + vh) / Math.max(1, doc.scrollHeight) * 100;
    for (const q of [25, 50, 75, 100]) if (depth >= q - 2) deep.add(q);
  }, 1000);

  function flush() {
    const round = o => { const r = {}; let any = false; for (const k in o) if (o[k] >= 0.5) { r[k] = Math.round(o[k] * 10) / 10; any = true; } return any ? r : null; };
    const sec = round(acc.sec), item = round(acc.item);
    const first = []; for (const s of seen) if (!told.has(s)) { told.add(s); first.push(s); }
    const depth = []; for (const q of deep) if (!toldDeep.has(q)) { toldDeep.add(q); depth.push(q); }
    if (!sec && !item && !first.length && !depth.length && onScreen < 1) return;
    send({ e: 'time', t: Math.round(onScreen * 10) / 10, sec: sec || {}, item: item || {}, first, depth });
    acc.sec = {}; acc.item = {}; onScreen = 0;
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  setInterval(flush, 60000);

  /* ---------------------------------------------- clicks on links and buttons */
  function label(el) {
    if (el.dataset.track) return el.dataset.track;
    const proj = el.closest('.proj');
    if (proj) return 'Open site: ' + nameOf(proj);
    const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') || '';
      if (href.charAt(0) === '#') return 'Go to: ' + (text || href.slice(1));
      if (/^mailto:/i.test(href)) return 'Email: ' + (text || 'link');
      if (/^tel:/i.test(href)) return 'Phone call';
      if (/wa\.me|whatsapp/i.test(href)) return 'WhatsApp: ' + (text || 'link');
      let host = '';
      try { host = new URL(href, location.href).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
      return text && host && text.indexOf(host) < 0 ? text + ' (' + host + ')' : (text || host || 'link');
    }
    return text || el.id || 'button';
  }
  document.addEventListener('click', ev => {
    const el = ev.target && ev.target.closest ? ev.target.closest('a, button') : null;
    if (!el) return;
    const area = el.closest('[data-sec]');
    send({ e: 'click', k: label(el), s: area ? area.dataset.sec : (el.closest('header') ? 'Menu' : '') });
  }, { capture: true, passive: true });

  /* ---------------------------------------------- the game */
  window.addEventListener('jkrush', ev => {
    const d = ev.detail || {};
    if (d.type === 'start') send({ e: 'gstart' });
    else if (d.type === 'end') send({ e: 'grun', score: d.score, time: Math.round(d.time * 10) / 10, village: d.village, kind: d.kind || '', villages: d.villages, coins: d.coins, rare: d.rare });
  });
})();
