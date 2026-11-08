// Kiểm thử chế độ "đọc phụ đề YouTube đang hiển thị" bằng chính tiện ích trong Chrome thật (ở tốc độ đọc 1x).
// Dựng trang YouTube giả (cùng cấu trúc: #movie_player, nút CC, .ytp-caption-segment) và phát lại
// chuỗi phụ đề thật (tests/captions-fixture.json: cập nhật từng từ, dòng cũ cuộn đi) qua 3 đoạn:
//   1) nói nhanh (tốc độ gốc, ~3,7 từ/giây)  2) nói chậm hơn (~2,5 từ/giây)  3) phụ đề tiếng Anh (kiểm tra dịch)
// Chạy: node tests/read-mode-test.js
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'captions-fixture.json'), 'utf8'));
const SLOW = 1.45; // nhân thời gian để thành đoạn nói chậm
const slowFixture = fixture.map(([t, x]) => [Math.round(t * SLOW), x]);
const EN = 'Where are you going tonight? I am going to the market with my friend.'.split(' ');
const enFrames = EN.map((_, i) => [i * 450, EN.slice(0, i + 1).join(' ')]);
const PHASES = [['fast', fixture], ['slow', slowFixture], ['en', enFrames]];

// 1. Bản sao tiện ích có thêm quyền chạy trên trang giả 127.0.0.1
const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'kr2vi-ext-'));
for (const f of fs.readdirSync(ROOT)) {
  const full = path.join(ROOT, f);
  if (fs.statSync(full).isFile() && !f.endsWith('.md')) fs.copyFileSync(full, path.join(ext, f));
}
const man = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
man.content_scripts.forEach((c) => c.matches.push('http://127.0.0.1/*'));
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(man));
const RATE = Number(process.env.RATE || 1);
if (process.env.CATCHUP) { // bật "tự đọc nhanh hơn khi không theo kịp" cho bản sao dùng để test
  const sp0 = path.join(ext, 'shared.js');
  fs.writeFileSync(sp0, fs.readFileSync(sp0, 'utf8').replace('autoCatchUp: false,', 'autoCatchUp: true,'));
}
if (RATE !== 1) { // đặt tốc độ đọc mặc định cho bản sao dùng để test
  const sp = path.join(ext, 'shared.js');
  fs.writeFileSync(sp, fs.readFileSync(sp, 'utf8').replace('rate: 1.0,', `rate: ${RATE},`));
}

// 2. Trang YouTube giả
const page = `<!doctype html><html data-kr2vi-test><head><meta charset="utf-8"><title>fake youtube</title></head><body>
<div id="movie_player" style="width:640px;height:360px;position:relative;background:#222">
  <video class="html5-main-video" width="640" height="360"></video>
  <div class="ytp-chrome-bottom"><div class="ytp-right-controls"><button class="ytp-subtitles-button ytp-button" aria-pressed="false" title="Phụ đề"></button></div></div>
  <div class="ytp-caption-window-container"><div class="caption-window"><span class="captions-text"><span class="caption-visual-line"><span class="ytp-caption-segment" id="seg"></span></span></span></div></div>
</div>
<script>
const PHASES = ${JSON.stringify(PHASES)};
const seg = document.getElementById('seg');
const rep = { ccClicked: false, buttonFound: false, ph: [], minVol: 1 };
const vid = document.querySelector('video');
setInterval(() => { rep.minVol = Math.min(rep.minVol, vid.volume); }, 100);
function play(frames, done) {
  let i = 0;
  const t0 = Date.now();
  (function next() {
    if (i >= frames.length) return done();
    const wait = Math.max(0, t0 + frames[i][0] - Date.now());
    setTimeout(() => { seg.textContent = frames[i][1]; i++; next(); }, wait);
  })();
}
function runPhase(k) {
  if (k >= PHASES.length) return setTimeout(finish, 10000);
  const p = { name: PHASES[k][0], start: Date.now() };
  rep.ph.push(p);
  play(PHASES[k][1], () => { p.end = Date.now(); seg.textContent = ''; setTimeout(() => runPhase(k + 1), 14000); });
}
const cc = document.querySelector('.ytp-subtitles-button');
cc.addEventListener('click', () => {
  if (rep.ccClicked) return;
  rep.ccClicked = true; cc.setAttribute('aria-pressed', 'true');
  runPhase(0);
});
function finish() {
  rep.log = JSON.parse(document.documentElement.dataset.kr2viLog || '[]');
  rep.logT = JSON.parse(document.documentElement.dataset.kr2viLogT || '[]');
  fetch('/report', { method: 'POST', body: JSON.stringify(rep) });
}
const poll = setInterval(() => {
  const b = document.getElementById('kr2vi-btn');
  if (b) { clearInterval(poll); rep.buttonFound = true; setTimeout(() => b.click(), 500); }
}, 300);
setTimeout(() => { if (!rep.ccClicked) { rep.timeout = true; finish(); } }, 20000);
</script></body></html>`;

