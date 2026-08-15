/**
 * services/callForegroundService.ts
 * ──────────────────────────────────
 * Keeps an in-progress voice call alive while the device sleeps or the user
 * switches to another app.
 *
 * Android only. Since API 28 a process that isn't foreground-importance gets
 * silence from the microphone, and shortly after that Doze starts tearing down
 * its sockets — so locking the screen mid-call killed the peer connection. A
 * foreground service of type `microphone` (declared by
 * plugins/withCallForegroundService.js) holds the process at foreground
 * importance for the duration of the call, which is also what Play policy
 * requires for background mic use: an ongoing, user-visible notification.
 *
 * iOS needs none of this — the `audio` entry in UIBackgroundModes (app.json)
 * keeps the audio session and the JS runtime alive on lock — so every function
 * here is a no-op off Android.
 *
 * Every call is best-effort: losing the notification is never a reason to drop
 * a call the user is actually on, so failures are logged and swallowed.
 */
import { Platform } from 'react-native';

const CHANNEL_ID = 'ongoing-call';
const NOTIFICATION_ID = 'cricchat-ongoing-call';

// Notifee is a native module: requiring it anywhere it isn't linked (jest's
// node environment, web) throws at import time. Resolve it lazily so importing
// this module can never break the app.
type Notifee = typeof import('@notifee/react-native');
let notifeeMod: Notifee | null | undefined;

const getNotifee = (): Notifee | null => {
  if (notifeeMod !== undefined) return notifeeMod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifeeMod = require('@notifee/react-native') as Notifee;
  } catch {
    notifeeMod = null;
  }
  return notifeeMod;
};

const isSupported = (): boolean => Platform.OS === 'android' && getNotifee() !== null;

let registered = false;
let running = false;

/**
 * Register the long-running task backing the service. Notifee requires this to
 * happen before the service is ever started, and the promise must never settle
 * — the service lives until stopCallForegroundService() stops it.
 */
export function ensureCallForegroundServiceRegistered(): void {
  if (registered || !isSupported()) return;
  const notifee = getNotifee();
  if (!notifee) return;
  try {
    notifee.default.registerForegroundService(() => new Promise<void>(() => {}));
    registered = true;
  } catch (err) {
    console.warn('[call] registerForegroundService failed:', err);
  }
}

/**
 * Show the ongoing-call notification and promote the process to a foreground
 * service. Safe to call twice — the second call just refreshes the notification.
 */
export async function startCallForegroundService(contactName: string): Promise<void> {
  if (!isSupported()) return;
  const notifee = getNotifee();
  if (!notifee) return;

  ensureCallForegroundServiceRegistered();

  const { AndroidImportance, AndroidForegroundServiceType } = notifee;

  try {
    // IMPORTANCE_LOW: the call UI is already on screen, so this notification is
    // a status indicator and a policy requirement — it shouldn't buzz or peek.
    await notifee.default.createChannel({
      id: CHANNEL_ID,
      name: 'Ongoing calls',
      description: 'Shown while a Cricchat voice call is in progress.',
      importance: AndroidImportance.LOW,
      vibration: false,
    });

    await notifee.default.displayNotification({
      id: NOTIFICATION_ID,
      title: 'Ongoing call',
      body: contactName,
      android: {
        channelId: CHANNEL_ID,
        asForegroundService: true,
        foregroundServiceTypes: [
          AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_MICROPHONE,
        ],
        ongoing: true,
        autoCancel: false,
        // The call is already ringing/connected in-app; don't re-alert on every
        // notification update.
        onlyAlertOnce: true,
        // Live call timer for free, instead of us pushing a new notification
        // every second.
        showChronometer: true,
        timestamp: Date.now(),
        pressAction: { id: 'default', launchActivity: 'default' },
      },
    });
    running = true;
  } catch (err) {
    console.warn('[call] startForegroundService failed:', err);
  }
}

/** Tear the service down. Called from cleanupCall on every call-end path. */
export async function stopCallForegroundService(): Promise<void> {
  if (!running || !isSupported()) return;
  const notifee = getNotifee();
  if (!notifee) return;
  running = false;
  try {
    await notifee.default.stopForegroundService();
  } catch (err) {
    console.warn('[call] stopForegroundService failed:', err);
  }
  // stopForegroundService usually removes the notification, but a service that
  // was already gone leaves it behind — make sure nothing sticks in the shade.
  try {
    await notifee.default.cancelNotification(NOTIFICATION_ID);
  } catch {
    /* nothing to cancel */
  }
}
