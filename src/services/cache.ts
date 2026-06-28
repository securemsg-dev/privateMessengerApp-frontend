/**
 * services/cache.ts
 * ──────────────────
 * A tiny persistent JSON cache backed by the app's document directory, used
 * for stale-while-revalidate rendering: screens read the last-known data
 * instantly on open, then refresh from the network in the background.
 *
 * NOTE: this stores DECRYPTED data (message bodies, conversation previews) on
 * device — the standard trade-off for instant-loading E2EE apps. It protects
 * the server, not a stolen *unlocked* phone. Cleared on logout via clearCache().
 */
import * as FileSystem from 'expo-file-system/legacy';

const DIR = `${FileSystem.documentDirectory}cache/`;

let ready: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const info = await FileSystem.getInfoAsync(DIR);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
      }
    })();
  }
  return ready;
}

const fileFor = (key: string) => `${DIR}${encodeURIComponent(key)}.json`;

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    await ensureDir();
    const path = fileFor(key);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    const text = await FileSystem.readAsStringAsync(path);
    return JSON.parse(text) as T;
  } catch {
    return null; // a corrupt/missing cache is never fatal — just a cache miss
  }
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  try {
    await ensureDir();
    await FileSystem.writeAsStringAsync(fileFor(key), JSON.stringify(value));
  } catch {
    /* best-effort — failing to cache must never break the live path */
  }
}

/** Wipe the whole cache (call on logout so a new account starts clean). */
export async function clearCache(): Promise<void> {
  try {
    await FileSystem.deleteAsync(DIR, { idempotent: true });
    ready = null;
  } catch {
    /* ignore */
  }
}

// Stable cache keys.
export const CACHE_KEYS = {
  conversations: 'conversations',
  callLog: 'calllog',
  messages: (conversationId: string) => `messages:${conversationId}`,
};
