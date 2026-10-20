package net.littland.app

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Where the game and voice live. Read from the same manifest the PC launcher
 * uses (GitHub Pages), so addresses change without a new app release.
 */
data class ServerConfig(
    val bedrockHost: String,
    val bedrockPort: Int,
    val voiceHost: String,
    val voicePort: Int,
    val voiceEnabled: Boolean,
    val discordUrl: String? = null,
) {
    data class News(val title: String, val date: String, val body: String, val url: String?)

    companion object {
        const val DEFAULT_MANIFEST = "https://arcadex999.github.io/littland-modpack/manifest.json"
        private const val GAME_HOST = "littland2.holy.gg"
        private const val PREFS = "littland"

        val FALLBACK = ServerConfig(GAME_HOST, 19132, GAME_HOST, 24454, false)

        /** Dev builds can point at a local test server (long-press the logo). */
        fun manifestUrl(context: Context): String =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("manifestUrl", null) ?: DEFAULT_MANIFEST

        fun setManifestUrl(context: Context, url: String?) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().apply {
                if (url.isNullOrBlank()) remove("manifestUrl") else putString("manifestUrl", url.trim())
            }.apply()
        }

        /** Blocking: call off the main thread. Retries briefly in case the network is still coming up. */
        fun load(context: Context): ServerConfig {
            val url = manifestUrl(context)
            var json: JSONObject? = null
            for (attempt in 1..3) {
                json = try {
                    val conn = URL(url).openConnection() as HttpURLConnection
                    conn.connectTimeout = 8000
                    conn.readTimeout = 8000
                    conn.useCaches = false
                    conn.inputStream.bufferedReader().use { JSONObject(it.readText()) }
                        .also { cache(context, it.toString()) }
                } catch (_: Exception) {
                    if (attempt < 3) Thread.sleep(2000L * attempt)
                    null
                }
                if (json != null) break
            }
            json = json ?: cached(context) ?: return FALLBACK

            val bedrock = json.optJSONObject("bedrock")
            val voice = json.optJSONObject("voice")
            val bedrockHost = bedrock?.optString("host")?.takeIf { it.isNotBlank() } ?: FALLBACK.bedrockHost
            return ServerConfig(
                bedrockHost = bedrockHost,
                bedrockPort = bedrock?.optInt("port", 19132) ?: 19132,
                // Without an explicit voice host the plugin runs on the game machine.
                voiceHost = voice?.optString("host")?.takeIf { it.isNotBlank() } ?: bedrockHost,
                voicePort = voice?.optInt("port", 24454) ?: 24454,
                voiceEnabled = voice != null && voice.optBoolean("enabled", true),
                discordUrl = json.optJSONObject("links")?.optString("discord")?.takeIf { it.startsWith("https://") },
            )
        }

        /** news.json next to the manifest (newest first). Blocking: call off the main thread. */
        fun loadNews(context: Context): List<News> {
            val url = URL(URL(manifestUrl(context)), "news.json")
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val text = try {
                val conn = url.openConnection() as HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.useCaches = false
                conn.inputStream.bufferedReader().use { it.readText() }.also { prefs.edit().putString("news", it).apply() }
            } catch (_: Exception) {
                prefs.getString("news", null)
            } ?: return emptyList()
            return try {
                val array = org.json.JSONArray(text)
                List(array.length()) { i ->
                    val n = array.getJSONObject(i)
                    News(
                        title = n.optString("title"),
                        date = n.optString("date"),
                        body = n.optString("body"),
                        url = n.optString("url").takeIf { it.startsWith("https://") },
                    )
                }.sortedByDescending { it.date }
            } catch (_: Exception) {
                emptyList()
            }
        }

        private fun cache(context: Context, json: String) =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("manifest", json).apply()

        private fun cached(context: Context): JSONObject? =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("manifest", null)?.let { JSONObject(it) }
    }
}
