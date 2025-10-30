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
  
  // Configurable location update intervals (in milliseconds)
  private var updateIntervalMs: Long = 2000L  // Default 2 seconds
  private var minIntervalMs: Long = 1000L     // Minimum interval
  private var maxDelayMs: Long = 5000L        // Maximum delay
  private var minDistanceMeters: Float = 1.0f  // Minimum distance

  override fun onCreate() {
    super.onCreate()
    fusedClient = LocationServices.getFusedLocationProviderClient(this)
    createNotificationChannel()
    notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    notificationBuilder = baseNotificationBuilder()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      notificationBuilder.setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    }
    locationCallback = object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        super.onLocationResult(result)
        val location: Location = result.lastLocation ?: return
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
      android.util.Log.d("LocationTracking", "✅ GPS INTERVAL APPLIED: ${intervalSeconds}s (${intervalSeconds * 1000}ms)")
      return START_NOT_STICKY // Don't restart for config updates
    }
    
    val notification = notificationBuilder
      .setContentText("Tracking active")
      .build()
      .apply { 
        this.flags = flags or Notification.FLAG_ONGOING_EVENT or Notification.FLAG_NO_CLEAR 
      }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
      )
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
    // Convert seconds to milliseconds and set bounds
    updateIntervalMs = (intervalSeconds * 1000L).coerceIn(1000L, 10000L) // 1-10 seconds
    minIntervalMs = (updateIntervalMs / 2).coerceAtLeast(500L) // Half of main interval, min 500ms
    maxDelayMs = (updateIntervalMs * 2.5).toLong().coerceAtMost(15000L) // 2.5x main interval, max 15s
    minDistanceMeters = when {
      intervalSeconds <= 2 -> 0.5f  // High frequency = sensitive distance
      intervalSeconds <= 3 -> 1.0f  // Medium frequency = medium distance
      else -> 2.0f                  // Low frequency = larger distance threshold
    }
    
    android.util.Log.d("LocationTracking", """
      |🛰️  GPS CONFIG UPDATED:
      |   Update Interval: ${updateIntervalMs}ms (${updateIntervalMs / 1000}s)
      |   Min Interval: ${minIntervalMs}ms
      |   Max Delay: ${maxDelayMs}ms
      |   Min Distance: ${minDistanceMeters}m
      |   Priority: HIGH_ACCURACY
    """.trimMargin())
    
    // Restart location updates with new settings if service is running
    restartLocationUpdates()
  }
  
  private fun restartLocationUpdates() {
    try {
      fusedClient.removeLocationUpdates(locationCallback)
      startLocationUpdates()
    } catch (e: Exception) {
      e.printStackTrace()
    }
  }

  private fun startLocationUpdates() {
    val builder = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, updateIntervalMs)
      .setMinUpdateIntervalMillis(minIntervalMs)
      .setWaitForAccurateLocation(false)
      .setMaxUpdateDelayMillis(maxDelayMs)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setMinUpdateDistanceMeters(minDistanceMeters)
    }

    val request = builder.build()

    try {
      fusedClient.requestLocationUpdates(request, locationCallback, mainLooper)
    } catch (securityException: SecurityException) {
      securityException.printStackTrace()
    }
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Driver Tracking",
        NotificationManager.IMPORTANCE_LOW
      )
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
    val message = String.format(
      "Lat: %.5f, Lng: %.5f (%.1fm)",
      location.latitude,
      location.longitude,
      location.accuracy
    )
    val notification = notificationBuilder
      .setContentText(message)
      .setSubText("Live shift tracking")
      .build()
      .apply { flags = flags or Notification.FLAG_ONGOING_EVENT or Notification.FLAG_NO_CLEAR }
    notificationManager.notify(NOTIFICATION_ID, notification)
  }

  companion object {
    private const val CHANNEL_ID = "driver_tracking_channel"
    private const val NOTIFICATION_ID = 101
  }
}
