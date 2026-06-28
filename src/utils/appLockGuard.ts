/**
 * utils/appLockGuard.ts
 * ──────────────────────
 * Suppresses the foreground re-lock (AppLockScreen) while an INTENTIONAL system
 * interaction is in progress — opening the photo/camera/document picker, a
 * system permission dialog, or being in an active call. Those briefly send the
 * app to the background, and without this the AppState listener would treat the
 * return-to-foreground as "user came back" and force an unwanted PIN re-entry.
 *
 * Ref-counted so overlapping/nested interactions are handled correctly; the app
 * re-locks normally once nothing is suppressing.
 */
let depth = 0;

export function beginLockSuppression(): void {
  depth += 1;
}

export function endLockSuppression(): void {
  depth = Math.max(0, depth - 1);
}

export function isAppLockSuppressed(): boolean {
  return depth > 0;
}

/**
 * Run an async system-UI action with the lock suppressed. The decrement is
 * delayed briefly so the background→active transition that fires AFTER the
 * system UI closes is still covered by the suppression window.
 */
export async function withoutAppLock<T>(fn: () => Promise<T>): Promise<T> {
  beginLockSuppression();
  try {
    return await fn();
  } finally {
    setTimeout(endLockSuppression, 1500);
  }
}
