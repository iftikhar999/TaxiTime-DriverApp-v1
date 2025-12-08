package com.taxitime.driverv1;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import android.util.Log;
import com.taxitime.driverv1.R; // ✅ CRITICAL: Import R for resources

/**
 * 🔥 IMMORTAL FOREGROUND SERVICE
 * 
 * This service NEVER dies. It keeps the app alive 24/7 when shift is active.
 * 
 * Features:
 * - Runs continuously with persistent notification
 * - Auto-restarts if killed (START_STICKY)
 * - Prevents Android from killing the app
 * - Tracks location in background
 * - Sends heartbeat to server
 * - Wakes up for job assignments
 */
public class ForegroundService extends Service {
    private static final String TAG = "ForegroundService";
    private static final String CHANNEL_ID = "driver_shift_channel";
    private static final int NOTIFICATION_ID = 1001;
    private static boolean shouldRestartService = true;
    
    private PowerManager.WakeLock wakeLock;
    private HeartbeatSender heartbeatSender;

    public static void setShouldRestartService(boolean value) {
        shouldRestartService = value;
    }

    public static boolean getShouldRestartService() {
        return shouldRestartService;
    }
    
    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "🚀 Foreground Service Created");
        
        // Create notification channel (required for Android 8+)
        createNotificationChannel();
        
        // Acquire wake lock to prevent device sleep
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ABTaxi::ShiftWakeLock");
        wakeLock.acquire();
        
        // Initialize heartbeat sender
        heartbeatSender = new HeartbeatSender(this);
        
        Log.d(TAG, "✅ Wake lock acquired - device won't sleep");
        Log.d(TAG, "✅ Heartbeat sender initialized");
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "🔥 Foreground Service Started");
        shouldRestartService = true;
        
        // Get shift details from intent
        String driverName = intent != null ? intent.getStringExtra("driverName") : "Driver";
        String status = intent != null ? intent.getStringExtra("status") : "Available";
        String duration = intent != null ? intent.getStringExtra("duration") : "0h 0m";
        String earnings = intent != null ? intent.getStringExtra("earnings") : "$0.00";
        int trips = intent != null ? intent.getIntExtra("trips", 0) : 0;
        
        // Create persistent notification
        Notification notification = buildNotification(driverName, status, duration, earnings, trips);
        
        // Start service in foreground with notification
        startForeground(NOTIFICATION_ID, notification);
        
        Log.d(TAG, "✅ Service running in foreground with notification");
        Log.d(TAG, "📊 Status: " + status + " | Duration: " + duration + " | Earnings: " + earnings);
        
        // 🔥 CRITICAL: Start LocationTrackingService to continue location updates even when app is killed
        try {
            Intent locationIntent = new Intent(this, com.taxitime.driverv1.location.LocationTrackingService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(locationIntent);
            } else {
                startService(locationIntent);
            }
            Log.d(TAG, "✅ LocationTrackingService started - location will continue in background");
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to start LocationTrackingService: " + e.getMessage());
        }
        
        // 💓 CRITICAL: Start native heartbeat sender
        if (heartbeatSender != null) {
            heartbeatSender.start();
            Log.d(TAG, "💓 Native heartbeat sender started");
        }
        
        // START_STICKY ensures service is restarted if killed by Android
        return START_STICKY;
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "🛑 Foreground Service Destroyed");
        
        // 💓 Stop native heartbeat sender
        if (heartbeatSender != null) {
            heartbeatSender.stop();
            Log.d(TAG, "💓 Native heartbeat sender stopped");
        }
        
        // Release wake lock
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            Log.d(TAG, "✅ Wake lock released");
        }
        
        // 🔥 CRITICAL: Stop LocationTrackingService when shift ends
        try {
            Intent locationIntent = new Intent(this, com.taxitime.driverv1.location.LocationTrackingService.class);
            stopService(locationIntent);
            Log.d(TAG, "✅ LocationTrackingService stopped");
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to stop LocationTrackingService: " + e.getMessage());
        }
        
        // Clear driver data
        HeartbeatSender.clearDriverData(this);
        
        if (shouldRestartService) {
            Intent restartIntent = new Intent("com.taxitime.driverv1.RESTART_SERVICE");
            sendBroadcast(restartIntent);
            Log.d(TAG, "📡 Restart broadcast sent");
        } else {
            Log.d(TAG, "🛑 Restart suppressed (manual stop)");
            shouldRestartService = true;
        }
    }
    
    @Override
    public IBinder onBind(Intent intent) {
        return null; // We don't bind to this service
    }
    
    /**
     * Create notification channel for Android 8+
     */
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Driver Shift Service",
                NotificationManager.IMPORTANCE_MIN
            );
            channel.setDescription("Keeps the app running while you're on shift");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            channel.enableVibration(false);
            channel.enableLights(false);
            channel.setSound(null, null);
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
                Log.d(TAG, "✅ Notification channel created");
            }
        }
    }
    
    /**
     * Build the persistent notification
     */
    private Notification buildNotification(String driverName, String status, String duration, String earnings, int trips) {
        // Intent to open app when notification is tapped
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 
            0, 
            notificationIntent, 
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        // Intent to end shift
        Intent endShiftIntent = new Intent(this, ForegroundService.class);
        endShiftIntent.setAction("END_SHIFT");
        
        PendingIntent endShiftPendingIntent = PendingIntent.getService(
            this, 
            1, 
            endShiftIntent, 
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        
        // Build notification
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🚕 AB Taxi - On Shift")
            .setContentText(status + " | " + duration + " | " + trips + " trips")
            .setSmallIcon(R.mipmap.ic_launcher) // Use app icon
            .setStyle(new NotificationCompat.BigTextStyle()
                .bigText(
                    "Status: " + status + "\n" +
                    "Duration: " + duration + "\n" +
                    "Trips: " + trips + "\n" +
                    "Earnings: " + earnings
                ))
            .setContentIntent(pendingIntent)
            .setOngoing(true) // Cannot be dismissed by swiping
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .addAction(R.mipmap.ic_launcher, "End Shift", endShiftPendingIntent);
        
        return builder.build();
    }
    
    /**
     * Update notification with new stats (called from React Native)
     */
    public void updateNotification(String driverName, String status, String duration, String earnings, int trips) {
        Notification notification = buildNotification(driverName, status, duration, earnings, trips);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, notification);
            Log.d(TAG, "✅ Notification updated: " + status + " | " + duration + " | " + earnings);
        }
    }
}
