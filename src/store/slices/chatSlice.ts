import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  saveMessage,
  getMessagesByConversation,
  getConversations,
  deleteAllMessages,
} from '../../services/database';
import {
  ConversationDTO,
  deleteConversationApi,
  getConversationApi,
  listConversationsApi,
  listMessagesApi,
  MessageDTO,
} from '../../services/api';
import {
  CryptoConv,
  decryptFor,
} from '../../services/conversationCrypto';
import {
  MediaEnvelope,
  MediaMeta,
  parseMediaEnvelope,
} from '../../services/crypto';
import { cacheGet, cacheSet, CACHE_KEYS } from '../../services/cache';
import { voicePreviewText } from '../../utils/waveform';
import type { PeerPresence } from '../../utils/presence';

/* ── Types ─────────────────────────────────────────────── */

export type MessageType = 'text' | 'image' | 'video' | 'voice' | 'document' | 'system';

/**
 * Display type for a received message. Older app builds sent videos with wire
 * type 'image' (the backend had no 'video' type); the envelope's mime tells
 * the truth.
 */
export function effectiveType(
  wireType: string,
  envelope: Pick<MediaEnvelope, 'mime'> | null | undefined,
): MessageType {
  if (wireType === 'image' && envelope?.mime.startsWith('video/')) return 'video';
  return wireType as MessageType;
}

export interface Conversation {
  id: string;
  contactName: string;
  contactPrivateNumber: string;
  /** Peer's profile_picture_key (media blob id); null when they have no avatar. */
  contactProfilePictureKey: string | null;
  /** Peer's Curve25519 public key (Base64). Null until they upload one. */
  contactPublicKey: string | null;
  /** Peer's profile bio (1:1 only). */
  contactBio?: string | null;
  lastMessage: string;
  lastMessageTime: string;
  lastMessageType: MessageType;
  unreadCount: number;
  isSelfChat: boolean;

  // Groups — `contactName` holds the group name for display; the 1:1-only
  // contact fields are empty.
  isGroup?: boolean;
  /** Current members incl. me (groups only). */
  members?: GroupMember[];
  myRole?: 'admin' | 'member' | null;
  /** 1:1 only: the peer's user id (presence, safety). */
  peerUserId?: string | null;
  /** Who sent the last message (groups render "Name: preview"). */
  lastMessageSenderId?: string | null;
  lastMessageSenderName?: string | null;

  // Phase C.1 — per-user prefs (server-backed). Mirror backend
  // ConversationResponse so we can drop server snapshots straight in.
  isPinned: boolean;
  /** ISO8601; null = not muted. Treat any future timestamp as currently muted. */
  muteUntil: string | null;
  manualUnread: boolean;
}

export interface GroupMember {
  userId: string;
  displayName: string | null;
  profilePictureKey: string | null;
  publicKey: string | null;
  role: 'admin' | 'member';
}

/** How to encrypt / decrypt for this conversation (see conversationCrypto). */
export function cryptoConvOf(
  conv: Conversation | undefined,
  fallbackPeerKey: string | null = null,
): CryptoConv {
  if (conv?.isGroup) {
    return {
      isGroup: true,
      peerPublicKey: null,
      members: (conv.members ?? []).map((m) => ({ userId: m.userId, publicKey: m.publicKey })),
    };
  }
  return { isGroup: false, peerPublicKey: conv?.contactPublicKey ?? fallbackPeerKey, members: [] };
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
  /** Groups: the original sender's name. */
  senderName?: string | null;
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
  /** 'sending' = optimistic row not yet confirmed by the server echo. */
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

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

  /**
   * View-once photo/video: the recipient may open it a single time. It is
   * never auto-downloaded, cached or shown as a preview. `openedAt` is set
   * once it has been opened (the media is then gone for both sides).
   */
  viewOnce?: boolean;
  openedAt?: string | null;

  // Phase D — encrypted-media metadata. When set, the message body is a
  // pointer (downloadUrl + key + nonce) rather than text. `mediaUri` is
  // the local cached path after we download + decrypt; until then the UI
  // shows a placeholder. Null for plain text messages.
  mediaEnvelope: MediaEnvelope | null;
  /**
   * Display metadata known locally for messages WE sent (duration, waveform,
   * dimensions) before an envelope exists. Received/reloaded messages carry
   * the same fields on `mediaEnvelope` — read via `mediaMetaOf()`.
   */
  mediaMeta?: MediaMeta;
  /** Groups: the sender's display name (bubbles are labelled). */
  senderName?: string | null;
}

