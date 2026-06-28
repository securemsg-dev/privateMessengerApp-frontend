import React, { useCallback, useEffect, useState } from 'react';
import { DialpadModal } from '../../components/DialpadModal';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSelector } from 'react-redux';

import { useTheme } from '../../theme/ThemeContext';
import { CallDTO, listCallsApi } from '../../services/api';
import { getContacts } from '../../services/database';
import { cacheGet, cacheSet, CACHE_KEYS } from '../../services/cache';
import { RootState } from '../../store';

type CallDirection = 'incoming' | 'outgoing';

interface DisplayCall {
  id: string;
  direction: CallDirection;
  /** UUID of the OTHER party — last-resort label when nothing else resolves. */
  peerUserId: string | null;
  /** Display name: server-resolved (users table) or local contacts override. */
  peerName: string | null;
  /** The peer's private number, resolved server-side — formatted as fallback. */
  peerPrivateNumber: string | null;
  endReason: CallDTO['end_reason'];
  startedAt: string;
  acceptedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
}

// A call row with no end_reason that started this long ago can't still be
// ringing — treat it as unanswered instead of "In progress" forever.
const STALE_CALL_MS = 2 * 60_000;

// Mirror the XX-XXXX-XXXX private-number grouping used across the app.
const formatNumber = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
};

const formatRelative = (iso: string): string => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const diffDays = (now.getTime() - d.getTime()) / 86_400_000;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const formatDuration = (secs: number): string => {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
};

const labelForReason = (call: DisplayCall): string => {
  const { endReason: reason, direction } = call;
  if (reason === 'missed') return direction === 'incoming' ? 'Missed' : 'No answer';
  if (reason === 'declined') return direction === 'incoming' ? 'Declined' : 'Declined';
  if (reason === 'cancelled') return 'Cancelled';
  if (reason === 'failed') return 'Failed';
  if (reason === 'completed') return 'Completed';
  // No end reason recorded. Old rows (e.g. from a client that crashed
  // mid-setup) can't still be live — show them as unanswered/ended.
  const ageMs = Date.now() - new Date(call.startedAt).getTime();
  if (ageMs > STALE_CALL_MS) {
    return call.acceptedAt ? 'Ended' : 'Not answered';
  }
  return 'In progress';
};

const isMissed = (reason: CallDTO['end_reason'], direction: CallDirection) =>
  direction === 'incoming' && (reason === 'missed' || reason === 'declined');

export const CallsScreen = () => {
  const { colors, isDark } = useTheme();
  const myUserId = useSelector((s: RootState) => s.auth.userId);

  const [calls, setCalls] = useState<DisplayCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dialpadVisible, setDialpadVisible] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rows, contactRows] = await Promise.all([
        listCallsApi(),
        getContacts() as Promise<{ id: string; name: string }[]>,
      ]);
      // Contact ids ARE user UUIDs (saved from lookup results), so call
      // participants resolve to names directly.
      const nameById = new Map(contactRows.map((c) => [c.id, c.name]));

      const display: DisplayCall[] = rows.map((c) => {
        const direction: CallDirection =
          c.caller_id === myUserId ? 'outgoing' : 'incoming';
        const peer = direction === 'outgoing' ? c.callee_id : c.caller_id;
        const dur =
          c.accepted_at && c.ended_at
            ? Math.floor(
                (new Date(c.ended_at).getTime() -
                  new Date(c.accepted_at).getTime()) /
                  1000,
              )
            : null;
        return {
          id: c.id,
          direction,
          peerUserId: peer,
          // Prefer a local contact alias, then the server-resolved name.
          peerName:
            (peer ? nameById.get(peer) : null) ?? c.peer_display_name ?? null,
          peerPrivateNumber: c.peer_private_number ?? null,
          endReason: c.end_reason,
          startedAt: c.started_at,
          acceptedAt: c.accepted_at,
          endedAt: c.ended_at,
          durationSeconds: dur,
        };
      });
      setCalls(display);
      void cacheSet(CACHE_KEYS.callLog, display);
    } catch {
      // silently fall through — empty state handles no-calls UI
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [myUserId]);

  // Paint the cached call log instantly on open, then refresh from the network.
  useEffect(() => {
    let active = true;
    cacheGet<DisplayCall[]>(CACHE_KEYS.callLog).then((cached) => {
      if (!active || !cached) return;
      setCalls((prev) => (prev.length ? prev : cached));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const renderItem = ({ item }: { item: DisplayCall }) => {
    const missed = isMissed(item.endReason, item.direction);
    const reasonText = labelForReason(item);
    return (
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <View style={[styles.avatar, { backgroundColor: colors.surface }]}>
          <Ionicons
            name={item.direction === 'outgoing' ? 'arrow-up' : 'arrow-down'}
            size={16}
            color={missed ? colors.danger : colors.textSecondary}
          />
        </View>
        <View style={styles.rowMain}>
          <Text
            style={[
              styles.peerLabel,
              { color: missed ? colors.danger : colors.text },
            ]}
            numberOfLines={1}
          >
            {item.peerName ||
              (item.peerPrivateNumber
                ? formatNumber(item.peerPrivateNumber)
                : 'Unknown')}
          </Text>
          <Text style={[styles.subLabel, { color: colors.textSecondary }]}>
            {reasonText}
            {item.durationSeconds !== null
              ? ` · ${formatDuration(item.durationSeconds)}`
              : ''}
          </Text>
        </View>
        <Text style={[styles.timeLabel, { color: colors.textSecondary }]}>
          {formatRelative(item.startedAt)}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Calls</Text>
          <TouchableOpacity>
            <Ionicons name="search-outline" size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {loading && calls.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : calls.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIconWrap, { backgroundColor: colors.surface }]}>
            <Ionicons name="call-outline" size={52} color={colors.textSecondary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No calls yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Your call history will appear here
          </Text>
          <TouchableOpacity
            style={[styles.emptyCallBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.85}
            onPress={() => setDialpadVisible(true)}
          >
            <Ionicons name="keypad-outline" size={18} color="#fff" />
            <Text style={[styles.emptyCallBtnText, { color: '#fff' }]}>Start a new call</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.primary}
            />
          }
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        activeOpacity={0.85}
        onPress={() => setDialpadVisible(true)}
      >
        <Ionicons name="keypad-outline" size={24} color="#fff" />
      </TouchableOpacity>

      <DialpadModal visible={dialpadVisible} onClose={() => setDialpadVisible(false)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 22, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  /* Row */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowMain: { flex: 1 },
  peerLabel: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  subLabel: { fontSize: 13 },
  timeLabel: { fontSize: 12, marginLeft: 8 },

  /* Empty state */
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  emptyIconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  emptySubtitle: { fontSize: 15, textAlign: 'center' },
  emptyCallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  emptyCallBtnText: { fontSize: 15, fontWeight: '600' },

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
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
});
