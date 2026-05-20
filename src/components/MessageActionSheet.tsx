import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../theme/ThemeContext';
import { Message } from '../store/slices/chatSlice';

export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const ON_PRIMARY = '#ffffff';

export interface BubbleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  visible: boolean;
  message: Message | null;
  rect: BubbleRect | null;
  isSent: boolean;
  isDark: boolean;
  onDismiss: () => void;
  onReply: () => void;
  onCopy: () => void;
  onForward: () => void;
  onStar: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
}

interface MenuItemProps {
  icon: string;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

export const MessageActionSheet = ({
  visible,
  message,
  rect,
  isSent,
  isDark,
  onDismiss,
  onReply,
  onCopy,
  onForward,
  onStar,
  onDelete,
  onReact,
}: Props) => {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const bubbleScale = useRef(new Animated.Value(1)).current;
  const reactionScale = useRef(new Animated.Value(0.6)).current;
  const menuTranslate = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(bubbleScale, {
          toValue: 1.04,
          useNativeDriver: true,
          friction: 6,
          tension: 80,
        }),
        Animated.spring(reactionScale, {
          toValue: 1,
          useNativeDriver: true,
          friction: 6,
          tension: 80,
        }),
        Animated.spring(menuTranslate, {
          toValue: 0,
          useNativeDriver: true,
          friction: 7,
          tension: 80,
        }),
      ]).start();
    } else {
      opacity.setValue(0);
      bubbleScale.setValue(1);
      reactionScale.setValue(0.6);
      menuTranslate.setValue(16);
    }
  }, [visible, opacity, bubbleScale, reactionScale, menuTranslate]);

  if (!visible || !message || !rect) return null;

  const bubbleColor = isSent ? colors.primary : colors.surface;
  const textColor = isSent ? ON_PRIMARY : colors.text;

  const isText = message.type === 'text';
  const isMedia = message.type === 'image' || message.type === 'video';

  const renderClone = () => {
    if (message.type === 'image' && message.mediaUri) {
      return (
        <Image
          source={{ uri: message.mediaUri }}
          style={[styles.cloneMedia, { width: rect.width - 8, height: (rect.width - 8) * 0.75 }]}
          resizeMode="cover"
        />
      );
    }
    if (message.type === 'video' && message.mediaUri) {
      return (
        <View>
          <Image
            source={{ uri: message.mediaUri }}
            style={[styles.cloneMedia, { width: rect.width - 8, height: (rect.width - 8) * 0.75 }]}
            resizeMode="cover"
          />
          <View style={styles.cloneVideoOverlay}>
            <Ionicons name="play-circle" size={36} color="rgba(255,255,255,0.9)" />
          </View>
        </View>
      );
    }
    if (message.type === 'voice') {
      return (
        <Text style={[styles.cloneText, { color: textColor }]}>
          🎤 {message.content.match(/Voice message \([^)]+\)/)?.[0] || 'Voice message'}
        </Text>
      );
    }
    return <Text style={[styles.cloneText, { color: textColor }]}>{message.content}</Text>;
  };

  const renderMenuItem = ({ icon, label, onPress, destructive }: MenuItemProps) => (
    <Pressable
      style={({ pressed }) => [
        styles.menuRow,
        pressed && { backgroundColor: colors.surface },
      ]}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
        onDismiss();
      }}
    >
      <Ionicons
        name={icon as any}
        size={18}
        color={destructive ? colors.danger : colors.text}
      />
      <Text
        style={[
          styles.menuLabel,
          { color: destructive ? colors.danger : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  // Reaction strip sits ~64pt above the bubble's top edge.
  // Menu sits 16pt below the bubble's bottom edge.
  const reactionTop = Math.max(60, rect.y - 64);
  const menuTop = rect.y + rect.height + 16;
  const sideEdge: { left?: number; right?: number } = isSent ? { right: 16 } : { left: 16 };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onDismiss}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss}>
        {/* Backdrop */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity }]}>
          <BlurView
            intensity={28}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: 'rgba(0,0,0,0.45)' },
            ]}
          />
        </Animated.View>

        {/* Reaction strip */}
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.reactionStrip,
            {
              backgroundColor: colors.background,
              top: reactionTop,
              ...sideEdge,
              transform: [{ scale: reactionScale }],
              opacity,
            },
          ]}
        >
          {REACTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                onReact(emoji);
                onDismiss();
              }}
              style={({ pressed }) => [
                styles.reactionItem,
                pressed && { backgroundColor: colors.surface },
              ]}
              hitSlop={6}
            >
              <Text style={styles.reactionEmoji}>{emoji}</Text>
            </Pressable>
          ))}
        </Animated.View>

        {/* Lifted bubble clone */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: rect.x,
            top: rect.y,
            width: rect.width,
            transform: [{ scale: bubbleScale }],
          }}
        >
          <View
            style={[
              styles.cloneBubble,
              { backgroundColor: bubbleColor },
              isSent ? styles.cloneTailSent : styles.cloneTailReceived,
              isMedia && styles.cloneMediaWrap,
            ]}
          >
            {renderClone()}
          </View>
        </Animated.View>

        {/* Context menu */}
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.menu,
            {
              backgroundColor: colors.background,
              top: menuTop,
              ...sideEdge,
              opacity,
              transform: [{ translateY: menuTranslate }],
            },
          ]}
        >
          {renderMenuItem({ icon: 'arrow-undo-outline', label: 'Reply', onPress: onReply })}
          {isText &&
            renderMenuItem({ icon: 'copy-outline', label: 'Copy text', onPress: onCopy })}
          {renderMenuItem({
            icon: 'arrow-redo-outline',
            label: 'Forward',
            onPress: onForward,
          })}
          {renderMenuItem({
            icon: 'star-outline',
            label: 'Star message',
            onPress: onStar,
          })}
          <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
          {renderMenuItem({
            icon: 'trash-outline',
            label: 'Delete',
            onPress: onDelete,
            destructive: true,
          })}
        </Animated.View>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  /* Reaction strip */
  reactionStrip: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 28,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  reactionItem: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionEmoji: { fontSize: 22 },

  /* Bubble clone */
  cloneBubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  cloneTailSent: { borderBottomRightRadius: 6 },
  cloneTailReceived: { borderBottomLeftRadius: 6 },
  cloneMediaWrap: { padding: 4 },
  cloneText: { fontSize: 15, lineHeight: 21 },
  cloneMedia: { borderRadius: 16 },
  cloneVideoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 16,
  },

  /* Context menu */
  menu: {
    position: 'absolute',
    minWidth: 220,
    borderRadius: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  menuLabel: { fontSize: 15, fontWeight: '500', flex: 1 },
  menuDivider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
