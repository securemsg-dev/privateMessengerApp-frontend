import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from '../../utils/secureStorage';
import { useDispatch, useSelector } from 'react-redux';
import {
  confirmDeleteFromLoginThunk,
  loginThunk,
} from '../../store/slices/authSlice';
import { CACHED_PRIVATE_NUMBER_KEY } from '../../services/api';
import { RootState, AppDispatch } from '../../store';
import { useTheme } from '../../theme/ThemeContext';

/** Format a partial 10-digit string as XX-XXXX-XXXX while typing. */
function formatPartial(digits: string): string {
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
}

export const LoginScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const dispatch = useDispatch<AppDispatch>();
  const status = useSelector((s: RootState) => s.auth.status);
  const serverError = useSelector((s: RootState) => s.auth.error);

  const [rawDigits, setRawDigits] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const canSubmit = rawDigits.length === 10 && password.length >= 8 && status !== 'loading';

  // Pre-fill the private number field from SecureStore cache on mount.
  // Populated after a successful registration or login; cleared only after a
  // successful delete-from-login flow.
  useEffect(() => {
    (async () => {
      try {
        const cached = await SecureStore.getItemAsync(CACHED_PRIVATE_NUMBER_KEY);
        if (cached && /^\d{10}$/.test(cached)) {
          setRawDigits(cached);
        }
      } catch {
        /* SecureStore unavailable — ignore and leave field empty */
      }
    })();
  }, []);

  const handleChangeNumber = (text: string) => {
    // Strip everything that isn't a digit and cap at 10
    const digits = text.replace(/\D/g, '').slice(0, 10);
    setRawDigits(digits);
  };

  const promptDeleteConfirm = (deleteToken: string) => {
    Alert.alert(
      'Permanently delete account?',
      'This will wipe your chat history, contacts, and account from this device and our servers. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, delete',
          style: 'destructive',
          onPress: async () => {
            const r = await dispatch(confirmDeleteFromLoginThunk({ deleteToken }));
            if (confirmDeleteFromLoginThunk.fulfilled.match(r)) {
              setRawDigits('');
              setPassword('');
              Alert.alert('Account deleted', 'Your account has been permanently removed.');
            } else {
              Alert.alert(
                'Deletion failed',
                (r.payload as string | undefined) ?? 'Please try again.',
              );
            }
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleSignIn = async () => {
    if (!canSubmit) return;
    const result = await dispatch(
      loginThunk({ privateNumber: rawDigits, loginPassword: password }),
    );
    if (loginThunk.fulfilled.match(result) && result.payload.kind === 'deleteIntent') {
      promptDeleteConfirm(result.payload.deleteToken);
    }
    // 'authenticated' → RootNavigator switches to MainStack automatically.
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </TouchableOpacity>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Sign In</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Enter your private number and password.
          </Text>
        </View>

        {/* Private number input */}
        <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="keypad-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
          <TextInput
            style={[styles.textInput, { color: colors.text }]}
            placeholder="XX-XXXX-XXXX"
            placeholderTextColor={colors.textSecondary}
            keyboardType="number-pad"
            value={formatPartial(rawDigits)}
            onChangeText={handleChangeNumber}
            maxLength={12} // 10 digits + 2 hyphens
          />
        </View>

        {/* Password input */}
        <View style={[styles.inputWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} style={styles.inputIcon} />
          <TextInput
            style={[styles.textInput, { color: colors.text }]}
            placeholder="Password"
            placeholderTextColor={colors.textSecondary}
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
          />
          <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
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
            styles.signInBtn,
            { backgroundColor: canSubmit ? colors.primary : colors.border },
          ]}
          onPress={handleSignIn}
          activeOpacity={0.85}
          disabled={!canSubmit}
        >
          {status === 'loading' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.signInBtnText, { color: canSubmit ? '#fff' : colors.textSecondary }]}>
              Sign In
            </Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  backBtn: { padding: 16 },
  inner: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  header: { marginBottom: 32 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 10 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  inputIcon: { marginRight: 10 },
  textInput: { flex: 1, fontSize: 16, paddingVertical: 14 },
  eyeBtn: { padding: 4 },
  errorText: { color: '#e74c3c', fontSize: 14, marginBottom: 12, textAlign: 'center' },
  signInBtn: { borderRadius: 28, paddingVertical: 18, alignItems: 'center', marginTop: 8 },
  signInBtnText: { fontSize: 17, fontWeight: '700' },
});
