import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, PanResponder } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { withoutAppLock } from '../utils/appLockGuard';
import { MediaMeta } from '../services/crypto';
import { buildWaveform, levelFromDb } from '../utils/waveform';

type RecMode = 'idle' | 'recording' | 'preview';
type SendMediaAsset = (
  uri: string,
  mime: string,
  type: 'image' | 'video' | 'voice',
  meta?: MediaMeta,
) => Promise<void>;

/** Bars in the live recording strip (RecordingBar). */
export const LIVE_BARS = 22;
/** How often expo-av reports duration + loudness while recording. */
const STATUS_INTERVAL_MS = 80;
const MIN_RECORDING_MS = 1000;

const RECORDING_OPTIONS: Audio.RecordingOptions = {
  ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

export function useVoiceRecorder(
  sendMediaAsset: SendMediaAsset,
  closeTray: () => void,
) {
  const [recMode, setRecMode] = useState<RecMode>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewMeta, setPreviewMeta] = useState<MediaMeta>({});

  const recModeRef = useRef<RecMode>('idle');
  const recordingRef = useRef<Audio.Recording | null>(null);
  // Raw dBFS readings for the whole recording → summarised into the waveform.
  const dbSamplesRef = useRef<number[]>([]);
  const durationMsRef = useRef(0);
  // Rolling window of the most recent levels for the live strip. Driven via
  // Animated.Value.setValue so the 80 ms updates don't re-render ChatScreen.
  const liveBufRef = useRef<number[]>(new Array(LIVE_BARS).fill(0));
  const liveLevels = useRef(
    Array.from({ length: LIVE_BARS }, () => new Animated.Value(0)),
  ).current;
  const cancelledRef = useRef(false);
  const stoppedThisGestureRef = useRef(false);
  const previewSoundRef = useRef<Audio.Sound | null>(null);

  const cancelDx = useRef(new Animated.Value(0)).current;
  const redDotPulse = useRef(new Animated.Value(1)).current;

  const setRecModeSync = (m: RecMode) => {
    recModeRef.current = m;
    setRecMode(m);
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const resetLive = () => {
    dbSamplesRef.current = [];
    durationMsRef.current = 0;
    liveBufRef.current = new Array(LIVE_BARS).fill(0);
    liveLevels.forEach((v) => v.setValue(0));
  };

  const onRecordingStatus = (status: Audio.RecordingStatus) => {
    if (!status.isRecording) return;
    durationMsRef.current = status.durationMillis;
    // Only re-render when the visible m:ss value changes.
    const secs = Math.floor(status.durationMillis / 1000);
    setRecordingDuration((prev) => (prev === secs ? prev : secs));
    if (typeof status.metering === 'number') {
      dbSamplesRef.current.push(status.metering);
      const buf = liveBufRef.current;
      buf.shift();
      buf.push(levelFromDb(status.metering));
      for (let i = 0; i < LIVE_BARS; i++) liveLevels[i].setValue(buf[i]);
    }
  };

  const startRec = async () => {
    closeTray();
    if (recModeRef.current !== 'idle') return;
    try {
      const { status } = await withoutAppLock(() => Audio.requestPermissionsAsync());
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow microphone access in Settings.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      resetLive();
      const { recording: rec } = await Audio.Recording.createAsync(
        RECORDING_OPTIONS,
        onRecordingStatus,
        STATUS_INTERVAL_MS,
      );
      recordingRef.current = rec;
      setRecModeSync('recording');
      setRecordingDuration(0);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch {
      Alert.alert('Error', 'Could not start recording.');
    }
  };

  const stopRec = async () => {
    const rec = recordingRef.current;
    if (!rec || recModeRef.current !== 'recording') return;
    // Claim the recording now so an overlapping stop/cancel (gesture release
    // racing the stop button) can't unload it twice.
    recordingRef.current = null;
    try {
      // Read the precise final length before unloading (the last status
      // callback can be up to one interval stale).
      try {
        const st = await rec.getStatusAsync();
        if (st.durationMillis) durationMsRef.current = st.durationMillis;
      } catch {
        /* fall back to the last status callback's value */
      }
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      recordingRef.current = null;
      const durationMs = durationMsRef.current;
      if (uri && durationMs >= MIN_RECORDING_MS) {
        const waveform = buildWaveform(dbSamplesRef.current);
        setPreviewUri(uri);
        setPreviewDuration(Math.max(1, Math.round(durationMs / 1000)));
        setPreviewMeta({
          durationMs: Math.round(durationMs),
          ...(waveform.length ? { waveform } : {}),
        });
        setRecModeSync('preview');
      } else {
        setRecModeSync('idle');
        setRecordingDuration(0);
      }
    } catch {
      recordingRef.current = null;
      setRecModeSync('idle');
      setRecordingDuration(0);
    }
  };

  const cancelRec = async () => {
    const rec = recordingRef.current;
    setRecModeSync('idle');
    setRecordingDuration(0);
    if (!rec) return;
    try {
      await rec.stopAndUnloadAsync();
    } catch {
      /* ignore */
    }
    recordingRef.current = null;
  };

  const discardPreview = async () => {
    if (previewSoundRef.current) {
      try {
        await previewSoundRef.current.stopAsync();
        await previewSoundRef.current.unloadAsync();
      } catch {
        /* ignore */
      }
      previewSoundRef.current = null;
    }
    setPreviewUri(null);
    setPreviewDuration(0);
    setPreviewPlaying(false);
    setPreviewMeta({});
    setRecModeSync('idle');
  };

  const sendPreview = async () => {
    if (!previewUri) return;
    const uri = previewUri;
    const meta = previewMeta;
    if (previewSoundRef.current) {
      try {
        await previewSoundRef.current.stopAsync();
        await previewSoundRef.current.unloadAsync();
      } catch {
        /* ignore */
      }
      previewSoundRef.current = null;
    }
    setPreviewUri(null);
    setPreviewDuration(0);
    setPreviewPlaying(false);
    setPreviewMeta({});
    setRecModeSync('idle');
    setRecordingDuration(0);
    void sendMediaAsset(uri, 'audio/aac', 'voice', meta);
  };

  const togglePreviewPlayback = async () => {
    if (!previewUri) return;
    if (previewSoundRef.current) {
      try {
        await previewSoundRef.current.stopAsync();
        await previewSoundRef.current.unloadAsync();
      } catch {
        /* ignore */
      }
      previewSoundRef.current = null;
      setPreviewPlaying(false);
      return;
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: previewUri },
        { shouldPlay: true },
      );
      previewSoundRef.current = sound;
      setPreviewPlaying(true);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync();
          previewSoundRef.current = null;
          setPreviewPlaying(false);
        }
      });
    } catch {
      setPreviewPlaying(false);
    }
  };

  // Animation loops while recording
  useEffect(() => {
    if (recMode === 'recording') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(redDotPulse, { toValue: 0.3, duration: 500, useNativeDriver: true }),
          Animated.timing(redDotPulse, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => {
        pulse.stop();
        redDotPulse.setValue(1);
      };
    }
  }, [recMode, redDotPulse]);

  const recPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4,
      onPanResponderGrant: () => {
        cancelledRef.current = false;
        stoppedThisGestureRef.current = false;
        if (recModeRef.current === 'recording') {
          stoppedThisGestureRef.current = true;
          stopRec();
        } else if (recModeRef.current === 'idle') {
          startRec();
        }
      },
      onPanResponderMove: (_, g) => {
        if (recModeRef.current !== 'recording') return;
        const dx = Math.min(0, g.dx);
        cancelDx.setValue(dx);
        if (!cancelledRef.current && dx <= -80) {
          cancelledRef.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          cancelRec();
        }
      },
      onPanResponderRelease: () => {
        Animated.timing(cancelDx, { toValue: 0, duration: 160, useNativeDriver: true }).start();
        if (cancelledRef.current || stoppedThisGestureRef.current) return;
        if (recModeRef.current === 'recording') stopRec();
      },
      onPanResponderTerminate: () => {
        cancelDx.setValue(0);
        if (cancelledRef.current || stoppedThisGestureRef.current) return;
        if (recModeRef.current === 'recording') cancelRec();
      },
    }),
  ).current;

  return {
    recMode,
    recModeRef,
    recordingDuration,
    previewUri,
    previewDuration,
    previewPlaying,
    cancelDx,
    redDotPulse,
    liveLevels,
    previewMeta,
    recPan,
    formatDuration,
    startRec,
    stopRec,
    cancelRec,
    discardPreview,
    sendPreview,
    togglePreviewPlayback,
  };
}
