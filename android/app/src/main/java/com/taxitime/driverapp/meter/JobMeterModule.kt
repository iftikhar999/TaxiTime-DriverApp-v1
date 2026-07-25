package com.taxitime.driverapp.meter

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class JobMeterModule(reactContext: ReactApplicationContext) :
        ReactContextBaseJavaModule(reactContext) {

    private var meterUpdateReceiver: BroadcastReceiver? = null

    override fun getName(): String = "JobMeterModule"

    @ReactMethod
    fun startJobMeter(
            startTime: Double,
            waitingSeconds: Double,
            distanceMeters: Double,
            latitude: Double,
            longitude: Double,
            promise: Promise
    ) {
        try {
            val context = reactApplicationContext
            val intent = Intent(context, JobMeterService::class.java)
            intent.putExtra("ACTION", "START_JOB")
            intent.putExtra("startTime", startTime.toLong())
            intent.putExtra("waitingSeconds", waitingSeconds)
            intent.putExtra("distanceMeters", distanceMeters)
            intent.putExtra("latitude", latitude)
            intent.putExtra("longitude", longitude)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }

            // Register for meter updates
            registerMeterReceiver()

            promise.resolve(true)
            android.util.Log.d("JobMeterModule", "✅ Job meter started")
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to start job meter: ${e.message}")
            android.util.Log.e("JobMeterModule", "❌ Error starting job meter", e)
        }
    }

    @ReactMethod
    fun updateLocation(
            latitude: Double,
            longitude: Double,
            accuracy: Double,
            speed: Double,
            promise: Promise
    ) {
        try {
            val context = reactApplicationContext
            val intent = Intent(context, JobMeterService::class.java)
            intent.putExtra("ACTION", "UPDATE_LOCATION")
            intent.putExtra("latitude", latitude)
            intent.putExtra("longitude", longitude)
            intent.putExtra("accuracy", accuracy)
            intent.putExtra("speed", speed)

            context.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to update location: ${e.message}")
        }
    }

    @ReactMethod
    fun pauseJobMeter(promise: Promise) {
        try {
            val context = reactApplicationContext
            val intent = Intent(context, JobMeterService::class.java)
            intent.putExtra("ACTION", "PAUSE_JOB")
            context.startService(intent)
            promise.resolve(true)
            android.util.Log.d("JobMeterModule", "⏸️ Job meter paused")
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to pause job meter: ${e.message}")
        }
    }

    @ReactMethod
    fun resumeJobMeter(promise: Promise) {
        try {
            val context = reactApplicationContext
            val intent = Intent(context, JobMeterService::class.java)
            intent.putExtra("ACTION", "RESUME_JOB")
            context.startService(intent)
            promise.resolve(true)
            android.util.Log.d("JobMeterModule", "▶️ Job meter resumed")
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to resume job meter: ${e.message}")
        }
    }

    @ReactMethod
    fun stopJobMeter(promise: Promise) {
        try {
            val context = reactApplicationContext
            val intent = Intent(context, JobMeterService::class.java)
            intent.putExtra("ACTION", "STOP_JOB")
            context.startService(intent)

            // Unregister receiver
            unregisterMeterReceiver()

            promise.resolve(true)
            android.util.Log.d("JobMeterModule", "🛑 Job meter stopped")
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to stop job meter: ${e.message}")
        }
    }

    private fun registerMeterReceiver() {
        if (meterUpdateReceiver != null) return

        meterUpdateReceiver =
                object : BroadcastReceiver() {
                    override fun onReceive(context: Context?, intent: Intent?) {
                        if (intent?.action == "com.taxitime.METER_UPDATE") {
                            val params = Arguments.createMap()
                            params.putDouble(
                                    "elapsedSeconds",
                                    intent.getDoubleExtra("elapsedSeconds", 0.0)
                            )
                            params.putDouble(
                                    "waitingSeconds",
                                    intent.getDoubleExtra("waitingSeconds", 0.0)
                            )
                            params.putDouble(
                                    "distanceMeters",
                                    intent.getDoubleExtra("distanceMeters", 0.0)
                            )
                            params.putBoolean("isMoving", intent.getBooleanExtra("isMoving", false))
                            params.putDouble(
                                    "timestamp",
                                    intent.getLongExtra("timestamp", 0).toDouble()
                            )

                            sendEvent("onMeterUpdate", params)
                        }
                    }
                }

        val filter = IntentFilter("com.taxitime.METER_UPDATE")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            reactApplicationContext.registerReceiver(
                    meterUpdateReceiver,
                    filter,
                    Context.RECEIVER_NOT_EXPORTED
            )
        } else {
            reactApplicationContext.registerReceiver(meterUpdateReceiver, filter)
        }

        android.util.Log.d("JobMeterModule", "✅ Meter receiver registered")
    }

    private fun unregisterMeterReceiver() {
        try {
            meterUpdateReceiver?.let {
                reactApplicationContext.unregisterReceiver(it)
                meterUpdateReceiver = null
                android.util.Log.d("JobMeterModule", "✅ Meter receiver unregistered")
            }
        } catch (e: Exception) {
            android.util.Log.e("JobMeterModule", "Error unregistering receiver", e)
        }
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN built-in Event Emitter Calls
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for RN built-in Event Emitter Calls
    }

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        unregisterMeterReceiver()
    }
}
