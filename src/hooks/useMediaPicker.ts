import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { withoutAppLock } from '../utils/appLockGuard';
import type { MediaMeta } from '../services/crypto';
import {
  MAX_VIDEO_BYTES,
  prepareImage,
  prepareVideo,
  VideoTooLargeError,
} from '../services/mediaPrep';

type SendMediaAsset = (
  uri: string,
  mime: string,
  type: 'image' | 'video' | 'voice' | 'document',
  meta?: MediaMeta,
) => Promise<void>;

export function useMediaPicker(
  sendMediaAsset: SendMediaAsset,
  closeTray: () => void,
) {
  /** Optimise (resize photos, poster for videos) then hand to the sender. */
  const sendPickedAsset = async (asset: ImagePicker.ImagePickerAsset) => {
    if (asset.type === 'video') {
      try {
        const v = await prepareVideo(asset);
        await sendMediaAsset(v.uri, v.mime, 'video', v.meta);
      } catch (err) {
        if (err instanceof VideoTooLargeError) {
          const mb = (n: number) => Math.round(n / (1024 * 1024));
          Alert.alert(
            'Video too large',
            `Videos can be up to ${mb(MAX_VIDEO_BYTES)} MB (this one is ${mb(err.sizeBytes)} MB). Try a shorter clip.`,
          );
          return;
        }
        throw err;
      }
      return;
    }
    const img = await prepareImage(asset.uri, asset.width, asset.height);
    await sendMediaAsset(img.uri, img.mime, 'image', img.meta);
  };

  const handlePickFromGallery = async () => {
    closeTray();
    // Uses the Android system photo picker (and iOS PHPicker), which grants
    // one-off access to the single item the user chooses — so no
    // READ_MEDIA_* runtime permission is requested. This is Google Play's
    // required pattern for apps that only pick media on demand.
    const result = await withoutAppLock(() =>
      ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.8,
        // iOS transcodes videos to 720p on pick (Android has no equivalent).
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
      }),
    );
    if (result && !result.canceled && result.assets.length > 0) {
      await sendPickedAsset(result.assets[0]);
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
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
      });
    });
    if (result && !result.canceled && result.assets.length > 0) {
      await sendPickedAsset(result.assets[0]);
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
