import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useVideoPlayer, VideoView } from 'expo-video';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 1000;

export interface MediaViewerItem {
  /** Message id — lets the caller patch in `uri` once a video downloads. */
  key: string;
  kind: 'image' | 'video';
  /** Local decrypted file; undefined while a video is still downloading. */
  uri?: string;
  /** Poster (data URI) shown while a video downloads. */
  posterUri?: string;
  /** Set when the download/decrypt failed. */
  error?: string;
  /** e.g. "You" or the sender's name. */
  title: string;
  /** ISO timestamp shown under the title. */
  timestamp?: string;
  mime?: string;
}

/** Native player for a downloaded video (own component: hooks need a uri). */
const VideoPane = ({ uri }: { uri: string }) => {
  const player = useVideoPlayer(uri, (p) => {
    p.play();
  });
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls
      allowsFullscreen={false}
    />
  );
};

interface Props {
  item: MediaViewerItem | null;
  onClose: () => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Size of an image of (w×h) laid out with resizeMode="contain" in (W×H). */
const containSize = (w: number, h: number, W: number, H: number) => {
  if (!w || !h) return { width: W, height: H };
  const ratio = Math.min(W / w, H / h);
  return { width: w * ratio, height: h * ratio };
};

/**
 * Full-screen media viewer. Images: pinch / pan / double-tap zoom, swipe down to
 * dismiss, tap to toggle the top bar, share via the OS sheet (which also
 * offers "Save Image" on iOS — so no photo-library permission is needed).
 *
 * Videos: download on demand (poster + spinner meanwhile), then the native
 * expo-video player with system controls.
 *
 * Built on RNGH's Gesture API + RN Animated. Reanimated isn't installed, so
 * RNGH runs these callbacks on the JS thread — fine for a single image.
 */
export const MediaViewerModal = ({ item, onClose }: Props) => {
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);

  // Live animated values + the committed values at the end of each gesture.
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const dismissY = useRef(new Animated.Value(0)).current;
  const saved = useRef({ scale: 1, x: 0, y: 0 });
  const live = useRef({ scale: 1, x: 0, y: 0 });

  const isVideo = item?.kind === 'video';
  const uri = item?.uri;
  useEffect(() => {
    if (!uri || isVideo) return;
    // Reset per item.
    saved.current = { scale: 1, x: 0, y: 0 };
    live.current = { scale: 1, x: 0, y: 0 };
    scale.setValue(1);
    tx.setValue(0);
    ty.setValue(0);
    dismissY.setValue(0);
    setChromeVisible(true);
    setNatural(null);
    Image.getSize(
      uri,
      (w, h) => setNatural({ w, h }),
      () => setNatural(null),
    );
  }, [uri, isVideo, scale, tx, ty, dismissY]);

  const content = containSize(natural?.w ?? 0, natural?.h ?? 0, W, H);

  // How far the zoomed image may be panned before its edge leaves the screen.
  const bounds = (s: number) => ({
    x: Math.max(0, (content.width * s - W) / 2),
    y: Math.max(0, (content.height * s - H) / 2),
  });

  const animateTo = (s: number, x: number, y: number) => {
    saved.current = { scale: s, x, y };
    live.current = { scale: s, x, y };
    Animated.parallel([
      Animated.spring(scale, { toValue: s, useNativeDriver: true, friction: 7 }),
      Animated.spring(tx, { toValue: x, useNativeDriver: true, friction: 7 }),
      Animated.spring(ty, { toValue: y, useNativeDriver: true, friction: 7 }),
    ]).start();
  };

  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onUpdate((e) => {
        const s = clamp(saved.current.scale * e.scale, MIN_SCALE * 0.8, MAX_SCALE);
        live.current.scale = s;
        scale.setValue(s);
      })
      .onEnd(() => {
        const s = clamp(live.current.scale, MIN_SCALE, MAX_SCALE);
        const b = bounds(s);
        animateTo(
          s,
          s === 1 ? 0 : clamp(live.current.x, -b.x, b.x),
          s === 1 ? 0 : clamp(live.current.y, -b.y, b.y),
        );
      });

