package expo.modules.pathuassistant

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.service.voice.VoiceInteractionService
import androidx.core.content.ContextCompat

/**
 * Bound by the system while Pathu is the selected default digital assistant, independently of
 * the React Native activity. Owns the assistant foreground service and lifecycle logging.
 */
class PathuVoiceInteractionService : VoiceInteractionService() {
  companion object {
    private const val HEARTBEAT_MS = 60_000L

    @Volatile var instance: PathuVoiceInteractionService? = null
      private set
  }

  private val handler = Handler(Looper.getMainLooper())
  private var screenReceiver: BroadcastReceiver? = null

  private val heartbeat = object : Runnable {
    override fun run() {
      AssistantState.heartbeats += 1
      val interactive = (getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
      AssistantState.event(
        "heartbeat #${AssistantState.heartbeats} uptime=${AssistantState.uptimeSeconds()}s " +
          "interactive=$interactive screen=${AssistantState.lastScreenEvent}",
      )
      handler.postDelayed(this, HEARTBEAT_MS)
    }
  }

  override fun onCreate() {
    super.onCreate()
    AssistantState.setService("created")
  }

  override fun onReady() {
    super.onReady()
    instance = this
    AssistantState.setService("ready")
    registerScreenReceiver()
    handler.removeCallbacks(heartbeat)
    handler.postDelayed(heartbeat, HEARTBEAT_MS)
    PathuAssistantForegroundService.start(this)
  }

  override fun onShutdown() {
    instance = null
    AssistantState.setService("shutdown")
    stopMonitoring()
    PathuAssistantForegroundService.stop(this)
    super.onShutdown()
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    stopMonitoring()
    AssistantState.setService("destroyed")
    super.onDestroy()
  }

  private fun stopMonitoring() {
    handler.removeCallbacks(heartbeat)
    screenReceiver?.let { runCatching { unregisterReceiver(it) } }
    screenReceiver = null
  }

  private fun registerScreenReceiver() {
    if (screenReceiver != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        val name = when (intent?.action) {
          Intent.ACTION_SCREEN_OFF -> "screen_off"
          Intent.ACTION_SCREEN_ON -> "screen_on"
          Intent.ACTION_USER_PRESENT -> "user_present"
          else -> return
        }
        AssistantState.lastScreenEvent = name
        AssistantState.event("$name (service ${AssistantState.serviceState}, uptime=${AssistantState.uptimeSeconds()}s)")
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    ContextCompat.registerReceiver(this, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    screenReceiver = receiver
  }
}
