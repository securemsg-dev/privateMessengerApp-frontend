/**
 * store/slices/settingsSlice.ts
 * ──────────────────────────────
 * On-device user preferences: global notifications toggle + UI language.
 * Persisted via the secureStorage wrapper (no server round-trip — these are
 * per-device settings).
 */
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';

import { clearPushTokenApi, PUSH_TOKEN_KEY } from '../../services/api';
import {
  registerPushToken,
  setNotificationsEnabledFlag,
} from '../../services/push';
import i18n from '../../i18n';
import * as SecureStore from '../../utils/secureStorage';

export const NOTIFICATIONS_PREF_KEY = 'pref_notifications';
export const LANGUAGE_PREF_KEY = 'pref_language';

export type Language = 'en' | 'zh';

interface SettingsState {
  notificationsEnabled: boolean;
  language: Language;
}

const initialState: SettingsState = {
  notificationsEnabled: true,
  language: 'en',
};

/** Load persisted prefs at app start (dispatched alongside rehydrateThunk). */
export const loadSettingsThunk = createAsyncThunk<SettingsState, void>(
  'settings/load',
  async () => {
    const [notifPref, langPref] = await Promise.all([
      SecureStore.getItemAsync(NOTIFICATIONS_PREF_KEY),
      SecureStore.getItemAsync(LANGUAGE_PREF_KEY),
    ]);
    const notificationsEnabled = notifPref !== '0';
    const language: Language = langPref === 'zh' ? 'zh' : 'en';
    setNotificationsEnabledFlag(notificationsEnabled);
    await i18n.changeLanguage(language);
    return { notificationsEnabled, language };
  },
);

/**
 * Toggle notifications. Off = detach the push token server-side (background
 * pushes stop) + suppress foreground banners via the module flag. On =
 * re-register the token.
 */
export const setNotificationsEnabledThunk = createAsyncThunk<boolean, boolean>(
  'settings/setNotificationsEnabled',
  async (enabled) => {
    setNotificationsEnabledFlag(enabled);
    await SecureStore.setItemAsync(NOTIFICATIONS_PREF_KEY, enabled ? '1' : '0');
    if (enabled) {
      await registerPushToken();
    } else {
      // Best-effort: an offline toggle still applies locally; the stale
      // server token is replaced on the next toggle-on or login.
      try {
        const pushToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
        if (pushToken) {
          await clearPushTokenApi(pushToken);
          await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
        }
      } catch {
        /* push-token cleanup is best-effort */
      }
    }
    return enabled;
  },
);

/** Switch UI language; applies immediately via react-i18next re-render. */
export const setLanguageThunk = createAsyncThunk<Language, Language>(
  'settings/setLanguage',
  async (language) => {
    await SecureStore.setItemAsync(LANGUAGE_PREF_KEY, language);
    await i18n.changeLanguage(language);
    return language;
  },
);

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(loadSettingsThunk.fulfilled, (s, a: PayloadAction<SettingsState>) => {
        s.notificationsEnabled = a.payload.notificationsEnabled;
        s.language = a.payload.language;
      })
      .addCase(setNotificationsEnabledThunk.fulfilled, (s, a: PayloadAction<boolean>) => {
        s.notificationsEnabled = a.payload;
      })
      .addCase(setLanguageThunk.fulfilled, (s, a: PayloadAction<Language>) => {
        s.language = a.payload;
      });
  },
});

export default settingsSlice.reducer;
