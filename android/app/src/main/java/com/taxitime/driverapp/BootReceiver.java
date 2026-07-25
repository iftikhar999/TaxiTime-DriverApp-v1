package com.taxitime.driverapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * 🚀 BOOT RECEIVER
 * 
 * Automatically starts the app when the device boots.
 * 
 * If the driver had an active shift before shutdown/reboot,
 * this will restart the foreground service and restore the shift.
 * 
 * Features:
 * - Checks for active shift in SharedPreferences
 * - Starts foreground service if shift was active
 * - Launches app to restore state
 */
public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";
    private static final String PREFS_NAME = "RNAsyncStorageDataSource";
    
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.d(TAG, "📱 Device boot completed - checking for active shift");
            
            // Check if driver had active shift before shutdown
            boolean hadActiveShift = checkForActiveShift(context);
            
            if (hadActiveShift) {
                Log.d(TAG, "✅ Active shift found - restarting service and app");
                
                // Start foreground service
                Intent serviceIntent = new Intent(context, ForegroundService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent);
                } else {
                    context.startService(serviceIntent);
                }
                
                // Launch app to restore state
                Intent launchIntent = new Intent(context, MainActivity.class);
                launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                launchIntent.putExtra("restoreFromBoot", true);
                context.startActivity(launchIntent);
                
                Log.d(TAG, "🚀 Service and app restarted successfully");
            } else {
                Log.d(TAG, "ℹ️ No active shift found - service not started");
            }
        }
    }
    
    /**
     * Check if driver had active shift before shutdown
     * Reads from React Native's AsyncStorage
     */
    private boolean checkForActiveShift(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            
            // Check for active shift key in AsyncStorage
            // React Native AsyncStorage stores values with keys prefixed
            String activeShiftJson = prefs.getString("activeShift", null);
            
            if (activeShiftJson != null && !activeShiftJson.isEmpty() && !activeShiftJson.equals("null")) {
                Log.d(TAG, "✅ Active shift data found in storage");
                return true;
            }
            
            Log.d(TAG, "ℹ️ No active shift data in storage");
            return false;
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error checking for active shift: " + e.getMessage());
            return false;
        }
    }
}

