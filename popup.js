// Universal Twitch Drops Farmer - Enhanced Popup UI Logic

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const statusBanner = document.getElementById('status-banner');
  const statusDot = document.getElementById('status-dot');
  const statusHeadline = document.getElementById('status-headline');
  const statusDetail = document.getElementById('status-detail');
  const openTwitchBtn = document.getElementById('open-twitch-btn');

  const claimAlertBox = document.getElementById('claim-alert-box');
  const claimAlertName = document.getElementById('claim-alert-name');
  const claimNowBtn = document.getElementById('claim-now-btn');

  const gameSelect = document.getElementById('game-select');
  const cardGameName = document.getElementById('card-game-name');
  const cardPercent = document.getElementById('card-percent');
  const cardDropName = document.getElementById('card-drop-name');
  const cardProgressBar = document.getElementById('card-progress-bar');
  const cardTimeLabel = document.getElementById('card-time-label');
  const cardChannelInfo = document.getElementById('card-channel-info');

  const nextDropRow = document.getElementById('next-drop-row');
  const nextDropVal = document.getElementById('next-drop-val');

  const dropsAccordionBtn = document.getElementById('drops-accordion-btn');
  const dropsAccordionContent = document.getElementById('drops-accordion-content');
  const accordionIcon = document.getElementById('accordion-icon');
  const accordionTitle = document.getElementById('accordion-title');
  const allDropsList = document.getElementById('all-drops-list');

  const toggleClaim = document.getElementById('toggle-claim');
  const toggleHop = document.getElementById('toggle-hop');
  const toggleNotify = document.getElementById('toggle-notify');
  const refreshBtn = document.getElementById('refresh-btn');
  const footerStatus = document.getElementById('footer-status');

  // Load saved configuration and statuses
  const store = await chrome.storage.local.get(['config', 'lastStatus', 'liveStatus']);
  const config = store.config || {
    selectedGame: 'auto',
    autoHopEnabled: true,
    autoClaimEnabled: true,
    notificationsEnabled: true
  };

  toggleClaim.checked = config.autoClaimEnabled !== false;
  toggleHop.checked = config.autoHopEnabled !== false;
  toggleNotify.checked = config.notificationsEnabled !== false;

  // Accordion toggle
  let isAccordionOpen = false;
  dropsAccordionBtn.addEventListener('click', () => {
    isAccordionOpen = !isAccordionOpen;
    dropsAccordionContent.style.display = isAccordionOpen ? 'block' : 'none';
    accordionIcon.classList.toggle('open', isAccordionOpen);
  });

  // Claim Now button click
  claimNowBtn.addEventListener('click', () => {
    claimNowBtn.textContent = '⏳ Забираю в инвентарь...';
    claimNowBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'TRIGGER_CLAIM_NOW' }, () => {
      setTimeout(() => {
        claimNowBtn.textContent = '⚡ Забрать в инвентарь сейчас';
        claimNowBtn.disabled = false;
        refreshAll();
      }, 3500);
    });
  });

  function renderLiveBanner(live) {
    if (!live) {
      statusDot.className = 'status-dot warning';
      statusHeadline.textContent = 'Ожидание статуса...';
      statusDetail.textContent = 'Нажмите 🔄 для проверки соединения с Twitch';
      openTwitchBtn.style.display = 'none';
      return;
    }

    switch (live.state) {
      case 'ACTIVE':
        statusDot.className = 'status-dot active';
        statusHeadline.textContent = `🟢 Фарм активен: ${live.currentStreamer || 'Стрим'}`;
        statusDetail.textContent = live.detail || `Смотрим ${live.currentStreamer} — дропсы начисляются!`;
        statusBanner.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        openTwitchBtn.style.display = 'none';
        break;

      case 'NO_TABS':
        statusDot.className = 'status-dot danger';
        statusHeadline.textContent = '🔴 Вкладка Twitch закрыта!';
        statusDetail.textContent = 'Фарм остановлен. Чтобы дропсы начислялись, откройте трансляцию на Twitch.';
        statusBanner.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        openTwitchBtn.style.display = 'block';
        break;

      case 'WRONG_CHANNEL':
        statusDot.className = 'status-dot warning';
        statusHeadline.textContent = live.message || `⚠️ У канала ${live.currentStreamer} нет Drops`;
        statusDetail.textContent = live.detail || '';
        statusBanner.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        openTwitchBtn.style.display = 'none';
        break;

      case 'WAITING':
        statusDot.className = 'status-dot warning';
        statusHeadline.textContent = '🟡 Ожидание живого эфира';
        statusDetail.textContent = live.detail || `Все стримеры по игре ${live.targetGame || ''} оффлайн. Авто-хоппер мониторит эфир.`;
        statusBanner.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        openTwitchBtn.style.display = 'none';
        break;

      case 'ALL_CLAIMED':
        statusDot.className = 'status-dot active';
        statusHeadline.textContent = '🎉 Все награды получены!';
        statusDetail.textContent = `Все доступные дропсы кампании ${live.targetGame || ''} собраны на 100%!`;
        statusBanner.style.borderColor = 'rgba(59, 130, 246, 0.4)';
        openTwitchBtn.style.display = 'none';
        break;

      case 'NO_AUTH':
        statusDot.className = 'status-dot danger';
        statusHeadline.textContent = '🔒 Требуется вход на Twitch';
        statusDetail.textContent = 'Войдите в свой аккаунт на twitch.tv в этом браузере.';
        statusBanner.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        openTwitchBtn.style.display = 'block';
        openTwitchBtn.textContent = '▶️ Войти на Twitch';
        break;

      default:
        statusDot.className = 'status-dot warning';
        statusHeadline.textContent = live.message || 'Проверка...';
        statusDetail.textContent = live.detail || '';
        openTwitchBtn.style.display = 'none';
    }
  }

  function renderStatus(statusData, live) {
    renderLiveBanner(live);

    // 1. Ready to Claim Banner
    if (live && live.hasClaimableDrop) {
      claimAlertBox.style.display = 'block';
      claimAlertName.textContent = live.claimableDropName ? `«${live.claimableDropName}»` : 'Награда готова на 100%';
    } else {
      claimAlertBox.style.display = 'none';
    }

    if (!statusData || !statusData.campaigns || statusData.campaigns.length === 0) {
      cardGameName.textContent = 'Нет активных кампаний';
      cardPercent.textContent = '0%';
      cardDropName.textContent = 'Нажмите 🔄 для проверки Twitch';
      cardProgressBar.style.width = '0%';
      cardTimeLabel.textContent = '0 / 0 мин';
      cardChannelInfo.textContent = 'Канал: —';
      nextDropRow.style.display = 'none';
      accordionTitle.textContent = '📋 Все награды (0)';
      allDropsList.innerHTML = '<div style="color: var(--text-muted); font-size: 11px;">Нет данных</div>';
      footerStatus.textContent = 'Ожидание Twitch';
      return;
    }

    // Populate dropdown
    const currentSelected = config.selectedGame || 'auto';
    gameSelect.innerHTML = '<option value="auto">⚡ Авто-выбор (следующая доступная)</option>';
    
    statusData.campaigns.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.game;
      opt.textContent = `${c.displayName} (${c.drops.length} наград)`;
      if (c.game.toLowerCase() === currentSelected.toLowerCase()) {
        opt.selected = true;
      }
      gameSelect.appendChild(opt);
    });

    // Find active campaign
    let activeCamp = null;
    if (currentSelected !== 'auto') {
      activeCamp = statusData.campaigns.find(c => c.game.toLowerCase() === currentSelected.toLowerCase());
    }
    if (!activeCamp) {
      activeCamp = statusData.campaigns.find(c => c.drops.some(d => !d.claimed)) || statusData.campaigns[0];
    }

    if (activeCamp) {
      cardGameName.textContent = activeCamp.displayName || activeCamp.game;

      // Drop progress
      const targetDropName = live?.targetDropName;
      let displayDrop = null;
      if (targetDropName) {
        displayDrop = activeCamp.drops.find(d => d.name === targetDropName);
      }
      if (!displayDrop) {
        displayDrop = activeCamp.drops.find(d => !d.claimed) || activeCamp.drops[activeCamp.drops.length - 1];
      }

      if (displayDrop) {
        cardDropName.textContent = displayDrop.name;
        const pct = displayDrop.req > 0 ? Math.min(100, Math.floor((displayDrop.cur / displayDrop.req) * 100)) : 0;
        cardPercent.textContent = `${pct}%`;
        cardProgressBar.style.width = `${pct}%`;
        cardTimeLabel.textContent = `${displayDrop.cur} / ${displayDrop.req} мин`;

        if (pct >= 100 && !displayDrop.claimed) {
          cardPercent.textContent = 'Готов!';
          cardPercent.style.color = '#f59e0b';
        } else if (displayDrop.claimed) {
          cardPercent.textContent = 'Забран';
          cardPercent.style.color = '#10b981';
        } else {
          cardPercent.style.color = '#f59e0b';
        }
      }

      // Next in queue
      if (live?.nextQueueDrop) {
        nextDropRow.style.display = 'flex';
        nextDropVal.textContent = `${live.nextQueueDrop.name} (${live.nextQueueDrop.percent}%)`;
      } else {
        nextDropRow.style.display = 'none';
      }

      if (live && live.currentStreamer) {
        cardChannelInfo.textContent = `Канал: ${live.currentStreamer}`;
      } else {
        cardChannelInfo.textContent = 'Канал: не открыт';
      }

      // Render All Drops in Campaign
      const claimedCount = activeCamp.drops.filter(d => d.claimed).length;
      accordionTitle.textContent = `📋 Награды кампании (${claimedCount} из ${activeCamp.drops.length})`;
      
      allDropsList.innerHTML = '';
      activeCamp.drops.forEach(d => {
        const item = document.createElement('div');
        const isCurrent = displayDrop && d.id === displayDrop.id;
        item.className = `drop-item ${d.claimed ? 'claimed' : ''} ${isCurrent ? 'current' : ''}`;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'drop-item-name';
        nameSpan.textContent = d.name;
        nameSpan.title = d.name;

        const statusSpan = document.createElement('span');
        statusSpan.className = 'drop-item-status';

        const dPct = d.req > 0 ? Math.min(100, Math.floor((d.cur / d.req) * 100)) : 0;

        if (d.claimed) {
          statusSpan.className += ' status-tag-claimed';
          statusSpan.textContent = '✅ Получено';
        } else if (dPct >= 100) {
          statusSpan.className += ' status-tag-ready';
          statusSpan.textContent = '🎁 100% Готов';
        } else {
          statusSpan.className += ' status-tag-prog';
          statusSpan.textContent = `⏳ ${dPct}% (${d.cur}/${d.req}м)`;
        }

        item.appendChild(nameSpan);
        item.appendChild(statusSpan);
        allDropsList.appendChild(item);
      });

      footerStatus.textContent = `Активно: ${activeCamp.displayName || activeCamp.game}`;
    }
  }

  // Initial render
  renderStatus(store.lastStatus, store.liveStatus);

  // Quick Action: Open Twitch
  openTwitchBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'OPEN_TWITCH' });
    setTimeout(refreshAll, 1500);
  });

  // Event Listeners for Toggles
  async function saveConfig() {
    config.autoClaimEnabled = toggleClaim.checked;
    config.autoHopEnabled = toggleHop.checked;
    config.notificationsEnabled = toggleNotify.checked;
    config.selectedGame = gameSelect.value;
    await chrome.storage.local.set({ config });
  }

  toggleClaim.addEventListener('change', saveConfig);
  toggleHop.addEventListener('change', saveConfig);
  toggleNotify.addEventListener('change', saveConfig);

  gameSelect.addEventListener('change', async () => {
    await saveConfig();
    refreshAll();
  });

  function refreshAll() {
    refreshBtn.style.transform = 'rotate(360deg)';
    footerStatus.textContent = 'Обновляю...';
    chrome.runtime.sendMessage({ type: 'FORCE_CHECK' }, async () => {
      setTimeout(async () => {
        refreshBtn.style.transform = 'none';
        const fresh = await chrome.storage.local.get(['lastStatus', 'liveStatus']);
        renderStatus(fresh.lastStatus, fresh.liveStatus);
      }, 700);
    });
  }

  refreshBtn.addEventListener('click', refreshAll);
});
