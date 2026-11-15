import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';

import { useTheme } from '../../theme/ThemeContext';
import { AppDispatch, RootState } from '../../store';
import { Avatar } from '../../components/Avatar';
import { BottomSheet } from '../../components/BottomSheet';
import { ReportSheet } from '../../components/ReportSheet';
import { MediaViewerItem, MediaViewerModal } from '../../components/MediaViewerModal';
import { useCall } from '../../components/CallProvider';
import { useChatSafety } from '../../hooks/useChatSafety';
import { selectCustomContactName } from '../../hooks/useContactName';
import { downloadAvatar } from '../../services/media';
import { CONTACT_NAME_MAX, setContactNameThunk } from '../../store/slices/chatSlice';

type Params = {
  ContactInfo: { conversationId: string; contactName: string; contactPrivateNumber: string };
};

const ON_PRIMARY = '#ffffff';

const formatNumber = (n: string) =>
  n.length === 10 ? `${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6, 10)}` : n;

/**
 * One-to-one contact details, opened by tapping the avatar or name in a chat:
 * photo (tap for full size), the user's own name for the contact (editable,
 * device-only), their private number and own name, bio, shared media, and
 * block / report.
 */
export const ContactInfoScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<Params, 'ContactInfo'>>();
  const dispatch = useDispatch<AppDispatch>();
  const { conversationId, contactPrivateNumber } = route.params;

  const conv = useSelector((s: RootState) =>
    s.chat.conversations.find((c) => c.id === conversationId),
  );
  const messages = useSelector((s: RootState) => s.chat.activeMessages);
  const myUserId = useSelector((s: RootState) => s.auth.userId) ?? '';
  const customName = useSelector((s: RootState) =>
    selectCustomContactName(s, contactPrivateNumber),
  );

  // What the contact calls themselves (or their number when they set no name).
  const ownName = conv?.contactName || route.params.contactName;
  const shownName = customName || ownName;
  const pictureKey = conv?.contactProfilePictureKey ?? null;

  const { startOutgoingCall } = useCall();
  const safety = useChatSafety(
    contactPrivateNumber, shownName, conversationId, false, messages, myUserId,
  );

  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  useEffect(() => {
    if (renaming) setDraft(customName ?? '');
  }, [renaming, customName]);

  const saveName = (name: string) => {
    void dispatch(setContactNameThunk({ privateNumber: contactPrivateNumber, name }));
    setRenaming(false);
  };

  // Full-size profile photo (the file is already cached by <Avatar>).
  const [viewer, setViewer] = useState<MediaViewerItem | null>(null);
  const openPhoto = async () => {
    if (!pictureKey) return;
    try {
      const uri = await downloadAvatar(pictureKey);
      setViewer({ key: pictureKey, kind: 'image', uri, title: shownName });
    } catch {
      /* photo unavailable — keep the small avatar */
    }
  };

  const mediaCount = messages.filter(
    (m) =>
      m.conversationId === conversationId &&
      !m.deletedAt &&
      !m.viewOnce &&
      (m.type === 'image' || m.type === 'video' || m.type === 'document' || m.type === 'voice'),
  ).length;

  const danger = colors.danger ?? '#c0392b';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Contact info</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <TouchableOpacity
            onPress={openPhoto}
            disabled={!pictureKey}
            activeOpacity={0.8}
            accessibilityRole="imagebutton"
            accessibilityLabel={pictureKey ? 'View profile photo' : 'No profile photo'}
          >
            <Avatar profilePictureKey={pictureKey} name={shownName} size={104} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.nameRow}
            onPress={() => setRenaming(true)}
            accessibilityRole="button"
            accessibilityLabel={`Edit your name for ${shownName}`}
          >
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
              {shownName}
            </Text>
            <Ionicons name="pencil" size={17} color={colors.primary} />
          </TouchableOpacity>

          <Text style={[styles.number, { color: colors.textSecondary }]} selectable>
            {formatNumber(contactPrivateNumber)}
          </Text>
          {!!customName && customName !== ownName && (
            <Text style={[styles.subtle, { color: colors.textSecondary }]}>
              Their name: {ownName}
            </Text>
          )}
        </View>

        <View style={styles.actions}>
          <ActionButton
            icon="chatbubble-outline"
            label="Message"
            colors={colors}
            onPress={() => navigation.goBack()}
          />
          <ActionButton
            icon="call-outline"
            label="Call"
            colors={colors}
            onPress={() =>
              void startOutgoingCall({
                name: shownName,
                number: contactPrivateNumber,
                conversationId,
              })
            }
          />
        </View>

        {!!conv?.contactBio && (
          <>
            <Text style={[styles.sectionHeader, { color: colors.textSecondary }]}>BIO</Text>
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.bio, { color: colors.text }]}>{conv.contactBio}</Text>
            </View>
          </>
        )}

        <View style={[styles.card, styles.list, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation.navigate('SharedMedia', { conversationId, title: shownName })}
            accessibilityRole="button"
          >
            <Ionicons name="images-outline" size={20} color={colors.primary} />
            <Text style={[styles.rowText, { color: colors.text }]}>Media, files and voice</Text>
            {mediaCount > 0 && (
              <Text style={[styles.subtle, { color: colors.textSecondary }]}>{mediaCount}</Text>
            )}
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <View style={[styles.card, styles.list, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.row, { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
            onPress={safety.toggleBlock}
            disabled={!safety.peerUserId}
            accessibilityRole="button"
          >
            <Ionicons name="ban-outline" size={20} color={danger} />
            <Text style={[styles.rowText, { color: danger }]}>
              {safety.isBlocked ? `Unblock ${shownName}` : `Block ${shownName}`}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.row}
            onPress={safety.openReport}
            disabled={!safety.peerUserId}
            accessibilityRole="button"
          >
            <Ionicons name="flag-outline" size={20} color={danger} />
            <Text style={[styles.rowText, { color: danger }]}>Report</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <BottomSheet visible={renaming} onClose={() => setRenaming(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <Text style={[styles.sheetTitle, { color: colors.text }]}>Name this contact</Text>
            <Text style={[styles.sheetBody, { color: colors.textSecondary }]}>
              Only you see this name. Leave it empty to show their own name, {ownName}.
            </Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={ownName}
              placeholderTextColor={colors.textSecondary}
              maxLength={CONTACT_NAME_MAX}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => saveName(draft)}
              accessibilityLabel="Your name for this contact"
              style={[
                styles.input,
                { color: colors.text, backgroundColor: colors.surface, borderColor: colors.primary },
              ]}
            />
            {!!customName && (
              <TouchableOpacity onPress={() => saveName('')} accessibilityRole="button">
                <Text style={[styles.reset, { color: colors.primary }]}>Use their own name</Text>
              </TouchableOpacity>
            )}
            <View style={styles.sheetBtns}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
                onPress={() => setRenaming(false)}
                accessibilityRole="button"
              >
                <Text style={[styles.btnText, { color: colors.text }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.primary }]}
                onPress={() => saveName(draft)}
                accessibilityRole="button"
              >
                <Text style={[styles.btnText, { color: ON_PRIMARY }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </BottomSheet>

      <ReportSheet
        visible={safety.reportOpen}
        contactName={shownName}
        availableEvidence={safety.availableEvidence}
        submitting={safety.submitting}
        onClose={() => safety.setReportOpen(false)}
        onSubmit={safety.submitReport}
      />
      <MediaViewerModal item={viewer} onClose={() => setViewer(null)} />
    </SafeAreaView>
  );
};

const ActionButton = ({
  icon,
  label,
  colors,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  colors: { surface: string; border: string; primary: string; text: string };
  onPress: () => void;
}) => (
  <TouchableOpacity
    style={[styles.action, { backgroundColor: colors.surface, borderColor: colors.border }]}
    onPress={onPress}
    accessibilityRole="button"
  >
    <Ionicons name={icon} size={21} color={colors.primary} />
    <Text style={[styles.actionLabel, { color: colors.text }]}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 20, fontWeight: '700' },
  scroll: { padding: 16, paddingBottom: 40 },
  hero: { alignItems: 'center', paddingVertical: 12, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingHorizontal: 24 },
  name: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  number: { fontSize: 15, letterSpacing: 0.5 },
  subtle: { fontSize: 13 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  actionLabel: { fontSize: 13, fontWeight: '500' },
  sectionHeader: { fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 20, marginBottom: 8, marginLeft: 4 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14 },
  list: { padding: 0, marginTop: 16, overflow: 'hidden' },
  bio: { fontSize: 15, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  rowText: { flex: 1, fontSize: 16, fontWeight: '500' },
  sheet: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 },
  sheetTitle: { fontSize: 18, fontWeight: '700' },
  sheetBody: { fontSize: 13, lineHeight: 19, marginTop: 6 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginTop: 14 },
  reset: { fontSize: 14, fontWeight: '600', marginTop: 12 },
  sheetBtns: { flexDirection: 'row', gap: 10, marginTop: 18 },
  btn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  btnText: { fontSize: 15, fontWeight: '700' },
});
