// Universal Twitch Drops Farmer - Background Service Worker (Manifest V3)

const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const CHECK_ALARM = 'TWITCH_DROPS_CHECK_ALARM';
const STATUS_ALARM = 'TWITCH_STATUS_FAST_ALARM';

// Default configuration
const DEFAULT_CONFIG = {
  selectedGame: 'auto',       // 'auto' or game name (e.g. 'Caliber')
  autoHopEnabled: true,       // Switch streamer if offline
  autoClaimEnabled: true,     // Automatically claim 100% drops
  notificationsEnabled: true, // Show desktop notifications
  claimedDropsHistory: []     // List of confirmed claimed drop IDs
};

let lastClaimAttemptTime = 0;
let lastSwitchedChannel = '';

async function getConfig() {
  const data = await chrome.storage.local.get('config');
  return Object.assign({}, DEFAULT_CONFIG, data.config || {});
}

async function setConfig(cfg) {
  await chrome.storage.local.set({ config: cfg });
}

async function getAuthToken() {
  try {
    const cookie = await chrome.cookies.get({ url: 'https://www.twitch.tv', name: 'auth-token' });
    return cookie ? cookie.value : null;
  } catch (e) {
    console.error('[Farmer BG] Failed to read auth cookie:', e);
    return null;
  }
}

async function fetchGraphQL(query, variables = {}) {
  const token = await getAuthToken();
  const headers = {
    'Client-Id': CLIENT_ID,
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `OAuth ${token}`;
  }

  const res = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables })
  });

  return await res.json();
}

// 1. Get Drop Campaigns & Progress
const INVENTORY_QUERY = `
query GetInventory {
  currentUser {
    id
    login
    inventory {
      dropCampaignsInProgress {
        id
        name
        status
        startAt
        endAt
        game {
          id
          name
          displayName
          boxArtURL
        }
        allow {
          isEnabled
          channels {
            id
            name
            displayName
          }
        }
        timeBasedDrops {
          id
          name
          requiredMinutesWatched
          benefitEdges {
            benefit {
              id
              name
              imageAssetURL
            }
          }
          self {
            isClaimed
            currentMinutesWatched
            dropInstanceID
          }
        }
      }
    }
  }
}
`;

async function getCampaigns() {
  try {
    const res = await fetchGraphQL(INVENTORY_QUERY);
    const campaigns = res?.data?.currentUser?.inventory?.dropCampaignsInProgress || [];
    return campaigns.filter(c => c.status === 'ACTIVE');
  } catch (e) {
    console.error('[Farmer BG] Error fetching campaigns:', e);
    return [];
  }
}

// 2. Check Live Streams for Whitelist
const CHECK_CHANNELS_QUERY = `
query CheckLiveStreams($logins: [String!]) {
  users(logins: $logins) {
    login
    displayName
    stream {
      id
      title
      viewersCount
      game {
        name
      }
    }
  }
}
`;

// 3. Search category streams if no whitelist (open drops)
const CATEGORY_STREAMS_QUERY = `
query GetCategoryStreams($gameName: String!) {
  game(name: $gameName) {
    id
    name
    streams(first: 20) {
      edges {
        node {
          broadcaster {
            login
            displayName
          }
          viewersCount
          title
        }
      }
    }
  }
}
`;

async function findBestStreamer(gameName, allowedChannels = []) {
  try {
    if (allowedChannels && allowedChannels.length > 0) {
      const logins = allowedChannels.map(c => c.name.toLowerCase());
      const res = await fetchGraphQL(CHECK_CHANNELS_QUERY, { logins });
      const users = res?.data?.users || [];
      const live = [];

      for (const u of users) {
        const s = u.stream;
        if (s && s.game?.name?.toLowerCase() === gameName.toLowerCase()) {
          live.push({
            login: u.login,
            displayName: u.displayName,
            viewers: s.viewersCount || 0,
            title: s.title || ''
          });
        }
      }

      live.sort((a, b) => b.viewers - a.viewers);
      return live[0] || null;
    } else {
      const res = await fetchGraphQL(CATEGORY_STREAMS_QUERY, { gameName });
      const edges = res?.data?.game?.streams?.edges || [];
      const live = edges.map(e => ({
        login: e.node.broadcaster.login,
        displayName: e.node.broadcaster.displayName,
        viewers: e.node.viewersCount || 0,
        title: e.node.title || ''
      }));

      live.sort((a, b) => b.viewers - a.viewers);
      return live[0] || null;
    }
  } catch (e) {
    console.error('[Farmer BG] Error finding best streamer:', e);
    return null;
  }
}

