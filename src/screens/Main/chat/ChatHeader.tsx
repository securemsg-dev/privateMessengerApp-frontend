import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { styles } from './styles';
import { Avatar } from '../../../components/Avatar';
import { formatPresence, PeerPresence } from '../../../utils/presence';

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
  contactProfilePictureKey?: string | null;
  isSelfChat: boolean | undefined;
  displayName: string | null;
  colors: Colors;
  onBack: () => void;
  onCall: () => void;
  onCallLongPress: () => void;
  /** Opens the ⋮ menu (block / report). Omitted for self-chat. */
  onOverflow?: () => void;
  /** Peer online / last seen; null hides the status entirely. */
  presence?: PeerPresence | null;
  /** Group mode: name is the group's, subtitle shows the member count. */
  isGroup?: boolean;
  memberCount?: number;
  /** Groups: tapping the title opens group info. */
  onOpenInfo?: () => void;
}

const ONLINE_GREEN = '#22a55b';
const groupAvatarStyle = {
  width: 36,
  height: 36,
  borderRadius: 18,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

const formatPrivateNumber = (n: string) => {
  if (!n || n.length !== 10) return '';
  return `${n.slice(0, 2)}·${n.slice(2, 6)}·${n.slice(6, 10)}`;
};

export const ChatHeader = ({
  contactName,
  contactPrivateNumber,
  contactProfilePictureKey,
  isSelfChat,
  displayName,
  colors,
  onBack,
  onCall,
  onCallLongPress,
  onOverflow,
  presence,
  isGroup,
  memberCount,
  onOpenInfo,
}: Props) => {
  const presenceText = formatPresence(presence);
  const online = !!presence?.online;
  return (
  <View style={[styles.header, { borderBottomColor: colors.border }]}>
    <TouchableOpacity onPress={onBack} style={styles.backBtn}>
      <Ionicons name="chevron-back" size={26} color={colors.text} />
    </TouchableOpacity>

    {isGroup ? (
      <View style={[groupAvatarStyle, { backgroundColor: colors.primary + '22' }]}>
        <Ionicons name="people" size={20} color={colors.primary} />
      </View>
    ) : (
      <Avatar
        profilePictureKey={isSelfChat ? null : contactProfilePictureKey}
        name={isSelfChat ? displayName || 'ME' : contactName}
        size={36}
      />
    )}

    <TouchableOpacity
      style={styles.headerInfo}
      onPress={isGroup ? onOpenInfo : undefined}
      disabled={!isGroup}
      activeOpacity={0.7}
    >
      <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
        {contactName}
      </Text>
      <View style={styles.headerSubRow}>
        {!isSelfChat && contactPrivateNumber.length === 10 && (
          <>
            {online && (
              <View style={[styles.presenceDot, { backgroundColor: ONLINE_GREEN }]} />
            )}
            <Text style={[styles.headerSub, { color: colors.textSecondary }]} numberOfLines={1}>
              {formatPrivateNumber(contactPrivateNumber)}
              {presenceText ? '  ·  ' : ''}
              {presenceText ? (
                <Text
                  style={
                    online ? { color: ONLINE_GREEN, fontWeight: '600' } : undefined
                  }
                >
                  {presenceText}
                </Text>
              ) : null}
            </Text>
          </>
        )}
        {isSelfChat && (
          <Text style={[styles.headerSub, { color: colors.textSecondary }]}>
            Personal space · synced locally
          </Text>
        )}
        {isGroup && (
          <Text style={[styles.headerSub, { color: colors.textSecondary }]} numberOfLines={1}>
            {memberCount ? `${memberCount} members · tap for group info` : 'Group'}
          </Text>
        )}
      </View>
    </TouchableOpacity>

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
    {/* Self-chat has nobody to block or report, so the menu is hidden there. */}
    {!isSelfChat && (
      <TouchableOpacity
        style={styles.headerIcon}
        onPress={onOverflow}
        accessibilityLabel="More options"
        accessibilityRole="button"
      >
        <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
      </TouchableOpacity>
    )}
  </View>
  );
};
