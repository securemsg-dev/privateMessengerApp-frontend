import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SectionList,
  Modal,
  Alert,
  Share,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import { useSelector } from 'react-redux';

import { useTranslation } from 'react-i18next';
import { useTheme } from '../../theme/ThemeContext';
import { RootState } from '../../store';
import {
  ApiError,
  createConversationApi,
  lookupContactApi,
} from '../../services/api';
import {
  getContacts,
  saveContact,
  deleteContact,
} from '../../services/database';

interface Contact {
  id: string;
  name: string;
  /** The contact's 10-digit PrivaChat private number (stored in the legacy `phone` column). */
  privateNumber: string;
  /** The contact's profile bio, refreshed on lookup. Null when they have none. */
  bio: string | null;
}

interface ContactRow {
  id: string;
  name: string;
  phone: string;
  bio: string | null;
}

const formatNumber = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
};

function groupByLetter(contacts: Contact[]) {
  const map: Record<string, Contact[]> = {};
  contacts.forEach((c) => {
    const letter = /^[a-z]/i.test(c.name) ? c.name.charAt(0).toUpperCase() : '#';
    if (!map[letter]) map[letter] = [];
    map[letter].push(c);
  });
  return Object.keys(map)
    .sort()
    .map((key) => ({ title: key, data: map[key] }));
}

