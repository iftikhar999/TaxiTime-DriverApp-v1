package com.taxitime.driverapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import androidx.core.app.NotificationCompat;

import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Promise;

/**
 * Native module for showing full-screen notifications for job assignments
 * even when device is locked (like incoming call notifications)
 */
public class JobNotificationModule extends ReactContextBaseJavaModule {
    private static final String TAG = "JobNotification";
    // Channel ID is bumped because Android Notification Channels cache
    // their sound + importance forever — once a channel exists, a change
    // to the sound URI is silently ignored. Bumping the ID forces a
    // fresh channel creation so the new job_incoming.mp3 / loop config
    // takes effect on existing installs.
    private static final String CHANNEL_ID = "job_offers_v4";
    private static final String CHANNEL_NAME = "Job Offers";
    private static final int NOTIFICATION_ID = 12345;
    // Hard ceiling on how long we keep the ringer looping if the JS
    // layer never calls cancelJobNotification. The dispatcher's offer
    // timeout is normally 10–60s; 90s is a safe upper bound that
    // guarantees the phone won't ring forever if a callback was lost.
    private static final long RINGER_MAX_RUNTIME_MS = 90_000L;

    private final ReactApplicationContext reactContext;
    private static MediaPlayer ringer = null;
    private static Handler ringerSafetyHandler = null;
    private static Runnable ringerSafetyRunnable = null;

