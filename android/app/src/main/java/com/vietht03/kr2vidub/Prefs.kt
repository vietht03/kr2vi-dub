package com.vietht03.kr2vidub

import android.content.Context
import android.content.SharedPreferences
import android.media.AudioManager
import android.util.Log

// Cài đặt lưu cục bộ
object Prefs {
    fun sp(c: Context): SharedPreferences = c.getSharedPreferences("kr2vi", Context.MODE_PRIVATE)

    fun enabled(c: Context) = sp(c).getBoolean("enabled", true)   // bật/tắt đọc phụ đề
    fun rate(c: Context) = sp(c).getFloat("rate", 1.0f)           // tốc độ đọc cơ bản
    fun debug(c: Context) = sp(c).getBoolean("debug", false)      // ghi cấu trúc màn hình để chẩn đoán
    fun mute(c: Context) = sp(c).getBoolean("mute", false)        // tắt tiếng gốc khi đang đọc

    // Âm lượng nhạc/video đã lưu trước khi tắt tiếng (-1 = không có). Lưu lại để khôi phục nếu app bị tắt giữa chừng
    fun savedVol(c: Context) = sp(c).getInt("savedVol", -1)
    fun setSavedVol(c: Context, v: Int) = sp(c).edit().putInt("savedVol", v).apply()
}

object Volume {
    // Trả âm lượng nhạc/video về mức đã lưu
    fun restore(c: Context) {
        val v = Prefs.savedVol(c)
        if (v < 0) return
        try {
            (c.getSystemService(Context.AUDIO_SERVICE) as AudioManager)
                .setStreamVolume(AudioManager.STREAM_MUSIC, v, 0)
        } catch (e: Exception) { /* bỏ qua */ }
        Prefs.setSavedVol(c, -1)
    }

    // Hạ âm lượng nhạc/video về 0 (lưu mức cũ để khôi phục)
    fun mute(c: Context) {
        val am = c.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Prefs.savedVol(c) < 0) Prefs.setSavedVol(c, am.getStreamVolume(AudioManager.STREAM_MUSIC))
        try {
            am.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0)
        } catch (e: Exception) {
            Log.d("KR2VI", "mute loi: ${e.message}")
        }
        Log.d("KR2VI", "mute: am luong nhac sau khi ha = ${am.getStreamVolume(AudioManager.STREAM_MUSIC)}")
    }
}
