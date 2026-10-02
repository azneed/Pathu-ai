package expo.modules.pathuassistant

import android.app.Activity
import android.app.ActivityManager
import android.app.Application
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Microphone-typed foreground service owned by the assistant path. Some OEMs (vivo/iQOO) freeze a
 * process that is only kept alive by the system's VoiceInteractionService binding, so the
 * always-on "hey jarvis" wake loop runs inside this service while Pathu is the default assistant.
 */
class PathuAssistantForegroundService : Service() {
  companion object {
    private const val CHANNEL_ID = "pathu_assistant"
    private const val NOTIFICATION_ID = 7201
    const val PAUSE_APP_UI = "app_ui"
    const val PAUSE_SESSION = "session"

    @Volatile var running: Boolean = false
      private set

    @Volatile var wakeLoop: AssistantWakeLoop? = null
      private set

    fun start(context: Context) {
      runCatching {
        ContextCompat.startForegroundService(context, Intent(context, PathuAssistantForegroundService::class.java))
      }.onFailure { AssistantState.error("assistant FGS start failed: ${it.message}", it) }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, PathuAssistantForegroundService::class.java))
    }
  }

  private val main = Handler(Looper.getMainLooper())
  private var wakeLock: PowerManager.WakeLock? = null
  private var startedActivities = 0

  // While Pathu's own UI is visible, the React Native voice path owns the microphone.
  private val activityCallbacks = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityStarted(activity: Activity) {
      startedActivities += 1
      wakeLoop?.pause(PAUSE_APP_UI)
    }
    override fun onActivityStopped(activity: Activity) {
      startedActivities = maxOf(0, startedActivities - 1)
      if (startedActivities == 0) wakeLoop?.resume(PAUSE_APP_UI)
    }
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityResumed(activity: Activity) = Unit
    override fun onActivityPaused(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
    override fun onActivityDestroyed(activity: Activity) = Unit
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      val notification = buildNotification()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
      // Continuous wake-word audio processing needs the CPU awake while the screen is off.
      if (wakeLock?.isHeld != true) {
        wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "pathu:assistant")
          .apply {
            setReferenceCounted(false)
            acquire()
          }
      }
      running = true
      AssistantState.event("assistant FGS started (partial wake lock held)")
      startWakeLoop()
    } catch (error: Exception) {
      AssistantState.error("assistant FGS startForeground failed: ${error.message}", error)
      stopSelf()
      return START_NOT_STICKY
    }
    return START_STICKY
  }

  override fun onDestroy() {
    (application as Application).unregisterActivityLifecycleCallbacks(activityCallbacks)
    wakeLoop?.stop()
    wakeLoop = null
    runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
    wakeLock = null
    running = false
    AssistantState.event("assistant FGS stopped")
    super.onDestroy()
  }

  private fun startWakeLoop() {
    if (wakeLoop != null) return
    val loop = AssistantWakeLoop(this) { main.post { onWake() } }
    if (isAppUiInForeground()) loop.pause(PAUSE_APP_UI)
    (application as Application).registerActivityLifecycleCallbacks(activityCallbacks)
    wakeLoop = loop
    loop.start()
  }

  private fun onWake() {
    val service = PathuVoiceInteractionService.instance
    if (service == null) {
      AssistantState.error("wake: assistant service not bound; ignoring")
      return
    }
    // Release the microphone before the session's recognizer needs it; the session resumes us on hide.
    wakeLoop?.pause(PAUSE_SESSION)
    service.showSession(Bundle().apply { putString("trigger", "wake_word") }, 0)
  }

  private fun isAppUiInForeground(): Boolean {
    val info = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(info)
    return info.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager?.getNotificationChannel(CHANNEL_ID) == null) {
      manager?.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Pathu assistant", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shows while Pathu is the default assistant"
          setShowBadge(false)
        },
      )
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pending = PendingIntent.getActivity(
      this,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Pathu assistant is active")
      .setContentText("Listening for \"Hey Jarvis\"")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .setContentIntent(pending)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }
}
