import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { useSelector, useDispatch } from 'react-redux';
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  BackHandler,
  View,
} from 'react-native';
import { RootState, AppDispatch } from '../store';
import { lockApp, rehydrateThunk } from '../store/slices/authSlice';
import { isAppLockSuppressed } from '../utils/appLockGuard';
import { AuthStack } from './AuthStack';
import { MainStack } from './MainStack';
import { AppLockScreen } from '../screens/Auth/AppLockScreen';
import { useTheme } from '../theme/ThemeContext';
import { ensureKeyPairFor, getPublicKey } from '../services/crypto';
import { uploadPublicKeyApi } from '../services/api';
import { getNotificationsEnabledFlag, registerPushToken } from '../services/push';
import { loadSettingsThunk } from '../store/slices/settingsSlice';
import { useMessageNotifications } from '../hooks/useMessageNotifications';
import * as Notifications from 'expo-notifications';

// Show notifications when app is foregrounded (banner + sound).
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    // A foregrounded app already has a live user-WS, so an incoming call
    // arrives over WS and the in-app CallProvider banner rings it. Suppress
    // the redundant system banner for that case — the push only exists to
    // wake a backgrounded/closed app, where this handler doesn't run anyway.
    const data = notification.request.content.data as Record<string, unknown>;
    // User turned notifications off in Settings — suppress everything.
    // (Background pushes are already stopped server-side by the detached token.)
    if (!getNotificationsEnabledFlag() || data?.type === 'incoming_call') {
      return {
        shouldShowAlert: false,
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }
    return {
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    };
  },
});

export const RootNavigator = () => {
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated);
  const appLocked = useSelector((state: RootState) => state.auth.appLocked);
  const privateNumber = useSelector((state: RootState) => state.auth.privateNumber);
  const notificationsEnabled = useSelector((state: RootState) => state.settings.notificationsEnabled);
  const [isInitializing, setIsInitializing] = useState(true);
  const { colors } = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigationRef = useRef<NavigationContainerRef<any>>(null);

  // Ref so the AppState listener stays stable but still reads fresh auth state.
  const isAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    dispatch(loadSettingsThunk());
    dispatch(rehydrateThunk()).finally(() => setIsInitializing(false));
  }, [dispatch]);

  // Phase B — once the user is authenticated and the app is unlocked, ensure
  // their long-term E2EE public key is registered on the server. Lazy-generates
  // a keypair on first launch; idempotent on subsequent runs (server compares
  // and no-ops if unchanged). Failures are logged but don't block — we'll
  // retry on next state change.
  useEffect(() => {
    if (!isAuthenticated || appLocked || !privateNumber) return;
    let cancelled = false;
    (async () => {
      try {
        // Tag the local keypair with this user. If a different user logs in
        // on this device, this wipes the previous keypair so the next call
        // generates a fresh one.
        await ensureKeyPairFor(privateNumber);
        if (cancelled) return;
        const pub = await getPublicKey();
        if (cancelled) return;
        await uploadPublicKeyApi(pub);
      } catch (err) {
        console.warn('[crypto] Failed to register public key:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, appLocked, privateNumber]);

  // Register device push token once authenticated so the backend can deliver
  // notifications when the app is backgrounded or closed. Skipped while the
  // user has notifications toggled off; toggling back on re-runs this.
  useEffect(() => {
    if (!isAuthenticated || appLocked || !notificationsEnabled) return;
    registerPushToken();
  }, [isAuthenticated, appLocked, notificationsEnabled]);

  // Navigate to the relevant chat when the user taps a push notification.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, string>;
      const conversationId = data?.conversation_id;
      const contactName = data?.contact_name ?? 'Chat';
      const contactPrivateNumber = data?.contact_private_number ?? '';
      if (!conversationId || !navigationRef.current?.isReady()) return;
      navigationRef.current.navigate('ChatScreen', {
        conversationId,
        contactName,
        contactPrivateNumber,
      });
    });
    return () => sub.remove();
  }, []);

  // Re-lock the app whenever it returns from background to foreground.
  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      // Don't re-lock when the brief background was caused by an intentional
      // in-app system UI (photo picker, permission dialog, active call) — see
      // appLockGuard. Only a genuine "user left the app" should force the PIN.
      if (
        prev !== 'active' &&
        next === 'active' &&
        isAuthenticatedRef.current &&
        !isAppLockSuppressed()
      ) {
        dispatch(lockApp());
      }
      prev = next;
    });
    return () => sub.remove();
  }, [dispatch]);

  // While the lock overlay is up, swallow Android hardware back so the user
  // can't pop MainStack screens behind the lock.
  useEffect(() => {
    if (!appLocked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [appLocked]);

  // Keep the conversation list live from the per-user socket (reorder, unread,
  // last-message preview) even when the user isn't inside that chat.
  useMessageNotifications();

  // Keep the app-icon badge in sync with total unread across conversations.
  const totalUnread = useSelector((s: RootState) =>
    s.chat.conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
  );
  useEffect(() => {
    Notifications.setBadgeCountAsync(totalUnread).catch(() => {});
  }, [totalUnread]);

  if (isInitializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer ref={navigationRef}>
        {isAuthenticated ? <MainStack /> : <AuthStack />}
      </NavigationContainer>
      {isAuthenticated && appLocked && <AppLockScreen />}
    </View>
  );
};