// Show desktop notification
async function notify(title, message) {
  const cfg = await getConfig();
  if (!cfg.notificationsEnabled) return;

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title,
    message: message
  });
}

// Trigger inventory claim via DOM & tabs
async function triggerInventoryClaim() {
  try {
    console.log('[Farmer BG] Triggering inventory claim...');
    
    // First, send message to all existing Twitch tabs (chat can claim drops too!)
    const allTwitchTabs = await chrome.tabs.query({ url: '*://*.twitch.tv/*' });
    for (const tab of allTwitchTabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'FORCE_CLAIM_DOM' }).catch(() => {});
    }

    // Next, check for drops/inventory tab
    const invTabs = await chrome.tabs.query({ url: '*://*.twitch.tv/drops/inventory*' });
    if (invTabs.length > 0) {
      chrome.tabs.reload(invTabs[0].id);
      setTimeout(() => {
        chrome.tabs.sendMessage(invTabs[0].id, { type: 'FORCE_CLAIM_DOM' }).catch(() => {});
      }, 3000);
    } else {
      // Create background tab for inventory, wait 15s for content script to click, then close
      const tab = await chrome.tabs.create({ url: 'https://www.twitch.tv/drops/inventory', active: false });
      setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { type: 'FORCE_CLAIM_DOM' }).catch(() => {});
      }, 4000);
      setTimeout(() => {
        chrome.tabs.remove(tab.id).catch(() => {});
      }, 16000);
    }
  } catch (e) {
    console.error('[Farmer BG] Error triggering inventory claim:', e);
  }
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text: text || '' });
  if (color) {
    chrome.action.setBadgeBackgroundColor({ color });
  }
}

// Global live status cache for Popup & Badge
let liveStatus = {
  state: 'NO_TABS',
  badgeText: 'OFF',
  badgeColor: '#ef4444',
  message: 'Нет открытых вкладок Twitch',
  detail: 'Откройте любую вкладку Twitch для запуска фарма',
  currentTabUrl: '',
  currentStreamer: '',
  targetGame: '',
  targetDropName: '',
  percent: 0,
  curMinutes: 0,
  reqMinutes: 0,
  hasClaimableDrop: false,
  claimableDropName: '',
  nextQueueDrop: null,
  isLiveDropsValid: false,
  timestamp: Date.now()
};

