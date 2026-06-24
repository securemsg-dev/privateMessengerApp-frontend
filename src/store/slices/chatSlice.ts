import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  saveMessage,
  getMessagesByConversation,
  getConversations,
  deleteAllMessages,
} from '../../services/database';
import { deleteConversationApi, listConversationsApi, listMessagesApi } from '../../services/api';
import {
  decryptOrFallback,
  MediaEnvelope,
  parseMediaEnvelope,
} from '../../services/crypto';

/* ── Types ─────────────────────────────────────────────── */

export type MessageType = 'text' | 'image' | 'video' | 'voice' | 'document';

export interface Conversation {
  id: string;
  contactName: string;
  contactPrivateNumber: string;
  /** Peer's Curve25519 public key (Base64). Null until they upload one. */
  contactPublicKey: string | null;
  lastMessage: string;
  lastMessageTime: string;
  lastMessageType: MessageType;
  unreadCount: number;
  isSelfChat: boolean;

  // Phase C.1 — per-user prefs (server-backed). Mirror backend
  // ConversationResponse so we can drop server snapshots straight in.
  isPinned: boolean;
  /** ISO8601; null = not muted. Treat any future timestamp as currently muted. */
  muteUntil: string | null;
  manualUnread: boolean;
}

/** One emoji's tally on a message — mirrors backend `ReactionAggregate`. */
export interface MessageReaction {
  emoji: string;
  count: number;
  byMe: boolean;
}

/** Snapshot of a replied-to message — already decrypted on the client. */
export interface ReplyPreview {
  id: string;
  senderId: string;
  type: MessageType;
  content: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  content: string;
  type: MessageType;
  mediaUri?: string;
  timestamp: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';

  // Phase C.2 — per-message metadata
  reactions: MessageReaction[];
  isStarred: boolean;
  replyToId: string | null;
  replyPreview: ReplyPreview | null;
  // Phase C.3 — delete-for-everyone tombstone state. When `deletedAt` is
  // set the bubble renders as "🗑 This message was deleted" and other
  // metadata is suppressed. Delete-for-me removes the row entirely so
  // there's no separate flag for it.
  deletedAt: string | null;
  deletedBy: string | null;

  // Phase D — encrypted-media metadata. When set, the message body is a
  // pointer (downloadUrl + key + nonce) rather than text. `mediaUri` is
  // the local cached path after we download + decrypt; until then the UI
  // shows a placeholder. Null for plain text messages.
  mediaEnvelope: MediaEnvelope | null;
}

interface ChatState {
  conversations: Conversation[];
  activeMessages: Message[];
  status: 'idle' | 'loading';
  /** Conversation the user is currently viewing (ChatScreen open). Drives
   *  whether an incoming message_notification bumps the unread counter. */
  activeConversationId: string | null;
}

const initialState: ChatState = {
  conversations: [],
  activeMessages: [],
  status: 'idle',
  activeConversationId: null,
};

const isSelfChatId = (conversationId: string) =>
  conversationId.startsWith('self_');

/* ── Thunks ────────────────────────────────────────────── */

/**
 * Load the conversation list:
 *   - Self-chat (if any) comes from local SQLite (offline-only by design).
 *   - All other conversations come from the server, including the OTHER
 *     participant's display info and an unread count + last-message preview.
 *
 * If the server is unreachable, the self-chat list still loads so the user
 * can keep using offline notes.
 */
