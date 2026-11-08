// Popup: chỉnh nhanh tốc độ, âm lượng gốc, giọng, hiển thị phụ đề. Lưu ngay khi thay đổi.
const $ = (id) => document.getElementById(id);

function fillVoices(selected) {
  const vi = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('vi'));
  const sel = $('voice');
  sel.innerHTML = '';
  sel.add(new Option('Tự động', ''));
  vi.forEach((v) => sel.add(new Option(`${v.name} (${v.lang})`, v.voiceURI)));
  sel.value = selected;
  $('noVoice').style.display = vi.length ? 'none' : 'block';
}

// Nút Bật/Tắt: gửi lệnh tới content script của tab đang xem
async function sendToTab(type) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return null;
  try { return await chrome.tabs.sendMessage(tab.id, { type }); }
  catch (e) { sendToTab.err = e.message; return null; }
}
function renderToggle(st) {
  const note = $('toggleNote');
  if (!st || !st.onWatch) {
    $('toggle').disabled = true;
    note.style.display = 'block';
    note.textContent = st ? 'Hãy mở một video tại youtube.com/watch.' : 'Chưa kết nối trang YouTube — hãy tải lại tab (F5). [' + (sendToTab.err || 'không có tab') + ']';
    return;
  }
  $('toggle').disabled = false;
  note.style.display = 'none';
  $('toggle').textContent = st.enabled ? 'Tắt lồng tiếng Việt' : 'Bật lồng tiếng Việt';
}
sendToTab('getState').then(renderToggle);
$('toggle').onclick = async () => { renderToggle(await sendToTab('toggle')); };

(async () => {
  const s = await kr2viGetSettings();

  const showVals = () => {
    $('rateVal').textContent = Number($('rate').value).toFixed(2) + 'x';
    $('duckVal').textContent = Math.round($('duck').value * 100) + '%';
  };
  $('rate').value = s.rate;
  $('duck').value = s.duck;
  $('showSubs').checked = s.showSubs;
  $('srcLang').value = s.srcLang;
  $('srcLang').onchange = () => kr2viSaveSettings({ srcLang: $('srcLang').value });
  $('muteOrig').checked = s.muteOrig;
  $('muteOrig').onchange = () => kr2viSaveSettings({ muteOrig: $('muteOrig').checked });
  showVals();

  fillVoices(s.voice);
  speechSynthesis.onvoiceschanged = () => fillVoices(s.voice);

  $('rate').oninput = () => { showVals(); kr2viSaveSettings({ rate: Number($('rate').value) }); };
  $('duck').oninput = () => { showVals(); kr2viSaveSettings({ duck: Number($('duck').value) }); };
  $('voice').onchange = () => { s.voice = $('voice').value; kr2viSaveSettings({ voice: s.voice }); };
  $('showSubs').onchange = () => kr2viSaveSettings({ showSubs: $('showSubs').checked });
  $('opt').onclick = (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); };
})();
