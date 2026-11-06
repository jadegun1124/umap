package kr.co.umap.tracker;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "DeviceSeal")
public class DeviceSealPlugin extends Plugin {
    private static final String SESSION_FILE = "umap-family-session.json";
    @PluginMethod
    public void seal(PluginCall call) {
        String sealed = DeviceCipher.seal(call.getString("plain", ""));
        if (sealed.isEmpty()) {
            call.reject("seal");
            return;
        }
        JSObject result = new JSObject();
        result.put("sealed", sealed);
        call.resolve(result);
    }

    @PluginMethod
    public void open(PluginCall call) {
        String plain = DeviceCipher.open(call.getString("sealed", ""));
        if (plain.isEmpty()) {
            call.reject("open");
            return;
        }
        JSObject result = new JSObject();
        result.put("plain", plain);
        call.resolve(result);
    }

    /** Plain session in the app files dir. An update keeps this file. A failed write leaves the previous file. */
    @PluginMethod
    public void readSession(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("raw", readSessionFile());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("read");
        }
    }

    @PluginMethod
    public void writeSession(PluginCall call) {
        if (!writeSessionFile(call.getString("raw", ""))) {
            call.reject("write");
            return;
        }
        call.resolve();
    }

    private File sessionFile() {
        return new File(getContext().getFilesDir(), SESSION_FILE);
    }

    private String readSessionFile() throws Exception {
        File file = sessionFile();
        if (!file.isFile()) return "";
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] bytes = new byte[(int) file.length()];
            int read = 0;
            while (read < bytes.length) {
                int count = in.read(bytes, read, bytes.length - read);
                if (count < 0) break;
                read += count;
            }
            return new String(bytes, 0, read, StandardCharsets.UTF_8);
        }
    }

    private boolean writeSessionFile(String raw) {
        if (raw == null || getContext() == null) return false;
        File dir = getContext().getFilesDir();
        File target = new File(dir, SESSION_FILE);
        File temp = new File(dir, SESSION_FILE + ".tmp");
        File backup = new File(dir, SESSION_FILE + ".bak");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(raw.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (Exception error) {
            temp.delete();
            return false;
        }
        if (target.exists() && !target.renameTo(backup)) {
            temp.delete();
            return false;
        }
        if (!temp.renameTo(target)) {
            if (backup.exists()) backup.renameTo(target);
            temp.delete();
            return false;
        }
        if (backup.exists()) backup.delete();
        return true;
    }
}
