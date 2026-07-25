package com.taxitime.driverapp;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;

import java.util.List;

public class AppBringToFrontModule extends ReactContextBaseJavaModule {
    private static final String TAG = "AppBringToFront";
    private final ReactApplicationContext reactContext;

    public AppBringToFrontModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return "AppBringToFront";
    }

    @ReactMethod
    public void bringToFront(Promise promise) {
        try {
            Activity currentActivity = getCurrentActivity();
            
            if (currentActivity != null) {
                Log.d(TAG, "App is already in foreground");
                promise.resolve("already_foreground");
                return;
            }

            Context context = getReactApplicationContext();
            
            // Create intent to bring app to front
            Intent intent = new Intent(context, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | 
                          Intent.FLAG_ACTIVITY_SINGLE_TOP | 
                          Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            intent.putExtra("fromJobNotification", true);
            
            context.startActivity(intent);
            
            Log.d(TAG, "✅ App brought to foreground");
            promise.resolve("brought_to_front");
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to bring app to front", e);
            promise.reject("BRING_TO_FRONT_ERROR", e.getMessage(), e);
        }
    }

    @ReactMethod
    public void isAppInForeground(Promise promise) {
        try {
            Activity currentActivity = getCurrentActivity();
            boolean isInForeground = currentActivity != null;

            Log.d(TAG, "Is app in foreground: " + isInForeground);
            promise.resolve(isInForeground);

        } catch (Exception e) {
            Log.e(TAG, "Error checking foreground status", e);
            promise.reject("FOREGROUND_CHECK_ERROR", e.getMessage(), e);
        }
    }

    /**
     * Returns true when the user has granted "Display over other apps"
     * permission. From Android 10 onward this permission is required for
     * `bringToFront` to actually launch the activity from the background
     * — without it `startActivity` from a non-foreground context is
     * silently ignored, which is why job notifications "make a sound"
     * but don't open the app.
     */
    @ReactMethod
    public void hasOverlayPermission(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                // Pre-Marshmallow doesn't enforce this permission.
                promise.resolve(true);
                return;
            }
            Context context = getReactApplicationContext();
            promise.resolve(Settings.canDrawOverlays(context));
        } catch (Exception e) {
            Log.e(TAG, "hasOverlayPermission failed", e);
            promise.resolve(false);
        }
    }

    /**
     * Open the system settings page where the user can grant overlay
     * permission. We can't grant it programmatically — the OS forces a
     * manual user action — so we just deep-link to the right screen.
     */
    @ReactMethod
    public void requestOverlayPermission(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                promise.resolve(true); // nothing to do on pre-M
                return;
            }
            Context context = getReactApplicationContext();
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:" + context.getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "requestOverlayPermission failed", e);
            promise.reject("OVERLAY_PERMISSION_ERROR", e.getMessage(), e);
        }
    }

    /**
     * Returns true when the OS exempts this app from battery
     * optimisation. Without this, Doze mode pauses the socket and the
     * driver gets job notifications minutes late.
     */
    @ReactMethod
    public void isBatteryOptimizationIgnored(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                promise.resolve(true);
                return;
            }
            Context context = getReactApplicationContext();
            android.os.PowerManager pm = (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm == null) { promise.resolve(false); return; }
            promise.resolve(pm.isIgnoringBatteryOptimizations(context.getPackageName()));
        } catch (Exception e) {
            Log.e(TAG, "isBatteryOptimizationIgnored failed", e);
            promise.resolve(false);
        }
    }

    /** Open the system settings to add this app to the battery exemption list. */
    @ReactMethod
    public void requestBatteryOptimizationExemption(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
                promise.resolve(true);
                return;
            }
            Context context = getReactApplicationContext();
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "requestBatteryOptimizationExemption failed", e);
            promise.reject("BATTERY_EXEMPT_ERROR", e.getMessage(), e);
        }
    }
}
