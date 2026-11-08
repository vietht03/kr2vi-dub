package com.vietht03.kr2vidub

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.view.Gravity
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.LinearLayout
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Dịch vụ Trợ năng: đọc chữ phụ đề đang hiện trong app YouTube,
 * dịch sang tiếng Việt rồi đọc bằng TextToSpeech của Android.
 * Có 2 nút nổi (bật/tắt, tắt tiếng gốc) hiện khi mở YouTube.
 */
class CaptionService : AccessibilityService(), TextToSpeech.OnInitListener {

    companion object {
        const val YT = "com.google.android.youtube"
        // Id view của phụ đề (chưa chắc chắn tên chính xác; dùng chế độ chẩn đoán để kiểm tra)
        private val CAPTION_ID = Regex("subtitle|caption", RegexOption.IGNORE_CASE)

        @Volatile var instance: CaptionService? = null
        @Volatile var status: String = ""
        @Volatile var lastCaption: String = ""
        @Volatile var lastDump: String = ""
    }

    private lateinit var tts: TextToSpeech
    private var ttsReady = false
    private val handler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor() // dịch lần lượt để giữ đúng thứ tự
    private val inFlight = AtomicInteger(0)              // số câu đang chờ đọc
    private var utteranceId = 0

    private var capText = ""      // chữ phụ đề hiện tại trên màn hình
    private var buf = ""          // các từ mới chưa đọc (gom thành cụm trước khi đọc)
    private var scanScheduled = false
    private var focusReq: AudioFocusRequest? = null

    // Giọng đọc đi theo luồng "trợ năng"; khi tắt tiếng gốc thì dùng luồng báo thức để không bị tắt theo
    private val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()
    private val attrsAlarm = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build()

    private val scan = Runnable { scanScheduled = false; doScan() }
    private val idleFlush = Runnable { flush() }
    private val unmute = Runnable { Volume.restore(this) }

