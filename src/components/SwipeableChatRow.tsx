import React, { useRef } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';

const SCREEN_WIDTH = Dimensions.get('window').width;
const ACTION_WIDTH = 80;
const ACTIONS_TOTAL = ACTION_WIDTH * 2; // 160 — both buttons per side
const FULL_SWIPE_THRESHOLD = SCREEN_WIDTH * 0.8;
const REVEAL_HAPTIC_AT = 30;

const ON_PRIMARY = '#ffffff';

// Action button colors — solid fills picked to read on white + dark backgrounds.
// Kept on-brand: blue (Pin), muted blue-grey (Unread), slate (Mute), red (Delete).
const ACTION_BG = {
  pin: '#0088cc',
  unread: '#5d7c8c',
  mute: '#6e7884',
  delete: '#dc3545',
};

interface Props {
  children: React.ReactNode;
  isPinned: boolean;
  isMuted: boolean;
  hasUnread: boolean;
  onPin: () => void;
  onUnread: () => void;
  onMute: () => void;
  onDelete: () => void;
  rowBg: string;
}

export const SwipeableChatRow = ({
  children,
  isPinned,
  isMuted,
  hasUnread,
  onPin,
  onUnread,
  onMute,
  onDelete,
  rowBg,
}: Props) => {
  const dragX = useRef(new Animated.Value(0)).current;
  const lightHapticRef = useRef(false);
  const mediumHapticRef = useRef(false);

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: dragX } }],
    {
      useNativeDriver: true,
      listener: (e: PanGestureHandlerGestureEvent) => {
        const dx = e.nativeEvent.translationX;
        const absDx = Math.abs(dx);
        if (!lightHapticRef.current && absDx > REVEAL_HAPTIC_AT) {
          lightHapticRef.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        if (!mediumHapticRef.current && absDx > FULL_SWIPE_THRESHOLD) {
          mediumHapticRef.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        }
      },
    },
  );

  const snapTo = (toValue: number) => {
    Animated.spring(dragX, {
      toValue,
      useNativeDriver: true,
      friction: 8,
      tension: 80,
    }).start();
  };

  const animateOff = (toValue: number, then?: () => void) => {
    Animated.timing(dragX, {
      toValue,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      then?.();
    });
  };

  const close = () => snapTo(0);

  const onHandlerStateChange = (e: PanGestureHandlerStateChangeEvent) => {
    const s = e.nativeEvent.state;
    if (s === State.END || s === State.CANCELLED || s === State.FAILED) {
      const dx = e.nativeEvent.translationX;
      const absDx = Math.abs(dx);
      lightHapticRef.current = false;
      mediumHapticRef.current = false;

      if (absDx > FULL_SWIPE_THRESHOLD) {
        if (dx < 0) {
          // Full-swipe LEFT → Delete (animate off the left edge, then fire)
          animateOff(-SCREEN_WIDTH, () => {
            onDelete();
            // Caller is responsible for removing this row from data; if it stays,
            // reset for next gesture
            dragX.setValue(0);
          });
        } else {
          // Full-swipe RIGHT → Pin (animate off the right edge, then fire + reset)
          animateOff(SCREEN_WIDTH, () => {
            onPin();
            dragX.setValue(0);
          });
        }
      } else if (absDx > ACTIONS_TOTAL / 2) {
        // Snap fully open in the swipe direction
        snapTo(dx < 0 ? -ACTIONS_TOTAL : ACTIONS_TOTAL);
      } else {
        snapTo(0);
      }
    }
  };

  const ActionButton = ({
    icon,
    label,
    bg,
    onPress,
  }: {
    icon: string;
    label: string;
    bg: string;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
        close();
      }}
      style={({ pressed }) => [
        styles.actionBtn,
        { backgroundColor: bg, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Ionicons name={icon as any} size={20} color={ON_PRIMARY} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      {/* Left-side actions — revealed on RIGHT swipe (Pin · Unread) */}
      <View style={styles.leftActions} pointerEvents="box-none">
        <ActionButton
          icon={isPinned ? 'pin' : 'pin-outline'}
          label={isPinned ? 'Unpin' : 'Pin'}
          bg={ACTION_BG.pin}
          onPress={onPin}
        />
        <ActionButton
          icon={hasUnread ? 'mail-open-outline' : 'ellipse'}
          label={hasUnread ? 'Read' : 'Unread'}
          bg={ACTION_BG.unread}
          onPress={onUnread}
        />
      </View>

      {/* Right-side actions — revealed on LEFT swipe (Mute · Delete) */}
      <View style={styles.rightActions} pointerEvents="box-none">
        <ActionButton
          icon={isMuted ? 'notifications-outline' : 'notifications-off-outline'}
          label={isMuted ? 'Unmute' : 'Mute'}
          bg={ACTION_BG.mute}
          onPress={onMute}
        />
        <ActionButton
          icon="trash-outline"
          label="Delete"
          bg={ACTION_BG.delete}
          onPress={onDelete}
        />
      </View>

      {/* Sliding row content — covers the actions when at rest */}
      <PanGestureHandler
        onGestureEvent={onGestureEvent}
        onHandlerStateChange={onHandlerStateChange}
        activeOffsetX={[-15, 15]}
        failOffsetY={[-15, 15]}
      >
        <Animated.View
          style={[
            { backgroundColor: rowBg },
            { transform: [{ translateX: dragX }] },
          ]}
        >
          {children}
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { position: 'relative', overflow: 'hidden' },
  leftActions: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  rightActions: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  actionBtn: {
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  actionLabel: { color: ON_PRIMARY, fontSize: 12, fontWeight: '600' },
});