export const loadConversationsThunk = createAsyncThunk<Conversation[]>(
  'chat/loadConversations',
  async () => {
    const formatNum = (n: string) =>
      n.length === 10 ? `${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6, 10)}` : n;

    // 1. Self-chat from local SQLite
    const localRows = (await getConversations()) as Array<{
      conversation_id: string;
      last_message: string;
      last_time: string;
      last_type: string;
      sender_id: string;
      receiver_id: string;
    }>;
    const selfConvs: Conversation[] = localRows
      .filter((r) => isSelfChatId(r.conversation_id))
      .map((r) => ({
        id: r.conversation_id,
        contactName: '',
        contactPrivateNumber: '',
        contactPublicKey: null,
        lastMessage: r.last_message,
        lastMessageTime: r.last_time,
        lastMessageType: (r.last_type as MessageType) || 'text',
        unreadCount: 0,
        isSelfChat: true,
        isPinned: false,
        muteUntil: null,
        manualUnread: false,
      }));

    // 2. Real conversations from the server (best-effort — keep self-chat
    //    available even if the network is down). Last-message previews are
    //    decrypted using the per-conversation peer public key.
    let serverConvs: Conversation[] = [];
    try {
      const list = await listConversationsApi();
      serverConvs = await Promise.all(
        list.map<Promise<Conversation>>(async (c) => {
          const other = c.other_participant;
          const lastMsg = c.last_message;
          const peerKey = other?.public_key ?? null;
          const preview = lastMsg
            ? lastMsg.message_type === 'text'
              ? await decryptOrFallback(lastMsg.encrypted_payload, peerKey)
              : lastMsg.message_type === 'voice'
              ? '🎤 Voice message'
              : lastMsg.message_type === 'image'
              ? '📷 Photo'
              : ''
            : '';
          return {
            id: c.id,
            contactName:
              other?.display_name ||
              (other?.private_number ? formatNum(other.private_number) : ''),
            contactPrivateNumber: other?.private_number || '',
            contactPublicKey: peerKey,
            lastMessage: preview,
            lastMessageTime: lastMsg?.created_at || c.created_at,
            lastMessageType: (lastMsg?.message_type as MessageType) || 'text',
            unreadCount: c.unread_count,
            isSelfChat: false,
            isPinned: c.is_pinned,
            muteUntil: c.mute_until,
            manualUnread: c.manual_unread,
          };
        }),
      );
    } catch (err) {
      console.warn('[chat] Failed to load server conversations:', err);
    }

    return [...selfConvs, ...serverConvs];
  },
);

/**
 * Load message history for a conversation.
 *   - Self-chat (id starts with `self_`): purely local SQLite (drafts/notes
 *     never leave the device).
 *   - Real conversation: fetch from server (newest-first), decrypt each
 *     message body with our private key + the peer's public key, then store
 *     oldest-first to match the inverted FlatList renderer.
 *
 * `peerPublicKey` is the peer's Base64 Curve25519 key. Pass null when the
 * peer hasn't uploaded one yet — payloads will fall through as plaintext
 * (Phase A backward compatibility).
 */
export const loadMessagesThunk = createAsyncThunk<
  Message[],
  { conversationId: string; peerPublicKey: string | null }
>(
  'chat/loadMessages',
  async ({ conversationId, peerPublicKey }) => {
    if (isSelfChatId(conversationId)) {
      const rows = (await getMessagesByConversation(conversationId)) as Array<{
        id: string;
        conversation_id: string;
        sender_id: string;
        receiver_id: string;
        content: string;
        type: string;
        media_uri: string | null;
        timestamp: string;
        status: string;
      }>;
      return rows.map<Message>((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        receiverId: row.receiver_id,
        content: row.content,
        type: (row.type as MessageType) || 'text',
        mediaUri: row.media_uri ?? undefined,
        timestamp: row.timestamp,
        status: (row.status as Message['status']) || 'sent',
        // Self-chat is local-only; no reactions / star / reply metadata
        reactions: [],
        isStarred: false,
        replyToId: null,
        replyPreview: null,
        deletedAt: null,
        deletedBy: null,
        mediaEnvelope: null, // self-chat media is inlined as local file URIs
      }));
    }

    // Server: newest-first; reverse to oldest-first. Decrypt every message
    // body — including our own (nacl.box's shared secret is symmetric, so
    // (peerPubKey, mySecretKey) decrypts both directions).
    const page = await listMessagesApi(conversationId);
    const ordered = page.messages.slice().reverse();
    return Promise.all(
      ordered.map<Promise<Message>>(async (m) => {
        const decrypted = await decryptOrFallback(
          m.encrypted_payload, peerPublicKey,
        );
        // After decrypt, the plaintext is either a normal text message or
        // a JSON MediaEnvelope. We detect the latter and stash it; ChatScreen
        // is responsible for downloading + decrypting the bytes off the
        // critical path.
        const envelope = parseMediaEnvelope(decrypted);
        const content = envelope
          ? mediaPlaceholder(envelope.mime)
          : decrypted;

        let replyPreview: ReplyPreview | null = null;
        if (m.reply_preview) {
          const previewContent = await decryptOrFallback(
            m.reply_preview.encrypted_payload, peerPublicKey,
          );
          const previewEnvelope = parseMediaEnvelope(previewContent);
          replyPreview = {
            id: m.reply_preview.id,
            senderId: m.reply_preview.sender_id,
            type: m.reply_preview.message_type as MessageType,
            content: previewEnvelope
              ? mediaPlaceholder(previewEnvelope.mime)
              : previewContent,
          };
        }
        return {
          id: m.id,
          conversationId: m.conversation_id,
          senderId: m.sender_id,
          receiverId: '',
          content,
          type: m.message_type as MessageType,
          mediaUri: undefined,
          timestamp: m.created_at,
          status: m.read_at ? 'read' : m.delivered_at ? 'delivered' : 'sent',
          reactions: m.reactions.map((r) => ({
            emoji: r.emoji,
            count: r.count,
            byMe: r.by_me,
          })),
          isStarred: m.is_starred,
          replyToId: m.reply_to_id,
          replyPreview,
          deletedAt: m.deleted_at,
          deletedBy: m.deleted_by,
          mediaEnvelope: envelope,
        };
      }),
    );
  },
);

