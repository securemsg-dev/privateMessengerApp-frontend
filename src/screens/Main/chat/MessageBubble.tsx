import React, { useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { SwipeableMessage } from '../../../components/SwipeableMessage';
import { Message } from '../../../store/slices/chatSlice';
import { BUBBLE_MAX_WIDTH, ON_PRIMARY, styles } from './styles';

interface Colors {
  text: string;
  textSecondary: string;
  surface: string;
  border: string;
  primary: string;
  background: string;
  error?: string;
  danger?: string;
}

interface Props {
  item: Message;
  index: number;
  isMine: boolean;
  senderId: string;
  contactName: string;
  colors: Colors;
  playingId: string | null;
  messages: Message[];
  onLongPress: (m: Message, isSent: boolean, node: View) => void;
  onReply: (m: Message) => void;
  onPlayVoice: (id: string, uri: string) => Promise<void>;
}

const formatBubbleTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const sameDay = (a?: string, b?: string) => {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
};

const DaySeparator = ({ label, colors }: { label: string; colors: Colors }) => (
  <View style={styles.dayWrap}>
    <Text style={[styles.dayLabel, { color: colors.textSecondary }]}>
      {label}  ·  END-TO-END ENCRYPTED
    </Text>
  </View>
);

export const MessageBubble = React.memo(
  ({
    item,
    index,
    isMine,
    senderId,
    contactName,
    colors,
    playingId,
    messages,
    onLongPress,
    onReply,
    onPlayVoice,
  }: Props) => {
    const bubbleColor = isMine ? colors.primary : colors.surface;
    const textColor = isMine ? ON_PRIMARY : colors.text;

    const reversed = [...messages].reverse();
    const next = reversed[index - 1];
    const showDay = !next || !sameDay(item.timestamp, next.timestamp);

    const dayLabel = (() => {
      if (!showDay) return null;
      const d = new Date(item.timestamp);
      const now = new Date();
      if (sameDay(item.timestamp, now.toISOString())) return 'TODAY';
      const yesterday = new Date(now.getTime() - 86400000);
      if (sameDay(item.timestamp, yesterday.toISOString())) return 'YESTERDAY';
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }).toUpperCase();
    })();

    const replyPreview =
      item.replyPreview ??
      (item.replyToId ? messages.find((m) => m.id === item.replyToId) : null);

    const bubbleNodeRef = useRef<View | null>(null);
    const handleLongPress = useCallback(() => {
      if (!bubbleNodeRef.current) return;
      bubbleNodeRef.current.measureInWindow((x, y, width, height) => {
        onLongPress(item, isMine, { x, y, width, height } as unknown as View);
      });
    }, [item, isMine, onLongPress]);

    const renderContent = () => {
      if (item.deletedAt) {
        const wipedByMe = item.deletedBy === senderId;
        return (
          <Text
            style={[
              styles.bubbleTombstone,
              { color: isMine ? 'rgba(255,255,255,0.75)' : colors.textSecondary },
            ]}
          >
            🗑  {wipedByMe ? 'You deleted this message' : 'This message was deleted'}
          </Text>
        );
      }
      if (item.type === 'image' && item.mediaUri) {
        return (
          <Image
            source={{ uri: item.mediaUri }}
            style={styles.mediaBubbleImage}
            resizeMode="cover"
          />
        );
      }
      if (item.type === 'video' && item.mediaUri) {
        return (
          <View style={styles.videoBubble}>
            <Image
              source={{ uri: item.mediaUri }}
              style={styles.mediaBubbleImage}
              resizeMode="cover"
            />
            <View style={styles.videoPlayOverlay}>
              <Ionicons name="play-circle" size={40} color="rgba(255,255,255,0.9)" />
            </View>
          </View>
        );
      }
      if (item.type === 'voice' && item.mediaUri) {
        const isPlaying = playingId === item.id;
        return (
          <TouchableOpacity
            style={styles.voiceBubble}
            onPress={() => onPlayVoice(item.id, item.mediaUri!)}
            activeOpacity={0.7}
          >
            <View
              style={[
                styles.voicePlayBtn,
                {
                  backgroundColor: isMine
                    ? 'rgba(255,255,255,0.25)'
                    : colors.primary + '22',
                },
              ]}
            >
              {isPlaying ? (
                <ActivityIndicator size="small" color={isMine ? ON_PRIMARY : colors.primary} />
              ) : (
                <Ionicons
                  name="play"
                  size={16}
                  color={isMine ? ON_PRIMARY : colors.primary}
                />
              )}
            </View>
            <View style={styles.waveform}>
              {Array.from({ length: 20 }).map((_, i) => {
                const h = 4 + ((item.id.charCodeAt(i % item.id.length) + i * 7) % 18);
                return (
                  <View
                    key={i}
                    style={[
                      styles.waveBar,
                      {
                        height: h,
                        backgroundColor: isMine
                          ? isPlaying && i < 10
                            ? ON_PRIMARY
                            : 'rgba(255,255,255,0.5)'
                          : isPlaying && i < 10
                          ? colors.primary
                          : colors.border,
                      },
                    ]}
                  />
                );
              })}
            </View>
            <Text
              style={[
                styles.voiceDuration,
                { color: isMine ? 'rgba(255,255,255,0.85)' : colors.textSecondary },
              ]}
            >
              {item.content.match(/\d+:\d+/)?.[0] || '0:00'}
            </Text>
          </TouchableOpacity>
        );
      }
      if (item.type === 'document') {
        const filename = item.mediaUri
          ? decodeURIComponent(item.mediaUri.split('/').pop() ?? 'Document')
          : item.content;
        const isLoading = !item.mediaUri && !!item.mediaEnvelope;
        const handleOpenDoc = async () => {
          if (!item.mediaUri) return;
          const canShare = await Sharing.isAvailableAsync();
          if (canShare) await Sharing.shareAsync(item.mediaUri);
        };
        return (
          <TouchableOpacity
            style={[
              styles.voiceBubble,
              { minWidth: 180, paddingRight: 12 },
            ]}
            onPress={handleOpenDoc}
            activeOpacity={item.mediaUri ? 0.7 : 1}
            disabled={!item.mediaUri}
          >
            <View
              style={[
                styles.voicePlayBtn,
                {
                  backgroundColor: isMine
                    ? 'rgba(255,255,255,0.25)'
                    : colors.primary + '22',
                },
              ]}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color={isMine ? ON_PRIMARY : colors.primary} />
              ) : (
                <Ionicons
                  name="document-text"
                  size={20}
                  color={isMine ? ON_PRIMARY : colors.primary}
                />
              )}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                numberOfLines={2}
                style={[styles.bubbleText, { color: textColor, fontSize: 13, lineHeight: 17 }]}
              >
                {filename}
              </Text>
              <Text
                style={[
                  styles.voiceDuration,
                  { color: isMine ? 'rgba(255,255,255,0.7)' : colors.textSecondary },
                ]}
              >
                {isLoading ? 'Downloading…' : item.mediaUri ? 'Tap to open' : 'Unavailable'}
              </Text>
            </View>
          </TouchableOpacity>
        );
      }
      return <Text style={[styles.bubbleText, { color: textColor }]}>{item.content}</Text>;
    };

    return (
      <View>
        <SwipeableMessage isSent={isMine} onReply={() => onReply(item)}>
          <Pressable
            ref={(node) => {
              bubbleNodeRef.current = node as unknown as View | null;
            }}
            onLongPress={handleLongPress}
            delayLongPress={600}
            style={[
              styles.bubble,
              { backgroundColor: bubbleColor },
              isMine ? styles.bubbleTailSent : styles.bubbleTailReceived,
              (item.type === 'image' || item.type === 'video') && styles.mediaBubbleContainer,
            ]}
          >
            {!item.deletedAt && replyPreview && (
              <View
                style={[
                  styles.replyQuote,
                  {
                    borderLeftColor: isMine ? 'rgba(255,255,255,0.6)' : colors.primary,
                    backgroundColor: isMine ? 'rgba(255,255,255,0.12)' : colors.background,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.replyQuoteAuthor,
                    { color: isMine ? 'rgba(255,255,255,0.85)' : colors.primary },
                  ]}
                >
                  {replyPreview.senderId === senderId ? 'You' : contactName}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[
                    styles.replyQuoteText,
                    { color: isMine ? 'rgba(255,255,255,0.8)' : colors.textSecondary },
                  ]}
                >
                  {replyPreview.type === 'voice'
                    ? '🎤 Voice message'
                    : replyPreview.type === 'image'
                    ? '📷 Photo'
                    : replyPreview.type === 'video'
                    ? '🎥 Video'
                    : replyPreview.type === 'document'
                    ? '📎 Document'
                    : replyPreview.content}
                </Text>
              </View>
            )}
            {renderContent()}
          </Pressable>
        </SwipeableMessage>

        {!item.deletedAt && (item.reactions.length > 0 || item.isStarred) && (
          <View
            style={[
              styles.reactionRow,
              isMine ? styles.metaRight : styles.metaLeft,
            ]}
          >
            {item.isStarred && (
              <View
                style={[
                  styles.reactionBadge,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Ionicons name="star" size={11} color={colors.primary} />
              </View>
            )}
            {item.reactions.map((r) => (
              <View
                key={r.emoji}
                style={[
                  styles.reactionBadge,
                  {
                    backgroundColor: r.byMe ? colors.primary : colors.surface,
                    borderColor: r.byMe ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={styles.reactionBadgeText}>{r.emoji}</Text>
                {r.count > 1 && (
                  <Text
                    style={[
                      styles.reactionCount,
                      { color: r.byMe ? '#ffffff' : colors.textSecondary },
                    ]}
                  >
                    {r.count}
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}

        <View style={[styles.metaRow, isMine ? styles.metaRight : styles.metaLeft]}>
          <Text style={[styles.metaText, { color: colors.textSecondary }]}>
            {formatBubbleTime(item.timestamp)}
            {isMine && (
              <>
                {'  ·  '}
                <Text
                  style={{
                    color:
                      item.status === 'read'
                        ? colors.primary
                        : item.status === 'failed'
                        ? colors.danger ?? colors.error ?? '#e74c3c'
                        : colors.textSecondary,
                  }}
                >
                  {item.status === 'sent'
                    ? 'SENT'
                    : item.status === 'delivered'
                    ? 'DELIVERED'
                    : item.status === 'failed'
                    ? 'NOT SENT'
                    : 'READ'}
                </Text>
              </>
            )}
          </Text>
        </View>

        {showDay && dayLabel && <DaySeparator label={dayLabel} colors={colors} />}
      </View>
    );
  },
);