// Realtime Status Update
async function updateRealtimeStatus() {
  const cfg = await getConfig();
  const token = await getAuthToken();

  if (!token) {
    liveStatus = {
      state: 'NO_AUTH',
      badgeText: 'AUTH',
      badgeColor: '#ef4444',
      message: 'Требуется вход на Twitch',
      detail: 'Авторизуйтесь на twitch.tv в этом браузере',
      timestamp: Date.now()
    };
    setBadge('AUTH', '#ef4444');
    await chrome.storage.local.set({ liveStatus });
    return;
  }

  // 1. Check open Twitch tabs
  const allTwitchTabs = await chrome.tabs.query({ url: '*://*.twitch.tv/*' });
  if (allTwitchTabs.length === 0) {
    liveStatus = {
      state: 'NO_TABS',
      badgeText: 'OFF',
      badgeColor: '#ef4444',
      message: 'Все вкладки Twitch закрыты',
      detail: 'Фарм остановлен. Откройте любую вкладку Twitch.',
      currentStreamer: '',
      targetGame: cfg.selectedGame !== 'auto' ? cfg.selectedGame : '',
      percent: liveStatus.percent || 0,
      timestamp: Date.now()
    };
    setBadge('OFF', '#ef4444');
    await chrome.storage.local.set({ liveStatus });
    return;
  }

  // Find stream tab
  const streamTabs = allTwitchTabs.filter(t => 
    !t.url.includes('/drops/') && 
    !t.url.includes('/directory') && 
    !t.url.includes('/settings')
  );

  const mainStreamTab = streamTabs.length > 0 ? streamTabs[0] : allTwitchTabs[0];
  const match = mainStreamTab.url ? mainStreamTab.url.match(/twitch\.tv\/([a-zA-Z0-9_]+)/) : null;
  const currentStreamer = match ? match[1].toLowerCase() : '';

  // 2. Fetch current campaigns and progress
  const campaigns = await getCampaigns();
  if (campaigns.length === 0) {
    liveStatus = {
      state: 'ALL_CLAIMED',
      badgeText: 'DONE',
      badgeColor: '#3b82f6',
      message: 'Все доступные дропсы получены!',
      detail: 'На Twitch сейчас нет активных кампаний для фарма',
      currentStreamer,
      percent: 100,
      timestamp: Date.now()
    };
    setBadge('DONE', '#3b82f6');
    await chrome.storage.local.set({ liveStatus });
    return;
  }

  // Determine active campaign
  let targetCamp = null;
  if (cfg.selectedGame && cfg.selectedGame !== 'auto') {
    targetCamp = campaigns.find(c => c.game.name.toLowerCase() === cfg.selectedGame.toLowerCase());
  }
  if (!targetCamp) {
    for (const c of campaigns) {
      const hasUnclaimed = c.timeBasedDrops.some(d => !d.self?.isClaimed);
      if (hasUnclaimed) {
        targetCamp = c;
        break;
      }
    }
  }
  if (!targetCamp) targetCamp = campaigns[0];

  const gameName = targetCamp.game.name;
  const allowedChannels = targetCamp.allow?.channels || [];
  
  // Analyze all drops in active campaign
  const allDrops = targetCamp.timeBasedDrops || [];
  const unclaimedDrops = allDrops.filter(d => !d.self?.isClaimed);

  // Ready to claim drops (100% and not claimed yet)
  const readyDrops = unclaimedDrops.filter(d => (d.self?.currentMinutesWatched || 0) >= d.requiredMinutesWatched);
  const hasClaimable = readyDrops.length > 0;
  const claimableDrop = readyDrops[0] || null;

  // Active farming drop: if ready drop exists, farm drop might be next in queue
  let activeDrop = unclaimedDrops.find(d => (d.self?.currentMinutesWatched || 0) < d.requiredMinutesWatched);
  if (!activeDrop) {
    // Either all unclaimed are ready to claim, or all claimed
    activeDrop = unclaimedDrops[0] || allDrops[allDrops.length - 1];
  }

  const cur = activeDrop?.self?.currentMinutesWatched || 0;
  const req = activeDrop?.requiredMinutesWatched || 0;
  const pct = req > 0 ? Math.min(100, Math.floor((cur / req) * 100)) : 0;

  // Next drop in queue (next UNCLAIMED drop after activeDrop)
  const remainingUnclaimed = unclaimedDrops.filter(d => d.id !== activeDrop?.id);
  const nextDropObj = remainingUnclaimed.length > 0 ? remainingUnclaimed[0] : null;
  const nextQueueDrop = nextDropObj ? {
    name: nextDropObj.name,
    cur: nextDropObj.self?.currentMinutesWatched || 0,
    req: nextDropObj.requiredMinutesWatched,
    claimed: nextDropObj.self?.isClaimed || false,
    percent: nextDropObj.requiredMinutesWatched > 0 ? Math.min(100, Math.floor(((nextDropObj.self?.currentMinutesWatched || 0) / nextDropObj.requiredMinutesWatched) * 100)) : 0
  } : null;

  // 3. Check if current streamer is giving drops for this game
  let isChannelValid = false;
  let streamerOnline = false;
  let streamerCurrentGame = '';

  if (currentStreamer) {
    const inWhitelist = allowedChannels.length > 0 ? 
      allowedChannels.some(c => c.name.toLowerCase() === currentStreamer) : true;

    const liveRes = await fetchGraphQL(CHECK_CHANNELS_QUERY, { logins: [currentStreamer] });
    const s = liveRes?.data?.users?.[0]?.stream;
    if (s) {
      streamerOnline = true;
      streamerCurrentGame = s.game?.name || '';
      if (inWhitelist && streamerCurrentGame.toLowerCase() === gameName.toLowerCase()) {
        isChannelValid = true;
      }
    }
  }

  // 4. Formulate status
  const badgeShowText = hasClaimable ? 'CLAIM' : `${pct}%`;
  const badgeShowColor = hasClaimable ? '#f59e0b' : '#10b981';

  if (unclaimedDrops.length === 0) {
    liveStatus = {
      state: 'ALL_CLAIMED',
      badgeText: 'DONE',
      badgeColor: '#3b82f6',
      message: '🎉 Все награды получены!',
      detail: `Все доступные дропсы кампании ${gameName} забраны на 100%!`,
      currentStreamer,
      targetGame: gameName,
      targetDropName: activeDrop?.name || '',
      percent: 100,
      curMinutes: req,
      reqMinutes: req,
      hasClaimableDrop: false,
      claimableDropName: '',
      nextQueueDrop: null,
      isLiveDropsValid: true,
      timestamp: Date.now()
    };
    setBadge('DONE', '#3b82f6');
  } else if (isChannelValid) {
    liveStatus = {
      state: 'ACTIVE',
      badgeText: badgeShowText,
      badgeColor: badgeShowColor,
      message: `🟢 Фарм активен: ${currentStreamer}`,
      detail: `Смотрим ${currentStreamer} (${streamerCurrentGame}) — дропсы начисляются!`,
      currentStreamer,
      targetGame: gameName,
      targetDropName: activeDrop?.name || '',
      percent: pct,
      curMinutes: cur,
      reqMinutes: req,
      hasClaimableDrop: hasClaimable,
      claimableDropName: claimableDrop?.name || '',
      nextQueueDrop: nextQueueDrop,
      isLiveDropsValid: true,
      timestamp: Date.now()
    };
    setBadge(badgeShowText, badgeShowColor);
  } else if (!streamerOnline) {
    liveStatus = {
      state: 'WAITING',
      badgeText: hasClaimable ? 'CLAIM' : 'WAIT',
      badgeColor: '#f59e0b',
      message: `🟡 Стрим ${currentStreamer || 'канала'} оффлайн`,
      detail: `Авто-хоппер мониторит эфир и переключит стрим сразу при запуске трансляции`,
      currentStreamer,
      targetGame: gameName,
      targetDropName: activeDrop?.name || '',
      percent: pct,
      curMinutes: cur,
      reqMinutes: req,
      hasClaimableDrop: hasClaimable,
      claimableDropName: claimableDrop?.name || '',
      nextQueueDrop: nextQueueDrop,
      isLiveDropsValid: false,
      timestamp: Date.now()
    };
    setBadge(hasClaimable ? 'CLAIM' : 'WAIT', '#f59e0b');
  } else {
    const isPlayingTargetGame = streamerCurrentGame.toLowerCase() === gameName.toLowerCase();
    const inWhitelist = allowedChannels.length > 0 ? 
      allowedChannels.some(c => c.name.toLowerCase() === currentStreamer) : true;

    let msg = "";
    let det = "";
    if (isPlayingTargetGame && !inWhitelist) {
      msg = `⚠️ У канала ${currentStreamer} нет Drops`;
      det = `Стример играет в ${gameName}, но не входит в официальный список партнеров кампании (дропсы не начисляются). Ждем эфира с Drops!`;
    } else if (!isPlayingTargetGame) {
      msg = `⚠️ Канал ${currentStreamer} транслирует другое`;
      det = `Стример сейчас играет в «${streamerCurrentGame || 'другую игру'}» вместо «${gameName}». Дропсы временно на паузе.`;
    } else {
      msg = `⚠️ На канале ${currentStreamer} дропсы неактивны`;
      det = `Дропсы для ${gameName} на этом канале не начисляются. Авто-хоппер ищет стрим с поддержкой Drops.`;
    }

    liveStatus = {
      state: 'WRONG_CHANNEL',
      badgeText: hasClaimable ? 'CLAIM' : 'PAUSE',
      badgeColor: '#f59e0b',
      message: msg,
      detail: det,
      currentStreamer,
      targetGame: gameName,
      targetDropName: activeDrop?.name || '',
      percent: pct,
      curMinutes: cur,
      reqMinutes: req,
      hasClaimableDrop: hasClaimable,
      claimableDropName: claimableDrop?.name || '',
      nextQueueDrop: nextQueueDrop,
      isLiveDropsValid: false,
      timestamp: Date.now()
    };
    setBadge(hasClaimable ? 'CLAIM' : 'PAUSE', '#f59e0b');
  }

  // Save full state
  await chrome.storage.local.set({
    liveStatus,
    lastStatus: {
      timestamp: Date.now(),
      gameName,
      campaigns: campaigns.map(c => ({
        id: c.id,
        game: c.game.name,
        displayName: c.game.displayName || c.game.name,
        boxArtURL: c.game.boxArtURL,
        drops: c.timeBasedDrops.map(d => ({
          id: d.id,
          name: d.name,
          req: d.requiredMinutesWatched,
          cur: d.self?.currentMinutesWatched || 0,
          claimed: d.self?.isClaimed || false
        }))
      }))
    }
  });

  return { targetCamp, isChannelValid, mainStreamTab, hasClaimable, readyDrops };
}

