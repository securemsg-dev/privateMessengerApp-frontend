import { useEffect, useRef } from 'react';
import { Audio } from 'expo-av';

import type { CallMode } from '../components/CallProvider';

// Looping call tones. ringback = the "ring ring" the CALLER hears while the
// callee's phone is ringing; ringtone = what the CALLEE hears for an incoming
// call. Both stop the moment the call connects (or is connecting) / ends.
const ringback = require('../../assets/sounds/ringback.wav');
const ringtone = require('../../assets/sounds/ringtone.wav');

type RingKind = 'ringback' | 'ringtone' | null;

const ringFor = (mode: CallMode | null | undefined): RingKind => {
  if (mode === 'outgoing') return 'ringback';
  if (mode === 'incoming-banner' || mode === 'incoming-fullscreen') return 'ringtone';
  return null; // connecting / connected / ended
};

/**
 * Plays the right looping call tone for the current call mode. Keyed on the
 * tone (not the raw mode) so expanding the incoming banner to fullscreen
 * doesn't restart the ringtone.
 */
export function useCallSounds(mode: CallMode | null | undefined): void {
  const kind = ringFor(mode);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    let cancelled = false;

    const stop = async () => {
      const s = soundRef.current;
      soundRef.current = null;
      if (s) {
        try { await s.stopAsync(); } catch { /* already stopped/unloaded */ }
        try { await s.unloadAsync(); } catch { /* ignore */ }
      }
    };

    const play = async (asset: number) => {
      await stop();
      try {
        // NOTE: deliberately do NOT call Audio.setAudioModeAsync here — it would
        // reset the in-call audio mode (allowsRecordingIOS etc.) that the call
        // setup configures concurrently, breaking mic capture. The tone plays
        // through the normal media channel, which is sufficient for ringing.
        const { sound } = await Audio.Sound.createAsync(asset, {
          isLooping: true,
          shouldPlay: true,
          volume: 1.0,
        });
        if (cancelled) {
          await sound.unloadAsync().catch(() => {});
          return;
        }
        soundRef.current = sound;
      } catch { /* tone is best-effort; never block the call on it */ }
    };

    if (kind === 'ringback') void play(ringback);
    else if (kind === 'ringtone') void play(ringtone);
    else void stop();

    return () => {
      cancelled = true;
      void stop();
    };
  }, [kind]);
}