/** Display metadata for a media message, from whichever source has it. */
export function mediaMetaOf(m: Pick<Message, 'mediaEnvelope' | 'mediaMeta'>): MediaMeta {
  return { ...(m.mediaEnvelope ?? {}), ...(m.mediaMeta ?? {}) };
}

interface ChatState {
  conversations: Conversation[];
  activeMessages: Message[];
  /** Online / last seen of the open 1:1 chat's peer; null until known. */
  peerPresence: PeerPresence | null;
  status: 'idle' | 'loading';
  /** Conversation the user is currently viewing (ChatScreen open). Drives
   *  whether an incoming message_notification bumps the unread counter. */
  activeConversationId: string | null;
  /** Server cursor for the NEXT (older) page of the active thread. Null when
   *  the full history is loaded (or nothing is loaded yet). */
  messagesCursor: string | null;
  /** True while an older page is being fetched — drives the top spinner and
   *  stops onEndReached from double-firing. */
  loadingOlder: boolean;
  /**
   * Names the user gave their contacts, keyed by private number. Kept on this
   * device only (never sent to the server) and shown instead of the contact's
   * own display name.
   */
  contactNames: Record<string, string>;
  /** When the last COMPLETE server load of the list started (epoch ms). */
  conversationsFetchedAt: number | null;
  /**
   * Set (epoch ms) when the list may have missed changes the live socket
   * can't patch in: the user socket reconnected, the app came back from the
   * background, a message was deleted for everyone. Cleared by a load that
   * started after it.
   */
  conversationsStaleAt: number | null;
}

const initialState: ChatState = {
  conversations: [],
  activeMessages: [],
  peerPresence: null,
  status: 'idle',
  activeConversationId: null,
  messagesCursor: null,
  loadingOlder: false,
  contactNames: {},
  conversationsFetchedAt: null,
  conversationsStaleAt: null,
};

/**
 * Safety net for list changes nothing tells us about (a contact's new name or
 * avatar, pin/mute set on another device). Everything else reaches the list
 * live or marks it stale, so returning from a chat doesn't refetch.
 */
export const CONVERSATIONS_MAX_AGE_MS = 2 * 60 * 1000;

/** Should the chat list re-fetch from the server now? */
export function needsConversationRefresh(
  chat: Pick<ChatState, 'conversationsFetchedAt' | 'conversationsStaleAt'>,
  now: number,
): boolean {
  return (
    chat.conversationsStaleAt !== null ||
    chat.conversationsFetchedAt === null ||
    now - chat.conversationsFetchedAt >= CONVERSATIONS_MAX_AGE_MS
  );
}

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
const formatNum = (n: string) =>
  n.length === 10 ? `${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6, 10)}` : n;

/** Chat-list preview text for a last message (decrypting when needed). */
async function previewFor(
  c: ConversationDTO,
  crypto: CryptoConv,
  myUserId: string | null,
): Promise<string> {
  const lastMsg = c.last_message;
  if (!lastMsg) return '';
  const type = lastMsg.message_type;
  if (type === 'image') return '📷 Photo';
  if (type === 'video') return '🎥 Video';
  if (type === 'document') return '📎 Document';
  const text = await decryptFor(
    crypto,
    {
      payload: lastMsg.encrypted_payload,
      messageType: type,
      senderId: lastMsg.sender_id,
      senderPublicKey: lastMsg.sender_public_key,
    },
    myUserId,
  );
  if (type === 'voice') return voicePreviewText(parseMediaEnvelope(text)?.durationMs);
  return text;
}

