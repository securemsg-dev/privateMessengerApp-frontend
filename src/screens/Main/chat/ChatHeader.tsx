import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { styles } from './styles';

interface Colors {
  text: string;
  textSecondary: string;
  surface: string;
  border: string;
  primary: string;
}

interface Props {
  contactName: string;
  contactPrivateNumber: string;
  isSelfChat: boolean | undefined;
  displayName: string | null;
  colors: Colors;
  onBack: () => void;
  onCall: () => void;
  onCallLongPress: () => void;
}

const getInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

const formatPrivateNumber = (n: string) => {
  if (!n || n.length !== 10) return '';
  return `${n.slice(0, 2)}·${n.slice(2, 6)}·${n.slice(6, 10)}`;
};

export const ChatHeader = ({
  contactName,
  contactPrivateNumber,
  isSelfChat,
  displayName,
  colors,
  onBack,
  onCall,
  onCallLongPress,
}: Props) => (
  <View style={[styles.header, { borderBottomColor: colors.border }]}>
    <TouchableOpacity onPress={onBack} style={styles.backBtn}>
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </TouchableOpacity>

    <View
      style={[
        styles.headerAvatar,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.headerAvatarText, { color: colors.textSecondary }]}>
        {isSelfChat ? getInitials(displayName || 'ME') : getInitials(contactName)}
      </Text>
    </View>

    <View style={styles.headerInfo}>
      <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
        {contactName}
      </Text>
      <View style={styles.headerSubRow}>
        {!isSelfChat && contactPrivateNumber.length === 10 && (
          <>
            <View style={[styles.presenceDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.headerSub, { color: colors.textSecondary }]} numberOfLines={1}>
              {formatPrivateNumber(contactPrivateNumber)}
              {'  ·  '}
              <Text style={{ color: colors.primary, fontWeight: '600' }}>ACTIVE NOW</Text>
            </Text>
          </>
        )}
        {isSelfChat && (
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            Personal space · synced locally
          </Text>
        )}
      </View>
    </View>

    {!isSelfChat && (
      <TouchableOpacity
        style={styles.headerIcon}
        onPress={onCall}
        onLongPress={onCallLongPress}
        delayLongPress={500}
      >
        <Ionicons name="call-outline" size={22} color={colors.text} />
      </TouchableOpacity>
    )}
    <TouchableOpacity style={styles.headerIcon}>
      <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
    </TouchableOpacity>
  </View>
);
