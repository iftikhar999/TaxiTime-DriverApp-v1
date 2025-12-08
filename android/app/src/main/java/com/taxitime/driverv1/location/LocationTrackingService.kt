package com.taxitime.driverv1.location

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import com.taxitime.driverv1.MainActivity
import com.taxitime.driverv1.R

class LocationTrackingService : Service() {
  private lateinit var fusedClient: FusedLocationProviderClient
  private lateinit var locationCallback: LocationCallback
  private lateinit var notificationManager: NotificationManager
  private lateinit var notificationBuilder: NotificationCompat.Builder

  // ✅ BALANCED GPS UPDATES - 2 second interval (good balance between accuracy and battery)
  private var updateIntervalMs: Long = 2000L // 2 seconds - balanced mode
  private var minIntervalMs: Long = 2000L // 2 seconds - consistent updates
  private var maxDelayMs: Long = 2000L // 2 seconds - no batching
  private var minDistanceMeters: Float = 0f // Time-based only

  // Track last location time for interval verification
  private var lastLocationTime: Long = 0

  override fun onCreate() {
    super.onCreate()
    fusedClient = LocationServices.getFusedLocationProviderClient(this)
    createNotificationChannel()
    notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    notificationBuilder = baseNotificationBuilder()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      notificationBuilder.setForegroundServiceBehavior(
              NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE
      )
    }
    locationCallback =
            object : LocationCallback() {
              override fun onLocationResult(result: LocationResult) {
                super.onLocationResult(result)
                val location: Location = result.lastLocation ?: return

                // ✅ Track actual GPS interval
                val now = System.currentTimeMillis()
                val actualInterval = if (lastLocationTime > 0) now - lastLocationTime else 0
                lastLocationTime = now

                if (actualInterval > 0) {
                  android.util.Log.d(
                          "LocationTracking",
                          """
                    |📍 GPS LOCATION RECEIVED:
                    |   Actual interval: ${actualInterval}ms (${actualInterval / 1000}s)
                    |   Expected: ${updateIntervalMs}ms (${updateIntervalMs / 1000}s)
                    |   ${if (actualInterval > updateIntervalMs * 2) "⚠️ INTERVAL TOO LONG!" else "✅"}
                  """.trimMargin()
                  )
                }

                LocationServiceModule.sendLocationUpdate(
                        location.latitude,
                        location.longitude,
                        location.accuracy,
                        location.speed,
                        if (location.hasBearing()) location.bearing else null
                )
                updateNotification(location)
              }
            }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Check if this is an interval update request
    if (intent?.getStringExtra("ACTION") == "UPDATE_INTERVAL") {
      val intervalSeconds = intent.getIntExtra("INTERVAL_SECONDS", 2)
      android.util.Log.d("LocationTracking", "📍 GPS INTERVAL UPDATE REQUEST: ${intervalSeconds}s")
      updateLocationSettings(intervalSeconds)
      android.util.Log.d(
              "LocationTracking",
              "✅ GPS INTERVAL APPLIED: ${intervalSeconds}s (${intervalSeconds * 1000}ms)"
      )
      return START_NOT_STICKY // Don't restart for config updates
    }