let chrome, finished = false;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/report') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => { res.end('ok'); finished = true; try { chrome.kill(); } catch (e) { /* bỏ qua */ } server.close(); evaluate(JSON.parse(body)); });
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(page);
});

// 3. Chấm kết quả
const norm = (w) => w.trim().replace(/[.,!?;:…]+$/, '').toLowerCase();
function newPart(prev, cur) { // cùng thuật toán với content.js
  const a = prev.split(' ').filter(Boolean), b = cur.split(' ').filter(Boolean);
  for (let k = Math.min(a.length, b.length); k > 0; k--) {
    let same = true;
    for (let i = 0; i < k; i++) if (norm(a[a.length - k + i]) !== norm(b[i])) { same = false; break; }
    if (same) return b.slice(k).join(' ');
  }
  return cur;
}
function expectedWords(frames) {
  let prev = '', out = [];
  for (const [, t] of frames) { if (!t) { prev = ''; continue; } const f = newPart(prev, t); if (f) out.push(...f.split(' ')); prev = t; }
  return out;
}
// Tỉ lệ từ đã đọc nằm đúng thứ tự trong chuỗi kỳ vọng (độ chính xác) và tỉ lệ từ kỳ vọng được đọc (độ đủ)
function compare(expected, spokenText) {
  const got = spokenText.split(' ').filter(Boolean);
  let ei = 0, hit = 0;
  for (const w of got) { let j = ei; while (j < expected.length && norm(expected[j]) !== norm(w)) j++; if (j < expected.length) { hit++; ei = j + 1; } }
  return { precision: got.length ? hit / got.length : 0, coverage: hit / expected.length, got: got.length };
}

let fail = 0;
const ok = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  — ' + extra : '')); if (!cond) fail++; };

