package kr.co.umap.tracker;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static volatile boolean resumed;

    public static boolean isResumed() {
        return resumed;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(UmapLocationPlugin.class);
        registerPlugin(UmapAuthPlugin.class);
        registerPlugin(DeviceSealPlugin.class);
        super.onCreate(savedInstanceState);
        LocationKeepService.restartIfWanted(this);
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView != null) {
            webView.addJavascriptInterface(new UmapAndroidExit(this), "UmapAndroid");
        }
        captureChatIntent(getIntent());
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView view = bridge != null ? bridge.getWebView() : null;
                if (view == null) return;
                view.evaluateJavascript(
                    "(function(){try{if(window.__umapAndroidBack){window.__umapAndroidBack();return true}return false}catch(e){return false}})()",
                    null
                );
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureChatIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        resumed = true;
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) UmapAuthPlugin.onMainWindowFocused();
    }

    @Override
    public void onPause() {
        resumed = false;
        super.onPause();
    }

    private void captureChatIntent(Intent intent) {
        if (intent == null) return;
        String code = intent.getStringExtra("umap_chat_code");
        String peer = intent.getStringExtra("umap_chat_peer");
        if (code == null || peer == null || code.isEmpty() || peer.isEmpty()) return;
        UmapLocationPlugin.openChat(code, peer);
        intent.removeExtra("umap_chat_code");
        intent.removeExtra("umap_chat_peer");
    }

    static final class UmapAndroidExit {
        private final MainActivity activity;

        UmapAndroidExit(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void exitApp() {
            activity.runOnUiThread(activity::finish);
        }

        @JavascriptInterface
        public String appVersion() {
            try {
                PackageManager manager = activity.getPackageManager();
                PackageInfo info = manager.getPackageInfo(activity.getPackageName(), 0);
                String name = info.versionName == null ? "" : info.versionName.trim();
                if (name.isEmpty()) return "";
                long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                    ? info.getLongVersionCode()
                    : legacyVersionCode(info);
                return name + " " + code;
            } catch (Exception ignored) {
                return "";
            }
        }

        @SuppressWarnings("deprecation")
        private static int legacyVersionCode(PackageInfo info) {
            return info.versionCode;
        }
    }
}
