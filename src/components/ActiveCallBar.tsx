/**
 * components/ActiveCallBar.tsx
 * ─────────────────────────────
 * The compact "call is still running" strip shown after the user minimises the
 * full-screen call UI. Tapping it restores the call screen; the red button ends
 * the call without having to go back first.
 *
 * Rendered by CallProvider above the navigator, so it stays put while the user
 * moves around the app — reading a chat, sending a message — mid-call.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../theme/ThemeContext';
import { CallMode } from './CallProvider';

const ON_PRIMARY = '#ffffff';
const DECLINE_BG = '#dc3545';
const ACCEPT_BG = '#22b573';

const TOP_INSET = Platform.OS === 'ios' ? 54 : 28;
const BAR_HEIGHT = 44;

/** Total height the bar occupies — CallProvider pads content down by this. */
export const ACTIVE_CALL_BAR_HEIGHT = TOP_INSET + BAR_HEIGHT;

interface Props {
  mode: Exclude<CallMode, 'incoming-banner' | 'incoming-fullscreen'>;
  contactName: string;
  /** When the call connected; only meaningful in `connected` mode. */
  startedAt: number;
  muted: boolean;
  onRestore: () => void;
  onEnd: () => void;
}

const formatDuration = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const ActiveCallBar = ({
  mode,
  contactName,
  startedAt,
  muted,
  onRestore,
  onEnd,
}: Props) => {
  const { colors } = useTheme();
  const [seconds, setSeconds] = useState(0);
  const slideY = useRef(new Animated.Value(-ACTIVE_CALL_BAR_HEIGHT)).current;

  useEffect(() => {
    Animated.spring(slideY, {
      toValue: 0,
      useNativeDriver: true,
      friction: 9,
      tension: 80,
    }).start();
  }, [slideY]);

  useEffect(() => {
    if (mode !== 'connected') {
      setSeconds(0);
      return;
    }
    // Derive from startedAt rather than incrementing, so the timer stays
    // correct across the JS timer throttling that happens in the background.
    const tick = () => setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [mode, startedAt]);

  const status =
    mode === 'connected'
      ? formatDuration(seconds)
      : mode === 'connecting'
      ? 'Connecting…'
      : 'Calling…';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { transform: [{ translateY: slideY }] }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Return to call with ${contactName}`}
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onRestore();
        }}
        style={({ pressed }) => [
          styles.bar,
          {
            backgroundColor: colors.primary,
            paddingTop: TOP_INSET,
            opacity: pressed ? 0.92 : 1,
          },
        ]}
      >
        <View style={styles.inner}>
          <View
            style={[
              styles.dot,
              { backgroundColor: mode === 'connected' ? ACCEPT_BG : 'rgba(255,255,255,0.6)' },
            ]}
          />

          <Text style={styles.name} numberOfLines={1}>
            {contactName}
          </Text>

          {muted && (
            <Ionicons name="mic-off" size={13} color="rgba(255,255,255,0.85)" />
          )}

          <Text style={styles.status}>{status}</Text>

          <View style={{ flex: 1 }} />

          <Text style={styles.tapHint}>Tap to return</Text>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="End call"
            hitSlop={8}
            onPress={(e) => {
              e.stopPropagation();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              onEnd();
            }}
            style={({ pressed }) => [
              styles.endBtn,
              { backgroundColor: DECLINE_BG, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons
              name="call"
              size={15}
              color={ON_PRIMARY}
              style={{ transform: [{ rotate: '135deg' }] }}
            />
          </Pressable>
        </View>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9998, // just under IncomingCallBanner (9999)
    elevation: 11,
  },
  bar: {
    paddingHorizontal: 14,
    paddingBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: BAR_HEIGHT - 8,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  name: {
    color: ON_PRIMARY,
    fontSize: 13,
    fontWeight: '700',
    maxWidth: 130,
  },
  status: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  tapHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  endBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
