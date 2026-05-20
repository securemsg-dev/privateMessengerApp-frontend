import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';

interface DropdownMenuItem {
  label: string;
  icon: string;
  onPress: () => void;
  destructive?: boolean;
}

interface DropdownMenuProps {
  visible: boolean;
  onClose: () => void;
  items: DropdownMenuItem[];
}

export const DropdownMenu: React.FC<DropdownMenuProps> = ({
  visible,
  onClose,
  items,
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>
      <View
        style={[
          styles.menu,
          {
            backgroundColor: colors.surface,
            top: insets.top + 48,
            right: 16,
          },
        ]}
      >
        {items.map((item, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.menuItem,
              index < items.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              },
            ]}
            activeOpacity={0.7}
            onPress={() => {
              item.onPress();
              onClose();
            }}
          >
            <Ionicons
              name={item.icon as any}
              size={20}
              color={item.destructive ? colors.danger : colors.text}
            />
            <Text
              style={[
                styles.menuLabel,
                { color: item.destructive ? colors.danger : colors.text },
              ]}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  menu: {
    position: 'absolute',
    minWidth: 200,
    borderRadius: 12,
    paddingVertical: 4,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  menuLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
});
