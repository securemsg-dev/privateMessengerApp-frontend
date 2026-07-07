/**
 * services/api.ts
 * ────────────────
 * Central HTTP client for the backend. Uses fetch (no extra deps).
 *
 * Base URL resolution:
 *   1. EXPO_PUBLIC_API_URL env var (preferred)
 *   2. fallback to localhost for dev
 *
 * Auth:
 *   - Access token read from SecureStore on each request.
 *   - 401 is surfaced to caller — retry/refresh logic lives in thunks.
 */
import Constants from 'expo-constants';
import * as SecureStore from '../utils/secureStorage';

/**
 * Resolve the backend base URL at runtime — works on any network (LAN, hotspot)
 * without manual IP configuration.
 *
 * Priority:
 *   1. EXPO_PUBLIC_API_URL env var — explicit override (staging / prod builds)
 *   2. Constants.manifest.hostUri — classic Expo Go manifest; reliably populated
 *      with the LAN IP of the machine running `expo start` in all Expo Go versions.
 *   3. Constants.expoConfig.hostUri — fallback for newer Expo runtimes.
 *   4. localhost — last resort (iOS simulator / web browser).
 */
function resolveBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // Access the classic Expo Go manifest via bracket notation to avoid the
  // deprecation hint on Constants.manifest while still reading hostUri.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const classicHostUri = (Constants as any)['manifest']?.hostUri as string | undefined;
  if (classicHostUri) {
    const host = classicHostUri.split(':')[0];
    return `http://${host}:8000/api/v1`;
  }

  const newHostUri = Constants.expoConfig?.hostUri as string | undefined;
  if (newHostUri) {
    const host = newHostUri.split(':')[0];
    return `http://${host}:8000/api/v1`;
  }

  return 'http://localhost:8000/api/v1';
}

const BASE_URL: string = resolveBaseUrl();

if (__DEV__) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.log('[API] BASE_URL =', BASE_URL);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.log('[API] manifest.hostUri =', (Constants as any)['manifest']?.hostUri);
  console.log('[API] expoConfig.hostUri =', Constants.expoConfig?.hostUri);
}

export const TOKEN_KEY = 'userToken';
export const REFRESH_TOKEN_KEY = 'refreshToken';
/**
 * SecureStore key for the Expo push token last registered with the backend.
 * Persisted so the logout flow can tell the server to detach it (otherwise a
 * signed-out phone keeps receiving this account's notifications).
 */
export const PUSH_TOKEN_KEY = 'expoPushToken';
/**
 * SecureStore key for the last-used 10-digit private number. Cached so the
 * login screen can pre-fill it on subsequent launches. Kept across normal
 * sign-outs; cleared only after a successful delete-from-login flow.
 */
export const CACHED_PRIVATE_NUMBER_KEY = 'cachedPrivateNumber';

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

let _onUnauthorized: (() => void) | null = null;
/** Register a callback invoked when a token refresh fails (second 401). Use to dispatch forceLogout. */
export function setOnUnauthorized(fn: () => void): void {
  _onUnauthorized = fn;
}

type Method = 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';

interface RequestOptions {
  method?: Method;
  body?: unknown;
  auth?: boolean; // attach bearer token — default false
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = false } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const resp = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    const detail =
      (data && (data.detail || data.message)) ||
      `HTTP ${resp.status}`;
    throw new ApiError(resp.status, String(detail));
  }
  return data as T;
}

// ── Single-flight token refresh ─────────────────────────────────────────────
// The backend ROTATES refresh tokens: the first /auth/refresh invalidates the
// token every other concurrent caller is still holding. Without single-flight,
// the burst of parallel 401s at access-token expiry (chat list + calls + me
// all firing together) races itself and the losers force-log the user out.
// All refresh paths (HTTP retries AND the two WebSocket reconnects) must go
// through this one shared promise.

let _refreshInFlight: Promise<TokenPair> | null = null;

export async function refreshTokensSingleFlight(): Promise<TokenPair> {
  if (!_refreshInFlight) {
    _refreshInFlight = (async () => {
      const storedRefresh = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!storedRefresh) {
        throw new ApiError(401, 'No refresh token');
      }
      const tokens = await refreshApi(storedRefresh);
      await SecureStore.setItemAsync(TOKEN_KEY, tokens.access_token);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refresh_token);
      return tokens;
    })().finally(() => {
      _refreshInFlight = null;
    });
  }
  return _refreshInFlight;
}

