package kr.co.umap.tracker;

import android.app.Application;
import com.kakao.sdk.common.KakaoSdk;

public class UmapApp extends Application {
    @Override
    public void onCreate() {
        super.onCreate();
        String key = BuildConfig.KAKAO_NATIVE_APP_KEY;
        if (key != null && !key.isEmpty()) {
            KakaoSdk.init(this, key);
        }
        NativeDiag.note(this, "process", "start", -1, -1, -1, -1, false, "", -1, 0);
    }
}
