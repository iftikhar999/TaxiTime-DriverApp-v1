package com.taxitime.driverapp;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 💓 Native Heartbeat Sender
 * 
 * Sends heartbeat signals to the server when app is killed but ForegroundService is running.
 * This ensures dispatch knows the driver is still online even when React Native is dead.
 */
public class HeartbeatSender {
    private static final String TAG = "HeartbeatSender";
    private static final long HEARTBEAT_INTERVAL_MS = 5000; // 5 seconds
    private static final String SERVER_URL = "http://10.0.2.2:5001"; // Change to your server URL
    
    private final Context context;
    private final Handler handler;
    private final ExecutorService executor;
    private final Runnable heartbeatRunnable;
    private boolean isRunning = false;
    
    public HeartbeatSender(Context context) {
        this.context = context;
        this.handler = new Handler(Looper.getMainLooper());
        this.executor = Executors.newSingleThreadExecutor();
        
        this.heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                if (isRunning) {
                    sendHeartbeat();
                    // Schedule next heartbeat
                    handler.postDelayed(this, HEARTBEAT_INTERVAL_MS);
                }
            }
        };
    }
    
    /**
     * Start sending heartbeats
     */
    public void start() {
        if (isRunning) {
            Log.w(TAG, "⚠️ Heartbeat already running");
            return;
        }
        
        Log.d(TAG, "💓 Starting native heartbeat sender");
        isRunning = true;
        
        // Send first heartbeat immediately
        sendHeartbeat();
        
        // Schedule recurring heartbeats
        handler.postDelayed(heartbeatRunnable, HEARTBEAT_INTERVAL_MS);
    }
    
    /**
     * Stop sending heartbeats
     */
    public void stop() {
        Log.d(TAG, "🛑 Stopping native heartbeat sender");
        isRunning = false;
        handler.removeCallbacks(heartbeatRunnable);
    }
    
    /**
     * Send a single heartbeat to the server
     */
    private void sendHeartbeat() {
        executor.execute(() -> {
            try {
                // Get driver data from SharedPreferences (saved by React Native)
                SharedPreferences prefs = context.getSharedPreferences("DRIVER_DATA", Context.MODE_PRIVATE);
                String driverId = prefs.getString("driverId", null);
                String shiftId = prefs.getString("shiftId", null);
                String authToken = prefs.getString("authToken", null);
                
                if (driverId == null || shiftId == null) {
                    Log.w(TAG, "⚠️ No driver/shift data available for heartbeat");
                    return;
                }
                
                // Build heartbeat payload
                JSONObject payload = new JSONObject();
                payload.put("driverId", driverId);
                payload.put("shiftId", shiftId);
                payload.put("timestamp", System.currentTimeMillis());
                payload.put("source", "native_service"); // Identify this as native heartbeat
                
                // Send HTTP POST request to server
                URL url = new URL(SERVER_URL + "/api/mobile/driver/heartbeat");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Accept", "application/json");
                
                if (authToken != null) {
                    conn.setRequestProperty("Authorization", "Bearer " + authToken);
                }
                
                conn.setDoOutput(true);
                conn.setConnectTimeout(5000); // 5 second timeout
                conn.setReadTimeout(5000);
                
                // Write payload
                OutputStream os = conn.getOutputStream();
                os.write(payload.toString().getBytes("UTF-8"));
                os.close();
                
                // Get response
                int responseCode = conn.getResponseCode();
                
                if (responseCode >= 200 && responseCode < 300) {
                    Log.d(TAG, "💓 Heartbeat sent successfully (native)");
                } else {
                    Log.w(TAG, "⚠️ Heartbeat failed with code: " + responseCode);
                }
                
                conn.disconnect();
                
            } catch (Exception e) {
                Log.e(TAG, "❌ Heartbeat error: " + e.getMessage());
                // Don't crash, just log and continue
            }
        });
    }
    
    /**
     * Save driver data for heartbeat
     * Called by React Native when shift starts
     */
    public static void saveDriverData(Context context, String driverId, String shiftId, String authToken) {
        SharedPreferences prefs = context.getSharedPreferences("DRIVER_DATA", Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        editor.putString("driverId", driverId);
        editor.putString("shiftId", shiftId);
        editor.putString("authToken", authToken);
        editor.apply();
        
        Log.d(TAG, "💾 Driver data saved for native heartbeat");
    }
    
    /**
     * Clear driver data when shift ends
     */
    public static void clearDriverData(Context context) {
        SharedPreferences prefs = context.getSharedPreferences("DRIVER_DATA", Context.MODE_PRIVATE);
        prefs.edit().clear().apply();
        
        Log.d(TAG, "🧹 Driver data cleared");
    }
}

