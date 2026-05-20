import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useDispatch, useSelector } from 'react-redux';
import { logoutThunk } from '../../store/slices/authSlice';
import { RootState, AppDispatch } from '../../store';
import { useTheme } from '../../theme/ThemeContext';
import { BottomSheet } from '../../components/BottomSheet';

const DANGER = '#e74c3c';

export const ProfileScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const dispatch = useDispatch<AppDispatch>();
  const rawNum = useSelector((s: RootState) => s.auth.privateNumber);
  const displayName = useSelector((s: RootState) => s.auth.displayName) ?? 'You';
  const fmt = (n: string) => `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6, 10)}`;

  const [bio, setBio] = useState('');
  const [showSignOut, setShowSignOut] = useState(false);
  const [keepHistory, setKeepHistory] = useState(true);

  const handleSignOut = () => {
    setShowSignOut(false);
    dispatch(logoutThunk());
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Profile</Text>
          <TouchableOpacity>
            <Ionicons name="pencil-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <TouchableOpacity style={styles.avatarWrap} activeOpacity={0.8}>
            <View style={[styles.avatar, { backgroundColor: colors.surface }]}>
              <Ionicons name="person" size={44} color={colors.textSecondary} />
            </View>
            <View style={[styles.cameraOverlay, { backgroundColor: colors.primary }]}>
              <Ionicons name="camera-outline" size={14} color="#fff" />
            </View>
          </TouchableOpacity>
          <Text style={[styles.displayName, { color: colors.text }]}>{displayName}</Text>
          <Text style={[styles.privateNumber, { color: colors.textSecondary }]}>
            {rawNum ? fmt(rawNum) : '—'}
          </Text>
        </View>

        {/* Bio */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.primary }]}>Bio</Text>
          <View style={[styles.bioWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TextInput
              style={[styles.bioInput, { color: colors.text }]}
              placeholder="Write about yourself..."
              placeholderTextColor={colors.textSecondary}
              multiline
              maxLength={128}
              value={bio}
              onChangeText={setBio}
            />
            <Text style={[styles.charCount, { color: colors.textSecondary }]}>{128 - bio.length}</Text>
          </View>
          <Text style={[styles.bioHint, { color: colors.textSecondary }]}>
            You can write a few lines or leave it blank.
          </Text>
        </View>

        {/* Menu items */}
        <View style={[styles.menuCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity style={[styles.menuRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.menuLabel, { color: colors.primary }]}>Share Private Number</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.border} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.menuRow, { borderBottomColor: colors.border }]}>
            <Text style={[styles.menuLabel, { color: colors.text }]}>Change Password</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.border} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuRowLast}
            onPress={() => setShowSignOut(true)}
          >
            <Text style={[styles.menuLabel, { color: DANGER }]}>Sign Out</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.border} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Sign Out bottom sheet */}
      <BottomSheet visible={showSignOut} onClose={() => setShowSignOut(false)}>
        <View>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>Sign Out</Text>
          <View style={[styles.toggleRow, { backgroundColor: colors.background }]}>
            <Text style={[styles.toggleLabel, { color: colors.text }]}>
              Keep message history on this device
            </Text>
            <Switch
              value={keepHistory}
              onValueChange={setKeepHistory}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
          <View style={styles.sheetBtns}>
            <TouchableOpacity
              style={[styles.sheetBtnCancel, { borderColor: colors.border }]}
              onPress={() => setShowSignOut(false)}
            >
              <Text style={[styles.sheetBtnCancelText, { color: colors.textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetBtnSignOut, { backgroundColor: DANGER }]}
              onPress={handleSignOut}
            >
              <Text style={styles.sheetBtnSignOutText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </BottomSheet>
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
  headerTitle: { fontSize: 18, fontWeight: '700' },
  scrollContent: { padding: 24, gap: 24 },
  avatarSection: { alignItems: 'center', gap: 8 },
  avatarWrap: { position: 'relative', marginBottom: 8 },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  displayName: { fontSize: 22, fontWeight: '700' },
  privateNumber: { fontSize: 15 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 14, fontWeight: '600' },
  bioWrap: { borderWidth: 1, borderRadius: 12, padding: 12 },
  bioInput: { fontSize: 15, minHeight: 60 },
  charCount: { fontSize: 12, textAlign: 'right', marginTop: 4 },
  bioHint: { fontSize: 13 },
  menuCard: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  menuRowLast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  menuLabel: { fontSize: 15, fontWeight: '500' },
  deleteNote: { fontSize: 12, lineHeight: 18 },
  sheetTitle: { fontSize: 22, fontWeight: '700', marginBottom: 20 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  toggleLabel: { fontSize: 15, flex: 1, marginRight: 12 },
  sheetBtns: { flexDirection: 'row', gap: 12 },
  sheetBtnCancel: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sheetBtnCancelText: { fontSize: 15, fontWeight: '600' },
  sheetBtnSignOut: {
    flex: 1,
    borderRadius: 28,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sheetBtnSignOutText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
