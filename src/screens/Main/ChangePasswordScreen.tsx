import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { RootState } from '../../store';
import { useTheme } from '../../theme/ThemeContext';
import {
  ApiError,
  changePasswordApi,
  CACHED_PRIVATE_NUMBER_KEY,
  REFRESH_TOKEN_KEY,
} from '../../services/api';
import { deriveKeyMaterial, wrapSecretKey } from '../../services/keyRecovery';
import { getKeyPair } from '../../services/crypto';
import * as SecureStore from '../../utils/secureStorage';

const MIN_PASSWORD_LEN = 8;

export const ChangePasswordScreen = () => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const refreshTokenFromStore = useSelector((s: RootState) => s.auth.refreshToken);
  const privateNumberFromStore = useSelector((s: RootState) => s.auth.privateNumber);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= MIN_PASSWORD_LEN &&
    confirmPassword.length > 0 &&
    !busy;

  const handleSubmit = async () => {
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t('changePassword.errorMismatch'));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t('changePassword.errorSameAsCurrent'));
      return;
    }
    setBusy(true);
    try {
      // Send our own refresh token so this device's session survives the
      // server-side invalidation of all other sessions.
      const refreshToken =
        refreshTokenFromStore ?? (await SecureStore.getItemAsync(REFRESH_TOKEN_KEY));
      const privateNumber =
        privateNumberFromStore ??
        (await SecureStore.getItemAsync(CACHED_PRIVATE_NUMBER_KEY)) ??
        '';
      // Derive verifiers for both passwords and re-wrap the SAME E2EE key under
      // the new password's wrap key, so history still decrypts afterwards.
      const currentMat = await deriveKeyMaterial(currentPassword, privateNumber);
      const newMat = await deriveKeyMaterial(newPassword, privateNumber);
      const keyPair = await getKeyPair();
      const encryptedKeyBackup = wrapSecretKey(keyPair.secretKey, newMat.wrapKey);
      await changePasswordApi({
        current_password: currentMat.authVerifier,
        new_password: newMat.authVerifier,
        encrypted_key_backup: encryptedKeyBackup,
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
      });
      Alert.alert(t('changePassword.successTitle'), t('changePassword.successBody'), [
        { text: t('common.ok'), onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 403) {
        setError(t('changePassword.errorWrongCurrent'));
      } else {
        setError(err?.detail || err?.message || t('changePassword.errorGeneric'));
      }
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [
    styles.input,
    { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('changePassword.title')}</Text>
          <View style={{ width: 24 }} />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {t('changePassword.hint')}
          </Text>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.primary }]}>{t('changePassword.currentPassword')}</Text>
            <TextInput
              style={inputStyle}
              secureTextEntry
              autoCapitalize="none"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder={t('changePassword.currentPlaceholder')}
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.primary }]}>{t('changePassword.newPassword')}</Text>
            <TextInput
              style={inputStyle}
              secureTextEntry
              autoCapitalize="none"
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder={t('changePassword.newPlaceholder', { min: MIN_PASSWORD_LEN })}
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={[styles.fieldLabel, { color: colors.primary }]}>{t('changePassword.confirmPassword')}</Text>
            <TextInput
              style={inputStyle}
              secureTextEntry
              autoCapitalize="none"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder={t('changePassword.confirmPlaceholder')}
              placeholderTextColor={colors.textSecondary}
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity
            style={[
              styles.submitBtn,
              { backgroundColor: colors.primary, opacity: canSubmit ? 1 : 0.5 },
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitBtnText}>{t('changePassword.submit')}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  scrollContent: { padding: 24, gap: 20 },
  hint: { fontSize: 13, lineHeight: 18 },
  fieldGroup: { gap: 8 },
  fieldLabel: { fontSize: 14, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  errorText: { fontSize: 13, color: '#e74c3c' },
  submitBtn: {
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  submitBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
