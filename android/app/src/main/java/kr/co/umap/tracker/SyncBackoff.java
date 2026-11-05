package kr.co.umap.tracker;

/** Same steps as src/lib/syncBackoff.mjs. One clock per caller. */
public final class SyncBackoff {
    public static final long[] STEPS_MS = {5_000L, 15_000L, 45_000L, 120_000L};
    public static final long CAP_MS = 10L * 60L * 1000L;

    private int attempt;
    private long until;

    public static long delayMs(int attempt, double random) {
        int n = attempt < 1 ? 1 : attempt;
        long base = n <= STEPS_MS.length ? STEPS_MS[n - 1] : CAP_MS;
        double unit = random < 0d ? 0d : Math.min(1d, random);
        long jittered = Math.round(base * (0.8d + 0.4d * unit));
        if (jittered < 0L) jittered = 0L;
        return Math.min(CAP_MS, jittered);
    }

    public synchronized void succeed() {
        attempt = 0;
        until = 0L;
    }

    public synchronized void fail(long now) {
        attempt += 1;
        until = now + delayMs(attempt, Math.random());
    }

    public synchronized long remaining(long now) {
        return until > now ? until - now : 0L;
    }
}
