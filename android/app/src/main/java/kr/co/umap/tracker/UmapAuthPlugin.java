package kr.co.umap.tracker;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import androidx.browser.customtabs.CustomTabsIntent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.kakao.sdk.auth.model.OAuthToken;
import com.kakao.sdk.common.model.ClientError;
import com.kakao.sdk.common.model.ClientErrorCause;
import com.kakao.sdk.share.ShareClient;
import com.kakao.sdk.template.model.Link;
import com.kakao.sdk.template.model.TextTemplate;
import com.kakao.sdk.user.UserApiClient;
import kotlin.Unit;

@CapacitorPlugin(name = "UmapAuth")
public class UmapAuthPlugin extends Plugin {
    private static final String KAKAO_TALK_PACKAGE = "com.kakao.talk";
    private static volatile UmapAuthPlugin instance;
    private PluginCall pendingNaver;
    private String pendingNaverState = "";
    private boolean naverLeftForTab;

    @Override
    public void load() {
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (pendingNaver != null) resolveNaverCanceled();
        if (instance == this) instance = null;
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (pendingNaver != null) naverLeftForTab = true;
    }

    public static void onMainWindowFocused() {
        UmapAuthPlugin plugin = instance;
        if (plugin == null || !plugin.naverLeftForTab || plugin.pendingNaver == null) return;
        plugin.resolveNaverCanceled();
    }

    @PluginMethod
    public void signInKakao(PluginCall call) {
        String appKey = call.getString("nativeAppKey", "");
        if (appKey == null || appKey.isEmpty()) {
            call.resolve(failure("missing-client"));
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve(failure("failed"));
            return;
        }
        if (UserApiClient.getInstance().isKakaoTalkLoginAvailable(activity)) {
            UserApiClient.getInstance().loginWithKakaoTalk(activity, (token, error) -> {
                if (shouldFallbackToKakaoAccount(error)) {
                    loginWithKakaoAccount(activity, call);
                    return Unit.INSTANCE;
                }
                resolveKakao(call, token, error);
                return Unit.INSTANCE;
            });
            return;
        }
        loginWithKakaoAccount(activity, call);
    }

    @PluginMethod
    public void inviteShareStatus(PluginCall call) {
        Activity activity = getActivity();
        JSObject payload = new JSObject();
        boolean installed = activity != null && kakaoTalkInstalled(activity);
        String key = BuildConfig.KAKAO_NATIVE_APP_KEY;
        payload.put("kakaoInstalled", installed);
        payload.put("kakaoShareReady", key != null && !key.isEmpty());
        call.resolve(payload);
    }

    @PluginMethod
    public void shareInvite(PluginCall call) {
        String url = call.getString("url", "");
        String mode = call.getString("mode", "chooser");
        String text = call.getString("text", "");
        Activity activity = getActivity();
        if (activity == null || url == null || url.isEmpty()) {
            call.resolve(shareResult(false));
            return;
        }
        String body = text == null || text.isEmpty() ? url : text;
        if ("kakao-share".equals(mode)) {
            shareWithKakaoTemplate(activity, url, call);
            return;
        }
        boolean ok = "kakao-intent".equals(mode)
            ? shareWithKakaoPackage(activity, body)
            : shareWithChooser(activity, body);
        call.resolve(shareResult(ok));
    }

    @PluginMethod
    public void signInNaver(PluginCall call) {
        String clientId = call.getString("clientId", "");
        String redirectUri = call.getString("redirectUri", "kinnex://naver");
        if (clientId == null || clientId.length() < 8) {
            JSObject missing = failure("missing-client");
            missing.put("error", "missing-client");
            call.resolve(missing);
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            JSObject failed = failure("failed");
            failed.put("error", "failed");
            call.resolve(failed);
            return;
        }
        if (pendingNaver != null) resolveNaverCanceled();
        String state = randomState();
        pendingNaver = call;
        pendingNaverState = state;
        naverLeftForTab = false;
        Uri uri = Uri.parse("https://nid.naver.com/oauth2.0/authorize").buildUpon()
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("redirect_uri", redirectUri)
            .appendQueryParameter("state", state)
            .build();
        CustomTabsIntent tabs = new CustomTabsIntent.Builder().build();
        tabs.launchUrl(activity, uri);
    }

    public static void completeNaverRedirect(Uri data) {
        UmapAuthPlugin plugin = instance;
        if (plugin == null || data == null) return;
        plugin.finishNaver(data);
    }

    private void resolveNaverCanceled() {
        PluginCall call = pendingNaver;
        pendingNaver = null;
        pendingNaverState = "";
        naverLeftForTab = false;
        if (call == null) return;
        JSObject payload = failure("canceled");
        payload.put("error", "canceled");
        call.resolve(payload);
    }

