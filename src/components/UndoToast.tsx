import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';

interface Props {
  visible: boolean;
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}

export const UndoToast = ({ visible, message, onUndo, onDismiss }: Props) => {
  const { colors } = useTheme();
  const translateY = useRef(new Animated.Value(80)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          friction: 8,
          tension: 80,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 80,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible, translateY, opacity]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.wrap,
        { transform: [{ translateY }], opacity },
      ]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.toast,
          { backgroundColor: colors.text },
        ]}
      >
        <Ionicons name="checkmark-circle-outline" size={18} color={colors.background} />
        <Text style={[styles.message, { color: colors.background }]} numberOfLines={1}>
          {message}
        </Text>
        <Pressable
          onPress={onUndo}
          hitSlop={8}
          style={({ pressed }) => [styles.undoBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={[styles.undoLabel, { color: colors.primary }]}>UNDO</Text>
        </Pressable>
        <Pressable onPress={onDismiss} hitSlop={8} style={styles.closeBtn}>
          <Ionicons name="close" size={18} color={colors.background} />
        </Pressable>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  message: { flex: 1, fontSize: 14, fontWeight: '500' },
  undoBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  undoLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  closeBtn: { padding: 2 },
});
