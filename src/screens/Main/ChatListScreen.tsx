import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import { useSelector, useDispatch } from 'react-redux';

import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeContext';
import { BottomSheet } from '../../components/BottomSheet';
import { DropdownMenu } from '../../components/DropdownMenu';
import { SwipeableChatRow } from '../../components/SwipeableChatRow';
import { UndoToast } from '../../components/UndoToast';
import { Avatar } from '../../components/Avatar';
import { RootState, AppDispatch } from '../../store';
import { getItemAsync, setItemAsync } from '../../utils/secureStorage';
import {
  loadConversationsThunk,
  hydrateConversationsThunk,
  deleteAllConversationsThunk,
  deleteSelectedConversationsThunk,
  mergeConversation,
  removeConversation,
  Conversation,
} from '../../store/slices/chatSlice';
import { ApiError, deleteConversationApi, updateConversationPrefsApi } from '../../services/api';

const ON_PRIMARY = '#ffffff';
type FilterKey = 'all' | 'unread' | 'groups' | 'pinned';

const formatTime = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const diff = (now.getTime() - d.getTime()) / 86400000;
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatPrivateNumber = (n: string | null) => {
  if (!n || n.length !== 10) return '—';
  return `${n.slice(0, 2)} · ${n.slice(2, 6)} · ${n.slice(6, 10)}`;
};

const getInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

