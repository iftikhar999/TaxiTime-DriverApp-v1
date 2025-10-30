package com.taxitime.driverv1;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * 🚀 LOCATION FOREGROUND SERVICE
 * 
 * This service keeps the app alive even when:
 * - App is minimized
 * - App is removed from recent apps (swiped away)
 * - Screen is off
 * 
 * It shows a persistent notification that prevents Android from killing the app.
 */
public class LocationForegroundService extends Service {
    private static final String CHANNEL_ID = "driver_location_channel";
    private static final String CHANNEL_NAME = "Driver Location Service";
    private static final int NOTIFICATION_ID = 12345;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Create notification
        Notification notification = createNotification();
        
        // Start foreground service with notification
        startForeground(NOTIFICATION_ID, notification);
        
        return START_STICKY; // Service will restart if killed by system
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopForeground(true);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW // Low importance = no sound
            );
            channel.setDescription("Keeps driver location tracking active during shift");
            channel.setShowBadge(false);
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification createNotification() {
        // Intent to open app when notification is tapped
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        // Build notification
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🚕 On Shift")
            .setContentText("Location tracking active - Tap to open app")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation) // Replace with your app icon
            .setContentIntent(pendingIntent)
            .setOngoing(true) // Cannot be dismissed by user
            .setPriority(NotificationCompat.PRIORITY_LOW) // Low priority = no sound
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setAutoCancel(false);

        return builder.build();
    }

    /**
     * Start the foreground service
     */
    public static void start(android.content.Context context) {
        Intent intent = new Intent(context, LocationForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    /**
     * Stop the foreground service
     */
    public static void stop(android.content.Context context) {
        Intent intent = new Intent(context, LocationForegroundService.class);
        context.stopService(intent);
    }
}

