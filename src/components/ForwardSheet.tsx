import React from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';

import { useTheme } from '../theme/ThemeContext';
import { RootState } from '../store';
import { Conversation } from '../store/slices/chatSlice';

interface Props {
  visible: boolean;
  /** Conversation IDs to exclude (typically the source chat). */
  excludeIds?: string[];
  onClose: () => void;
  onPick: (target: Conversation) => void;
}

const getInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

export const ForwardSheet = ({ visible, excludeIds, onClose, onPick }: Props) => {
  const { colors } = useTheme();
  const conversations = useSelector((s: RootState) => s.chat.conversations);
  const exclude = new Set(excludeIds ?? []);

  // Forwarding to self-chat or unreachable peers (no public_key) makes no
  // sense for the messaging spine, so they're filtered out here.
  const targets = conversations.filter(
    (c) => !c.isSelfChat && !exclude.has(c.id) && !!c.contactPublicKey,
  );

  return (
    <Modal
      transparent={false}
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Own provider: a Modal is a separate native window, so it does not
       * inherit the app-root safe-area measurement (iOS pads by zero without
       * this and the header lands under the status bar). */}
      <SafeAreaProvider>
        <SafeAreaView
          style={[styles.root, { backgroundColor: colors.background }]}
          edges={['top', 'bottom']}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={[styles.cancel, { color: colors.primary }]}>Cancel</Text>
            </Pressable>
            <Text style={[styles.title, { color: colors.text }]}>Forward to</Text>
            <View style={{ width: 56 }} />
          </View>

          <FlatList
            data={targets}
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed ? colors.surface : 'transparent',
                    borderBottomColor: colors.border,
                  },
                ]}
                onPress={() => onPick(item)}
              >
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.avatarText, { color: colors.textSecondary }]}>
                    {getInitials(item.contactName || '#')}
                  </Text>
                </View>
                <View style={styles.rowMain}>
                  <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                    {item.contactName || item.contactPrivateNumber || item.id}
                  </Text>
                  {item.lastMessage ? (
                    <Text
                      style={[styles.rowSub, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {item.lastMessage}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <Ionicons name="people-outline" size={36} color={colors.textSecondary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No other conversations available to forward to.
                </Text>
              </View>
            }
          />
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancel: { fontSize: 16, fontWeight: '500' },
  title: { fontSize: 16, fontWeight: '700' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  avatarText: { fontSize: 14, fontWeight: '700' },
  rowMain: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  rowSub: { fontSize: 13 },

  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyText: { fontSize: 14, textAlign: 'center' },
});
