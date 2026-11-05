import { useEffect, useState } from 'react';
import { voicePlayer, VoicePlaybackState } from '../services/voicePlayer';

export interface MessagePlaybackState {
  isActive: boolean;
  isPlaying: boolean;
  positionMs: number;
  /** 0 when unknown (not yet loaded and no metadata). */
  durationMs: number;
}

const INACTIVE: MessagePlaybackState = {
  isActive: false,
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
};

function derive(id: string, s: VoicePlaybackState): MessagePlaybackState {
  if (s.id !== id) return INACTIVE; // stable reference → no re-render
  return { isActive: true, isPlaying: s.isPlaying, positionMs: s.positionMs, durationMs: s.durationMs };
}

const same = (a: MessagePlaybackState, b: MessagePlaybackState) =>
  a === b ||
  (a.isActive === b.isActive &&
    a.isPlaying === b.isPlaying &&
    a.positionMs === b.positionMs &&
    a.durationMs === b.durationMs);

/**
 * Playback state for ONE voice message. Only the bubble whose message is
 * loaded re-renders on progress ticks; every other bubble stays on the
 * shared INACTIVE object.
 */
export function useVoicePlaybackState(messageId: string): MessagePlaybackState {
  const [value, setValue] = useState(() => derive(messageId, voicePlayer.getState()));
  useEffect(() => {
    const update = () => {
      const next = derive(messageId, voicePlayer.getState());
      setValue((prev) => (same(prev, next) ? prev : next));
    };
    update();
    return voicePlayer.subscribe(update);
  }, [messageId]);
  return value;
}

/** Stop any voice playback when the calling screen unmounts. */
export function useStopVoiceOnUnmount() {
  useEffect(() => () => {
    void voicePlayer.stop();
  }, []);
}
