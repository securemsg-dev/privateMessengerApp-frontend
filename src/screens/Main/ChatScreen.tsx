import React, { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  NativeSyntheticEvent,
  Platform,
  TextInput,
  TextInputSelectionChangeEventData,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSelector, useDispatch } from 'react-redux';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../../theme/ThemeContext';
import { RootState, AppDispatch } from '../../store';
import {
  loadMessagesThunk,
  loadOlderMessagesThunk,
  hydrateMessagesThunk,
  clearActiveMessages,
  mergeConversation,
  setActiveConversation,
} from '../../store/slices/chatSlice';
import { AttachmentTray } from '../../components/AttachmentTray';
import { QuoteBar } from '../../components/QuoteBar';
import { MessageActionSheet } from '../../components/MessageActionSheet';
import { ForwardSheet } from '../../components/ForwardSheet';
import { ChatOverflowMenu } from '../../components/ChatOverflowMenu';
import { ReportSheet } from '../../components/ReportSheet';
import { EmojiPickerSheet } from '../../components/EmojiPickerSheet';
import { MediaViewerModal, MediaViewerItem } from '../../components/MediaViewerModal';
import {
  cryptoConvOf,
  hydrateMessageMedia,
  mediaMetaOf,
  Message,
  refreshConversationThunk,
} from '../../store/slices/chatSlice';
import { CryptoConv, NO_CRYPTO } from '../../services/conversationCrypto';
import { Outbox } from '../../services/outbox';
import { downloadAndDecryptMedia } from '../../services/media';
import { insertAtSelection, Selection } from '../../utils/textInsert';
import { useCall } from '../../components/CallProvider';

import { usePeerKeyLookup } from '../../hooks/usePeerKeyLookup';
import { useChatSocket } from '../../hooks/useChatSocket';
import { useReadReceipts } from '../../hooks/useReadReceipts';
import { useMediaHydration } from '../../hooks/useMediaHydration';
import { useReplyContext } from '../../hooks/useReplyContext';
import { useStopVoiceOnUnmount } from '../../hooks/useVoicePlayback';
import { useMediaSender } from '../../hooks/useMediaSender';
import { useTextSender } from '../../hooks/useTextSender';
import { useMediaPicker } from '../../hooks/useMediaPicker';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { useMessageActions } from '../../hooks/useMessageActions';
import { useChatSafety } from '../../hooks/useChatSafety';
import { useMemberSafety } from '../../hooks/useMemberSafety';

import { ChatHeader } from './chat/ChatHeader';
import { MessageList } from './chat/MessageList';
import { ChatComposer } from './chat/ChatComposer';
import { RecordingBar } from './chat/RecordingBar';
import { PreviewBar } from './chat/PreviewBar';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import { useEffect } from 'react';

type ChatScreenParams = {
  ChatScreen: {
    conversationId: string;
    contactName: string;
    contactPrivateNumber: string;
    isSelfChat?: boolean;
    contactPublicKey?: string | null;
    isGroup?: boolean;
  };
};

