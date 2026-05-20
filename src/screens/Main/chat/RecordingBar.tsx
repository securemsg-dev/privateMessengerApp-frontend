import React from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ON_PRIMARY, styles } from './styles';

const WAVE_BARS = 22;

interface Colors {
  text: string;
  textSecondary: string;
  primary: string;
  error: string;
  surface: string;
  border: string;
}

interface Props {
  recordingDuration: number;
  cancelDx: Animated.Value;
  redDotPulse: Animated.Value;
  waveformPhase: Animated.Value;
  recPan: { panHandlers: object };
  colors: Colors;
  formatDuration: (secs: number) => string;
  cancelRec: () => void;
}

export const RecordingBar = ({
  recordingDuration,
  cancelDx,
  redDotPulse,
  waveformPhase,
  recPan,
  colors,
  formatDuration,
  cancelRec,
}: Props) => (
  <Animated.View
    style={[
      styles.recordingBar,
      { backgroundColor: colors.surface, borderTopColor: colors.border },
      { transform: [{ translateX: cancelDx }] },
    ]}
  >
    <TouchableOpacity onPress={cancelRec} style={styles.trashBtn} activeOpacity={0.7}>
      <Ionicons name="trash-outline" size={22} color={colors.error} />
    </TouchableOpacity>

    <View style={styles.recLeft}>
      <Animated.View
        style={[styles.recDot, { backgroundColor: colors.error, opacity: redDotPulse }]}
      />
      <Text style={[styles.recTimer, { color: colors.text }]}>
        {formatDuration(recordingDuration)}
      </Text>
    </View>

    {/* Live waveform */}
    <View style={styles.waveformLive}>
      {Array.from({ length: WAVE_BARS }).map((_, i) => {
        const phaseOffset = i / WAVE_BARS;
        const height = waveformPhase.interpolate({
          inputRange: [0, 0.25, 0.5, 0.75, 1],
          outputRange: [
            4 + Math.abs(Math.sin((phaseOffset + 0) * Math.PI * 2)) * 18,
            4 + Math.abs(Math.sin((phaseOffset + 0.25) * Math.PI * 2)) * 18,
            4 + Math.abs(Math.sin((phaseOffset + 0.5) * Math.PI * 2)) * 18,
            4 + Math.abs(Math.sin((phaseOffset + 0.75) * Math.PI * 2)) * 18,
            4 + Math.abs(Math.sin((phaseOffset + 1) * Math.PI * 2)) * 18,
          ],
        });
        return (
          <Animated.View
            key={i}
            style={[
              styles.waveBarLive,
              { height, backgroundColor: colors.primary, opacity: 0.8 },
            ]}
          />
        );
      })}
    </View>

    <View style={styles.slideHint}>
      <Ionicons name="chevron-back" size={14} color={colors.textSecondary} />
      <Text style={[styles.slideHintText, { color: colors.textSecondary }]}>Slide</Text>
    </View>

    <View {...recPan.panHandlers}>
      <View style={[styles.actionBtn, { backgroundColor: colors.primary }]}>
        <Ionicons name="stop" size={18} color={ON_PRIMARY} />
      </View>
    </View>
  </Animated.View>
);
