import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';

import { useTheme } from '../../theme/ThemeContext';
import { AppDispatch, RootState } from '../../store';
import { Avatar } from '../../components/Avatar';
import { BottomSheet } from '../../components/BottomSheet';
import { ReportSheet } from '../../components/ReportSheet';
import { ApiError, removeGroupMemberApi, renameGroupApi } from '../../services/api';
import {
  GroupMember,
  refreshConversationThunk,
  removeConversation,
} from '../../store/slices/chatSlice';
import { useMemberSafety } from '../../hooks/useMemberSafety';

type Params = { GroupInfo: { conversationId: string } };

const GROUP_MAX_MEMBERS = 50;

/**
 * Group details: name (admins can rename), member list with Admin tags,
 * add / remove members (admins), report / block any member, leave.
 */
export const GroupInfoScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<Params, 'GroupInfo'>>();
  const dispatch = useDispatch<AppDispatch>();
  const { conversationId } = route.params;

  const conv = useSelector((s: RootState) => s.chat.conversations.find((c) => c.id === conversationId));
  const myUserId = useSelector((s: RootState) => s.auth.userId) ?? '';
  const messages = useSelector((s: RootState) => s.chat.activeMessages);
  const isAdmin = conv?.myRole === 'admin';
  const members = conv?.members ?? [];

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<GroupMember | null>(null);
  const safety = useMemberSafety(conversationId, messages, myUserId);

  // Always show the latest member list.
  useEffect(() => {
    void dispatch(refreshConversationThunk(conversationId));
  }, [conversationId, dispatch]);

  const memberName = (m: GroupMember) =>
    m.userId === myUserId ? 'You' : m.displayName || 'Member';

  const saveName = async () => {
    const name = nameDraft.trim().replace(/\s+/g, ' ');
    if (!name || name === conv?.contactName) {
      setEditingName(false);
      return;
    }
    setBusy(true);
    try {
      await renameGroupApi(conversationId, name);
      await dispatch(refreshConversationThunk(conversationId));
      setEditingName(false);
    } catch (err) {
      Alert.alert('Could not rename', err instanceof ApiError ? err.detail : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = (m: GroupMember) => {
    Alert.alert(`Remove ${memberName(m)}?`, 'They will stop receiving messages from this group.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeGroupMemberApi(conversationId, m.userId);
            await dispatch(refreshConversationThunk(conversationId));
          } catch (err) {
            Alert.alert('Could not remove', err instanceof ApiError ? err.detail : 'Please try again.');
          }
        },
      },
    ]);
  };

  const leaveGroup = () => {
    const lastAdmin = isAdmin && members.filter((m) => m.role === 'admin').length === 1 && members.length > 1;
    Alert.alert(
      'Leave this group?',
      lastAdmin
        ? "You're the only admin — the longest-standing member will become admin."
        : "You won't receive new messages from this group.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeGroupMemberApi(conversationId, myUserId);
              dispatch(removeConversation({ id: conversationId }));
              navigation.popToTop();
            } catch (err) {
              Alert.alert('Could not leave', err instanceof ApiError ? err.detail : 'Please try again.');
            }
          },
        },
      ],
    );
  };

  const header = (
    <View>
      <View style={styles.hero}>
        <View style={[styles.groupAvatar, { backgroundColor: colors.primary + '22' }]}>
          <Ionicons name="people" size={44} color={colors.primary} />
        </View>
        {editingName ? (
          <View style={[styles.nameEdit, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            <TextInput
              autoFocus
              value={nameDraft}
              onChangeText={setNameDraft}
              maxLength={100}
              style={[styles.nameInput, { color: colors.text }]}
              onSubmitEditing={saveName}
              returnKeyType="done"
            />
            {busy ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <TouchableOpacity onPress={saveName} hitSlop={8}>
                <Ionicons name="checkmark" size={22} color={colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <TouchableOpacity
            disabled={!isAdmin}
            onPress={() => {
              setNameDraft(conv?.contactName ?? '');
              setEditingName(true);
            }}
            style={styles.nameRow}
          >
            <Text style={[styles.groupName, { color: colors.text }]} numberOfLines={2}>
              {conv?.contactName ?? 'Group'}
            </Text>
            {isAdmin && <Ionicons name="pencil" size={16} color={colors.textSecondary} />}
          </TouchableOpacity>
        )}
        <Text style={[styles.subtle, { color: colors.textSecondary }]}>
          Group · {members.length} member{members.length === 1 ? '' : 's'} · end-to-end encrypted
        </Text>
      </View>

      <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>MEMBERS</Text>
      {isAdmin && members.length < GROUP_MAX_MEMBERS && (
        <TouchableOpacity
          style={[styles.row, { borderBottomColor: colors.border }]}
          onPress={() => navigation.navigate('CreateGroup', { addToConversationId: conversationId })}
        >
          <View style={[styles.iconCircle, { backgroundColor: colors.primary }]}>
            <Ionicons name="person-add" size={18} color="#fff" />
          </View>
          <Text style={[styles.rowText, { color: colors.primary }]}>Add members</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const footer = (
    <TouchableOpacity style={[styles.row, styles.leaveRow]} onPress={leaveGroup}>
      <Ionicons name="exit-outline" size={22} color={colors.danger} />
      <Text style={[styles.rowText, { color: colors.danger }]}>Leave group</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Group info</Text>
        </View>
      </SafeAreaView>

      <FlatList
        data={members}
        keyExtractor={(m) => m.userId}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.row, { borderBottomColor: colors.border }]}
            disabled={item.userId === myUserId}
            onPress={() => setSelected(item)}
          >
            <Avatar profilePictureKey={item.profilePictureKey} name={item.displayName || 'Member'} size={40} />
            <Text style={[styles.rowText, { color: colors.text }]} numberOfLines={1}>
              {memberName(item)}
            </Text>
            {item.role === 'admin' && (
              <View style={[styles.adminTag, { borderColor: colors.primary }]}>
                <Text style={[styles.adminTagText, { color: colors.primary }]}>Admin</Text>
              </View>
            )}
          </TouchableOpacity>
        )}
      />

      {/* Member actions */}
      <BottomSheet visible={selected !== null} onClose={() => setSelected(null)}>
        {selected && (
          <View>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>{memberName(selected)}</Text>
            <TouchableOpacity
              style={styles.sheetRow}
              onPress={() => {
                const m = selected;
                setSelected(null);
                // After the sheet closes (iOS can't stack Modals).
                setTimeout(() => safety.openReport({ userId: m.userId, name: memberName(m) }), 350);
              }}
            >
              <Ionicons name="flag-outline" size={20} color={colors.text} />
              <Text style={[styles.rowText, { color: colors.text }]}>Report</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetRow}
              onPress={() => {
                const m = selected;
                setSelected(null);
                safety.blockMember({ userId: m.userId, name: memberName(m) });
              }}
            >
              <Ionicons name="ban-outline" size={20} color={colors.text} />
              <Text style={[styles.rowText, { color: colors.text }]}>Block</Text>
            </TouchableOpacity>
            {isAdmin && (
              <TouchableOpacity
                style={styles.sheetRow}
                onPress={() => {
                  const m = selected;
                  setSelected(null);
                  removeMember(m);
                }}
              >
                <Ionicons name="person-remove-outline" size={20} color={colors.danger} />
                <Text style={[styles.rowText, { color: colors.danger }]}>Remove from group</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </BottomSheet>

      <ReportSheet
        visible={safety.target !== null}
        contactName={safety.target?.name ?? ''}
        availableEvidence={safety.availableEvidence}
        submitting={safety.submitting}
        onClose={safety.closeReport}
        onSubmit={safety.submitReport}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  hero: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 24, gap: 8 },
  groupAvatar: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  groupName: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  nameEdit: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
    alignSelf: 'stretch',
  },
  nameInput: { flex: 1, fontSize: 17, paddingVertical: 4 },
  subtle: { fontSize: 13 },
  sectionHeader: { fontSize: 12, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, fontSize: 16, fontWeight: '500' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  adminTag: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  adminTagText: { fontSize: 11, fontWeight: '700' },
  leaveRow: { marginTop: 24, borderBottomWidth: 0 },
  sheetTitle: { fontSize: 17, fontWeight: '700', marginBottom: 8, paddingHorizontal: 4 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 4 },
});
