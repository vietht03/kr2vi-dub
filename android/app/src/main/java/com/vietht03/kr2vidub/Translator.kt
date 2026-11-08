package com.vietht03.kr2vidub

import org.json.JSONArray
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

// Dịch miễn phí qua endpoint công khai của Google Translate (không cần key), tự nhận ngôn ngữ nguồn.
// Phải gọi từ thread nền.
object Translator {
    // Ký tự đặc trưng của tiếng Việt (không có trong tiếng Anh) và chữ Hán/Nhật/Hàn
    private val VI = Regex("[ăâđêôơưàáạảãầấậẩẫằắặẳẵèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]", RegexOption.IGNORE_CASE)
    private val CJK = Regex("[\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af]")

    private val cache = object : LinkedHashMap<String, String>(256, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 300
    }

    @Volatile private var blockedUntil = 0L // bị Google giới hạn (429): tạm nghỉ

    // Phụ đề đã là tiếng Việt (ví dụ YouTube tự dịch) thì không cần dịch lại
    fun looksVietnamese(t: String) = !CJK.containsMatchIn(t) && VI.containsMatchIn(t)

    @Throws(IOException::class)
    fun toVietnamese(text: String): String {
        if (looksVietnamese(text)) return text
        synchronized(cache) { cache[text]?.let { return it } }
        val wait = blockedUntil - System.currentTimeMillis()
        if (wait > 0) throw IOException("Google đang giới hạn, thử lại sau ${wait / 1000}s")

        val q = URLEncoder.encode(text, "UTF-8")
        var last: IOException? = null
        for (i in 0..1) {
            try {
                val r = if (i == 0) viaSingle(q) else viaChromeExt(q)
                synchronized(cache) { cache[text] = r }
                return r
            } catch (e: IOException) {
                last = e
            }
        }
        if (last?.message?.contains("429") == true) blockedUntil = System.currentTimeMillis() + 30_000
        throw last ?: IOException("Không dịch được")
    }

    private fun get(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 8000
        c.readTimeout = 8000
        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36")
        try {
            if (c.responseCode != 200) throw IOException("HTTP ${c.responseCode}")
            return c.inputStream.bufferedReader().readText()
        } finally {
            c.disconnect()
        }
    }

    // [[["bản dịch","gốc",...],...],...]
    private fun viaSingle(q: String): String {
        val body = get("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=$q")
        val parts = JSONArray(body).getJSONArray(0)
        val sb = StringBuilder()
        for (i in 0 until parts.length()) sb.append(parts.optJSONArray(i)?.optString(0, "") ?: "")
        return sb.toString()
    }

    // [["bản dịch","en"]] (endpoint dự phòng)
    private fun viaChromeExt(q: String): String {
        val body = get("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=vi&q=$q")
        val first = JSONArray(body).get(0)
        return if (first is JSONArray) first.optString(0, "") else first.toString()
    }
}