function evaluate(rep) {
  const log = rep.log || [], T = rep.logT || [];
  fs.writeFileSync('/tmp/kr2vi-log.json', JSON.stringify({ log, T, ph: rep.ph }));
  ok('Tiện ích chèn nút "Lồng tiếng Việt" vào player', rep.buttonFound);
  ok('Khi bật, tiện ích tự bấm nút CC', rep.ccClicked);
  const errs = log.filter((x) => x.startsWith('!'));
  ok('Không có lỗi dịch/giọng đọc', errs.length === 0, errs.slice(0, 3).join(' | '));

  const phaseOf = (t) => { let k = -1; rep.ph.forEach((p, i) => { if (t >= p.start) k = i; }); return k; };
  const spokenBy = PHASES.map(() => []), startsBy = PHASES.map(() => []);
  log.forEach((x, i) => {
    const k = phaseOf(T[i]);
    if (k < 0) return;
    if (x === '▶') startsBy[k].push((T[i] - rep.ph[k].start) / 1000);
    else if (!x.startsWith('!')) spokenBy[k].push(x);
  });

  const report = (k, label) => {
    const frames = PHASES[k][1], exp = expectedWords(frames), c = compare(exp, spokenBy[k].join(' '));
    const dur = frames[frames.length - 1][0] / 1000, last = startsBy[k].length ? startsBy[k][startsBy[k].length - 1] : 0;
    const lag = Math.max(0, last - dur);
    console.log(`\n[${label}] phụ đề kéo dài ${dur.toFixed(1)}s (${(exp.length / dur).toFixed(1)} từ/giây); ${spokenBy[k].length} cụm; cụm cuối phát lúc ${last.toFixed(1)}s => tụt lại ${lag.toFixed(1)}s`);
    spokenBy[k].slice(0, 6).forEach((x, i) => console.log(`   ${i + 1}. ${x}`));
    return { c, lag, exp };
  };

  const fast = report(0, 'NÓI NHANH, đọc ' + RATE + 'x');
  ok('[nhanh] đọc đúng thứ tự, không lặp, không bịa chữ (độ chính xác >= 98%)', fast.c.precision >= 0.98, (fast.c.precision * 100).toFixed(0) + '%');
  ok('[nhanh] độ trễ bị giới hạn (<= 10 giây so với lúc phụ đề kết thúc)', fast.lag <= 10, fast.lag.toFixed(1) + 's');
  ok('[nhanh] vẫn đọc được phần lớn nội dung (>= 65%)', fast.c.coverage >= 0.65, (fast.c.coverage * 100).toFixed(0) + '% (phần còn lại bị bỏ để theo kịp video)');
  if (RATE >= 1.8) {
    ok('[nhanh, 2x] đọc gần như đủ (>= 95%)', fast.c.coverage >= 0.95, (fast.c.coverage * 100).toFixed(0) + '%');
    ok('[nhanh, 2x] độ trễ thấp (<= 4 giây)', fast.lag <= 4, fast.lag.toFixed(1) + 's');
  }

  const slow = report(1, 'NÓI CHẬM HƠN (tốc độ bình thường)');
  ok('[chậm] đọc đủ nội dung (>= 95%)', slow.c.coverage >= 0.95, (slow.c.coverage * 100).toFixed(0) + '%');
  ok('[chậm] đọc đúng thứ tự, không lặp (độ chính xác >= 98%)', slow.c.precision >= 0.98, (slow.c.precision * 100).toFixed(0) + '%');
  ok('[chậm] độ trễ thấp (<= 4 giây)', slow.lag <= 4, slow.lag.toFixed(1) + 's');

  const en = spokenBy[2].join(' | ');
  console.log('\n[PHỤ ĐỀ TIẾNG ANH] đã dịch và đọc: ' + en);
  ok('Phụ đề tiếng Anh được dịch sang tiếng Việt rồi đọc', /tối nay|đi đâu/i.test(en) && /chợ/i.test(en));
  ok('Phụ đề tiếng Việt được đọc NGUYÊN VĂN (không dịch lại)', spokenBy[0].join(' ').includes('cô nhận ra cô gái vẫn'));
  const played = log.filter((x) => x === '▶').length, total = log.filter((x) => !x.startsWith('!') && x !== '▶').length;
  ok('Giọng đọc phát được (▶ cho mọi cụm)', played >= total, `${played}/${total}`);
  ok('"Tắt hẳn âm thanh gốc": âm lượng video về 0 khi đọc', rep.minVol <= 0.01, 'thấp nhất ' + rep.minVol);
  console.log(fail ? `\n${fail} kiểm tra THẤT BẠI` : '\nTất cả kiểm tra đạt');
  process.exit(fail ? 1 : 0);
}

// Chrome bản chính thức bỏ qua --load-extension, nên nạp tiện ích bằng giao thức gỡ lỗi (CDP) qua pipe.
function startChrome(port) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kr2vi-prof-'));
  chrome = spawn('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  let buf = '', id = 0;
  const pendingCb = new Map();
  const send = (method, params) => new Promise((resolve) => {
    const i = ++id; pendingCb.set(i, resolve);
    chrome.stdio[3].write(JSON.stringify({ id: i, method, params }) + '\0');
  });
  chrome.stdio[4].on('data', (d) => {
    buf += d.toString();
    let k;
    while ((k = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, k)); buf = buf.slice(k + 1);
      if (msg.id && pendingCb.has(msg.id)) { pendingCb.get(msg.id)(msg); pendingCb.delete(msg.id); }
    }
  });
  (async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const r = await send('Extensions.loadUnpacked', { path: ext });
    if (r.error) { console.log('Không nạp được tiện ích:', JSON.stringify(r.error)); process.exit(3); }
    console.log('Đã nạp tiện ích, id =', r.result.id);
    await send('Target.createTarget', { url: `http://127.0.0.1:${port}/watch?v=TESTVIDEO01` });
  })();
}

server.listen(0, '127.0.0.1', () => {
  startChrome(server.address().port);
  setTimeout(() => { if (!finished) { console.log('HẾT GIỜ: trang không gửi báo cáo (tiện ích có nạp được không?)'); try { chrome.kill(); } catch (e) { /* bỏ qua */ } process.exit(2); } }, 230000);
});
