// Content script: nút bật/tắt, lấy phụ đề, dịch trước, đọc bằng speechSynthesis và đồng bộ với video
(() => {
  'use strict';

  const LATE_WINDOW = 2.5;     // trễ tối đa (giây) vẫn còn đọc một câu
  const PREFETCH_AHEAD = 30;   // dịch trước 30 giây
  const BATCH_MAX = 25;        // số câu tối đa mỗi lần gọi dịch
  const CHARS_PER_SEC = 14;    // ước lượng tốc độ đọc tiếng Việt ở rate 1.0
  const MAX_RATE = 1.5;        // tốc độ đọc tối đa khi tăng tốc cho khớp thời gian
  const CACHE_VIDEOS = 20;     // số video giữ trong cache

  const S = {
    enabled: false, videoId: null, video: null,
    cues: [], tr: [], cacheSrc: '', srcNote: '',
    settings: { ...KR2VI_DEFAULTS },
    loadToken: 0, ticker: null,
    inflight: false, failCount: 0, retryAt: 0, lastErrToast: 0,
    lastSpoken: -1, speakingIdx: -1, interrupted: -1, curUtter: null,
    ducked: false, savedVol: 1, expectVol: 1, restoreTimer: null,
    saveTimer: null, toastTimer: null,
    audio: new Map(), audioPending: 0, spokeOnce: false
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const getVideoId = () =>
    location.pathname === '/watch' ? new URLSearchParams(location.search).get('v') : null;

  // ---------- Giao tiếp với page-bridge.js (MAIN world) ----------
  function bridge(type, payload = {}, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const onMsg = (e) => {
        const d = e.data;
        if (e.source !== window || !d || d.source !== 'kr2vi-page' || d.id !== id) return;
        window.removeEventListener('message', onMsg);
        clearTimeout(to);
        resolve(d.result);
      };
      const to = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        reject(new Error('Không giao tiếp được với trang YouTube (thử tải lại trang)'));
      }, timeout);
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'kr2vi-content', id, type, payload }, '*');
    });
  }

  // ---------- UI: nút, phụ đề, thông báo ----------
  function ensureOverlay(id) {
    const player = document.getElementById('movie_player');
    if (!player) return null;
    let el = document.getElementById(id);
    if (!el || el.parentElement !== player) {
      if (el) el.remove();
      el = document.createElement('div');
      el.id = id;
      player.appendChild(el);
    }
    return el;
  }

  function toast(msg, ms = 3000, isErr = false) {
    const el = ensureOverlay('kr2vi-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = isErr ? 'kr2vi-err' : '';
    el.style.display = 'block';
    clearTimeout(S.toastTimer);
    if (ms > 0) S.toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
  }

  function showSub(text) {
    const el = ensureOverlay('kr2vi-sub');
    if (!el) return;
    const t = S.settings.showSubs ? text : '';
    if (el.textContent !== t) el.textContent = t;
    el.style.display = t ? 'block' : 'none';
  }

  function updateButton() {
    const b = document.getElementById('kr2vi-btn');
    if (b) b.classList.toggle('kr2vi-on', S.enabled);
  }

  function makeButton(cls) {
    const b = document.createElement('button');
    b.id = 'kr2vi-btn';
    b.className = cls;
    b.textContent = 'Lồng tiếng Việt';
    b.title = 'Bật/tắt lồng tiếng Việt (KR2VI Dub)';
    b.setAttribute('aria-label', 'Lồng tiếng Việt');
    b.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    return b;
  }

  function toggle() { S.enabled ? disable() : enable(); }

  // Chèn vào thanh điều khiển; nếu giao diện YouTube khác (không thấy nút) thì dùng nút nổi trên player
  function ensureButton() {
    const player = document.getElementById('movie_player');
    const bar = document.querySelector('.ytp-right-controls');
    let b = document.getElementById('kr2vi-btn');
    if (b && b.isConnected && (b.offsetWidth > 0 || b.classList.contains('kr2vi-float'))) return;
    if (b) b.remove();
    if (bar) {
      b = makeButton('ytp-button kr2vi-btn');
      bar.prepend(b);
      if (b.offsetWidth > 0) { updateButton(); return; }
      b.remove();
    }
    if (!player) return;
    b = makeButton('kr2vi-float');
    player.appendChild(b);
    updateButton();
  }

  // ---------- Lấy & phân tích phụ đề ----------
  async function fetchJson3(url) {
    const u = new URL(url, location.origin);
    u.searchParams.set('fmt', 'json3');
    let r;
    try { r = await fetch(u.href, { credentials: 'include' }); }
    catch (e) { throw new Error('Lỗi mạng khi tải phụ đề'); }
    if (!r.ok) return null;
    const text = await r.text();
    if (!text) return null; // YouTube đôi khi trả body rỗng nếu thiếu token
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function parseJson3(json) {
    const out = [];
    for (const ev of json.events || []) {
      if (!ev.segs) continue;
      let text = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
      text = text.replace(/\[[^\]]*\]|\([^)]*\)|[♪♬]/g, '').trim(); // bỏ [음악], (웃음), ♪
      if (!text) continue;
      out.push({ start: ev.tStartMs / 1000, dur: (ev.dDurationMs || 2000) / 1000, text });
    }
    out.sort((a, b) => a.start - b.start);
    out.forEach((c, i) => {
      const next = out[i + 1];
      c.end = c.start + c.dur;
      // khoảng thời gian cho phép đọc: đến câu kế tiếp (tối đa 8s)
      c.avail = Math.max(0.8, Math.min(8, (next ? next.start : c.end + 2) - c.start));
    });
    return out;
  }

  async function loadCues(vid) {
    let info = null;
    for (let i = 0; i < 12; i++) { // chờ YouTube nạp xong dữ liệu video mới
      info = await bridge('getTracks', { videoId: vid });
      if (info && !info.stale) break;
      await sleep(500);
    }
    if (!info || info.stale) throw new Error('Chưa đọc được thông tin video, hãy thử bật lại sau vài giây');
    const tracks = info.tracks || [];
    if (!tracks.length) throw new Error('Video này không có phụ đề');
    // Ưu tiên: Hàn (gốc) > Hàn (tự động) > Anh (gốc) > Anh (tự động) > track bất kỳ
    const pick = (lang) => {
      const l = tracks.filter((t) => t.languageCode.startsWith(lang));
      return l.find((t) => t.kind !== 'asr') || l[0];
    };
    const want = S.settings.srcLang; // 'auto' hoặc ko/ja/zh/en
    const order = want === 'auto' ? ['ko', 'ja', 'zh', 'en'] : [want];
    let track = null;
    for (const l of order) { track = pick(l); if (track) break; }
    const fellBack = !track && want !== 'auto';
    if (!track) track = pick('en') || tracks.find((t) => t.kind !== 'asr') || tracks[0];
    S.srcNote = fellBack ? ` — không có phụ đề "${want}", dùng "${track.languageCode}"` : '';
    S.cacheSrc = track.languageCode + '|' + track.kind;

    let json = await fetchJson3(track.baseUrl);
    if (!json) { // dự phòng: lấy URL do chính player YouTube gọi
      const cap = await bridge('captureTimedtext', { videoId: vid, lang: track.languageCode }, 10000);
      if (cap && cap.url) json = await fetchJson3(cap.url);
    }
    if (!json) throw new Error('YouTube không cho tải phụ đề video này (phản hồi rỗng)');
    const cues = parseJson3(json);
    if (!cues.length) throw new Error('Phụ đề tiếng Hàn trống');
    return cues;
  }

  // ---------- Cache bản dịch theo videoId ----------
  async function loadCache() {
    const k = 'cache_' + S.videoId;
    const c = (await chrome.storage.local.get(k))[k];
    if (c && c.src === S.cacheSrc && c.n === S.cues.length) {
      for (const [i, v] of Object.entries(c.map)) S.tr[+i] = v;
    }
  }

  function scheduleSave() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(saveCache, 1500);
  }

  async function saveCache() {
    clearTimeout(S.saveTimer);
    const vid = S.videoId;
    if (!vid || !S.cues.length) return;
    const map = {};
    S.tr.forEach((v, i) => { if (v !== undefined) map[i] = v; });
    const entry = { src: S.cacheSrc, n: S.cues.length, map };
    try {
      const o = await chrome.storage.local.get('cache_index');
      const list = (o.cache_index || []).filter((x) => x !== vid);
      list.push(vid);
      const drop = list.splice(0, Math.max(0, list.length - CACHE_VIDEOS)); // bỏ video cũ nhất
      await chrome.storage.local.set({ ['cache_' + vid]: entry, cache_index: list });
      if (drop.length) await chrome.storage.local.remove(drop.map((d) => 'cache_' + d));
    } catch (e) { /* extension reload / hết quota: bỏ qua */ }
  }

  // ---------- Dịch trước ----------
  function findCue(t) { // chỉ số câu cuối cùng có start <= t
    const c = S.cues;
    let lo = 0, hi = c.length - 1, r = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (c[m].start <= t) { r = m; lo = m + 1; } else hi = m - 1;
    }
    return r;
  }

  function prefetch() {
    if (S.inflight || Date.now() < S.retryAt || !S.video) return;
    const t = S.video.currentTime;
    const idxs = [];
    for (let i = Math.max(0, findCue(t)); i < S.cues.length; i++) {
      if (S.cues[i].start > t + PREFETCH_AHEAD || idxs.length >= BATCH_MAX) break;
      if (S.tr[i] === undefined) idxs.push(i);
    }
    if (idxs.length) runBatch(idxs);
  }

  async function runBatch(idxs) {
    S.inflight = true;
    const token = S.loadToken;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'translate', texts: idxs.map((i) => S.cues[i].text) });
      if (token !== S.loadToken) return;
      if (!res) throw new Error('Service worker không phản hồi');
      if (!res.ok) throw new Error(res.error);
      idxs.forEach((i, k) => { S.tr[i] = res.translations[k] || ''; });
      S.failCount = 0;
      scheduleSave();
    } catch (e) {
      if (token !== S.loadToken) return;
      S.failCount++;
      S.retryAt = Date.now() + Math.min(30000, 2000 * 2 ** S.failCount); // thử lại với độ trễ tăng dần
      if (Date.now() - S.lastErrToast > 10000) {
        S.lastErrToast = Date.now();
        const m = /context invalidated/i.test(e.message)
          ? 'Extension vừa được cập nhật, hãy tải lại trang (F5)'
          : 'Lỗi dịch: ' + e.message + ' — đang thử lại…';
        toast(m, 6000, true);
      }
    } finally {
      S.inflight = false;
    }
  }

  // ---------- Đọc & đồng bộ ----------
  function pickVoice() {
    const vs = speechSynthesis.getVoices();
    return vs.find((v) => v.voiceURI === S.settings.voice) ||
      vs.find((v) => v.lang.toLowerCase().startsWith('vi')) || null;
  }

  function calcRate(i, avail) {
    const base = S.settings.rate;
    const need = S.cues[i].text ? S.tr[i].length / CHARS_PER_SEC / (avail / (S.video.playbackRate || 1)) : 0;
    const cap = Math.max(base, MAX_RATE); // tăng tốc tối đa 1.5x (không thấp hơn tốc độ người dùng chọn)
    return Math.min(Math.max(base, need), cap);
  }

  function duck() {
    const v = S.video;
    if (!S.ducked) { S.savedVol = v.volume; S.ducked = true; }
    clearTimeout(S.restoreTimer);
    const factor = S.settings.muteOrig ? 0 : S.settings.duck;
    S.expectVol = Math.max(0, Math.min(1, S.savedVol * factor));
    v.volume = S.expectVol;
  }

  function restoreNow() {
    clearTimeout(S.restoreTimer);
    if (S.ducked && S.video) { S.video.volume = S.savedVol; }
    S.ducked = false;
  }

  function scheduleRestore() {
    clearTimeout(S.restoreTimer);
    if (S.settings.muteOrig) return; // giữ tắt tiếng gốc suốt thời gian lồng tiếng
    S.restoreTimer = setTimeout(restoreNow, 350); // giữ nhỏ nếu câu kế tiếp bắt đầu ngay
  }

  function stopAudio() {
    if (S.curUtter && S.curUtter.audio) S.curUtter.audio.pause();
  }

  function cancelSpeech() {
    stopAudio();
    S.curUtter = null;
    S.speakingIdx = -1;
    speechSynthesis.cancel();
  }

  // ----- Giọng đọc online (Google TTS qua service worker) khi máy không có giọng Việt -----
  function getAudio(i) {
    let p = S.audio.get(i);
    if (!p) {
      S.audioPending++;
      p = chrome.runtime.sendMessage({ type: 'tts', text: S.tr[i].slice(0, 200) })
        .then((res) => {
          if (!res || !res.ok) throw new Error(res ? res.error : 'Service worker không phản hồi');
          const bin = atob(res.b64);
          const bytes = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
          return URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
        })
        .finally(() => { S.audioPending--; });
      p.catch(() => S.audio.delete(i));
      S.audio.set(i, p);
    }
    return p;
  }

  function clearAudio() {
    S.audio.forEach((p) => p.then((u) => URL.revokeObjectURL(u)).catch(() => {}));
    S.audio.clear();
  }

  function prefetchAudio(t) { // tải trước âm thanh 12 giây tới
    if (pickVoice()) return;
    for (let i = Math.max(0, findCue(t)); i < S.cues.length && S.cues[i].start < t + 12; i++) {
      if (S.audioPending >= 3) break;
      if (S.tr[i] && !S.audio.has(i)) getAudio(i).catch(() => {});
    }
  }

  async function speakCloud(i, avail) {
    const u = { audio: null };
    const done = () => {
      if (S.curUtter !== u) return;
      S.curUtter = null; S.speakingIdx = -1;
      scheduleRestore();
    };
    S.curUtter = u;
    S.speakingIdx = i;
    duck();
    try {
      const url = await getAudio(i);
      if (S.curUtter !== u) return; // đã bị ngắt (tua/tạm dừng/câu khác)
      const a = new Audio(url);
      a.playbackRate = calcRate(i, avail);
      a.onended = done;
      a.onerror = () => {
        done();
        toast('Chrome không phát được âm thanh giọng đọc (file lỗi hoặc bị chặn)', 6000, true);
      };
      u.audio = a;
      await a.play();
      if (!S.spokeOnce) { S.spokeOnce = true; toast('🔊 Đang đọc tiếng Việt: ' + S.tr[i], 3000); }
    } catch (e) {
      done();
      if (Date.now() - S.lastErrToast > 10000) {
        S.lastErrToast = Date.now();
        toast('Lỗi giọng đọc online: ' + e.message, 6000, true);
      }
    }
  }

  function speak(i, avail) {
    const text = S.tr[i];
    if (!text) return;
    speechSynthesis.cancel(); // câu cũ chưa xong thì ngắt để giữ đồng bộ
    stopAudio();
    if (!pickVoice()) return speakCloud(i, avail); // không có giọng Việt trên máy
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'vi-VN';
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.rate = calcRate(i, avail || S.cues[i].avail);
    const done = () => {
      if (S.curUtter !== u) return; // đã bị thay bằng câu khác
      S.curUtter = null; S.speakingIdx = -1;
      scheduleRestore();
    };
    u.onend = done;
    u.onerror = done;
    S.curUtter = u;
    S.speakingIdx = i;
    duck();
    speechSynthesis.speak(u);
  }

  function tick() {
    const v = S.video;
    if (!S.enabled || !v) return;
    const player = document.getElementById('movie_player');
    if (player && player.classList.contains('ad-showing')) { // đang chiếu quảng cáo
      cancelSpeech(); restoreNow(); showSub('');
      return;
    }
    if (S.settings.muteOrig && !S.ducked) duck();
    else if (!S.settings.muteOrig && S.ducked && S.speakingIdx < 0) restoreNow(); // vừa bỏ chế độ tắt hẳn
    prefetch();
    prefetchAudio(v.currentTime);
    if (v.paused || v.seeking) return;
    const t = v.currentTime;
    const i = findCue(t);
    if (i < 0) { showSub(''); return; }
    const c = S.cues[i];
    showSub(S.tr[i] && t < c.start + Math.min(c.avail, Math.max(c.dur, 1.5)) ? S.tr[i] : '');
    if (i !== S.lastSpoken && t - c.start <= LATE_WINDOW && S.tr[i]) {
      S.lastSpoken = i;
      speak(i, Math.max(0.8, c.start + c.avail - t));
    }
  }

  // ---------- Sự kiện video ----------
  const vEvents = {
    pause() {
      if (!S.enabled) return;
      const idx = S.speakingIdx;
      cancelSpeech(); restoreNow();
      S.interrupted = idx; // nhớ câu đang đọc dở để đọc lại khi phát tiếp
    },
    play() {
      if (!S.enabled || S.interrupted < 0) return;
      const i = S.interrupted;
      S.interrupted = -1;
      const c = S.cues[i], t = S.video.currentTime;
      if (c && S.tr[i] && t >= c.start && t < c.start + c.avail) {
        S.lastSpoken = i;
        speak(i, Math.max(0.8, c.start + c.avail - t));
      }
    },
    seeking() {
      if (!S.enabled) return;
      cancelSpeech(); restoreNow();
      S.interrupted = -1; S.lastSpoken = -1; // sau khi tua sẽ đọc lại từ câu tại vị trí mới
    },
    ended() { if (S.enabled) { cancelSpeech(); restoreNow(); showSub(''); } },
    volumechange() {
      // người dùng tự chỉnh âm lượng khi đang giảm → coi giá trị mới là âm lượng gốc
      if (S.ducked && S.video && Math.abs(S.video.volume - S.expectVol) > 0.005) {
        S.ducked = false;
        clearTimeout(S.restoreTimer);
      }
    }
  };

  function bindVideo(v) {
    if (S.video === v) return;
    if (S.video) for (const [n, f] of Object.entries(vEvents)) S.video.removeEventListener(n, f);
    S.video = v;
    for (const [n, f] of Object.entries(vEvents)) v.addEventListener(n, f);
  }

  // ---------- Bật / tắt ----------
  async function enable() {
    const vid = getVideoId();
    if (!vid) return;
    S.enabled = true;
    S.spokeOnce = false;
    S.videoId = vid;
    const token = ++S.loadToken;
    updateButton();
    toast('Đang tải phụ đề tiếng Hàn…', 0);
    try {
      const cues = await loadCues(vid);
      if (token !== S.loadToken) return;
      S.cues = cues;
      S.tr = new Array(cues.length);
      S.lastSpoken = -1; S.interrupted = -1; S.failCount = 0; S.retryAt = 0;
      await loadCache();
      if (token !== S.loadToken) return;
      clearInterval(S.ticker);
      S.ticker = setInterval(tick, 200);
      toast(`Đã bật lồng tiếng Việt (${cues.length} câu${S.srcNote})`, S.srcNote ? 6000 : 2500);
      setTimeout(() => { // cảnh báo nếu trình duyệt không có giọng Việt
        const vs = speechSynthesis.getVoices();
        if (S.enabled && !vs.some((x) => x.lang.toLowerCase().startsWith('vi'))) {
          toast('Máy không có giọng Việt → dùng giọng online của Google (cần mạng)', 5000);
        }
      }, 2600);
    } catch (e) {
      if (token !== S.loadToken) return;
      toast('Lỗi: ' + e.message, 7000, true);
      disable(true);
    }
  }

  function disable(keepToast) {
    S.enabled = false;
    S.loadToken++;
    clearInterval(S.ticker);
    S.ticker = null;
    saveCache();
    cancelSpeech();
    clearAudio();
    restoreNow();
    showSub('');
    if (!keepToast) toast('Đã tắt lồng tiếng', 1500);
    updateButton();
  }

  // ---------- Theo dõi chuyển video / thay đổi giao diện YouTube (SPA) ----------
  function watchdog() {
    const vid = getVideoId();
    if (vid !== S.videoId) { // chuyển video mà không tải lại trang
      const was = S.enabled;
      if (was) disable(true);
      S.videoId = vid;
      S.cues = []; S.tr = [];
      if (was && vid) enable(); // giữ trạng thái bật cho video kế tiếp
    }
    if (!vid) {
      const b = document.getElementById('kr2vi-btn');
      if (b) b.remove();
      return;
    }
    ensureButton();
    const v = document.querySelector('video.html5-main-video') || document.querySelector('#movie_player video');
    if (v) bindVideo(v);
  }

  async function init() {
    S.settings = await kr2viGetSettings();
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.settings) {
        S.settings = { ...KR2VI_DEFAULTS, ...(ch.settings.newValue || {}) };
        if (!S.settings.showSubs) showSub('');
      }
    });
    // Popup gọi để bật/tắt hoặc hỏi trạng thái
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'toggle') toggle();
      if (msg && (msg.type === 'toggle' || msg.type === 'getState')) {
        sendResponse({ enabled: S.enabled, onWatch: !!getVideoId() });
      }
    });
    speechSynthesis.getVoices(); // kích hoạt nạp danh sách giọng
    document.addEventListener('yt-navigate-finish', watchdog);
    window.addEventListener('pagehide', () => { restoreNow(); speechSynthesis.cancel(); });
    setInterval(watchdog, 1000);
    watchdog();
  }

  init();
})();
