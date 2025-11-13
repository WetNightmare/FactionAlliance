// ==UserScript==
// @name         Torn PDA: Iron Dome Checker (Hardcoded)
// @namespace    WetNightmare - GargoyleGoliath [3684397]
// @version      3.0.0
// @description  Shows an Iron Dome banner under .buttons-list when the profile's faction matches a hardcoded list.
// @match        https://www.torn.com/profiles.php*
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  // ---- Hardcoded Iron Dome factions ----
  const IRON_DOME_FACTIONS = [
    "Combat Ready HQ",
    "CR-ACK",
    "CRashpad",
    "Cosa-Nostra",
    "Desert Phoenix",
    "Desert Falcon",
    "Halos Pulse",
    "The Swarm",
    "Strict Union",
    "Rockstars",
    "Angels of Deception",
    "Angels of Domination",
    "Forbidden Realm",
    "MYTHIC MAYHEM",
    "Valor's Edge",
    "Strikeforce",
    "2nd Chance",
    "Academy of Strippers",
    "Echoes of Eden",
    "The Hallowed Order"
  ];

  // ---- Config for banner/tag ----
  const CONFIG = {
    bannerUrl: 'https://github.com/WetNightmare/FactionAlliance/blob/f373bfec9fd256ca995895a19c64141c05c685a0/iron-dome-banner-750x140.png?raw=true',
    bannerId: 'iron-dome-banner',
    badgeId: 'iron-dome-tag',
    badgeText: 'MEMBER OF THE IRON DOME',
    maxWaitMs: 12000
  };

  const norm = (s) => (s || '').trim().toLowerCase();
  const setNorm = new Set(IRON_DOME_FACTIONS.map(norm));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // ---- Original DOM logic to read faction ----
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

  function removeExisting() {
    document.getElementById(CONFIG.bannerId)?.remove();
    document.getElementById(CONFIG.badgeId)?.remove();
  }

  function insertBannerAndTag() {
    const buttonsList = findButtonsList();
    const img = document.createElement('img');
    img.id = CONFIG.bannerId;
    img.src = CONFIG.bannerUrl;
    img.alt = 'Iron Dome Alliance';
    img.style.width = '375px';
    img.style.height = '70px';
    img.style.border = '1px solid rgba(255,255,255,0.12)';
    img.style.borderRadius = '8px';
    img.style.display = 'block';
    img.style.margin = '10px auto 4px auto';
    img.loading = 'lazy';

    const tag = document.createElement('div');
    tag.id = CONFIG.badgeId;
    tag.textContent = CONFIG.badgeText;
    tag.style.color = '#ff4444';
    tag.style.fontWeight = 'bold';
    tag.style.textAlign = 'center';
    tag.style.marginTop = '6px';

    if (buttonsList) {
      buttonsList.insertAdjacentElement('afterend', img);
      img.insertAdjacentElement('afterend', tag);
    } else {
      // Fallback: append somewhere visible if buttons-list isn't present yet
      (document.querySelector('#mainContainer, main, #content, body') || document.body).append(img, tag);
    }
  }

  async function waitForProfileDom() {
    const start = Date.now();
    while (Date.now() - start < CONFIG.maxWaitMs) {
      const hasButtons = document.querySelector('.buttons-list');
      const hasFaction = document.querySelector('span[title*=" of "] a[href*="/factions.php"]');
      if (hasButtons && hasFaction) return true;
      await sleep(200);
    }
    return false;
  }

  async function runOnce() {
    const ok = await waitForProfileDom();
    if (!ok) return;

    const faction = extractFactionName();
    if (!faction) return;

    if (setNorm.has(norm(faction))) {
      removeExisting();
      insertBannerAndTag();
    }
  }

  // Initial run and keep up with SPA changes
  runOnce();

  const obs = new MutationObserver(() => runOnce());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      runOnce();
    }
  }, 400);
})();
