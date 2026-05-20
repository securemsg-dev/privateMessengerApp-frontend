import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../../theme/ThemeContext';

const ON_PRIMARY = '#ffffff';

export const WelcomeScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <Animated.View
        style={[
          styles.inner,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* ── Kicker ─────────────────────────────────────────────────── */}
        <Text style={[styles.kicker, { color: colors.textSecondary }]}>
          {'PRIVATE MESSENGER  ·  V1.0'}
        </Text>

        {/* ── Branding ───────────────────────────────────────────────── */}
        <View style={styles.brandBlock}>
          <View style={[styles.logoCircle, { backgroundColor: colors.surface }]}>
            <Ionicons name="shield-checkmark" size={52} color={colors.primary} />
          </View>
          <Text style={[styles.appName, { color: colors.text }]}>PrivaChat</Text>
          <Text style={[styles.tagline, { color: colors.textSecondary }]}>
            Be Private. Be Secure.
          </Text>
        </View>

        {/* ── Headline copy ──────────────────────────────────────────── */}
        <View style={styles.copyBlock}>
          <Text style={[styles.headline, { color: colors.text }]}>
            {'Messaging\nwithout identity.'}
          </Text>
          <Text style={[styles.sub, { color: colors.textSecondary }]}>
            Sign up with nothing. Get a 10-digit private number. Give it to people you trust.
          </Text>
        </View>

        {/* ── Actions ────────────────────────────────────────────────── */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[
              styles.primaryBtn,
              { backgroundColor: colors.primary },
              Platform.select({
                ios: {
                  shadowColor: colors.primary,
                  shadowOffset: { width: 0, height: 6 },
                  shadowOpacity: 0.3,
                  shadowRadius: 12,
                },
                android: { elevation: 6 },
              }),
            ]}
            activeOpacity={0.82}
            onPress={() => navigation.navigate('SetPassword')}
          >
            <Text style={styles.primaryLabel}>Create a private number</Text>
            <Ionicons name="arrow-forward" size={20} color={ON_PRIMARY} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.secondaryBtn,
              {
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
            activeOpacity={0.82}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={[styles.secondaryLabel, { color: colors.text }]}>
              I already have a number
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 20,
  },

  // Kicker
  kicker: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2,
    marginBottom: 32,
  },

  // Brand block
  brandBlock: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logoCircle: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  appName: {
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  tagline: {
    fontSize: 16,
  },

  // Copy
  copyBlock: {
    flex: 1,
  },
  headline: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 41,
    marginBottom: 14,
  },
  sub: {
    fontSize: 15,
    lineHeight: 22,
  },

  // Buttons
  actions: {
    marginTop: 8,
  },
  primaryBtn: {
    borderRadius: 28,
    paddingVertical: 17,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  primaryLabel: {
    color: ON_PRIMARY,
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    borderRadius: 28,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  secondaryLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
