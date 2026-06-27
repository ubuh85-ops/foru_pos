package com.foru.pos;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.channels.FileChannel;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ForuSQLite")
public class ForuSQLitePlugin extends Plugin {
    private ForuDbHelper helper;

    @Override
    public void load() {
        helper = new ForuDbHelper(getContext());
        helper.getWritableDatabase();
    }

    @PluginMethod
    public void init(PluginCall call) {
        try {
            helper.getWritableDatabase();
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Gagal membuka SQLite lokal: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key", "");
        String value = call.getString("value", "");
        if (key.trim().isEmpty()) {
            call.reject("SQLite key wajib diisi.");
            return;
        }
        try {
            SQLiteDatabase db = helper.getWritableDatabase();
            db.execSQL(
                "INSERT INTO kv_store(key, value, updated_at) VALUES(?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) " +
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                new Object[]{key, value}
            );
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Gagal menyimpan SQLite: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key", "");
        if (key.trim().isEmpty()) {
            call.reject("SQLite key wajib diisi.");
            return;
        }
        try {
            SQLiteDatabase db = helper.getReadableDatabase();
            Cursor cursor = db.rawQuery("SELECT value FROM kv_store WHERE key = ?", new String[]{key});
            JSObject result = new JSObject();
            if (cursor.moveToFirst()) {
                result.put("value", cursor.getString(0));
            } else {
                result.put("value", JSObject.NULL);
            }
            cursor.close();
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Gagal membaca SQLite: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key", "");
        if (key.trim().isEmpty()) {
            call.reject("SQLite key wajib diisi.");
            return;
        }
        try {
            helper.getWritableDatabase().execSQL("DELETE FROM kv_store WHERE key = ?", new Object[]{key});
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Gagal menghapus SQLite: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        try {
            helper.getWritableDatabase().execSQL("DELETE FROM kv_store");
            JSObject result = new JSObject();
            result.put("ok", true);
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Gagal clear SQLite: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void keys(PluginCall call) {
        try {
            SQLiteDatabase db = helper.getReadableDatabase();
            Cursor cursor = db.rawQuery("SELECT key FROM kv_store ORDER BY key", null);
            JSArray keys = new JSArray();
            while (cursor.moveToNext()) {
                keys.put(cursor.getString(0));
            }
            cursor.close();
            JSObject result = new JSObject();
            result.put("keys", keys);
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Gagal membaca SQLite keys: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void backup(PluginCall call) {
        try {
            SQLiteDatabase db = helper.getReadableDatabase();
            db.close();
            File source = getContext().getDatabasePath(ForuDbHelper.DB_NAME);
            File dir = new File(getContext().getFilesDir(), "foru_backups");
            if (!dir.exists()) dir.mkdirs();
            File target = new File(dir, "foru_pos_offline_" + System.currentTimeMillis() + ".db");
            try (FileChannel in = new FileInputStream(source).getChannel(); FileChannel out = new FileOutputStream(target).getChannel()) {
                out.transferFrom(in, 0, in.size());
            }
            File[] backups = dir.listFiles();
            if (backups != null && backups.length > 5) {
                java.util.Arrays.sort(backups, (a, b) -> Long.compare(a.lastModified(), b.lastModified()));
                for (int i = 0; i < backups.length - 5; i++) backups[i].delete();
            }
            helper.getWritableDatabase();
            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("path", target.getAbsolutePath());
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Gagal backup SQLite: " + ex.getMessage());
        }
    }

    private static class ForuDbHelper extends SQLiteOpenHelper {
        private static final String DB_NAME = "foru_pos_offline.db";
        private static final int DB_VERSION = 1;

        ForuDbHelper(Context context) {
            super(context, DB_NAME, null, DB_VERSION);
        }

        @Override
        public void onCreate(SQLiteDatabase db) {
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS kv_store (" +
                    "key TEXT PRIMARY KEY NOT NULL, " +
                    "value TEXT NOT NULL, " +
                    "updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))" +
                ")"
            );
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS sync_queue (" +
                    "id TEXT PRIMARY KEY NOT NULL, " +
                    "entity_type TEXT NOT NULL, " +
                    "entity_local_id TEXT NOT NULL, " +
                    "action TEXT NOT NULL, " +
                    "payload_json TEXT NOT NULL, " +
                    "status TEXT NOT NULL, " +
                    "retry_count INTEGER NOT NULL DEFAULT 0, " +
                    "last_error TEXT, " +
                    "created_at TEXT NOT NULL, " +
                    "synced_at TEXT" +
                ")"
            );
            db.execSQL("CREATE INDEX IF NOT EXISTS sync_queue_status_idx ON sync_queue(status)");
            db.execSQL("CREATE TABLE IF NOT EXISTS users (local_id TEXT PRIMARY KEY, server_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'SYNCED', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS user_sessions (local_id TEXT PRIMARY KEY, user_id TEXT, token TEXT, payload_json TEXT NOT NULL, updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS outlets (local_id TEXT PRIMARY KEY, server_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'SYNCED', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS categories (local_id TEXT PRIMARY KEY, server_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'SYNCED', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS products (local_id TEXT PRIMARY KEY, server_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'SYNCED', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS product_outlets (local_id TEXT PRIMARY KEY, server_id TEXT, product_id TEXT, outlet_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'SYNCED', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS variant_groups (local_id TEXT PRIMARY KEY, server_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'SYNCED', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS variant_options (local_id TEXT PRIMARY KEY, server_id TEXT, variant_group_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'SYNCED', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS product_variant_groups (local_id TEXT PRIMARY KEY, server_id TEXT, product_id TEXT, variant_group_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'SYNCED', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS coupons (local_id TEXT PRIMARY KEY, server_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'SYNCED', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS discounts (local_id TEXT PRIMARY KEY, server_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'SYNCED', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS printers (local_id TEXT PRIMARY KEY, server_id TEXT, outlet_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'SYNCED', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS cash_sessions (local_id TEXT PRIMARY KEY, server_id TEXT, idempotency_key TEXT, outlet_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'LOCAL_ONLY', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS orders (local_id TEXT PRIMARY KEY, server_id TEXT, idempotency_key TEXT, outlet_id TEXT, status TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'LOCAL_ONLY', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS order_items (local_id TEXT PRIMARY KEY, order_local_id TEXT, product_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'LOCAL_ONLY', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS expenses (local_id TEXT PRIMARY KEY, server_id TEXT, idempotency_key TEXT, outlet_id TEXT, cash_session_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'LOCAL_ONLY', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS printer_logs (local_id TEXT PRIMARY KEY, server_id TEXT, idempotency_key TEXT, sale_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'LOCAL_ONLY', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS audit_logs (local_id TEXT PRIMARY KEY, server_id TEXT, idempotency_key TEXT, entity_type TEXT, entity_id TEXT, payload_json TEXT NOT NULL, sync_status TEXT DEFAULT 'LOCAL_ONLY', updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS sync_logs (local_id TEXT PRIMARY KEY, start_time TEXT, finish_time TEXT, duration INTEGER, uploaded_count INTEGER DEFAULT 0, downloaded_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0, last_error TEXT, sync_type TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
            db.execSQL("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
        }

        @Override
        public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
            onCreate(db);
        }
    }
}
