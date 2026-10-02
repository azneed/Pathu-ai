package expo.modules.pathuassistant

import android.os.Bundle
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Read-only status of the native assistant path for the React Native UI. */
class PathuAssistantModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PathuAssistant")

    AsyncFunction("getStatus") {
      val context = appContext.reactContext
      Bundle().apply {
        putBoolean("isDefaultAssistant", context?.let { AssistantState.isAssistantRoleHeld(it) } ?: false)
        putString("serviceState", AssistantState.serviceState)
        putString("sessionState", AssistantState.sessionState)
        putString("wakeState", PathuAssistantForegroundService.wakeLoop?.state ?: "stopped")
        putString("lastEvent", AssistantState.lastEvent)
        putString("lastScreenEvent", AssistantState.lastScreenEvent)
        putDouble("uptimeSeconds", AssistantState.uptimeSeconds().toDouble())
        putInt("heartbeats", AssistantState.heartbeats)
        putString("lastError", AssistantState.lastError)
      }
    }
  }
}
