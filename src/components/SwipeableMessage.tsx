import React, { useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  PanGestureHandler,
  PanGestureHandlerGestureEvent,
  PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../theme/ThemeContext';

const REPLY_THRESHOLD = 60;
const MAX_TRANSLATE = 90;
const ICON_SIZE = 32;

interface Props {
  children: React.ReactNode;
  isSent: boolean;
  onReply: () => void;
}

export const SwipeableMessage = ({ children, isSent, onReply }: Props) => {
  const { colors } = useTheme();
  const dragX = useRef(new Animated.Value(0)).current;
  const hapticFiredRef = useRef(false);

  const onGestureEvent = Animated.event(
    [{ nativeEvent: { translationX: dragX } }],
    {
      useNativeDriver: true,
      listener: (e: PanGestureHandlerGestureEvent) => {
        const dx = e.nativeEvent.translationX;
        if (!hapticFiredRef.current && dx >= REPLY_THRESHOLD) {
          hapticFiredRef.current = true;
          Haptics.selectionAsync().catch(() => {});
        }
      },
    },
  );

  const onHandlerStateChange = (e: PanGestureHandlerStateChangeEvent) => {
    const s = e.nativeEvent.state;
    if (s === State.END || s === State.CANCELLED || s === State.FAILED) {
      const dx = e.nativeEvent.translationX;
      const triggered = dx >= REPLY_THRESHOLD;
      Animated.spring(dragX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 7,
        tension: 80,
      }).start(() => {
        hapticFiredRef.current = false;
      });
      if (triggered) onReply();
    }
  };

  // Bubble translation — caps at MAX_TRANSLATE with slight resistance past it
  const bubbleTranslateX = dragX.interpolate({
    inputRange: [-1, 0, MAX_TRANSLATE, MAX_TRANSLATE * 3],
    outputRange: [0, 0, MAX_TRANSLATE, MAX_TRANSLATE + 18],
  });

  const iconOpacity = dragX.interpolate({
    inputRange: [0, 20, REPLY_THRESHOLD],
    outputRange: [0, 0.4, 1],
    extrapolate: 'clamp',
  });

  const iconScale = dragX.interpolate({
    inputRange: [0, 20, REPLY_THRESHOLD],
    outputRange: [0.6, 0.8, 1],
    extrapolate: 'clamp',
  });

  return (
    <PanGestureHandler
      onGestureEvent={onGestureEvent}
      onHandlerStateChange={onHandlerStateChange}
      activeOffsetX={[-9999, 10]}
      failOffsetY={[-12, 12]}
    >
      <Animated.View
        style={[
          styles.row,
          { justifyContent: isSent ? 'flex-end' : 'flex-start' },
          { transform: [{ translateX: bubbleTranslateX }] },
        ]}
      >
        <Animated.View
          style={[
            styles.iconWrap,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: iconOpacity,
              transform: [{ scale: iconScale }],
            },
          ]}
        >
          <Ionicons name="arrow-undo" size={14} color={colors.primary} />
        </Animated.View>
        {children}
      </Animated.View>
    </PanGestureHandler>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -ICON_SIZE - 6,
    marginRight: 6,
  },
});
