/**
 * services/push.ts
 * ─────────────────
 * Push-token registration + the global notifications-enabled flag.
 *
 * The flag lives at module level (not Redux) because the
 * Notifications.setNotificationHandler callback in RootNavigator is
 * registered at module scope, outside React, and must read the current
 * value per notification. settingsSlice keeps it in sync with Redux.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { registerDeviceApi, PUSH_TOKEN_KEY } from './api';
import * as SecureStore from '../utils/secureStorage';

let _notificationsEnabled = true;

export function setNotificationsEnabledFlag(enabled: boolean): void {
  _notificationsEnabled = enabled;
}

export function getNotificationsEnabledFlag(): boolean {
  return _notificationsEnabled;
}

/**
 * Ensure Android channels exist, request permission, fetch the Expo push
 * token, and register it with the backend. Safe to call repeatedly.
 * Throws nothing — failures are logged and retried on the next auth change.
 */
export async function registerPushToken(): Promise<void> {
  try {
    // Android needs an explicit high-importance channel or heads-up
    // banners (and sound) won't show. Must exist before notifications
    // arrive; the backend tags message pushes with channelId "messages".
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('messages', {
        name: 'Messages',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PRIVATE,
      });
      await Notifications.setNotificationChannelAsync('calls', {
        name: 'Calls',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 500, 500, 500],
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const tokenData = await Notifications.getExpoPushTokenAsync();

    await registerDeviceApi({
      device_name: Platform.OS === 'ios' ? 'iPhone' : 'Android Device',
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      push_token: tokenData.data,
    });
    // Remember which token we registered so logout (or the notifications
    // toggle) can tell the server to detach it.
    await SecureStore.setItemAsync(PUSH_TOKEN_KEY, tokenData.data);
  } catch (err) {
    console.warn('[push] Failed to register push token:', err);
  }
}
