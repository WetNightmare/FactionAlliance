// ==UserScript==
// @name         Torn PDA: Iron Dome Checker (All-in-One + Manual Fallback)
// @namespace    WetNightmare
// @version      1.5.0
// @description  Original selectors + robust debug panel + multi-mirror JSON loader + manual paste fallback. Inserts banner under .buttons-list on matching factions.
// @match        https://www.torn.com/profiles.php*
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const CONFIG = {
    // --- JSON mirrors (first working one wins) ---
    mirrors: [
      'https://cdn.jsdelivr.net/gh/WetNightmare/FactionAlliance@main/iron-dome-factions.json?v=1',
      'https://wetnightmare.github.io/FactionAlliance/iron-dome-factions.json',
      'https://raw.githubusercontent.com/WetNightmare/FactionAlliance/main/iron-dome-factions.json'
    ],

    // --- Banner (image loads fine without CORS) ---
    bannerUrl: 'https://github.com/WetNightmare/FactionAlliance/blob/f373bfec9fd256ca995895a19c64141c05c685a0/iron-dome-banner-750x140.png?raw=true',

    cacheTtlMs: 12 * 60 * 60 * 1000,  // 12 hours
    badgeText: 'MEMBER OF THE IRON DOME',
    bannerId: 'iron-dome-banner',
    badgeId:   'iron-dome-tag',

    // Behavior + Diagnostics
    debug: true,                         // always show panel while debugging
    debugPanelId: 'iron-dome-debug-panel',
    forceShow: false,                    // bypass only the membership check (still waits for DOM anchors)
    maxWaitMs: 12000,                    // max wait for DOM bits
    evalDebounceMs: 250,                 // debounce for SPA updates
  };

  const STORAGE_KEYS = {
    factionsCache:  'ironDome.factions.cache.v5',   // { ts, list[] }
    factionsManual: 'ironDome.factions.manual.v1'   // stringified list[] set via Manual Paste
  };

  // ---------------- Utilities + Debug Panel ----------------
  const norm  = s => (s || '').trim().toLowerCase();
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function ensureDebugPanel() {
    let p = document.getElementById(CONFIG.debugPanelId);
    if (!p) {
      p = document.createElement('div');
      p.id = CONFIG.debugPanelId;
      p.style.cssText = [
        'position:fixed','right:8px','bottom:8px','z-index:2147483647',
        'max-width:360px','font:12px/1.4 system-ui,Arial,sans-serif',
        'background:#0b0f13cc','color:#d7e0ea','border:1px solid #2b3440',
        'padding:8px 10px 10px','border-radius:10px','backdrop-filter:blur(2px)',
        'box-shadow:0 6px 18px rgba(0,0,0,.45)'
      ].join(';');
      document.documentElement.appendChild(p);

      // controls row
      const controls = document.createElement('div');
      controls.style.cssText = 'display:flex; gap:6px; margin-bottom:6px; align-items:center; flex-wrap:wrap;';
      const btnPaste = document.createElement('button');
      btnPaste.textContent = 'Paste List';
      btnPaste.style.cssText = 'padding:3px 8px; border-radius:6px; border:1px solid #3a4756; background:#17202a; color:#d7e0ea; cursor:pointer;';
      btnPaste.onclick = handleManualPaste;

      const btnClear = document.createElement('button');
      btnClear.textContent = 'Clear Cache';
      btnClear.style.cssText = 'padding:3px 8px; border-radius:6px; border:1px solid #3a4756; background:#17202a; color:#d7e0ea; cursor:pointer;';
      btnClear.onclick = () => {
        localStorage.removeItem(STORAGE_KEYS.factionsCache);
        localStorage.removeItem(STORAGE_KEYS.factionsManual);
        report(['<b>IronDome</b>: caches cleared. Reload a profile.']);
      };

      const btnHide = document.createElement('button');
      btnHide.textContent = 'Hide';
      btnHide.style.cssText = 'padding:3px 8px; border-radius:6px; border:1px solid #3a4756; background:#17202a; color:#d7e0ea; cursor:pointer;';
      btnHide.onclick = () => p.style.display = 'none';

      controls.appendChild(btnPaste);
      controls.appendChild(btnClear);
      controls.appendChild(btnHide);

      const logBox = document.createElement('div');
      logBox.id = CONFIG.debugPanelId + '-log';
      p.appendChild(controls);
      p.appendChild(logBox);
    }
    return p;
  }
  function report(lines) {
    if (!CONFIG.debug) return;
    ensureDebugPanel();
    const logBox = document.getElementById(CONFIG.debugPanelId + '-log');
    if (logBox) logBox.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  }
  // keep panel alive even if Torn re-renders
  setInterval(() => ensureDebugPanel(), 1000);
  // show boot
  report(['<b>IronDome</b> booting…']);

  // ---------------- Manual Paste Fallback ----------------
  function handleManualPaste() {
    const s = prompt('Paste your JSON array of faction names (e.g. ["The Swarm","Stage Fright",...])');
    if (!s) return;
    try {
      const list = JSON.parse(s);
      if (!Array.isArray(list)) throw new Error('Not an array');
      localStorage.setItem(STORAGE_KEYS.factionsManual, JSON.stringify(list));
      localStorage.setItem(STORAGE_KEYS.factionsCache, JSON.stringify({ ts: Date.now(), list }));
      report([`<b>Manual list saved</b>: ${list.length} factions. Reloading logic…`]);
      // kick a re-eval after a tick
      setTimeout(() => scheduleEvaluate('manual-paste'), 100);
    } catch (e) {
      report([`<span style="color:#ff7272"><b>Manual paste error:</b> ${e.message || e}</span>`]);
    }
  }

  // ---------------- JSON Loader (cache + mirrors + ghost detection) ----------------
  async function loadFactionSet() {
    // 0) Manual list takes precedence if present
    try {
      const man = localStorage.getItem(STORAGE_KEYS.factionsManual);
      if (man) {
        const list = JSON.parse(man);
        if (Array.isArray(list) && list.length) {
          report([`<b>IronDome</b>: using <u>manual</u> list (${list.length})`]);
          // also refresh cache timestamp so it sticks around
          localStorage.setItem(STORAGE_KEYS.factionsCache, JSON.stringify({ ts: Date.now(), list }));
          return { set: new Set(list.map(norm)), source: 'manual', count: list.length };
        }
      }
    } catch {}

    // 1) Fresh cache
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.factionsCache);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.list) && Date.now() - parsed.ts < CONFIG.cacheTtlMs) {
          report([`<b>IronDome</b>: cache (${parsed.list.length})`]);
          return { set: new Set(parsed.list.map(norm)), source: 'cache', count: parsed.list.length };
        }
      }
    } catch (e) {
      report([`<span style="color:#ff7272"><b>Cache read error:</b> ${e.message || e}</span>`]);
    }

    // 2) Try mirrors (detect opaque/empty bodies)
    let lastError = '';
    for (const url of CONFIG.mirrors) {
      try {
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout (8s)')), 8000));
        const res = await Promise.race([ fetch(url, { cache: 'no-store' }), timeout ]);

        // "Ghost" responses in some WebViews: res.ok may be true but body unreadable
        if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'no response'}`);
        const text = await res.text();                  // never trust .json() in ghost cases
        if (!text || text.length < 5) throw new Error('Empty response body (CORS/blocked?)');

        let list;
        try { list = JSON.parse(text); } catch (e) { throw new Error('Invalid JSON: ' + e.message); }
        if (!Array.isArray(list)) throw new Error('JSON not array');

        localStorage.setItem(STORAGE_KEYS.factionsCache, JSON.stringify({ ts: Date.now(), list }));
        report([`<b>IronDome</b>: network (${list.length}) from <code>${url}</code>`]);
        return { set: new Set(list.map(norm)), source: url, count: list.length };
      } catch (err) {
        lastError = err && (err.message || String(err));
        report([`<span style="color:#ff7272"><b>Fetch failed</b> ${url}: ${lastError}</span>`]);
      }
    }

    // 3) Stale cache as last resort
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.factionsCache);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.list)) {
          report([
            `<span style="color:#ffd166"><b>Network error</b>:</span> ${lastError || 'unknown'}`,
            `Using <b>stale cache</b>: ${parsed.list.length} factions`
          ]);
          return { set: new Set(parsed.list.map(norm)), source: 'stale-cache', count: parsed.list.length, error: lastError };
        }
      }
    } catch {}

    // 4) Nothing worked → visible line but NOT a thrown error
    report([`<span style="color:#ff7272"><b>JSON load failed</b>:</span> ${lastError || 'blocked/empty response'}<br/>Use <b>Paste List</b> to proceed offline.`]);
    return { set: new Set(), source: 'none', count: 0, error: lastError || 'fetch failed' };
  }

  // ---------------- Original DOM Logic (your selectors) ----------------
  function extractFactionName() {
    const span = Array.from(document.querySelectorAll('span[title*=" of "]'))
      .find(el => el.querySelector('a[href*="/factions.php"]'));
    if (!span) return null;
    const link = span.querySelector('a[href*="/factions.php"]');
    return link ? link.textContent.trim() : null;
  }

  function findButtonsList() {
    return document.querySelector('.buttons-list');
  }

  function buildBannerImg() {
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
    return img;
  }

  function buildBadgeTag() {
    const tag = document.createElement('div');
    tag.id = CONFIG.badgeId;
    tag.textContent = CONFIG.badgeText;
    tag.style.color = '#ff4444';
    tag.style.fontWeight = 'bold';
    tag.style.textAlign = 'center';
    tag.style.marginTop = '6px';
    return tag;
  }

  function removeExisting() {
    document.getElementById(CONFIG.bannerId)?.remove();
    document.getElementById(CONFIG.badgeId)?.remove();
  }

  function insertBannerAndTag() {
    const buttonsList = findButtonsList();
    if (buttonsList) {
      const img = buildBannerImg();
      const tag = buildBadgeTag();
      buttonsList.insertAdjacentElement('afterend', img);
      img.insertAdjacentElement('afterend', tag);
      return { placed: true, where: '.buttons-list(afterend)' };
    }
    // fallback: visible somewhere predictable if buttons list missing
    const host = document.querySelector('#mainContainer, main, #content, body') || document.body;
    const img = buildBannerImg();
    const tag = buildBadgeTag();
    host.appendChild(img);
    host.appendChild(tag);
    return { placed: true, where: 'main/content/body(append)' };
  }

  async function waitForProfileLoad() {
    const start = Date.now();
    while (Date.now() - start < CONFIG.maxWaitMs) {
      const haveButtons = !!document.querySelector('.buttons-list');
      const haveSpan    = !!document.querySelector('span[title*=" of "] a[href*="/factions.php"]');
      if (haveButtons && haveSpan) return 'both';
      if (haveSpan) return 'span-only';
      if (haveButtons) return 'buttons-only';
      await sleep(200);
    }
    return 'timeout';
  }

  // ---------------- Main (debounced evaluator) ----------------
  let factionsSet  = new Set();
  let factionsMeta = { source: 'none', count: 0 };
  let evalTimer    = null;
  let evaluating   = false;

  function scheduleEvaluate(reason = 'mutation') {
    if (evalTimer) clearTimeout(evalTimer);
    evalTimer = setTimeout(() => { void evaluateProfile(reason); }, CONFIG.evalDebounceMs);
  }

  async function evaluateProfile(reason = 'manual') {
    if (evaluating) return;
    evaluating = true;
    try {
      const phase   = await waitForProfileLoad();
      const faction = extractFactionName();
      const matched = CONFIG.forceShow || (faction && factionsSet.has(norm(faction)));

      removeExisting();
      let placedInfo = { placed: false, where: '(skipped)' };
      if (matched) placedInfo = insertBannerAndTag();

      report([
        `<b>IronDome</b> — ${reason}`,
        `Wait phase: ${phase}`,
        `Faction: <b>${faction || '(not found)'}</b>`,
        `List source: <b>${factionsMeta.source}</b> (${factionsMeta.count})`,
        `In alliance (match | force): <b>${!!(faction && factionsSet.has(norm(faction)))} | ${CONFIG.forceShow}</b>`,
        `Inserted: ${placedInfo.placed} @ ${placedInfo.where}`
      ]);
    } catch (e) {
      report([`<span style="color:#ff7272"><b>Error:</b> ${e.message || e}</span>`]);
    } finally {
      evaluating = false;
    }
  }

  async function init() {
    const meta = await loadFactionSet();
    factionsSet  = meta.set;
    factionsMeta = { source: meta.source, count: meta.count };

    await evaluateProfile('init');

    // Observe SPA DOM updates
    const obs = new MutationObserver(() => scheduleEvaluate('mutation'));
    obs.observe(document.documentElement, { childList: true, subtree: true });

    // Observe URL changes
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        scheduleEvaluate('url-change');
      }
    }, 400);
  }

  void init();
})();
