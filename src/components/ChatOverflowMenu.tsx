import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';

/**
 * The ⋮ menu in the chat header. Currently the home of the two Play-required
 * safety actions; other per-chat actions can slot in above the divider.
 *
 * Report is styled as the destructive action rather than Block because it is
 * the one that reaches a human — blocking is reversible and private.
 */

interface Props {
  visible: boolean;
  contactName: string;
  isBlocked: boolean;
  /** False until the peer's user id resolves (offline / unknown contact). */
  actionsEnabled: boolean;
  onClose: () => void;
  onToggleBlock: () => void;
  onReport: () => void;
}

export const ChatOverflowMenu = ({
  visible,
  contactName,
  isBlocked,
  actionsEnabled,
  onClose,
  onToggleBlock,
  onReport,
}: Props) => {
  const { colors } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Pressable
            onPress={onToggleBlock}
            disabled={!actionsEnabled}
            style={({ pressed }) => [
              styles.row,
              pressed && { backgroundColor: colors.background },
            ]}
          >
            <Ionicons
              name={isBlocked ? 'lock-open-outline' : 'ban-outline'}
              size={20}
              color={actionsEnabled ? colors.text : colors.textSecondary}
            />
            <Text
              style={[
                styles.label,
                { color: actionsEnabled ? colors.text : colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              {isBlocked ? `Unblock ${contactName}` : `Block ${contactName}`}
            </Text>
          </Pressable>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <Pressable
            onPress={onReport}
            disabled={!actionsEnabled}
            style={({ pressed }) => [
              styles.row,
              pressed && { backgroundColor: colors.background },
            ]}
          >
            <Ionicons
              name="flag-outline"
              size={20}
              color={actionsEnabled ? colors.danger : colors.textSecondary}
            />
            <Text
              style={[
                styles.label,
                { color: actionsEnabled ? colors.danger : colors.textSecondary },
              ]}
              numberOfLines={1}
            >
              Report {contactName}
            </Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  sheet: {
    position: 'absolute',
    top: 56,
    right: 12,
    minWidth: 220,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    // Elevation/shadow so it reads as floating above the header on both OSes.
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 12,
  },
  label: { fontSize: 15, flexShrink: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
});
