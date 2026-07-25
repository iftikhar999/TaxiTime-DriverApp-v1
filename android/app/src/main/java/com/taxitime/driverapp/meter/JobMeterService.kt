package com.taxitime.driverapp.meter

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.taxitime.driverapp.MainActivity
import com.taxitime.driverapp.R
import kotlin.math.*

/**
 * Background service that keeps the job meter running even when app is minimized or closed. Tracks:
 * - Elapsed time
 * - Waiting time
 * - Distance traveled
 * - Movement state
 */
class JobMeterService : Service() {
    private lateinit var notificationManager: NotificationManager
    private lateinit var notificationBuilder: NotificationCompat.Builder
    private val handler = Handler(Looper.getMainLooper())
    private var updateRunnable: Runnable? = null

    // Job state
    private var jobStartTime: Long = 0
    private var lastUpdateTime: Long = 0
    private var totalWaitingSeconds: Double = 0.0
    private var totalDistanceMeters: Double = 0.0
    private var isMoving: Boolean = false

    // Last location
    private var lastLatitude: Double? = null
    private var lastLongitude: Double? = null
    private var lastLocationTime: Long = 0

    // Configuration
    private val UPDATE_INTERVAL_MS = 1000L // Update every second
    private val MIN_MOVEMENT_DISTANCE_METERS = 5.0
    private val GPS_NOISE_FILTER_METERS = 15.0

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationBuilder = baseNotificationBuilder()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            notificationBuilder.setForegroundServiceBehavior(
                    NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE
            )
        }

        android.util.Log.d("JobMeterService", "✅ Service created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.getStringExtra("ACTION")) {
            "START_JOB" -> {
                startJob(intent)
            }
            "UPDATE_LOCATION" -> {
                updateLocation(intent)
            }
            "PAUSE_JOB" -> {
                pauseJob()
            }
            "RESUME_JOB" -> {
                resumeJob()
            }
            "STOP_JOB" -> {
                stopJob()
                return START_NOT_STICKY
            }
        }

        val notification =
                notificationBuilder.setContentText("Job in progress").build().apply {
                    this.flags =
                            flags or Notification.FLAG_ONGOING_EVENT or Notification.FLAG_NO_CLEAR
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

        startPeriodicUpdates()
        return START_STICKY // Restart if killed by system
    }

    private fun startJob(intent: Intent) {
        jobStartTime = intent.getLongExtra("startTime", System.currentTimeMillis())
        lastUpdateTime = System.currentTimeMillis()
        totalWaitingSeconds = intent.getDoubleExtra("waitingSeconds", 0.0)
        totalDistanceMeters = intent.getDoubleExtra("distanceMeters", 0.0)

        val latitude = intent.getDoubleExtra("latitude", 0.0)
        val longitude = intent.getDoubleExtra("longitude", 0.0)

        if (latitude != 0.0 && longitude != 0.0) {
            lastLatitude = latitude
            lastLongitude = longitude
            lastLocationTime = System.currentTimeMillis()
        }

        android.util.Log.d(
                "JobMeterService",
                """
      🚀 Job started:
         Start time: ${jobStartTime}
         Initial waiting: ${totalWaitingSeconds}s
         Initial distance: ${totalDistanceMeters}m
         Location: $latitude, $longitude
    """.trimIndent()
        )
    }

    private fun updateLocation(intent: Intent) {
        val latitude = intent.getDoubleExtra("latitude", 0.0)
        val longitude = intent.getDoubleExtra("longitude", 0.0)
        val accuracy = intent.getDoubleExtra("accuracy", 0.0)
        val speed = intent.getDoubleExtra("speed", 0.0)

        if (latitude == 0.0 || longitude == 0.0) return

        val now = System.currentTimeMillis()
        val timeDiffMs = now - lastLocationTime

        // Calculate distance if we have a previous location
        if (lastLatitude != null && lastLongitude != null && timeDiffMs > 0) {
            val distance =
                    calculateHaversineDistance(lastLatitude!!, lastLongitude!!, latitude, longitude)

            // GPS glitch detection
            val maxReasonableDistance = (timeDiffMs / 1000.0) * 55.56 // 200 km/h = 55.56 m/s
            if (distance > maxReasonableDistance) {
                android.util.Log.w(
                        "JobMeterService",
                        "⚠️ GPS glitch detected: ${distance}m in ${timeDiffMs}ms"
                )
                return
            }

            // Filter noise
            if (distance >= GPS_NOISE_FILTER_METERS) {
                // Check if movement is significant
                if (distance >= MIN_MOVEMENT_DISTANCE_METERS) {
                    isMoving = true
                    totalDistanceMeters += distance
                    android.util.Log.d(
                            "JobMeterService",
                            "🚗 Moving: +${distance.toInt()}m (total: ${totalDistanceMeters.toInt()}m)"
                    )
                } else {
                    isMoving = false
                }
            } else {
                isMoving = false
            }
        }

        lastLatitude = latitude
        lastLongitude = longitude
        lastLocationTime = now

        // Broadcast state to React Native
        broadcastMeterState()
    }

    private fun pauseJob() {
        android.util.Log.d("JobMeterService", "⏸️ Job paused")
        stopPeriodicUpdates()
    }

    private fun resumeJob() {
        android.util.Log.d("JobMeterService", "▶️ Job resumed")
        lastUpdateTime = System.currentTimeMillis()
        startPeriodicUpdates()
    }

    private fun stopJob() {
        android.util.Log.d("JobMeterService", "🛑 Job stopped")
        stopPeriodicUpdates()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun startPeriodicUpdates() {
        stopPeriodicUpdates() // Clear any existing updates

        updateRunnable =
                object : Runnable {
                    override fun run() {
                        updateMeterState()
                        handler.postDelayed(this, UPDATE_INTERVAL_MS)
                    }
                }
        handler.post(updateRunnable!!)
    }

    private fun stopPeriodicUpdates() {
        updateRunnable?.let { handler.removeCallbacks(it) }
        updateRunnable = null
    }

    private fun updateMeterState() {
        val now = System.currentTimeMillis()
        val elapsedSinceLastUpdate = (now - lastUpdateTime) / 1000.0

        if (elapsedSinceLastUpdate > 0) {
            // If not moving, accumulate waiting time
            if (!isMoving) {
                totalWaitingSeconds += elapsedSinceLastUpdate
            }
            lastUpdateTime = now
        }

        // Update notification
        val elapsedTime = ((now - jobStartTime) / 1000.0).toInt()
        updateNotification(elapsedTime, totalDistanceMeters.toInt(), totalWaitingSeconds.toInt())

        // Broadcast state
        broadcastMeterState()
    }

    private fun broadcastMeterState() {
        val now = System.currentTimeMillis()
        val elapsedSeconds = ((now - jobStartTime) / 1000.0)

        val intent = Intent("com.taxitime.METER_UPDATE")
        intent.putExtra("elapsedSeconds", elapsedSeconds)
        intent.putExtra("waitingSeconds", totalWaitingSeconds)
        intent.putExtra("distanceMeters", totalDistanceMeters)
        intent.putExtra("isMoving", isMoving)
        intent.putExtra("timestamp", now)

        sendBroadcast(intent)
    }

    private fun calculateHaversineDistance(
            lat1: Double,
            lon1: Double,
            lat2: Double,
            lon2: Double
    ): Double {
        val R = 6371e3 // Earth radius in meters
        val phi1 = lat1 * PI / 180.0
        val phi2 = lat2 * PI / 180.0
        val deltaPhi = (lat2 - lat1) * PI / 180.0
        val deltaLambda = (lon2 - lon1) * PI / 180.0

        val a =
                sin(deltaPhi / 2.0).pow(2.0) +
                        cos(phi1) * cos(phi2) * sin(deltaLambda / 2.0).pow(2.0)
        val c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a))

        return R * c
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel =
                    NotificationChannel(CHANNEL_ID, "Job Meter", NotificationManager.IMPORTANCE_LOW)
            channel.description = "Active job meter tracking"
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun baseNotificationBuilder(): NotificationCompat.Builder {
        return NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Active Ride")
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

    private fun updateNotification(elapsedSeconds: Int, distanceMeters: Int, waitingSeconds: Int) {
        val hours = elapsedSeconds / 3600
        val minutes = (elapsedSeconds % 3600) / 60
        val seconds = elapsedSeconds % 60

        val timeStr =
                if (hours > 0) {
                    String.format("%02d:%02d:%02d", hours, minutes, seconds)
                } else {
                    String.format("%02d:%02d", minutes, seconds)
                }

        val distanceKm = distanceMeters / 1000.0
        val waitingMins = waitingSeconds / 60

        val message =
                String.format(
                        "Time: %s | Distance: %.2f km | Waiting: %d min",
                        timeStr,
                        distanceKm,
                        waitingMins
                )

        val notification =
                notificationBuilder
                        .setContentText(message)
                        .setSubText(if (isMoving) "Moving" else "Stopped")
                        .build()
                        .apply {
                            flags =
                                    flags or
                                            Notification.FLAG_ONGOING_EVENT or
                                            Notification.FLAG_NO_CLEAR
                        }

        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    override fun onDestroy() {
        super.onDestroy()
        stopPeriodicUpdates()
        android.util.Log.d("JobMeterService", "❌ Service destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val CHANNEL_ID = "job_meter_channel"
        private const val NOTIFICATION_ID = 102
    }
}
