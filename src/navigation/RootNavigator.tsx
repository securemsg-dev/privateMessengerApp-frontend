import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
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
import { AuthStack } from './AuthStack';
import { MainStack } from './MainStack';
import { AppLockScreen } from '../screens/Auth/AppLockScreen';
import { useTheme } from '../theme/ThemeContext';
import { ensureKeyPairFor, getPublicKey } from '../services/crypto';
import { uploadPublicKeyApi } from '../services/api';

export const RootNavigator = () => {
  const isAuthenticated = useSelector((state: RootState) => state.auth.isAuthenticated);
  const appLocked = useSelector((state: RootState) => state.auth.appLocked);
  const privateNumber = useSelector((state: RootState) => state.auth.privateNumber);
  const [isInitializing, setIsInitializing] = useState(true);
  const { colors } = useTheme();
  const dispatch = useDispatch<AppDispatch>();

  // Ref so the AppState listener stays stable but still reads fresh auth state.
  const isAuthenticatedRef = useRef(isAuthenticated);
  useEffect(() => {
    isAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
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

  // Re-lock the app whenever it returns from background to foreground.
  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (prev !== 'active' && next === 'active' && isAuthenticatedRef.current) {
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

  if (isInitializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer>
        {isAuthenticated ? <MainStack /> : <AuthStack />}
      </NavigationContainer>
      {isAuthenticated && appLocked && <AppLockScreen />}
    </View>
  );
};
