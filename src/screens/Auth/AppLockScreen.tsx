import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from '../../utils/secureStorage';
import { useDispatch, useSelector } from 'react-redux';

import {
  forceLogout,
  logoutThunk,
  unlockAppThunk,
} from '../../store/slices/authSlice';
import { CACHED_PRIVATE_NUMBER_KEY } from '../../services/api';
import { AppDispatch, RootState } from '../../store';
import { useTheme } from '../../theme/ThemeContext';

const JOB_EXECUTED_DELAY_MS = 1500;

/** Format a 10-digit string as XX-XXXX-XXXX for display. */
function formatPrivateNumber(digits: string): string {
  if (digits.length !== 10) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
}

/**
 * Full-screen overlay that sits on top of MainStack while the app is locked.
 * MainStack renders underneath (visible through the dimmed backdrop) so the
 * user sees their chat home behind the password prompt — same pattern as
 * banking apps.
 */
export const AppLockScreen = () => {
  const { colors } = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((s: RootState) => s.auth.status);
  const serverError = useSelector((s: RootState) => s.auth.error);

  const [cachedNumber, setCachedNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [wipeState, setWipeState] = useState<'idle' | 'executed'>('idle');
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canSubmit =
    password.length >= 8 && status !== 'loading' && wipeState === 'idle';

  useEffect(() => {
    (async () => {
      try {
        const cached = await SecureStore.getItemAsync(CACHED_PRIVATE_NUMBER_KEY);
        if (cached && /^\d{10}$/.test(cached)) setCachedNumber(cached);
      } catch {
        /* SecureStore unavailable — leave empty */
      }
    })();
    return () => {
      if (transitionTimer.current) clearTimeout(transitionTimer.current);
    };
  }, []);

  const handleUnlock = async () => {
    if (!canSubmit) return;
    const result = await dispatch(unlockAppThunk({ password }));
    if (unlockAppThunk.fulfilled.match(result)) {
      if (result.payload.kind === 'deleted') {
        // INTENTIONAL: no confirmation dialog here. The delete-password is a
        // duress/panic wipe — entering it must silently destroy the account.
        // A "are you sure?" prompt would defeat the feature under coercion
        // (it would reveal the wipe and let the coercer cancel). Do NOT add a
        // confirmation step to this branch.
        setPassword('');
        setWipeState('executed');
        transitionTimer.current = setTimeout(() => {
          dispatch(forceLogout());
        }, JOB_EXECUTED_DELAY_MS);
      }
      // 'unlocked' → Redux flip causes RootNavigator to hide the overlay.
    }
  };

  const handleSignInAsDifferent = () => {
    setPassword('');
    dispatch(logoutThunk());
  };

  return (
    <View style={styles.backdrop}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardWrap}
        >
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            {wipeState === 'executed' ? (
              <View style={styles.jobExecutedWrap}>
                <Text style={[styles.jobExecutedText, { color: colors.text }]}>
                  Job Executed
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.header}>
                  <Text style={[styles.title, { color: colors.text }]}>
                    Welcome back
                  </Text>
                  <Text
                    style={[styles.subtitle, { color: colors.textSecondary }]}
                  >
                    Enter your password to unlock your account.
                  </Text>
                </View>

                <View
                  style={[
                    styles.inputWrap,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name="keypad-outline"
                    size={18}
                    color={colors.textSecondary}
                    style={styles.inputIcon}
                  />
                  <Text style={[styles.readonlyText, { color: colors.text }]}>
                    {cachedNumber ? formatPrivateNumber(cachedNumber) : '—'}
                  </Text>
                </View>

                <View
                  style={[
                    styles.inputWrap,
                    { backgroundColor: colors.background, borderColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name="lock-closed-outline"
                    size={18}
                    color={colors.textSecondary}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={[styles.textInput, { color: colors.text }]}
                    placeholder="Password"
                    placeholderTextColor={colors.textSecondary}
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    autoFocus
                    onSubmitEditing={handleUnlock}
                    returnKeyType="go"
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeBtn}
                  >
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={20}
                      color={colors.textSecondary}
                    />
                  </TouchableOpacity>
                </View>

                {serverError && (
                  <Text style={styles.errorText}>{serverError}</Text>
                )}

                <TouchableOpacity
                  style={[
                    styles.unlockBtn,
                    { backgroundColor: canSubmit ? colors.primary : colors.border },
                  ]}
                  onPress={handleUnlock}
                  activeOpacity={0.85}
                  disabled={!canSubmit}
                >
                  {status === 'loading' ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text
                      style={[
                        styles.unlockBtnText,
                        { color: canSubmit ? '#fff' : colors.textSecondary },
                      ]}
                    >
                      Unlock
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleSignInAsDifferent}
                  style={styles.switchAccountBtn}
                  disabled={status === 'loading'}
                >
                  <Text
                    style={[styles.switchAccountText, { color: colors.textSecondary }]}
                  >
                    Sign in with another account
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  safeArea: { flex: 1 },
  keyboardWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  header: { marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  inputIcon: { marginRight: 10 },
  textInput: { flex: 1, fontSize: 16, paddingVertical: 12 },
  readonlyText: { flex: 1, fontSize: 16, paddingVertical: 12 },
  eyeBtn: { padding: 4 },
  errorText: {
    color: '#e74c3c',
    fontSize: 13,
    marginBottom: 10,
    textAlign: 'center',
  },
  unlockBtn: {
    borderRadius: 24,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  unlockBtnText: { fontSize: 16, fontWeight: '700' },
  switchAccountBtn: { marginTop: 16, alignItems: 'center', paddingVertical: 6 },
  switchAccountText: { fontSize: 13, textDecorationLine: 'underline' },
  jobExecutedWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  jobExecutedText: { fontSize: 20, fontWeight: '600', letterSpacing: 0.5 },
});
