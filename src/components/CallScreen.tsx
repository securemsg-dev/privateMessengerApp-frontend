import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../theme/ThemeContext';
import { CallMode } from './CallProvider';

const ON_PRIMARY = '#ffffff';
const DECLINE_BG = '#dc3545';
const ACCEPT_BG = '#22b573';

interface Props {
  mode: Exclude<CallMode, 'incoming-banner'>;
  contactName: string;
  contactNumber: string;
  startedAt: number;
  onAccept: () => void;
  onDecline: () => void;
  onEnd: () => void;
}

const formatPrivateNumber = (n: string) => {
  if (!n || n.length !== 10) return '';
  return `${n.slice(0, 2)} · ${n.slice(2, 6)} · ${n.slice(6, 10)}`;
};

const formatDuration = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const getInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

/* Pulsing ring — three offset copies create a continuous "calling" pulse. */
const PulsingRings = ({ color }: { color: string }) => {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;
  const c = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, {
            toValue: 1,
            duration: 1800,
            useNativeDriver: true,
          }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const loops = [make(a, 0), make(b, 600), make(c, 1200)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [a, b, c]);

  const ringStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.5, 0] }),
    transform: [
      {
        scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }),
      },
    ],
  });

  return (
    <>
      <Animated.View style={[styles.ring, { borderColor: color }, ringStyle(a)]} />
      <Animated.View style={[styles.ring, { borderColor: color }, ringStyle(b)]} />
      <Animated.View style={[styles.ring, { borderColor: color }, ringStyle(c)]} />
    </>
  );
};

