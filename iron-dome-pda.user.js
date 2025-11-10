// ==UserScript==
// @name         Torn PDA: Iron Dome Checker (Original DOM Logic)
// @namespace    WetNightmare
// @version      1.4.0
// @description  PDA-safe: use original selectors to detect faction and insert banner under .buttons-list; fetch+cache live JSON.
// @match        https://www.torn.com/profiles.php*
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    // ✅ Your JSON (use canonical raw form)
    sourceUrl: 'https://raw.githubusercontent.com/WetNightmare/FactionAlliance/main/iron-dome-factions.json',
    // ✅ Your banner
    bannerUrl: 'https://github.com/WetNightmare/FactionAlliance/blob/f373bfec9fd256ca995895a19c64141c05c685a0/iron-dome-banner-750x140.png?raw=true',

    cacheTtlMs: 12 * 60 * 60 * 1000, // 12h
    badgeText: 'MEMBER OF THE IRON DOME',
    bannerId: 'iron-dome-banner',
    badgeId: 'iron-dome-tag',

    // Minimal diagnostics
    debug: true,      // set false to silence console logs
    forceShow: false, // set true to force banner/tag to test insertion
  };

  const STORAGE_KEYS = { factions: 'ironDome.factions.cache.v3' };
  const norm = (s) => (s || '').trim().toLowerCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => CONFIG.debug && console.log('[IronDome]', ...a);

  /* -------------------- JSON fetch + cache -------------------- */
  async function loadFactionSet() {
    // try cache
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.factions);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.list) && Date.now() - parsed.ts < CONFIG.cacheTtlMs) {
          log(`Using cached list (${parsed.list.length})`);
          return new Set(parsed.list.map(norm));
        }
      }
    } catch {}

    // fetch fresh
    try {
      const res = await fetch(CONFIG.sourceUrl, { cache: 'no-store', mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list)) throw new Error('JSON not array');
      localStorage.setItem(STORAGE_KEYS.factions, JSON.stringify({ ts: Date.now(), list }));
      log(`Fetched list from network (${list.length})`);
      return new Set(list.map(norm));
    } catch (e) {
      log('Fetch failed, trying stale cache:', e.message || e);
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.factions);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.list)) {
            log(`Using stale cached list (${parsed.list.length})`);
            return new Set(parsed.list.map(norm));
          }
        }
      } catch {}
      log('No faction list available.');
      return new Set();
    }
  }

  /* -------------------- ORIGINAL DOM LOGIC -------------------- */
  function extractFactionName() {
    // From original: find span[title*=" of "] with a factions link
    const span = Array.from(document.querySelectorAll('span[title*=" of "]'))
      .find(el => el.querySelector('a[href*="/factions.php"]'));
    if (!span) return null;

    const link = span.querySelector('a[href*="/factions.php"]');
    const name = link ? link.textContent.trim() : null;
    log('extractFactionName ->', name);
    return name;
  }

  function findButtonsList() {
    const el = document.querySelector('.buttons-list');
    if (!el) log('.buttons-list not found yet');
    return el;
  }

  function removeExisting() {
    document.getElementById(CONFIG.bannerId)?.remove();
    document.getElementById(CONFIG.badgeId)?.remove();
  }

  function insertBannerAndTag() {
    const buttonsList = findButtonsList();
    if (!buttonsList) return false;

    // Banner
    const img = document.createElement('img');
    img.id = CONFIG.bannerId;
    img.src = CONFIG.bannerUrl;
    img.alt = 'Iron Dome Alliance';
    img.referrerPolicy = 'no-referrer';
    img.style.width = '750px';
    img.style.height = '140px';
    img.style.border = '1px solid rgba(255,255,255,0.12)';
    img.style.borderRadius = '8px';
    img.style.display = 'block';
    img.style.margin = '10px auto 4px auto';
    img.decoding = 'async';
    img.loading = 'lazy';

    // Tag
    const tag = document.createElement('div');
    tag.id = CONFIG.badgeId;
    tag.textContent = CONFIG.badgeText;
    tag.style.color = '#ff4444';
    tag.style.fontWeight = 'bold';
    tag.style.textAlign = 'center';
    tag.style.marginTop = '6px';

    // Insert exactly like the original: after .buttons-list
    buttonsList.insertAdjacentElement('afterend', img);
    img.insertAdjacentElement('afterend', tag);
    log('Inserted banner+tag after .buttons-list');
    return true;
  }

  async function waitForProfileLoad() {
    // From original: wait until both elements exist
    for (let i = 0; i < 60; i++) { // up to ~18s @300ms
      const haveButtons = !!document.querySelector('.buttons-list');
      const haveSpan = !!document.querySelector('span[title*=" of "]');
      if (haveButtons && haveSpan) return true;
      await sleep(300);
    }
    return false;
  }

  /* -------------------- Main flow -------------------- */
  let factionsSet = new Set();
  let busy = false;

  async function evaluateProfile() {
    if (busy) return;
    busy = true;
    try {
      const ok = await waitForProfileLoad();
      if (!ok) {
        log('Profile UI did not fully load (timeout).');
        return;
      }

      const faction = extractFactionName();
      const matched = CONFIG.forceShow || (faction && factionsSet.has(norm(faction)));
      log(`Faction: ${faction || '(none)'} | matched: ${matched}`);

      removeExisting();
      if (matched) insertBannerAndTag();
    } finally {
      busy = false;
    }
  }

  async function init() {
    factionsSet = await loadFactionSet();
    await evaluateProfile();

    // Observe DOM changes (SPA nature)
    const obs = new MutationObserver(() => evaluateProfile());
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // React to URL changes
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        evaluateProfile();
      }
    }, 400);
  }

  init();

  // Helpers for PDA console:
  // localStorage.removeItem('ironDome.factions.cache.v3');
})();
