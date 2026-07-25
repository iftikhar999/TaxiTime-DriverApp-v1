package com.taxitime.driverapp

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "DriverAppV1"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    
    // Check if launched from job notification
    handleJobNotificationIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    
    // Handle new intent when app is already running
    intent.let {
      handleJobNotificationIntent(it)
      
      // Wake screen if job notification
      if (it.getStringExtra("action") == "JOB_NOTIFICATION_LOCKED") {
        wakeUpAndUnlock()
      }
    }
  }

  /**
   * Handle intent from job notification
   */
  private fun handleJobNotificationIntent(intent: Intent) {
    val jobId = intent.getStringExtra("jobId")
    val action = intent.getStringExtra("action")
    
    if (jobId != null && action != null) {
      android.util.Log.d("MainActivity", "Job notification intent: jobId=$jobId, action=$action")
      
      // Pass to React Native
      val reactContext = reactInstanceManager?.currentReactContext
      reactContext?.let {
        val params = com.facebook.react.bridge.Arguments.createMap()
        params.putString("jobId", jobId)
        params.putString("action", action)
        
        it.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("jobNotificationOpened", params)
      }
    }
  }

  /**
   * Wake up screen and show over lock screen
   * This allows the app to display job notification even when device is locked
   */
  private fun wakeUpAndUnlock() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
      )
    }
  }
}
