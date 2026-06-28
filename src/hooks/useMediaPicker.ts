import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { withoutAppLock } from '../utils/appLockGuard';

type SendMediaAsset = (uri: string, mime: string, type: 'image' | 'video' | 'voice' | 'document') => Promise<void>;

export function useMediaPicker(
  sendMediaAsset: SendMediaAsset,
  closeTray: () => void,
) {
  const handlePickFromGallery = async () => {
    closeTray();
    const result = await withoutAppLock(async () => {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow access to your photo library in Settings.');
        return null;
      }
      return ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.8,
      });
    });
    if (result && !result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      const isVideo = asset.type === 'video';
      const mime = asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
      await sendMediaAsset(asset.uri, mime, isVideo ? 'video' : 'image');
    }
  };

  const handleCamera = async () => {
    closeTray();
    const result = await withoutAppLock(async () => {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow camera access in Settings.');
        return null;
      }
      return ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.8,
      });
    });
    if (result && !result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      const isVideo = asset.type === 'video';
      const mime = asset.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
      await sendMediaAsset(asset.uri, mime, isVideo ? 'video' : 'image');
    }
  };

  const handlePickFile = async () => {
    closeTray();
    const result = await withoutAppLock(() =>
      DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      }),
    );
    if (!result.canceled && result.assets.length > 0) {
      const asset = result.assets[0];
      const mime = asset.mimeType ?? 'application/octet-stream';
      await sendMediaAsset(asset.uri, mime, 'document');
    }
  };

  return { handlePickFromGallery, handleCamera, handlePickFile };
}
