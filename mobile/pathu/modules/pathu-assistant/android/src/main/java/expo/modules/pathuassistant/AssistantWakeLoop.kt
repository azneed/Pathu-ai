package expo.modules.pathuassistant

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import androidx.core.content.ContextCompat
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap

/**
 * Always-on microphone loop for the pre-trained "hey jarvis" detector. Audio stays in memory and
 * is never logged, stored or sent anywhere; only scores and timings are logged.
 * Paused (microphone released) while any pause reason is set, e.g. Pathu's own UI is visible
 * (the React Native foreground voice owns the mic there) or an assistant session is active.
 */
class AssistantWakeLoop(
  private val context: Context,
  private val threshold: Float = HeyJarvisDetector.DEFAULT_THRESHOLD,
  private val onWake: (score: Float) -> Unit,
) {
  companion object {
    private const val REFRACTORY_MS = 2_000L
    private const val STATS_MS = 60_000L
    private const val RETRY_MS = 5_000L
  }

  private val pauseReasons: MutableSet<String> = ConcurrentHashMap.newKeySet()
  private val lock = Object()
  @Volatile private var running = false
  private var thread: Thread? = null

  @Volatile var state: String = "stopped"
    private set

  fun start() {
    if (running) return
    running = true
    thread = Thread(::run, "PathuWakeLoop").apply { start() }
  }

  fun stop() {
    running = false
    wake()
    thread?.join(2_000)
    thread = null
  }

  fun pause(reason: String) {
    if (pauseReasons.add(reason)) AssistantState.event("wake loop pause: $reason")
  }

  fun resume(reason: String) {
    if (pauseReasons.remove(reason)) {
      AssistantState.event("wake loop resume: $reason (remaining=${pauseReasons.joinToString()})")
      wake()
    }
  }

  private fun wake() = synchronized(lock) { lock.notifyAll() }

  private fun setState(next: String) {
    if (state != next) {
      state = next
      AssistantState.event("wake loop $next")
    }
  }

  private fun run() {
    val detector = try {
      HeyJarvisDetector(context)
    } catch (error: Throwable) {
      AssistantState.error("wake loop: detector init failed: ${error.message}", error)
      setState("error")
      running = false
      return
    }
    try {
      if (BuildConfig.DEBUG) selfTest(detector)
      while (running) {
        if (pauseReasons.isNotEmpty()) {
          setState("paused")
          synchronized(lock) { if (running && pauseReasons.isNotEmpty()) lock.wait() }
          continue
        }
        if (!listen(detector)) {
          synchronized(lock) { if (running) lock.wait(RETRY_MS) }
        }
      }
    } finally {
      detector.close()
      setState("stopped")
    }
  }

  /** Returns false on a recoverable failure (retry after a delay). */
  private fun listen(detector: HeyJarvisDetector): Boolean {
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      AssistantState.error("wake loop: RECORD_AUDIO not granted")
      setState("no_permission")
      return false
    }
    val minBuffer = AudioRecord.getMinBufferSize(
      HeyJarvisDetector.SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    val record = try {
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        HeyJarvisDetector.SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        maxOf(minBuffer, HeyJarvisDetector.FRAME_SAMPLES * 2 * 4),
      )
    } catch (error: SecurityException) {
      AssistantState.error("wake loop: AudioRecord denied: ${error.message}", error)
      setState("error")
      return false
    }
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      AssistantState.error("wake loop: AudioRecord not initialized")
      setState("error")
      return false
    }

    val frame = ShortArray(HeyJarvisDetector.FRAME_SAMPLES)
    var lastWake = 0L
    var lastStats = SystemClock.elapsedRealtime()
    var frames = 0
    var maxScore = 0f
    var inferNs = 0L
    try {
      record.startRecording()
      detector.reset()
      setState("listening")
      while (running && pauseReasons.isEmpty()) {
        var offset = 0
        while (offset < frame.size) {
          val n = record.read(frame, offset, frame.size - offset)
          if (n <= 0) {
            AssistantState.error("wake loop: AudioRecord.read returned $n")
            setState("error")
            return false
          }
          offset += n
        }
        val t0 = System.nanoTime()
        val score = detector.process(frame)
        inferNs += System.nanoTime() - t0
        frames += 1
        if (score > maxScore) maxScore = score

        val now = SystemClock.elapsedRealtime()
        if (score >= threshold && now - lastWake >= REFRACTORY_MS) {
          lastWake = now
          AssistantState.event("wake '${detector.modelName}' score=${"%.3f".format(score)} threshold=$threshold")
          onWake(score)
        }
        if (now - lastStats >= STATS_MS) {
          AssistantState.event(
            "wake loop alive frames=$frames maxScore=${"%.3f".format(maxScore)} " +
              "avgInferMs=${"%.2f".format(inferNs / 1e6 / frames)} screen=${AssistantState.lastScreenEvent}",
          )
          lastStats = now
          frames = 0
          maxScore = 0f
          inferNs = 0L
        }
      }
      return true
    } finally {
      runCatching { record.stop() }
      record.release()
    }
  }

  /** Debug builds only: scores WAVs pushed to <external files>/jarvis_selftest/ (16 kHz mono PCM16). */
  private fun selfTest(detector: HeyJarvisDetector) {
    val dir = File(context.getExternalFilesDir(null), "jarvis_selftest")
    val files = dir.listFiles { f -> f.extension.equals("wav", ignoreCase = true) }?.sortedBy { it.name } ?: return
    for (file in files) {
      val samples = readPcm16Wav(file)
      if (samples == null) {
        AssistantState.event("selftest ${file.name}: unsupported WAV (need 16 kHz mono PCM16)")
        continue
      }
      detector.reset()
      val padded = ShortArray(HeyJarvisDetector.SAMPLE_RATE) + samples + ShortArray(HeyJarvisDetector.SAMPLE_RATE)
      var peak = 0f
      var peakAt = 0
      var frames = 0
      var i = 0
      while (i + HeyJarvisDetector.FRAME_SAMPLES <= padded.size) {
        val s = detector.process(padded.copyOfRange(i, i + HeyJarvisDetector.FRAME_SAMPLES))
        if (s > peak) { peak = s; peakAt = frames }
        frames += 1
        i += HeyJarvisDetector.FRAME_SAMPLES
      }
      AssistantState.event(
        "selftest ${file.name}: peak=${"%.3f".format(peak)} at=${"%.2f".format(peakAt * 0.08)}s " +
          "detected=${peak >= threshold}",
      )
    }
    detector.reset()
  }

  private fun readPcm16Wav(file: File): ShortArray? {
    val bytes = file.readBytes()
    val buf = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    if (bytes.size < 44 || String(bytes, 0, 4) != "RIFF" || String(bytes, 8, 4) != "WAVE") return null
    var pos = 12
    var channels = 0
    var rate = 0
    var bits = 0
    while (pos + 8 <= bytes.size) {
      val id = String(bytes, pos, 4)
      val size = buf.getInt(pos + 4)
      val body = pos + 8
      if (id == "fmt ") {
        channels = buf.getShort(body + 2).toInt()
        rate = buf.getInt(body + 4)
        bits = buf.getShort(body + 14).toInt()
      } else if (id == "data") {
        if (channels != 1 || rate != HeyJarvisDetector.SAMPLE_RATE || bits != 16) return null
        val end = minOf(bytes.size, body + size)
        return ShortArray((end - body) / 2) { buf.getShort(body + it * 2) }
      }
      pos = body + size + (size and 1)
    }
    return null
  }
}
