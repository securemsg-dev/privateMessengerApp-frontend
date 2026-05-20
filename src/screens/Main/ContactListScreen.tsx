import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SectionList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../../theme/ThemeContext';

interface Contact {
  id: string;
  name: string;
  phone: string;
  isRegistered: boolean;
}

function groupByLetter(contacts: Contact[]) {
  const map: Record<string, Contact[]> = {};
  contacts.forEach((c) => {
    const letter = c.name ? c.name.charAt(0).toUpperCase() : '#';
    if (!map[letter]) map[letter] = [];
    map[letter].push(c);
  });
  return Object.keys(map)
    .sort()
    .map((key) => ({ title: key, data: map[key] }));
}

export const ContactListScreen = () => {
  const { colors, isDark } = useTheme();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchContacts = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setContacts([
        { id: '1', name: 'Alice Smith', phone: '+1 234 567 890', isRegistered: true },
        { id: '2', name: 'Bob Jones', phone: '+1 098 765 432', isRegistered: false },
        { id: '3', name: 'Carlos Ruiz', phone: '+60 12-345 6789', isRegistered: true },
        { id: '4', name: 'Dana Lee', phone: '+60 19-876 5432', isRegistered: false },
        { id: '5', name: 'Eve Chen', phone: '+60 11-123 4567', isRegistered: true },
      ]);
      setLoading(false);
    };
    fetchContacts();
  }, []);

  const filtered = useMemo(
    () =>
      contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.phone.includes(search)
      ),
    [contacts, search]
  );

  const sections = useMemo(() => groupByLetter(filtered), [filtered]);

  const renderItem = ({ item }: { item: Contact }) => (
    <TouchableOpacity
      style={[styles.contactItem, { borderBottomColor: colors.border }]}
      activeOpacity={0.7}
    >
      <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
        <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
      </View>
      <View style={styles.contactInfo}>
        <Text style={[styles.contactName, { color: colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.contactPhone, { color: colors.textSecondary }]}>{item.phone}</Text>
      </View>
      {!item.isRegistered && (
        <TouchableOpacity style={[styles.inviteBtn, { borderColor: colors.primary }]}>
          <Text style={[styles.inviteBtnText, { color: colors.primary }]}>Invite</Text>
        </TouchableOpacity>
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
          <Text style={[styles.headerTitle, { color: colors.text }]}>Contacts</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerIcon}>
              <Ionicons name="funnel-outline" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerIcon}>
              <Ionicons name="ellipsis-vertical" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

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
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                Syncing contacts securely...
              </Text>
            </View>
          ) : search.length > 0 ? (
            <View style={styles.emptyLoading}>
              <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                No contacts found
              </Text>
            </View>
          ) : (
            <View style={styles.emptyOnboard}>
              <View style={[styles.emptyIconTile, { backgroundColor: colors.surface }]}>
                <Ionicons name="people-outline" size={28} color={colors.primary} />
              </View>

              <Text style={[styles.emptyHeadline, { color: colors.text }]}>
                No contacts yet.
              </Text>
              <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
                People you add will appear here. They need to be on PrivaChat — or you can invite them to join.
              </Text>

              <TouchableOpacity
                style={[styles.primaryPill, { backgroundColor: colors.primary }]}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.primaryPillText}>Add a contact</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.secondaryPill, { borderColor: colors.primary, backgroundColor: colors.background }]}
                activeOpacity={0.85}
              >
                <Ionicons name="shield-outline" size={16} color={colors.primary} />
                <Text style={[styles.secondaryPillText, { color: colors.primary }]}>
                  Share my private number
                </Text>
              </TouchableOpacity>

              <View style={[styles.howCard, { backgroundColor: colors.surface }]}>
                <Text style={[styles.howTitle, { color: colors.textSecondary }]}>
                  HOW CONTACTS WORK
                </Text>
                {[
                  'Share your 10-digit private number with someone.',
                  'They add you — or you add them — using that number.',
                  'No phone number or email is ever exchanged.',
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
      >
        <Ionicons name="person-add-outline" size={24} color="#fff" />
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
  inviteBtn: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  inviteBtnText: { fontSize: 13, fontWeight: '600' },
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
});
