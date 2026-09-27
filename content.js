// Universal Twitch Drops Farmer - Content Script

(function() {
  'use strict';

  let pointsBonusClaimedCount = 0;
  let dropsClaimedCount = 0;

  // 1. Claim channel points (+50 bonus) in stream chat
  function claimBonus() {
    try {
      const bonusSelectors = [
        '.claimable-bonus__icon',
        'button[aria-label*="Claim Bonus" i]',
        'button[aria-label*="Получить бонус" i]',
        'div.community-points-summary button'
      ];

      for (const sel of bonusSelectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null && !btn.disabled) {
          btn.click();
          pointsBonusClaimedCount++;
          console.log(`[TwitchDropsFarmer] Claimed Channel Points bonus (+50)! Total: ${pointsBonusClaimedCount}`);
          chrome.runtime.sendMessage({ type: 'BONUS_CLAIMED' }).catch(() => {});
          break;
        }
      }
    } catch (e) {
      console.error('[TwitchDropsFarmer] Error claiming points bonus:', e);
    }
  }

  // 2. Claim Drops buttons in Chat or on Inventory page
  function claimDropsInChatOrInventory() {
    try {
      // Chat claim buttons by data-test-selector
      const testDropButtons = document.querySelectorAll('[data-test-selector="DropsClaimButton"]');
      for (const btn of testDropButtons) {
        if (btn && btn.offsetParent !== null && !btn.disabled) {
          btn.click();
          dropsClaimedCount++;
          console.log(`[TwitchDropsFarmer] Clicked DropsClaimButton in Chat! Total: ${dropsClaimedCount}`);
          chrome.runtime.sendMessage({ type: 'DROP_CLAIMED_FROM_DOM' }).catch(() => {});
          return;
        }
      }

      // Universal scan for buttons containing "claim" / "получить" / "забрать"
      const allButtons = document.querySelectorAll('button, [role="button"]');
      for (const btn of allButtons) {
        if (!btn || btn.offsetParent === null || btn.disabled) continue;

        const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();

        const isClaim = 
          txt.includes('получить сейчас') || 
          txt.includes('claim now') || 
          txt === 'получить' || 
          txt === 'забрать' || 
          txt === 'claim' || 
          aria.includes('claim now') || 
          aria.includes('получить сейчас');

        // Prevent clicking false-positive buttons (e.g. Subscribe / Prime / Gift)
        if (isClaim && !txt.includes('подписк') && !txt.includes('sub') && !txt.includes('prime')) {
          console.log(`[TwitchDropsFarmer] Clicked Drop Claim button: "${btn.innerText.trim()}"!`);
          btn.click();
          dropsClaimedCount++;
          chrome.runtime.sendMessage({ type: 'DROP_CLAIMED_FROM_DOM' }).catch(() => {});
          return;
        }
      }
    } catch (e) {
      console.error('[TwitchDropsFarmer] Error in claimDropsInChatOrInventory:', e);
    }
  }

  // Periodic intervals
  setInterval(claimBonus, 12000);
  setInterval(claimDropsInChatOrInventory, 15000);

  // Intensive check on Inventory page
  if (window.location.href.includes('/drops/inventory')) {
    setTimeout(claimDropsInChatOrInventory, 1500);
    setTimeout(claimDropsInChatOrInventory, 3500);
    setTimeout(claimDropsInChatOrInventory, 6000);
    setTimeout(claimDropsInChatOrInventory, 10000);
  }

  // Unpause video if paused on stream load
  function ensurePlayback() {
    try {
      const video = document.querySelector('video');
      if (video && video.paused) {
        video.play().catch(() => {});
      }
    } catch (e) {}
  }
  setTimeout(ensurePlayback, 3000);

  // Listen to background commands
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FORCE_CLAIM_DOM') {
      claimDropsInChatOrInventory();
      sendResponse({ status: 'ok' });
    }
  });

  console.log('[TwitchDropsFarmer] Content script loaded successfully!');
})();
