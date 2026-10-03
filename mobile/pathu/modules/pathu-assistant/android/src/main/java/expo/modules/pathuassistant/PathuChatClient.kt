package expo.modules.pathuassistant

import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject

/** Audius player command from the backend's `clientActions` (mirrors src/music/clientActions.ts). */
data class MusicAction(
  val action: String,
  val trackId: String? = null,
  val streamPath: String? = null,
  val title: String? = null,
  val artist: String? = null,
  val volume: Int? = null,
)

data class ChatReply(val reply: String, val music: List<MusicAction>)

/**
 * Native client for the existing Pathu backend `POST /chat` contract
 * (request `{ message }`, response `{ reply, clientActions?, ... }`), same as mobile/pathu/src/api/client.ts.
 */
object PathuChatClient {
  // Same source as getApiBaseUrl(): EXPO_PUBLIC_API_BASE_URL, baked in by build.gradle.
  val BASE_URL: String = BuildConfig.PATHU_API_BASE_URL.trimEnd('/')
  private const val TIMEOUT_MS = 60_000
  private val TRACK_ID = Regex("^[a-zA-Z0-9]{4,64}$")
  private val MUSIC_ACTIONS = setOf("play", "pause", "resume", "stop", "next", "previous", "set_volume")

  /** Blocking; call off the main thread. */
  fun chat(message: String): ChatReply {
    val connection = URL("$BASE_URL/chat").openConnection() as HttpURLConnection
    try {
      connection.requestMethod = "POST"
      connection.connectTimeout = 5_000
      connection.readTimeout = TIMEOUT_MS
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json")
      connection.setRequestProperty("Accept", "application/json")
      if (BuildConfig.PATHU_API_SECRET.isNotEmpty()) {
        connection.setRequestProperty("Authorization", "Bearer ${BuildConfig.PATHU_API_SECRET}")
      }
      connection.outputStream.use { it.write(JSONObject().put("message", message).toString().toByteArray()) }

      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
      val json = runCatching { JSONObject(body) }.getOrNull()
      if (status !in 200..299) {
        throw IllegalStateException(json?.optString("error")?.takeIf { it.isNotBlank() } ?: "HTTP $status")
      }
      return ChatReply(
        reply = json?.optString("reply")?.trim().orEmpty(),
        music = parseMusicActions(json?.optJSONArray("clientActions")),
      )
    } finally {
      connection.disconnect()
    }
  }

  /** Only same-origin `/music/stream/{trackId}` paths are accepted; YouTube actions are ignored. */
  private fun parseMusicActions(array: JSONArray?): List<MusicAction> {
    if (array == null) return emptyList()
    val actions = mutableListOf<MusicAction>()
    for (i in 0 until array.length()) {
      val item = array.optJSONObject(i) ?: continue
      if (item.optString("type") != "music") continue
      val action = item.optString("action")
      if (action !in MUSIC_ACTIONS) continue
      when (action) {
        "play" -> {
          val trackId = item.optString("trackId")
          val streamPath = item.optString("streamPath")
          if (!TRACK_ID.matches(trackId) || streamPath != "/music/stream/$trackId") continue
          actions += MusicAction(
            action,
            trackId = trackId,
            streamPath = streamPath,
            title = item.optString("title").takeIf { it.isNotBlank() },
            artist = item.optString("artist").takeIf { it.isNotBlank() },
          )
        }
        "set_volume" -> {
          if (!item.has("volume")) continue
          actions += MusicAction(action, volume = item.optInt("volume").coerceIn(0, 100))
        }
        else -> actions += MusicAction(action)
      }
    }
    return actions
  }
}
