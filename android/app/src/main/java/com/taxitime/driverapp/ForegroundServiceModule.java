package com.taxitime.driverapp;

import android.content.Intent;
import android.os.Build;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

/**
 * React Native Module for Foreground Service Control
 */
public class ForegroundServiceModule extends ReactContextBaseJavaModule {
    private static final String TAG = "ForegroundServiceModule";

    public ForegroundServiceModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "ForegroundServiceModule";
    }

    /**
     * Start the foreground service
     */
    @ReactMethod
    public void startService(String driverName, String status, String duration, String earnings, int trips, Promise promise) {
        try {
            ReactApplicationContext context = getReactApplicationContext();
            Intent serviceIntent = new Intent(context, ForegroundService.class);
            ForegroundService.setShouldRestartService(true);
            
            // Pass shift data to service
            serviceIntent.putExtra("driverName", driverName);
            serviceIntent.putExtra("status", status);
            serviceIntent.putExtra("duration", duration);
            serviceIntent.putExtra("earnings", earnings);
            serviceIntent.putExtra("trips", trips);
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
            
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("START_SERVICE_ERROR", e.getMessage());
        }
    }

    /**
     * Stop the foreground service
     */
    @ReactMethod
    public void stopService(Promise promise) {
        try {
            ReactApplicationContext context = getReactApplicationContext();
            Intent serviceIntent = new Intent(context, ForegroundService.class);
            ForegroundService.setShouldRestartService(false);
            context.stopService(serviceIntent);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("STOP_SERVICE_ERROR", e.getMessage());
        }
    }

    /**
     * Update the notification
     */
    @ReactMethod
    public void updateNotification(String driverName, String status, String duration, String earnings, int trips, Promise promise) {
        try {
            ReactApplicationContext context = getReactApplicationContext();
            Intent serviceIntent = new Intent(context, ForegroundService.class);
            
            // Pass updated shift data
            serviceIntent.putExtra("driverName", driverName);
            serviceIntent.putExtra("status", status);
            serviceIntent.putExtra("duration", duration);
            serviceIntent.putExtra("earnings", earnings);
            serviceIntent.putExtra("trips", trips);
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
            
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("UPDATE_NOTIFICATION_ERROR", e.getMessage());
        }
    }

    /**
     * 💓 Save driver data for native heartbeat
     */
    @ReactMethod
    public void saveDriverData(String driverId, String shiftId, String authToken, Promise promise) {
        try {
            ReactApplicationContext context = getReactApplicationContext();
            HeartbeatSender.saveDriverData(context, driverId, shiftId, authToken);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("SAVE_DRIVER_DATA_ERROR", e.getMessage());
        }
    }

    /**
     * 🧹 Clear driver data when shift ends
     */
    @ReactMethod
    public void clearDriverData(Promise promise) {
        try {
            ReactApplicationContext context = getReactApplicationContext();
            HeartbeatSender.clearDriverData(context);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("CLEAR_DRIVER_DATA_ERROR", e.getMessage());
        }
    }

    /**
     * 🚀 Bring the app to the foreground (Android only)
     */
    @ReactMethod
    public void bringToForeground(Promise promise) {
        try {
            ReactApplicationContext context = getReactApplicationContext();
            Intent intent = new Intent(context, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(intent);
            promise.resolve(null);
        } catch (Exception e) {
            promise.reject("BRING_TO_FOREGROUND_ERROR", e.getMessage());
        }
    }
}
