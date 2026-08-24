import React, { useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  TextInput,
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
import { useCall } from '../../components/CallProvider';

import { usePeerKeyLookup } from '../../hooks/usePeerKeyLookup';
import { useChatSocket } from '../../hooks/useChatSocket';
import { useReadReceipts } from '../../hooks/useReadReceipts';
import { useMediaHydration } from '../../hooks/useMediaHydration';
import { useReplyContext } from '../../hooks/useReplyContext';
import { useVoicePlayback } from '../../hooks/useVoicePlayback';
import { useMediaSender } from '../../hooks/useMediaSender';
import { useTextSender } from '../../hooks/useTextSender';
import { useMediaPicker } from '../../hooks/useMediaPicker';
import { useVoiceRecorder } from '../../hooks/useVoiceRecorder';
import { useMessageActions } from '../../hooks/useMessageActions';
import { useChatSafety } from '../../hooks/useChatSafety';

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
  } = route.params;

  const userId = useSelector((s: RootState) => s.auth.userId);
  const privateNumber = useSelector((s: RootState) => s.auth.privateNumber);
  const displayName = useSelector((s: RootState) => s.auth.displayName);
  const messages = useSelector((s: RootState) => s.chat.activeMessages);
  const messagesCursor = useSelector((s: RootState) => s.chat.messagesCursor);
  const loadingOlder = useSelector((s: RootState) => s.chat.loadingOlder);
  // Peer avatar comes from the cached conversation (no need to thread through
  // navigation params); falls back to initials when the chat isn't listed yet.
  const conv = useSelector((s: RootState) =>
    s.chat.conversations.find((c) => c.id === conversationId),
  );

  const senderId = userId || privateNumber || 'local';
  const firstName = (contactName || '').split(' ')[0] || 'there';

  const { startOutgoingCall } = useCall();
  const handleCallPress = () => {
    if (isSelfChat) return;
    void startOutgoingCall({ name: contactName, number: contactPrivateNumber, conversationId });
  };

  // Attachment tray
  const [trayOpen, setTrayOpen] = useState(false);
  const closeTray = () => { if (!trayOpen) return; setTrayOpen(false); };
  const togglePlus = () => {
    Haptics.selectionAsync().catch(() => {});
    if (trayOpen) { closeTray(); } else { Keyboard.dismiss(); setTrayOpen(true); }
  };

  const textInputRef = useRef<TextInput>(null);

  // Hooks — dependency order matches plan phases 1-3
  const { peerPublicKey, peerPublicKeyRef } = usePeerKeyLookup(
    contactPrivateNumber, isSelfChat, initialPeerKey,
  );
  const { hydrateMediaFor } = useMediaHydration(dispatch, messages);
  const { socketRef, senderIdRef, ackedReadRef } = useChatSocket(
    conversationId, isSelfChat, senderId, peerPublicKeyRef, dispatch, hydrateMediaFor,
  );
  useReadReceipts(socketRef, messages, senderId, isSelfChat, ackedReadRef);

  const { replyTo, handleReply, dismissReply } = useReplyContext(
    messages, senderId, displayName, contactName, textInputRef,
  );
  const { playingId, soundRef, handlePlayVoice } = useVoicePlayback();
  const { sendMediaAsset } = useMediaSender(
    conversationId, senderId, contactPrivateNumber, isSelfChat, socketRef, peerPublicKeyRef, dispatch,
  );
  const { text, setText, handleSend } = useTextSender(
    conversationId, senderId, contactPrivateNumber, isSelfChat,
    socketRef, peerPublicKeyRef, dispatch, replyTo, dismissReply, messages,
  );
  const { handlePickFromGallery, handleCamera, handlePickFile } = useMediaPicker(
    sendMediaAsset, closeTray,
  );
  const recorder = useVoiceRecorder(sendMediaAsset, closeTray);
  const actions = useMessageActions(dispatch, senderId, socketRef);
  const safety = useChatSafety(
    contactPrivateNumber, contactName, conversationId, isSelfChat, messages, senderId,
  );

  // Load message history when peer key is ready
  useEffect(() => {
    if (isSelfChat) {
      dispatch(loadMessagesThunk({ conversationId, peerPublicKey: null }));
    } else if (peerPublicKey !== null) {
      dispatch(loadMessagesThunk({ conversationId, peerPublicKey }));
    }
  }, [conversationId, peerPublicKey, isSelfChat, dispatch]);

  // Older-history pagination: fired when the user scrolls to the top of the
  // thread. The thunk's own `condition` guards against double-fires and
  // no-ops once the full history is loaded (cursor null).
  const handleLoadOlder = () => {
    if (isSelfChat || !messagesCursor) return;
    dispatch(
      loadOlderMessagesThunk({
        conversationId,
        peerPublicKey,
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

  // Unload playback sound on unmount
  useEffect(() => {
    return () => { soundRef.current?.unloadAsync(); };
  }, [soundRef]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
        <ChatHeader
          contactName={contactName}
          contactPrivateNumber={contactPrivateNumber}
          contactProfilePictureKey={conv?.contactProfilePictureKey}
          isSelfChat={isSelfChat}
          displayName={displayName}
          colors={colors}
          onBack={() => navigation.goBack()}
          onCall={handleCallPress}
          onCallLongPress={() => { /* reserved */ }}
          onOverflow={() => safety.setMenuOpen(true)}
        />
      </SafeAreaView>

      {/* `padding` on BOTH platforms: the KAV's bottom edge is the screen
          bottom, so no keyboardVerticalOffset is needed. Android previously
          disabled the KAV and hand-rolled a keyboardHeight-sized spacer, but
          the two fought each other (that combination is what produced the
          "stale gap after dismissal" the old comment described, and under
          SDK 54 edge-to-edge the spacer collapsed entirely because
          keyboardDidShow can report height 0 — leaving the composer behind the
          keyboard). The spacer below is now inset-only, so the KAV owns
          keyboard avoidance alone on both platforms and the header stays
          pinned. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <MessageList
          messages={messages}
          senderId={senderId}
          contactName={contactName}
          colors={colors}
          playingId={playingId}
          isSelfChat={isSelfChat}
          onReply={handleReply}
          onActionSheet={(m, isSent, rect) => actions.openActionSheet(m, isSent, rect)}
          onPlayVoice={handlePlayVoice}
          onLoadOlder={handleLoadOlder}
          loadingOlder={loadingOlder}
        />

        {recorder.recMode === 'preview' ? (
          <PreviewBar
            previewDuration={recorder.previewDuration}
            previewPlaying={recorder.previewPlaying}
            waveformPhase={recorder.waveformPhase}
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
                waveformPhase={recorder.waveformPhase}
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
