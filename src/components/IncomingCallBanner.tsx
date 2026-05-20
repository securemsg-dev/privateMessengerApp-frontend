import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../theme/ThemeContext';

const SCREEN_WIDTH = Dimensions.get('window').width;
const ON_PRIMARY = '#ffffff';
const DECLINE_BG = '#dc3545';
const ACCEPT_BG = '#22b573';

interface Props {
  contactName: string;
  contactNumber: string;
  onAccept: () => void;
  onDecline: () => void;
  onExpand: () => void;
}

const formatPrivateNumber = (n: string) => {
  if (!n || n.length !== 10) return '';
  return `${n.slice(0, 2)}·${n.slice(2, 6)}·${n.slice(6, 10)}`;
};

const getInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

const TOP_INSET = Platform.OS === 'ios' ? 54 : 28;
const BANNER_HEIGHT = 80;

export const IncomingCallBanner = ({
  contactName,
  contactNumber,
  onAccept,
  onDecline,
  onExpand,
}: Props) => {
  const { colors } = useTheme();
  const slideY = useRef(new Animated.Value(-(BANNER_HEIGHT + TOP_INSET))).current;

  useEffect(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    Animated.spring(slideY, {
      toValue: 0,
      useNativeDriver: true,
      friction: 8,
      tension: 70,
    }).start();
  }, [slideY]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { transform: [{ translateY: slideY }] },
      ]}
    >
      <Pressable
        onPress={() => {
          Haptics.selectionAsync().catch(() => {});
          onExpand();
        }}
        style={[
          styles.banner,
          {
            backgroundColor: colors.primary,
            paddingTop: TOP_INSET,
          },
        ]}
      >
        <View style={styles.bannerInner}>
          {/* Avatar */}
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials(contactName)}</Text>
          </View>

          {/* Name + label */}
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>INCOMING PRIVATE CALL</Text>
            <Text style={styles.name} numberOfLines={1}>
              {contactName}
            </Text>
            <Text style={styles.number} numberOfLines={1}>
              {formatPrivateNumber(contactNumber)}
            </Text>
          </View>

          {/* Decline */}
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              onDecline();
            }}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: DECLINE_BG, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons
              name="call"
              size={20}
              color={ON_PRIMARY}
              style={{ transform: [{ rotate: '135deg' }] }}
            />
          </Pressable>

          {/* Accept */}
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
              onAccept();
            }}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: ACCEPT_BG, opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="call" size={20} color={ON_PRIMARY} />
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
    width: SCREEN_WIDTH,
    zIndex: 9999,
    elevation: 12,
  },
  banner: {
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    paddingHorizontal: 14,
    paddingBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
  },
  bannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: BANNER_HEIGHT - 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: ON_PRIMARY, fontSize: 14, fontWeight: '700' },
  label: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 1,
  },
  name: { color: ON_PRIMARY, fontSize: 15, fontWeight: '700' },
  number: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
