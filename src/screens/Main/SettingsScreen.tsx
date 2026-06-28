import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Share,
  Alert,
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { useTheme } from '../../theme/ThemeContext';
import { Avatar } from '../../components/Avatar';

const ON_PRIMARY = '#ffffff';

type Colors = ReturnType<typeof useTheme>['colors'];

const formatPrivateNumber = (n: string | null) => {
  if (!n || n.length !== 10) return '— · —';
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

/* ─────────────────────────────────────────────────────────────
   Settings row — flat, grouped, no boxed cards
   ───────────────────────────────────────────────────────────── */
interface RowProps {
  icon: string;
  label: string;
  subtitle?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  destructive?: boolean;
  isLast?: boolean;
  colors: Colors;
}

const Row: React.FC<RowProps> = ({
  icon,
  label,
  subtitle,
  onPress,
  right,
  destructive,
  isLast,
  colors,
}) => (
  <TouchableOpacity
    style={[
      styles.row,
      !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    ]}
    onPress={onPress}
    activeOpacity={onPress ? 0.6 : 1}
  >
    <View style={[styles.rowIconWrap, { backgroundColor: colors.surface }]}>
      <Ionicons
        name={icon as any}
        size={18}
        color={destructive ? colors.danger : colors.text}
      />
    </View>
    <View style={styles.rowContent}>
      <Text
        style={[
          styles.rowLabel,
          { color: destructive ? colors.danger : colors.text },
        ]}
      >
        {label}
      </Text>
      {subtitle ? (
        <Text style={[styles.rowSub, { color: colors.textSecondary }]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
    {right !== undefined ? (
      right
    ) : onPress ? (
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    ) : null}
  </TouchableOpacity>
);

/* ─────────────────────────────────────────────────────────────
   Section header (uppercase tracking)
   ───────────────────────────────────────────────────────────── */
const SectionHeader = ({ label, colors }: { label: string; colors: Colors }) => (
  <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>{label}</Text>
);

export const SettingsScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const rawNum = useSelector((s: RootState) => s.auth.privateNumber);
  const displayName = useSelector((s: RootState) => s.auth.displayName) ?? 'You';
  const profilePictureKey = useSelector((s: RootState) => s.auth.profilePictureKey);

  const handleCopy = () => {
    if (!rawNum) return;
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    Clipboard.setString(rawNum);
    Alert.alert('Copied', 'Your private number is on the clipboard.');
  };

  const handleShare = async () => {
    if (!rawNum) return;
    try {
      await Share.share({
        message: `Message me privately on PrivaChat — my number is ${formatPrivateNumber(rawNum)}.`,
      });
    } catch {
      /* user cancelled */
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.kicker, { color: colors.textSecondary }]}>SIGNED IN</Text>
            <Text style={[styles.title, { color: colors.text }]}>You</Text>
          </View>
          <TouchableOpacity style={styles.headerIcon} activeOpacity={0.7}>
            <Ionicons name="qr-code-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ── Identity card ───────────────────────────────────── */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Profile')}
          style={[
            styles.identityCard,
            { backgroundColor: colors.primary },
            Platform.select({
              ios: {
                shadowColor: colors.primary,
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.3,
                shadowRadius: 16,
              },
              android: { elevation: 8 },
            }),
          ]}
        >
          <View style={styles.identityHeader}>
            <Avatar
              profilePictureKey={profilePictureKey}
              name={displayName}
              size={48}
              style={styles.identityAvatar}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.identityName} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={styles.identityBio}>No bio yet — tap to add</Text>
            </View>
          </View>

          <Text style={styles.identityLabel}>YOUR PRIVATE NUMBER</Text>
          <View style={styles.identityNumberRow}>
            <Text style={styles.identityNumber}>{formatPrivateNumber(rawNum)}</Text>
            <View style={styles.identityActions}>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={handleCopy}
                activeOpacity={0.85}
              >
                <Ionicons name="copy-outline" size={14} color={colors.primary} />
                <Text style={[styles.copyBtnText, { color: colors.primary }]}>Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={handleShare}
                activeOpacity={0.85}
              >
                <Ionicons name="share-outline" size={14} color={ON_PRIMARY} />
                <Text style={styles.shareBtnText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>

        {/* ── Preferences ─────────────────────────────────────── */}
        <SectionHeader label="PREFERENCES" colors={colors} />
        <View style={styles.group}>
          <Row
            colors={colors}
            icon="notifications-outline"
            label="Notifications"
            subtitle="All chats · sounds on"
            onPress={() => {}}
          />
          <Row
            colors={colors}
            icon="lock-closed-outline"
            label="Privacy & encryption"
            subtitle="App lock · read receipts"
            onPress={() => {}}
          />
          <Row
            colors={colors}
            icon="globe-outline"
            label="Language"
            right={
              <Text style={[styles.rowValue, { color: colors.textSecondary }]}>English</Text>
            }
            onPress={() => {}}
            isLast
          />
        </View>

        {/* ── Account ─────────────────────────────────────────── */}
        <SectionHeader label="ACCOUNT" colors={colors} />
        <View style={styles.group}>
          <Row
            colors={colors}
            icon="person-add-outline"
            label="Invite a friend"
            subtitle="Send your private number"
            onPress={handleShare}
            isLast
          />
        </View>

        {/* ── Footer hint ─────────────────────────────────────── */}
        <Text style={[styles.footer, { color: colors.textSecondary }]}>
          PrivaChat · v1.0  ·  end-to-end encrypted
        </Text>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },

  /* Header */
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
  },
  kicker: { fontSize: 11, fontWeight: '600', letterSpacing: 1.5, marginBottom: 2 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  headerIcon: { padding: 8 },

  scrollContent: { paddingBottom: 32 },

  /* Identity card */
  identityCard: {
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 24,
    padding: 20,
    borderRadius: 22,
  },
  identityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  identityAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityAvatarText: { color: ON_PRIMARY, fontSize: 15, fontWeight: '700' },
  identityName: { color: ON_PRIMARY, fontSize: 17, fontWeight: '700', marginBottom: 2 },
  identityBio: { color: 'rgba(255,255,255,0.75)', fontSize: 13 },
  identityLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.4,
    marginBottom: 6,
  },
  identityNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
  },
  identityNumber: {
    color: ON_PRIMARY,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  identityActions: { flexDirection: 'row', gap: 8 },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: ON_PRIMARY,
  },
  copyBtnText: { fontSize: 12, fontWeight: '700' },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  shareBtnText: { color: ON_PRIMARY, fontSize: 12, fontWeight: '700' },

  /* Sections */
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    paddingHorizontal: 20,
    marginBottom: 8,
    marginTop: 8,
  },
  group: {
    marginHorizontal: 16,
    marginBottom: 24,
  },

  /* Row */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 14,
    gap: 14,
  },
  rowIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '600', marginBottom: 1 },
  rowSub: { fontSize: 13 },
  rowValue: { fontSize: 14, fontWeight: '500' },

  footer: {
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
    marginTop: 8,
  },
});
