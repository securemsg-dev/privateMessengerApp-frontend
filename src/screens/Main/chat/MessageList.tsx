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
  colors: Colors;
  playingId: string | null;
  isSelfChat: boolean | undefined;
  onReply: (m: Message) => void;
  onActionSheet: (m: Message, isSent: boolean, rect: BubbleRect) => void;
  onPlayVoice: (id: string, uri: string) => Promise<void>;
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
  colors,
  playingId,
  isSelfChat,
  onReply,
  onActionSheet,
  onPlayVoice,
  onLoadOlder,
  loadingOlder,
}: Props) => {
  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const isMine = item.senderId === senderId;
      return (
        <MessageBubble
          item={item}
          index={index}
          isMine={isMine}
          senderId={senderId}
          contactName={contactName}
          colors={colors}
          playingId={playingId}
          messages={messages}
          onLongPress={(m, isSent, rect) => onActionSheet(m, isSent, rect as unknown as BubbleRect)}
          onReply={onReply}
          onPlayVoice={onPlayVoice}
        />
      );
    },
    [senderId, contactName, colors, playingId, messages, onReply, onActionSheet, onPlayVoice],
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
      data={[...messages].reverse()}
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
