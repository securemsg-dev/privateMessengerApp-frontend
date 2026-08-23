/**
 * store/slices/authSlice.ts
 * ──────────────────────────
 * Phoneless dual-password auth state.
 *
 * Thunks own network calls + SecureStore token persistence so the rest of the
 * app only needs to dispatch and read Redux state. Slice reducers are kept
 * thin — they only mutate state based on thunk outcomes.
 */
import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import * as SecureStore from '../../utils/secureStorage';

import {
  ApiError,
  CACHED_PRIVATE_NUMBER_KEY,
  clearPushTokenApi,
  confirmDeleteApi,
  deleteAccountApi,
  getMeApi,
  loginApi,
  logoutApi,
  registerBeginApi,
  PUSH_TOKEN_KEY,
  refreshApi,
  registerApi,
  REFRESH_TOKEN_KEY,
  TOKEN_KEY,
  UserDTO,
} from '../../services/api';
import { wipeLocalData } from '../../services/database';
import { clearKeyPair, createFreshKeyPair, restoreKeyPair, ensureKeyPairFor } from '../../services/crypto';
import { deriveKeyMaterial, wrapSecretKey, unwrapSecretKey } from '../../services/keyRecovery';
import { clearCache } from '../../services/cache';

interface AuthState {
  isAuthenticated: boolean;
  /**
   * Session is valid but the app is showing the AppLockScreen and requires
   * the user to re-enter their password before MainStack is reachable. Set to
   * true after cold-start rehydrate and on every background→active transition.
   */
  appLocked: boolean;
  token: string | null;
  refreshToken: string | null;
  privateNumber: string | null;
  userId: string | null;
  displayName: string | null;
  /** Current user's bio; null when unset. */
  bio: string | null;
  /** Current user's profile_picture_key (blob id); null when none set. */
  profilePictureKey: string | null;
  status: 'idle' | 'loading' | 'error';
  error: string | null;
  /** Holds registration result until user taps "Go to App" on PrivateNumberRevealScreen. */
  pendingRegistration: AuthResult | null;
}

const initialState: AuthState = {
  isAuthenticated: false,
  appLocked: false,
  token: null,
  refreshToken: null,
  privateNumber: null,
  userId: null,
  displayName: null,
  bio: null,
  profilePictureKey: null,
  status: 'idle',
  error: null,
  pendingRegistration: null,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function persistTokens(access: string, refresh: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, access);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
}

async function clearTokens() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

async function persistPrivateNumber(pn: string | null | undefined) {
  if (pn && /^\d{10}$/.test(pn)) {
    await SecureStore.setItemAsync(CACHED_PRIVATE_NUMBER_KEY, pn);
  }
}

async function clearCachedPrivateNumber() {
  await SecureStore.deleteItemAsync(CACHED_PRIVATE_NUMBER_KEY);
}

/**
 * After a successful login/unlock, restore the E2EE keypair from the server
 * backup so this device decrypts history. Falls back to binding a fresh key
 * (ensureKeyPairFor) when there's no backup (legacy account) or the unwrap
 * fails — never leaves the device without a usable key.
 */
