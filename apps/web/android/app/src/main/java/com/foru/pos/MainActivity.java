package com.foru.pos;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BluetoothPrinterPlugin.class);
        registerPlugin(ForuSQLitePlugin.class);
        registerPlugin(DeviceNotificationSoundPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
