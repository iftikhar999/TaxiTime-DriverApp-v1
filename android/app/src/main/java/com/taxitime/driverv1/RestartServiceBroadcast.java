package com.taxitime.driverv1;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * 🔥 AUTO-RESTART RECEIVER
 * 
 * This receiver ensures the foreground service is ALWAYS running.
 * If the service is killed, this restarts it immediately.
 * 
 * Triggered by:
 * - Service onDestroy()
 * - System killing the service
 * - Low memory situations
 */
public class RestartServiceBroadcast extends BroadcastReceiver {
    private static final String TAG = "RestartServiceBroadcast";
    
    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "⚡ Restart broadcast received - restarting services NOW");
        
        // Restart ForegroundService (which will also start LocationTrackingService)
        Intent serviceIntent = new Intent(context, ForegroundService.class);
        
        // Start service based on Android version
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
            Log.d(TAG, "✅ Foreground service restarted (Android 8+)");
        } else {
            context.startService(serviceIntent);
            Log.d(TAG, "✅ Service restarted (Android 7 and below)");
        }
        
        // Note: ForegroundService.onStartCommand() will automatically start LocationTrackingService
        Log.d(TAG, "📍 LocationTrackingService will be started by ForegroundService");
    }
}

