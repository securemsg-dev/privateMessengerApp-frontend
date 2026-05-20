import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeContext';

interface Contact {
  id: string;
  name: string;
  phone: string;
}

export const CreateGroupScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');

  useEffect(() => {
    // Mock contacts — will be replaced with real DB query
    setContacts([
      { id: '1', name: 'Alice Smith', phone: '+1 234 567 890' },
      { id: '2', name: 'Bob Jones', phone: '+1 098 765 432' },
      { id: '3', name: 'Carlos Ruiz', phone: '+60 12-345 6789' },
      { id: '4', name: 'Dana Lee', phone: '+60 19-876 5432' },
      { id: '5', name: 'Eve Chen', phone: '+60 11-123 4567' },
    ]);
  }, []);

  const filtered = useMemo(
    () =>
      contacts.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.phone.includes(search),
      ),
    [contacts, search],
  );

  const toggleContact = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = () => {
    if (selectedIds.size < 2) {
      Alert.alert('Select Contacts', 'Please select at least 2 contacts to create a group.');
      return;
    }
    Alert.alert('Coming Soon', 'Group chat is under development.');
  };

  const selectedContacts = contacts.filter((c) => selectedIds.has(c.id));

  const renderContact = ({ item }: { item: Contact }) => {
    const isSelected = selectedIds.has(item.id);
    return (
      <TouchableOpacity
        style={[styles.contactRow, { borderBottomColor: colors.border }]}
        activeOpacity={0.7}
        onPress={() => toggleContact(item.id)}
      >
        <Ionicons
          name={isSelected ? 'checkbox' : 'square-outline'}
          size={22}
          color={isSelected ? colors.primary : colors.textSecondary}
        />
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
        </View>
        <View style={styles.contactInfo}>
          <Text style={[styles.contactName, { color: colors.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.contactPhone, { color: colors.textSecondary }]}>
            {item.phone}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

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
            <Text style={[styles.headerTitle, { color: colors.text }]}>Create Group</Text>
            {selectedIds.size > 0 && (
              <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
                {selectedIds.size} selected
              </Text>
            )}
          </View>
          <TouchableOpacity
            onPress={handleCreate}
            disabled={selectedIds.size < 2}
            style={{ opacity: selectedIds.size < 2 ? 0.4 : 1 }}
          >
            <Text style={[styles.createBtn, { color: colors.primary }]}>Create</Text>
          </TouchableOpacity>
        </View>

        {/* Group name input */}
        <View style={[styles.groupNameWrap, { backgroundColor: colors.surface }]}>
          <Ionicons name="people" size={20} color={colors.primary} />
          <TextInput
            style={[styles.groupNameInput, { color: colors.text }]}
            placeholder="Group name (optional)"
            placeholderTextColor={colors.textSecondary}
            value={groupName}
            onChangeText={setGroupName}
          />
        </View>

        {/* Selected chips */}
        {selectedContacts.length > 0 && (
          <View style={styles.chipsWrap}>
            {selectedContacts.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => toggleContact(c.id)}
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
        keyExtractor={(item) => item.id}
        renderItem={renderContact}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={52} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No contacts found
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
  emptyText: { fontSize: 15 },
});