    private void finishNaver(Uri data) {
        naverLeftForTab = false;
        PluginCall call = pendingNaver;
        pendingNaver = null;
        if (call == null) return;
        String error = data.getQueryParameter("error");
        String code = data.getQueryParameter("code");
        String state = data.getQueryParameter("state");
        if (error != null && !error.isEmpty()) {
            JSObject payload = failure("canceled".equals(error) ? "canceled" : "failed");
            payload.put("error", "access_denied".equals(error) ? "canceled" : "failed");
            call.resolve(payload);
            return;
        }
        if (code == null || code.isEmpty() || state == null || !state.equals(pendingNaverState)) {
            JSObject payload = failure("failed");
            payload.put("error", "failed");
            call.resolve(payload);
            return;
        }
        JSObject payload = new JSObject();
        payload.put("ok", true);
        payload.put("code", code);
        payload.put("state", state);
        call.resolve(payload);
    }

    private void loginWithKakaoAccount(Activity activity, PluginCall call) {
        UserApiClient.getInstance().loginWithKakaoAccount(activity, (token, error) -> {
            resolveKakao(call, token, error);
            return Unit.INSTANCE;
        });
    }

    private void resolveKakao(PluginCall call, OAuthToken token, Throwable error) {
        if (error != null) {
            boolean canceled = error instanceof ClientError
                && ((ClientError) error).getReason() == ClientErrorCause.Cancelled;
            JSObject payload = failure(canceled ? "canceled" : "failed");
            payload.put("detail", kakaoErrorDetail(error));
            call.resolve(payload);
            return;
        }
        if (token == null || token.getAccessToken() == null || token.getAccessToken().isEmpty()) {
            call.resolve(failure("unexpected"));
            return;
        }
        JSObject payload = new JSObject();
        payload.put("ok", true);
        payload.put("accessToken", token.getAccessToken());
        call.resolve(payload);
    }

    private boolean shouldFallbackToKakaoAccount(Throwable error) {
        if (!(error instanceof ClientError)) return error != null;
        ClientError client = (ClientError) error;
        return client.getReason() == ClientErrorCause.Cancelled
            ? false
            : client.getReason() == ClientErrorCause.NotSupported || client.getReason() == ClientErrorCause.Unknown;
    }

    private String randomState() {
        StringBuilder out = new StringBuilder();
        byte[] bytes = new byte[16];
        new java.security.SecureRandom().nextBytes(bytes);
        for (byte value : bytes) out.append(String.format("%02x", value));
        return out.toString();
    }

    private String kakaoErrorDetail(Throwable error) {
        String type = error.getClass().getSimpleName();
        String message = error.getMessage() == null ? "" : error.getMessage();
        message = message.replaceAll("(?i)bearer\\s+\\S+", "");
        message = message.replaceAll("[A-Za-z0-9_\\-]{24,}", "");
        message = message.replaceAll("\\s+", " ").trim();
        if (message.length() > 160) message = message.substring(0, 160);
        return message.isEmpty() ? type : type + ": " + message;
    }

    private void shareWithKakaoTemplate(Activity activity, String url, PluginCall call) {
        if (!kakaoTalkInstalled(activity)) {
            call.resolve(shareResult(false));
            return;
        }
        TextTemplate template = new TextTemplate(
            "이 링크로 들어오면 가족 구성원이 함께 보입니다.",
            new Link(url, url),
            null,
            "가족 참여"
        );
        activity.runOnUiThread(() -> ShareClient.getInstance().shareDefault(activity, template, (result, error) -> {
            boolean opened = false;
            if (error == null && result != null && result.getIntent() != null) {
                try {
                    activity.startActivity(result.getIntent());
                    opened = true;
                } catch (ActivityNotFoundException ignored) {
                    opened = false;
                }
            }
            call.resolve(shareResult(opened));
            return Unit.INSTANCE;
        }));
    }

    private boolean shareWithKakaoPackage(Activity activity, String text) {
        if (!kakaoTalkInstalled(activity)) return false;
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        send.setPackage(KAKAO_TALK_PACKAGE);
        send.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(send);
            return true;
        } catch (ActivityNotFoundException ignored) {
            return false;
        }
    }

    private boolean shareWithChooser(Activity activity, String text) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        try {
            activity.startActivity(Intent.createChooser(send, "가족 초대 보내기"));
            return true;
        } catch (ActivityNotFoundException ignored) {
            return false;
        }
    }

    private boolean kakaoTalkInstalled(Activity activity) {
        try {
            activity.getPackageManager().getPackageInfo(KAKAO_TALK_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException ignored) {
            return false;
        }
    }

    private JSObject shareResult(boolean ok) {
        JSObject payload = new JSObject();
        payload.put("ok", ok);
        return payload;
    }

    private JSObject failure(String code) {
        JSObject payload = new JSObject();
        payload.put("ok", false);
        payload.put("code", code);
        return payload;
    }
}
