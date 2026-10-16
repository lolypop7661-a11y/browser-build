package app.browsery.android

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class Entry(val url: String, val title: String, val time: Long = System.currentTimeMillis())
data class Shortcut(val name: String, val url: String)

/** Everything Browsery keeps on the phone, in the app's private storage. */
class Store(context: Context) {
    private val prefs = context.getSharedPreferences("browsery", Context.MODE_PRIVATE)

    var engine: String
        get() = prefs.getString("engine", "Browsery") ?: "Browsery"
        set(v) = prefs.edit().putString("engine", v).apply()
    var suggestions: Boolean
        get() = prefs.getBoolean("suggestions", true)
        set(v) = prefs.edit().putBoolean("suggestions", v).apply()
    var shield: Boolean
        get() = prefs.getBoolean("shield", true)
        set(v) = prefs.edit().putBoolean("shield", v).apply()
    var httpsOnly: Boolean
        get() = prefs.getBoolean("httpsOnly", true)
        set(v) = prefs.edit().putBoolean("httpsOnly", v).apply()
    var thirdPartyCookies: Boolean
        get() = prefs.getBoolean("thirdPartyCookies", false)
        set(v) = prefs.edit().putBoolean("thirdPartyCookies", v).apply()
    var chill: Boolean
        get() = prefs.getBoolean("chill", false)
        set(v) = prefs.edit().putBoolean("chill", v).apply()
    var restore: Boolean
        get() = prefs.getBoolean("restore", true)
        set(v) = prefs.edit().putBoolean("restore", v).apply()
    var groqKey: String
        get() = prefs.getString("groqKey", "") ?: ""
        set(v) = prefs.edit().putString("groqKey", v.trim()).apply()
    var groqModel: String
        get() = prefs.getString("groqModel", "openai/gpt-oss-120b") ?: "openai/gpt-oss-120b"
        set(v) = prefs.edit().putString("groqModel", v).apply()
    var blockedTotal: Long
        get() = prefs.getLong("blockedTotal", 0)
        set(v) = prefs.edit().putLong("blockedTotal", v).apply()

    fun searchUrl(query: String): String {
        val q = android.net.Uri.encode(query)
        return when (engine) {
            "DuckDuckGo" -> "https://duckduckgo.com/?q=$q"
            "Bing" -> "https://www.bing.com/search?q=$q"
            else -> "https://www.mojeek.com/search?q=$q"
        }
    }

    private fun readEntries(key: String): MutableList<Entry> {
        val out = mutableListOf<Entry>()
        try {
            val arr = JSONArray(prefs.getString(key, "[]"))
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                out.add(Entry(o.getString("url"), o.optString("title"), o.optLong("time")))
            }
        } catch (_: Exception) { }
        return out
    }

    private fun writeEntries(key: String, list: List<Entry>) {
        val arr = JSONArray()
        list.forEach { arr.put(JSONObject().put("url", it.url).put("title", it.title).put("time", it.time)) }
        prefs.edit().putString(key, arr.toString()).apply()
    }

    val history: MutableList<Entry> get() = readEntries("history")
    val bookmarks: MutableList<Entry> get() = readEntries("bookmarks")

    fun addHistory(url: String, title: String) {
        if (!url.startsWith("http")) return
        val list = history.filterNot { it.url == url }.toMutableList()
        list.add(0, Entry(url, title.ifBlank { url }))
        writeEntries("history", list.take(400))
    }

    fun removeHistory(url: String) = writeEntries("history", history.filterNot { it.url == url })
    fun clearHistory() = writeEntries("history", emptyList())

    fun isBookmarked(url: String?) = url != null && bookmarks.any { it.url == url }
    fun toggleBookmark(url: String, title: String): Boolean {
        val list = bookmarks
        return if (list.any { it.url == url }) {
            writeEntries("bookmarks", list.filterNot { it.url == url }); false
        } else {
            list.add(0, Entry(url, title.ifBlank { url })); writeEntries("bookmarks", list); true
        }
    }
    fun removeBookmark(url: String) = writeEntries("bookmarks", bookmarks.filterNot { it.url == url })

    var shortcuts: List<Shortcut>
        get() {
            val raw = prefs.getString("shortcuts", null) ?: return DEFAULT_SHORTCUTS
            return try {
                val arr = JSONArray(raw)
                (0 until arr.length()).map { arr.getJSONObject(it).let { o -> Shortcut(o.getString("name"), o.getString("url")) } }
            } catch (_: Exception) { DEFAULT_SHORTCUTS }
        }
        set(v) {
            val arr = JSONArray()
            v.forEach { arr.put(JSONObject().put("name", it.name).put("url", it.url)) }
            prefs.edit().putString("shortcuts", arr.toString()).apply()
        }

    fun saveSession(urls: List<String>, active: Int) {
        prefs.edit().putString("session", JSONArray(urls).toString()).putInt("sessionActive", active).apply()
    }

    fun session(): Pair<List<String>, Int> = try {
        val arr = JSONArray(prefs.getString("session", "[]"))
        (0 until arr.length()).map { arr.getString(it) } to prefs.getInt("sessionActive", 0)
    } catch (_: Exception) { emptyList<String>() to 0 }

    companion object {
        val DEFAULT_SHORTCUTS = listOf(
            Shortcut("YouTube", "https://m.youtube.com/"),
            Shortcut("Wikipedia", "https://en.m.wikipedia.org/"),
            Shortcut("GitHub", "https://github.com/"),
            Shortcut("Gmail", "https://mail.google.com/"),
            Shortcut("Reddit", "https://www.reddit.com/"),
            Shortcut("News", "https://news.google.com/"),
            Shortcut("Maps", "https://www.openstreetmap.org/"),
        )
    }
}
