import React, { useState } from 'react';
import {
  Alert,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useCall } from './CallProvider';
import { createConversationApi } from '../services/api';

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
  const { startOutgoingCall } = useCall();
  const [number, setNumber] = useState('');
  const [calling, setCalling] = useState(false);

  const handlePress = (key: string) => setNumber((n) => n + key);
  const handleDelete = () => setNumber((n) => n.slice(0, -1));

  const handleClose = () => {
    setNumber('');
    onClose();
  };

  const handleCall = async () => {
    if (number.length === 0 || calling) return;
    setCalling(true);
    try {
      // create-or-get the 1:1 conversation, then ring the callee.
      // startOutgoingCall validates the number via lookup and bails if unknown.
      const conv = await createConversationApi(number);
      await startOutgoingCall({
        name: `User ${number}`,
        number,
        conversationId: conv.id,
      });
      handleClose();
    } catch {
      Alert.alert('Call failed', 'Could not reach that number. Check it and try again.');
    } finally {
      setCalling(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        {/* Modal content sits in its own native window, so it needs a provider
         * of its own for the bottom inset to clear the iOS home indicator. */}
        <SafeAreaProvider style={styles.provider}>
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
                style={[styles.callBtn, { backgroundColor: '#22c55e', opacity: number.length === 0 || calling ? 0.4 : 1 }]}
                activeOpacity={0.8}
                disabled={number.length === 0 || calling}
                onPress={handleCall}
              >
                <Ionicons name="call" size={26} color="#fff" />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  provider: { flex: 0 },
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
