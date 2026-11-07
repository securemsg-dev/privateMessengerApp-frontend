import React, { useMemo, useState } from 'react';
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
import { ApiError, addGroupMembersApi, createGroupApi } from '../../services/api';
import { loadConversationsThunk, refreshConversationThunk } from '../../store/slices/chatSlice';

/** Max members incl. me — mirrors the backend's GROUP_MAX_MEMBERS. */
const GROUP_MAX_MEMBERS = 50;
const NAME_MAX = 100;

interface PickerContact {
  userId: string;
  name: string;
  profilePictureKey: string | null;
  hasKey: boolean;
}

type Params = {
  CreateGroup: { addToConversationId?: string } | undefined;
};

/**
 * Create a group from existing contacts (people you already have a 1:1 chat
 * with — the server only allows those), or, with `addToConversationId`,
 * add more contacts to an existing group.
 */
export const CreateGroupScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<Params, 'CreateGroup'>>();
  const dispatch = useDispatch<AppDispatch>();
  const addToId = route.params?.addToConversationId;
  const isAddMode = !!addToId;

  const conversations = useSelector((s: RootState) => s.chat.conversations);
  const targetGroup = conversations.find((c) => c.id === addToId);
  const existingIds = useMemo(
    () => new Set((targetGroup?.members ?? []).map((m) => m.userId)),
    [targetGroup],
  );

  const contacts: PickerContact[] = useMemo(() => {
    const seen = new Set<string>();
    return conversations
      .filter((c) => !c.isGroup && !c.isSelfChat && c.peerUserId)
      .filter((c) => !existingIds.has(c.peerUserId!))
      .filter((c) => (seen.has(c.peerUserId!) ? false : (seen.add(c.peerUserId!), true)))
      .map((c) => ({
        userId: c.peerUserId!,
        name: c.contactName || 'Contact',
        profilePictureKey: c.contactProfilePictureKey,
        hasKey: !!c.contactPublicKey,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [conversations, existingIds]);

  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () => contacts.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase())),
    [contacts, search],
  );
  const selectedContacts = contacts.filter((c) => selectedIds.has(c.userId));
  const capacity = GROUP_MAX_MEMBERS - (isAddMode ? existingIds.size : 1);

  const toggleContact = (c: PickerContact) => {
    if (!c.hasKey) {
      Alert.alert('Not available yet', `${c.name} hasn't set up encryption yet, so they can't join groups.`);
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(c.userId)) next.delete(c.userId);
      else if (next.size >= capacity) {
        Alert.alert('Group is full', `Groups can have up to ${GROUP_MAX_MEMBERS} members.`);
        return prev;
      } else next.add(c.userId);
      return next;
    });
  };

  const defaultName = () =>
    selectedContacts
      .map((c) => c.name.split(' ')[0])
      .join(', ')
      .slice(0, NAME_MAX) || 'New group';

  const handleSubmit = async () => {
    if (selectedIds.size === 0 || busy) return;
    setBusy(true);
    try {
      if (isAddMode && addToId) {
        await addGroupMembersApi(addToId, [...selectedIds]);
        await dispatch(refreshConversationThunk(addToId));
        navigation.goBack();
        return;
      }
      const name = groupName.trim() || defaultName();
      const created = await createGroupApi(name, [...selectedIds]);
      void dispatch(loadConversationsThunk());
      await dispatch(refreshConversationThunk(created.id));
      navigation.replace('ChatScreen', {
        conversationId: created.id,
        contactName: created.name || name,
        contactPrivateNumber: '',
        isGroup: true,
      });
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : 'Please check your connection and try again.';
      Alert.alert(isAddMode ? 'Could not add members' : 'Could not create group', detail);
    } finally {
      setBusy(false);
    }
  };

  const renderContact = ({ item }: { item: PickerContact }) => {
    const isSelected = selectedIds.has(item.userId);
    return (
      <TouchableOpacity
        style={[styles.contactRow, { borderBottomColor: colors.border, opacity: item.hasKey ? 1 : 0.5 }]}
        activeOpacity={0.7}
        onPress={() => toggleContact(item)}
      >
        <Ionicons
          name={isSelected ? 'checkbox' : 'square-outline'}
          size={22}
          color={isSelected ? colors.primary : colors.textSecondary}
        />
        <Avatar profilePictureKey={item.profilePictureKey} name={item.name} size={44} />
        <View style={styles.contactInfo}>
          <Text style={[styles.contactName, { color: colors.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          {!item.hasKey && (
            <Text style={[styles.contactPhone, { color: colors.textSecondary }]}>
              Encryption not set up yet
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const canSubmit = selectedIds.size > 0 && !busy;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              {isAddMode ? 'Add Members' : 'Create Group'}
            </Text>
            {selectedIds.size > 0 && (
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                {selectedIds.size} selected
              </Text>
            )}
          </View>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={{ opacity: canSubmit ? 1 : 0.4 }}
          >
            {busy ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={[styles.createBtn, { color: colors.primary }]}>
                {isAddMode ? 'Add' : 'Create'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Group name input */}
        {!isAddMode && (
          <View style={[styles.groupNameWrap, { backgroundColor: colors.surface }]}>
            <Ionicons name="people" size={20} color={colors.primary} />
            <TextInput
              style={[styles.groupNameInput, { color: colors.text }]}
              placeholder="Group name"
              placeholderTextColor={colors.textSecondary}
              value={groupName}
              onChangeText={setGroupName}
              maxLength={NAME_MAX}
            />
          </View>
        )}

        {/* Selected chips */}
        {selectedContacts.length > 0 && (
          <View style={styles.chipsWrap}>
            {selectedContacts.map((c) => (
              <TouchableOpacity
                key={c.userId}
                style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => toggleContact(c)}
              >
                <Text style={[styles.chipText, { color: colors.text }]}>{c.name.split(' ')[0]}</Text>
                <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Search bar */}
        <View style={[styles.searchBar, { backgroundColor: colors.surface }]}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search contacts..."
            placeholderTextColor={colors.textSecondary}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.userId}
        renderItem={renderContact}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={52} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {contacts.length === 0
                ? isAddMode
                  ? 'All your contacts are already in this group'
                  : 'Start a chat with someone first — groups are made from your contacts'
                : 'No contacts found'}
            </Text>
          </View>
        }
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
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  headerSubtitle: { fontSize: 13, marginTop: 2 },
  createBtn: { fontSize: 16, fontWeight: '600' },
  groupNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  groupNameInput: { flex: 1, fontSize: 15 },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  chipText: { fontSize: 13, fontWeight: '500' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 15 },
  listContent: { paddingBottom: 40 },
  contactRow: {
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
  },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  contactPhone: { fontSize: 13 },
  emptyState: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
});
