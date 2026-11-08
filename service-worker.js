// Service worker: nhận yêu cầu dịch từ content script và gọi dịch vụ dịch (free / Gemini / OpenAI)
importScripts('shared.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch JSON có timeout + thông báo lỗi rõ ràng
async function fetchJson(url, opts = {}, timeout = 15000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status} ${body.slice(0, 160)}`);
    }
    return await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Hết thời gian chờ mạng');
    if (e instanceof TypeError) throw new Error('Lỗi mạng: không kết nối được dịch vụ dịch');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// ---- Dịch miễn phí (endpoint công khai của Google Translate, không cần key) ----
async function freeOne(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=' +
    encodeURIComponent(text);
  for (let attempt = 0; ; attempt++) {
    try {
      const d = await fetchJson(url);
      return d[0].map((s) => s[0]).join('');
    } catch (e) {
      if (attempt >= 2) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
}

async function translateFree(texts) {
  const out = new Array(texts.length);
  let next = 0;
  const worker = async () => {
    while (next < texts.length) {
      const i = next++;
      out[i] = await freeOne(texts[i]);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker)); // 4 yêu cầu song song
  return out;
}

// ---- Dịch bằng LLM (Gemini / OpenAI): gửi cả lô, trả về mảng JSON ----
const LLM_PROMPT =
  'Dịch các dòng phụ đề sau (tiếng Hàn hoặc ngôn ngữ khác) sang tiếng Việt tự nhiên, ngắn gọn, dùng văn nói phù hợp để lồng tiếng. ' +
  'Chỉ trả về JSON hợp lệ dạng {"translations": ["...", ...]} có đúng số phần tử bằng số dòng đầu vào, giữ nguyên thứ tự.';

function parseLlmArray(text, n) {
  const clean = String(text).replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let obj;
  try { obj = JSON.parse(clean); } catch (e) { throw new Error('API trả về JSON không hợp lệ'); }
  const arr = Array.isArray(obj) ? obj : obj.translations;
  if (!Array.isArray(arr) || arr.length !== n) throw new Error('API trả về sai số lượng câu dịch');
  return arr.map((s) => String(s));
}

async function translateGemini(texts, s) {
  if (!s.geminiKey) throw new Error('Chưa nhập Gemini API key (trang Options)');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.geminiModel)}:generateContent`;
  const d = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.geminiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: LLM_PROMPT + '\n\n' + JSON.stringify(texts) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 }
    })
  }, 30000);
  const text = d.candidates && d.candidates[0] && d.candidates[0].content.parts[0].text;
  return parseLlmArray(text, texts.length);
}

async function translateOpenAI(texts, s) {
  if (!s.openaiKey) throw new Error('Chưa nhập OpenAI API key (trang Options)');
  const d = await fetchJson('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.openaiKey },
    body: JSON.stringify({
      model: s.openaiModel,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: LLM_PROMPT },
        { role: 'user', content: JSON.stringify(texts) }
      ]
    })
  }, 30000);
  return parseLlmArray(d.choices[0].message.content, texts.length);
}

async function translate(texts) {
  const s = await kr2viGetSettings();
  if (s.provider === 'gemini') return translateGemini(texts, s);
  if (s.provider === 'openai') return translateOpenAI(texts, s);
  return translateFree(texts);
}

// ---- Giọng đọc online (Google TTS), trả về mp3 dạng base64 ----
async function ttsViet(text) {
  const q = encodeURIComponent(text);
  // Thử lần lượt các endpoint; googleapis.com đã có quyền sẵn nên đặt trước
  const urls = [
    'https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=vi&q=' + q,
    'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=' + q
  ];
  let lastErr = null;
  for (const url of urls) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15000);
    try {
      const r = await fetch(url, { signal: ac.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!bytes.length) throw new Error('phản hồi rỗng');
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      return btoa(bin);
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error(`không tải được giọng đọc (${lastErr.name}: ${lastErr.message})`);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'tts') {
    ttsViet(msg.text)
      .then((b64) => sendResponse({ ok: true, b64 }))
      .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  }
  if (msg && msg.type === 'translate') {
    translate(msg.texts)
      .then((translations) => sendResponse({ ok: true, translations }))
      .catch((e) => sendResponse({ ok: false, error: e.message || String(e) }));
    return true; // trả lời bất đồng bộ
  }
});
