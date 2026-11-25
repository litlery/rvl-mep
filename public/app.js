'use strict';

(function () {
  const STORAGE_KEY = 'rvl_mep_poll_user_v1';

  const state = {
    user: null, // { nickname, telegram, isAdmin }
    tracks: [],
    stats: {},
    voters: [],
    totalVoters: 0,
    myVote: null,
    selectedIds: new Set(),
    fpsOptions: [],
    fpsStats: {},
    fpsVoters: [],
    totalFpsVoters: 0,
    myFpsVote: null,
    selectedFpsIds: new Set(),
    fpsVotersOpen: false,
    sortBy: 'default',
    searchQuery: '',
    votersOpen: false,
    playingTrackId: null,
    audio: new Audio(),
    isSeeking: false,
    eventSource: null,
  };

  state.audio.preload = 'metadata';

  // DOM elements
  const authScreen = document.getElementById('authScreen');
  const authForm = document.getElementById('authForm');
  const nicknameInput = document.getElementById('nicknameInput');
  const telegramInput = document.getElementById('telegramInput');
  const authError = document.getElementById('authError');
  const authIpNotice = document.getElementById('authIpNotice');
  const authSubmitBtn = document.getElementById('authSubmitBtn');

  const pollApp = document.getElementById('pollApp');
  const liveStatus = document.getElementById('liveStatus');
  const totalVotersPill = document.getElementById('totalVotersPill');
  const userAvatar = document.getElementById('userAvatar');
  const userNickDisplay = document.getElementById('userNickDisplay');
  const userTgDisplay = document.getElementById('userTgDisplay');
  const adminBadge = document.getElementById('adminBadge');
  const adminResetBtn = document.getElementById('adminResetBtn');
  const switchUserBtn = document.getElementById('switchUserBtn');

  const voteLockBanner = document.getElementById('voteLockBanner');
  const votersAccordion = document.getElementById('votersAccordion');
  const votersToggle = document.getElementById('votersToggle');
  const votersCountBadge = document.getElementById('votersCountBadge');
  const votersHint = document.getElementById('votersHint');
  const votersBody = document.getElementById('votersBody');
  const votersList = document.getElementById('votersList');

  const totalFpsVotersPill = document.getElementById('totalFpsVotersPill');
  const fpsLockBanner = document.getElementById('fpsLockBanner');
  const fpsVotersAccordion = document.getElementById('fpsVotersAccordion');
  const fpsVotersToggle = document.getElementById('fpsVotersToggle');
  const fpsVotersCountBadge = document.getElementById('fpsVotersCountBadge');
  const fpsVotersHint = document.getElementById('fpsVotersHint');
  const fpsVotersBody = document.getElementById('fpsVotersBody');
  const fpsVotersList = document.getElementById('fpsVotersList');
  const fpsOptionsList = document.getElementById('fpsOptionsList');
  const fpsSubmitRow = document.getElementById('fpsSubmitRow');
  const fpsSelectedCount = document.getElementById('fpsSelectedCount');
  const submitFpsBtn = document.getElementById('submitFpsBtn');

  const searchInput = document.getElementById('searchInput');
  const sortButtons = document.querySelectorAll('.sort-btn');
  const tracksList = document.getElementById('tracksList');

  const submitBar = document.getElementById('submitBar');
  const selectedCountEl = document.getElementById('selectedCount');
  const clearSelectionBtn = document.getElementById('clearSelectionBtn');
  const submitVoteBtn = document.getElementById('submitVoteBtn');

  const resetModal = document.getElementById('resetModal');
  const cancelResetBtn = document.getElementById('cancelResetBtn');
  const confirmResetBtn = document.getElementById('confirmResetBtn');

  const deleteVoteModal = document.getElementById('deleteVoteModal');
  const deleteVoteModalText = document.getElementById('deleteVoteModalText');
  const cancelDeleteVoteBtn = document.getElementById('cancelDeleteVoteBtn');
  const confirmDeleteVoteBtn = document.getElementById('confirmDeleteVoteBtn');
  let pendingDeleteVote = null;

  const toastContainer = document.getElementById('toastContainer');

  const PLAY_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6,4 20,12 6,20"/></svg>';
  const PAUSE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
  const CHECK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  function showToast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      el.style.transition = 'all 0.2s ease';
      setTimeout(() => el.remove(), 220);
    }, 3800);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatDateTime(iso) {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  function pluralPeople(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return `${n} чел.`;
    return `${n} чел.`;
  }

  function formatPercent(val) {
    if (!val) return '0%';
    return Number.isInteger(val) ? `${val}%` : `${val.toFixed(1)}%`;
  }

  function getTrackMap() {
    const map = new Map();
    for (const t of state.tracks) map.set(t.id, t);
    return map;
  }

  function applyServerState(data) {
    const tracksChanged =
      state.tracks.length !== (data.tracks || []).length ||
      state.tracks.some((t, idx) => t.id !== data.tracks[idx].id);

    state.tracks = data.tracks || [];
    state.stats = data.stats || {};
    state.voters = data.voters || [];
    state.totalVoters = data.totalVoters || 0;
    state.myVote = data.myVote || null;

    state.fpsOptions = data.fpsOptions || [];
    state.fpsStats = data.fpsStats || {};
    state.fpsVoters = data.fpsVoters || [];
    state.totalFpsVoters = data.totalFpsVoters || 0;
    state.myFpsVote = data.myFpsVote || null;

    if (data.reason === 'reset') {
      state.selectedIds.clear();
      state.selectedFpsIds.clear();
      showToast('Администратор сбросил все ответы. Можно голосовать заново.', 'info');
    }

    if (state.myVote && !authScreen.classList.contains('hidden')) {
      authIpNotice.textContent = `С вашего IP-адреса уже отправлен голос (${state.myVote.nickname}, ${state.myVote.telegram}). Вы можете войти, чтобы посмотреть статистику.`;
      authIpNotice.classList.remove('hidden');
    } else {
      authIpNotice.classList.add('hidden');
    }

    if (state.user) {
      renderHeaderStats();
      renderVoteLockBanner();
      renderVotersList();
      renderFpsSection();
      if (tracksChanged || tracksList.children.length === 0) {
        renderTracksFull();
      } else {
        updateTrackStatsInPlace();
      }
      renderSubmitBar();
    }
  }

  function renderHeaderStats() {
    totalVotersPill.textContent = `Проголосовало: ${state.totalVoters}`;
    votersCountBadge.textContent = String(state.totalVoters);
    totalFpsVotersPill.textContent = `Проголосовало: ${state.totalFpsVoters}`;
    fpsVotersCountBadge.textContent = String(state.totalFpsVoters);
  }

  function renderFpsSection() {
    // Banner
    if (!state.myFpsVote) {
      fpsLockBanner.classList.add('hidden');
    } else {
      const isSame =
        state.user &&
        state.myFpsVote.telegram.toLowerCase() === state.user.telegram.toLowerCase();
      if (isSame) {
        fpsLockBanner.className = 'banner banner-success';
        fpsLockBanner.innerHTML = `<span><strong>Ваш голос за FPS учтён!</strong> (${escapeHtml(state.myFpsVote.fpsIds.join(', '))})</span>`;
      } else {
        fpsLockBanner.className = 'banner banner-warning';
        fpsLockBanner.innerHTML = `<span><strong>Голосование за FPS с этого IP недоступно:</strong> ранее проголосовал(а) <strong>${escapeHtml(state.myFpsVote.nickname)}</strong> (${escapeHtml(state.myFpsVote.telegram)}).</span>`;
      }
      fpsLockBanner.classList.remove('hidden');
    }

    // Voters list
    const isAdmin = Boolean(state.user && state.user.isAdmin);
    if (state.fpsVoters.length === 0) {
      fpsVotersList.innerHTML = '<div class="voters-empty">За FPS пока никто не проголосовал.</div>';
    } else {
      fpsVotersList.innerHTML = state.fpsVoters
        .map((voter) => {
          const tgClean = voter.telegram.replace(/^@/, '');
          const pills = voter.fpsIds
            .map((fid) => `<span class="voter-track-pill">${escapeHtml(fid)}</span>`)
            .join('');
          const delBtn = isAdmin
            ? `<button type="button" class="voter-delete-btn" data-action="delete-vote" data-vote-kind="fps" data-vote-id="${escapeHtml(voter.id)}" data-vote-nick="${escapeHtml(voter.nickname)}" data-vote-tg="${escapeHtml(voter.telegram)}">Удалить</button>`
            : '';
          return `
            <div class="voter-row">
              <div class="voter-row-top">
                <div class="voter-identity">
                  <span class="voter-nick">${escapeHtml(voter.nickname)}</span>
                  <a class="voter-tg" href="https://t.me/${encodeURIComponent(tgClean)}" target="_blank" rel="noopener noreferrer">${escapeHtml(voter.telegram)}</a>
                </div>
                <div class="voter-right-meta">
                  <span class="voter-time">${escapeHtml(formatDateTime(voter.votedAt))}</span>
                  ${delBtn}
                </div>
              </div>
              <div class="voter-tracks">${pills}</div>
            </div>
          `;
        })
        .join('');
    }

    // Options grid
    const isLocked = Boolean(state.myFpsVote);
    const mySet = new Set(state.myFpsVote ? state.myFpsVote.fpsIds : []);
    fpsOptionsList.innerHTML = state.fpsOptions
      .map((opt) => {
        const st = state.fpsStats[opt.id] || { count: 0, percent: 0 };
        const isSelected = !isLocked && state.selectedFpsIds.has(opt.id);
        const isMyVoted = isLocked && mySet.has(opt.id);
        const cls = [
          'fps-card',
          isSelected ? 'selected' : '',
          isMyVoted ? 'voted-mine' : '',
          isLocked ? 'locked' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `
          <div class="${cls}" data-fps-id="${escapeHtml(opt.id)}">
            <div class="fps-card-top">
              <div class="fps-left">
                <span class="track-check" aria-hidden="true">${CHECK_SVG}</span>
                <span class="fps-label">${escapeHtml(opt.label)}</span>
              </div>
              ${isMyVoted ? '<span class="my-choice-tag">Ваш выбор</span>' : ''}
            </div>
            <div class="fps-card-meta">
              <span class="stat-percent">${formatPercent(st.percent)}</span>
              <span class="stat-count">${pluralPeople(st.count)}</span>
            </div>
            <div class="vote-bar-bg">
              <div class="vote-bar-fill" style="width: ${st.percent}%"></div>
            </div>
          </div>
        `;
      })
      .join('');

    // Submit row
    if (!state.user || isLocked) {
      fpsSubmitRow.classList.add('hidden');
    } else {
      fpsSubmitRow.classList.remove('hidden');
      fpsSelectedCount.textContent = String(state.selectedFpsIds.size);
      submitFpsBtn.disabled = state.selectedFpsIds.size === 0;
    }
  }

  function renderVoteLockBanner() {
    if (!state.myVote) {
      voteLockBanner.classList.add('hidden');
      return;
    }

    const isSamePerson =
      state.user &&
      state.myVote.telegram.toLowerCase() === state.user.telegram.toLowerCase();

    if (isSamePerson) {
      voteLockBanner.className = 'banner banner-success';
      voteLockBanner.innerHTML = `
        <span><strong>Ваш голос учтён!</strong> Вы проголосовали ${escapeHtml(formatDateTime(state.myVote.votedAt))} (выбрано треков: ${state.myVote.trackIds.length}). Статистика обновляется в реальном времени.</span>
      `;
    } else {
      voteLockBanner.className = 'banner banner-warning';
      voteLockBanner.innerHTML = `
        <span><strong>Голосование с этого IP недоступно:</strong> ранее уже был отправлен голос от участника <strong>${escapeHtml(state.myVote.nickname)}</strong> (${escapeHtml(state.myVote.telegram)}). С одного IP нельзя голосовать за двух разных человек.</span>
      `;
    }
    voteLockBanner.classList.remove('hidden');
  }

  function renderVotersList() {
    if (state.voters.length === 0) {
      votersList.innerHTML = '<div class="voters-empty">Пока никто не проголосовал. Будьте первым!</div>';
      return;
    }

    const trackMap = getTrackMap();
    const isAdmin = Boolean(state.user && state.user.isAdmin);
    votersList.innerHTML = state.voters
      .map((voter) => {
        const tgClean = voter.telegram.replace(/^@/, '');
        const trackPills = voter.trackIds
          .map((tid) => {
            const t = trackMap.get(tid);
            const label = t ? `${t.artist} — ${t.title}` : tid;
            return `<span class="voter-track-pill">${escapeHtml(label)}</span>`;
          })
          .join('');

        const deleteBtnHtml = isAdmin
          ? `<button type="button" class="voter-delete-btn" data-action="delete-vote" data-vote-id="${escapeHtml(voter.id)}" data-vote-nick="${escapeHtml(voter.nickname)}" data-vote-tg="${escapeHtml(voter.telegram)}">Удалить</button>`
          : '';

        return `
          <div class="voter-row">
            <div class="voter-row-top">
              <div class="voter-identity">
                <span class="voter-nick">${escapeHtml(voter.nickname)}</span>
                <a class="voter-tg" href="https://t.me/${encodeURIComponent(tgClean)}" target="_blank" rel="noopener noreferrer">${escapeHtml(voter.telegram)}</a>
              </div>
              <div class="voter-right-meta">
                <span class="voter-time">${escapeHtml(formatDateTime(voter.votedAt))}</span>
                ${deleteBtnHtml}
              </div>
            </div>
            <div class="voter-tracks">${trackPills}</div>
          </div>
        `;
      })
      .join('');
  }

  function getVisibleTracks() {
    const q = state.searchQuery.trim().toLowerCase();
    let list = state.tracks.filter((t) => {
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q)
      );
    });

    if (state.sortBy === 'votes') {
      list = [...list].sort((a, b) => {
        const ca = (state.stats[a.id] && state.stats[a.id].count) || 0;
        const cb = (state.stats[b.id] && state.stats[b.id].count) || 0;
        if (cb !== ca) return cb - ca;
        return a.title.localeCompare(b.title, 'ru');
      });
    }
    return list;
  }

  function renderTracksFull() {
    const visible = getVisibleTracks();
    const isLocked = Boolean(state.myVote);
    const myVotedSet = new Set(state.myVote ? state.myVote.trackIds : []);

    if (visible.length === 0) {
      tracksList.innerHTML = '<div class="empty-search">По вашему запросу песни не найдены.</div>';
      return;
    }

    tracksList.innerHTML = visible
      .map((track) => {
        const st = state.stats[track.id] || { count: 0, percent: 0 };
        const isSelected = !isLocked && state.selectedIds.has(track.id);
        const isMyVoted = isLocked && myVotedSet.has(track.id);
        const isPlaying = state.playingTrackId === track.id && !state.audio.paused;

        const classes = [
          'track-card',
          isSelected ? 'selected' : '',
          isMyVoted ? 'voted-mine' : '',
          isLocked ? 'locked' : '',
          isPlaying ? 'playing' : '',
        ]
          .filter(Boolean)
          .join(' ');

        let currentTimeText = '0:00 / --:--';
        let sliderVal = 0;
        if (state.playingTrackId === track.id) {
          const cur = state.audio.currentTime || 0;
          const dur = Number.isFinite(state.audio.duration) ? state.audio.duration : 0;
          currentTimeText = `${formatTime(cur)} / ${dur ? formatTime(dur) : '--:--'}`;
          sliderVal = dur > 0 ? Math.min(1000, Math.round((cur / dur) * 1000)) : 0;
        }

        return `
          <article class="${classes}" data-track-id="${escapeHtml(track.id)}">
            <div class="track-main">
              <button
                type="button"
                class="track-check"
                data-action="toggle"
                aria-label="Выбрать ${escapeHtml(track.title)}"
                aria-pressed="${isSelected || isMyVoted ? 'true' : 'false'}"
                ${isLocked ? 'disabled' : ''}
              >
                ${CHECK_SVG}
              </button>

              <div class="track-content">
                <div class="track-header" data-action="toggle">
                  <div class="track-info">
                    <div class="track-title-row">
                      <span class="track-title">${escapeHtml(track.title)}</span>
                      ${isMyVoted ? '<span class="my-choice-tag">Ваш выбор</span>' : ''}
                    </div>
                    <div class="track-artist">${escapeHtml(track.artist)}</div>
                  </div>
                  <div class="track-stats">
                    <span class="stat-percent" data-role="percent">${formatPercent(st.percent)}</span>
                    <span class="stat-count" data-role="count">${pluralPeople(st.count)}</span>
                  </div>
                </div>

                <div class="player-row">
                  <button
                    type="button"
                    class="play-btn"
                    data-action="play"
                    aria-label="${isPlaying ? 'Пауза' : 'Слушать'} ${escapeHtml(track.title)}"
                  >
                    ${isPlaying ? PAUSE_SVG : PLAY_SVG}
                  </button>
                  <div class="seek-wrap">
                    <input
                      type="range"
                      class="seek-slider"
                      min="0"
                      max="1000"
                      value="${sliderVal}"
                      data-action="seek"
                      aria-label="Перемотка трека"
                    />
                    <span class="time-label" data-role="time">${currentTimeText}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="vote-bar-bg">
              <div class="vote-bar-fill" data-role="bar" style="width: ${st.percent}%"></div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function updateTrackStatsInPlace() {
    if (state.sortBy === 'votes') {
      renderTracksFull();
      return;
    }

    const isLocked = Boolean(state.myVote);
    const myVotedSet = new Set(state.myVote ? state.myVote.trackIds : []);

    const cards = tracksList.querySelectorAll('.track-card');
    for (const card of cards) {
      const tid = card.dataset.trackId;
      const st = state.stats[tid] || { count: 0, percent: 0 };

      const percentEl = card.querySelector('[data-role="percent"]');
      const countEl = card.querySelector('[data-role="count"]');
      const barEl = card.querySelector('[data-role="bar"]');
      const checkBtn = card.querySelector('.track-check');

      if (percentEl) percentEl.textContent = formatPercent(st.percent);
      if (countEl) countEl.textContent = pluralPeople(st.count);
      if (barEl) barEl.style.width = `${st.percent}%`;

      card.classList.toggle('locked', isLocked);
      card.classList.toggle('voted-mine', isLocked && myVotedSet.has(tid));
      card.classList.toggle('selected', !isLocked && state.selectedIds.has(tid));
      if (checkBtn) {
        checkBtn.disabled = isLocked;
        checkBtn.setAttribute(
          'aria-pressed',
          (!isLocked && state.selectedIds.has(tid)) || (isLocked && myVotedSet.has(tid))
            ? 'true'
            : 'false'
        );
      }

      const titleRow = card.querySelector('.track-title-row');
      if (titleRow) {
        const existingTag = titleRow.querySelector('.my-choice-tag');
        if (isLocked && myVotedSet.has(tid) && !existingTag) {
          const span = document.createElement('span');
          span.className = 'my-choice-tag';
          span.textContent = 'Ваш выбор';
          titleRow.appendChild(span);
        } else if ((!isLocked || !myVotedSet.has(tid)) && existingTag) {
          existingTag.remove();
        }
      }
    }
  }

  function renderSubmitBar() {
    if (!state.user || state.myVote) {
      submitBar.classList.add('hidden');
      return;
    }
    submitBar.classList.remove('hidden');
    const count = state.selectedIds.size;
    selectedCountEl.textContent = String(count);
    submitVoteBtn.disabled = count === 0;
    clearSelectionBtn.classList.toggle('hidden', count === 0);
  }

  // Audio player helpers
  function syncActivePlayerUI() {
    const cards = tracksList.querySelectorAll('.track-card');
    for (const card of cards) {
      const tid = card.dataset.trackId;
      const playBtn = card.querySelector('.play-btn');
      const slider = card.querySelector('.seek-slider');
      const timeEl = card.querySelector('[data-role="time"]');
      const isCurrent = state.playingTrackId === tid;
      const isPlaying = isCurrent && !state.audio.paused;

      card.classList.toggle('playing', isPlaying);
      if (playBtn) {
        playBtn.innerHTML = isPlaying ? PAUSE_SVG : PLAY_SVG;
        const t = state.tracks.find((item) => item.id === tid);
        if (t) {
          playBtn.setAttribute('aria-label', `${isPlaying ? 'Пауза' : 'Слушать'} ${t.title}`);
        }
      }

      if (isCurrent) {
        const cur = state.audio.currentTime || 0;
        const dur = Number.isFinite(state.audio.duration) ? state.audio.duration : 0;
        if (timeEl) {
          timeEl.textContent = `${formatTime(cur)} / ${dur ? formatTime(dur) : '--:--'}`;
        }
        if (slider && !state.isSeeking && dur > 0) {
          slider.value = String(Math.min(1000, Math.round((cur / dur) * 1000)));
        }
      } else {
        if (slider && slider.value !== '0') slider.value = '0';
        if (timeEl && timeEl.textContent !== '0:00 / --:--') {
          timeEl.textContent = '0:00 / --:--';
        }
      }
    }
  }

  function togglePlayTrack(trackId) {
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track) return;

    if (state.playingTrackId === trackId) {
      if (state.audio.paused) {
        state.audio.play().catch(() => {
          showToast('Не удалось воспроизвести трек.', 'error');
        });
      } else {
        state.audio.pause();
      }
      syncActivePlayerUI();
      return;
    }

    state.playingTrackId = trackId;
    state.audio.src = track.audioUrl;
    state.audio.currentTime = 0;
    state.audio.play().catch(() => {
      showToast('Не удалось воспроизвести трек.', 'error');
    });
    syncActivePlayerUI();
  }

  state.audio.addEventListener('timeupdate', syncActivePlayerUI);
  state.audio.addEventListener('loadedmetadata', syncActivePlayerUI);
  state.audio.addEventListener('play', syncActivePlayerUI);
  state.audio.addEventListener('pause', syncActivePlayerUI);
  state.audio.addEventListener('ended', () => {
    state.audio.currentTime = 0;
    syncActivePlayerUI();
  });

  // Track list event delegation
  tracksList.addEventListener('click', (e) => {
    const card = e.target.closest('.track-card');
    if (!card) return;
    const trackId = card.dataset.trackId;

    const playTarget = e.target.closest('[data-action="play"]');
    if (playTarget) {
      e.stopPropagation();
      togglePlayTrack(trackId);
      return;
    }

    if (e.target.closest('.player-row')) {
      return;
    }

    const toggleTarget = e.target.closest('[data-action="toggle"]');
    if (toggleTarget && !state.myVote) {
      if (state.selectedIds.has(trackId)) {
        state.selectedIds.delete(trackId);
      } else {
        state.selectedIds.add(trackId);
      }
      updateTrackStatsInPlace();
      renderSubmitBar();
    }
  });

  tracksList.addEventListener('input', (e) => {
    if (!e.target.matches('.seek-slider')) return;
    const card = e.target.closest('.track-card');
    if (!card) return;
    const trackId = card.dataset.trackId;

    if (state.playingTrackId !== trackId) {
      const track = state.tracks.find((t) => t.id === trackId);
      if (!track) return;
      state.playingTrackId = trackId;
      state.audio.src = track.audioUrl;
      state.audio.play().catch(() => {});
    }

    state.isSeeking = true;
    const dur = state.audio.duration;
    if (Number.isFinite(dur) && dur > 0) {
      const targetTime = (Number(e.target.value) / 1000) * dur;
      const timeEl = card.querySelector('[data-role="time"]');
      if (timeEl) timeEl.textContent = `${formatTime(targetTime)} / ${formatTime(dur)}`;
    }
  });

  tracksList.addEventListener('change', (e) => {
    if (!e.target.matches('.seek-slider')) return;
    const card = e.target.closest('.track-card');
    if (!card) return;
    const trackId = card.dataset.trackId;
    if (state.playingTrackId === trackId && Number.isFinite(state.audio.duration) && state.audio.duration > 0) {
      state.audio.currentTime = (Number(e.target.value) / 1000) * state.audio.duration;
    }
    state.isSeeking = false;
    syncActivePlayerUI();
  });

  // Accordion toggles
  votersToggle.addEventListener('click', () => {
    state.votersOpen = !state.votersOpen;
    votersAccordion.classList.toggle('open', state.votersOpen);
    votersBody.classList.toggle('hidden', !state.votersOpen);
    votersToggle.setAttribute('aria-expanded', state.votersOpen ? 'true' : 'false');
    votersHint.textContent = state.votersOpen ? 'Свернуть' : 'Развернуть';
  });

  fpsVotersToggle.addEventListener('click', () => {
    state.fpsVotersOpen = !state.fpsVotersOpen;
    fpsVotersAccordion.classList.toggle('open', state.fpsVotersOpen);
    fpsVotersBody.classList.toggle('hidden', !state.fpsVotersOpen);
    fpsVotersToggle.setAttribute('aria-expanded', state.fpsVotersOpen ? 'true' : 'false');
    fpsVotersHint.textContent = state.fpsVotersOpen ? 'Свернуть' : 'Развернуть';
  });

  // FPS option selection & vote submission
  fpsOptionsList.addEventListener('click', (e) => {
    const card = e.target.closest('.fps-card');
    if (!card || state.myFpsVote) return;
    const fid = card.dataset.fpsId;
    if (state.selectedFpsIds.has(fid)) {
      state.selectedFpsIds.delete(fid);
    } else {
      state.selectedFpsIds.add(fid);
    }
    renderFpsSection();
  });

  submitFpsBtn.addEventListener('click', async () => {
    if (!state.user || state.selectedFpsIds.size === 0 || state.myFpsVote) return;
    submitFpsBtn.disabled = true;
    submitFpsBtn.textContent = 'Отправка...';
    try {
      const res = await fetch('/api/vote-fps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: state.user.nickname,
          telegram: state.user.telegram,
          fpsIds: Array.from(state.selectedFpsIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Не удалось отправить голос за FPS.', 'error');
        submitFpsBtn.disabled = false;
        submitFpsBtn.textContent = 'Проголосовать за FPS';
        return;
      }
      state.selectedFpsIds.clear();
      applyServerState(data.state);
      showToast('Ваш голос за FPS записан!', 'success');
    } catch {
      showToast('Ошибка сети. Попробуйте ещё раз.', 'error');
    } finally {
      submitFpsBtn.textContent = 'Проголосовать за FPS';
      renderFpsSection();
    }
  });

  // Search & Sort
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderTracksFull();
  });

  sortButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.sortBy = btn.dataset.sort;
      sortButtons.forEach((b) => b.classList.toggle('active', b === btn));
      renderTracksFull();
    });
  });

  // Clear selection
  clearSelectionBtn.addEventListener('click', () => {
    state.selectedIds.clear();
    updateTrackStatsInPlace();
    renderSubmitBar();
  });

  // Submit vote
  submitVoteBtn.addEventListener('click', async () => {
    if (!state.user || state.selectedIds.size === 0 || state.myVote) return;

    submitVoteBtn.disabled = true;
    submitVoteBtn.textContent = 'Отправка...';
    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: state.user.nickname,
          telegram: state.user.telegram,
          trackIds: Array.from(state.selectedIds),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Не удалось отправить голос.', 'error');
        submitVoteBtn.disabled = false;
        submitVoteBtn.textContent = 'Отправить голос';
        return;
      }

      state.selectedIds.clear();
      applyServerState(data.state);
      showToast('Спасибо! Ваш голос успешно записан.', 'success');
    } catch {
      showToast('Ошибка сети. Попробуйте ещё раз.', 'error');
    } finally {
      submitVoteBtn.textContent = 'Отправить голос';
      renderSubmitBar();
    }
  });

  // Auth flow
  function enterPollAs(user) {
    state.user = user;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        nickname: user.nickname,
        telegram: user.telegram,
      }));
    } catch {}

    userAvatar.textContent = user.nickname.charAt(0).toUpperCase();
    userNickDisplay.textContent = user.nickname;
    userTgDisplay.textContent = user.telegram;
    adminBadge.classList.toggle('hidden', !user.isAdmin);
    adminResetBtn.classList.toggle('hidden', !user.isAdmin);

    authScreen.classList.add('hidden');
    pollApp.classList.remove('hidden');

    renderHeaderStats();
    renderVoteLockBanner();
    renderVotersList();
    renderFpsSection();
    renderTracksFull();
    renderSubmitBar();
  }

  async function authenticate(nickname, telegram, silent = false) {
    if (!silent) {
      authError.classList.add('hidden');
      authSubmitBtn.disabled = true;
      authSubmitBtn.textContent = 'Проверка...';
    }
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, telegram }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (!silent) {
          authError.textContent = data.error || 'Проверьте введённые данные.';
          authError.classList.remove('hidden');
        }
        return false;
      }
      if (data.myVote) {
        state.myVote = data.myVote;
      }
      if (data.myFpsVote) {
        state.myFpsVote = data.myFpsVote;
      }
      enterPollAs({
        nickname: data.nickname,
        telegram: data.telegram,
        isAdmin: Boolean(data.isAdmin),
      });
      return true;
    } catch {
      if (!silent) {
        authError.textContent = 'Ошибка соединения с сервером.';
        authError.classList.remove('hidden');
      }
      return false;
    } finally {
      if (!silent) {
        authSubmitBtn.disabled = false;
        authSubmitBtn.textContent = 'Перейти к опросу';
      }
    }
  }

  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    authenticate(nicknameInput.value, telegramInput.value, false);
  });

  switchUserBtn.addEventListener('click', () => {
    state.audio.pause();
    state.user = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    pollApp.classList.add('hidden');
    authScreen.classList.remove('hidden');
    nicknameInput.focus();
  });

  // Admin Reset Modal
  adminResetBtn.addEventListener('click', () => {
    resetModal.classList.remove('hidden');
  });

  cancelResetBtn.addEventListener('click', () => {
    resetModal.classList.add('hidden');
  });

  resetModal.addEventListener('click', (e) => {
    if (e.target === resetModal) resetModal.classList.add('hidden');
  });

  confirmResetBtn.addEventListener('click', async () => {
    if (!state.user || !state.user.isAdmin) return;
    confirmResetBtn.disabled = true;
    confirmResetBtn.textContent = 'Сброс...';
    try {
      const res = await fetch('/api/admin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: state.user.nickname,
          telegram: state.user.telegram,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Не удалось сбросить ответы.', 'error');
        return;
      }
      resetModal.classList.add('hidden');
      state.selectedIds.clear();
      applyServerState(data.state);
    } catch {
      showToast('Ошибка сети при сбросе.', 'error');
    } finally {
      confirmResetBtn.disabled = false;
      confirmResetBtn.textContent = 'Да, сбросить всё';
    }
  });

  // Admin Delete Specific User Vote (both song and fps lists)
  function handleDeleteVoteClick(e) {
    const btn = e.target.closest('[data-action="delete-vote"]');
    if (!btn || !state.user || !state.user.isAdmin) return;
    const kind = btn.dataset.voteKind === 'fps' ? 'fps' : 'song';
    pendingDeleteVote = {
      id: btn.dataset.voteId,
      kind,
      nickname: btn.dataset.voteNick,
      telegram: btn.dataset.voteTg,
    };
    const pollLabel = kind === 'fps' ? 'голос за FPS участника' : 'голос за песню участника';
    deleteVoteModalText.textContent = `Вы уверены, что хотите удалить ${pollLabel} ${pendingDeleteVote.nickname} (${pendingDeleteVote.telegram})? После удаления он сможет проголосовать снова.`;
    deleteVoteModal.classList.remove('hidden');
  }

  votersList.addEventListener('click', handleDeleteVoteClick);
  fpsVotersList.addEventListener('click', handleDeleteVoteClick);

  cancelDeleteVoteBtn.addEventListener('click', () => {
    pendingDeleteVote = null;
    deleteVoteModal.classList.add('hidden');
  });

  deleteVoteModal.addEventListener('click', (e) => {
    if (e.target === deleteVoteModal) {
      pendingDeleteVote = null;
      deleteVoteModal.classList.add('hidden');
    }
  });

  confirmDeleteVoteBtn.addEventListener('click', async () => {
    if (!state.user || !state.user.isAdmin || !pendingDeleteVote) return;
    confirmDeleteVoteBtn.disabled = true;
    confirmDeleteVoteBtn.textContent = 'Удаление...';
    try {
      const res = await fetch('/api/admin/delete-vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: state.user.nickname,
          telegram: state.user.telegram,
          voteId: pendingDeleteVote.id,
          kind: pendingDeleteVote.kind,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Не удалось удалить голос.', 'error');
        return;
      }
      deleteVoteModal.classList.add('hidden');
      showToast(`Голос участника ${pendingDeleteVote.nickname} удалён.`, 'success');
      pendingDeleteVote = null;
      applyServerState(data.state);
    } catch {
      showToast('Ошибка сети при удалении.', 'error');
    } finally {
      confirmDeleteVoteBtn.disabled = false;
      confirmDeleteVoteBtn.textContent = 'Удалить голос';
    }
  });

  // Real-time SSE connection
  function connectSSE() {
    if (state.eventSource) {
      state.eventSource.close();
    }
    const es = new EventSource('/api/events');
    state.eventSource = es;

    es.addEventListener('open', () => {
      liveStatus.classList.remove('offline');
      liveStatus.innerHTML = '<span class="live-dot"></span>Live-статистика';
    });

    es.addEventListener('state', (event) => {
      try {
        const data = JSON.parse(event.data);
        applyServerState(data);
      } catch {}
    });

    es.addEventListener('error', () => {
      liveStatus.classList.add('offline');
      liveStatus.innerHTML = '<span class="live-dot"></span>Переподключение...';
    });
  }

  // Bootstrap
  async function init() {
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const data = await res.json();
        applyServerState(data);
      }
    } catch {}

    connectSSE();

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.nickname && saved.telegram) {
        nicknameInput.value = saved.nickname;
        telegramInput.value = saved.telegram;
        await authenticate(saved.nickname, saved.telegram, true);
      }
    } catch {}
  }

  init();
})();