/** Server conversation → app Conversation (decrypts the preview). */
export async function conversationFromDTO(
  c: ConversationDTO,
  myUserId: string | null,
): Promise<Conversation> {
  const lastMsg = c.last_message;
  const prefs = {
    unreadCount: c.unread_count,
    isSelfChat: false,
    isPinned: c.is_pinned,
    muteUntil: c.mute_until,
    manualUnread: c.manual_unread,
    lastMessageTime: lastMsg?.created_at || c.created_at,
    lastMessageType: effectiveType(lastMsg?.message_type ?? 'text', null),
    lastMessageSenderId: lastMsg?.sender_id ?? null,
  };

  if (c.is_group) {
    const members: GroupMember[] = (c.participants ?? []).map((m) => ({
      userId: m.id,
      displayName: m.display_name,
      profilePictureKey: m.profile_picture_key,
      publicKey: m.public_key,
      role: m.role,
    }));
    const conv: Conversation = {
      id: c.id,
      contactName: c.name || 'Group',
      contactPrivateNumber: '',
      contactProfilePictureKey: null,
      contactPublicKey: null,
      lastMessage: '',
      ...prefs,
      isGroup: true,
      members,
      myRole: c.my_role ?? null,
      peerUserId: null,
      lastMessageSenderName:
        lastMsg?.sender_display_name ??
        members.find((m) => m.userId === lastMsg?.sender_id)?.displayName ??
        null,
    };
    conv.lastMessage = await previewFor(c, cryptoConvOf(conv), myUserId);
    return conv;
  }

  const other = c.other_participant;
  const peerKey = other?.public_key ?? null;
  const conv: Conversation = {
    id: c.id,
    contactName:
      other?.display_name || (other?.private_number ? formatNum(other.private_number) : ''),
    contactPrivateNumber: other?.private_number || '',
    contactProfilePictureKey: other?.profile_picture_key ?? null,
    contactPublicKey: peerKey,
    contactBio: other?.bio ?? null,
    lastMessage: '',
    ...prefs,
    isGroup: false,
    peerUserId: other?.id ?? null,
    lastMessageSenderName: null,
  };
  conv.lastMessage = await previewFor(c, cryptoConvOf(conv), myUserId);
  return conv;
}

export interface LoadedConversations {
  conversations: Conversation[];
  /** False when the server part failed: `conversations` holds self-chats only. */
  complete: boolean;
  startedAt: number;
}

export const loadConversationsThunk = createAsyncThunk<LoadedConversations>(
  'chat/loadConversations',
  async (_arg, { getState }) => {
    const startedAt = Date.now();

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
        contactProfilePictureKey: null,
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
    try {
      const list = await listConversationsApi();
      const myUserId = (getState() as { auth: { userId: string | null } }).auth.userId;
      const serverConvs = await Promise.all(list.map((c) => conversationFromDTO(c, myUserId)));
      // Cache the freshly-loaded list for instant render next launch. Only on
      // success — a network failure must not clobber a good cache.
      void cacheSet(CACHE_KEYS.conversations, [...selfConvs, ...serverConvs]);
      return { conversations: [...selfConvs, ...serverConvs], complete: true, startedAt };
    } catch (err) {
      console.warn('[chat] Failed to load server conversations:', err);
      return { conversations: selfConvs, complete: false, startedAt };
    }
  },
);

/**
 * Stale-while-revalidate: return the cached conversation list (if any) so the
 * chat list paints instantly while loadConversationsThunk refreshes it.
 */
export const hydrateConversationsThunk = createAsyncThunk<Conversation[] | null>(
  'chat/hydrateConversations',
  async () => cacheGet<Conversation[]>(CACHE_KEYS.conversations),
);

/**
 * Re-fetch one conversation (after a group_update / conversation_update).
 * Resolves `null` when we no longer have access (removed from the group, or
 * the group was deleted) so the caller can drop it.
 */
export const refreshConversationThunk = createAsyncThunk<
  { id: string; conversation: Conversation | null },
  string
