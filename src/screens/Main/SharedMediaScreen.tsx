import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import * as Sharing from 'expo-sharing';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';

import { useTheme } from '../../theme/ThemeContext';
import { AppDispatch, RootState } from '../../store';
import { MediaViewerItem, MediaViewerModal } from '../../components/MediaViewerModal';
import { downloadAndDecryptMedia } from '../../services/media';
import {
  cryptoConvOf,
  hydrateMessageMedia,
  loadOlderMessagesThunk,
  mediaMetaOf,
  Message,
} from '../../store/slices/chatSlice';
import { formatDuration } from '../../utils/waveform';
import { extractLinks, monthLabel } from '../../utils/links';
import { VoiceMessageBubble } from './chat/VoiceMessageBubble';

type Params = { SharedMedia: { conversationId: string; title: string } };
type Tab = 'media' | 'files' | 'voice' | 'links';

const TABS: { key: Tab; label: string }[] = [
  { key: 'media', label: 'Media' },
  { key: 'files', label: 'Files' },
  { key: 'voice', label: 'Voice' },
  { key: 'links', label: 'Links' },
];
const COLUMNS = 3;
const GAP = 3;

type Row =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'grid'; key: string; items: Message[] }
  | { kind: 'file'; key: string; message: Message }
  | { kind: 'voice'; key: string; message: Message }
  | { kind: 'link'; key: string; url: string; message: Message };

const fileName = (m: Message) =>
  m.mediaUri ? decodeURIComponent(m.mediaUri.split('/').pop() ?? 'Document') : 'Document';

/**
 * Everything shared in a chat, newest first and grouped by month: photos and
 * videos, files, voice messages and links. View-once and deleted messages
 * never appear here. Reads the chat's loaded history and pulls older pages as
 * the user scrolls.
 */