// Main cycle (Hopping + Auto-Claim)
async function runCheckCycle() {
  const cfg = await getConfig();
  const res = await updateRealtimeStatus();
  if (!res || !res.targetCamp) return;

  const { targetCamp, isChannelValid, mainStreamTab, hasClaimable, readyDrops } = res;
  const gameName = targetCamp.game.name;
  const allowedChannels = targetCamp.allow?.channels || [];

  // Check confirmed claims to update history and notify
  for (const d of targetCamp.timeBasedDrops) {
    if (d.self?.isClaimed && !cfg.claimedDropsHistory.includes(d.id)) {
      cfg.claimedDropsHistory.push(d.id);
      await setConfig(cfg);
      console.log(`[Farmer BG] Confirmed claim: «${d.name}» (${gameName})!`);
      notify('🎉 Награда получена!', `Дропс «${d.name}» (${gameName}) успешно забран в инвентарь!`);
    }
  }

  // Trigger claim if any drop is 100% ready and not claimed
  if (cfg.autoClaimEnabled && hasClaimable) {
    const now = Date.now();
    if (now - lastClaimAttemptTime > 40000) { // at least 40s between claim attempts
      lastClaimAttemptTime = now;
      const firstReady = readyDrops[0];
      console.log(`[Farmer BG] Drop ${firstReady.name} is 100% READY! Attempting claim...`);
      notify('🎁 Забираю награду', `Дропс «${firstReady.name}» готов на 100%! Забираем в инвентарь...`);
      triggerInventoryClaim();
    }
  }

  // Auto-Hopper if current stream is invalid or offline
  if (cfg.autoHopEnabled && !isChannelValid && mainStreamTab) {
    const best = await findBestStreamer(gameName, allowedChannels);
    if (best && best.login !== lastSwitchedChannel) {
      lastSwitchedChannel = best.login;
      const newUrl = `https://www.twitch.tv/${best.login}`;
      console.log(`[Farmer BG] Hopping to live streamer: ${best.displayName} (${newUrl})`);
      chrome.tabs.update(mainStreamTab.id, { url: newUrl });
      notify('🔄 Стрим переключен', `Стример оффлайн. Переключились на ${best.displayName} (${best.viewers} зрителей, ${gameName})!`);
      setTimeout(updateRealtimeStatus, 3000);
    }
  }
}