/** Default text shown in a bubble while an encrypted media blob is being
 *  fetched + decrypted, and in chat-list previews for media messages. */
export function mediaPlaceholder(mime: string): string {
  if (mime.startsWith('image/')) return '📷 Photo';
  if (mime.startsWith('video/')) return '🎥 Video';
  if (mime.startsWith('audio/')) return '🎤 Voice message';
  if (mime === 'application/pdf') return '📄 PDF Document';
  return '📎 Document';
}

/**
 * Optimistic local insertion for a message the user is sending. The actual
 * server hand-off happens via the WebSocket in ChatScreen — this thunk just
 * persists locally and pushes into Redux so the UI updates instantly.
 *
 * Caller may supply `id` to keep the same identifier across the optimistic
 * insert and the WS `client_temp_id` echo (lets the server confirmation
 * flow back to the right row without changing React keys).
 */
export const sendMessageThunk = createAsyncThunk(
  'chat/sendMessage',
  async (payload: {
    conversationId: string;
    senderId: string;
    receiverId: string;
    content: string;
    type?: MessageType;
    mediaUri?: string;
    id?: string;
    /** If set, this message is a reply to another message (Phase C.2). */
    replyTo?: ReplyPreview | null;
    /** Phase D — encrypted-media envelope for non-text messages. */
    mediaEnvelope?: MediaEnvelope | null;
  }) => {
    const id =
      payload.id ??
      Date.now().toString(36) + Math.random().toString(36).slice(2);
    const type = payload.type || 'text';
    await saveMessage(
      id,
      payload.conversationId,
      payload.senderId,
      payload.receiverId,
      payload.content,
      type,
      payload.mediaUri,
    );
    const message: Message = {
      id,
      conversationId: payload.conversationId,
      senderId: payload.senderId,
      receiverId: payload.receiverId,
      content: payload.content,
      type,
      mediaUri: payload.mediaUri,
      timestamp: new Date().toISOString(),
      status: 'sent',
      reactions: [],
      isStarred: false,
      replyToId: payload.replyTo?.id ?? null,
      replyPreview: payload.replyTo ?? null,
      deletedAt: null,
      deletedBy: null,
      mediaEnvelope: payload.mediaEnvelope ?? null,
    };
    return message;
  },
);

export const deleteAllConversationsThunk = createAsyncThunk(
  'chat/deleteAllConversations',
  async () => {
    await deleteAllMessages();
  },
);

/** Delete a specific set of conversations on the server, then remove them from Redux. */
export const deleteSelectedConversationsThunk = createAsyncThunk<
  string[],
  string[]
>('chat/deleteSelected', async (ids) => {
  for (const id of ids) {
    await deleteConversationApi(id);
  }
  return ids;
});