export const ContactListScreen = () => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const myPrivateNumber = useSelector((s: RootState) => s.auth.privateNumber);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);

  // Add-contact modal state
  const [addVisible, setAddVisible] = useState(false);
  const [digits, setDigits] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const refreshContacts = useCallback(async () => {
    const rows = (await getContacts()) as ContactRow[];
    setContacts(
      rows
        .map((r) => ({
          id: r.id,
          name: r.name || formatNumber(r.phone),
          privateNumber: r.phone,
          bio: r.bio ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshContacts();
  }, [refreshContacts]);

  const filtered = useMemo(
    () =>
      contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.privateNumber.includes(search.replace(/\D/g, '')),
      ),
    [contacts, search],
  );

  const sections = useMemo(() => groupByLetter(filtered), [filtered]);

  /* ── Add contact ────────────────────────────────────────────────────── */

  const rawDigits = digits.replace(/\D/g, '').slice(0, 10);
  const isValidNumber = rawDigits.length === 10 && rawDigits !== myPrivateNumber;

  const openAddModal = () => {
    setDigits('');
    setAddError(null);
    setAddVisible(true);
  };

  const handleAddContact = async () => {
    if (!isValidNumber || addBusy) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const lookup = await lookupContactApi(rawDigits);
      if (!lookup.found || !lookup.user) {
        setAddError(t('contacts.noUserFound'));
        return;
      }
      const user = lookup.user;
      await saveContact(
        user.id,
        user.display_name || formatNumber(user.private_number),
        user.private_number,
        true,
        user.bio,
      );
      setAddVisible(false);
      await refreshContacts();
    } catch (err) {
      setAddError(
        err instanceof ApiError ? err.detail : t('contacts.lookupFailed'),
      );
    } finally {
      setAddBusy(false);
    }
  };

  /* ── Open chat / remove ─────────────────────────────────────────────── */

  const handleOpenChat = async (contact: Contact) => {
    if (openingId) return;
    setOpeningId(contact.id);
    try {
      // Fresh lookup so we always carry the contact's current public key
      // (required for E2EE) and latest display name into the chat.
      const lookup = await lookupContactApi(contact.privateNumber);
      if (!lookup.found || !lookup.user) {
        Alert.alert(
          t('contacts.contactUnavailableTitle'),
          t('contacts.contactUnavailableBody'),
          [
            { text: t('common.keep'), style: 'cancel' },
            {
              text: t('common.remove'),
              style: 'destructive',
              onPress: async () => {
                await deleteContact(contact.id);
                await refreshContacts();
              },
            },
          ],
        );
        return;
      }
      const conv = await createConversationApi(contact.privateNumber);
      const other = conv.other_participant ?? lookup.user;
      // Refresh the cached name/bio so the Contacts list stays current.
      await saveContact(
        other.id,
        other.display_name || formatNumber(other.private_number),
        other.private_number,
        true,
        other.bio,
      );
      navigation.navigate('ChatScreen', {
        conversationId: conv.id,
        contactName: other.display_name || formatNumber(other.private_number),
        contactPrivateNumber: other.private_number,
        contactPublicKey: other.public_key ?? null,
        isSelfChat: false,
      });
    } catch (err) {
      Alert.alert(
        t('contacts.couldNotOpenChat'),
        err instanceof ApiError ? err.detail : t('contacts.checkConnection'),
      );
    } finally {
      setOpeningId(null);
    }
  };

  const handleLongPress = (contact: Contact) => {
    Alert.alert(t('contacts.removeContactTitle'), t('contacts.removeContactBody', { name: contact.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: async () => {
          await deleteContact(contact.id);
          await refreshContacts();
        },
      },
    ]);
  };

  const handleShareNumber = async () => {
    if (!myPrivateNumber) return;
    try {
      await Share.share({
        message: t('contacts.shareInvite', { number: formatNumber(myPrivateNumber) }),
      });
    } catch {
      /* user dismissed the share sheet */
    }
  };

  /* ── Render ─────────────────────────────────────────────────────────── */

  const renderItem = ({ item }: { item: Contact }) => (
    <TouchableOpacity
      style={[styles.contactItem, { borderBottomColor: colors.border }]}
      activeOpacity={0.7}
      onPress={() => handleOpenChat(item)}
      onLongPress={() => handleLongPress(item)}
    >
      <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
        <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.contactInfo}>
        <Text style={[styles.contactName, { color: colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.contactPhone, { color: colors.textSecondary }]} numberOfLines={1}>
          {item.bio ? `${formatNumber(item.privateNumber)} · ${item.bio}` : formatNumber(item.privateNumber)}
        </Text>
      </View>
      {openingId === item.id ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Ionicons name="chatbubble-outline" size={20} color={colors.textSecondary} />
      )}
    </TouchableOpacity>
  );

  const renderSectionHeader = ({ section }: { section: { title: string } }) => (
    <View style={[styles.sectionHeader, { backgroundColor: colors.background }]}>
      <Text style={[styles.sectionHeaderText, { color: colors.primary }]}>{section.title}</Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('contacts.title')}</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerIcon} onPress={handleShareNumber}>
              <Ionicons name="share-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIcon} onPress={openAddModal}>
              <Ionicons name="person-add-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search bar */}
        <View style={[styles.searchBar, { backgroundColor: colors.surface }]}>
          <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder={t('contacts.searchPlaceholder')}
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

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loading ? (
            <View style={styles.emptyLoading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : search.length > 0 ? (
            <View style={styles.emptyLoading}>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                {t('contacts.noContactsFound')}
              </Text>
            </View>
          ) : (
            <View style={styles.emptyOnboard}>
              <View style={[styles.emptyIconTile, { backgroundColor: colors.surface }]}>
                <Ionicons name="people-outline" size={28} color={colors.primary} />
              </View>

              <Text style={[styles.emptyHeadline, { color: colors.text }]}>
                {t('contacts.emptyHeadline')}
              </Text>
              <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                {t('contacts.emptyBody')}
              </Text>

              <TouchableOpacity
                style={[styles.primaryPill, { backgroundColor: colors.primary }]}
                activeOpacity={0.85}
                onPress={openAddModal}
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.primaryPillText}>{t('contacts.addContact')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryPill, { borderColor: colors.primary, backgroundColor: colors.background }]}
                activeOpacity={0.85}
                onPress={handleShareNumber}
              >
                <Ionicons name="shield-outline" size={16} color={colors.primary} />
                <Text style={[styles.secondaryPillText, { color: colors.primary }]}>
                  {t('contacts.shareMyNumber')}
                </Text>
              </TouchableOpacity>

              <View style={[styles.howCard, { backgroundColor: colors.surface }]}>
                <Text style={[styles.howTitle, { color: colors.textSecondary }]}>
                  {t('contacts.howTitle')}
                </Text>
                {[
                  t('contacts.howStep1'),
                  t('contacts.howStep2'),
                  t('contacts.howStep3'),
                ].map((step, i) => (
                  <View key={i} style={styles.howStep}>
                    <View style={[styles.howNumWrap, { backgroundColor: `${colors.primary}1A` }]}>
                      <Text style={[styles.howNum, { color: colors.primary }]}>{i + 1}</Text>
                    </View>
                    <Text style={[styles.howStepText, { color: colors.text }]}>{step}</Text>
                  </View>
                ))}
              </View>
            </View>
          )
        }
      />

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: colors.primary }]}
        activeOpacity={0.85}
        onPress={openAddModal}
      >
        <Ionicons name="person-add-outline" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Add-contact modal */}
      <Modal
        visible={addVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAddVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.background }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('contacts.addContactTitle')}</Text>
            <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
              {t('contacts.modalSubtitle')}
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  color: colors.text,
                  borderBottomColor: rawDigits.length > 0 ? colors.primary : colors.border,
                },
              ]}
              value={formatNumber(rawDigits)}
              onChangeText={(v) => {
                setDigits(v.replace(/\D/g, '').slice(0, 10));
                if (addError) setAddError(null);
              }}
              keyboardType="number-pad"
              placeholder="00-0000-0000"
              placeholderTextColor={colors.textSecondary}
              autoFocus
              maxLength={12}
            />
            {rawDigits === myPrivateNumber && rawDigits.length === 10 && (
              <Text style={[styles.modalError, { color: colors.error }]}>
                {t('contacts.ownNumberError')}
              </Text>
            )}
            {addError && (
              <Text style={[styles.modalError, { color: colors.error }]}>{addError}</Text>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={() => setAddVisible(false)}
                disabled={addBusy}
              >
                <Text style={[styles.modalBtnText, { color: colors.textSecondary }]}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modalBtn,
                  styles.modalBtnPrimary,
                  {
                    backgroundColor: isValidNumber ? colors.primary : colors.border,
                  },
                ]}
                onPress={handleAddContact}
                disabled={!isValidNumber || addBusy}
              >
                {addBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: '#fff' }]}>{t('common.add')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  headerRight: { flexDirection: 'row', gap: 8 },
  headerIcon: { padding: 4 },
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
  listContent: { paddingBottom: 100 },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  sectionHeaderText: { fontSize: 13, fontWeight: '700' },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 16, fontWeight: '600', marginBottom: 3 },
  contactPhone: { fontSize: 14 },
  emptyLoading: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontSize: 15 },
  emptyOnboard: {
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 32,
  },
  emptyIconTile: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyHeadline: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  primaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    marginBottom: 10,
  },
  primaryPillText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 24,
    borderWidth: 1.5,
    marginBottom: 28,
  },
  secondaryPillText: { fontSize: 14, fontWeight: '600' },
  howCard: {
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  howTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  howStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  howNumWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  howNum: { fontSize: 12, fontWeight: '700' },
  howStepText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
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
  /* Add-contact modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  modalCard: {
    width: '100%',
    borderRadius: 20,
    padding: 22,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modalSubtitle: { fontSize: 13, marginBottom: 18 },
  modalInput: {
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 2,
    borderBottomWidth: 2,
    paddingVertical: 10,
  },
  modalError: { fontSize: 13, marginTop: 10, textAlign: 'center' },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 22,
  },
  modalBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 22,
    minWidth: 84,
    alignItems: 'center',
  },
  modalBtnPrimary: {},
  modalBtnText: { fontSize: 15, fontWeight: '700' },
});
