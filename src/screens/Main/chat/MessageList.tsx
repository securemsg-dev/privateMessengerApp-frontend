import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Message } from '../../../store/slices/chatSlice';
import { BubbleRect } from '../../../components/MessageActionSheet';
import { MessageBubble } from './MessageBubble';
import { styles } from './styles';

interface Colors {
  text: string;
  textSecondary: string;
  surface: string;
  border: string;
  primary: string;
  background: string;
}

interface Props {
  messages: Message[];
  senderId: string;
  contactName: string;
  /** Group chat: label senders, render system lines, no read ticks. */
  isGroup?: boolean;
  colors: Colors;
  isSelfChat: boolean | undefined;
  onReply: (m: Message) => void;
  onActionSheet: (m: Message, isSent: boolean, rect: BubbleRect) => void;
  onOpenMedia: (m: Message) => void;
  /** Fetch the next older history page. No-op when history is complete. */
  onLoadOlder?: () => void;
  /** True while an older page is in flight — shows the top spinner. */
  loadingOlder?: boolean;
}

const InfoCard = ({ colors }: { colors: Colors }) => (
  <View
    style={[
      styles.infoCard,
      { backgroundColor: colors.surface, borderColor: colors.border },
    ]}
  >
    <Ionicons name="document-text-outline" size={32} color={colors.primary} />
    <Text style={[styles.infoCardText, { color: colors.text }]}>
      This is your personal space. Text yourself, send to-dos, files, and links. Everything is
      kept locally on your device.
    </Text>
  </View>
);

export const MessageList = ({
  messages,
  senderId,
  contactName,
  isGroup,
  colors,
  isSelfChat,
  onReply,
  onActionSheet,
  onOpenMedia,
  onLoadOlder,
  loadingOlder,
}: Props) => {
  const reversed = React.useMemo(() => [...messages].reverse(), [messages]);
  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const isMine = item.senderId === senderId;
      // Inverted list: the chronologically previous message is index + 1.
      const prev = reversed[index + 1];
      const showSenderName =
        !!isGroup &&
        !isMine &&
        item.type !== 'system' &&
        (!prev || prev.senderId !== item.senderId || prev.type === 'system');
      return (
        <MessageBubble
          item={item}
          index={index}
          isMine={isMine}
          senderId={senderId}
          contactName={contactName}
          isGroup={!!isGroup}
          showSenderName={showSenderName}
          colors={colors}
          messages={messages}
          onLongPress={(m, isSent, rect) => onActionSheet(m, isSent, rect as unknown as BubbleRect)}
          onReply={onReply}
          onOpenMedia={onOpenMedia}
        />
      );
    },
    [senderId, contactName, isGroup, reversed, colors, messages, onReply, onActionSheet, onOpenMedia],
  );

  // The list is inverted, so the "footer" renders at the TOP of the thread —
  // the right spot for both the self-chat info card and the older-page spinner.
  const footer = isSelfChat ? (
    <InfoCard colors={colors} />
  ) : loadingOlder ? (
    <ActivityIndicator size="small" color={colors.primary} style={{ paddingVertical: 12 }} />
  ) : null;

  return (
    <FlatList
      data={reversed}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      inverted
      style={{ flex: 1 }}
      contentContainerStyle={styles.messageList}
      ListFooterComponent={footer}
      // Inverted list: "end" = the top of the thread. Fires the older-page
      // fetch as the user scrolls back through history.
      onEndReached={onLoadOlder}
      onEndReachedThreshold={0.3}
      keyboardShouldPersistTaps="handled"
    />
  );
};