/* ── Slice ─────────────────────────────────────────────── */

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    clearActiveMessages(state) {
      state.activeMessages = [];
    },

    /**
     * Insert a new message or update an existing one in place. If
     * `matchClientTempId` is provided, find the existing message by that
     * local id first (used to reconcile the WS echo of our own send back
     * to the optimistic row).
     */
    upsertMessage(
      state,
      action: PayloadAction<{ message: Message; matchClientTempId?: string }>,
    ) {
      const { message, matchClientTempId } = action.payload;
      if (matchClientTempId) {
        const idx = state.activeMessages.findIndex(
          (m) => m.id === matchClientTempId,
        );
        if (idx >= 0) {
          // Keep the local id (so React keys + already-rendered refs survive)
          // but absorb anything authoritative from the server echo.
          state.activeMessages[idx] = {
            ...state.activeMessages[idx],
            timestamp: message.timestamp,
            status: message.status,
          };
          return;
        }
      }
      const idx = state.activeMessages.findIndex((m) => m.id === message.id);
      if (idx >= 0) {
        state.activeMessages[idx] = { ...state.activeMessages[idx], ...message };
      } else {
        state.activeMessages.push(message);
      }
    },

    /** Update a single message's delivery status (delivered / read tick). */
    updateMessageStatus(
      state,
      action: PayloadAction<{ id: string; status: Message['status'] }>,
    ) {
      const msg = state.activeMessages.find((m) => m.id === action.payload.id);
      if (msg) msg.status = action.payload.status;
    },

    /**
     * Patch fields on a conversation in-place — used for both optimistic
     * updates ("flip isPinned now") and authoritative server responses
     * ("server says these are the prefs"). Pass any subset of Conversation
     * fields and they'll be merged into the matching row.
     */
    mergeConversation(
      state,
      action: PayloadAction<{ id: string; patch: Partial<Conversation> }>,
    ) {
      const { id, patch } = action.payload;
      const idx = state.conversations.findIndex((c) => c.id === id);
      if (idx >= 0) {
        state.conversations[idx] = { ...state.conversations[idx], ...patch };
      }
    },

    /** Track which conversation is on-screen (set by ChatScreen on focus). */
    setActiveConversation(state, action: PayloadAction<string | null>) {
      state.activeConversationId = action.payload;
    },

    /**
     * Apply a live `message_notification` (delivered over the user channel
     * when a message lands in a conversation the user isn't actively viewing).
     * Updates the list preview/time and bumps unread unless it's the open
     * chat. The caller decrypts the preview before dispatching.
     */
    applyMessageNotification(
      state,
      action: PayloadAction<{
        conversationId: string;
        preview: string;
        messageType: MessageType;
        timestamp: string;
      }>,
    ) {
      const { conversationId, preview, messageType, timestamp } = action.payload;
      const conv = state.conversations.find((c) => c.id === conversationId);
      if (!conv) return; // unknown conversation — hook triggers a list refresh
      conv.lastMessage = preview;
      conv.lastMessageType = messageType;
      conv.lastMessageTime = timestamp;
      if (conversationId !== state.activeConversationId) {
        conv.unreadCount += 1;
      }
    },

    /**
     * Apply an incoming reaction WS event to the matching message. Caller
     * must compute `byMe` (we don't have access to current user state in
     * the slice). Adds a new aggregate row, increments an existing one,
     * or removes it when the count hits zero.
     */
    applyReactionEvent(
      state,
      action: PayloadAction<{
        messageId: string;
        emoji: string;
        byMe: boolean;
        action: 'added' | 'removed';
      }>,
    ) {
      const { messageId, emoji, byMe, action: kind } = action.payload;
      const msg = state.activeMessages.find((m) => m.id === messageId);
      if (!msg) return;
      const idx = msg.reactions.findIndex((r) => r.emoji === emoji);
      if (kind === 'added') {
        if (idx >= 0) {
          msg.reactions[idx].count += 1;
          if (byMe) msg.reactions[idx].byMe = true;
        } else {
          msg.reactions.push({ emoji, count: 1, byMe });
        }
      } else {
        if (idx < 0) return;
        msg.reactions[idx].count -= 1;
        if (byMe) msg.reactions[idx].byMe = false;
        if (msg.reactions[idx].count <= 0) {
          msg.reactions.splice(idx, 1);
        }
      }
    },

    /** Set/clear the `isStarred` flag on a message in the active list. */
    setMessageStarred(
      state,
      action: PayloadAction<{ messageId: string; starred: boolean }>,
    ) {
      const msg = state.activeMessages.find(
        (m) => m.id === action.payload.messageId,
      );
      if (msg) msg.isStarred = action.payload.starred;
    },

    /** Remove a conversation from the list after a confirmed server-side leave. */
    removeConversation(state, action: PayloadAction<{ id: string }>) {
      state.conversations = state.conversations.filter(
        (c) => c.id !== action.payload.id,
      );
    },

    /**
     * Remove a message from the active list entirely (Phase C.3 —
     * delete-for-me). Caller is responsible for the API call; this
     * reducer just collapses the local view.
     */
    removeMessage(state, action: PayloadAction<{ messageId: string }>) {
      state.activeMessages = state.activeMessages.filter(
        (m) => m.id !== action.payload.messageId,
      );
    },

    /**
     * Mark a message as deleted for everyone (Phase C.3 — incoming
     * `deletion` WS event). The bubble stays in place but renders a
     * tombstone; reactions/replies clear.
     */
    markMessageDeletedForEveryone(
      state,
      action: PayloadAction<{
        messageId: string;
        byUserId: string;
        timestamp: string;
      }>,
    ) {
      const msg = state.activeMessages.find(
        (m) => m.id === action.payload.messageId,
      );
      if (!msg) return;
      msg.deletedAt = action.payload.timestamp;
      msg.deletedBy = action.payload.byUserId;
      msg.content = '';
      msg.reactions = [];
      msg.replyPreview = null;
      msg.mediaEnvelope = null;
      msg.mediaUri = undefined;
    },

    /**
     * Phase D — once media has been downloaded + decrypted, point the
     * message at the local file URI. Subsequent re-renders read from
     * disk instead of re-decrypting.
     */
    hydrateMessageMedia(
      state,
      action: PayloadAction<{ messageId: string; localUri: string }>,
    ) {
      const msg = state.activeMessages.find(
        (m) => m.id === action.payload.messageId,
      );
      if (msg) msg.mediaUri = action.payload.localUri;
    },
  },
  extraReducers: (builder) => {
    builder
      // loadConversations — payload is already a Conversation[]
      .addCase(loadConversationsThunk.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(loadConversationsThunk.fulfilled, (state, action) => {
        state.status = 'idle';
        state.conversations = action.payload;
      })
      // loadMessages
      .addCase(loadMessagesThunk.fulfilled, (state, action) => {
        state.activeMessages = action.payload;
      })
      // sendMessage — upsert so a fast WS echo that already inserted the
      // message by client_temp_id doesn't produce a duplicate key.
      .addCase(sendMessageThunk.fulfilled, (state, action) => {
        const msg = action.payload;
        const idx = state.activeMessages.findIndex((m) => m.id === msg.id);
        if (idx >= 0) {
          state.activeMessages[idx] = { ...state.activeMessages[idx], ...msg };
        } else {
          state.activeMessages.push(msg);
        }
      })
      // deleteAllConversations
      .addCase(deleteAllConversationsThunk.fulfilled, (state) => {
        state.conversations = [];
        state.activeMessages = [];
      })
      // deleteSelectedConversations
      .addCase(deleteSelectedConversationsThunk.fulfilled, (state, action) => {
        const removed = new Set(action.payload);
        state.conversations = state.conversations.filter((c) => !removed.has(c.id));
      });
  },
});

export const {
  clearActiveMessages,
  upsertMessage,
  updateMessageStatus,
  mergeConversation,
  setActiveConversation,
  applyMessageNotification,
  removeConversation,
  applyReactionEvent,
  setMessageStarred,
  removeMessage,
  markMessageDeletedForEveryone,
  hydrateMessageMedia,
} = chatSlice.actions;
export default chatSlice.reducer;