export const SharedMediaScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<Params, 'SharedMedia'>>();
  const dispatch = useDispatch<AppDispatch>();
  const { conversationId, title } = route.params;
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);

  const all = useSelector((s: RootState) => s.chat.activeMessages);
  const cursor = useSelector((s: RootState) => s.chat.messagesCursor);
  const loadingOlder = useSelector((s: RootState) => s.chat.loadingOlder);
  const myUserId = useSelector((s: RootState) => s.auth.userId) ?? '';
  const conv = useSelector((s: RootState) =>
    s.chat.conversations.find((c) => c.id === conversationId),
  );

  const [tab, setTab] = useState<Tab>('media');
  const [viewer, setViewer] = useState<MediaViewerItem | null>(null);

  const rows = useMemo<Row[]>(() => {
    const usable = all
      .filter((m) => m.conversationId === conversationId && !m.deletedAt && !m.viewOnce)
      .slice()
      .reverse(); // newest first
    const out: Row[] = [];
    let lastMonth = '';
    let grid: Message[] = [];
    const flushGrid = () => {
      for (let i = 0; i < grid.length; i += COLUMNS) {
        const items = grid.slice(i, i + COLUMNS);
        out.push({ kind: 'grid', key: `g-${items[0].id}`, items });
      }
      grid = [];
    };
    const header = (m: Message) => {
      const label = monthLabel(m.timestamp);
      if (label !== lastMonth) {
        flushGrid();
        lastMonth = label;
        out.push({ kind: 'header', key: `h-${tab}-${label}`, label });
      }
    };
    for (const m of usable) {
      if (tab === 'media' && (m.type === 'image' || m.type === 'video')) {
        if (!m.mediaUri && !m.mediaEnvelope) continue;
        header(m);
        grid.push(m);
      } else if (tab === 'files' && m.type === 'document') {
        header(m);
        out.push({ kind: 'file', key: m.id, message: m });
      } else if (tab === 'voice' && m.type === 'voice' && (m.mediaUri || m.mediaEnvelope)) {
        header(m);
        out.push({ kind: 'voice', key: m.id, message: m });
      } else if (tab === 'links' && m.type === 'text') {
        const links = extractLinks(m.content);
        if (links.length === 0) continue;
        header(m);
        links.forEach((url, i) => out.push({ kind: 'link', key: `${m.id}-${i}`, url, message: m }));
      }
    }
    flushGrid();
    return out;
  }, [all, conversationId, tab]);

  // Photos not on this device yet (older pages): fetch them as they appear.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    if (tab !== 'media') return;
    for (const row of rows) {
      if (row.kind !== 'grid') continue;
      for (const m of row.items) {
        if (m.type !== 'image' || m.mediaUri || !m.mediaEnvelope || requested.current.has(m.id)) {
          continue;
        }
        requested.current.add(m.id);
        downloadAndDecryptMedia(m.mediaEnvelope)
          .then((localUri) => dispatch(hydrateMessageMedia({ messageId: m.id, localUri })))
          .catch(() => requested.current.delete(m.id));
      }
    }
  }, [rows, tab, dispatch]);

  const loadOlder = () => {
    if (!cursor || loadingOlder) return;
    void dispatch(
      loadOlderMessagesThunk({ conversationId, crypto: cryptoConvOf(conv), before: cursor }),
    );
  };
  // A tab with few matches may not fill the screen — keep paging until it
  // does or history runs out, so "nothing here" is never shown too early.
  useEffect(() => {
    if (rows.length < 12 && cursor && !loadingOlder) loadOlder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, cursor, loadingOlder]);

  const openMedia = (m: Message) => {
    const base = {
      key: m.id,
      title: m.senderId === myUserId ? 'You' : m.senderName || title,
      timestamp: m.timestamp,
      mime: m.mediaEnvelope?.mime,
    };
    if (m.type === 'image') {
      if (m.mediaUri) setViewer({ ...base, kind: 'image', uri: m.mediaUri });
      return;
    }
    const poster = mediaMetaOf(m).poster;
    const posterUri = poster ? `data:image/jpeg;base64,${poster}` : undefined;
    if (m.mediaUri) {
      setViewer({ ...base, kind: 'video', uri: m.mediaUri, posterUri });
      return;
    }
    if (!m.mediaEnvelope) return;
    setViewer({ ...base, kind: 'video', posterUri });
    downloadAndDecryptMedia(m.mediaEnvelope)
      .then((localUri) => {
        dispatch(hydrateMessageMedia({ messageId: m.id, localUri }));
        setViewer((cur) => (cur?.key === m.id ? { ...cur, uri: localUri } : cur));
      })
      .catch(() =>
        setViewer((cur) =>
          cur?.key === m.id ? { ...cur, error: 'Could not load this video. Try again later.' } : cur,
        ),
      );
  };

  const openFile = async (m: Message) => {
    if (!m.mediaUri) return;
    try {
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(m.mediaUri);
    } catch {
      /* cancelled */
    }
  };

  const dateText = (iso: string) =>
    new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'header') {
      return (
        <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>
          {item.label.toUpperCase()}
        </Text>
      );
    }
    if (item.kind === 'grid') {
      return (
        <View style={styles.gridRow}>
          {item.items.map((m) => {
            const meta = mediaMetaOf(m);
            const thumb =
              m.type === 'image'
                ? m.mediaUri
                : meta.poster
                ? `data:image/jpeg;base64,${meta.poster}`
                : undefined;
            return (
              <TouchableOpacity
                key={m.id}
                onPress={() => openMedia(m)}
                activeOpacity={0.8}
                accessibilityRole="imagebutton"
                accessibilityLabel={`${m.type === 'video' ? 'Video' : 'Photo'}, ${dateText(m.timestamp)}`}
                style={{ width: cell, height: cell, backgroundColor: colors.surface }}
              >
                {thumb ? (
                  <Image source={{ uri: thumb }} style={{ width: cell, height: cell }} resizeMode="cover" />
                ) : (
                  <View style={styles.center}>
                    {m.type === 'image' ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <Ionicons name="videocam" size={24} color={colors.textSecondary} />
                    )}
                  </View>
                )}
                {m.type === 'video' && (
                  <View style={styles.durationPill}>
                    <Ionicons name="play" size={10} color="#fff" />
                    {!!meta.durationMs && (
                      <Text style={styles.durationText}>{formatDuration(meta.durationMs)}</Text>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }
    if (item.kind === 'file') {
      const m = item.message;
      return (
        <TouchableOpacity
          style={[styles.listRow, { borderBottomColor: colors.border }]}
          onPress={() => openFile(m)}
          disabled={!m.mediaUri}
          accessibilityRole="button"
        >
          <View style={[styles.iconSquare, { backgroundColor: colors.surface }]}>
            <Ionicons name="document-text-outline" size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
              {fileName(m)}
            </Text>
            <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
              {m.mediaUri ? dateText(m.timestamp) : `${dateText(m.timestamp)} · Downloading…`}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }
    if (item.kind === 'voice') {
      const m = item.message;
      const mine = m.senderId === myUserId;
      return (
        <View style={[styles.listRow, { borderBottomColor: colors.border }]}>
          <View style={[styles.voiceWrap, { backgroundColor: mine ? colors.primary : colors.surface }]}>
            <VoiceMessageBubble item={m} isMine={mine} colors={colors} onLongPress={() => {}} />
          </View>
          <Text style={[styles.rowSub, { color: colors.textSecondary }]}>{dateText(m.timestamp)}</Text>
        </View>
      );
    }
    return (
      <TouchableOpacity
        style={[styles.listRow, { borderBottomColor: colors.border }]}
        onPress={() => void Linking.openURL(item.url).catch(() => {})}
        accessibilityRole="link"
      >
        <View style={[styles.iconSquare, { backgroundColor: colors.surface }]}>
          <Ionicons name="link-outline" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.primary }]} numberOfLines={2}>
            {item.url}
          </Text>
          <Text style={[styles.rowSub, { color: colors.textSecondary }]}>
            {dateText(item.message.timestamp)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const emptyText: Record<Tab, string> = {
    media: 'No photos or videos in this chat yet.',
    files: 'No files in this chat yet.',
    voice: 'No voice messages in this chat yet.',
    links: 'No links in this chat yet.',
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
      </View>

      <View style={[styles.tabs, { borderBottomColor: colors.border }]} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, { borderBottomColor: on ? colors.primary : 'transparent' }]}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.tabText, { color: on ? colors.text : colors.textSecondary }]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderRow}
        onEndReached={loadOlder}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          loadingOlder || cursor ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            <Text style={[styles.empty, { color: colors.textSecondary }]}>{emptyText[tab]}</Text>
          )
        }
        ListFooterComponent={
          loadingOlder && rows.length > 0 ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: 16 }} />
          ) : null
        }
      />

      <MediaViewerModal item={viewer} onClose={() => setViewer(null)} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 11, borderBottomWidth: 2 },
  tabText: { fontSize: 14, fontWeight: '600' },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 8,
  },
  gridRow: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  durationPill: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  durationText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconSquare: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 2 },
  voiceWrap: { flex: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8 },
  empty: { textAlign: 'center', marginTop: 48, fontSize: 14, paddingHorizontal: 32 },
});
