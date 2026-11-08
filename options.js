// Trang Options: chọn dịch vụ dịch, nhập API key, thử dịch, xoá cache
const $ = (id) => document.getElementById(id);
const FIELDS = ['provider', 'geminiKey', 'geminiModel', 'openaiKey', 'openaiModel'];
const ORIGINS = {
  gemini: 'https://generativelanguage.googleapis.com/*',
  openai: 'https://api.openai.com/*'
};

function status(msg, ok = true) {
  $('status').textContent = msg;
  $('status').className = ok ? 'ok' : 'err';
}

(async () => {
  const s = await kr2viGetSettings();
  FIELDS.forEach((f) => { $(f).value = s[f]; });
})();

$('save').onclick = async () => {
  const patch = {};
  FIELDS.forEach((f) => { patch[f] = $(f).value.trim(); });
  try {
    // Xin quyền truy cập API đã chọn (quyền tuỳ chọn, chỉ xin khi cần) — gọi ngay trong thao tác click
    const origin = ORIGINS[patch.provider];
    if (origin) {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) return status('Bạn đã từ chối quyền truy cập API, chưa thể dùng dịch vụ này.', false);
    }
    await kr2viSaveSettings(patch);
    status('Đã lưu.');
  } catch (e) {
    status('Lỗi: ' + e.message, false);
  }
};

$('test').onclick = async () => {
  status('Đang dịch…');
  await kr2viSaveSettings(Object.fromEntries(FIELDS.map((f) => [f, $(f).value.trim()])));
  try {
    const res = await chrome.runtime.sendMessage({ type: 'translate', texts: ['안녕하세요'] });
    if (!res || !res.ok) throw new Error(res ? res.error : 'Service worker không phản hồi');
    status('Kết quả: ' + res.translations[0]);
  } catch (e) {
    status('Lỗi: ' + e.message, false);
  }
};

$('clear').onclick = async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith('cache_'));
  await chrome.storage.local.remove(keys);
  status(`Đã xoá cache của ${Math.max(0, keys.length - 1)} video.`);
};