const ControlButton = ({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) => (
  <Pressable
    onPress={() => {
      Haptics.selectionAsync().catch(() => {});
      onPress();
    }}
    style={({ pressed }) => [styles.ctrlWrap, pressed && { opacity: 0.7 }]}
  >
    <View
      style={[
        styles.ctrlBtn,
        {
          backgroundColor: active
            ? 'rgba(255,255,255,0.95)'
            : 'rgba(255,255,255,0.18)',
        },
      ]}
    >
      <Ionicons
        name={icon as any}
        size={22}
        color={active ? '#0a0a0a' : ON_PRIMARY}
      />
    </View>
    <Text style={styles.ctrlLabel}>{label}</Text>
  </Pressable>
);

export const CallScreen = ({
  mode,
  contactName,
  contactNumber,
  startedAt,
  onAccept,
  onDecline,
  onEnd,
}: Props) => {
  const { colors } = useTheme();
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [audioMode, setAudioMode] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // Tick the connected-call timer every second
  useEffect(() => {
    if (mode !== 'connected') {
      setSeconds(0);
      return;
    }
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [mode, startedAt]);

  const isIncoming = mode === 'incoming-fullscreen';
  const isOutgoing = mode === 'outgoing';
  const isConnected = mode === 'connected';

  const statusLabel = isIncoming
    ? 'INCOMING PRIVATE CALL'
    : isOutgoing
    ? 'PRIVATE CALL'
    : 'PRIVATE CALL · END-TO-END ENCRYPTED';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onEnd}>
      <View style={[styles.root, { backgroundColor: colors.primary }]}>
        <StatusBar style="light" />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {/* Top label */}
          <Text style={styles.kicker}>{statusLabel}</Text>

          {/* Avatar block */}
          <View style={styles.avatarBlock}>
            <View style={styles.avatarRingHost}>
              {(isOutgoing || isIncoming) && (
                <PulsingRings color="rgba(255,255,255,0.55)" />
              )}
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{getInitials(contactName)}</Text>
              </View>
            </View>

            <Text style={styles.name} numberOfLines={1}>
              {contactName}
            </Text>

            {isConnected ? (
              <View style={styles.connectedRow}>
                <View style={styles.connectedDot} />
                <Text style={styles.connectedText}>
                  CONNECTED  ·  {formatDuration(seconds)}
                </Text>
              </View>
            ) : (
              <Text style={styles.subline}>
                {formatPrivateNumber(contactNumber) || 'Calling…'}
              </Text>
            )}

            {isConnected && (
              <View style={styles.encryptionPill}>
                <Ionicons name="lock-closed" size={11} color={ON_PRIMARY} />
                <Text style={styles.encryptionText}>End-to-end encrypted</Text>
              </View>
            )}
          </View>

          {/* Controls — only when connected */}
          {isConnected && (
            <View style={styles.controlsRow}>
              <ControlButton
                icon={muted ? 'mic-off' : 'mic-off-outline'}
                label="Mute"
                active={muted}
                onPress={() => setMuted((v) => !v)}
              />
              <ControlButton
                icon={speaker ? 'volume-high' : 'volume-high-outline'}
                label="Speaker"
                active={speaker}
                onPress={() => setSpeaker((v) => !v)}
              />
              <ControlButton
                icon={audioMode ? 'headset' : 'headset-outline'}
                label="Audio"
                active={audioMode}
                onPress={() => setAudioMode((v) => !v)}
              />
            </View>
          )}

          {/* Bottom action area */}
          <View style={styles.bottomArea}>
            {isIncoming ? (
              <View style={styles.dualBtnRow}>
                <View style={styles.dualBtnCol}>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                      onDecline();
                    }}
                    style={({ pressed }) => [
                      styles.bigCallBtn,
                      { backgroundColor: DECLINE_BG, opacity: pressed ? 0.85 : 1 },
                    ]}
                  >
                    <Ionicons name="call" size={28} color={ON_PRIMARY} style={{ transform: [{ rotate: '135deg' }] }} />
                  </Pressable>
                  <Text style={styles.bigBtnLabel}>Decline</Text>
                </View>
                <View style={styles.dualBtnCol}>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
                      onAccept();
                    }}
                    style={({ pressed }) => [
                      styles.bigCallBtn,
                      { backgroundColor: ACCEPT_BG, opacity: pressed ? 0.85 : 1 },
                    ]}
                  >
                    <Ionicons name="call" size={28} color={ON_PRIMARY} />
                  </Pressable>
                  <Text style={styles.bigBtnLabel}>Accept</Text>
                </View>
              </View>
            ) : (
              <View style={styles.singleBtnCol}>
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
                    onEnd();
                  }}
                  style={({ pressed }) => [
                    styles.bigCallBtn,
                    { backgroundColor: DECLINE_BG, opacity: pressed ? 0.85 : 1 },
                  ]}
                >
                  <Ionicons
                    name="call"
                    size={28}
                    color={ON_PRIMARY}
                    style={{ transform: [{ rotate: '135deg' }] }}
                  />
                </Pressable>
                <Text style={styles.bigBtnLabel}>
                  {isOutgoing ? 'End call' : 'End call'}
                </Text>
                {isOutgoing && (
                  <Text style={styles.dialingText}>Calling…</Text>
                )}
              </View>
            )}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const RING_BASE = 96;
const AVATAR_SIZE = 132;

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: 24, justifyContent: 'space-between' },

  kicker: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
    marginTop: 12,
  },

  /* Avatar */
  avatarBlock: { alignItems: 'center', marginTop: 32 },
  avatarRingHost: {
    width: AVATAR_SIZE + 100,
    height: AVATAR_SIZE + 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  ring: {
    position: 'absolute',
    width: RING_BASE,
    height: RING_BASE,
    borderRadius: RING_BASE / 2,
    borderWidth: 1.5,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: ON_PRIMARY, fontSize: 36, fontWeight: '700' },
  name: { color: ON_PRIMARY, fontSize: 28, fontWeight: '700', marginBottom: 6 },
  subline: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  connectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  connectedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: ACCEPT_BG,
  },
  connectedText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  encryptionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    marginTop: 12,
  },
  encryptionText: {
    color: ON_PRIMARY,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },

  /* Controls */
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    marginVertical: 12,
  },
  ctrlWrap: { alignItems: 'center', gap: 6 },
  ctrlBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlLabel: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '500',
  },

  /* Bottom buttons */
  bottomArea: { alignItems: 'center', marginBottom: 12 },
  dualBtnRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  dualBtnCol: { alignItems: 'center', gap: 10 },
  singleBtnCol: { alignItems: 'center', gap: 10 },
  bigCallBtn: {
    width: 72,
    height: 72,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigBtnLabel: { color: ON_PRIMARY, fontSize: 13, fontWeight: '600' },
  dialingText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginTop: 4,
  },
});
