import React, { useCallback, useEffect, useState } from 'react';
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
import { ApiError, CallDTO, listCallsApi } from '../../services/api';
import { RootState } from '../../store';

type CallDirection = 'incoming' | 'outgoing';

interface DisplayCall {
  id: string;
  direction: CallDirection;
  /** UUID of the OTHER party — used as a label until we have a name lookup. */
  peerUserId: string | null;
  endReason: CallDTO['end_reason'];
  startedAt: string;
  durationSeconds: number | null;
}

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

const labelForReason = (
  reason: CallDTO['end_reason'],
  direction: CallDirection,
): string => {
  if (reason === 'missed' && direction === 'incoming') return 'Missed';
  if (reason === 'declined') return direction === 'incoming' ? 'Declined' : 'Declined';
  if (reason === 'cancelled') return 'Cancelled';
  if (reason === 'failed') return 'Failed';
  if (reason === 'completed') return 'Completed';
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
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const rows = await listCallsApi();
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
          endReason: c.end_reason,
          startedAt: c.started_at,
          durationSeconds: dur,
        };
      });
      setCalls(display);
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail : 'Failed to load calls';
      setError(detail);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [myUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  const renderItem = ({ item }: { item: DisplayCall }) => {
    const missed = isMissed(item.endReason, item.direction);
    const reasonText = labelForReason(item.endReason, item.direction);
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
            {item.peerUserId ? `User ${item.peerUserId.slice(0, 8)}…` : 'Unknown'}
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
      ) : error && calls.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.danger }]}>{error}</Text>
        </View>
      ) : calls.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIconWrap, { backgroundColor: colors.surface }]}>
            <Ionicons name="call-outline" size={52} color={colors.textSecondary} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>
            No call history
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Make your first encrypted call
          </Text>
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
      >
        <Ionicons name="keypad-outline" size={24} color="#fff" />
      </TouchableOpacity>
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
  errorText: { fontSize: 14 },

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
