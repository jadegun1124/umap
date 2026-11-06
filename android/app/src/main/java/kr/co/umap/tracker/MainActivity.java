package kr.co.umap.tracker;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static volatile boolean resumed;
    private static long lastRendererRecoverAt;
    private final Handler rendererHandler = new Handler(Looper.getMainLooper());
    private boolean rendererRecoverQueued;

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
            // The window is already hardware accelerated. An extra LAYER_TYPE_HARDWARE
            // on the WebView fights its own compositor, so it is not set.
            // Respect tile Cache-Control. The service worker also keeps base tiles.
            webView.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            webView.setVerticalScrollBarEnabled(false);
            webView.setHorizontalScrollBarEnabled(false);
            webView.addJavascriptInterface(new UmapAndroidExit(this), "UmapAndroid");
        }
        watchRenderer();
        captureChatIntent(getIntent());
        captureInviteIntent(getIntent());
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
        captureInviteIntent(intent);
    }

    private void captureInviteIntent(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        String raw = intent.getDataString();
        if (raw == null || raw.isEmpty()) return;
        boolean invite = raw.contains("/invite") || "invite".equals(intent.getData().getHost());
        if (!invite) return;
        WebView view = bridge != null ? bridge.getWebView() : null;
        if (view == null) return;
        String quoted = org.json.JSONObject.quote(raw);
        view.post(() -> view.evaluateJavascript(
            "window.__umapInviteUrl=" + quoted + ";try{window.dispatchEvent(new Event('umap-invite'))}catch(e){}",
            null
        ));
    }

    @Override
    public void onResume() {
        super.onResume();
        resumed = true;
        keepScreenOn(true);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (!hasFocus) return;
        keepScreenOn(true);
        UmapAuthPlugin.onMainWindowFocused();
    }

    @Override
    public void onPause() {
        keepScreenOn(false);
        resumed = false;
        super.onPause();
    }

    /**
     * A dead renderer used to take the whole process down because nothing
     * returned true from onRenderProcessGone. Recreate the activity so the
     * WebView is new. A second death inside 8 seconds waits out that gap
     * and then recreates once, instead of leaving the dead view on screen.
     */
    private void watchRenderer() {
        if (bridge == null) return;
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                scheduleRendererRecover();
                return true;
            }
        });
    }

    private void scheduleRendererRecover() {
        if (rendererRecoverQueued || isFinishing() || isDestroyed()) return;
        long now = SystemClock.uptimeMillis();
        long wait = Math.max(0L, 8_000L - (now - lastRendererRecoverAt));
        rendererRecoverQueued = true;
        rendererHandler.postDelayed(() -> {
            rendererRecoverQueued = false;
            if (isFinishing() || isDestroyed()) return;
            lastRendererRecoverAt = SystemClock.uptimeMillis();
            try {
                recreate();
            } catch (RuntimeException ignored) {
                /* true from onRenderProcessGone already kept the process alive */
            }
        }, wait);
    }

    /** The open activity stays lit. Leaving the app lets the screen sleep again. */
    private void keepScreenOn(boolean on) {
        if (getWindow() == null) return;
        if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
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
        public void openUrl(String url) {
            if (url == null || !url.startsWith("https://github.com/jadegun1124/umap/releases/")) return;
            activity.runOnUiThread(() -> {
                Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    activity.startActivity(view);
                } catch (Exception ignored) {
                    /* 브라우저가 없으면 설정에 남는다 */
                }
            });
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
