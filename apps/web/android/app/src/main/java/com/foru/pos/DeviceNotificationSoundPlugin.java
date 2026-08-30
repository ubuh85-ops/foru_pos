package com.foru.pos;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DeviceNotificationSound")
public class DeviceNotificationSoundPlugin extends Plugin {
    private android.media.Ringtone previewRingtone;

    @PluginMethod
    public void listSounds(PluginCall call) {
        JSArray sounds = new JSArray();
        RingtoneManager manager = new RingtoneManager(getContext());
        manager.setType(RingtoneManager.TYPE_NOTIFICATION | RingtoneManager.TYPE_ALARM);
        int count = manager.getCursor().getCount();
        for (int index = 0; index < count; index++) {
            Uri uri = manager.getRingtoneUri(index);
            if (uri == null) continue;
            JSObject sound = new JSObject();
            sound.put("id", "device-" + Integer.toUnsignedString(uri.toString().hashCode(), 36));
            sound.put("name", manager.getRingtone(index).getTitle(getContext()));
            sound.put("uri", uri.toString());
            sounds.put(sound);
        }
        JSObject result = new JSObject();
        result.put("sounds", sounds);
        call.resolve(result);
    }

    @PluginMethod
    public void createChannel(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        String channelId = call.getString("channelId");
        if (channelId == null || channelId.trim().isEmpty()) {
            call.reject("channelId wajib diisi");
            return;
        }
        String channelName = call.getString("channelName", "Customer Web Orders");
        String soundUri = call.getString("soundUri");
        NotificationChannel channel = new NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Notifikasi order baru dari Customer Web Order");
        if (soundUri == null || soundUri.isEmpty()) {
            channel.setSound(null, null);
        } else {
            channel.setSound(Uri.parse(soundUri), new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        }
        NotificationManager notifications = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (notifications != null) notifications.createNotificationChannel(channel);
        call.resolve();
    }

    @PluginMethod
    public void previewSound(PluginCall call) {
        String soundUri = call.getString("soundUri");
        if (soundUri == null || soundUri.trim().isEmpty()) {
            call.reject("soundUri wajib diisi");
            return;
        }
        if (previewRingtone != null) previewRingtone.stop();
        previewRingtone = RingtoneManager.getRingtone(getContext(), Uri.parse(soundUri));
        if (previewRingtone == null) {
            call.reject("Suara perangkat tidak ditemukan");
            return;
        }
        previewRingtone.play();
        call.resolve();
    }

    @PluginMethod
    public void stopPreview(PluginCall call) {
        if (previewRingtone != null) previewRingtone.stop();
        call.resolve();
    }
}
