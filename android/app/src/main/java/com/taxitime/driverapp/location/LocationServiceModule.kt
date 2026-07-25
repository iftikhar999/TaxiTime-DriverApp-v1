package com.taxitime.driverapp.location

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

class LocationServiceModule(private val reactContext: ReactApplicationContext) :
        ReactContextBaseJavaModule(reactContext) {

  companion object {
    private var sharedContext: ReactApplicationContext? = null

    fun sendLocationUpdate(
            latitude: Double,
            longitude: Double,
            accuracy: Float,
            speed: Float,
            heading: Float?
    ) {
      val params =
              com.facebook.react.bridge.Arguments.createMap().apply {
                putDouble("latitude", latitude)
                putDouble("longitude", longitude)
                putDouble("accuracy", accuracy.toDouble())
                putDouble("speed", speed.toDouble())
                heading?.let { putDouble("heading", it.toDouble()) }
                putDouble("timestamp", System.currentTimeMillis().toDouble())
              }

      sharedContext
              ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              ?.emit("DriverLocationUpdate", params)
    }
  }

  init {
    sharedContext = reactContext
  }

  override fun getName(): String = "LocationServiceModule"

  @ReactMethod
  fun startService(promise: Promise) {
    try {
      val intent = Intent(reactContext, LocationTrackingService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ContextCompat.startForegroundService(reactContext, intent)
      } else {
        reactContext.startService(intent)
      }
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("START_SERVICE_ERROR", error)
    }
  }

  @ReactMethod
  fun stopService(promise: Promise) {
    try {
      val intent = Intent(reactContext, LocationTrackingService::class.java)
      reactContext.stopService(intent)
      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("STOP_SERVICE_ERROR", error)
    }
  }

  @ReactMethod
  fun checkOverlayPermission(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      promise.resolve(true)
      return
    }
    promise.resolve(Settings.canDrawOverlays(reactContext))
  }

  @ReactMethod
  fun requestOverlayPermission(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      promise.resolve(true)
      return
    }

    if (Settings.canDrawOverlays(reactContext)) {
      promise.resolve(true)
      return
    }

    val intent =
            Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${reactContext.packageName}")
            )
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactContext.startActivity(intent)
    promise.resolve(false)
  }

  @ReactMethod
  fun updateLocationInterval(intervalSeconds: Int, promise: Promise) {
    try {
      // Send a broadcast to update running service
      val intent = Intent(reactContext, LocationTrackingService::class.java)
      intent.putExtra("ACTION", "UPDATE_INTERVAL")
      intent.putExtra("INTERVAL_SECONDS", intervalSeconds)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ContextCompat.startForegroundService(reactContext, intent)
      } else {
        reactContext.startService(intent)
      }

      promise.resolve(null)
    } catch (error: Exception) {
      promise.reject("UPDATE_INTERVAL_ERROR", error)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required for RN built-in Event Emitter Calls
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required for RN built-in Event Emitter Calls
  }
}
