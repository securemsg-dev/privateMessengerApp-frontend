import React from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ON_PRIMARY, styles } from './styles';

const WAVE_BARS = 22;

interface Colors {
  textSecondary: string;
  primary: string;
  error: string;
  surface: string;
  border: string;
  background: string;
}

interface Props {
  previewDuration: number;
  previewPlaying: boolean;
  waveformPhase: Animated.Value;
  colors: Colors;
  formatDuration: (secs: number) => string;
  discardPreview: () => void;
  togglePreviewPlayback: () => Promise<void>;
  sendPreview: () => Promise<void>;
}

export const PreviewBar = ({
  previewDuration,
  previewPlaying,
  waveformPhase,
  colors,
  formatDuration,
  discardPreview,
  togglePreviewPlayback,
  sendPreview,
}: Props) => (
  <View
    style={[
      styles.previewBar,
      { backgroundColor: colors.surface, borderTopColor: colors.border },
    ]}
  >
    <TouchableOpacity onPress={discardPreview} style={styles.trashBtn} activeOpacity={0.7}>
      <Ionicons name="trash-outline" size={22} color={colors.error} />
    </TouchableOpacity>

    <View
      style={[
        styles.previewBubble,
        { backgroundColor: colors.background, borderColor: colors.border },
      ]}
    >
      <TouchableOpacity
        style={[styles.previewPlayBtn, { backgroundColor: colors.primary }]}
        onPress={togglePreviewPlayback}
        activeOpacity={0.8}
      >
        <Ionicons
          name={previewPlaying ? 'pause' : 'play'}
          size={16}
          color={ON_PRIMARY}
        />
      </TouchableOpacity>

      {/* Static waveform preview */}
      <View style={styles.waveformLive}>
        {Array.from({ length: WAVE_BARS }).map((_, i) => {
          const phaseOffset = i / WAVE_BARS;
          const h = 4 + Math.abs(Math.sin(phaseOffset * Math.PI * 2)) * 18;
          return (
            <Animated.View
              key={i}
              style={[
                styles.waveBarLive,
                { height: h, backgroundColor: colors.primary, opacity: 0.55 },
              ]}
            />
          );
        })}
      </View>

      <Text style={[styles.previewDurText, { color: colors.textSecondary }]}>
        {formatDuration(previewDuration)}
      </Text>
    </View>

    <TouchableOpacity
      onPress={sendPreview}
      style={[styles.previewSendBtn, { backgroundColor: colors.primary }]}
      activeOpacity={0.85}
    >
      <Ionicons name="send" size={18} color={ON_PRIMARY} />
    </TouchableOpacity>
  </View>
);
