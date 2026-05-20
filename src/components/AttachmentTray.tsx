import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../theme/ThemeContext';

const ON_PRIMARY = '#ffffff';
const TRAY_HEIGHT = 132;

interface Props {
  open: boolean;
  onPickGallery: () => void;
  onPickCamera: () => void;
  onPickFile: () => void;
  onStartVoice: () => void;
}

interface ItemProps {
  icon: string;
  label: string;
  bg: string;
  textColor: string;
  onPress: () => void;
}

const TrayItem = ({ icon, label, bg, textColor, onPress }: ItemProps) => (
  <TouchableOpacity
    style={styles.itemWrap}
    activeOpacity={0.7}
    onPress={() => {
      Haptics.selectionAsync().catch(() => {});
      onPress();
    }}
  >
    <View style={[styles.itemSquare, { backgroundColor: bg }]}>
      <Ionicons name={icon as any} size={24} color={ON_PRIMARY} />
    </View>
    <Text style={[styles.itemLabel, { color: textColor }]}>{label}</Text>
  </TouchableOpacity>
);

export const AttachmentTray = ({
  open,
  onPickGallery,
  onPickCamera,
  onPickFile,
  onStartVoice,
}: Props) => {
  const { colors } = useTheme();
  const heightAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      Animated.parallel([
        Animated.spring(heightAnim, { toValue: TRAY_HEIGHT, useNativeDriver: false, friction: 8, tension: 100 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 180, useNativeDriver: false }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(heightAnim, { toValue: 0, duration: 200, useNativeDriver: false }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 140, useNativeDriver: false }),
      ]).start();
    }
  }, [open, heightAnim, opacityAnim]);

  return (
    <Animated.View style={[{ backgroundColor: colors.background, height: heightAnim, overflow: 'hidden' }]}>
      <Animated.View style={[styles.row, { opacity: opacityAnim }]}>
        <TrayItem
          icon="image"
          label="Gallery"
          bg={colors.primary}
          textColor={colors.text}
          onPress={onPickGallery}
        />
        <TrayItem
          icon="camera"
          label="Camera"
          bg={colors.primary}
          textColor={colors.text}
          onPress={onPickCamera}
        />
        <TrayItem
          icon="document-text"
          label="File"
          bg={colors.primary}
          textColor={colors.text}
          onPress={onPickFile}
        />
        <TrayItem
          icon="mic"
          label="Voice"
          bg={colors.primary}
          textColor={colors.text}
          onPress={onStartVoice}
        />
      </Animated.View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  itemWrap: { flex: 1, alignItems: 'center', gap: 8 },
  itemSquare: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: { fontSize: 12, fontWeight: '600' },
});
