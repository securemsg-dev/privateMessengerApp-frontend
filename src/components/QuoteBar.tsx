import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';

export interface ReplyContext {
  senderName: string;
  preview: string;
  type: 'text' | 'image' | 'video' | 'voice' | 'document';
  mediaUri?: string;
}

interface Props {
  replyTo: ReplyContext | null;
  onDismiss: () => void;
}

const PREVIEW_MAX = 80;

export const QuoteBar = ({ replyTo, onDismiss }: Props) => {
  const { colors } = useTheme();
  if (!replyTo) return null;

  const previewText =
    replyTo.type === 'image'
      ? 'Photo'
      : replyTo.type === 'video'
      ? 'Video'
      : replyTo.type === 'voice'
      ? 'Voice message'
      : replyTo.type === 'document'
      ? 'Document'
      : replyTo.preview.slice(0, PREVIEW_MAX);

  const renderThumb = () => {
    if ((replyTo.type === 'image' || replyTo.type === 'video') && replyTo.mediaUri) {
      return (
        <View style={styles.thumbWrap}>
          <Image source={{ uri: replyTo.mediaUri }} style={styles.thumb} />
          {replyTo.type === 'video' && (
            <View style={styles.thumbVideoOverlay}>
              <Ionicons name="play" size={12} color="#ffffff" />
            </View>
          )}
        </View>
      );
    }
    if (replyTo.type === 'voice') {
      return (
        <View style={[styles.iconThumb, { backgroundColor: colors.background }]}>
          <Ionicons name="mic" size={16} color={colors.primary} />
        </View>
      );
    }
    return null;
  };

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: colors.surface, borderTopColor: colors.border },
      ]}
    >
      <View style={[styles.indicator, { backgroundColor: colors.primary }]} />
      {renderThumb()}
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: colors.primary }]}>
          Replying to {replyTo.senderName}
        </Text>
        <Text
          style={[styles.preview, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {previewText}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onDismiss}
        style={styles.dismissBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="close" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  indicator: { width: 3, height: 36, borderRadius: 2 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 36, height: 36, borderRadius: 6 },
  thumbVideoOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 6,
  },
  iconThumb: {
    width: 36,
    height: 36,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
  preview: { fontSize: 13 },
  dismissBtn: { padding: 4 },
});
