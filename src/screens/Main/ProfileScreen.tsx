import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Image,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
// expo-file-system v19 (Expo SDK 54) reshaped its API — the imperative helpers
// used here (cacheDirectory / getInfoAsync with size) live under the legacy entry.
import * as FileSystem from 'expo-file-system/legacy';

import { logoutThunk, setProfilePictureKey, setBio as setBioAction } from '../../store/slices/authSlice';
import { withoutAppLock } from '../../utils/appLockGuard';
import { RootState, AppDispatch } from '../../store';
import { useTheme } from '../../theme/ThemeContext';
import { BottomSheet } from '../../components/BottomSheet';
import {
  getMeApi,
  patchMeApi,
  requestMediaUploadApi,
  uploadBlobBytesApi,
  buildAvatarUrl,
  TOKEN_KEY,
} from '../../services/api';
import * as SecureStore from '../../utils/secureStorage';

const DANGER = '#e74c3c';

function avatarCachePath(blobId: string): string {
  return `${FileSystem.cacheDirectory}avatar_${blobId}.jpg`;
}

export const ProfileScreen = () => {
  const { colors, isDark } = useTheme();
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const dispatch = useDispatch<AppDispatch>();
  const rawNum = useSelector((s: RootState) => s.auth.privateNumber);
  const displayName = useSelector((s: RootState) => s.auth.displayName) ?? t('tabs.you');
  const fmt = (n: string) => `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6, 10)}`;

  const [bio, setBio] = useState('');
  // Last server-persisted bio — the Save button shows only when they differ.
  const [savedBio, setSavedBio] = useState('');
  const [savingBio, setSavingBio] = useState(false);
  const [showSignOut, setShowSignOut] = useState(false);
  const [keepHistory, setKeepHistory] = useState(true);

  // Avatar state
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarBlobId, setAvatarBlobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // On mount: fetch profile to get current avatar blob id, then load from cache
  useEffect(() => {
    getMeApi()
      .then((me) => {
        if (me.profile_picture_key) {
          setAvatarBlobId(me.profile_picture_key);
        }
        // Mirror into the store so the avatar shows on the Settings card too.
        dispatch(setProfilePictureKey(me.profile_picture_key ?? null));
        setBio(me.bio ?? '');
        setSavedBio(me.bio ?? '');
        dispatch(setBioAction(me.bio ?? null));
      })
      .catch(() => { /* non-critical — profile still renders without avatar */ });
  }, [dispatch]);

  // Whenever avatarBlobId changes, ensure the image is in local cache
  const loadAvatar = useCallback(async (blobId: string) => {
    const localPath = avatarCachePath(blobId);
    const info = await FileSystem.getInfoAsync(localPath);
    if (info.exists) {
      setAvatarUri(localPath);
      return;
    }
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    try {
      const result = await FileSystem.downloadAsync(
        buildAvatarUrl(blobId),
        localPath,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      setAvatarUri(result.uri);
    } catch {
      // Download failed — leave avatarUri null, icon shows instead
    }
  }, []);

  useEffect(() => {
    if (avatarBlobId) loadAvatar(avatarBlobId);
  }, [avatarBlobId, loadAvatar]);

  const handlePickAvatar = async () => {
    setUploadError(null);

    // Request permission + pick with the app lock suppressed, so the brief
    // background while the system picker is open doesn't force a PIN re-entry.
    const result = await withoutAppLock(async () => {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('profile.permissionNeededTitle'), t('profile.permissionNeededBody'));
        return null;
      }
      return ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
    });
    if (!result || result.canceled || !result.assets.length) return;

    const asset = result.assets[0];
    setUploading(true);

    try {
      // Get accurate file size from disk (post-compression).
      // size is always included on the result for existing files (the legacy
      // `{ size: true }` option was removed in expo-file-system v19).
      const fileInfo = await FileSystem.getInfoAsync(asset.uri);
      const sizeBytes = (fileInfo as any).size as number;

      if (!sizeBytes || sizeBytes === 0) {
        throw new Error('Could not read image file size');
      }

      // 1. Reserve upload slot
      const reservation = await requestMediaUploadApi({ size_bytes: sizeBytes, mime: 'image/jpeg' });

      // 2. Upload raw bytes via PUT
      await uploadBlobBytesApi(reservation.upload_url, asset.uri);

      // 3. Save blob id on the user profile
      await patchMeApi({ profile_picture_key: reservation.blob_id });

      // 4. Cache the picked image locally (no second download needed)
      const localPath = avatarCachePath(reservation.blob_id);
      await FileSystem.copyAsync({ from: asset.uri, to: localPath });

      setAvatarBlobId(reservation.blob_id);
      setAvatarUri(localPath);
      dispatch(setProfilePictureKey(reservation.blob_id));
    } catch (err: any) {
      const msg = err?.detail || err?.message || t('profile.uploadFailedBody');
      setUploadError(msg);
      Alert.alert(t('profile.uploadFailedTitle'), msg);
    } finally {
      setUploading(false);
    }
  };

  const bioDirty = bio.trim() !== savedBio;

  const handleSaveBio = async () => {
    const next = bio.trim();
    setSavingBio(true);
    try {
      // Empty string clears the bio server-side (stored as NULL).
      await patchMeApi({ bio: next });
      setSavedBio(next);
      setBio(next);
      dispatch(setBioAction(next || null));
    } catch (err: any) {
      Alert.alert(t('profile.bioSaveFailed'), err?.detail || err?.message || t('common.tryAgain'));
    } finally {
      setSavingBio(false);
    }
  };

  const handleShareNumber = async () => {
    if (!rawNum) return;
    try {
      await Share.share({
        message: t('settings.shareMessage', { number: fmt(rawNum) }),
      });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

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
          <Text style={[styles.headerTitle, { color: colors.text }]}>{t('profile.title')}</Text>
          <View style={{ width: 24 }} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <TouchableOpacity
            style={styles.avatarWrap}
            activeOpacity={0.8}
            onPress={handlePickAvatar}
            disabled={uploading}
          >
            {avatarUri ? (
              <Image
                source={{ uri: avatarUri }}
                style={[styles.avatar, styles.avatarImage]}
              />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.surface }]}>
                <Ionicons name="person" size={44} color={colors.textSecondary} />
              </View>
            )}
            <View style={[styles.cameraOverlay, { backgroundColor: colors.primary }]}>
              {uploading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="camera-outline" size={14} color="#fff" />
              )}
            </View>
          </TouchableOpacity>

          {uploadError ? (
            <Text style={styles.errorText}>{uploadError}</Text>
          ) : null}

          <Text style={[styles.displayName, { color: colors.text }]}>{displayName}</Text>
          <Text style={[styles.privateNumber, { color: colors.textSecondary }]}>
            {rawNum ? fmt(rawNum) : '—'}
          </Text>
        </View>

        {/* Bio */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.primary }]}>{t('profile.bio')}</Text>
          <View style={[styles.bioWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TextInput
              style={[styles.bioInput, { color: colors.text }]}
              placeholder={t('profile.bioPlaceholder')}
              placeholderTextColor={colors.textSecondary}
              multiline
              maxLength={128}
              value={bio}
              onChangeText={setBio}
            />
            <Text style={[styles.charCount, { color: colors.textSecondary }]}>{128 - bio.length}</Text>
          </View>
          <Text style={[styles.bioHint, { color: colors.textSecondary }]}>
            {t('profile.bioHint')}
          </Text>
          {bioDirty ? (
            <TouchableOpacity
              style={[styles.bioSaveBtn, { backgroundColor: colors.primary }]}
              onPress={handleSaveBio}
              disabled={savingBio}
              activeOpacity={0.85}
            >
              {savingBio ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.bioSaveBtnText}>{t('common.save')}</Text>
              )}
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Menu items */}
        <View style={[styles.menuCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.menuRow, { borderBottomColor: colors.border }]}
            onPress={handleShareNumber}
          >
            <Text style={[styles.menuLabel, { color: colors.primary }]}>{t('profile.sharePrivateNumber')}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.border} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.menuRow, { borderBottomColor: colors.border }]}
            onPress={() => navigation.navigate('ChangePassword')}
          >
            <Text style={[styles.menuLabel, { color: colors.text }]}>{t('profile.changePassword')}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.border} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuRowLast}
            onPress={() => setShowSignOut(true)}
          >
            <Text style={[styles.menuLabel, { color: DANGER }]}>{t('profile.signOut')}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.border} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Sign Out bottom sheet */}
      <BottomSheet visible={showSignOut} onClose={() => setShowSignOut(false)}>
        <View>
          <Text style={[styles.sheetTitle, { color: colors.text }]}>{t('profile.signOut')}</Text>
          <View style={[styles.toggleRow, { backgroundColor: colors.background }]}>
            <Text style={[styles.toggleLabel, { color: colors.text }]}>
              {t('profile.keepHistory')}
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
              <Text style={[styles.sheetBtnCancelText, { color: colors.textSecondary }]}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetBtnSignOut, { backgroundColor: DANGER }]}
              onPress={handleSignOut}
            >
              <Text style={styles.sheetBtnSignOutText}>{t('profile.signOut')}</Text>
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
  avatarImage: {
    width: 100,
    height: 100,
    borderRadius: 50,
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
  errorText: { fontSize: 13, color: DANGER, textAlign: 'center' },
  displayName: { fontSize: 22, fontWeight: '700' },
  privateNumber: { fontSize: 15 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 14, fontWeight: '600' },
  bioWrap: { borderWidth: 1, borderRadius: 12, padding: 12 },
  bioInput: { fontSize: 15, minHeight: 60 },
  charCount: { fontSize: 12, textAlign: 'right', marginTop: 4 },
  bioHint: { fontSize: 13 },
  bioSaveBtn: {
    alignSelf: 'flex-end',
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    marginTop: 4,
    minWidth: 88,
    alignItems: 'center',
  },
  bioSaveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
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
