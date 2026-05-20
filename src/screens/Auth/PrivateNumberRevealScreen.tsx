import React, { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Clipboard } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from '../../utils/secureStorage';
import { useDispatch, useSelector } from 'react-redux';
import { finalizeRegistration } from '../../store/slices/authSlice';
import { CACHED_PRIVATE_NUMBER_KEY } from '../../services/api';
import { RootState, AppDispatch } from '../../store';
import { useTheme } from '../../theme/ThemeContext';

const fmt = (n: string) => `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6, 10)}`;

const BULLETS = [
  'Share this number with friends to connect with you.',
  'Use this number and your login password to sign back in.',
];

export const PrivateNumberRevealScreen = () => {
  const { colors, isDark } = useTheme();
  const dispatch = useDispatch<AppDispatch>();
  const raw = useSelector((s: RootState) => s.auth.pendingRegistration?.user.private_number ?? '');
  const displayed = raw ? fmt(raw) : '—';

  // Belt-and-suspenders: cache the private number as soon as this screen
  // mounts, so it survives even if the user force-quits before tapping
  // "Go to App". registerThunk already caches on success, but this ensures
  // LoginScreen's auto-fill works even in crash-loop scenarios.
  useEffect(() => {
    if (raw && /^\d{10}$/.test(raw)) {
      SecureStore.setItemAsync(CACHED_PRIVATE_NUMBER_KEY, raw).catch(() => {
        /* ignore — non-critical */
      });
    }
  }, [raw]);

  const handleCopy = () => {
    Clipboard.setString(raw);
  };

  const handleGoToApp = () => {
    dispatch(finalizeRegistration());
    // isAuthenticated becomes true → RootNavigator switches to MainStack automatically
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.inner}>
        {/* Shield icon */}
        <View style={[styles.shieldWrap, { backgroundColor: colors.surface }]}>
          <Ionicons name="shield-checkmark" size={56} color={colors.primary} />
        </View>

        {/* Number */}
        <Text style={[styles.numberLabel, { color: colors.textSecondary }]}>Your Private Number</Text>
        <View style={styles.numberRow}>
          <Text style={[styles.number, { color: colors.text }]}>{displayed}</Text>
          <TouchableOpacity
            onPress={handleCopy}
            style={[styles.copyBtn, { backgroundColor: colors.surface }]}
            activeOpacity={0.7}
          >
            <Ionicons name="copy-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          This is your secure identity. Write it down — it cannot be recovered if lost.
        </Text>

        {/* Bullets */}
        <View style={styles.bullets}>
          {BULLETS.map((text, i) => (
            <View key={i} style={styles.bulletRow}>
              <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
              <Text style={[styles.bulletText, { color: colors.textSecondary }]}>{text}</Text>
            </View>
          ))}
        </View>

        <Text style={[styles.tagline, { color: colors.text }]}>
          We're focused on maximum protection.
        </Text>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          activeOpacity={0.85}
          onPress={handleGoToApp}
        >
          <Text style={styles.primaryBtnText}>Go to App</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.inviteBtn}>
          <Text style={[styles.inviteBtnText, { color: colors.primary }]}>Invite Friends to Connect</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 24 },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  shieldWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberLabel: { fontSize: 13, letterSpacing: 0.5, marginTop: 8 },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  number: { fontSize: 32, fontWeight: '800', letterSpacing: 1 },
  copyBtn: { padding: 10, borderRadius: 10 },
  subtitle: { fontSize: 15, textAlign: 'center', lineHeight: 22, paddingHorizontal: 16 },
  bullets: { alignSelf: 'stretch', gap: 12 },
  bulletRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bulletText: { fontSize: 14, lineHeight: 20, flex: 1 },
  tagline: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  actions: { paddingBottom: 16, gap: 4 },
  primaryBtn: { borderRadius: 28, paddingVertical: 18, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  inviteBtn: { paddingVertical: 14, alignItems: 'center' },
  inviteBtnText: { fontSize: 15, fontWeight: '600' },
});
