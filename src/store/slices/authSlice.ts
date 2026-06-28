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
  confirmDeleteApi,
  getMeApi,
  loginApi,
  logoutApi,
  refreshApi,
  registerApi,
  REFRESH_TOKEN_KEY,
  TOKEN_KEY,
  UserDTO,
} from '../../services/api';
import { wipeLocalData } from '../../services/database';
import { clearKeyPair } from '../../services/crypto';

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
}

export const registerThunk = createAsyncThunk<
  AuthResult,
  { loginPassword: string; deletePassword: string; displayName?: string },
  { rejectValue: string }
>('auth/register', async ({ loginPassword, deletePassword, displayName }, { rejectWithValue }) => {
  try {
    const resp = await registerApi({
      login_password: loginPassword,
      delete_password: deletePassword,
      display_name: displayName,
    });
    await persistTokens(resp.tokens.access_token, resp.tokens.refresh_token);
    await persistPrivateNumber(resp.user.private_number);
    return {
      user: resp.user,
      accessToken: resp.tokens.access_token,
      refreshToken: resp.tokens.refresh_token,
    };
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
    const resp = await loginApi({
      private_number: privateNumber,
      login_password: loginPassword,
    });
    if (resp.action === 'confirm_delete') {
      return {
        kind: 'deleteIntent',
        deleteToken: resp.delete_token,
        expiresIn: resp.expires_in,
      };
    }
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
    const resp = await loginApi({
      private_number: cachedPN,
      login_password: password,
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
      return { kind: 'deleted' };
    }
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
  if (refreshToken) {
    try {
      await logoutApi(refreshToken);
    } catch {
      /* server-side failure shouldn't block local logout */
    }
  }
  await clearTokens();
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
} = authSlice.actions;
export default authSlice.reducer;