    const pan = Gesture.Pan()
      .runOnJS(true)
      .averageTouches(true)
      .onUpdate((e) => {
        if (saved.current.scale > 1) {
          const b = bounds(live.current.scale);
          const x = clamp(saved.current.x + e.translationX, -b.x, b.x);
          const y = clamp(saved.current.y + e.translationY, -b.y, b.y);
          live.current.x = x;
          live.current.y = y;
          tx.setValue(x);
          ty.setValue(y);
        } else {
          // Not zoomed → vertical drag dismisses.
          dismissY.setValue(e.translationY);
        }
      })
      .onEnd((e) => {
        if (saved.current.scale > 1) {
          saved.current = { ...live.current };
          return;
        }
        if (
          Math.abs(e.translationY) > DISMISS_DISTANCE ||
          Math.abs(e.velocityY) > DISMISS_VELOCITY
        ) {
          onClose();
          return;
        }
        Animated.spring(dismissY, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
      });

    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd(() => {
        if (saved.current.scale > 1) animateTo(1, 0, 0);
        else animateTo(DOUBLE_TAP_SCALE, 0, 0);
      });

    const singleTap = Gesture.Tap()
      .runOnJS(true)
      .onEnd(() => setChromeVisible((v) => !v));

    return Gesture.Simultaneous(
      Gesture.Simultaneous(pinch, pan),
      Gesture.Exclusive(doubleTap, singleTap),
    );
    // bounds/animateTo close over layout values; rebuild when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.width, content.height, W, H, onClose]);

  const backdropOpacity = dismissY.interpolate({
    inputRange: [-H / 2, 0, H / 2],
    outputRange: [0.2, 1, 0.2],
    extrapolate: 'clamp',
  });

  const handleShare = async () => {
    if (!item?.uri) return;
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(item.uri, item.mime ? { mimeType: item.mime } : undefined);
      }
    } catch {
      /* user cancelled or share unavailable — nothing to do */
    }
  };

  const subtitle = item?.timestamp
    ? new Date(item.timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : undefined;

  return (
    <Modal
      visible={!!item}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* RNGH needs its own root inside a Modal on Android. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <StatusBar barStyle="light-content" />
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}
        />
        {item && isVideo && (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            {item.uri ? (
              <VideoPane uri={item.uri} />
            ) : (
              <>
                {item.posterUri && (
                  <Image
                    source={{ uri: item.posterUri }}
                    style={StyleSheet.absoluteFill}
                    resizeMode="contain"
                    blurRadius={4}
                  />
                )}
                {item.error ? (
                  <Text style={styles.errorText}>{item.error}</Text>
                ) : (
                  <ActivityIndicator size="large" color="#fff" />
                )}
              </>
            )}
          </View>
        )}
        {item && !isVideo && item.uri && (
          <GestureDetector gesture={gesture}>
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                styles.center,
                { transform: [{ translateY: dismissY }] },
              ]}
            >
              <Animated.Image
                source={{ uri: item.uri as string }}
                resizeMode="contain"
                style={{
                  width: content.width,
                  height: content.height,
                  transform: [{ translateX: tx }, { translateY: ty }, { scale }],
                }}
              />
            </Animated.View>
          </GestureDetector>
        )}

        {chromeVisible && (
          <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
            <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={26} color="#fff" />
            </Pressable>
            <View style={styles.titleWrap}>
              <Text style={styles.title} numberOfLines={1}>
                {item?.title}
              </Text>
              {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>
            <Pressable
              onPress={handleShare}
              disabled={!item?.uri}
              hitSlop={12}
              style={[styles.iconBtn, !item?.uri && { opacity: 0.4 }]}
              accessibilityLabel="Share"
            >
              <Ionicons name="share-outline" size={24} color="#fff" />
            </Pressable>
          </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, marginHorizontal: 8 },
  title: { color: '#fff', fontSize: 16, fontWeight: '600' },
  subtitle: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },
  errorText: { color: '#fff', fontSize: 15, paddingHorizontal: 24, textAlign: 'center' },
});
