import { Alert } from 'react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';

/**
 * Single voice-message player for the app (only one message plays at a time).
 *
 * Progress lives in this tiny observable store instead of React props so the
 * 100 ms position updates re-render only the bubble that is playing — not the
 * whole message list.
 */

export interface VoicePlaybackState {
  /** Message currently loaded (playing or paused); null when idle. */
  id: string | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
}

const IDLE: VoicePlaybackState = { id: null, isPlaying: false, positionMs: 0, durationMs: 0 };
const PROGRESS_INTERVAL_MS = 100;

let state: VoicePlaybackState = IDLE;
let sound: Audio.Sound | null = null;
/** Serialises load/unload so rapid taps can't leave two sounds alive. */
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
/** Durations learned at load time — for messages sent without metadata. */
const learnedDurations = new Map<string, number>();

function setState(next: VoicePlaybackState) {
  state = next;
  listeners.forEach((l) => l());
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function unloadCurrent() {
  const s = sound;
  sound = null;
  if (s) {
    s.setOnPlaybackStatusUpdate(null);
    await s.unloadAsync().catch(() => {});
  }
}

function onStatus(id: string) {
  return (status: AVPlaybackStatus) => {
    if (state.id !== id) return;
    if (!status.isLoaded) {
      if (status.error) setState(IDLE);
      return;
    }
    const durationMs = status.durationMillis ?? state.durationMs;
    if (durationMs) learnedDurations.set(id, durationMs);
    if (status.didJustFinish) {
      void enqueue(async () => {
        await unloadCurrent();
        if (state.id === id) setState(IDLE);
      });
      return;
    }
    setState({
      id,
      isPlaying: status.isPlaying,
      positionMs: status.positionMillis,
      durationMs,
    });
  };
}

async function load(id: string, uri: string, startMs: number) {
  await unloadCurrent();
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
  setState({ id, isPlaying: true, positionMs: startMs, durationMs: learnedDurations.get(id) ?? 0 });
  const { sound: s } = await Audio.Sound.createAsync(
    { uri },
    {
      shouldPlay: true,
      positionMillis: startMs,
      progressUpdateIntervalMillis: PROGRESS_INTERVAL_MS,
    },
    onStatus(id),
  );
  // A newer request may have replaced us while createAsync was in flight.
  if (state.id !== id) {
    await s.unloadAsync().catch(() => {});
    return;
  }
  sound = s;
}

export const voicePlayer = {
  getState: () => state,

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  learnedDuration: (id: string) => learnedDurations.get(id),

  /** Play, pause, or resume this message. */
  toggle(id: string, uri: string): Promise<void> {
    return enqueue(async () => {
      try {
        if (state.id === id && sound) {
          if (state.isPlaying) await sound.pauseAsync();
          else await sound.playAsync();
          return;
        }
        await load(id, uri, 0);
      } catch {
        await unloadCurrent();
        setState(IDLE);
        Alert.alert('Error', 'Could not play this voice message.');
      }
    });
  },

  /** Jump to `fraction` (0..1) of the message; starts playback if needed. */
  seek(id: string, uri: string, fraction: number): Promise<void> {
    const f = Math.min(1, Math.max(0, fraction));
    return enqueue(async () => {
      try {
        if (state.id === id && sound && state.durationMs > 0) {
          const pos = Math.floor(f * state.durationMs);
          await sound.setPositionAsync(pos);
          setState({ ...state, positionMs: pos });
          return;
        }
        const known = learnedDurations.get(id);
        await load(id, uri, known ? Math.floor(f * known) : 0);
      } catch {
        await unloadCurrent();
        setState(IDLE);
      }
    });
  },

  /** Stop and release (e.g. when leaving the chat). */
  stop(): Promise<void> {
    return enqueue(async () => {
      await unloadCurrent();
      setState(IDLE);
    });
  },
};
