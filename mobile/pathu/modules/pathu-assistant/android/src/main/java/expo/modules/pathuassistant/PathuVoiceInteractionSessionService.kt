package expo.modules.pathuassistant

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Locale

class PathuVoiceInteractionSessionService : VoiceInteractionSessionService() {
  override fun onNewSession(args: Bundle?): VoiceInteractionSession = PathuVoiceInteractionSession(this)
}

/**
 * One assistant turn, independent of the React Native UI:
 * capture a spoken command -> Pathu backend POST /chat -> speak the reply with Android TTS,
 * and apply any Audius clientActions to the native PathuMusicPlayer.
 */
class PathuVoiceInteractionSession(context: Context) : VoiceInteractionSession(context) {
  private val main = Handler(Looper.getMainLooper())
  private var statusView: TextView? = null
  private var recognizer: SpeechRecognizer? = null
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private var pendingSpeech: String? = null
  private var pendingMusic: List<MusicAction> = emptyList()
  private var turn = 0

  override fun onCreate() {
    super.onCreate()
    tts = TextToSpeech(context) { status ->
      ttsReady = status == TextToSpeech.SUCCESS
      if (ttsReady) {
        tts?.language = Locale.US
        pendingSpeech?.let { pendingSpeech = null; speak(it) }
      } else {
        AssistantState.error("session: TextToSpeech init failed ($status)")
      }
    }
    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) = Unit
      override fun onDone(utteranceId: String?) {
        main.post { afterSpeech() }
        finishSoon(600)
      }
      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String?) {
        main.post { afterSpeech() }
        finishSoon(0)
      }
    })
  }

  override fun onCreateContentView(): View {
    val pad = dp(24)
    val text = TextView(context).apply {
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
      gravity = Gravity.CENTER
      text = "Pathu"
    }
    statusView = text
    return LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.BOTTOM
      setPadding(pad, pad, pad, pad * 2)
      addView(LinearLayout(context).apply {
        setBackgroundColor(Color.argb(230, 32, 138, 239))
        setPadding(pad, pad, pad, pad)
        addView(text, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
      })
    }
  }

  override fun onShow(args: Bundle?, showFlags: Int) {
    super.onShow(args, showFlags)
    turn += 1
    AssistantState.sessionState = "shown"
    AssistantState.event("session onShow trigger=${args?.getString("trigger") ?: "system"} flags=$showFlags turn=$turn")
    PathuAssistantForegroundService.wakeLoop?.pause(PathuAssistantForegroundService.PAUSE_SESSION)
    startListening()
  }

  override fun onHide() {
    AssistantState.sessionState = "hidden"
    AssistantState.event("session onHide")
    turn += 1
    stopAudio()
    afterSpeech()
    PathuAssistantForegroundService.wakeLoop?.resume(PathuAssistantForegroundService.PAUSE_SESSION)
    super.onHide()
  }

  override fun onDestroy() {
    PathuAssistantForegroundService.wakeLoop?.resume(PathuAssistantForegroundService.PAUSE_SESSION)
    stopAudio()
    tts?.shutdown()
    tts = null
    AssistantState.sessionState = "idle"
    super.onDestroy()
  }

  private fun startListening() {
    val target = RecognizerDelegate.find(context)
    if (target == null) {
      fail("No speech recognizer available")
      return
    }
    setStatus("Listening…")
    AssistantState.sessionState = "listening"
    val thisTurn = turn
    recognizer?.destroy()
    recognizer = SpeechRecognizer.createSpeechRecognizer(context, target).apply {
      setRecognitionListener(object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = setStatus("Thinking…")
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
        override fun onPartialResults(partialResults: Bundle?) {
          firstResult(partialResults)?.let { setStatus(it) }
        }
        override fun onError(error: Int) {
          if (thisTurn != turn) return
          AssistantState.event("session STT error=$error")
          if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
            setStatus("I didn't catch that.")
            finishSoon(1200)
          } else {
            fail("Speech recognition error $error")
          }
        }
        override fun onResults(results: Bundle?) {
          if (thisTurn != turn) return
          val command = firstResult(results)
          if (command.isNullOrBlank()) {
            setStatus("I didn't catch that.")
            finishSoon(1200)
          } else {
            AssistantState.event("session command chars=${command.length}")
            sendToPathu(command, thisTurn)
          }
        }
      })
      startListening(
        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
          putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
          putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
          putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        },
      )
    }
  }

  private fun sendToPathu(command: String, thisTurn: Int) {
    setStatus("“$command”\nThinking…")
    AssistantState.sessionState = "thinking"
    Thread {
      val result = runCatching { PathuChatClient.chat(command) }
      main.post {
        if (thisTurn != turn) return@post
        result.fold(
          onSuccess = { chat ->
            AssistantState.event(
              "session /chat ok replyChars=${chat.reply.length} music=${chat.music.joinToString(",") { it.action }}",
            )
            // Stop-type commands take effect before the reply; starts wait so TTS isn't spoken over the song.
            val (startLater, applyNow) = chat.music.partition { it.action in DEFERRED_MUSIC }
            applyNow.forEach { PathuMusicPlayer.apply(context, it) }
            pendingMusic = startLater
            val spoken = chat.reply.ifBlank { "Done." }
            setStatus(spoken)
            speak(spoken)
          },
          onFailure = { fail("Pathu backend unreachable: ${it.message}") },
        )
      }
    }.start()
  }

  private fun speak(text: String) {
    AssistantState.sessionState = "speaking"
    PathuMusicPlayer.duck(true)
    if (!ttsReady) {
      pendingSpeech = text
      return
    }
    tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "pathu-$turn")
  }

  private fun afterSpeech() {
    PathuMusicPlayer.duck(false)
    val music = pendingMusic
    pendingMusic = emptyList()
    music.forEach { PathuMusicPlayer.apply(context, it) }
  }

  private fun fail(message: String) {
    AssistantState.error("session: $message")
    setStatus(message)
    finishSoon(2500)
  }

  private fun finishSoon(delayMs: Long) {
    val thisTurn = turn
    main.postDelayed({ if (thisTurn == turn) finish() }, delayMs)
  }

  private fun stopAudio() {
    recognizer?.destroy()
    recognizer = null
    pendingSpeech = null
    tts?.stop()
  }

  private fun setStatus(text: String) {
    main.post { statusView?.text = text }
  }

  private fun firstResult(bundle: Bundle?): String? =
    bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim()

  private fun dp(value: Int): Int = (value * context.resources.displayMetrics.density).toInt()

  private companion object {
    val DEFERRED_MUSIC = setOf("play", "resume", "next", "previous")
  }
}