/**
 * Wraps request() with a single 401 → token-refresh → retry cycle.
 * On second 401 (refresh itself failed), calls the registered forceLogout
 * callback and re-throws so callers can still surface a UI error if needed.
 * Use this for every endpoint that requires auth: true.
 */
async function requestWithRefresh<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  try {
    return await request<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      try {
        await refreshTokensSingleFlight();
        return await request<T>(path, opts);
      } catch {
        _onUnauthorized?.();
        throw err;
      }
    }
    throw err;
  }
}

// ── Types matching backend schemas ───────────────────────────────────────────

export interface UserDTO {
  id: string;
  private_number: string;
  display_name: string | null;
  is_active: boolean;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface RegisterResponse {
  user: UserDTO;
  tokens: TokenPair;
  private_number: string;
}

/**
 * POST /auth/login returns one of two shapes, discriminated by `action`:
 *
 * - `authenticated` — the supplied password matched the user's login_password;
 *   the client receives a normal session (user + tokens).
 * - `confirm_delete` — the supplied password matched the user's delete_password;
 *   the client receives a short-lived delete-intent token to post to
 *   /auth/confirm-delete after the user confirms a warning dialog. No user
 *   info or session tokens are issued on this branch.
 */
export interface LoginAuthenticatedResponse {
  action: 'authenticated';
  user: UserDTO;
  tokens: TokenPair;
}

export interface LoginDeleteIntentResponse {
  action: 'confirm_delete';
  delete_token: string;
  expires_in: number;
}

export type LoginResponse = LoginAuthenticatedResponse | LoginDeleteIntentResponse;

// ── Auth endpoints ───────────────────────────────────────────────────────────

export function registerApi(body: {
  login_password: string;
  delete_password: string;
  display_name?: string;
}): Promise<RegisterResponse> {
  return request<RegisterResponse>('/auth/register', { method: 'POST', body });
}

export function loginApi(body: {
  private_number: string;
  login_password: string;
}): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', { method: 'POST', body });
}

export function confirmDeleteApi(body: { delete_token: string }): Promise<{ message: string }> {
  return request('/auth/confirm-delete', { method: 'POST', body });
}

export function refreshApi(refreshToken: string): Promise<TokenPair> {
  return request<TokenPair>('/auth/refresh', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
}

export function logoutApi(refreshToken: string): Promise<{ message: string }> {
  return request('/auth/logout', {
    method: 'POST',
    body: { refresh_token: refreshToken },
  });
}

// ── Phase A — messaging spine ────────────────────────────────────────────────

export interface UserPublicDTO {
  id: string;
  private_number: string;
  display_name: string | null;
  /** Base64 Curve25519 public key. Null until the user uploads one (Phase B). */
  public_key: string | null;
  /** Blob UUID stored in the media system. Use buildAvatarUrl() to get the download URL. */
  profile_picture_key: string | null;
}

export interface LastMessagePreviewDTO {
  id: string;
  sender_id: string;
  message_type: 'text' | 'voice' | 'image';
  encrypted_payload: string;
  created_at: string;
  self_destruct: boolean;
}

export interface ConversationDTO {
  id: string;
  is_group: boolean;
  name: string | null;
  created_at: string;
  other_participant: UserPublicDTO | null;
  last_message: LastMessagePreviewDTO | null;
  unread_count: number;
  // Phase C.1 — caller's per-conversation prefs
  is_pinned: boolean;
  mute_until: string | null; // ISO8601 timestamp; null = not muted
  manual_unread: boolean;
}

export interface ReactionAggregateDTO {
  emoji: string;
  count: number;
  by_me: boolean;
}

export interface MessageReplyPreviewDTO {
  id: string;
  sender_id: string;
  message_type: 'text' | 'voice' | 'image';
  encrypted_payload: string;
}

export interface MessageDTO {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_type: 'text' | 'voice' | 'image';
  encrypted_payload: string;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
  self_destruct: boolean;
  // Phase C.2 — per-message metadata
  reactions: ReactionAggregateDTO[];
  is_starred: boolean;
  reply_to_id: string | null;
  reply_preview: MessageReplyPreviewDTO | null;
  // Phase C.3 — delete-for-everyone tombstone fields
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface MessagePageDTO {
  messages: MessageDTO[];
  next_cursor: string | null;
}

export interface ContactLookupResponse {
  found: boolean;
  user: UserPublicDTO | null;
}

/** GET /users/me — current user's profile (use after token refresh). */
export function getMeApi(): Promise<UserPublicDTO> {
  return requestWithRefresh<UserPublicDTO>('/users/me', { auth: true });
}

/**
 * POST /users/me/public-key — upload (or replace) the caller's long-term
 * Curve25519 public key for E2EE. Idempotent — safe to call on every launch.
 */
export function uploadPublicKeyApi(publicKeyB64: string): Promise<UserPublicDTO> {
  return requestWithRefresh<UserPublicDTO>('/users/me/public-key', {
    method: 'POST',
    auth: true,
    body: { public_key: publicKeyB64 },
  });
}

/**
 * PATCH /users/me — partial profile update. Only non-undefined fields are sent.
 * Pass `profile_picture_key` with the blob_id after a successful media upload.
 */
export function patchMeApi(body: {
  display_name?: string;
  profile_picture_key?: string;
}): Promise<UserPublicDTO> {
  return requestWithRefresh<UserPublicDTO>('/users/me', {
    method: 'PATCH',
    auth: true,
    body,
  });
}

/**
 * Upload raw bytes to a pre-signed upload URL (PUT /api/v1/media/{blob_id}).
 * The upload URL comes from requestMediaUploadApi(). Requires auth.
 */
export async function uploadBlobBytesApi(uploadUrl: string, fileUri: string): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const resp = await fetch(fileUri);
  const blob = await resp.blob();
  const putResp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: blob,
  });
  if (!putResp.ok) {
    throw new ApiError(putResp.status, `Media upload failed: HTTP ${putResp.status}`);
  }
}

