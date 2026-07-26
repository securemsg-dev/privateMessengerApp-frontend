import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../theme/ThemeContext';
import { Avatar } from '../../components/Avatar';
import { BlockedUserEntry, listBlockedApi, unblockUserApi } from '../../services/api';

/**
 * Settings → Blocked users.
 *
 * Google Play's UGC policy expects blocking to be manageable, not just
 * one-directional — a user who blocked someone must be able to see and undo
 * it without hunting for the original chat.
 */

const formatPrivateNumber = (n: string) =>
  n && n.length === 10
    ? `${n.slice(0, 2)}·${n.slice(2, 6)}·${n.slice(6, 10)}`
    : n;

export const BlockedUsersScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

  const [entries, setEntries] = useState<BlockedUserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await listBlockedApi();
      setEntries(res.blocked);
    } catch {
      Alert.alert('Could not load blocked users', 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch on focus: the user may have blocked someone from a chat since
  // this screen was last mounted.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleUnblock = (entry: BlockedUserEntry) => {
    const name = entry.user.display_name || formatPrivateNumber(entry.user.private_number);
    Alert.alert(
      `Unblock ${name}?`,
      'They will be able to message and call you again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            setBusyId(entry.user.id);
            try {
              await unblockUserApi(entry.user.id);
              setEntries((prev) => prev.filter((e) => e.user.id !== entry.user.id));
            } catch {
              Alert.alert('Could not unblock', 'Please try again.');
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Blocked users</Text>
        <View style={styles.back} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.user.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            entries.length > 0 ? (
              <Text style={[styles.lede, { color: colors.textSecondary }]}>
                Blocked people can't message or call you. They are not told that
                you blocked them.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="ban-outline" size={44} color={colors.textSecondary} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>
                No blocked users
              </Text>
              <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                You can block someone from any chat using the ⋮ menu in the
                top-right corner.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const name =
              item.user.display_name ||
              formatPrivateNumber(item.user.private_number);
            return (
              <View style={[styles.row, { borderBottomColor: colors.border }]}>
                <Avatar
                  profilePictureKey={item.user.profile_picture_key}
                  name={name}
                  size={40}
                />
                <View style={styles.rowText}>
                  <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text
                    style={[styles.rowSub, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {formatPrivateNumber(item.user.private_number)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleUnblock(item)}
                  disabled={busyId === item.user.id}
                  style={[styles.unblockBtn, { borderColor: colors.border }]}
                >
                  {busyId === item.user.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={[styles.unblockText, { color: colors.primary }]}>
                      Unblock
                    </Text>
                  )}
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: { width: 40, alignItems: 'center' },
  title: { fontSize: 17, fontWeight: '600' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  lede: { fontSize: 13, lineHeight: 19, padding: 16, paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12.5, marginTop: 2 },
  unblockBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 84,
    alignItems: 'center',
  },
  unblockText: { fontSize: 14, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  emptyBody: { fontSize: 13.5, lineHeight: 19, textAlign: 'center' },
});