    // ----- nút nổi -----
    private var overlay: LinearLayout? = null
    private var btnOn: Button? = null
    private var btnMute: Button? = null
    private val poll = object : Runnable {
        override fun run() {
            updateOverlay()
            handler.postDelayed(this, 2000)
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Volume.restore(this) // phòng trường hợp lần trước app bị tắt khi đang tắt tiếng
        status = "Đang khởi tạo giọng đọc…"
        tts = TextToSpeech(this, this)
        handler.post(poll)
    }

    override fun onInit(s: Int) {
        if (s != TextToSpeech.SUCCESS) {
            status = "Không khởi tạo được bộ đọc (TTS) của máy"
            return
        }
        val r = tts.setLanguage(Locale("vi", "VN"))
        ttsReady = r != TextToSpeech.LANG_MISSING_DATA && r != TextToSpeech.LANG_NOT_SUPPORTED
        tts.setAudioAttributes(attrs)
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) = finished()
            @Deprecated("Deprecated in Java")
            override fun onError(id: String?) = finished()
            override fun onStop(id: String?, interrupted: Boolean) = finished()
        })
        status = if (ttsReady) "Giọng tiếng Việt sẵn sàng. Hãy bật CC trong app YouTube."
        else "Máy chưa có giọng tiếng Việt: cài Google Speech Services và tải dữ liệu giọng Việt (bấm nút Cài đặt giọng đọc)."
    }

    override fun onAccessibilityEvent(e: AccessibilityEvent?) {
        if (e == null || !Prefs.enabled(this)) return
        if (e.packageName?.toString() != YT) return
        if (!scanScheduled) { // gộp nhiều sự kiện liên tiếp thành một lần quét
            scanScheduled = true
            handler.postDelayed(scan, 250)
        }
    }

    override fun onInterrupt() {}

    override fun onDestroy() {
        instance = null
        handler.removeCallbacksAndMessages(null)
        hideOverlay()
        Volume.restore(this)
        if (::tts.isInitialized) tts.shutdown()
        super.onDestroy()
    }

    // ---------- Tìm cửa sổ YouTube (không dùng cửa sổ "đang active" vì có thể là app khác, ví dụ Zalo) ----------
    private fun ytRoot(): AccessibilityNodeInfo? {
        for (w in windows) {
            val r = w.root ?: continue
            if (r.packageName?.toString() == YT) return r
        }
        return null
    }

    private fun ytVisible(): Boolean = ytRoot() != null

    // ---------- Quét màn hình để tìm chữ phụ đề ----------
    private fun doScan() {
        try {
            val debug = Prefs.debug(this)
            val root = ytRoot()
            if (root == null) {
                if (debug) lastDump = "(Không thấy cửa sổ YouTube trong danh sách cửa sổ)\n" + describeWindows()
                return
            }
            val texts = ArrayList<String>()
            val dump = if (debug) StringBuilder(describeWindows()).append('\n') else null
            walk(root, 0, texts, dump)
            lastDump = dump?.toString()?.take(20000) ?: ""

            val t = texts.joinToString(" ").replace(Regex("\\s+"), " ").trim()
            if (t == capText) return
            val prev = capText
            capText = t
            lastCaption = t
            Log.d("KR2VI", "caption: $t")
            handler.removeCallbacks(idleFlush)
            if (t.isEmpty()) { flush(); return }
            val fresh = newPart(prev, t)
            if (fresh.isNotBlank()) buf = (buf + " " + fresh).trim()
            val words = buf.split(' ').size
            val endsSentence = buf.isNotEmpty() && buf.last() in ".!?…。！？"
            val endsClause = buf.isNotEmpty() && buf.last() in ",;:" && words >= 7
            if (endsSentence || endsClause || words >= 14) flush()
            else handler.postDelayed(idleFlush, 700) // chữ ngừng đổi thì đọc nốt
        } catch (ex: Exception) {
            status = "Lỗi khi quét màn hình: ${ex.message}"
        }
    }

    private fun describeWindows(): String =
        "Cửa sổ: " + windows.joinToString(" | ") { (it.root?.packageName ?: "?").toString() }

    private fun walk(n: AccessibilityNodeInfo, depth: Int, out: MutableList<String>, dump: StringBuilder?) {
        if (depth > 40) return
        val id = n.viewIdResourceName ?: ""
        val text = n.text?.toString() ?: ""
        val desc = n.contentDescription?.toString() ?: ""
        if (dump != null) {
            dump.append("  ".repeat(depth))
                .append(n.className).append(" id=").append(id)
                .append(" text=").append(text.take(60))
                .append(" desc=").append(desc.take(60)).append('\n')
        }
        // Chỉ lấy chữ của view phụ đề (không lấy nút "Phụ đề" của thanh điều khiển)
        if (CAPTION_ID.containsMatchIn(id) && !id.contains("button", ignoreCase = true) && text.isNotBlank()) {
            out.add(text)
        }
        for (i in 0 until n.childCount) {
            n.getChild(i)?.let { walk(it, depth + 1, out, dump) }
        }
    }

    // ---------- Dịch & đọc ----------
    // Phụ đề cuộn/cập nhật từng từ nên phần đầu lặp lại: chỉ lấy phần chữ mới (so khớp không phân biệt dấu câu cuối từ)
    private fun norm(w: String) = w.trim().trimEnd('.', ',', '!', '?', ';', ':', '…').lowercase()

    private fun newPart(prev: String, cur: String): String {
        val a = prev.split(' ').filter { it.isNotEmpty() }
        val b = cur.split(' ').filter { it.isNotEmpty() }
        for (k in minOf(a.size, b.size) downTo 1) {
            var same = true
            for (i in 0 until k) {
                if (norm(a[a.size - k + i]) != norm(b[i])) { same = false; break }
            }
            if (same) return b.drop(k).joinToString(" ")
        }
        return cur
    }

    // Gửi cụm từ đã gom đi dịch và đọc
    private fun flush() {
        val fresh = buf.trim()
        buf = ""
        if (!fresh.any { it.isLetterOrDigit() }) return // bỏ cụm chỉ có dấu câu
        io.execute {
            try {
                val vi = Translator.toVietnamese(fresh).trim()
                Log.d("KR2VI", "dich: '$fresh' -> '$vi'")
                status = "Đang đọc phụ đề"
                if (vi.isNotEmpty()) handler.post { speak(vi) }
            } catch (ex: Exception) {
                Log.d("KR2VI", "loi dich: ${ex.message}")
                status = "Lỗi dịch: ${ex.message}"
            }
        }
    }

    private fun speak(text: String) {
        if (!ttsReady || !Prefs.enabled(this)) return
        if (inFlight.get() >= 4) { // tụt lại quá xa: bỏ hàng đợi cũ để theo kịp video
            tts.stop()
            inFlight.set(0)
        }
        val mute = Prefs.mute(this)
        if (mute) { // tắt tiếng gốc, giữ tắt cho đến khi im lặng 5 giây
            Volume.mute(this)
            handler.removeCallbacks(unmute)
            handler.postDelayed(unmute, 5000)
        }
        tts.setAudioAttributes(if (mute) attrsAlarm else attrs)
        if (inFlight.get() == 0) requestFocus()
        // hàng đợi dài thì đọc nhanh hơn (tối đa 1.6x)
        val rate = minOf(1.6f, Prefs.rate(this) * (1f + 0.25f * inFlight.get()))
        tts.setSpeechRate(rate)
        inFlight.incrementAndGet()
        val rc = tts.speak(text, TextToSpeech.QUEUE_ADD, null, "kr${utteranceId++}")
        Log.d("KR2VI", "speak rc=$rc mute=$mute rate=$rate '$text'")
    }

    // Đọc thử: một câu tiếng Việt, rồi dịch một câu tiếng Anh sang tiếng Việt và đọc (kiểm tra cả đường dịch)
    fun speakTest() {
        speak("Xin chào, đây là giọng đọc thử của KR2VI Dub")
        io.execute {
            try {
                val vi = Translator.toVietnamese("Where are you going tonight?")
                Log.d("KR2VI", "test dich: -> '$vi'")
                handler.post { speak(vi) }
            } catch (ex: Exception) {
                Log.d("KR2VI", "test dich loi: ${ex.message}")
                status = "Lỗi dịch: ${ex.message}"
            }
        }
    }

    private fun finished() {
        Log.d("KR2VI", "doc xong, con ${inFlight.get()}")
        if (inFlight.updateAndGet { maxOf(0, it - 1) } == 0) handler.post { abandonFocus() }
        // gia hạn thời gian giữ tắt tiếng thêm 5 giây sau câu vừa đọc xong
        if (Prefs.savedVol(this) >= 0) handler.post {
            handler.removeCallbacks(unmute)
            handler.postDelayed(unmute, 5000)
        }
    }

    // Xin audio focus kiểu "ducking" để app YouTube tự giảm âm lượng khi đang đọc
    private fun requestFocus() {
        if (focusReq != null) return
        val am = getSystemService(AUDIO_SERVICE) as AudioManager
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attrs)
            .setOnAudioFocusChangeListener { }
            .build()
        am.requestAudioFocus(req)
        focusReq = req
    }

    private fun abandonFocus() {
        val req = focusReq ?: return
        (getSystemService(AUDIO_SERVICE) as AudioManager).abandonAudioFocusRequest(req)
        focusReq = null
    }

    // ---------- Nút nổi: hiện khi YouTube đang hiển thị ----------
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun makeButton(onClick: () -> Unit): Button {
        val b = Button(this)
        b.textSize = 12f
        b.setTextColor(Color.WHITE)
        b.isAllCaps = false
        b.minHeight = 0
        b.minimumHeight = 0
        b.setPadding(dp(10), dp(6), dp(10), dp(6))
        val bg = GradientDrawable()
        bg.cornerRadius = dp(18).toFloat()
        bg.setColor(Color.argb(200, 30, 30, 30))
        b.background = bg
        b.setOnClickListener { onClick() }
        return b
    }

    private fun updateOverlay() {
        val visible = try { ytVisible() } catch (e: Exception) { false }
        if (visible && overlay == null) showOverlay()
        else if (!visible && overlay != null) hideOverlay()
        refreshLabels()
    }

    private fun refreshLabels() {
        btnOn?.text = if (Prefs.enabled(this)) "Lồng tiếng: BẬT" else "Lồng tiếng: TẮT"
        btnMute?.text = if (Prefs.mute(this)) "Tiếng gốc: TẮT" else "Tiếng gốc: GIỮ"
    }

    private fun showOverlay() {
        val box = LinearLayout(this)
        box.orientation = LinearLayout.VERTICAL
        val on = makeButton {
            val now = !Prefs.enabled(this)
            Prefs.sp(this).edit().putBoolean("enabled", now).apply()
            if (!now) { tts.stop(); inFlight.set(0); Volume.restore(this) }
            refreshLabels()
        }
        val mute = makeButton {
            val now = !Prefs.mute(this)
            Prefs.sp(this).edit().putBoolean("mute", now).apply()
            if (!now) Volume.restore(this)
            refreshLabels()
        }
        val lp = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        lp.bottomMargin = dp(6)
        box.addView(on, lp)
        box.addView(mute)
        btnOn = on
        btnMute = mute

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY, // không cần xin quyền "hiển thị trên ứng dụng khác"
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        )
        params.gravity = Gravity.START or Gravity.CENTER_VERTICAL
        params.x = dp(4)
        try {
            (getSystemService(WINDOW_SERVICE) as WindowManager).addView(box, params)
            overlay = box
        } catch (e: Exception) {
            status = "Không hiện được nút nổi: ${e.message}"
        }
    }

    private fun hideOverlay() {
        val o = overlay ?: return
        try {
            (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(o)
        } catch (e: Exception) { /* bỏ qua */ }
        overlay = null
        btnOn = null
        btnMute = null
    }
}