// Alarms setup
chrome.alarms.create(CHECK_ALARM, { periodInMinutes: 1 });
chrome.alarms.create(STATUS_ALARM, { periodInMinutes: 0.5 }); // every 30s status check

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === CHECK_ALARM) {
    runCheckCycle();
  } else if (alarm.name === STATUS_ALARM) {
    updateRealtimeStatus();
  }
});

// Realtime tab events for INSTANT badge update!
chrome.tabs.onRemoved.addListener(() => {
  setTimeout(updateRealtimeStatus, 500);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes('twitch.tv')) {
    setTimeout(updateRealtimeStatus, 1000);
  }
});
chrome.tabs.onCreated.addListener(tab => {
  if (tab.url && tab.url.includes('twitch.tv')) {
    setTimeout(updateRealtimeStatus, 1000);
  }
});

// Initial run
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Farmer BG] Universal Twitch Drops Extension installed!');
  updateRealtimeStatus();
  runCheckCycle();
});

// Listen for popup messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'FORCE_CHECK') {
    runCheckCycle().then(() => updateRealtimeStatus()).then(() => sendResponse({ status: 'ok' }));
    return true;
  }
  if (msg.type === 'OPEN_TWITCH') {
    chrome.tabs.create({ url: 'https://www.twitch.tv/directory/game/Caliber' });
    sendResponse({ status: 'ok' });
    return true;
  }
  if (msg.type === 'TRIGGER_CLAIM_NOW') {
    triggerInventoryClaim().then(() => {
      setTimeout(updateRealtimeStatus, 3000);
      sendResponse({ status: 'ok' });
    });
    return true;
  }
  if (msg.type === 'DROP_CLAIMED_FROM_DOM') {
    notify('🎁 Дропс нажат!', 'Кнопка забора дропса успешно нажата в интерфейсе!');
    setTimeout(updateRealtimeStatus, 2500);
  }
  if (msg.type === 'BONUS_CLAIMED') {
    console.log('[Farmer BG] Channel bonus (+50) claimed!');
  }
});
