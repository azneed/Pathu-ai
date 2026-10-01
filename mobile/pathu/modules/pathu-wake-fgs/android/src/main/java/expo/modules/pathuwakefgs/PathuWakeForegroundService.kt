package expo.modules.pathuwakefgs

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Microphone-typed foreground service that keeps Pathu eligible to capture
 * audio while the screen is locked. Does NOT run a second KWS/mic pipeline —
 * JS sherpa-onnx + LiveAudioStream remains the sole audio consumer.
 */
class PathuWakeForegroundService : Service() {
  companion object {
    const val TAG = "PathuWakeFgs"
    const val CHANNEL_ID = "pathu_wake_listening"
    const val NOTIFICATION_ID = 7101
    const val ACTION_START = "com.anonymous.pathu.wake.START"
    const val ACTION_STOP = "com.anonymous.pathu.wake.STOP"

    @Volatile
    var serviceState: String = "stopped"
      private set

    @Volatile
    var lastScreenEvent: String = "unknown"
      private set

    @Volatile
    var lastError: String? = null

    @Volatile
    var instance: PathuWakeForegroundService? = null
      private set

    fun isActive(): Boolean = serviceState == "listening" || serviceState == "starting"
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var screenReceiver: BroadcastReceiver? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    createNotificationChannel()
    registerScreenReceiver()
    Log.i(TAG, "service onCreate")
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        Log.i(TAG, "service stop requested")
        setState("stopping")
        stopSelfInternal()
        return START_NOT_STICKY
      }
      else -> {
        if (serviceState == "listening") {
          Log.i(TAG, "service already listening — ignore duplicate start")
          PathuWakeFgsModule.emitState()
          return START_STICKY
        }
        setState("starting")
        try {
          val notification = buildNotification()
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
              NOTIFICATION_ID,
              notification,
              ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            )
          } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
              NOTIFICATION_ID,
              notification,
              ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            )
          } else {
            startForeground(NOTIFICATION_ID, notification)
          }
          acquireWakeLock()
          setState("listening")
          Log.i(TAG, "service listening (microphone FGS)")
        } catch (error: Exception) {
          lastError = error.message ?: error.toString()
          setState("error")
          Log.e(TAG, "service start failed", error)
          stopSelfInternal()
        }
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    Log.i(TAG, "service onDestroy")
    unregisterScreenReceiver()
    releaseWakeLock()
    instance = null
    if (serviceState != "error") {
      setState("stopped")
    }
    super.onDestroy()
  }

  private fun stopSelfInternal() {
    releaseWakeLock()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
    setState("stopped")
  }

  private fun setState(next: String) {
    serviceState = next
    PathuWakeFgsModule.emitState()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Pathu wake word",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "Shows while Pathu listens for Hey Pathu"
      setShowBadge(false)
    }
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val pending = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Pathu is listening for Hey Pathu")
      .setContentText("Wake-word microphone is active")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .setContentIntent(pending)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(
      PowerManager.PARTIAL_WAKE_LOCK,
      "pathu:wake_word",
    ).also {
      it.setReferenceCounted(false)
      it.acquire(60 * 60 * 1000L) // 1h max; service stop releases earlier
      Log.i(TAG, "PARTIAL_WAKE_LOCK acquired")
    }
  }

  private fun releaseWakeLock() {
    try {
      if (wakeLock?.isHeld == true) {
        wakeLock?.release()
        Log.i(TAG, "PARTIAL_WAKE_LOCK released")
      }
    } catch (_: Exception) {
    }
    wakeLock = null
  }

  private fun registerScreenReceiver() {
    if (screenReceiver != null) return
    screenReceiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        val action = intent?.action ?: return
        when (action) {
          Intent.ACTION_SCREEN_OFF -> {
            lastScreenEvent = "screen_off"
            Log.i(TAG, "screen_off (locked/off)")
          }
          Intent.ACTION_SCREEN_ON -> {
            lastScreenEvent = "screen_on"
            Log.i(TAG, "screen_on")
          }
          Intent.ACTION_USER_PRESENT -> {
            lastScreenEvent = "user_present"
            Log.i(TAG, "user_present (unlocked)")
          }
        }
        PathuWakeFgsModule.emitState()
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    ContextCompat.registerReceiver(
      this,
      screenReceiver,
      filter,
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
  }

  private fun unregisterScreenReceiver() {
    try {
      screenReceiver?.let { unregisterReceiver(it) }
    } catch (_: Exception) {
    }
    screenReceiver = null
  }
}
