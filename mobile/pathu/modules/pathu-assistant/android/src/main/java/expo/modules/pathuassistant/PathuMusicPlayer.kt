package expo.modules.pathuassistant

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory

/**
 * Native Audius playback for the assistant path, independent of the RN screen.
 * Streams via the backend `/music/stream/{trackId}` redirect so AUDIUS_API_KEY never reaches the APK.
 * The backend music session stays the authority for search results / next / previous; the local
 * history only backs bare next/previous actions.
 */
object PathuMusicPlayer {
  data class Track(val trackId: String, val streamPath: String, val title: String?, val artist: String?)

  private const val DUCK_FACTOR = 0.2f
  private val main = Handler(Looper.getMainLooper())
  private var player: ExoPlayer? = null
  private val history = mutableListOf<Track>()
  private var index = -1
  private var volume = 1f
  private var ducked = false

  fun apply(context: Context, action: MusicAction) {
    when (action.action) {
      "play" -> if (action.trackId != null && action.streamPath != null) {
        play(context, Track(action.trackId, action.streamPath, action.title, action.artist))
      }
      "pause" -> pause()
      "resume" -> resume()
      "stop" -> stop()
      "next" -> next(context)
      "previous" -> previous(context)
      "set_volume" -> action.volume?.let { setVolume(it) }
    }
  }

  fun play(context: Context, track: Track) = onMain {
    if (index < 0 || history.getOrNull(index)?.trackId != track.trackId) {
      while (history.size > index + 1) history.removeAt(history.size - 1)
      history += track
      index = history.size - 1
    }
    start(context, track)
  }

  fun pause() = onMain {
    player?.playWhenReady = false
    AssistantState.event("music pause")
  }

  fun resume() = onMain {
    val p = player
    if (p == null) {
      AssistantState.event("music resume ignored: nothing loaded")
      return@onMain
    }
    if (p.playbackState == Player.STATE_IDLE || p.playbackState == Player.STATE_ENDED) p.prepare()
    p.playWhenReady = true
    AssistantState.event("music resume")
  }

  fun stop() = onMain {
    player?.stop()
    AssistantState.event("music stop")
  }

  fun next(context: Context) = onMain {
    if (index + 1 < history.size) {
      index += 1
      start(context, history[index])
    } else {
      AssistantState.event("music next ignored: end of local history")
    }
  }

  fun previous(context: Context) = onMain {
    if (index > 0) {
      index -= 1
      start(context, history[index])
    } else {
      AssistantState.event("music previous ignored: start of local history")
    }
  }

  fun setVolume(percent: Int) = onMain {
    volume = percent.coerceIn(0, 100) / 100f
    applyVolume()
    AssistantState.event("music volume=$percent")
  }

  /** Lowers music under assistant speech without touching the user's volume setting. */
  fun duck(on: Boolean) = onMain {
    if (ducked == on) return@onMain
    ducked = on
    applyVolume()
  }

  fun isPlaying(): Boolean = player?.isPlaying == true

  private fun start(context: Context, track: Track) {
    val p = ensurePlayer(context)
    val metadata = MediaMetadata.Builder().setTitle(track.title).setArtist(track.artist).build()
    p.setMediaItem(
      MediaItem.Builder()
        .setUri(PathuChatClient.BASE_URL + track.streamPath)
        .setMediaId(track.trackId)
        .setMediaMetadata(metadata)
        .build(),
    )
    p.prepare()
    p.playWhenReady = true
    AssistantState.event("music play track=${track.trackId} historyIndex=$index")
  }

  private fun ensurePlayer(context: Context): ExoPlayer {
    player?.let { return it }
    // /music/stream answers http -> 302 https CDN, so cross-protocol redirects must be allowed.
    val http = DefaultHttpDataSource.Factory()
      .setAllowCrossProtocolRedirects(true)
      .setUserAgent("Pathu-Android")
    val created = ExoPlayer.Builder(context.applicationContext)
      .setMediaSourceFactory(DefaultMediaSourceFactory(http))
      .setAudioAttributes(
        AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
        true,
      )
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .build()
    created.addListener(object : Player.Listener {
      override fun onIsPlayingChanged(isPlaying: Boolean) {
        AssistantState.event("music isPlaying=$isPlaying state=${created.playbackState}")
      }

      override fun onPlayerError(error: PlaybackException) {
        AssistantState.error("music error ${error.errorCodeName}")
      }
    })
    player = created
    applyVolume()
    return created
  }

  private fun applyVolume() {
    player?.volume = if (ducked) volume * DUCK_FACTOR else volume
  }

  private fun onMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block)
  }
}
