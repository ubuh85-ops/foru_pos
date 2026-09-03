package com.foru.pos;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

/** Creates notification channels before FCM can deliver a background notification. */
public class ForuApplication extends Application {
    private static final String PREFS = "foru_notification_preferences";
    private static final String DEFAULT_CHANNEL = "customer-web-orders-v2";
    private static final String SILENT_CHANNEL = "customer-web-orders-silent-v2";

    @Override
    public void onCreate() {
        super.onCreate();
        ensureNotificationChannels();
    }

    private void ensureNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        boolean enabled = preferences.getBoolean("soundEnabled", true);
        String soundName = preferences.getString("soundName", "default");
        String soundUri = preferences.getString("soundUri", "");
        String channelId = enabled && soundName.startsWith("device-") && !soundUri.isEmpty()
                ? soundName : DEFAULT_CHANNEL;
        Uri uri = enabled && channelId.startsWith("device-")
                ? Uri.parse(soundUri) : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        createChannel(manager, channelId, enabled ? "Customer Web Orders" : "Customer Web Orders (Silent)", enabled ? uri : null);
        createChannel(manager, SILENT_CHANNEL, "Customer Web Orders (Silent)", null);
    }

    private void createChannel(NotificationManager manager, String id, String name, Uri soundUri) {
        NotificationChannel channel = new NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Notifikasi order baru dari Customer Web Order");
        if (soundUri == null) {
            channel.setSound(null, null);
        } else {
            channel.setSound(soundUri, new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
        }
        manager.createNotificationChannel(channel);
    }
}
