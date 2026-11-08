// Cài đặt mặc định + hàm đọc/ghi dùng chung (content script, popup, options, service worker)
const KR2VI_DEFAULTS = {
  rate: 1.0,            // tốc độ đọc cơ bản (0.6 – 2.0)
  autoCatchUp: false,   // tự đọc nhanh hơn (tối đa 2x) khi không theo kịp phụ đề
  duck: 0.18,           // hệ số âm lượng video gốc khi đang đọc (18%)
  mode: 'read',         // read = đọc đúng phụ đề YouTube đang hiển thị | dub = tự dịch trước theo phụ đề video
  srcLang: 'auto',     // ngôn ngữ phụ đề nguồn: auto | ko | ja | zh | en
  muteOrig: true,    // tắt hẳn âm thanh gốc khi đang lồng tiếng
  voice: '',          // voiceURI giọng Việt ('' = tự chọn)
  showSubs: true,       // hiện phụ đề tiếng Việt trên màn hình
  provider: 'free',     // free | gemini | openai
  geminiKey: '',
  geminiModel: 'gemini-2.0-flash',
  openaiKey: '',
  openaiModel: 'gpt-4o-mini'
};

async function kr2viGetSettings() {
  const o = await chrome.storage.local.get('settings');
  return { ...KR2VI_DEFAULTS, ...(o.settings || {}) };
}

async function kr2viSaveSettings(patch) {
  const cur = await kr2viGetSettings();
  await chrome.storage.local.set({ settings: { ...cur, ...patch } });
}