export const ChatScreen = () => {
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ChatScreenParams, 'ChatScreen'>>();
  const dispatch = useDispatch<AppDispatch>();
  const { bottom: bottomInset } = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();

  const {
    conversationId,
    contactName,
    contactPrivateNumber,
    isSelfChat,
    contactPublicKey: initialPeerKey,
    isGroup: isGroupParam,
  } = route.params;

  const userId = useSelector((s: RootState) => s.auth.userId);
  const privateNumber = useSelector((s: RootState) => s.auth.privateNumber);
  const displayName = useSelector((s: RootState) => s.auth.displayName);
  const messages = useSelector((s: RootState) => s.chat.activeMessages);
  const messagesCursor = useSelector((s: RootState) => s.chat.messagesCursor);
  const loadingOlder = useSelector((s: RootState) => s.chat.loadingOlder);
  const peerPresence = useSelector((s: RootState) => s.chat.peerPresence);
  // Peer avatar comes from the cached conversation (no need to thread through
  // navigation params); falls back to initials when the chat isn't listed yet.
  const conv = useSelector((s: RootState) =>
    s.chat.conversations.find((c) => c.id === conversationId),
  );

  const isGroup = !!(isGroupParam || conv?.isGroup);
  // Group name can change while open (rename) — prefer the live value.
  const chatTitle = isGroup ? conv?.contactName || contactName : contactName;

  const senderId = userId || privateNumber || 'local';
  const firstName = isGroup ? chatTitle : (contactName || '').split(' ')[0] || 'there';

  const { startOutgoingCall } = useCall();
  const handleCallPress = () => {
    if (isSelfChat) return;
    if (isGroup) {
      Alert.alert('Group call', 'Group calling — to be continued.');
      return;
    }
    void startOutgoingCall({ name: contactName, number: contactPrivateNumber, conversationId });
  };
  const openGroupInfo = () => navigation.navigate('GroupInfo', { conversationId });

  // Groups opened from a push / before the list loaded have no member list
  // yet — fetch it (needed to encrypt and to label senders).
  useEffect(() => {
    if (isGroup && !conv?.members?.length) void dispatch(refreshConversationThunk(conversationId));
  }, [isGroup, conversationId, conv?.members?.length, dispatch]);

  // Attachment tray
  const [trayOpen, setTrayOpen] = useState(false);
  const closeTray = () => { if (!trayOpen) return; setTrayOpen(false); };
  const togglePlus = () => {
    Haptics.selectionAsync().catch(() => {});
    if (trayOpen) { closeTray(); } else { Keyboard.dismiss(); setTrayOpen(true); }
  };

  const textInputRef = useRef<TextInput>(null);

  // Emoji picker: either inserting into the composer, or reacting to a
  // specific message (opened from the "+" in the long-press reaction strip).
  const [emojiTarget, setEmojiTarget] = useState<
    null | { kind: 'composer' } | { kind: 'reaction'; message: Message }
  >(null);
  const selectionRef = useRef<Selection | null>(null);

  // Full-screen media viewer (tap on an image bubble).
  const [viewerItem, setViewerItem] = useState<MediaViewerItem | null>(null);
  const handleOpenMedia = (m: Message) => {
    const base = {
      key: m.id,
      title: m.senderId === senderId ? 'You' : m.senderName || contactName,
      timestamp: m.timestamp,
      mime: m.mediaEnvelope?.mime,
    };
    if (m.type !== 'video') {
      if (m.mediaUri) setViewerItem({ ...base, kind: 'image', uri: m.mediaUri });
      return;
    }
    const poster = mediaMetaOf(m).poster;
    const posterUri = poster ? `data:image/jpeg;base64,${poster}` : undefined;
    if (m.mediaUri) {
      setViewerItem({ ...base, kind: 'video', uri: m.mediaUri, posterUri });
      return;
    }
    if (!m.mediaEnvelope) return;
    // Videos aren't auto-downloaded — fetch + decrypt now, poster meanwhile.
    setViewerItem({ ...base, kind: 'video', posterUri });
    downloadAndDecryptMedia(m.mediaEnvelope)
      .then((localUri) => {
        dispatch(hydrateMessageMedia({ messageId: m.id, localUri }));
        setViewerItem((cur) => (cur?.key === m.id ? { ...cur, uri: localUri } : cur));
      })
      .catch(() => {
        setViewerItem((cur) =>
          cur?.key === m.id ? { ...cur, error: 'Could not load this video. Try again later.' } : cur,
        );
      });
  };
  const handleSelectionChange = (
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) => {
    selectionRef.current = e.nativeEvent.selection;
  };
  const openComposerEmoji = () => {
    Haptics.selectionAsync().catch(() => {});
    Keyboard.dismiss();
    closeTray();
    setEmojiTarget({ kind: 'composer' });
  };

  // Hooks — dependency order matches plan phases 1-3
  // 1:1 key lookup (skipped for self-chat and groups).
  const { peerPublicKey } = usePeerKeyLookup(
    contactPrivateNumber, isSelfChat || isGroup, initialPeerKey,
  );
  // How this chat encrypts/decrypts — 1:1 peer key or the group member list.
  const crypto: CryptoConv = useMemo(
    () => (isSelfChat ? NO_CRYPTO : cryptoConvOf(conv, peerPublicKey)),
    [isSelfChat, conv, peerPublicKey],
  );
  const cryptoRef = useRef<CryptoConv>(crypto);
  cryptoRef.current = crypto;
  const outboxRef = useRef<Outbox | null>(null);

  const { hydrateMediaFor } = useMediaHydration(dispatch, messages);
  const { socketRef, senderIdRef, ackedReadRef } = useChatSocket(
    conversationId, isSelfChat, senderId, cryptoRef, outboxRef, dispatch, hydrateMediaFor,
    () => {
      Alert.alert("You're no longer in this group", 'You were removed or the group was deleted.');
      navigation.goBack();
    },
  );
  if (!outboxRef.current) {
    outboxRef.current = new Outbox({
      conversationId,
      dispatch,
      socket: () => socketRef.current,
      crypto: () => cryptoRef.current,
    });
  }
  useReadReceipts(socketRef, messages, senderId, isSelfChat, ackedReadRef, isGroup);

  const { replyTo, handleReply, dismissReply } = useReplyContext(
    messages, senderId, displayName, isGroup ? '' : contactName, textInputRef,
  );
  useStopVoiceOnUnmount();
  const { sendMediaAsset } = useMediaSender(
    conversationId, senderId, contactPrivateNumber, isSelfChat, outboxRef, dispatch,
  );
  const { text, setText, handleSend } = useTextSender(
    conversationId, senderId, contactPrivateNumber, isSelfChat,
    outboxRef, dispatch, replyTo, dismissReply, messages,
  );
  // Ref mirror so several quick picks in a row each build on the latest text
  // (the picker stays open between picks; a render may not have landed yet).
  const textRef = useRef(text);
  textRef.current = text;
  const handleEmojiPicked = (emoji: string) => {
    if (emojiTarget?.kind === 'reaction') {
      actions.handleReact(emojiTarget.message, emoji);
      return;
    }
    const next = insertAtSelection(textRef.current, selectionRef.current, emoji, 4000);
    textRef.current = next.text;
    selectionRef.current = { start: next.cursor, end: next.cursor };
    setText(next.text);
  };
  const { handlePickFromGallery, handleCamera, handlePickFile } = useMediaPicker(
    sendMediaAsset, closeTray,
  );
  const recorder = useVoiceRecorder(sendMediaAsset, closeTray);
  const actions = useMessageActions(dispatch, senderId, socketRef);
  const safety = useChatSafety(
    contactPrivateNumber, contactName, conversationId, isSelfChat || isGroup, messages, senderId,
  );
  // Groups: report / block an individual member.
  const memberSafety = useMemberSafety(conversationId, messages, senderId);
  const targetOf = (m: Message) => ({ userId: m.senderId, name: m.senderName || 'this member' });

  // Load message history once we can decrypt it: the peer key (1:1) or the
  // member list (groups). Member changes later don't reload history.
  const cryptoReady = isSelfChat
    ? true
    : isGroup
    ? (conv?.members?.length ?? 0) > 0
    : peerPublicKey !== null;
  useEffect(() => {
    if (!cryptoReady) return;
    dispatch(loadMessagesThunk({ conversationId, crypto: cryptoRef.current }));
  }, [conversationId, cryptoReady, dispatch]);

  // Older-history pagination: fired when the user scrolls to the top of the
  // thread. The thunk's own `condition` guards against double-fires and
  // no-ops once the full history is loaded (cursor null).
  const handleLoadOlder = () => {
    if (isSelfChat || !messagesCursor) return;
    dispatch(
      loadOlderMessagesThunk({
        conversationId,
        crypto: cryptoRef.current,
        before: messagesCursor,
      }),
    );
  };

  // Mark this conversation active while open so incoming message_notifications
  // don't bump its unread counter (and clear unread now that it's read). On
  // unmount, release it so future messages here count as unread again.
  useEffect(() => {
    dispatch(setActiveConversation(conversationId));
    dispatch(mergeConversation({ id: conversationId, patch: { unreadCount: 0, manualUnread: false } }));
    // Start this thread from a clean slate, then paint cached history instantly
    // while loadMessagesThunk fetches + decrypts the fresh page in the
    // background. (Self-chat is local SQLite — already fast, no cache needed.)
    if (!isSelfChat) {
      dispatch(clearActiveMessages());
      dispatch(hydrateMessagesThunk(conversationId));
    }
    return () => {
      dispatch(setActiveConversation(null));
    };
  }, [conversationId, dispatch, isSelfChat]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
        <ChatHeader
          contactName={chatTitle}
          contactPrivateNumber={contactPrivateNumber}
          contactProfilePictureKey={conv?.contactProfilePictureKey}
          isSelfChat={isSelfChat}
          displayName={displayName}
          colors={colors}
          onBack={() => navigation.goBack()}
          onCall={handleCallPress}
          onCallLongPress={() => { /* reserved */ }}
          // Groups: ⋮ opens group info (members, report/block, leave).
          onOverflow={isGroup ? openGroupInfo : () => safety.setMenuOpen(true)}
          presence={isGroup ? null : peerPresence}
          isGroup={isGroup}
          memberCount={conv?.members?.length}
          onOpenInfo={openGroupInfo}
        />
      </SafeAreaView>

      {/* iOS: KAV `padding` tracks keyboardWillShow/Hide for smooth animated
          avoidance (its bottom edge is the screen bottom, so no
          keyboardVerticalOffset needed).

          Android: KAV is disabled and the OS handles avoidance via
          android.softwareKeyboardLayoutMode: "pan" (app.json). Three
          approaches were tried on SDK 54 edge-to-edge and only pan is usable:
            • keyboardHeight-sized spacer → collapsed (keyboardDidShow can
              report height 0 under edge-to-edge), composer hid behind the
              keyboard;
            • KAV behavior="padding" → correct on show, but left a large stale
              gap after dismissal (device-confirmed twice);
            • pan → composer always correct; cost is that the window shifts, so
              the header scrolls off while typing.
          Revisit with react-native-keyboard-controller (needs reanimated +
          worklets + a babel plugin) when there's room to verify it properly. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <MessageList
          messages={messages}
          senderId={senderId}
          contactName={contactName}
          isGroup={isGroup}
          colors={colors}
          isSelfChat={isSelfChat}
          onReply={handleReply}
          onActionSheet={(m, isSent, rect) => actions.openActionSheet(m, isSent, rect)}
          onOpenMedia={handleOpenMedia}
          onLoadOlder={handleLoadOlder}
          loadingOlder={loadingOlder}
        />

        {recorder.recMode === 'preview' ? (
          <PreviewBar
            previewDuration={recorder.previewDuration}
            previewPlaying={recorder.previewPlaying}
            waveform={recorder.previewMeta.waveform}
            colors={colors}
            formatDuration={recorder.formatDuration}
            discardPreview={recorder.discardPreview}
            togglePreviewPlayback={recorder.togglePreviewPlayback}
            sendPreview={recorder.sendPreview}
          />
        ) : (
          <>
            {recorder.recMode === 'idle' && replyTo && (
              <QuoteBar replyTo={replyTo} onDismiss={dismissReply} />
            )}
            {recorder.recMode === 'recording' ? (
              <RecordingBar
                recordingDuration={recorder.recordingDuration}
                cancelDx={recorder.cancelDx}
                redDotPulse={recorder.redDotPulse}
                liveLevels={recorder.liveLevels}
                recPan={recorder.recPan}
                colors={colors}
                formatDuration={recorder.formatDuration}
                cancelRec={recorder.cancelRec}
              />
            ) : (
              <ChatComposer
                text={text}
                setText={setText}
                firstName={firstName}
                trayOpen={trayOpen}
                colors={colors}
                textInputRef={textInputRef}
                recPan={recorder.recPan}
                handleSend={handleSend}
                closeTray={closeTray}
                handleCamera={handleCamera}
                togglePlus={togglePlus}
                onEmojiPress={openComposerEmoji}
                onSelectionChange={handleSelectionChange}
              />
            )}
            <AttachmentTray
              open={trayOpen}
              onPickGallery={handlePickFromGallery}
              onPickCamera={handleCamera}
              onPickFile={handlePickFile}
              onStartVoice={recorder.startRec}
            />
          </>
        )}

        {/* The keyboard itself is handled per-platform, never by this spacer:
            iOS by the KAV `padding` above, Android by the window pan
            (android.softwareKeyboardLayoutMode: "pan" in app.json). Under
            SDK 54 edge-to-edge, keyboardDidShow's endCoordinates.height is
            unreliable on Android — it can report 0, which collapsed the old
            height-driven spacer and left the composer behind the keyboard.
            So the spacer now only reserves the home-indicator / nav-bar inset
            while the keyboard is closed, and collapses while it is open (the
            keyboard already covers that area). */}
        <View
          style={{
            height: keyboardHeight > 0 ? 0 : bottomInset,
            backgroundColor: colors.background,
          }}
        />
      </KeyboardAvoidingView>

      <MessageActionSheet
        visible={!!actions.actionSheet}
        message={actions.actionSheet?.message ?? null}
        rect={actions.actionSheet?.rect ?? null}
        isSent={actions.actionSheet?.isSent ?? false}
        isDark={isDark}
        onDismiss={actions.closeActionSheet}
        onReply={() => actions.actionSheet && handleReply(actions.actionSheet.message)}
        onCopy={() => actions.actionSheet && actions.handleCopyText(actions.actionSheet.message)}
        onForward={() => actions.actionSheet && actions.handleForward(actions.actionSheet.message)}
        onStar={() => actions.actionSheet && actions.handleStar(actions.actionSheet.message)}
        onDelete={() => actions.actionSheet && actions.handleDelete(actions.actionSheet.message)}
        onReact={(e) => actions.actionSheet && actions.handleReact(actions.actionSheet.message, e)}
        onReportSender={
          isGroup
            ? () => {
                const m = actions.actionSheet?.message;
                // After the sheet's Modal dismisses (iOS can't stack Modals).
                if (m) setTimeout(() => memberSafety.openReport(targetOf(m)), 300);
              }
            : undefined
        }
        onBlockSender={
          isGroup
            ? () => actions.actionSheet && memberSafety.blockMember(targetOf(actions.actionSheet.message))
            : undefined
        }
        onMoreReactions={() => {
          const target = actions.actionSheet?.message;
          if (!target) return;
          // Let the action-sheet Modal finish dismissing before presenting
          // the picker — iOS drops a Modal presented mid-dismiss.
          setTimeout(() => setEmojiTarget({ kind: 'reaction', message: target }), 300);
        }}
      />

      <MediaViewerModal item={viewerItem} onClose={() => setViewerItem(null)} />

      <EmojiPickerSheet
        open={emojiTarget !== null}
        multiple={emojiTarget?.kind === 'composer'}
        onClose={() => setEmojiTarget(null)}
        onPick={handleEmojiPicked}
      />

      <ForwardSheet
        visible={actions.forwardingMessage !== null}
        excludeIds={[conversationId]}
        onClose={() => actions.setForwardingMessage(null)}
        onPick={actions.performForward}
      />

      {/* Safety — block + report (Google Play UGC policy requirement). */}
      <ChatOverflowMenu
        visible={safety.menuOpen}
        contactName={contactName}
        isBlocked={safety.isBlocked}
        actionsEnabled={!!safety.peerUserId}
        onClose={() => safety.setMenuOpen(false)}
        onToggleBlock={safety.toggleBlock}
        onReport={safety.openReport}
      />

      {/* Groups: report one member (from the long-press menu). */}
      <ReportSheet
        visible={memberSafety.target !== null}
        contactName={memberSafety.target?.name ?? ''}
        availableEvidence={memberSafety.availableEvidence}
        submitting={memberSafety.submitting}
        onClose={memberSafety.closeReport}
        onSubmit={memberSafety.submitReport}
      />

      <ReportSheet
        visible={safety.reportOpen}
        contactName={contactName}
        availableEvidence={safety.availableEvidence}
        submitting={safety.submitting}
        onClose={() => safety.setReportOpen(false)}
        onSubmit={safety.submitReport}
      />
    </View>
  );
};
