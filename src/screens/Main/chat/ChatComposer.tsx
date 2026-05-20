import React, { RefObject } from 'react';
import { Keyboard, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ON_PRIMARY, styles } from './styles';

interface Colors {
  text: string;
  textSecondary: string;
  surface: string;
  border: string;
  primary: string;
  background: string;
}

interface Props {
  text: string;
  setText: (t: string) => void;
  firstName: string;
  trayOpen: boolean;
  colors: Colors;
  textInputRef: RefObject<TextInput | null>;
  recPan: { panHandlers: object };
  handleSend: () => void;
  closeTray: () => void;
  handleCamera: () => Promise<void>;
  togglePlus: () => void;
}

export const ChatComposer = ({
  text,
  setText,
  firstName,
  trayOpen,
  colors,
  textInputRef,
  recPan,
  handleSend,
  closeTray,
  handleCamera,
  togglePlus,
}: Props) => (
  <View
    style={[
      styles.composer,
      { backgroundColor: colors.background, borderTopColor: colors.border },
    ]}
  >
    <View
      style={[
        styles.inputWrap,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <TouchableOpacity
        onPress={() => textInputRef.current?.focus()}
        style={styles.inlineBtnLeft}
        activeOpacity={0.7}
      >
        <Ionicons name="happy-outline" size={22} color={colors.textSecondary} />
      </TouchableOpacity>
      <TextInput
        ref={textInputRef}
        style={[styles.textInput, { color: colors.text }]}
        placeholder={`Message ${firstName}`}
        placeholderTextColor={colors.textSecondary}
        value={text}
        onChangeText={setText}
        multiline
        maxLength={4000}
        onSubmitEditing={handleSend}
        onFocus={closeTray}
      />
      {text.trim().length === 0 && (
        <TouchableOpacity onPress={togglePlus} style={styles.inlineBtn} activeOpacity={0.7}>
          <Ionicons name="attach" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
      {text.trim().length === 0 && (
        <TouchableOpacity onPress={handleCamera} style={styles.inlineBtn} activeOpacity={0.7}>
          <Ionicons name="camera-outline" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </View>

    {text.trim().length > 0 ? (
      <TouchableOpacity
        style={[styles.actionBtn, { backgroundColor: colors.primary }]}
        onPress={handleSend}
        activeOpacity={0.8}
      >
        <Ionicons name="send" size={18} color={ON_PRIMARY} />
      </TouchableOpacity>
    ) : (
      <View {...recPan.panHandlers}>
        <View style={[styles.actionBtn, { backgroundColor: colors.primary }]}>
          <Ionicons name="mic" size={20} color={ON_PRIMARY} />
        </View>
      </View>
    )}
  </View>
);
