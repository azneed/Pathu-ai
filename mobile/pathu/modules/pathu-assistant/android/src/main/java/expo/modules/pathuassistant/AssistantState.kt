package expo.modules.pathuassistant

import android.app.role.RoleManager
import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.util.Log

/** Process-wide lifecycle state for the native assistant path (logcat tag PathuAssistant). */
object AssistantState {
  const val TAG = "PathuAssistant"

  @Volatile var serviceState: String = "not_bound"
    private set
  @Volatile var lastEvent: String = "none"
    private set
  @Volatile var lastScreenEvent: String = "unknown"
  @Volatile var readySinceElapsedMs: Long = 0L
  @Volatile var heartbeats: Int = 0
  @Volatile var sessionState: String = "idle"
  @Volatile var lastError: String? = null

  fun setService(state: String) {
    serviceState = state
    if (state == "ready") readySinceElapsedMs = SystemClock.elapsedRealtime()
    event("service $state")
  }

  fun event(message: String) {
    lastEvent = message
    Log.i(TAG, message)
  }

  fun error(message: String, error: Throwable? = null) {
    lastError = message
    Log.e(TAG, message, error)
  }

  fun isAssistantRoleHeld(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
    val roles = context.getSystemService(RoleManager::class.java) ?: return false
    return roles.isRoleAvailable(RoleManager.ROLE_ASSISTANT) && roles.isRoleHeld(RoleManager.ROLE_ASSISTANT)
  }

  fun uptimeSeconds(): Long =
    if (readySinceElapsedMs == 0L) 0 else (SystemClock.elapsedRealtime() - readySinceElapsedMs) / 1000
}
