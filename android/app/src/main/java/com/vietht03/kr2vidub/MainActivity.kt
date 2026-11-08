package com.vietht03.kr2vidub

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import kotlin.math.roundToInt

// Màn hình chính: hướng dẫn bật dịch vụ, chỉnh tốc độ, thử giọng, chẩn đoán
class MainActivity : Activity() {

    private val h = Handler(Looper.getMainLooper())
    private lateinit var statusView: TextView
    private lateinit var liveView: TextView

    private val refresh = object : Runnable {
        override fun run() {
            val on = CaptionService.instance != null
            statusView.text = (if (on) "✅ Dịch vụ đang chạy" else "⚠️ Dịch vụ chưa bật") +
                "\n" + CaptionService.status
            liveView.text = "Phụ đề vừa đọc được:\n" + CaptionService.lastCaption +
                (if (Prefs.debug(this@MainActivity)) "\n\n--- Cấu trúc màn hình YouTube ---\n" + CaptionService.lastDump else "")
            h.postDelayed(this, 1000)
        }
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

    private fun button(text: String, onClick: () -> Unit): Button {
        val b = Button(this)
        b.text = text
        b.setOnClickListener { onClick() }
        return b
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this)
        root.orientation = LinearLayout.VERTICAL
        root.setPadding(dp(16), dp(24), dp(16), dp(16))

        val title = TextView(this)
        title.text = "KR2VI Dub"
        title.textSize = 24f
        title.setTypeface(null, Typeface.BOLD)
        root.addView(title)

        val guide = TextView(this)
        guide.text = "1) Bấm nút bên dưới → Ứng dụng đã cài đặt → KR2VI Dub → Bật.\n" +
            "2) Mở app YouTube, bật phụ đề (CC) của video.\n" +
            "3) App dịch phụ đề sang tiếng Việt và đọc thành tiếng.\n" +
            "4) Khi mở YouTube sẽ có 2 nút nổi ở mép trái màn hình: \"Lồng tiếng: BẬT/TẮT\" và \"Tiếng gốc: GIỮ/TẮT\"."
        guide.setPadding(0, dp(8), 0, dp(8))
        root.addView(guide)

        statusView = TextView(this)
        statusView.setPadding(0, dp(8), 0, dp(8))
        root.addView(statusView)

        root.addView(button("Mở cài đặt Trợ năng") {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        })
        root.addView(button("Cài đặt giọng đọc (TTS)") {
            try {
                startActivity(Intent("com.android.settings.TTS_SETTINGS"))
            } catch (e: Exception) {
                Toast.makeText(this, "Không mở được cài đặt giọng đọc", Toast.LENGTH_SHORT).show()
            }
        })
        root.addView(button("Đọc thử giọng Việt") {
            val s = CaptionService.instance
            if (s == null) Toast.makeText(this, "Hãy bật dịch vụ Trợ năng trước", Toast.LENGTH_SHORT).show()
            else s.speakTest()
        })

        val sw = Switch(this)
        sw.text = "Đọc phụ đề YouTube bằng tiếng Việt"
        sw.isChecked = Prefs.enabled(this)
        sw.setOnCheckedChangeListener { _, c -> Prefs.sp(this).edit().putBoolean("enabled", c).apply() }
        sw.setPadding(0, dp(12), 0, dp(12))
        root.addView(sw)

        val mute = Switch(this)
        mute.text = "Tắt tiếng gốc của video khi đang đọc\n(giọng đọc đi theo âm lượng BÁO THỨC nên vẫn nghe được. Nếu máy không cho app hạ hết, hãy hạ âm lượng media bằng phím cứng)"
        mute.isChecked = Prefs.mute(this)
        mute.setOnCheckedChangeListener { _, c ->
            Prefs.sp(this).edit().putBoolean("mute", c).apply()
            if (!c) Volume.restore(this)
        }
        mute.setPadding(0, dp(4), 0, dp(12))
        root.addView(mute)
        root.addView(button("Khôi phục âm lượng video/nhạc") {
            Volume.restore(this)
            Toast.makeText(this, "Đã khôi phục", Toast.LENGTH_SHORT).show()
        })

        val rateLabel = TextView(this)
        root.addView(rateLabel)
        val seek = SeekBar(this)
        seek.max = 9 // 0.6x … 1.5x
        seek.progress = ((Prefs.rate(this) - 0.6f) / 0.1f).roundToInt().coerceIn(0, 9)
        fun showRate(p: Int) { rateLabel.text = "Tốc độ đọc: %.1fx".format(0.6f + 0.1f * p) }
        showRate(seek.progress)
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, p: Int, fromUser: Boolean) {
                showRate(p)
                Prefs.sp(this@MainActivity).edit().putFloat("rate", 0.6f + 0.1f * p).apply()
            }
            override fun onStartTrackingTouch(sb: SeekBar?) {}
            override fun onStopTrackingTouch(sb: SeekBar?) {}
        })
        root.addView(seek)

        val volLabel = TextView(this)
        volLabel.setPadding(0, dp(12), 0, 0)
        root.addView(volLabel)
        val volSeek = SeekBar(this)
        volSeek.max = 100
        volSeek.progress = Prefs.volume(this)
        volLabel.text = "Âm lượng giọng lồng tiếng: ${volSeek.progress}%"
        volSeek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(sb: SeekBar?, p: Int, fromUser: Boolean) {
                volLabel.text = "Âm lượng giọng lồng tiếng: $p%"
                Prefs.sp(this@MainActivity).edit().putInt("ttsVolume", p).apply()
                CaptionService.instance?.applyVolume()
            }
            override fun onStartTrackingTouch(sb: SeekBar?) {}
            override fun onStopTrackingTouch(sb: SeekBar?) {}
        })
        root.addView(volSeek)

        val dbg = Switch(this)
        dbg.text = "Chế độ chẩn đoán (ghi cấu trúc màn hình YouTube)"
        dbg.isChecked = Prefs.debug(this)
        dbg.setOnCheckedChangeListener { _, c -> Prefs.sp(this).edit().putBoolean("debug", c).apply() }
        dbg.setPadding(0, dp(16), 0, dp(8))
        root.addView(dbg)

        root.addView(button("Sao chép cấu trúc màn hình") {
            val cm = getSystemService(CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("kr2vi-dump", CaptionService.lastDump))
            Toast.makeText(this, "Đã sao chép", Toast.LENGTH_SHORT).show()
        })

        liveView = TextView(this)
        liveView.typeface = Typeface.MONOSPACE
        liveView.textSize = 11f
        liveView.setPadding(0, dp(12), 0, 0)
        root.addView(liveView)

        val scroll = ScrollView(this)
        scroll.addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        setContentView(scroll)
    }

    override fun onResume() {
        super.onResume()
        h.post(refresh)
    }

    override fun onPause() {
        h.removeCallbacks(refresh)
        super.onPause()
    }
}