    val notification =
            notificationBuilder.setContentText("Tracking active").build().apply {
              this.flags = flags or Notification.FLAG_ONGOING_EVENT or Notification.FLAG_NO_CLEAR
            }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    startLocationUpdates()
    return START_STICKY
  }

  override fun onDestroy() {
    super.onDestroy()
    fusedClient.removeLocationUpdates(locationCallback)
  }

  override fun onBind(intent: Intent?): IBinder? = null

  // Method to update location interval settings
  fun updateLocationSettings(intervalSeconds: Int) {
    // ✅ FIX: Use exact interval from company settings (1-60 seconds range)
    // Convert seconds to milliseconds - respect company configuration exactly
    updateIntervalMs = (intervalSeconds * 1000L).coerceIn(1000L, 60000L) // 1-60 seconds

    // Set min interval to SAME as update interval to prevent faster updates
    minIntervalMs = updateIntervalMs // ✅ EXACT interval - no faster updates allowed

    // Max delay should be same as interval to prevent batching
    maxDelayMs = updateIntervalMs // ✅ No batching - immediate delivery

    // Distance threshold: update regardless of distance
    minDistanceMeters = 0f // ✅ Always update based on time, not distance

    android.util.Log.d(
            "LocationTracking",
            """
      |🛰️  GPS CONFIG UPDATED TO EXACT COMPANY SETTING:
      |   Update Interval: ${updateIntervalMs}ms (${intervalSeconds}s) - EXACT
      |   Min Interval: ${minIntervalMs}ms (same as update - no faster updates)
      |   Max Delay: ${maxDelayMs}ms (same as update - no batching)
      |   Min Distance: ${minDistanceMeters}m (time-based only)
      |   Priority: BALANCED_POWER_ACCURACY (battery-efficient, no icon blinking)
    """.trimMargin()
    )

    // Restart location updates with new settings if service is running
    restartLocationUpdates()
  }

  private fun restartLocationUpdates() {
    android.util.Log.d("LocationTracking", "🔄 RESTARTING location updates with new interval...")
    try {
      // Stop existing location updates
      fusedClient.removeLocationUpdates(locationCallback)
      android.util.Log.d("LocationTracking", "✅ Removed old location updates")

      // Start with new settings
      startLocationUpdates()
      android.util.Log.d(
              "LocationTracking",
              "✅ Started new location updates with ${updateIntervalMs}ms interval"
      )
    } catch (e: SecurityException) {
      android.util.Log.e("LocationTracking", "❌ Security exception during restart: ${e.message}")
      e.printStackTrace()
    } catch (e: Exception) {
      android.util.Log.e("LocationTracking", "❌ Exception during restart: ${e.message}")
      e.printStackTrace()
    }
  }

  private fun startLocationUpdates() {
    android.util.Log.d(
            "LocationTracking",
            """
      |🚀 STARTING GPS location updates - BALANCED MODE:
      |   Interval: ${updateIntervalMs}ms (${updateIntervalMs / 1000}s) ✅ 2 SECONDS
      |   Min Interval: ${minIntervalMs}ms (2 seconds)
      |   Max Delay: ${maxDelayMs}ms (no batching)
      |   Min Distance: ${minDistanceMeters}m (time-based updates)
      |   Priority: HIGH_ACCURACY (good GPS precision with battery efficiency)
    """.trimMargin()
    )

    // ✅ FORCE HIGH_ACCURACY for debugging - get GPS updates FAST
    val builder =
            LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, updateIntervalMs)
                    .setMinUpdateIntervalMillis(updateIntervalMs) // ✅ 1 second
                    .setWaitForAccurateLocation(false) // ✅ Don't wait - get updates immediately
                    .setMaxUpdateDelayMillis(updateIntervalMs) // ✅ No batching
                    .setMinUpdateDistanceMeters(0f) // ✅ Update based on time only, not distance
                    .setMaxUpdateAgeMillis(updateIntervalMs) // Don't use old cached locations

    val request = builder.build()

    try {
      fusedClient.requestLocationUpdates(request, locationCallback, mainLooper)
      android.util.Log.d(
              "LocationTracking",
              "✅ GPS location updates started with ${updateIntervalMs / 1000}s interval (HIGH_ACCURACY mode)"
      )
    } catch (securityException: SecurityException) {
      android.util.Log.e("LocationTracking", "❌ Security exception: ${securityException.message}")
      securityException.printStackTrace()
    } catch (e: Exception) {
      android.util.Log.e("LocationTracking", "❌ Exception: ${e.message}")
      e.printStackTrace()
    }
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel =
              NotificationChannel(CHANNEL_ID, "Driver Tracking", NotificationManager.IMPORTANCE_LOW)
      channel.description = "Live location tracking"
      val manager = getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(channel)
    }
  }

  private fun baseNotificationBuilder(): NotificationCompat.Builder {
    return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("TaxiTime Driver")
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setAutoCancel(false)
            .setContentIntent(defaultPendingIntent())
  }

  private fun defaultPendingIntent(): PendingIntent {
    val notificationIntent = Intent(this, MainActivity::class.java)
    notificationIntent.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
    return PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  private fun updateNotification(location: Location) {
    val message =
            String.format(
                    "Lat: %.5f, Lng: %.5f (%.1fm)",
                    location.latitude,
                    location.longitude,
                    location.accuracy
            )
    val notification =
            notificationBuilder
                    .setContentText(message)
                    .setSubText("Live shift tracking")
                    .build()
                    .apply {
                      flags = flags or Notification.FLAG_ONGOING_EVENT or Notification.FLAG_NO_CLEAR
                    }
    notificationManager.notify(NOTIFICATION_ID, notification)
  }

  companion object {
    private const val CHANNEL_ID = "driver_tracking_channel"
    private const val NOTIFICATION_ID = 101
  }
}
