package kr.co.umap.tracker;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** AES-GCM key that stays inside Android Keystore. Location blobs on disk use it. */
public final class DeviceCipher {
    private static final String ALIAS = "umap_location_v1";
    private static final String PREFIX = "umap-device-seal:";

    private DeviceCipher() {}

    public static String seal(String plain) {
        if (plain == null) return "";
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] ct = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] packed = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, packed, 0, iv.length);
            System.arraycopy(ct, 0, packed, iv.length, ct.length);
            return PREFIX + Base64.encodeToString(packed, Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
        } catch (Exception error) {
            return "";
        }
    }

    public static String open(String sealed) {
        if (sealed == null || !sealed.startsWith(PREFIX)) return "";
        try {
            byte[] packed = Base64.decode(sealed.substring(PREFIX.length()), Base64.NO_WRAP | Base64.URL_SAFE | Base64.NO_PADDING);
            if (packed.length < 13) return "";
            byte[] iv = new byte[12];
            byte[] ct = new byte[packed.length - 12];
            System.arraycopy(packed, 0, iv, 0, 12);
            System.arraycopy(packed, 12, ct, 0, ct.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(ct), StandardCharsets.UTF_8);
        } catch (Exception error) {
            return "";
        }
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
}
