import React, { useCallback } from 'react';
import { FlatList, Text, View } from 'react-native';
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

  return (
    <FlatList
      data={[...messages].reverse()}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      inverted
      style={{ flex: 1 }}
      contentContainerStyle={styles.messageList}
      ListFooterComponent={isSelfChat ? <InfoCard colors={colors} /> : null}
      keyboardShouldPersistTaps="handled"
    />
  );
};