/**
 * Build a full download URL for an avatar blob. The token must be passed as
 * an Authorization header — use FileSystem.downloadAsync for image caching.
 */
export function buildAvatarUrl(blobId: string): string {
  const root = BASE_URL.replace(/\/api\/v1\/?$/, '');
  return `${root}/api/v1/media/${blobId}`;
}

/** POST /contacts/lookup — find a user by their 10-digit private number. */
export function lookupContactApi(privateNumber: string): Promise<ContactLookupResponse> {
  return requestWithRefresh<ContactLookupResponse>('/contacts/lookup', {
    method: 'POST',
    auth: true,
    body: { private_number: privateNumber },
  });
}

/** POST /conversations — create-or-get a 1:1 conversation. Idempotent. */
export function createConversationApi(otherPrivateNumber: string): Promise<ConversationDTO> {
  return requestWithRefresh<ConversationDTO>('/conversations', {
    method: 'POST',
    auth: true,
    body: { other_private_number: otherPrivateNumber },
  });
}

/** GET /conversations — list all conversations the current user is part of. */
export function listConversationsApi(): Promise<ConversationDTO[]> {
  return requestWithRefresh<ConversationDTO[]>('/conversations', { auth: true });
}

/**
 * GET /conversations/{id}/messages — paginated history (newest first).
 * Pass `before` (the previous page's `next_cursor`) to fetch older messages.
 */
