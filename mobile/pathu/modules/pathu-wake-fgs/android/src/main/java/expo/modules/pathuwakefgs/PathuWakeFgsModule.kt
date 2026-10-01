package expo.modules.pathuwakefgs

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PathuWakeFgsModule : Module() {
  companion object {
    private const val TAG = "PathuWakeFgs"
    private const val EVENT_STATE = "onWakeFgsState"

    @Volatile
    private var moduleRef: PathuWakeFgsModule? = null

    fun emitState() {
      val mod = moduleRef ?: return
      try {
        mod.sendEvent(EVENT_STATE, mod.snapshot())
      } catch (error: Exception) {
        Log.w(TAG, "emitState failed: ${error.message}")
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("PathuWakeFgs")

    Events(EVENT_STATE)

    OnCreate {
      moduleRef = this@PathuWakeFgsModule
    }

    OnDestroy {
      if (moduleRef === this@PathuWakeFgsModule) {
        moduleRef = null
      }
    }

    AsyncFunction("getState") {
      snapshot()
    }

    AsyncFunction("isSupported") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
    }

    AsyncFunction("hasRequiredPermissions") {
      hasRequiredPermissions()
    }

    AsyncFunction("start") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_NO_CONTEXT", "React context unavailable", null)
        return@AsyncFunction
      }
      if (!hasRequiredPermissions()) {
        promise.reject(
          "E_PERMISSION",
          "Missing RECORD_AUDIO / FOREGROUND_SERVICE_MICROPHONE / POST_NOTIFICATIONS",
          null,
        )
        return@AsyncFunction
      }
      try {
        val intent = Intent(context, PathuWakeForegroundService::class.java).apply {
          action = PathuWakeForegroundService.ACTION_START
        }
        ContextCompat.startForegroundService(context, intent)
        Log.i(TAG, "startForegroundService requested")
        promise.resolve(snapshot())
      } catch (error: Exception) {
        PathuWakeForegroundService.lastError = error.message
        promise.reject("E_START", error.message, error)
      }
    }

    AsyncFunction("stop") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_NO_CONTEXT", "React context unavailable", null)
        return@AsyncFunction
      }
      try {
        val intent = Intent(context, PathuWakeForegroundService::class.java).apply {
          action = PathuWakeForegroundService.ACTION_STOP
        }
        // Prefer explicit stop via service; also stopService as fallback.
        context.startService(intent)
        context.stopService(Intent(context, PathuWakeForegroundService::class.java))
        Log.i(TAG, "stopService requested")
        promise.resolve(snapshot())
      } catch (error: Exception) {
        promise.reject("E_STOP", error.message, error)
      }
    }
  }

  private fun hasRequiredPermissions(): Boolean {
    val context = appContext.reactContext ?: return false
    val mic = ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.RECORD_AUDIO,
    ) == PackageManager.PERMISSION_GRANTED

    val notifOk = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.POST_NOTIFICATIONS,
      ) == PackageManager.PERMISSION_GRANTED
    } else {
      true
    }

    // FOREGROUND_SERVICE_MICROPHONE is normal permission on API 34+ (granted at install
    // if declared); still verify for diagnostics.
    val fgsMicOk = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.FOREGROUND_SERVICE_MICROPHONE,
      ) == PackageManager.PERMISSION_GRANTED
    } else {
      true
    }

    return mic && notifOk && fgsMicOk
  }

  private fun snapshot(): Bundle {
    return Bundle().apply {
      putString("state", PathuWakeForegroundService.serviceState)
      putBoolean("active", PathuWakeForegroundService.isActive())
      putString("lastScreenEvent", PathuWakeForegroundService.lastScreenEvent)
      putString("lastError", PathuWakeForegroundService.lastError)
      putString("oemHint", Build.MANUFACTURER + "/" + Build.MODEL)
      putInt("sdkInt", Build.VERSION.SDK_INT)
    }
  }
}
