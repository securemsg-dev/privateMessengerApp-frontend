import React, { useMemo, useState } from 'react';
import { ActivityIndicator, GestureResponderEvent, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Message, mediaMetaOf } from '../../../store/slices/chatSlice';
import { useVoicePlaybackState } from '../../../hooks/useVoicePlayback';
import { voicePlayer } from '../../../services/voicePlayer';
import { WAVEFORM_MAX, fallbackWaveform, formatDuration } from '../../../utils/waveform';
import { ON_PRIMARY, styles } from './styles';

interface Colors {
  textSecondary: string;
  border: string;
  primary: string;
}

interface Props {
  item: Message;
  isMine: boolean;
  colors: Colors;
  /** Forwarded so long-press still opens the action sheet over the inner touchables. */
  onLongPress: () => void;
}

const BAR_MIN = 3;
const BAR_MAX = 24;

/**
 * Voice message bubble: play/pause, the sender's real waveform with the
 * played portion highlighted, elapsed/total time, and tap-to-seek on the bars.
 */
export const VoiceMessageBubble = ({ item, isMine, colors, onLongPress }: Props) => {
  const meta = mediaMetaOf(item);
  const playback = useVoicePlaybackState(item.id);
  const [barsWidth, setBarsWidth] = useState(0);

  const bars = useMemo(
    () => (meta.waveform && meta.waveform.length ? meta.waveform : fallbackWaveform(item.id)),
    [meta.waveform, item.id],
  );

  const uri = item.mediaUri;
  const loading = !uri; // envelope known, file still downloading/decrypting

  const totalMs =
    meta.durationMs ||
    (playback.isActive ? playback.durationMs : 0) ||
    voicePlayer.learnedDuration(item.id) ||
    0;
  const progress =
    playback.isActive && totalMs > 0 ? Math.min(1, playback.positionMs / totalMs) : 0;
  const playedBars = Math.round(progress * bars.length);

  const label = playback.isActive
    ? formatDuration(playback.positionMs)
    : totalMs > 0
    ? formatDuration(totalMs)
    : 'Voice';

  const handleToggle = () => {
    if (uri) void voicePlayer.toggle(item.id, uri);
  };
  const handleSeek = (e: GestureResponderEvent) => {
    if (!uri || barsWidth <= 0) return;
    void voicePlayer.seek(item.id, uri, e.nativeEvent.locationX / barsWidth);
  };

  const strong = isMine ? ON_PRIMARY : colors.primary;
  const weak = isMine ? 'rgba(255,255,255,0.45)' : colors.border;

  return (
    <View style={styles.voiceBubble}>
      <Pressable
        onPress={handleToggle}
        onLongPress={onLongPress}
        delayLongPress={600}
        disabled={loading}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={playback.isPlaying ? 'Pause voice message' : 'Play voice message'}
        style={[
          styles.voicePlayBtn,
          { backgroundColor: isMine ? 'rgba(255,255,255,0.25)' : colors.primary + '22' },
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={strong} />
        ) : (
          <Ionicons
            name={playback.isPlaying ? 'pause' : 'play'}
            size={16}
            color={strong}
            style={playback.isPlaying ? undefined : { marginLeft: 2 }}
          />
        )}
      </Pressable>

      <Pressable
        onPress={handleSeek}
        onLongPress={onLongPress}
        delayLongPress={600}
        disabled={loading}
        onLayout={(e) => setBarsWidth(e.nativeEvent.layout.width)}
        style={styles.waveform}
      >
        {bars.map((v, i) => (
          <View
            key={i}
            style={[
              styles.waveBar,
              {
                height: BAR_MIN + (v / WAVEFORM_MAX) * (BAR_MAX - BAR_MIN),
                backgroundColor: i < playedBars ? strong : weak,
              },
            ]}
          />
        ))}
      </Pressable>

      <Text
        style={[
          styles.voiceDuration,
          { color: isMine ? 'rgba(255,255,255,0.85)' : colors.textSecondary },
        ]}
      >
        {label}
      </Text>
    </View>
  );
};
