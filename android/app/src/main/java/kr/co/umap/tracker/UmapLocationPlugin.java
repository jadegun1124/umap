package kr.co.umap.tracker;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Process;
import android.os.SystemClock;
import android.provider.Settings;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Location keep-alive plus the system prompts the in-app buttons ask for.
 * Nothing here runs until JavaScript calls it after the Korean explanation.
 * Background location is not flipped in code. Android 11+ opens the location
 * permission page. Android 10 may show the system background dialog from the
 * blocking gate. The user chooses 항상 허용.
 */
@CapacitorPlugin(
    name = "UmapLocation",
    permissions = {
        @Permission(strings = { android.Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications"),
        @Permission(strings = { android.Manifest.permission.CAMERA }, alias = "camera"),
        @Permission(strings = { android.Manifest.permission.ACTIVITY_RECOGNITION }, alias = "motion"),
        @Permission(
            strings = {
                android.Manifest.permission.ACCESS_COARSE_LOCATION,
                android.Manifest.permission.ACCESS_FINE_LOCATION
            },
            alias = "location"
        ),
        @Permission(strings = { android.Manifest.permission.ACCESS_BACKGROUND_LOCATION }, alias = "backgroundLocation")
    }
)
public class UmapLocationPlugin extends Plugin {
    private static volatile UmapLocationPlugin active;
    private static volatile String pendingChatCode;
    private static volatile String pendingChatPeer;
    private static final long BOUNCE_MS = 450L;
    private static final long BOUNCE_CONFIRM_MS = 800L;
    private static final long OPEN_WATCH_MS = 2000L;
    private static final String MANAGE_APP_PERMISSION = "android.intent.action.MANAGE_APP_PERMISSION";
    private static final String MANAGE_APP_PERMISSIONS = "android.intent.action.MANAGE_APP_PERMISSIONS";
    private static final String LOCATION_GROUP = "android.permission-group.LOCATION";
    private static final String GATE_PREFS = "umap_always_gate";
    private static final String BACKGROUND_DIALOG_ASKED = "background_dialog_asked";
    private static final String FINE_DIALOG_ASKED = "fine_dialog_asked";

    private PluginCall pendingAlways;
    private boolean leftForSettings;
    private String openedScreen = "none";
    private long openedAt;
    private boolean wantOverlay;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable bounceFallback;
    private Runnable overlayTask;
    private int overlayTries;
    private PluginCall pendingOverlay;
    private boolean leftForOverlay;
    private long overlayOpenedAt;
    private Runnable overlayBounce;

    public static void openChat(String code, String peer) {
        if (code == null || peer == null || code.isEmpty() || peer.isEmpty()) return;
        pendingChatCode = code;
        pendingChatPeer = peer;
        UmapLocationPlugin plugin = active;
        if (plugin == null) return;
        try {
            plugin.notifyChat(code, peer);
        } catch (RuntimeException ignored) {
            /* 화면이 아직 없어도 다음에 남은 대화를 연다 */
        }
    }

    @Override
    public void load() {
        active = this;
        Context context = getContext();
        LocationKeepService.attach(context);
        AlertWatchService.attach(context);
        OngoingNotificationCleanup.clear(context);
        LocationKeepService.setSink(this::emitFix);
    }

    private void emitFix(JSONObject fix) {
        AppCompatActivity activity = getActivity();
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            try {
                notifyListeners("fix", JSObject.fromJSONObject(fix));
            } catch (JSONException ignored) {
                /* 화면이 없어도 서비스의 서버 전송은 남는다 */
            }
        });
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        JSObject result = new JSObject();
        result.put("opened", openAppDetails());
        call.resolve(result);
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || granted(android.Manifest.permission.POST_NOTIFICATIONS)) {
            resolvePrompt(call, "granted", false);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        if (granted(android.Manifest.permission.POST_NOTIFICATIONS)) {
            resolvePrompt(call, "granted", false);
            return;
        }
        boolean showAgain = shouldShow(android.Manifest.permission.POST_NOTIFICATIONS);
        resolvePrompt(call, "denied", !showAgain && openNotificationSettings());
    }

    @PluginMethod
    public void requestCamera(PluginCall call) {
        if (granted(android.Manifest.permission.CAMERA)) {
            resolvePrompt(call, "granted", false);
            return;
        }
        requestPermissionForAlias("camera", call, "cameraCallback");
    }

    @PermissionCallback
    private void cameraCallback(PluginCall call) {
        if (granted(android.Manifest.permission.CAMERA)) {
            resolvePrompt(call, "granted", false);
            return;
        }
        boolean showAgain = shouldShow(android.Manifest.permission.CAMERA);
        boolean opened = !showAgain && openPermissionPage(android.Manifest.permission.CAMERA);
        resolvePrompt(call, "denied", opened);
    }

    @PluginMethod
    public void requestMotion(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 || granted(android.Manifest.permission.ACTIVITY_RECOGNITION)) {
            resolvePrompt(call, "granted", false);
            return;
        }
        requestPermissionForAlias("motion", call, "motionCallback");
    }

    @PermissionCallback
    private void motionCallback(PluginCall call) {
        if (granted(android.Manifest.permission.ACTIVITY_RECOGNITION)) {
            resolvePrompt(call, "granted", false);
            return;
        }
        boolean showAgain = shouldShow(android.Manifest.permission.ACTIVITY_RECOGNITION);
        boolean opened = !showAgain && openPermissionPage(android.Manifest.permission.ACTIVITY_RECOGNITION);
        resolvePrompt(call, "denied", opened);
    }

    @PluginMethod
    public void requestForeground(PluginCall call) {
        if (hasForeground()) {
            resolveForeground(call, "while-using");
            return;
        }
        requestPermissionForAlias("location", call, "foregroundCallback");
    }

    @PermissionCallback
    private void foregroundCallback(PluginCall call) {
        resolveForeground(call, hasForeground() ? "while-using" : "denied");
    }

    @PluginMethod
    public void locationAccess(PluginCall call) {
        JSObject result = new JSObject();
        String location = "denied";
        if (hasBackground()) location = "always";
        else if (hasForeground()) location = "while-using";
        result.put("location", location);
        result.put("precise", hasFine());
        result.put("background", hasBackground());
        call.resolve(result);
    }

    /**
     * Blocking-gate button. Mirrors alwaysAllowGateTarget in alwaysAllowGate.mjs.
     * Android 10 asks with the system background dialog when it can still appear.
     * Every other case opens the location permission page.
     */
    @PluginMethod
    public void openAlwaysGate(PluginCall call) {
        int sdk = Build.VERSION.SDK_INT;
        boolean foreground = hasForeground();
        boolean background = hasBackground();
        boolean precise = hasFine();
        if (background && precise) {
            resolveGate(call, false, "none");
            return;
        }
        if (sdk < Build.VERSION_CODES.Q) {
            if (!precise && fineDialogAskable()) {
                markFineDialogAsked();
                requestPermissionForAlias("location", call, "gateForegroundCallback");
                return;
            }
            wantOverlay = false;
            openAlwaysLocation(call);
            return;
        }
        if (sdk == Build.VERSION_CODES.Q && !background) {
            if (!foreground && fineDialogAskable()) {
                markFineDialogAsked();
                requestPermissionForAlias("location", call, "gateForegroundCallback");
                return;
            }
            if (foreground && backgroundDialogAskable()) {
                markBackgroundDialogAsked();
                requestPermissionForAlias("backgroundLocation", call, "gateBackgroundCallback");
                return;
            }
        }
        wantOverlay = false;
        openAlwaysLocation(call);
    }

    @PermissionCallback
    private void gateForegroundCallback(PluginCall call) {
        if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q && hasForeground() && !hasBackground() && backgroundDialogAskable()) {
            mainHandler.post(() -> {
                try {
                    if (call.isReleased()) return;
                    if (Build.VERSION.SDK_INT != Build.VERSION_CODES.Q || !hasForeground() || hasBackground() || !backgroundDialogAskable()) {
                        resolveGate(call, true, hasForeground() ? "foreground-dialog" : "none");
                        return;
                    }
                    markBackgroundDialogAsked();
                    requestPermissionForAlias("backgroundLocation", call, "gateBackgroundCallback");
                } catch (RuntimeException ignored) {
                    if (!call.isReleased()) resolveGate(call, false, "none");
                }
            });
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && hasForeground() && !hasBackground()) {
            wantOverlay = false;
            openAlwaysLocation(call);
            return;
        }
        resolveGate(call, true, hasForeground() ? "foreground-dialog" : "none");
    }

    @PermissionCallback
    private void gateBackgroundCallback(PluginCall call) {
        resolveGate(call, true, "background-dialog");
    }

    private void resolveGate(PluginCall call, boolean opened, String screen) {
        String location = "denied";
        if (hasBackground()) location = "always";
        else if (hasForeground()) location = "while-using";
        JSObject result = new JSObject();
        result.put("location", location);
        result.put("opened", opened);
        result.put("native", true);
        result.put("overlay", false);
        result.put("screen", opened ? screen : "none");
        result.put("precise", hasFine());
        call.resolve(result);
    }

    @PluginMethod
    public void overlayPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", AlwaysAllowOverlay.canDraw(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        if (AlwaysAllowOverlay.canDraw(getContext())) {
            JSObject result = new JSObject();
            result.put("opened", false);
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        call.setKeepAlive(true);
        pendingOverlay = call;
        leftForOverlay = false;
        overlayOpenedAt = SystemClock.uptimeMillis();
        if (startExternal(intent)) return;
        pendingOverlay = null;
        JSObject result = new JSObject();
        result.put("opened", false);
        result.put("granted", false);
        call.resolve(result);
    }

    @PluginMethod
    public void openAlwaysLocation(PluginCall call) {
        AppCompatActivity activity = getActivity();
        if (activity == null) {
            resolveAlways(call, false);
            return;
        }
        wantOverlay = Boolean.TRUE.equals(call.getBoolean("overlay", false));
        clearOverlayTask();
        AlwaysAllowOverlay.hide();
        AlwaysAllowOverlay.consumeShown();
        call.setKeepAlive(true);
        pendingAlways = call;
        leftForSettings = false;
        openedScreen = "none";
        activity.runOnUiThread(() -> {
            if (openAlwaysSettings()) return;
            pendingAlways = null;
            leftForSettings = false;
            wantOverlay = false;
            resolveAlways(call, false);
        });
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (pendingAlways != null) {
            leftForSettings = true;
            clearBounce();
        }
        if (pendingOverlay != null) {
            leftForOverlay = true;
            if (overlayBounce != null) {
                mainHandler.removeCallbacks(overlayBounce);
                overlayBounce = null;
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        clearOverlayTask();
        AlwaysAllowOverlay.hide();
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        notifyResume();
        if (pendingOverlay != null && leftForOverlay) {
            long elapsed = SystemClock.uptimeMillis() - overlayOpenedAt;
            if (elapsed < BOUNCE_MS) {
                leftForOverlay = false;
                overlayBounce = () -> {
                    if (pendingOverlay == null || leftForOverlay) return;
                    AppCompatActivity activity = getActivity();
                    if (activity != null && !activity.hasWindowFocus()) return;
                    resolveOverlay(true);
                };
                mainHandler.postDelayed(overlayBounce, BOUNCE_CONFIRM_MS);
                return;
            }
            resolveOverlay(true);
            return;
        }
        if (pendingAlways != null && leftForSettings) {
            long elapsed = SystemClock.uptimeMillis() - openedAt;
            if (elapsed < BOUNCE_MS && !"app-details".equals(openedScreen)) {
                leftForSettings = false;
                // Samsung often finishes a trampoline, which resumes us, then opens
                // 위치 액세스 권한. Wait before covering that page with app info.
                scheduleBounceConfirm();
                return;
            }
            PluginCall call = pendingAlways;
            pendingAlways = null;
            leftForSettings = false;
            resolveAlways(call, true);
        }
    }

    @SuppressLint("BatteryLife")
    @PluginMethod
    public void openBattery(PluginCall call) {
        JSObject result = new JSObject();
        String pkg = getContext().getPackageName();
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        boolean unrestricted = power != null && power.isIgnoringBatteryOptimizations(pkg);
        result.put("unrestricted", unrestricted);
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + pkg));
        result.put("opened", startExternal(intent));
        call.resolve(result);
    }

    @PluginMethod
    public void battery(PluginCall call) {
        JSObject result = new JSObject();
        Intent battery = getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery == null) {
            call.resolve(result);
            return;
        }
        int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
        int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
        int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        if (scale > 0 && level >= 0) result.put("pct", Math.round(level * 100f / scale));
        boolean charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL;
        result.put("charging", charging);
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        String config = call.getString("config", "");
        boolean started = config != null && LocationKeepService.start(getContext(), config);
        JSObject result = new JSObject();
        result.put("started", started);
        if (!started) result.put("reason", LocationKeepService.lastError() == null ? "config" : LocationKeepService.lastError());
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        LocationKeepService.stop(getContext());
        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }

    @PluginMethod
    public void startAlertWatch(PluginCall call) {
        String config = call.getString("config", "");
        boolean started = config != null && AlertWatchService.start(getContext(), config);
        JSObject result = new JSObject();
        result.put("started", started);
        if (!started) result.put("reason", AlertWatchService.lastError() == null ? "config" : AlertWatchService.lastError());
        call.resolve(result);
    }

    @PluginMethod
    public void stopAlertWatch(PluginCall call) {
        AlertWatchService.stop(getContext());
        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }

    @PluginMethod
    public void consumePendingChat(PluginCall call) {
        JSObject result = new JSObject();
        result.put("code", pendingChatCode == null ? "" : pendingChatCode);
        result.put("peer", pendingChatPeer == null ? "" : pendingChatPeer);
        pendingChatCode = null;
        pendingChatPeer = null;
        call.resolve(result);
    }

    private void notifyChat(String code, String peer) {
        JSObject data = new JSObject();
        data.put("code", code);
        data.put("peer", peer);
        notifyListeners("chat", data);
    }

    @PluginMethod
    public void alertWatchStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", AlertWatchService.isRunning());
        result.put("userStopped", AlertWatchService.userStopped(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", LocationKeepService.isRunning());
        result.put("userStopped", LocationKeepService.userStopped(getContext()));
        result.put("native", true);
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        result.put("batteryUnrestricted", power != null && power.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        String reason = LocationKeepService.lastError();
        if (reason != null) result.put("reason", reason);
        call.resolve(result);
    }

    @PluginMethod
    public void ackStopped(PluginCall call) {
        LocationKeepService.ackUserStopped(getContext());
        call.resolve();
    }

    private void resolvePrompt(PluginCall call, String state, boolean openedSettings) {
        JSObject result = new JSObject();
        result.put("state", state);
        result.put("openedSettings", openedSettings);
        call.resolve(result);
    }

    private void resolveForeground(PluginCall call, String location) {
        JSObject result = new JSObject();
        result.put("location", location);
        call.resolve(result);
    }

    private void resolveOverlay(boolean opened) {
        if (overlayBounce != null) {
            mainHandler.removeCallbacks(overlayBounce);
            overlayBounce = null;
        }
        PluginCall call = pendingOverlay;
        pendingOverlay = null;
        leftForOverlay = false;
        if (call == null) return;
        JSObject result = new JSObject();
        result.put("opened", opened);
        result.put("granted", AlwaysAllowOverlay.canDraw(getContext()));
        call.resolve(result);
    }

    private void resolveAlways(PluginCall call, boolean opened) {
        clearOverlayTask();
        boolean overlay = AlwaysAllowOverlay.consumeShown();
        AlwaysAllowOverlay.hide();
        wantOverlay = false;
        pendingAlways = null;
        leftForSettings = false;
        String location = "denied";
        if (hasBackground()) location = "always";
        else if (hasForeground()) location = "while-using";
        JSObject result = new JSObject();
        result.put("location", location);
        result.put("opened", opened);
        result.put("native", true);
        result.put("overlay", overlay);
        result.put("screen", opened ? openedScreen : "none");
        openedScreen = "none";
        call.resolve(result);
    }

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean shouldShow(String permission) {
        AppCompatActivity activity = getActivity();
        return activity != null && ActivityCompat.shouldShowRequestPermissionRationale(activity, permission);
    }

    private boolean hasForeground() {
        return hasFine() || granted(android.Manifest.permission.ACCESS_COARSE_LOCATION);
    }

    private boolean hasFine() {
        return granted(android.Manifest.permission.ACCESS_FINE_LOCATION);
    }

    private boolean hasBackground() {
        if (Build.VERSION.SDK_INT < 29) return hasForeground();
        return granted(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    private SharedPreferences gatePrefs() {
        return getContext().getSharedPreferences(GATE_PREFS, Context.MODE_PRIVATE);
    }

    private boolean backgroundDialogAskable() {
        if (Build.VERSION.SDK_INT != Build.VERSION_CODES.Q) return false;
        boolean asked = gatePrefs().getBoolean(BACKGROUND_DIALOG_ASKED, false);
        if (!asked) return true;
        return shouldShow(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    private boolean fineDialogAskable() {
        boolean asked = gatePrefs().getBoolean(FINE_DIALOG_ASKED, false);
        if (!asked) return true;
        return shouldShow(android.Manifest.permission.ACCESS_FINE_LOCATION);
    }

    private void markBackgroundDialogAsked() {
        gatePrefs().edit().putBoolean(BACKGROUND_DIALOG_ASKED, true).apply();
    }

    private void markFineDialogAsked() {
        gatePrefs().edit().putBoolean(FINE_DIALOG_ASKED, true).apply();
    }

    private void notifyResume() {
        try {
            notifyListeners("resume", new JSObject());
        } catch (RuntimeException ignored) {
            /* 화면이 아직 없어도 권한 확인은 이어 간다 */
        }
    }

    private boolean canStart(Intent intent) {
        try {
            return intent.resolveActivity(getContext().getPackageManager()) != null;
        } catch (Exception error) {
            return false;
        }
    }

    /** Radio (위치 액세스 권한), then 앱 권한, then app info. Never stops on an in-app message alone. */
    private boolean openAlwaysSettings() {
        if (openLocationRadio()) {
            noteOpened("location-radio");
            return true;
        }
        if (openAppPermissions()) {
            noteOpened("app-permissions");
            return true;
        }
        if (openAppDetails()) {
            noteOpened("app-details");
            return true;
        }
        return false;
    }

    private void noteOpened(String screen) {
        openedScreen = screen;
        openedAt = SystemClock.uptimeMillis();
        leftForSettings = false;
        armBounce();
        if (wantOverlay) scheduleOverlay();
    }

    private void scheduleOverlay() {
        clearOverlayTask();
        overlayTries = 0;
        overlayTask = new Runnable() {
            @Override
            public void run() {
                if (pendingAlways == null || !wantOverlay) return;
                AppCompatActivity activity = getActivity();
                boolean covered = leftForSettings || (activity != null && !activity.hasWindowFocus());
                if (!covered && overlayTries < 6) {
                    overlayTries += 1;
                    mainHandler.postDelayed(this, 300);
                    return;
                }
                AlwaysAllowOverlay.show(getContext());
            }
        };
        mainHandler.postDelayed(overlayTask, 350);
    }

    private void clearOverlayTask() {
        if (overlayTask != null) {
            mainHandler.removeCallbacks(overlayTask);
            overlayTask = null;
        }
    }

    private void armBounce() {
        clearBounce();
        if ("app-details".equals(openedScreen)) return;
        bounceFallback = () -> {
            if (pendingAlways == null || leftForSettings) return;
            advanceFallback();
        };
        mainHandler.postDelayed(bounceFallback, OPEN_WATCH_MS);
    }

    private void scheduleBounceConfirm() {
        clearBounce();
        if ("app-details".equals(openedScreen) || pendingAlways == null) return;
        bounceFallback = () -> {
            if (pendingAlways == null || leftForSettings) return;
            advanceFallback();
        };
        mainHandler.postDelayed(bounceFallback, BOUNCE_CONFIRM_MS);
    }

    private void clearBounce() {
        if (bounceFallback != null) {
            mainHandler.removeCallbacks(bounceFallback);
            bounceFallback = null;
        }
    }

    private void advanceFallback() {
        clearBounce();
        if (pendingAlways == null) return;
        AppCompatActivity activity = getActivity();
        // 위치 액세스 권한 is already showing. Do not cover it with app info.
        if (activity != null && !activity.hasWindowFocus()) return;
        // startActivity for the location radios already returned. A timer must
        // not replace that page with APPLICATION_DETAILS_SETTINGS.
        if ("location-radio".equals(openedScreen)) {
            PluginCall call = pendingAlways;
            pendingAlways = null;
            leftForSettings = false;
            if (call != null) resolveAlways(call, true);
            return;
        }
        if (!"app-details".equals(openedScreen) && openAppDetails()) {
            noteOpened("app-details");
            return;
        }
        PluginCall call = pendingAlways;
        pendingAlways = null;
        leftForSettings = false;
        if (call != null) resolveAlways(call, false);
    }

    /** 위치 액세스 권한: 항상 허용 / 앱 사용 중에만 허용 / 정확한 위치 사용. */
    private Intent locationRadioIntent(String pkg) {
        Intent intent = new Intent(MANAGE_APP_PERMISSION);
        intent.addCategory(Intent.CATEGORY_DEFAULT);
        intent.putExtra(Intent.EXTRA_PACKAGE_NAME, pkg);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
        intent.putExtra("android.intent.extra.PERMISSION_GROUP_NAME", LOCATION_GROUP);
        intent.putExtra(Intent.EXTRA_USER, Process.myUserHandle());
        return intent;
    }

    private Intent appPermissionsIntent(String pkg) {
        Intent intent = new Intent(MANAGE_APP_PERMISSIONS);
        intent.addCategory(Intent.CATEGORY_DEFAULT);
        intent.putExtra(Intent.EXTRA_PACKAGE_NAME, pkg);
        return intent;
    }

    private boolean openLocationRadio() {
        String pkg = getContext().getPackageName();
        Intent template = locationRadioIntent(pkg);
        // Samsung's ManagePermissionsActivity is the host of 위치 액세스 권한
        // (항상 허용 / 앱 사용 중에만 / 정확한 위치 사용). Name it before any
        // other controller. A loose setPackage match can hit a trampoline.
        String[][] targets = new String[][] {
            {"com.samsung.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.ManagePermissionsActivity"},
            {"com.samsung.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.ManageAppPermissionActivity"},
            {"com.samsung.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.AppPermissionActivity"},
            {"com.samsung.android.permissioncontroller", "com.samsung.android.permissioncontroller.permission.ui.AppPermissionActivity"},
            {"com.samsung.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.handheld.AppPermissionActivity"},
            {"com.google.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.ManagePermissionsActivity"},
            {"com.google.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.ManageAppPermissionActivity"},
            {"com.google.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.AppPermissionActivity"},
            {"com.google.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.handheld.AppPermissionActivity"},
            {"com.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.ManagePermissionsActivity"},
            {"com.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.ManageAppPermissionActivity"},
            {"com.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.AppPermissionActivity"},
            {"com.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.handheld.AppPermissionActivity"}
        };
        if (startExplicit(template, targets)) return true;
        String[] controllers = new String[] {
            "com.samsung.android.permissioncontroller",
            "com.google.android.permissioncontroller",
            "com.android.permissioncontroller"
        };
        for (String controller : controllers) {
            Intent intent = locationRadioIntent(pkg);
            intent.setPackage(controller);
            if (canStart(intent) && startExternal(intent)) return true;
        }
        Intent implicit = locationRadioIntent(pkg);
        return canStart(implicit) && startExternal(implicit);
    }

    private boolean openAppPermissions() {
        String pkg = getContext().getPackageName();
        String[][] targets = new String[][] {
            {"com.samsung.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.ManagePermissionsActivity"},
            {"com.samsung.android.permissioncontroller", "com.samsung.android.permissioncontroller.permission.ui.ManagePermissionsActivity"},
            {"com.google.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.ManagePermissionsActivity"},
            {"com.android.permissioncontroller", "com.android.permissioncontroller.permission.ui.ManagePermissionsActivity"}
        };
        if (startExplicit(appPermissionsIntent(pkg), targets)) return true;
        String[] controllers = new String[] {
            "com.samsung.android.permissioncontroller",
            "com.google.android.permissioncontroller",
            "com.android.permissioncontroller"
        };
        for (String controller : controllers) {
            Intent intent = appPermissionsIntent(pkg);
            intent.setPackage(controller);
            if (canStart(intent) && startExternal(intent)) return true;
        }
        Intent implicit = appPermissionsIntent(pkg);
        return canStart(implicit) && startExternal(implicit);
    }

    private boolean startExplicit(Intent template, String[][] targets) {
        for (String[] target : targets) {
            Intent intent = new Intent(template);
            intent.setClassName(target[0], target[1]);
            if (canStart(intent) && startExternal(intent)) return true;
        }
        return false;
    }

    private boolean openPermissionPage(String permission) {
        Intent direct = new Intent(MANAGE_APP_PERMISSION);
        direct.putExtra(Intent.EXTRA_PACKAGE_NAME, getContext().getPackageName());
        direct.putExtra("android.intent.extra.PERMISSION_NAME", permission);
        if (canStart(direct) && startExternal(direct)) return true;
        if (openAppPermissions()) return true;
        return openAppDetails();
    }

    private boolean openNotificationSettings() {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        if (startExternal(intent)) return true;
        return openAppDetails();
    }

    private boolean openAppDetails() {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        return startExternal(intent);
    }

    private boolean startExternal(Intent intent) {
        try {
            AppCompatActivity activity = getActivity();
            if (activity != null) activity.startActivity(intent);
            else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            return true;
        } catch (Exception error) {
            return false;
        }
    }

}
