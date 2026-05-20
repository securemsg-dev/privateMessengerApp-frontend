import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSelector } from 'react-redux';

import { useTheme } from '../../theme/ThemeContext';
import { RootState } from '../../store';
import { Button } from '../../components/Button';
import {
  ApiError,
  createConversationApi,
  lookupContactApi,
} from '../../services/api';

const formatNumber = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
};

export const StartChatScreen = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const privateNumber = useSelector(
    (s: RootState) => s.auth.privateNumber,
  );

  const [digits, setDigits] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const rawDigits = digits.replace(/\D/g, '').slice(0, 10);
  const isValid =
    rawDigits.length === 10 && rawDigits !== privateNumber;

  const handleChangeText = (value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 10);
    setDigits(cleaned);
    if (serverError) setServerError(null);
  };

  const handleStartChat = async () => {
    if (!isValid || !privateNumber || busy) return;
    setBusy(true);
    setServerError(null);
    try {
      // 1. Look up the contact to get their display name (lookup is also
      //    implicit inside createConversation, but doing it first lets us
      //    show a friendlier error before mutating anything server-side).
      const lookup = await lookupContactApi(rawDigits);
      if (!lookup.found || !lookup.user) {
        setServerError('No PrivaChat user with that number');
        return;
      }

      // 2. Create-or-fetch the conversation server-side
      const conv = await createConversationApi(rawDigits);
      const other = conv.other_participant ?? lookup.user;

      navigation.navigate('ChatScreen', {
        conversationId: conv.id,
        contactName: other.display_name || formatNumber(other.private_number),
        contactPrivateNumber: other.private_number,
        contactPublicKey: other.public_key ?? null,
        isSelfChat: false,
      });
    } catch (err) {
      const detail =
        err instanceof ApiError ? err.detail : 'Could not start the chat';
      setServerError(detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.text }]}>
            New Chat
          </Text>
          <View style={{ width: 34 }} />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          {/* User's own private number */}
          <View
            style={[
              styles.ownNumberCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.ownNumberRow}>
              <Ionicons name="call-outline" size={20} color={colors.primary} />
              <View style={styles.ownNumberInfo}>
                <Text style={[styles.ownNumberLabel, { color: colors.textSecondary }]}>
                  Your Private Number
                </Text>
                <Text style={[styles.ownNumber, { color: colors.text }]}>
                  {privateNumber ? formatNumber(privateNumber) : '—'}
                </Text>
              </View>
              <TouchableOpacity>
                <Ionicons name="share-outline" size={20} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Divider label */}
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            Enter a Private Number to start chatting
          </Text>

          {/* Number input */}
          <View style={styles.inputSection}>
            <TextInput
              style={[
                styles.numberInput,
                {
                  color: colors.text,
                  borderBottomColor: rawDigits.length > 0 ? colors.primary : colors.border,
                },
              ]}
              value={formatNumber(rawDigits)}
              onChangeText={handleChangeText}
              keyboardType="number-pad"
              placeholder="00-0000-0000"
              placeholderTextColor={colors.textSecondary}
              autoFocus
              maxLength={12} // 10 digits + 2 dashes
            />
            {rawDigits === privateNumber && rawDigits.length === 10 && (
              <Text style={[styles.errorText, { color: colors.error }]}>
                You cannot chat with your own number
              </Text>
            )}
            {serverError && (
              <Text style={[styles.errorText, { color: colors.error }]}>
                {serverError}
              </Text>
            )}
          </View>

          {/* Start Chat button */}
          {busy ? (
            <View style={[styles.startBtn, styles.busyBtn, { backgroundColor: colors.primary }]}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : (
            <Button
              title="Start Chat"
              onPress={handleStartChat}
              disabled={!isValid}
              style={styles.startBtn}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 24 },
  /* Own number card */
  ownNumberCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 28,
  },
  ownNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ownNumberInfo: { flex: 1 },
  ownNumberLabel: { fontSize: 12, fontWeight: '500', marginBottom: 2 },
  ownNumber: { fontSize: 18, fontWeight: '700', letterSpacing: 1 },
  /* Section label */
  sectionLabel: { fontSize: 14, marginBottom: 16, textAlign: 'center' },
  /* Number input */
  inputSection: { alignItems: 'center', marginBottom: 32 },
  numberInput: {
    fontSize: 28,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 2,
    borderBottomWidth: 2,
    paddingVertical: 12,
    width: '100%',
  },
  errorText: { fontSize: 13, marginTop: 8 },
  /* Start button */
  startBtn: { borderRadius: 28 },
  busyBtn: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