async function restoreKeyPairFromBackup(
  backup: string | null | undefined,
  wrapKey: Uint8Array,
  privateNumber: string,
): Promise<void> {
  if (backup) {
    const secretKey = unwrapSecretKey(backup, wrapKey);
    if (secretKey) {
      await restoreKeyPair(secretKey, privateNumber);
      return;
    }
    // Auth succeeded but the backup didn't unwrap — inconsistent state (e.g.
    // backup wrapped under a different password). Don't crash; bind a fresh
    // key so messaging still works going forward.
    console.warn('[auth] key backup present but failed to unwrap — binding fresh key');
  }
  await ensureKeyPairFor(privateNumber);
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.detail || `HTTP ${err.status}`;
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

// ── Thunks ───────────────────────────────────────────────────────────────────

interface AuthResult {
  user: UserDTO;
  accessToken: string;
  refreshToken: string;
  /** Present only on rehydrate (from /users/me) — login/register don't return them. */
  bio?: string | null;
  profilePictureKey?: string | null;
}

export const registerThunk = createAsyncThunk<
  AuthResult,
  { loginPassword: string; deletePassword: string; displayName?: string },
  { rejectValue: string }
>('auth/register', async ({ loginPassword, deletePassword, displayName }, { rejectWithValue }) => {
  try {
    // Two-step registration: /begin allocates the private_number that becomes
    // the KDF salt; we derive the auth verifiers + wrap key from it, mint a
    // fresh E2EE keypair, wrap its secret key into the server-side backup, then
    // /complete. Retry on 409 (candidate number taken between begin/complete).
    for (let attempt = 0; ; attempt++) {
      const { private_number, registration_token } = await registerBeginApi();
      const keyPair = await createFreshKeyPair(private_number);
      const loginMat = await deriveKeyMaterial(loginPassword, private_number);
      const deleteMat = await deriveKeyMaterial(deletePassword, private_number);
      const encryptedKeyBackup = wrapSecretKey(keyPair.secretKey, loginMat.wrapKey);
      try {
        const resp = await registerApi({
          private_number,
          registration_token,
          login_password: loginMat.authVerifier,
          delete_password: deleteMat.authVerifier,
          display_name: displayName,
          public_key: keyPair.publicKey,
          encrypted_key_backup: encryptedKeyBackup,
        });
        await persistTokens(resp.tokens.access_token, resp.tokens.refresh_token);
        await persistPrivateNumber(resp.user.private_number);
        return {
          user: resp.user,
          accessToken: resp.tokens.access_token,
          refreshToken: resp.tokens.refresh_token,
        };
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && attempt < 4) {
          continue; // candidate number collided — get a fresh one and retry
        }
        throw err;
      }
    }
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/**
 * POST /auth/login can return one of two outcomes; loginThunk surfaces the
 * difference via a discriminated union so LoginScreen can branch between
 * "navigate to main" and "show delete confirmation dialog".
 */
export type LoginThunkResult =
  | { kind: 'authenticated'; auth: AuthResult }
  | { kind: 'deleteIntent'; deleteToken: string; expiresIn: number };

export const loginThunk = createAsyncThunk<
  LoginThunkResult,
  { privateNumber: string; loginPassword: string },
  { rejectValue: string }
>('auth/login', async ({ privateNumber, loginPassword }, { rejectWithValue }) => {
  try {
    // Derive the verifier (sent to the server) and the wrap key (kept here) in
    // one KDF pass. The server only ever sees the verifier.
    const mat = await deriveKeyMaterial(loginPassword, privateNumber);
    const resp = await loginApi({
      private_number: privateNumber,
      login_password: mat.authVerifier,
    });
    if (resp.action === 'confirm_delete') {
      return {
        kind: 'deleteIntent',
        deleteToken: resp.delete_token,
        expiresIn: resp.expires_in,
      };
    }
    // Restore the E2EE key from the server backup so this device can decrypt
    // history. Unwrap uses the wrap key derived above — the server cannot.
    await restoreKeyPairFromBackup(resp.encrypted_key_backup, mat.wrapKey, privateNumber);
    await persistTokens(resp.tokens.access_token, resp.tokens.refresh_token);
    await persistPrivateNumber(resp.user.private_number);
    return {
      kind: 'authenticated',
      auth: {
        user: resp.user,
        accessToken: resp.tokens.access_token,
        refreshToken: resp.tokens.refresh_token,
      },
    };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/**
 * Consume a delete-intent token previously issued by loginThunk. On success:
 *   1. backend has hard-deleted the user row (+ FK cascades),
 *   2. local DB is wiped,
 *   3. tokens + cached private_number are cleared from SecureStore.
 * The user is left on the login screen with empty fields.
 */
export const confirmDeleteFromLoginThunk = createAsyncThunk<
  void,
  { deleteToken: string },
  { rejectValue: string }
>('auth/confirmDeleteFromLogin', async ({ deleteToken }, { rejectWithValue }) => {
  try {
    await confirmDeleteApi({ delete_token: deleteToken });
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
  // Best-effort local cleanup — always runs after successful server delete.
  try {
    await wipeLocalData();
  } catch {
    /* ignore */
  }
  await clearTokens();
  await clearCachedPrivateNumber();
  await clearKeyPair();
  await clearCache();
});

/**
 * Authenticated self-service account deletion from Settings (App Store
 * Guideline 5.1.1(v) / Google Play policy). Deletes the signed-in account via
 * the caller's own session, then wipes all local data — same cleanup as the
 * delete-password flow. On success the reducer clears auth and the app returns
 * to the welcome screen.
 */
export const deleteAccountThunk = createAsyncThunk<
  void,
  void,
  { rejectValue: string }
>('auth/deleteAccount', async (_, { rejectWithValue }) => {
  // Detach this device's push token first, so a deleted account can't keep
  // receiving notifications. Best-effort — never blocks deletion.
  try {
    const pushToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    if (pushToken) {
      await clearPushTokenApi(pushToken);
      await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
    }
  } catch {
    /* push-token cleanup is best-effort */
  }

  try {
    await deleteAccountApi();
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }

  // Server delete succeeded — wipe every local trace of the account.
  try {
    await wipeLocalData();
  } catch {
    /* ignore */
  }
  await clearTokens();
  await clearCachedPrivateNumber();
  await clearKeyPair();
  await clearCache();
});

/**
 * Verify the password on the AppLockScreen and either unlock the app or
 * — if the delete password was entered — hard-delete the account and wipe
 * local data without any confirmation dialog.
 *
 * Discriminated return so the screen can react:
 *   - 'unlocked' → Redux flips appLocked=false and MainStack renders.
 *   - 'deleted'  → screen shows "Job Executed" then dispatches forceLogout.
 */
export type UnlockAppResult =
  | { kind: 'unlocked'; auth: AuthResult }
  | { kind: 'deleted' };

export const unlockAppThunk = createAsyncThunk<
  UnlockAppResult,
  { password: string },
  { rejectValue: string }
>('auth/unlock', async ({ password }, { rejectWithValue }) => {
  const cachedPN = await SecureStore.getItemAsync(CACHED_PRIVATE_NUMBER_KEY);
  if (!cachedPN || !/^\d{10}$/.test(cachedPN)) {
    return rejectWithValue('No cached account — please sign in again');
  }
  try {
    const mat = await deriveKeyMaterial(password, cachedPN);
    const resp = await loginApi({
      private_number: cachedPN,
      login_password: mat.authVerifier,
    });
    if (resp.action === 'confirm_delete') {
      // Duress password path — no dialog, wipe everything immediately.
      await confirmDeleteApi({ delete_token: resp.delete_token });
      try {
        await wipeLocalData();
      } catch {
        /* ignore — server side already done */
      }
      await clearTokens();
      await clearCachedPrivateNumber();
      await clearKeyPair();
      await clearCache();
      return { kind: 'deleted' };
    }
    await restoreKeyPairFromBackup(resp.encrypted_key_backup, mat.wrapKey, cachedPN);
    await persistTokens(resp.tokens.access_token, resp.tokens.refresh_token);
    await persistPrivateNumber(resp.user.private_number);
    return {
      kind: 'unlocked',
      auth: {
        user: resp.user,
        accessToken: resp.tokens.access_token,
        refreshToken: resp.tokens.refresh_token,
      },
    };
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const logoutThunk = createAsyncThunk<void, void>('auth/logout', async (_, { getState }) => {
  const state = getState() as { auth: AuthState };
  const refreshToken = state.auth.refreshToken;
  // Detach this phone's push token BEFORE the session dies — otherwise the
  // signed-out phone keeps receiving this account's notifications (sender
  // name + number). Best-effort: an offline logout still completes locally.
  try {
    const pushToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
    if (pushToken) {
      await clearPushTokenApi(pushToken);
      await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
    }
  } catch {
    /* push-token cleanup is best-effort */
  }
  if (refreshToken) {
    try {
      await logoutApi(refreshToken);
    } catch {
      /* server-side failure shouldn't block local logout */
    }
  }
  await clearTokens();
  // Wipe the stale-while-revalidate cache so the next account never sees the
  // previous user's decrypted conversations/messages.
  await clearCache();
});

export const rehydrateThunk = createAsyncThunk<AuthResult | null, void>(
  'auth/rehydrate',
  async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;
    try {
      const tokens = await refreshApi(refreshToken);
      await persistTokens(tokens.access_token, tokens.refresh_token);
      const me = await getMeApi();
      return {
        user: {
          id: me.id,
          private_number: me.private_number,
          display_name: me.display_name,
          is_active: true,
        },
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        bio: me.bio,
        profilePictureKey: me.profile_picture_key,
      };
    } catch {
      await clearTokens();
      return null;
    }
  },
);

// ── Slice helpers (module-level so reducers + extraReducers can share them) ───

function applyAuth(state: AuthState, payload: AuthResult) {
  state.isAuthenticated = true;
  state.token = payload.accessToken;
  state.refreshToken = payload.refreshToken;
  state.userId = payload.user.id || state.userId;
  state.privateNumber = payload.user.private_number || state.privateNumber;
  state.displayName = payload.user.display_name ?? state.displayName;
  if (payload.bio !== undefined) state.bio = payload.bio;
  if (payload.profilePictureKey !== undefined) state.profilePictureKey = payload.profilePictureKey;
  state.status = 'idle';
  state.error = null;
}

function clearAuth(state: AuthState) {
  Object.assign(state, initialState);
}

// ── Slice ────────────────────────────────────────────────────────────────────

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    // Called from PrivateNumberRevealScreen after user taps "Go to App".
    // Moves pendingRegistration into live auth state and sets isAuthenticated.
    finalizeRegistration: (state) => {
      if (!state.pendingRegistration) return;
      applyAuth(state, state.pendingRegistration);
      state.pendingRegistration = null;
    },
    // Synchronous logout for edge cases (e.g., forced by 401 handler).
    forceLogout: (state) => {
      Object.assign(state, initialState);
    },
    // Engage the app lock — used by the AppState listener on background→active.
    lockApp: (state) => {
      if (state.isAuthenticated) state.appLocked = true;
    },
    // Release the app lock without re-running the unlock thunk.
    unlockApp: (state) => {
      state.appLocked = false;
    },
    // Set after a profile-picture upload (or when /users/me is refreshed) so
    // the user's own avatar updates everywhere immediately.
    setProfilePictureKey: (state, action: PayloadAction<string | null>) => {
      state.profilePictureKey = action.payload;
    },
    // Set after a bio save (or when /users/me is refreshed) so the bio shows
    // on the Settings identity card without a second fetch.
    setBio: (state, action: PayloadAction<string | null>) => {
      state.bio = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(registerThunk.pending, (s) => {
        s.status = 'loading';
        s.error = null;
      })
      .addCase(registerThunk.fulfilled, (s, a: PayloadAction<AuthResult>) => {
        // Don't set isAuthenticated yet — wait for finalizeRegistration
        // so PrivateNumberRevealScreen can display before the nav stack switches.
        s.pendingRegistration = a.payload;
        s.status = 'idle';
      })
      .addCase(registerThunk.rejected, (s, a) => {
        s.status = 'error';
        s.error = a.payload ?? 'Registration failed';
      })
      .addCase(loginThunk.pending, (s) => {
        s.status = 'loading';
        s.error = null;
      })
      .addCase(loginThunk.fulfilled, (s, a: PayloadAction<LoginThunkResult>) => {
        s.status = 'idle';
        if (a.payload.kind === 'authenticated') {
          applyAuth(s, a.payload.auth);
        }
        // For 'deleteIntent' the LoginScreen handles the confirm dialog;
        // state is intentionally left untouched (user is still unauthenticated).
      })
      .addCase(loginThunk.rejected, (s, a) => {
        s.status = 'error';
        s.error = a.payload ?? 'Login failed';
      })
      .addCase(confirmDeleteFromLoginThunk.pending, (s) => {
        s.status = 'loading';
        s.error = null;
      })
      .addCase(confirmDeleteFromLoginThunk.fulfilled, clearAuth)
      .addCase(confirmDeleteFromLoginThunk.rejected, (s, a) => {
        s.status = 'error';
        s.error = a.payload ?? 'Delete failed';
      })
      .addCase(deleteAccountThunk.pending, (s) => {
        s.status = 'loading';
        s.error = null;
      })
      .addCase(deleteAccountThunk.fulfilled, clearAuth)
      .addCase(deleteAccountThunk.rejected, (s, a) => {
        s.status = 'error';
        s.error = a.payload ?? 'Delete failed';
      })
      .addCase(logoutThunk.fulfilled, clearAuth)
      .addCase(rehydrateThunk.fulfilled, (s, a) => {
        if (a.payload) {
          applyAuth(s, a.payload);
          // Cold-start lock: a restored session is gated behind AppLockScreen
          // until the user re-enters their password.
          s.appLocked = true;
        }
      })
      .addCase(unlockAppThunk.pending, (s) => {
        s.status = 'loading';
        s.error = null;
      })
      .addCase(unlockAppThunk.fulfilled, (s, a: PayloadAction<UnlockAppResult>) => {
        s.status = 'idle';
        if (a.payload.kind === 'unlocked') {
          applyAuth(s, a.payload.auth);
          s.appLocked = false;
        } else {
          // 'deleted' — wipe already executed by the thunk; screen will show
          // "Job Executed" briefly, then dispatch forceLogout to transition.
          // Nothing to mutate here; leave state untouched until forceLogout.
        }
      })
      .addCase(unlockAppThunk.rejected, (s, a) => {
        s.status = 'error';
        s.error = a.payload ?? 'Unlock failed';
      });
  },
});

export const {
  finalizeRegistration,
  forceLogout,
  lockApp,
  unlockApp,
  setProfilePictureKey,
  setBio,
} = authSlice.actions;
export default authSlice.reducer;