    public JobNotificationModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
        createNotificationChannel();
    }

    @Override
    public String getName() {
        return "JobNotification";
    }

    /**
     * Create notification channel for Android O and above
     */
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Notifications for new job assignments");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 600, 300, 600, 300, 600, 300, 600});
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            // Use the system *ringtone* (long, loud) routed through the
            // ALARM stream, not the short "ping" of TYPE_NOTIFICATION
            // routed through media. ALARM stream ignores the ringer-mute
            // toggle and ignores Do-Not-Disturb (when the channel is
            // marked "alarm" category), so the driver actually hears it.
            AudioAttributes audioAttrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            // Custom in-app job-incoming chime (res/raw/job_incoming.mp3).
            // Routed through the alarm stream above so it plays loud and
            // bypasses ringer-mute. Falling back to the system ringtone
            // is intentional if the resource is missing.
            Uri jobSoundUri = Uri.parse(
                "android.resource://" + reactContext.getPackageName() + "/" + R.raw.job_incoming
            );
            channel.setSound(jobSoundUri, audioAttrs);
            // Categorise the channel as ALARM so DND lets it through.
            channel.setBypassDnd(true);

            NotificationManager notificationManager =
                reactContext.getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    /**
     * Show a full-screen notification for job assignment
     * This will appear even when device is locked
     * 
     * @param jobId Job ID
     * @param pickupAddress Pickup location
     * @param dropoffAddress Dropoff location
     * @param fare Estimated fare
     * @param promise Promise to resolve
     */
    @ReactMethod
    public void showJobNotification(String jobId, String pickupAddress, 
                                    String dropoffAddress, String fare, 
                                    Promise promise) {
        try {
            Context context = getReactApplicationContext();
            
            // Tap-to-open intent. MainActivity is `singleTask` in the
            // manifest, so SINGLE_TOP is enough to reuse the existing
            // instance; CLEAR_TOP was actively breaking the launch
            // because singleTask + CLEAR_TOP triggers a destroy-and-
            // recreate of the activity that races React Native's
            // bridge — the result was "tap notification, nothing
            // happens".
            Intent intent = new Intent(context, MainActivity.class);
            intent.setFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            );
            intent.putExtra("jobId", jobId);
            intent.putExtra("action", "JOB_NOTIFICATION");

            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            // Full-screen intent for locked-screen / screen-off case.
            // Same singleTask-friendly flag set as the tap intent.
            Intent fullScreenIntent = new Intent(context, MainActivity.class);
            fullScreenIntent.setFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_SINGLE_TOP
            );
            fullScreenIntent.putExtra("jobId", jobId);
            fullScreenIntent.putExtra("action", "JOB_NOTIFICATION_LOCKED");
            
            PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                context,
                1,
                fullScreenIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            // Build notification
            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("🚕 New Job Assignment!")
                .setContentText("Tap to view job details")
                .setStyle(new NotificationCompat.BigTextStyle()
                    .bigText("New ride request received\n💰 Fare: " + fare))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                // CATEGORY_CALL gets heads-up + DND bypass + insistent
                // sound on most OEMs (treated like an incoming call).
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(pendingIntent)
                .setFullScreenIntent(fullScreenPendingIntent, true) // Show even when locked
                .setAutoCancel(true)
                .setOngoing(false)
                // Custom job-incoming chime (res/raw/job_incoming.mp3).
                // Pre-Android 8 honours this builder-level setSound;
                // Android 8+ uses whatever the channel was created with,
                // which we set to the same URI above.
                .setSound(Uri.parse(
                    "android.resource://" + context.getPackageName() + "/" + R.raw.job_incoming
                ))
                .setVibrate(new long[]{0, 600, 300, 600, 300, 600, 300, 600})
                .setLights(0xFF00FF00, 500, 500);

            // Add action buttons
            builder.addAction(
                android.R.drawable.ic_menu_call,
                "Accept",
                createActionIntent(context, "ACCEPT_JOB", jobId)
            );
            
            builder.addAction(
                android.R.drawable.ic_delete,
                "Reject",
                createActionIntent(context, "REJECT_JOB", jobId)
            );

            // Show notification
            NotificationManager notificationManager = 
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            
            if (notificationManager != null) {
                notificationManager.notify(NOTIFICATION_ID, builder.build());
            } else {
                promise.reject("ERROR", "NotificationManager is null");
                return;
            }

            // 🔁 Start the looping ringer so the chime keeps playing
            // until the driver accepts/rejects (or the safety timeout
            // hits). The notification's one-shot sound is the first
            // beat; this is the "incoming call" loop on top.
            startLoopingRinger();

            // 📱 Auto-bring the app to the foreground — but ONLY when
            // the app isn't already in front. Calling startActivity
            // while the user is already inside the app forces Android
            // to re-deliver onCreate / onNewIntent on the existing
            // ReactActivity, which can race React Native's bridge and
            // crash the JS context. The JS-layer JobContext already
            // navigates to JobOffer via setIncomingJob, so foreground
            // case needs no native nudge.
            if (getReactApplicationContext().getCurrentActivity() == null) {
                try {
                    Intent autoLaunch = new Intent(context, MainActivity.class);
                    // Drop REORDER_TO_FRONT — singleTask launchMode
                    // already brings the existing task forward and
                    // REORDER_TO_FRONT can no-op silently when paired
                    // with NEW_TASK on Android 12+.
                    autoLaunch.setFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK |
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                    );
                    autoLaunch.putExtra("jobId", jobId);
                    autoLaunch.putExtra("action", "JOB_NOTIFICATION");
                    context.startActivity(autoLaunch);
                    Log.d(TAG, "Auto-launch fired for job " + jobId);
                } catch (Exception bringErr) {
                    Log.w(TAG, "auto-launch from showJobNotification failed (overlay permission?)", bringErr);
                }
            } else {
                Log.d(TAG, "App already in foreground — skipping native auto-launch");
            }

            promise.resolve("Notification shown successfully");

        } catch (Exception e) {
            promise.reject("ERROR", "Failed to show notification: " + e.getMessage());
        }
    }

    /**
     * Start a looping ringer that plays {@code res/raw/job_incoming.mp3}
     * on the alarm stream until {@link #stopLoopingRinger()} is called
     * or the {@link #RINGER_MAX_RUNTIME_MS} safety timeout hits. A
     * stale ringer from a previous offer is replaced.
     */
    private void startLoopingRinger() {
        stopLoopingRinger();
        try {
            Uri uri = Uri.parse(
                "android.resource://" + reactContext.getPackageName() + "/" + R.raw.job_incoming
            );
            MediaPlayer mp = new MediaPlayer();
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            mp.setAudioAttributes(attrs);
            mp.setDataSource(reactContext, uri);
            mp.setLooping(true);
            mp.setVolume(1.0f, 1.0f);
            mp.prepare();
            mp.start();
            ringer = mp;

            if (ringerSafetyHandler == null) {
                ringerSafetyHandler = new Handler(Looper.getMainLooper());
            }
            if (ringerSafetyRunnable != null) {
                ringerSafetyHandler.removeCallbacks(ringerSafetyRunnable);
            }
            ringerSafetyRunnable = new Runnable() {
                @Override public void run() { stopLoopingRinger(); }
            };
            ringerSafetyHandler.postDelayed(ringerSafetyRunnable, RINGER_MAX_RUNTIME_MS);
        } catch (Exception e) {
            Log.w(TAG, "Ringer start failed", e);
        }
    }

    /** Stop and release the looping ringer. Safe to call when no ringer is active. */
    private void stopLoopingRinger() {
        try {
            if (ringer != null) {
                try { if (ringer.isPlaying()) ringer.stop(); } catch (Exception ignore) {}
                try { ringer.release(); } catch (Exception ignore) {}
                ringer = null;
            }
            if (ringerSafetyHandler != null && ringerSafetyRunnable != null) {
                ringerSafetyHandler.removeCallbacks(ringerSafetyRunnable);
                ringerSafetyRunnable = null;
            }
        } catch (Exception e) {
            Log.w(TAG, "Ringer stop failed", e);
        }
    }

    /**
     * Create pending intent for notification actions
     */
    private PendingIntent createActionIntent(Context context, String action, String jobId) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction(action);
        intent.putExtra("jobId", jobId);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        
        return PendingIntent.getActivity(
            context,
            action.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    /**
     * Cancel the job notification
     * 
     * @param promise Promise to resolve
     */
    @ReactMethod
    public void cancelJobNotification(Promise promise) {
        try {
            // Always silence the looping ringer first so the driver
            // doesn't keep hearing the chime after they've accepted /
            // rejected / the dispatcher recalled the offer.
            stopLoopingRinger();

            Context context = getReactApplicationContext();
            NotificationManager notificationManager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);

            if (notificationManager != null) {
                notificationManager.cancel(NOTIFICATION_ID);
                promise.resolve("Notification cancelled");
            } else {
                promise.reject("ERROR", "NotificationManager is null");
            }
        } catch (Exception e) {
            promise.reject("ERROR", "Failed to cancel notification: " + e.getMessage());
        }
    }

    /**
     * Public stop method for the JS layer to silence the ringer without
     * dismissing the notification (e.g. when a foreground screen has
     * already shown the offer and we just want the chime to stop).
     */
    @ReactMethod
    public void stopRinger(Promise promise) {
        try {
            stopLoopingRinger();
            if (promise != null) promise.resolve(true);
        } catch (Exception e) {
            if (promise != null) promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Check if notifications are enabled
     * 
     * @param promise Promise to resolve with boolean
     */
    @ReactMethod
    public void areNotificationsEnabled(Promise promise) {
        try {
            Context context = getReactApplicationContext();
            NotificationManager notificationManager = 
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            
            if (notificationManager != null) {
                boolean enabled = notificationManager.areNotificationsEnabled();
                promise.resolve(enabled);
            } else {
                promise.resolve(false);
            }
        } catch (Exception e) {
            promise.resolve(false);
        }
    }
}
