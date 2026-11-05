import React from 'react';
import EmojiPicker, { type EmojiType } from 'rn-emoji-keyboard';

import { useTheme } from '../theme/ThemeContext';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
  /** Keep the sheet open after a pick (composer) vs close on first pick (reactions). */
  multiple?: boolean;
}

/**
 * Themed wrapper around rn-emoji-keyboard (pure JS, no native module).
 * Shared by the composer and the "+" in the reaction strip so both look the
 * same and follow light/dark mode.
 */
export const EmojiPickerSheet = ({ open, onClose, onPick, multiple = false }: Props) => {
  const { colors, isDark } = useTheme();

  return (
    <EmojiPicker
      open={open}
      onClose={onClose}
      onEmojiSelected={(e: EmojiType) => onPick(e.emoji)}
      allowMultipleSelections={multiple}
      enableSearchBar
      enableRecentlyUsed
      categoryPosition="top"
      expandable={false}
      theme={{
        backdrop: isDark ? '#00000088' : '#00000055',
        knob: colors.border,
        container: colors.background,
        header: colors.textSecondary,
        skinTonesContainer: colors.surface,
        category: {
          icon: colors.textSecondary,
          iconActive: colors.primary,
          container: colors.surface,
          containerActive: colors.background,
        },
        search: {
          background: colors.surface,
          text: colors.text,
          placeholder: colors.textSecondary,
          icon: colors.textSecondary,
        },
        emoji: { selected: colors.surface },
      }}
    />
  );
};
