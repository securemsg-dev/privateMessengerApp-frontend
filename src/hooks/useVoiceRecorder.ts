import { useEffect, useRef, useState } from 'react';
import { Alert, Animated, PanResponder } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';

type RecMode = 'idle' | 'recording' | 'preview';
type SendMediaAsset = (uri: string, mime: string, type: 'image' | 'video' | 'voice') => Promise<void>;

export function useVoiceRecorder(
  sendMediaAsset: SendMediaAsset,
  closeTray: () => void,
) {
  const [recMode, setRecMode] = useState<RecMode>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewDuration, setPreviewDuration] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const recModeRef = useRef<RecMode>('idle');
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const stoppedThisGestureRef = useRef(false);
  const previewSoundRef = useRef<Audio.Sound | null>(null);

  const cancelDx = useRef(new Animated.Value(0)).current;
  const redDotPulse = useRef(new Animated.Value(1)).current;
  const waveformPhase = useRef(new Animated.Value(0)).current;

  const setRecModeSync = (m: RecMode) => {
    recModeRef.current = m;
    setRecMode(m);
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const startRec = async () => {
    closeTray();
    if (recModeRef.current !== 'idle') return;
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Please allow microphone access in Settings.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = rec;
      setRecModeSync('recording');
      setRecordingDuration(0);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      recordingTimer.current = setInterval(
        () => setRecordingDuration((d) => d + 1),
        1000,
      );
    } catch {
      Alert.alert('Error', 'Could not start recording.');
    }
  };

  const stopRec = async () => {
    const rec = recordingRef.current;
    if (!rec || recModeRef.current !== 'recording') return;
    if (recordingTimer.current) {
      clearInterval(recordingTimer.current);
      recordingTimer.current = null;
    }
    let finalDuration = 0;
    setRecordingDuration((d) => {
      finalDuration = d;
      return d;
    });
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      recordingRef.current = null;
      if (uri && finalDuration >= 1) {
        setPreviewUri(uri);
        setPreviewDuration(finalDuration);
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
    if (recordingTimer.current) {
      clearInterval(recordingTimer.current);
      recordingTimer.current = null;
    }
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
    setRecModeSync('idle');
  };

  const sendPreview = async () => {
    if (!previewUri) return;
    const uri = previewUri;
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
    setRecModeSync('idle');
    setRecordingDuration(0);
    void sendMediaAsset(uri, 'audio/aac', 'voice');
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
      const wave = Animated.loop(
        Animated.timing(waveformPhase, { toValue: 1, duration: 1400, useNativeDriver: false }),
      );
      pulse.start();
      wave.start();
      return () => {
        pulse.stop();
        wave.stop();
        redDotPulse.setValue(1);
        waveformPhase.setValue(0);
      };
    }
  }, [recMode, redDotPulse, waveformPhase]);

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
    waveformPhase,
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