>('chat/refreshConversation', async (conversationId, { getState }) => {
  const myUserId = (getState() as { auth: { userId: string | null } }).auth.userId;
  try {
    const dto = await getConversationApi(conversationId);
    return { id: conversationId, conversation: await conversationFromDTO(dto, myUserId) };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 403 || status === 404) {
      void cacheSet(CACHE_KEYS.messages(conversationId), []);
      return { id: conversationId, conversation: null };
    }
    throw err;
  }
});

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
/** Decrypt one server MessageDTO into the local Message shape (used by both
 *  the initial page load and older-page pagination). */
async function decryptServerMessage(
  m: MessageDTO,
  crypto: CryptoConv,
  myUserId: string | null,
): Promise<Message> {
  // After decrypt, the plaintext is either a normal text message or a JSON
  // MediaEnvelope (system messages come back already described). We detect
  // media and stash the envelope; ChatScreen downloads the bytes off the
  // critical path.
  // An opened view-once message has no payload left — nothing to decrypt.
  const viewOnceGone = m.self_destruct && (!!m.opened_at || !m.encrypted_payload);
  const decrypted = viewOnceGone
    ? ''
    : await decryptFor(
        crypto,
        {
          payload: m.encrypted_payload,
          messageType: m.message_type,
          senderId: m.sender_id,
          senderPublicKey: m.sender_public_key,
        },
        myUserId,
      );
  const envelope = m.message_type === 'system' ? null : parseMediaEnvelope(decrypted);
  const content = m.self_destruct
    ? m.message_type === 'video'
      ? 'Video'
      : 'Photo'
    : envelope
    ? mediaPlaceholder(envelope.mime)
    : decrypted;

  let replyPreview: ReplyPreview | null = null;
  if (m.reply_preview) {
    const previewContent = await decryptFor(
      crypto,
      {
        payload: m.reply_preview.encrypted_payload,
        messageType: m.reply_preview.message_type,
        senderId: m.reply_preview.sender_id,
        senderPublicKey: m.reply_preview.sender_public_key,
      },
      myUserId,
    );
    const previewEnvelope = parseMediaEnvelope(previewContent);
    replyPreview = {
      id: m.reply_preview.id,
      senderId: m.reply_preview.sender_id,
      type: effectiveType(m.reply_preview.message_type, previewEnvelope),
      content: previewEnvelope
        ? mediaPlaceholder(previewEnvelope.mime)
        : previewContent,
      senderName: m.reply_preview.sender_display_name ?? null,
    };
  }
  return {
    id: m.id,
    conversationId: m.conversation_id,
    senderId: m.sender_id,
    receiverId: '',
    content,
    type: effectiveType(m.message_type, envelope),
    mediaUri: undefined,
    timestamp: m.created_at,
    // Groups have no per-message delivered/read state (read_at stays null).
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
    ...(m.self_destruct ? { viewOnce: true, openedAt: m.opened_at ?? null } : {}),
    mediaEnvelope: envelope,
    senderName: m.sender_display_name ?? null,
  };
}

export const loadMessagesThunk = createAsyncThunk<
  { messages: Message[]; nextCursor: string | null },
  { conversationId: string; crypto: CryptoConv }