export const ChatListScreen = () => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const dispatch = useDispatch<AppDispatch>();

  const userId = useSelector((s: RootState) => s.auth.userId);
  const displayName = useSelector((s: RootState) => s.auth.displayName);
  const privateNumber = useSelector((s: RootState) => s.auth.privateNumber);
  const conversations = useSelector((s: RootState) => s.chat.conversations);

  const [showNotification, setShowNotification] = useState(false);
  const [dontRemind, setDontRemind] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');

  // Phase C.1 — pin/mute/mark-unread are now server-backed via per-conversation
  // prefs (see chatSlice.Conversation.{isPinned, muteUntil, manualUnread}).
  // Soft-delete stays client-only until C.4 wires up server-side delete.
  const [softDeletedIds, setSoftDeletedIds] = useState<Set<string>>(new Set());
  const [undoToast, setUndoToast] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helpers that derive per-conversation flags from server-backed state.
  const isMutedNow = (c: Conversation) =>
    c.muteUntil ? new Date(c.muteUntil).getTime() > Date.now() : false;
  const isUnreadNow = (c: Conversation) =>
    c.unreadCount > 0 || c.manualUnread;

  useEffect(() => {
    // Paint the cached list instantly, then refresh from the network.
    dispatch(hydrateConversationsThunk());
    dispatch(loadConversationsThunk());
  }, []);

  useEffect(() => {
    const checkNotificationPref = async () => {
      const stored = await getItemAsync('notification_dont_remind');
      if (stored !== 'true') setShowNotification(true);
    };
    checkNotificationPref();
  }, []);

  /* ── Filter / partition conversations ─────────────────────── */
  // Strip self-chat and any rows pending soft-delete (during the 2s undo window)
  const regular = useMemo(
    () => conversations.filter((c) => !c.isSelfChat && !softDeletedIds.has(c.id)),
    [conversations, softDeletedIds],
  );
  const selfConv = conversations.find((c) => c.isSelfChat);

  const unreadCount = regular.filter(isUnreadNow).length;
  const pinnedCount = regular.filter((c) => c.isPinned).length;

  // Sort: pinned chats float to the top, otherwise keep server-given order.
  const sortedConvs = useMemo(() => {
    const arr = [...regular];
    // Pinned first, then most-recent message on top so live updates reorder.
    arr.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return Number(b.isPinned) - Number(a.isPinned);
      return (
        new Date(b.lastMessageTime).getTime() -
        new Date(a.lastMessageTime).getTime()
      );
    });
    return arr;
  }, [regular]);

  const visibleConvs = useMemo(() => {
    switch (activeFilter) {
      case 'unread':
        return sortedConvs.filter(isUnreadNow);
      case 'groups':
        return [];
      case 'pinned':
        return sortedConvs.filter((c) => c.isPinned);
      default:
        return sortedConvs;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedConvs, activeFilter]);

  /* ── Handlers ─────────────────────────────────────────────── */
  const handleDismissNotification = async () => {
    if (dontRemind) await setItemAsync('notification_dont_remind', 'true');
    setShowNotification(false);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const handleDeleteAll = () => {
    if (conversations.length === 0) {
      Alert.alert(t('chats.noChatsTitle'), t('chats.noChatsBody'));
      return;
    }
    Alert.alert(
      t('chats.deleteAllTitle'),
      t('chats.deleteAllBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => dispatch(deleteAllConversationsThunk()),
        },
      ],
    );
  };

  const menuItems = [
    { label: t('chats.menuStartChat'), icon: 'chatbubble-outline', onPress: () => navigation.navigate('StartChat') },
    { label: t('chats.menuCreateGroup'), icon: 'people-outline', onPress: () => navigation.navigate('CreateGroup') },
    {
      label: t('chats.menuSelectAll'),
      icon: 'checkbox-outline',
      onPress: () => {
        setSelectionMode(true);
        setSelectedIds(new Set(conversations.map((c) => c.id)));
      },
    },
    { label: t('chats.menuDeleteAll'), icon: 'trash-outline', onPress: handleDeleteAll, destructive: true },
  ];

  /* ── Swipe action handlers (Phase C.1: server-backed) ─────── */

  // Apply an optimistic patch, call the API, and either upgrade to the
  // server's response or roll back on failure. Single helper so all three
  // handlers below share the same retry / rollback semantics.
  const optimisticPatch = async (
    conv: Conversation,
    optimistic: Partial<Conversation>,
    body: Parameters<typeof updateConversationPrefsApi>[1],
    onError?: (err: unknown) => void,
  ) => {
    // Snapshot the fields we're about to touch so rollback is exact.
    const rollback: Partial<Conversation> = {};
    for (const key of Object.keys(optimistic) as (keyof Conversation)[]) {
      (rollback as Record<string, unknown>)[key] = conv[key];
    }
    dispatch(mergeConversation({ id: conv.id, patch: optimistic }));
    try {
      const updated = await updateConversationPrefsApi(conv.id, body);
      dispatch(
        mergeConversation({
          id: conv.id,
          patch: {
            isPinned: updated.is_pinned,
            muteUntil: updated.mute_until,
            manualUnread: updated.manual_unread,
            unreadCount: updated.unread_count,
          },
        }),
      );
    } catch (err) {
      dispatch(mergeConversation({ id: conv.id, patch: rollback }));
      onError?.(err);
    }
  };

  const handlePin = (conv: Conversation) => {
    const next = !conv.isPinned;
    void optimisticPatch(
      conv,
      { isPinned: next },
      { is_pinned: next },
      (err) => {
        if (err instanceof ApiError && err.status === 409) {
          Alert.alert(t('chats.pinLimitTitle'), err.detail);
        } else {
          Alert.alert(t('chats.couldntUpdatePin'), t('common.tryAgain'));
        }
      },
    );
  };

  const handleUnread = (conv: Conversation) => {
    // If the chat is unread for ANY reason (server count or manual flag),
    // tapping clears the manual flag. Otherwise, set the manual flag.
    const currentlyUnread = isUnreadNow(conv);
    const next = !currentlyUnread;
    void optimisticPatch(
      conv,
      { manualUnread: next },
      { manual_unread: next },
    );
  };

  const setMuteSeconds = (conv: Conversation, seconds: number) => {
    // Compute the optimistic muteUntil locally so the UI updates instantly.
    const muteUntil =
      seconds === 0
        ? null
        : new Date(Date.now() + seconds * 1000).toISOString();
    void optimisticPatch(
      conv,
      { muteUntil },
      { mute_seconds: seconds },
      () => Alert.alert(t('chats.couldntUpdateMute'), t('common.tryAgain')),
    );
  };

  const handleMute = (conv: Conversation) => {
    if (isMutedNow(conv)) {
      setMuteSeconds(conv, 0); // unmute
      return;
    }
    Alert.alert(
      'Mute notifications',
      `For how long do you want to mute ${conv.contactName || 'this chat'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: '1 hour', onPress: () => setMuteSeconds(conv, 60 * 60) },
        { text: '8 hours', onPress: () => setMuteSeconds(conv, 8 * 60 * 60) },
        // ~100 years — long enough to be effectively "always" without
        // tripping over backend timestamp limits.
        {
          text: 'Always',
          onPress: () => setMuteSeconds(conv, 100 * 365 * 24 * 60 * 60),
        },
      ],
    );
  };

  const commitDelete = async (id: string) => {
    setUndoToast(null);
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    try {
      await deleteConversationApi(id);
      dispatch(removeConversation({ id }));
    } catch {
      // Rollback — unhide the row so the user can try again
      setSoftDeletedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      Alert.alert(t('chats.couldntDeleteChat'), t('common.tryAgain'));
    }
  };

  const handleDelete = (conv: Conversation) => {
    // Hide the row immediately
    setSoftDeletedIds((prev) => {
      const next = new Set(prev);
      next.add(conv.id);
      return next;
    });
    // Show undo toast for 2s
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast({ id: conv.id, name: conv.contactName || 'Chat' });
    undoTimerRef.current = setTimeout(() => commitDelete(conv.id), 2000);
  };

  const handleUndoDelete = () => {
    if (!undoToast) return;
    setSoftDeletedIds((prev) => {
      const next = new Set(prev);
      next.delete(undoToast.id);
      return next;
    });
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndoToast(null);
  };

  const dismissUndoToast = () => {
    if (undoToast) commitDelete(undoToast.id);
  };

  // Cleanup the undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  const goToStartChat = () => navigation.navigate('StartChat');
  const goToPersonalChat = () =>
    navigation.navigate('ChatScreen', {
      conversationId: `self_${userId}`,
      contactName: 'Notes to self',
      contactPrivateNumber: privateNumber || '',
      isSelfChat: true,
    });
  const goToChat = (conv: Conversation) =>
    navigation.navigate('ChatScreen', {
      conversationId: conv.id,
      contactName: conv.contactName || conv.id,
      contactPrivateNumber: conv.contactPrivateNumber || '',
      contactPublicKey: conv.contactPublicKey,
      isSelfChat: conv.isSelfChat,
    });

  /* ── Sub-renders ──────────────────────────────────────────── */

  const FilterChip = ({
    label,
    count,
    filterKey,
  }: {
    label: string;
    count?: number;
    filterKey: FilterKey;
  }) => {
    const active = activeFilter === filterKey;
    return (
      <TouchableOpacity
        style={[
          styles.chip,
          active
            ? { backgroundColor: colors.primary, borderColor: colors.primary }
            : { backgroundColor: colors.background, borderColor: colors.border },
        ]}
        activeOpacity={0.8}
        onPress={() => setActiveFilter(filterKey)}
      >
        <Text
          style={[
            styles.chipLabel,
            { color: active ? ON_PRIMARY : colors.text },
          ]}
        >
          {label}
        </Text>
        {count !== undefined && count > 0 && (
          <View
            style={[
              styles.chipCount,
              {
                backgroundColor: active ? 'rgba(255,255,255,0.22)' : colors.surface,
              },
            ]}
          >
            <Text
              style={[
                styles.chipCountText,
                { color: active ? ON_PRIMARY : colors.textSecondary },
              ]}
            >
              {count}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderNotesToSelf = () => (
    <TouchableOpacity
      style={[
        styles.notesCard,
        { backgroundColor: isDark ? colors.surface : '#eaf4fb' },
      ]}
      activeOpacity={0.85}
      onPress={goToPersonalChat}
    >
      <View style={[styles.notesIconWrap, { backgroundColor: colors.background }]}>
        <Ionicons name="bookmark" size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.notesTitle, { color: colors.text }]}>{t('chats.notesToSelf')}</Text>
        <Text style={[styles.notesSub, { color: colors.textSecondary }]} numberOfLines={1}>
          {selfConv?.lastMessage || '0 drafts · synced locally'}
        </Text>
      </View>
      <Ionicons name="arrow-forward" size={18} color={colors.primary} />
    </TouchableOpacity>
  );

  const renderConversation = ({ item }: { item: Conversation }) => {
    const selected = selectedIds.has(item.id);
    const isPinned = item.isPinned;
    const isMuted = isMutedNow(item);
    const hasUnread = isUnreadNow(item);
    // Display badge count: server count + 1 if manually marked unread (with 0 server count)
    const displayBadge = item.unreadCount > 0
      ? item.unreadCount
      : item.manualUnread
      ? 1
      : 0;

    const rowInner = (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.6}
        onPress={() => (selectionMode ? toggleSelection(item.id) : goToChat(item))}
        onLongPress={() => {
          if (!selectionMode) {
            setSelectionMode(true);
            setSelectedIds(new Set([item.id]));
          }
        }}
      >
        {selectionMode && (
          <Ionicons
            name={selected ? 'checkbox' : 'square-outline'}
            size={22}
            color={selected ? colors.primary : colors.textSecondary}
            style={{ marginRight: 12 }}
          />
        )}

        <Avatar
          profilePictureKey={item.contactProfilePictureKey}
          name={item.contactName || '#'}
          size={46}
        />

        <View style={styles.rowMain}>
          <View style={styles.rowTitleLine}>
            <Text
              style={[
                styles.rowName,
                { color: colors.text, fontWeight: hasUnread ? '700' : '600' },
              ]}
              numberOfLines={1}
            >
              {item.contactName || item.id}
            </Text>
            {isPinned && (
              <View style={styles.pinChip}>
                <Ionicons name="pin" size={10} color={colors.textSecondary} />
              </View>
            )}
          </View>
          <Text style={[styles.rowPreview, { color: colors.textSecondary }]} numberOfLines={1}>
            {item.lastMessageType === 'voice'
              ? `🎤 Voice · ${item.lastMessage.match(/\d+:\d+/)?.[0] || ''}`
              : item.lastMessageType === 'image'
              ? '📷 Photo'
              : item.lastMessageType === 'video'
              ? '🎥 Video'
              : item.lastMessage}
          </Text>
        </View>

        <View style={styles.rowMeta}>
          <View style={styles.rowMetaTop}>
            {isMuted && (
              <Ionicons
                name="notifications-off"
                size={13}
                color={colors.textSecondary}
                style={{ marginRight: 4 }}
              />
            )}
            <Text style={[styles.rowTime, { color: colors.textSecondary }]}>
              {formatTime(item.lastMessageTime)}
            </Text>
          </View>
          {displayBadge > 0 && (
            <View
              style={[
                styles.unreadDot,
                {
                  backgroundColor: isMuted ? colors.textSecondary : colors.primary,
                },
              ]}
            >
              <Text style={styles.unreadText}>{displayBadge}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );

    // Selection mode disables swipe actions to avoid conflicting gestures
    if (selectionMode) return rowInner;

    return (
      <SwipeableChatRow
        rowBg={colors.background}
        isPinned={isPinned}
        isMuted={isMuted}
        hasUnread={hasUnread}
        onPin={() => handlePin(item)}
        onUnread={() => handleUnread(item)}
        onMute={() => handleMute(item)}
        onDelete={() => handleDelete(item)}
      >
        {rowInner}
      </SwipeableChatRow>
    );
  };

  /* ── Main render ──────────────────────────────────────────── */

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
        <View style={styles.header}>
          {selectionMode ? (
            <View style={styles.selectionRow}>
              <TouchableOpacity onPress={exitSelectionMode} style={styles.headerIcon}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.selectionTitle, { color: colors.text }]}>
                {selectedIds.size} selected
              </Text>
              <TouchableOpacity
                style={styles.headerIcon}
                onPress={() => {
                  if (selectedIds.size === 0) return;
                  Alert.alert(
                    'Delete Selected',
                    `Delete ${selectedIds.size} conversation(s)?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete',
                        style: 'destructive',
                        onPress: () => {
                          dispatch(deleteSelectedConversationsThunk([...selectedIds]));
                          exitSelectionMode();
                        },
                      },
                    ],
                  );
                }}
              >
                <Ionicons name="trash-outline" size={22} color={colors.danger} />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={[styles.kicker, { color: colors.textSecondary }]}>
                {formatPrivateNumber(privateNumber)}
              </Text>
              <View style={styles.titleRow}>
                <Text style={[styles.title, { color: colors.text }]}>{t('chats.title')}</Text>
                <View style={styles.titleActions}>
                  <TouchableOpacity style={styles.headerIcon}>
                    <Ionicons name="search-outline" size={22} color={colors.text} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.headerIcon}
                    onPress={() => setMenuVisible(true)}
                  >
                    <Ionicons name="create-outline" size={22} color={colors.text} />
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </View>
      </SafeAreaView>

      {/* Filter chips */}
      {!selectionMode && (
        <View style={styles.chipRow}>
          <FilterChip label={t('chats.filterAll')} filterKey="all" />
          <FilterChip label={t('chats.filterUnread')} count={unreadCount} filterKey="unread" />
          <FilterChip label={t('chats.filterGroups')} filterKey="groups" />
          <FilterChip label={t('chats.filterPinned')} count={pinnedCount} filterKey="pinned" />
        </View>
      )}

      <DropdownMenu
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        items={menuItems}
      />

      <FlatList
        data={visibleConvs}
        keyExtractor={(item) => item.id}
        renderItem={renderConversation}
        ListHeaderComponent={
          activeFilter === 'all' && !selectionMode ? renderNotesToSelf : null
        }
        contentContainerStyle={{ paddingBottom: 96 }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={[styles.emptyIconWrap, { backgroundColor: colors.surface }]}>
              <Ionicons
                name={
                  activeFilter === 'unread'
                    ? 'mail-open-outline'
                    : activeFilter === 'groups'
                    ? 'people-outline'
                    : activeFilter === 'pinned'
                    ? 'pin-outline'
                    : 'chatbubbles-outline'
                }
                size={42}
                color={colors.textSecondary}
              />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {activeFilter === 'unread'
                ? t('chats.emptyNoUnread')
                : activeFilter === 'groups'
                ? t('chats.emptyNoGroups')
                : activeFilter === 'pinned'
                ? t('chats.emptyNothingPinned')
                : t('chats.emptyNoChats')}
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
              {activeFilter === 'all'
                ? t('chats.emptyStartHint')
                : t('chats.emptySwitchHint')}
            </Text>
            {activeFilter === 'all' && (
              <TouchableOpacity
                style={[styles.emptyBtn, { backgroundColor: colors.primary }]}
                activeOpacity={0.85}
                onPress={goToStartChat}
              >
                <Ionicons name="add" size={20} color={ON_PRIMARY} />
                <Text style={styles.emptyBtnText}>{t('chats.startNewChat')}</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      <TouchableOpacity
        style={[
          styles.fab,
          { backgroundColor: colors.primary },
          Platform.select({
            ios: {
              shadowColor: colors.primary,
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.35,
              shadowRadius: 12,
            },
            android: { elevation: 8 },
          }),
        ]}
        activeOpacity={0.85}
        onPress={goToStartChat}
      >
        <Ionicons name="create-outline" size={22} color={ON_PRIMARY} />
      </TouchableOpacity>

      <UndoToast
        visible={!!undoToast}
        message={t('chats.deletedToast', { name: undoToast?.name ?? '' })}
        onUndo={handleUndoDelete}
        onDismiss={dismissUndoToast}
      />

      <BottomSheet visible={showNotification} onClose={handleDismissNotification}>
        <View>
          <View style={[styles.sheetIconWrap, { backgroundColor: colors.background }]}>
            <Ionicons name="notifications-outline" size={32} color={colors.primary} />
          </View>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>{t('chats.dontMissOut')}</Text>
          <Text style={[styles.sheetBody, { color: colors.textSecondary }]}>
            {t('chats.dontMissOutBody')}
          </Text>
          <TouchableOpacity
            style={styles.checkboxRow}
            activeOpacity={0.7}
            onPress={() => setDontRemind(!dontRemind)}
          >
            <Ionicons
              name={dontRemind ? 'checkbox' : 'square-outline'}
              size={22}
              color={dontRemind ? colors.primary : colors.textSecondary}
            />
            <Text style={[styles.checkboxLabel, { color: colors.text }]}>
              {t('chats.dontRemindAgain')}
            </Text>
          </TouchableOpacity>
          <View style={styles.sheetBtns}>
            <TouchableOpacity
              style={[styles.sheetBtnSecondary, { borderColor: colors.border }]}
              onPress={handleDismissNotification}
            >
              <Text
                style={[styles.sheetBtnSecondaryText, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {t('common.notNow')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetBtnPrimary, { backgroundColor: colors.primary }]}
              onPress={() => {
                Linking.openSettings();
                handleDismissNotification();
              }}
            >
              <Text style={styles.sheetBtnPrimaryText} numberOfLines={1}>
                {t('chats.openSettings')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },

  /* Header */
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  kicker: {
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 1,
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  titleActions: { flexDirection: 'row', alignItems: 'center' },
  headerIcon: { padding: 8 },
  selectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectionTitle: { fontSize: 18, fontWeight: '600', flex: 1, marginLeft: 8 },

  /* Chip row */
  chipRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
  },
  chipLabel: { fontSize: 14, fontWeight: '600' },
  chipCount: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    alignItems: 'center',
  },
  chipCountText: { fontSize: 11, fontWeight: '700' },

  /* Notes-to-self card */
  notesCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 14,
    borderRadius: 16,
    gap: 12,
  },
  notesIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
  notesSub: { fontSize: 13 },

  /* Conversation row */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  avatarText: { fontSize: 14, fontWeight: '700' },
  rowMain: { flex: 1, marginLeft: 14, justifyContent: 'center' },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  rowName: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  rowPreview: { fontSize: 14 },
  rowMeta: { alignItems: 'flex-end', justifyContent: 'center', gap: 6, marginLeft: 8 },
  rowMetaTop: { flexDirection: 'row', alignItems: 'center' },
  rowTime: { fontSize: 12, fontWeight: '500' },
  pinChip: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  unreadText: { color: ON_PRIMARY, fontSize: 11, fontWeight: '700' },

  /* Empty state */
  emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', marginBottom: 16 },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 28,
  },
  emptyBtnText: { color: ON_PRIMARY, fontSize: 15, fontWeight: '600' },

  /* FAB */
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Bottom sheet */
  sheetIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  sheetBody: { fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  checkboxLabel: { fontSize: 15, fontWeight: '500' },
  sheetBtns: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  sheetBtnSecondary: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBtnSecondaryText: { fontSize: 14, fontWeight: '600' },
  sheetBtnPrimary: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetBtnPrimaryText: { color: ON_PRIMARY, fontSize: 14, fontWeight: '600' },
});
