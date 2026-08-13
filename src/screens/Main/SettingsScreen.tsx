import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Share,
  Switch,
  Alert,
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { RootState, AppDispatch } from '../../store';
import {
  Language,
  setLanguageThunk,
  setNotificationsEnabledThunk,
} from '../../store/slices/settingsSlice';
import { deleteAccountThunk } from '../../store/slices/authSlice';
import { useTheme } from '../../theme/ThemeContext';
import { Avatar } from '../../components/Avatar';
import { BottomSheet } from '../../components/BottomSheet';

const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '简体中文' },
];

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
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const dispatch = useDispatch<AppDispatch>();
  const rawNum = useSelector((s: RootState) => s.auth.privateNumber);
  const displayName = useSelector((s: RootState) => s.auth.displayName) ?? t('tabs.you');
  const profilePictureKey = useSelector((s: RootState) => s.auth.profilePictureKey);
  const bio = useSelector((s: RootState) => s.auth.bio);
  const notificationsEnabled = useSelector((s: RootState) => s.settings.notificationsEnabled);
  const language = useSelector((s: RootState) => s.settings.language);

  const [languageSheetVisible, setLanguageSheetVisible] = useState(false);

  const handleCopy = () => {
    if (!rawNum) return;
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    Clipboard.setString(rawNum);
    Alert.alert(t('settings.copiedTitle'), t('settings.copiedBody'));
  };

  const handleShare = async () => {
    if (!rawNum) return;
    try {
      await Share.share({
        message: t('settings.shareMessage', { number: formatPrivateNumber(rawNum) }),
      });
    } catch {
      /* user cancelled */
    }
  };

  const handleSelectLanguage = (code: Language) => {
    setLanguageSheetVisible(false);
    if (code !== language) dispatch(setLanguageThunk(code));
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account, messages, media, and contacts '
        + 'from this device and our servers. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            const r = await dispatch(deleteAccountThunk());
            if (deleteAccountThunk.rejected.match(r)) {
              Alert.alert(
                'Deletion failed',
                (r.payload as string | undefined) ?? 'Please try again.',
              );
            }
            // On success the auth state clears and RootNavigator returns to
            // the welcome screen automatically.
          },
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.kicker, { color: colors.textSecondary }]}>{t('settings.signedIn')}</Text>
            <Text style={[styles.title, { color: colors.text }]}>{t('settings.title')}</Text>
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
              <Text style={styles.identityBio} numberOfLines={1}>
                {bio || t('settings.noBioYet')}
              </Text>
            </View>
          </View>

          <Text style={styles.identityLabel}>{t('settings.yourPrivateNumber')}</Text>
          <View style={styles.identityNumberRow}>
            <Text style={styles.identityNumber}>{formatPrivateNumber(rawNum)}</Text>
            <View style={styles.identityActions}>
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={handleCopy}
                activeOpacity={0.85}
              >
                <Ionicons name="copy-outline" size={14} color={colors.primary} />
                <Text style={[styles.copyBtnText, { color: colors.primary }]}>{t('settings.copy')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.shareBtn}
                onPress={handleShare}
                activeOpacity={0.85}
              >
                <Ionicons name="share-outline" size={14} color={ON_PRIMARY} />
                <Text style={styles.shareBtnText}>{t('settings.share')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>

        {/* ── Preferences ─────────────────────────────────────── */}
        <SectionHeader label={t('settings.preferences')} colors={colors} />
        <View style={styles.group}>
          <Row
            colors={colors}
            icon="notifications-outline"
            label={t('settings.notifications')}
            subtitle={notificationsEnabled ? t('common.on') : t('common.off')}
            onPress={() => dispatch(setNotificationsEnabledThunk(!notificationsEnabled))}
            right={
              <Switch
                value={notificationsEnabled}
                onValueChange={(v) => {
                  dispatch(setNotificationsEnabledThunk(v));
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            }
          />
          <Row
            colors={colors}
            icon="lock-closed-outline"
            label={t('settings.privacy')}
            subtitle={t('settings.privacySubtitle')}
            onPress={() => {}}
          />
          <Row
            colors={colors}
            icon="globe-outline"
            label={t('settings.language')}
            right={
              <Text style={[styles.rowValue, { color: colors.textSecondary }]}>
                {t('settings.languageName')}
              </Text>
            }
            onPress={() => setLanguageSheetVisible(true)}
            isLast
          />
        </View>

        {/* ── Safety ──────────────────────────────────────────
            Blocking and reporting are Google Play UGC policy requirements;
            the reporting flow itself lives in each chat's ⋮ menu. */}
        <SectionHeader label="SAFETY" colors={colors} />
        <View style={styles.group}>
          <Row
            colors={colors}
            icon="ban-outline"
            label="Blocked users"
            subtitle="Manage who can't contact you"
            onPress={() => navigation.navigate('BlockedUsers')}
            isLast
          />
        </View>

        {/* ── Account ─────────────────────────────────────────── */}
        <SectionHeader label={t('settings.account')} colors={colors} />
        <View style={styles.group}>
          <Row
            colors={colors}
            icon="person-add-outline"
            label={t('settings.inviteFriend')}
            subtitle={t('settings.inviteSubtitle')}
            onPress={handleShare}
          />
          <Row
            colors={colors}
            icon="trash-outline"
            label="Delete account"
            subtitle="Permanently delete your account and data"
            onPress={handleDeleteAccount}
            destructive
            isLast
          />
        </View>

        {/* ── Footer hint ─────────────────────────────────────── */}
        <Text style={[styles.footer, { color: colors.textSecondary }]}>
          Cricchat · v1.0  ·  end-to-end encrypted
        </Text>
      </ScrollView>

      {/* Language picker */}
      <BottomSheet visible={languageSheetVisible} onClose={() => setLanguageSheetVisible(false)}>
        <View>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>
            {t('settings.chooseLanguage')}
          </Text>
          {LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang.code}
              style={[styles.languageRow, { backgroundColor: colors.background }]}
              onPress={() => handleSelectLanguage(lang.code)}
              activeOpacity={0.7}
            >
              <Text style={[styles.languageLabel, { color: colors.text }]}>{lang.label}</Text>
              {language === lang.code ? (
                <Ionicons name="checkmark" size={20} color={colors.primary} />
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      </BottomSheet>
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

  /* Language sheet */
  sheetTitle: { fontSize: 22, fontWeight: '700', marginBottom: 20 },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
  },
  languageLabel: { fontSize: 15, fontWeight: '600' },
});
