import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme/ThemeContext';
import { ReportReason, ReportEvidenceMessage } from '../services/api';

/**
 * Abuse-report sheet — the in-app half of Google Play's UGC reporting
 * requirement.
 *
 * The consent switch is the important part. Cricchat is end-to-end encrypted,
 * so the server cannot see reported content; attaching decrypted messages is
 * the only way a moderator can judge a report, and it must be the user's
 * deliberate choice. Default OFF, and the copy states plainly what leaves the
 * device.
 */

interface ReasonOption {
  value: ReportReason;
  label: string;
  hint: string;
}

const REASONS: ReasonOption[] = [
  { value: 'harassment', label: 'Harassment or bullying', hint: 'Threats, abuse, or repeated unwanted contact' },
  { value: 'spam', label: 'Spam or scam', hint: 'Unsolicited ads, phishing, or fraud' },
  { value: 'hate_speech', label: 'Hate speech', hint: 'Attacks based on identity' },
  { value: 'sexual_content', label: 'Unwanted sexual content', hint: 'Explicit content you did not ask for' },
  { value: 'child_safety', label: 'Child safety', hint: 'Content that endangers a minor' },
  { value: 'violence', label: 'Violence or threats', hint: 'Threats of harm to anyone' },
  { value: 'impersonation', label: 'Impersonation', hint: 'Pretending to be someone else' },
  { value: 'other', label: 'Something else', hint: 'Tell us what happened below' },
];

interface Props {
  visible: boolean;
  contactName: string;
  /** Recent decrypted messages from the reported user, newest last. */
  availableEvidence: ReportEvidenceMessage[];
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (args: {
    reason: ReportReason;
    details: string;
    includeMessages: boolean;
    alsoBlock: boolean;
  }) => void;
}

export const ReportSheet = ({
  visible,
  contactName,
  availableEvidence,
  submitting,
  onClose,
  onSubmit,
}: Props) => {
  const { colors } = useTheme();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [includeMessages, setIncludeMessages] = useState(false);
  const [alsoBlock, setAlsoBlock] = useState(true);

  const evidenceCount = availableEvidence.length;

  const reset = () => {
    setReason(null);
    setDetails('');
    setIncludeMessages(false);
    setAlsoBlock(true);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    if (!reason || submitting) return;
    onSubmit({ reason, details: details.trim(), includeMessages, alsoBlock });
    reset();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleClose}
      transparent={false}
    >
      <SafeAreaView
        style={[styles.root, { backgroundColor: colors.background }]}
        edges={['top', 'bottom']}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={handleClose} hitSlop={8} disabled={submitting}>
            <Text style={[styles.cancel, { color: colors.primary }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>Report</Text>
          <Pressable
            onPress={handleSubmit}
            hitSlop={8}
            disabled={!reason || submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text
                style={[
                  styles.submit,
                  { color: reason ? colors.danger : colors.textSecondary },
                ]}
              >
                Submit
              </Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.lede, { color: colors.textSecondary }]}>
            Tell us what {contactName} did. Reports are reviewed by a person
            within 24 hours. {contactName} will not be told you reported them.
          </Text>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            REASON
          </Text>
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {REASONS.map((opt, i) => {
              const selected = reason === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setReason(opt.value)}
                  style={[
                    styles.reasonRow,
                    i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                  ]}
                >
                  <View style={styles.reasonText}>
                    <Text style={[styles.reasonLabel, { color: colors.text }]}>
                      {opt.label}
                    </Text>
                    <Text style={[styles.reasonHint, { color: colors.textSecondary }]}>
                      {opt.hint}
                    </Text>
                  </View>
                  <Ionicons
                    name={selected ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={selected ? colors.primary : colors.textSecondary}
                  />
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            WHAT HAPPENED (OPTIONAL)
          </Text>
          <TextInput
            value={details}
            onChangeText={setDetails}
            placeholder="Add any context that would help us review this."
            placeholderTextColor={colors.textSecondary}
            multiline
            maxLength={2000}
            style={[
              styles.detailsInput,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
          />

          {evidenceCount > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                EVIDENCE
              </Text>
              <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.switchRow}>
                  <View style={styles.switchText}>
                    <Text style={[styles.reasonLabel, { color: colors.text }]}>
                      Include recent messages
                    </Text>
                    <Text style={[styles.reasonHint, { color: colors.textSecondary }]}>
                      Sends the last {evidenceCount} message
                      {evidenceCount === 1 ? '' : 's'} from {contactName} to our
                      moderators — unencrypted.
                    </Text>
                  </View>
                  <Switch
                    value={includeMessages}
                    onValueChange={setIncludeMessages}
                    trackColor={{ true: colors.primary }}
                  />
                </View>
              </View>
              <Text style={[styles.consentNote, { color: colors.textSecondary }]}>
                Cricchat is end-to-end encrypted, so we cannot read your chats.
                Turning this on decrypts those messages on your device and sends
                copies to us so a moderator can see what was sent. Nothing else
                in your account becomes readable, and your report is reviewed
                either way.
              </Text>
            </>
          )}

          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 20 }]}>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={[styles.reasonLabel, { color: colors.text }]}>
                  Also block {contactName}
                </Text>
                <Text style={[styles.reasonHint, { color: colors.textSecondary }]}>
                  Stops their messages and calls reaching you, right away.
                </Text>
              </View>
              <Switch
                value={alsoBlock}
                onValueChange={setAlsoBlock}
                trackColor={{ true: colors.primary }}
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '600' },
  cancel: { fontSize: 16 },
  submit: { fontSize: 16, fontWeight: '600' },
  body: { padding: 16, paddingBottom: 40 },
  lede: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 4,
  },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  reasonText: { flex: 1, paddingRight: 12 },
  reasonLabel: { fontSize: 15, fontWeight: '500' },
  reasonHint: { fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  detailsInput: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    minHeight: 90,
    textAlignVertical: 'top',
    fontSize: 15,
    marginBottom: 20,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  switchText: { flex: 1, paddingRight: 12 },
  consentNote: { fontSize: 12.5, lineHeight: 18, marginTop: 8 },
});
