package expo.modules.pathuassistant

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.RemoteException
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.SpeechRecognizer

/** Picks the device's real speech recognizer, never Pathu's own proxy. */
object RecognizerDelegate {
  private val PREFERRED = listOf(
    "com.google.android.tts",
    "com.google.android.googlequicksearchbox",
    "com.google.android.as",
  )

  fun find(context: Context): ComponentName? {
    val services = context.packageManager
      .queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)
      .map { it.serviceInfo }
      .filter { it.packageName != context.packageName }
    val best = PREFERRED.firstNotNullOfOrNull { pkg -> services.firstOrNull { it.packageName == pkg } }
      ?: services.firstOrNull()
    return best?.let { ComponentName(it.packageName, it.name) }
  }
}

/**
 * The assistant role requires a RecognitionService, and selecting Pathu as assistant can make it
 * the system default recognizer. Forwarding to the real recognizer keeps the existing
 * expo-speech-recognition fallback (and any other default-recognizer client) working.
 */
class PathuRecognitionService : RecognitionService() {
  private var delegate: SpeechRecognizer? = null

  override fun onStartListening(recognizerIntent: Intent, listener: Callback) {
    val target = RecognizerDelegate.find(this)
    if (target == null) {
      AssistantState.error("recognition proxy: no delegate recognizer installed")
      safe { listener.error(SpeechRecognizer.ERROR_CLIENT) }
      return
    }
    delegate?.destroy()
    AssistantState.event("recognition proxy -> ${target.flattenToShortString()}")
    delegate = SpeechRecognizer.createSpeechRecognizer(this, target).apply {
      setRecognitionListener(Forwarder(listener))
      startListening(recognizerIntent)
    }
  }

  override fun onStopListening(listener: Callback) {
    delegate?.stopListening()
  }

  override fun onCancel(listener: Callback) {
    delegate?.cancel()
  }

  override fun onDestroy() {
    delegate?.destroy()
    delegate = null
    super.onDestroy()
  }

  private class Forwarder(private val cb: Callback) : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) = safe { cb.readyForSpeech(params ?: Bundle()) }
    override fun onBeginningOfSpeech() = safe { cb.beginningOfSpeech() }
    override fun onRmsChanged(rmsdB: Float) = safe { cb.rmsChanged(rmsdB) }
    override fun onBufferReceived(buffer: ByteArray?) = safe { if (buffer != null) cb.bufferReceived(buffer) }
    override fun onEndOfSpeech() = safe { cb.endOfSpeech() }
    override fun onError(error: Int) = safe { cb.error(error) }
    override fun onResults(results: Bundle?) = safe { cb.results(results ?: Bundle()) }
    override fun onPartialResults(partialResults: Bundle?) = safe { cb.partialResults(partialResults ?: Bundle()) }
    override fun onEvent(eventType: Int, params: Bundle?) = Unit
  }
}

private inline fun safe(block: () -> Unit) {
  try {
    block()
  } catch (_: RemoteException) {
  }
}
