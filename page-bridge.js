// Chạy trong "MAIN world" của trang YouTube để đọc dữ liệu player mà content script (isolated world) không thấy.
// Giao tiếp với content.js qua window.postMessage.
(() => {
  'use strict';

  // Ghi lại các URL timedtext mà chính player YouTube đã gọi (có kèm token hợp lệ) để dùng làm phương án dự phòng
  const captured = [];
  const rec = (u) => {
    try {
      const s = String((u && u.url) || u);
      if (s.includes('/api/timedtext')) {
        captured.push(new URL(s, location.href).href);
        if (captured.length > 30) captured.shift();
      }
    } catch (e) { /* bỏ qua */ }
  };
  const origFetch = window.fetch;
  window.fetch = function (a) { rec(a); return origFetch.apply(this, arguments); };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { rec(u); return origOpen.apply(this, arguments); };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Lấy playerResponse mới nhất (ytInitialPlayerResponse bị cũ sau khi chuyển video kiểu SPA)
  function getPlayerResponse() {
    const p = document.getElementById('movie_player');
    let r = null;
    try { r = p && p.getPlayerResponse && p.getPlayerResponse(); } catch (e) { /* bỏ qua */ }
    if (!r || !r.videoDetails) r = window.ytInitialPlayerResponse;
    return r;
  }

  function getTracks({ videoId }) {
    const r = getPlayerResponse();
    if (!r || !r.videoDetails || r.videoDetails.videoId !== videoId) return { stale: true };
    const list = r.captions &&
      r.captions.playerCaptionsTracklistRenderer &&
      r.captions.playerCaptionsTracklistRenderer.captionTracks;
    const tracks = (list || []).map((t) => ({
      baseUrl: t.baseUrl,
      languageCode: t.languageCode,
      kind: t.kind || 'manual'
    }));
    return { stale: false, tracks };
  }

  function findCaptured(videoId, lang) {
    for (let i = captured.length - 1; i >= 0; i--) {
      const u = new URL(captured[i]);
      const l = (u.searchParams.get('lang') || '').split('-')[0];
      if (u.searchParams.get('v') === videoId && l === lang.split('-')[0] && !u.searchParams.get('tlang')) {
        return captured[i];
      }
    }
    return null;
  }

  // Dự phòng: yêu cầu player tự tải phụ đề tiếng Hàn rồi lấy URL (có token) mà nó đã gọi
  async function captureTimedtext({ videoId, lang }) {
    let url = findCaptured(videoId, lang);
    if (url) return { url };
    const p = document.getElementById('movie_player');
    if (!p || !p.loadModule) return { url: null };
    let wasOn = false;
    try {
      const cur = p.getOption('captions', 'track');
      wasOn = !!(cur && cur.languageCode);
    } catch (e) { /* bỏ qua */ }
    try {
      p.loadModule('captions');
      p.setOption('captions', 'track', { languageCode: lang });
    } catch (e) { /* bỏ qua */ }
    for (let i = 0; i < 24 && !url; i++) {
      await sleep(250);
      url = findCaptured(videoId, lang);
    }
    // Trả lại trạng thái phụ đề như ban đầu
    if (!wasOn) { try { p.unloadModule('captions'); } catch (e) { /* bỏ qua */ } }
    return { url };
  }

  const handlers = { getTracks, captureTimedtext };

  window.addEventListener('message', async (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.source !== 'kr2vi-content') return;
    let result = null;
    try { result = await handlers[d.type](d.payload || {}); } catch (err) { result = { error: String(err) }; }
    window.postMessage({ source: 'kr2vi-page', id: d.id, result }, '*');
  });
})();
