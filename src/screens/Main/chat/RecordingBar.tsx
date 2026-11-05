import React from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ON_PRIMARY, styles } from './styles';

/** Bar height at full level; actual height = scaleY × this. */
const BAR_MAX_HEIGHT = 22;

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
  /** Live microphone levels (0..1), newest last — from useVoiceRecorder. */
  liveLevels: Animated.Value[];
  recPan: { panHandlers: object };
  colors: Colors;
  formatDuration: (secs: number) => string;
  cancelRec: () => void;
}

export const RecordingBar = ({
  recordingDuration,
  cancelDx,
  redDotPulse,
  liveLevels,
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

    {/* Live waveform — real microphone levels */}
    <View style={styles.waveformLive}>
      {liveLevels.map((level, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveBarLive,
            {
              height: BAR_MAX_HEIGHT,
              backgroundColor: colors.primary,
              opacity: 0.8,
              transform: [
                {
                  scaleY: level.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.15, 1],
                    extrapolate: 'clamp',
                  }),
                },
              ],
            },
          ]}
        />
      ))}
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