export function listMessagesApi(
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<MessagePageDTO> {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return requestWithRefresh<MessagePageDTO>(
    `/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`,
    { auth: true },
  );
}

/**
 * PATCH /conversations/{id}/prefs — partial update of the caller's
 * per-conversation prefs (pin / mute / mark unread). Only the fields you
 * pass are applied. `mute_seconds: 0` unmutes; > 0 mutes for that many
 * seconds. Returns the full hydrated conversation snapshot.
 */
export interface ConversationPrefsPatch {
  is_pinned?: boolean;
  mute_seconds?: number;
  manual_unread?: boolean;
}

export function updateConversationPrefsApi(
  conversationId: string,
  patch: ConversationPrefsPatch,
): Promise<ConversationDTO> {
  return requestWithRefresh<ConversationDTO>(
    `/conversations/${conversationId}/prefs`,
    { method: 'PATCH', auth: true, body: patch },
  );
}

/**
 * DELETE /conversations/{id} — remove the caller from participants (leave).
 * The conversation row and messages stay on the server; the other participant
 * keeps their history. Returns 204 No Content.
 */
export function deleteConversationApi(conversationId: string): Promise<void> {
  return requestWithRefresh<void>(`/conversations/${conversationId}`, {
    method: 'DELETE',
    auth: true,
  });
}

/**
 * POST /messages/{id}/star — set or clear the caller's private star on a
 * message. Idempotent. Star state is private (no broadcast).
 */
export function starMessageApi(
  messageId: string,
  starred: boolean,
): Promise<void> {
  return requestWithRefresh<void>(`/messages/${messageId}/star`, {
    method: 'POST',
    auth: true,
    body: { starred },
  });
}

// ── Phase D — encrypted media blob storage ──────────────────────────────────

export interface MediaUploadReservation {
  blob_id: string;
  upload_url: string;
  download_url: string;
  expires_at: string;
  max_bytes: number;
}

/**
 * POST /media/upload-url — reserve a blob_id and get back a URL to PUT the
 * encrypted bytes to. The matching download_url is what peers later GET.
 */
export function requestMediaUploadApi(body: {
  size_bytes: number;
  mime: string;
}): Promise<MediaUploadReservation> {
  return requestWithRefresh<MediaUploadReservation>('/media/upload-url', {
    method: 'POST',
    auth: true,
    body,
  });
}

export type DeleteScope = 'me' | 'everyone';

/**
 * POST /messages/{id}/delete — `scope: "me"` hides for the caller only;
 * `scope: "everyone"` is sender-only and time-limited to 24h. The latter
 * triggers a `deletion` WS broadcast to all participants.
 */
export function deleteMessageApi(
  messageId: string,
  scope: DeleteScope,
): Promise<void> {
  return requestWithRefresh<void>(`/messages/${messageId}/delete`, {
    method: 'POST',
    auth: true,
    body: { scope },
  });
}

// ── WebRTC / Calls ───────────────────────────────────────────────────────────

export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export function getWebRtcConfigApi(): Promise<{ ice_servers: IceServerConfig[] }> {
  return requestWithRefresh<{ ice_servers: IceServerConfig[] }>('/webrtc/config', {
    method: 'GET',
    auth: true,
  });
}

export interface CallRecord {
  id: string;
  conversation_id: string | null;
  caller_id: string | null;
  callee_id: string | null;
  started_at: string;
  accepted_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  // The other party (resolved server-side from the users table) so the Calls
  // tab can show a real name instead of a truncated UUID.
  peer_display_name: string | null;
  peer_private_number: string | null;
}

export function createCallApi(body: {
  conversation_id: string;
  callee_id: string;
}): Promise<CallRecord> {
  return requestWithRefresh<CallRecord>('/calls', {
    method: 'POST',
    auth: true,
    body,
  });
}

export function updateCallApi(
  callId: string,
  body: { accepted_at?: string; ended_at?: string; end_reason?: string },
): Promise<CallRecord> {
  return requestWithRefresh<CallRecord>(`/calls/${callId}`, {
    method: 'PATCH',
    auth: true,
    body,
  });
}

export type CallDTO = CallRecord;

export function listCallsApi(): Promise<CallDTO[]> {
  return requestWithRefresh<CallDTO[]>('/calls', {
    method: 'GET',
    auth: true,
  });
}

// ── Device registration ──────────────────────────────────────────────────────

export interface DeviceRegisterBody {
  device_name: string;
  platform: 'ios' | 'android';
  push_token?: string;
  public_key?: string;
}

export function registerDeviceApi(body: DeviceRegisterBody): Promise<{ id: string }> {
  return requestWithRefresh<{ id: string }>('/devices/register', {
    method: 'POST',
    auth: true,
    body,
  });
}

/**
 * POST /devices/clear-push — detach a push token from the caller's devices.
 * Call before logout so a signed-out phone stops receiving notifications.
 */
export function clearPushTokenApi(pushToken: string): Promise<void> {
  return requestWithRefresh<void>('/devices/clear-push', {
    method: 'POST',
    auth: true,
    body: { push_token: pushToken },
  });
}

// ── WebSocket URL helper ─────────────────────────────────────────────────────

/**
 * Resolve the WS URL for a conversation. BASE_URL is `http://host:8000/api/v1`,
 * the WS endpoint lives at `ws://host:8000/ws/{conversation_id}` (root, not
 * under /api/v1 — see backend/app/main.py).
 */
export function buildWebSocketUrl(conversationId: string, token: string): string {
  // Strip the trailing /api/v1 and swap http(s) → ws(s)
  const root = BASE_URL.replace(/\/api\/v1\/?$/, '');
  const wsRoot = root.replace(/^http/, 'ws');
  return `${wsRoot}/ws/${conversationId}?token=${encodeURIComponent(token)}`;
}

/**
 * Resolve the per-USER WS URL — the signaling channel for calls and any
 * other "addressed to this user" events. Lives at /ws/user (Phase E).
 */
export function buildUserWebSocketUrl(token: string): string {
  const root = BASE_URL.replace(/\/api\/v1\/?$/, '');
  const wsRoot = root.replace(/^http/, 'ws');
  return `${wsRoot}/ws/user?token=${encodeURIComponent(token)}`;
}
