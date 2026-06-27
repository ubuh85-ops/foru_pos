package com.foru.pos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = {
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "bluetoothConnect"),
        @Permission(strings = { Manifest.permission.BLUETOOTH_SCAN }, alias = "bluetoothScan"),
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION }, alias = "fineLocation")
    }
)
public class BluetoothPrinterPlugin extends Plugin {
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        if (!hasBluetoothPermission()) {
            requestAllPermissions(call, "permissionCallback");
            return;
        }
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                call.reject("Bluetooth tidak tersedia di device ini.");
                return;
            }
            if (!adapter.isEnabled()) {
                call.reject("Bluetooth belum aktif. Aktifkan Bluetooth Android lalu coba lagi.");
                return;
            }
            Set<BluetoothDevice> bondedDevices = adapter.getBondedDevices();
            JSArray devices = new JSArray();
            for (BluetoothDevice device : bondedDevices) {
                JSObject item = new JSObject();
                item.put("name", safeName(device));
                item.put("address", device.getAddress());
                item.put("bondState", device.getBondState());
                devices.put(item);
            }
            JSObject result = new JSObject();
            result.put("devices", devices);
            call.resolve(result);
        } catch (SecurityException ex) {
            call.reject("Izin Bluetooth ditolak: " + ex.getMessage());
        } catch (Exception ex) {
            call.reject("Gagal membaca paired Bluetooth devices: " + ex.getMessage());
        }
    }

    @PluginMethod
    public void testConnect(PluginCall call) {
        String address = call.getString("address", "");
        if (address.trim().isEmpty()) {
            call.reject("MAC address printer wajib diisi.");
            return;
        }
        runWithSocket(call, address, null);
    }

    @PluginMethod
    public void testPrint(PluginCall call) {
        String address = call.getString("address", "");
        String printerName = call.getString("printerName", "Bluetooth Printer");
        if (address.trim().isEmpty()) {
            call.reject("MAC address printer wajib diisi.");
            return;
        }
        byte[] payload = buildTestReceipt(printerName, address);
        runWithSocket(call, address, payload);
    }

    @PluginMethod
    public void printText(PluginCall call) {
        String address = call.getString("address", "");
        String text = call.getString("text", "");
        if (address.trim().isEmpty()) {
            call.reject("MAC address printer wajib diisi.");
            return;
        }
        if (text.trim().isEmpty()) {
            call.reject("Isi print kosong.");
            return;
        }
        byte[] payload = buildTextPayload(text);
        runWithSocket(call, address, payload);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (!hasBluetoothPermission()) {
            call.reject("Izin Bluetooth belum diberikan.");
            return;
        }
        String method = call.getMethodName();
        if ("listPairedDevices".equals(method)) {
            listPairedDevices(call);
        } else if ("testConnect".equals(method)) {
            testConnect(call);
        } else if ("testPrint".equals(method)) {
            testPrint(call);
        } else if ("printText".equals(method)) {
            printText(call);
        } else {
            call.reject("Method Bluetooth tidak dikenali.");
        }
    }

    private boolean hasBluetoothPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return getPermissionState("bluetoothConnect") == PermissionState.GRANTED
                && getPermissionState("bluetoothScan") == PermissionState.GRANTED;
        }
        return getPermissionState("fineLocation") == PermissionState.GRANTED;
    }

    private void runWithSocket(PluginCall call, String address, byte[] payload) {
        if (!hasBluetoothPermission()) {
            requestAllPermissions(call, "permissionCallback");
            return;
        }
        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null) throw new Exception("Bluetooth tidak tersedia di device ini.");
                if (!adapter.isEnabled()) throw new Exception("Bluetooth belum aktif.");
                BluetoothDevice device = adapter.getRemoteDevice(address);
                adapter.cancelDiscovery();
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();
                if (payload != null) {
                    OutputStream out = socket.getOutputStream();
                    out.write(payload);
                    out.flush();
                }
                JSObject result = new JSObject();
                result.put("success", true);
                result.put("name", safeName(device));
                result.put("address", address);
                getActivity().runOnUiThread(() -> call.resolve(result));
            } catch (Exception ex) {
                getActivity().runOnUiThread(() -> call.reject("Gagal koneksi Bluetooth printer: " + ex.getMessage()));
            } finally {
                if (socket != null) {
                    try { socket.close(); } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    private String safeName(BluetoothDevice device) {
        try {
            String name = device.getName();
            return name == null || name.trim().isEmpty() ? "Unknown Bluetooth Device" : name;
        } catch (SecurityException ex) {
            return "Bluetooth Device";
        }
    }

    private byte[] buildTestReceipt(String printerName, String address) {
        String text =
            "\n" +
            "FORU POS\n" +
            "BLUETOOTH TEST PRINT\n" +
            "------------------------------\n" +
            "Printer : " + printerName + "\n" +
            "Address : " + address + "\n" +
            "Status  : CONNECTED\n" +
            "------------------------------\n" +
            "Jika struk ini keluar,\n" +
            "printer Bluetooth siap dipakai.\n\n\n";
        byte[] init = new byte[] { 0x1B, 0x40 };
        byte[] cut = new byte[] { 0x1D, 0x56, 0x42, 0x00 };
        byte[] body = text.getBytes(Charset.forName("GBK"));
        byte[] result = new byte[init.length + body.length + cut.length];
        System.arraycopy(init, 0, result, 0, init.length);
        System.arraycopy(body, 0, result, init.length, body.length);
        System.arraycopy(cut, 0, result, init.length + body.length, cut.length);
        return result;
    }

    private byte[] buildTextPayload(String text) {
        String normalized = text.endsWith("\n") ? text : text + "\n";
        byte[] init = new byte[] { 0x1B, 0x40 };
        byte[] cut = new byte[] { 0x1D, 0x56, 0x42, 0x00 };
        byte[] body = (normalized + "\n\n").getBytes(Charset.forName("GBK"));
        byte[] result = new byte[init.length + body.length + cut.length];
        System.arraycopy(init, 0, result, 0, init.length);
        System.arraycopy(body, 0, result, init.length, body.length);
        System.arraycopy(cut, 0, result, init.length + body.length, cut.length);
        return result;
    }
}
