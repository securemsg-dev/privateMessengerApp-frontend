import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ON_PRIMARY, styles } from './styles';
import { WAVEFORM_MAX } from '../../../utils/waveform';

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
  /** Recorded waveform (quantized bars); empty when metering was unavailable. */
  waveform?: number[];
  colors: Colors;
  formatDuration: (secs: number) => string;
  discardPreview: () => void;
  togglePreviewPlayback: () => Promise<void>;
  sendPreview: () => Promise<void>;
}

export const PreviewBar = ({
  previewDuration,
  previewPlaying,
  waveform,
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

      {/* Recorded waveform (falls back to a gentle placeholder curve) */}
      <View style={styles.waveformLive}>
        {(waveform && waveform.length
          ? waveform
          : Array.from({ length: 22 }, (_, i) =>
              Math.abs(Math.sin((i / 22) * Math.PI * 2)) * WAVEFORM_MAX,
            )
        ).map((v, i) => (
          <View
            key={i}
            style={[
              styles.waveBarLive,
              {
                height: 4 + (v / WAVEFORM_MAX) * 18,
                backgroundColor: colors.primary,
                opacity: 0.55,
              },
            ]}
          />
        ))}
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
