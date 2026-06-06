import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['*', '0', '#'],
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export const DialpadModal = ({ visible, onClose }: Props) => {
  const { colors } = useTheme();
  const [number, setNumber] = useState('');

  const handlePress = (key: string) => setNumber((n) => n + key);
  const handleDelete = () => setNumber((n) => n.slice(0, -1));

  const handleClose = () => {
    setNumber('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        <SafeAreaView edges={['bottom'] as const}>
          <View style={styles.handle} />

          {/* Close */}
          <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
            <Ionicons name="close" size={22} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Number display */}
          <View style={styles.numberRow}>
            <Text
              style={[styles.numberText, { color: colors.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {number || ' '}
            </Text>
            {number.length > 0 && (
              <TouchableOpacity onPress={handleDelete} onLongPress={() => setNumber('')} style={styles.backspaceBtn}>
                <Ionicons name="backspace-outline" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Keypad grid */}
          {KEYS.map((row, ri) => (
            <View key={ri} style={styles.row}>
              {row.map((key) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.key, { backgroundColor: colors.surface }]}
                  activeOpacity={0.65}
                  onPress={() => handlePress(key)}
                >
                  <Text style={[styles.keyText, { color: colors.text }]}>{key}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}

          {/* Call button */}
          <View style={styles.callRow}>
            <TouchableOpacity
              style={[styles.callBtn, { backgroundColor: '#22c55e', opacity: number.length === 0 ? 0.4 : 1 }]}
              activeOpacity={0.8}
              disabled={number.length === 0}
            >
              <Ionicons name="call" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ccc',
    alignSelf: 'center',
    marginBottom: 12,
  },
  closeBtn: {
    position: 'absolute',
    right: 0,
    top: 8,
    padding: 8,
  },
  numberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    marginBottom: 16,
    paddingHorizontal: 40,
  },
  numberText: {
    flex: 1,
    fontSize: 36,
    fontWeight: '300',
    textAlign: 'center',
    letterSpacing: 2,
  },
  backspaceBtn: {
    position: 'absolute',
    right: 0,
    padding: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  key: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    fontSize: 26,
    fontWeight: '400',
  },
  callRow: {
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  callBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