>(
  'chat/loadMessages',
  async ({ conversationId, crypto }, { getState }) => {
    const myUserId = (getState() as { auth: { userId: string | null } }).auth.userId;
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
      const selfMessages = rows.map<Message>((row) => ({
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
      // Self-chat loads the full local history in one go — no cursor.
      return { messages: selfMessages, nextCursor: null };
    }

    // Server: newest-first; reverse to oldest-first. Decrypt every message
    // body — including our own (1:1: nacl.box's shared secret is symmetric;
    // groups: senders wrap the message key for themselves too).
    const page = await listMessagesApi(conversationId);
    const ordered = page.messages.slice().reverse();
    const decrypted = await Promise.all(
      ordered.map((m) => decryptServerMessage(m, crypto, myUserId)),
    );
    // Cache decrypted history (first page only) so re-opening paints instantly.
    // View-once media keys never go into the on-disk cache.
    void cacheSet(
      CACHE_KEYS.messages(conversationId),
      decrypted.map((d) => (d.viewOnce ? { ...d, mediaEnvelope: null } : d)),
    );
    return { messages: decrypted, nextCursor: page.next_cursor };
  },
);

/**
 * Fetch the next (older) page of the active thread using the server cursor
 * and prepend it. `condition` guards against double-fires while a page is
 * in flight and against firing when the history is already complete.
 */
export const loadOlderMessagesThunk = createAsyncThunk<
  { conversationId: string; messages: Message[]; nextCursor: string | null },
  { conversationId: string; crypto: CryptoConv; before: string },
  { state: { chat: ChatState } }
>(
  'chat/loadOlderMessages',
  async ({ conversationId, crypto, before }, { getState }) => {
    const myUserId = (getState() as unknown as { auth: { userId: string | null } }).auth.userId;
    const page = await listMessagesApi(conversationId, { before });
    const ordered = page.messages.slice().reverse();
    const decrypted = await Promise.all(
      ordered.map((m) => decryptServerMessage(m, crypto, myUserId)),
    );
    return {
      conversationId,
      messages: decrypted,
      nextCursor: page.next_cursor,
    };
  },
  {
    condition: ({ conversationId }, { getState }) => {
      const { chat } = getState();
      return (
        !chat.loadingOlder &&
        chat.messagesCursor !== null &&
        chat.activeConversationId === conversationId
      );
    },
  },
);

/**
 * Stale-while-revalidate for a chat thread: returns cached decrypted messages
 * (if any) so the thread paints instantly while loadMessagesThunk refreshes.
 */
export const hydrateMessagesThunk = createAsyncThunk<
  { conversationId: string; messages: Message[] } | null,
  string
>('chat/hydrateMessages', async (conversationId) => {
  const messages = await cacheGet<Message[]>(CACHE_KEYS.messages(conversationId));
  return messages ? { conversationId, messages } : null;
});

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
 *
 * With an `id`, the row is inserted SYNCHRONOUSLY by the `pending` reducer,
 * i.e. before `dispatch` returns. The local SQLite save is async, and the
 * send path runs in parallel with it: a "failed" status or a fast server
 * echo must always find the row, or they're lost and the bubble sits on
 * "Sending…" forever (or the echo lands as a duplicate bubble).
 */
export type SendMessagePayload = {
  conversationId: string;
  senderId: string;
  receiverId: string;
  content: string;
  type?: MessageType;
  mediaUri?: string;
  id?: string;
  /** True when the message still has to reach the server (shows the
   *  "Sending" clock until the echo). Self-chat is local-only → false. */
  pending?: boolean;
  /** View-once photo/video (no local preview is kept). */
  viewOnce?: boolean;
  /** If set, this message is a reply to another message (Phase C.2). */
  replyTo?: ReplyPreview | null;
  /** Phase D — encrypted-media envelope for non-text messages. */
  mediaEnvelope?: MediaEnvelope | null;
  /** Locally-known display metadata (voice duration/waveform, dimensions). */
  mediaMeta?: MediaMeta;
};

function buildOutgoingMessage(payload: SendMessagePayload, id: string): Message {
  return {
    id,
    conversationId: payload.conversationId,
    senderId: payload.senderId,
    receiverId: payload.receiverId,
    content: payload.content,
    type: payload.type || 'text',
    mediaUri: payload.mediaUri,
    timestamp: new Date().toISOString(),
    status: payload.pending ? 'sending' : 'sent',
    reactions: [],
    isStarred: false,
    replyToId: payload.replyTo?.id ?? null,
    replyPreview: payload.replyTo ?? null,
    deletedAt: null,
    deletedBy: null,
    mediaEnvelope: payload.mediaEnvelope ?? null,
    ...(payload.mediaMeta ? { mediaMeta: payload.mediaMeta } : {}),
    ...(payload.viewOnce ? { viewOnce: true, openedAt: null } : {}),
  };
}

export const sendMessageThunk = createAsyncThunk(
  'chat/sendMessage',
  async (payload: SendMessagePayload) => {
    const id =
      payload.id ??
      Date.now().toString(36) + Math.random().toString(36).slice(2);
    await saveMessage(
      id,
      payload.conversationId,
      payload.senderId,
      payload.receiverId,
      payload.content,
      payload.type || 'text',
      payload.mediaUri,
    );
    return buildOutgoingMessage(payload, id);
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

/* ── Chat-list preview kept in step with the open chat ─── */

/** Chat-list preview text for a message already decrypted in the thread. */
export function listPreviewOf(m: Message): string {
  if (m.viewOnce) return m.type === 'video' ? '🎥 Video' : '📷 Photo';
  switch (m.type) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'document':
      return '📎 Document';
    case 'voice':
      return voicePreviewText(mediaMetaOf(m).durationMs);
    default:
      return m.content;
  }
}

/**
 * Make `m` the conversation's last message in the chat list (preview, time,
 * sender) — unless the list already shows something newer.
 */
function touchConversation(state: ChatState, m: Message): void {
  const conv = state.conversations.find((c) => c.id === m.conversationId);
  if (!conv) return;
  const shown = conv.lastMessageTime ? new Date(conv.lastMessageTime).getTime() : 0;
  const mine = new Date(m.timestamp).getTime();
  if (Number.isFinite(shown) && Number.isFinite(mine) && mine < shown) return;
  conv.lastMessage = listPreviewOf(m);
  conv.lastMessageType = m.type;
  conv.lastMessageTime = m.timestamp;
  conv.lastMessageSenderId = m.senderId;
  conv.lastMessageSenderName = m.senderName ?? null;
}

/* ── Custom contact names (device-only) ────────────────── */

export const CONTACT_NAME_MAX = 40;

export const loadContactNamesThunk = createAsyncThunk('chat/loadContactNames', async () => {
  const names = await cacheGet<Record<string, string>>(CACHE_KEYS.contactNames);
  return names && typeof names === 'object' ? names : {};
});

/** Set (or, with an empty name, clear) the user's own name for a contact. */
export const setContactNameThunk = createAsyncThunk<
  Record<string, string>,
  { privateNumber: string; name: string },
  { state: { chat: ChatState } }
>('chat/setContactName', async ({ privateNumber, name }, { getState }) => {
  const next = { ...getState().chat.contactNames };
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, CONTACT_NAME_MAX);
  if (clean) next[privateNumber] = clean;
  else delete next[privateNumber];
  await cacheSet(CACHE_KEYS.contactNames, next);
  return next;
});

/* ── Delivery status ordering ──────────────────────────── */

const STATUS_RANK: Record<Message['status'], number> = {
  failed: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};

/**
 * Next status for a message. Ticks only move forward (events can arrive out
 * of order: a late 'delivered' must not undo 'read'), and 'failed' can't
 * overwrite a message the server already confirmed. `force` allows the two
 * deliberate backwards moves: failed → sending (retry) and failed → sent
 * (the echo finally arrived).
 */
export function advanceStatus(
  current: Message['status'],
  next: Message['status'],
  force = false,
): Message['status'] {
  if (next === 'failed') return STATUS_RANK[current] >= STATUS_RANK.sent ? current : 'failed';
  // A receipt for a "failed" message means it did get through after all.
  if (current === 'failed') {
    return force || STATUS_RANK[next] >= STATUS_RANK.delivered ? next : current;
  }
  return STATUS_RANK[next] >= STATUS_RANK[current] ? next : current;
}

/* ── Slice ─────────────────────────────────────────────── */

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    clearActiveMessages(state) {
      state.activeMessages = [];
      state.messagesCursor = null;
      state.loadingOlder = false;
      state.peerPresence = null;
    },

    /** Live presence for the open chat's peer (from the conversation socket). */
    setPeerPresence(state, action: PayloadAction<PeerPresence | null>) {
      state.peerPresence = action.payload;
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
            // The echo proves it reached the server; never downgrade a
            // delivered/read tick that raced ahead of it.
            status: advanceStatus(state.activeMessages[idx].status, message.status, true),
          };
          return;
        }
      }
      const idx = state.activeMessages.findIndex((m) => m.id === message.id);
      if (idx >= 0) {
        state.activeMessages[idx] = { ...state.activeMessages[idx], ...message };
      } else {
        state.activeMessages.push(message);
        // A message that arrived while this chat is open: the user channel
        // doesn't always notify for it, so update the list row here.
        touchConversation(state, message);
      }
    },

    /** Update a single message's delivery status (delivered / read tick). */
    updateMessageStatus(
      state,
      action: PayloadAction<{ id: string; status: Message['status']; force?: boolean }>,
    ) {
      const msg = state.activeMessages.find((m) => m.id === action.payload.id);
      if (msg) {
        msg.status = advanceStatus(msg.status, action.payload.status, !!action.payload.force);
      }
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

    /** The list may have missed changes; the chat list re-fetches when shown. */
    markConversationsStale(state) {
      state.conversationsStaleAt = Date.now();
    },

    /** Track which conversation is on-screen (set by ChatScreen on focus). */
    setActiveConversation(state, action: PayloadAction<string | null>) {
      if (state.activeConversationId !== action.payload) state.peerPresence = null;
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
        senderId?: string;
        senderName?: string | null;
      }>,
    ) {
      const { conversationId, preview, messageType, timestamp, senderId, senderName } = action.payload;
      const conv = state.conversations.find((c) => c.id === conversationId);
      if (!conv) return; // unknown conversation — hook triggers a list refresh
      conv.lastMessage = preview;
      conv.lastMessageType = messageType;
      conv.lastMessageTime = timestamp;
      conv.lastMessageSenderId = senderId ?? null;
      conv.lastMessageSenderName = senderName ?? null;
      // System lines ("Alice added Bob") don't count as unread.
      if (conversationId !== state.activeConversationId && messageType !== 'system') {
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
      // If it was the chat's newest message, the list row's preview is now
      // wrong and can't be rebuilt here — let the list re-fetch when shown.
      state.conversationsStaleAt = Date.now();
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
    /** A view-once photo/video was opened: drop every trace of the media. */
    markViewOnceOpened(
      state,
      action: PayloadAction<{ messageId: string; timestamp: string }>,
    ) {
      const msg = state.activeMessages.find((m) => m.id === action.payload.messageId);
      if (!msg) return;
      msg.viewOnce = true;
      msg.openedAt = action.payload.timestamp;
      msg.mediaEnvelope = null;
      msg.mediaUri = undefined;
    },

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
      .addCase(loadContactNamesThunk.fulfilled, (state, action) => {
        state.contactNames = action.payload;
      })
      .addCase(setContactNameThunk.fulfilled, (state, action) => {
        state.contactNames = action.payload;
      })
      .addCase(refreshConversationThunk.fulfilled, (state, action) => {
        const { id, conversation } = action.payload;
        const idx = state.conversations.findIndex((c) => c.id === id);
        if (!conversation) {
          if (idx >= 0) state.conversations.splice(idx, 1);
          return;
        }
        if (idx >= 0) {
          // Keep local-only state (e.g. unread bumped by live notifications).
          state.conversations[idx] = { ...state.conversations[idx], ...conversation };
        } else {
          state.conversations.unshift(conversation);
        }
      })
      // loadConversations — payload is already a Conversation[]
      .addCase(loadConversationsThunk.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(loadConversationsThunk.fulfilled, (state, action) => {
        const { conversations, complete, startedAt } = action.payload;
        state.status = 'idle';
        state.conversations = conversations;
        if (complete) state.conversationsFetchedAt = startedAt;
        // Covered by this attempt (a failed one too — reconnecting marks the
        // list stale again, and retrying here would loop while offline).
        if (state.conversationsStaleAt !== null && state.conversationsStaleAt <= startedAt) {
          state.conversationsStaleAt = null;
        }
      })
      .addCase(loadConversationsThunk.rejected, (state) => {
        state.status = 'idle';
        state.conversationsStaleAt = null;
      })
      // Cached conversations — apply only while nothing is loaded yet, so a
      // late-resolving cache read never clobbers a fresh network result.
      .addCase(hydrateConversationsThunk.fulfilled, (state, action) => {
        if (action.payload && state.conversations.length === 0) {
          state.conversations = action.payload;
        }
      })
      // loadMessages
      .addCase(loadMessagesThunk.fulfilled, (state, action) => {
        // The cached thread may already be on screen with its media
        // downloaded. Replacing it wholesale would throw those local files
        // away and leave every photo / voice note stuck on a spinner, so
        // carry them over to the fresh rows.
        const local = new Map(
          state.activeMessages
            .filter((m) => m.mediaUri && !m.viewOnce)
            .map((m) => [m.id, m] as const),
        );
        state.activeMessages = action.payload.messages.map((m) => {
          const prev = local.get(m.id);
          return prev && !m.mediaUri && !m.viewOnce && !m.deletedAt
            ? { ...m, mediaUri: prev.mediaUri }
            : m;
        });
        state.messagesCursor = action.payload.nextCursor;
      })
      // loadOlderMessages — prepend, dedupe against anything already loaded,
      // and advance the cursor. Ignore a late page for a chat we've left.
      .addCase(loadOlderMessagesThunk.pending, (state) => {
        state.loadingOlder = true;
      })
      .addCase(loadOlderMessagesThunk.fulfilled, (state, action) => {
        state.loadingOlder = false;
        if (action.payload.conversationId !== state.activeConversationId) return;
        const existing = new Set(state.activeMessages.map((m) => m.id));
        const older = action.payload.messages.filter((m) => !existing.has(m.id));
        state.activeMessages = [...older, ...state.activeMessages];
        state.messagesCursor = action.payload.nextCursor;
      })
      .addCase(loadOlderMessagesThunk.rejected, (state) => {
        state.loadingOlder = false;
      })
      // Cached messages — apply only if we're still on that conversation and
      // the live fetch hasn't already filled the thread.
      .addCase(hydrateMessagesThunk.fulfilled, (state, action) => {
        if (
          action.payload &&
          action.payload.conversationId === state.activeConversationId &&
          state.activeMessages.length === 0
        ) {
          state.activeMessages = action.payload.messages;
        }
      })
      // sendMessage — insert the optimistic row the moment it's dispatched
      // (see sendMessageThunk). My own message is the conversation's latest,
      // so the chat list is updated straight away too.
      .addCase(sendMessageThunk.pending, (state, action) => {
        const arg = action.meta.arg;
        if (!arg.id || state.activeMessages.some((m) => m.id === arg.id)) return;
        const msg = buildOutgoingMessage(arg, arg.id);
        state.activeMessages.push(msg);
        touchConversation(state, msg);
      })
      .addCase(sendMessageThunk.fulfilled, (state, action) => {
        const msg = action.payload;
        // Already inserted by `pending`: leave it alone. Its status may have
        // moved on meanwhile (failed, or confirmed by the echo) and must not
        // be reset to "sending".
        if (state.activeMessages.some((m) => m.id === msg.id)) return;
        state.activeMessages.push(msg);
        touchConversation(state, msg);
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
  setPeerPresence,
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
  markViewOnceOpened,
  markConversationsStale,
} = chatSlice.actions;

/**
 * Total unread across all conversations, for the Chats tab badge. Muted
 * conversations don't contribute (their messages are silenced), matching how
 * the chat list de-emphasises them.
 */
export const selectTotalUnread = (state: {
  chat: { conversations: Conversation[] };
}): number =>
  state.chat.conversations.reduce((sum, c) => {
    const muted = c.muteUntil ? new Date(c.muteUntil).getTime() > Date.now() : false;
    return muted ? sum : sum + (c.unreadCount || 0);
  }, 0);

export default chatSlice.reducer;
