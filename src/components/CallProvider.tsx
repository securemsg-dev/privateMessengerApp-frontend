import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Alert, AppState, AppStateStatus, View } from 'react-native';
import { CallScreen } from './CallScreen';
import { IncomingCallBanner } from './IncomingCallBanner';
import { ActiveCallBar, ACTIVE_CALL_BAR_HEIGHT } from './ActiveCallBar';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
} from 'react-native-webrtc';
import { Audio } from 'expo-av';
import { useSelector } from 'react-redux';

import { RootState } from '../store';
import {
  ApiError,
  buildUserWebSocketUrl,
  createCallApi,
  getWebRtcConfigApi,
  lookupContactApi,
  TOKEN_KEY,
  updateCallApi,
} from '../services/api';
import * as SecureStore from '../utils/secureStorage';
import { userSocketBus } from '../services/userSocketBus';
import { useCallSounds } from '../hooks/useCallSounds';
import { beginLockSuppression, endLockSuppression } from '../utils/appLockGuard';
import {
  ensureCallForegroundServiceRegistered,
  startCallForegroundService,
  stopCallForegroundService,
} from '../services/callForegroundService';

// How long an unanswered call rings before it auto-cancels (caller) / is
// marked missed (callee). Matches the standard ~30s phone-app behaviour.
const RING_TIMEOUT_MS = 30_000;
// While ringing, re-send the offer on this cadence so a recipient whose user
// WS reconnects on foreground (e.g. after the incoming-call push wakes them)
// still catches it — the WS publish itself is fire-and-forget.
const OFFER_RESEND_MS = 3_000;

// Transient-network retry for the call-setup HTTP requests. A phone that was
// just woken from a killed state by the incoming-call push routinely fails its
// first fetch with "Network request failed" while the radio/network stack is
// still coming up — retrying beats surfacing a dead-end alert. Only genuine
// network-level failures are retried; ApiError (the server answered) is
// deterministic and rethrown immediately.
const NETWORK_RETRIES = 3;
const NETWORK_RETRY_BASE_MS = 700;

// ── ICE resilience ───────────────────────────────────────────────────────────
// A call that survives screen-off still has to survive the network churn that
// comes with it: Wi-Fi power-save, a Wi-Fi→cellular handover on wake, a few
// seconds of Doze. All of those show up as iceConnectionState 'disconnected'
// and then 'failed', which used to hang the call up on the spot. Instead, give
// the connection a chance to heal — first on its own, then via an ICE restart
// (offerer side only, to avoid glare) — and only give up if nothing works.
const ICE_DISCONNECT_GRACE_MS = 8_000;
// A call that has ALREADY been connected gets a long window — the user is
// mid-conversation and would rather wait out a tunnel than be hung up on. One
// that never connected at all is a setup failure (no TURN relay, blocked
// network); a restart rarely rescues it, so fail fast rather than leave the
// caller staring at "Connecting…".
const ICE_GIVE_UP_MS = 35_000;
const ICE_GIVE_UP_SETUP_MS = 12_000;
const MAX_ICE_RESTARTS = 3;

async function withNetworkRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < NETWORK_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, NETWORK_RETRY_BASE_MS * (attempt + 1)));
    }
  }
  throw lastErr;
}

// The ICE/TURN config is identical for every user and its TURN credentials are
// static env vars, so re-fetching it on every call setup just adds a network
// round-trip to the dial latency. Cache it briefly and pre-warm on connect.
const ICE_CACHE_TTL_MS = 5 * 60_000;
let iceServersCache: { servers: any[]; at: number } | null = null;

const fetchIceServers = async (force = false): Promise<any[]> => {
  if (
    !force &&
    iceServersCache &&
    Date.now() - iceServersCache.at < ICE_CACHE_TTL_MS
  ) {
    return iceServersCache.servers;
  }
  const { ice_servers } = await withNetworkRetry(() => getWebRtcConfigApi());
  // Native RTCPeerConnection (Android) throws "username == null" if an entry
  // carries username/credential keys with null values — only pass keys that
  // actually have a value.
  const servers = ice_servers.map((s: any) => {
    const entry: Record<string, unknown> = { urls: s.urls };
    if (s.username) entry.username = s.username;
    if (s.credential) entry.credential = s.credential;
    return entry;
  });
  iceServersCache = { servers, at: Date.now() };
  return servers;
};

// ─── Public types ──────────────────────────────────────────────────────────────

export type CallMode =
  | 'incoming-banner'
  | 'incoming-fullscreen'
  | 'outgoing'
  // SDP exchanged, waiting for ICE/media to actually establish.
  | 'connecting'
  | 'connected';

export interface CallState {
  mode: CallMode;
  callId: string;
  peerUserId: string;
  conversationId: string;
  contactName: string;
  contactPrivateNumber: string;
  startedAt: number;
  /**
   * Full-screen call UI collapsed to the ActiveCallBar so the user can browse
   * chats / send messages while still on the call. Purely presentational — the
   * peer connection is untouched either way.
   */
  minimized: boolean;
}

export interface CallContact {
  name: string;
  number: string;
  conversationId: string;
}

interface CallContextValue {
  state: CallState | null;
  muted: boolean;
  speakerOn: boolean;
  startOutgoingCall: (contact: CallContact) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  endCall: (reason?: string) => Promise<void>;
  expandIncoming: () => void;
  minimizeCall: () => void;
  restoreCall: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
}

// ─── Context ───────────────────────────────────────────────────────────────────

const noop = async () => {};
const noopSync = () => {};

const CallContext = createContext<CallContextValue>({
  state: null,
  muted: false,
  speakerOn: false,
  startOutgoingCall: noop,
  acceptCall: noop,
  declineCall: noop,
  endCall: noop,
  expandIncoming: noopSync,
  minimizeCall: noopSync,
  restoreCall: noopSync,
  toggleMute: noopSync,
  toggleSpeaker: noopSync,
});

// ─── Provider ──────────────────────────────────────────────────────────────────

export const CallProvider = ({ children }: { children: ReactNode }) => {
  const isAuthenticated = useSelector((s: RootState) => s.auth.isAuthenticated);
  const myDisplayName = useSelector((s: RootState) => s.auth.displayName);
  const myPrivateNumber = useSelector((s: RootState) => s.auth.privateNumber);

  const [callState, setCallState] = useState<CallState | null>(null);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  // True once the mic is actually captured — the trigger for the Android
  // foreground service (see the effect below for why capture, not call start).
  const [mediaActive, setMediaActive] = useState(false);

  // Ringback (outgoing) / ringtone (incoming) — stops once connecting/ended.
  useCallSounds(callState?.mode ?? null);

  // While a call is up, don't let the brief backgrounding from the incoming
  // permission dialog / audio routing / returning to the call force a PIN
  // re-entry. Suppression lifts when the call ends.
  const inCall = callState != null;
  useEffect(() => {
    if (!inCall) return;
    beginLockSuppression();
    return () => endLockSuppression();
  }, [inCall]);

  // Non-state refs (avoid unnecessary re-renders)
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<any>(null);
  const remoteStreamRef = useRef<any>(null);
  // Lets the peer-connection event handlers (created before endCall exists)
  // tear a call down on terminal ICE failure without a dependency cycle.
  const endCallRef = useRef<(reason?: string) => Promise<void>>(async () => {});
  const userWsRef = useRef<WebSocket | null>(null);
  const pendingIceRef = useRef<RTCIceCandidate[]>([]);
  // Store incoming offer before user accepts
  const pendingOfferRef = useRef<{ sdp: string; callId: string; fromUserId: string; conversationId: string; contactName: string; contactPrivateNumber: string } | null>(null);

  // Ring timers. Caller: re-send the offer on an interval + give up after the
  // ring timeout. Callee: auto-decline (missed) after the ring timeout.
  const outgoingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerResendRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const incomingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The full call_offer payload, kept so the resend interval can replay it.
  const outgoingOfferMsgRef = useRef<object | null>(null);

  // ICE recovery. `iceRestartRef` is populated by the OFFERER only — the
  // answerer must not fire its own restart or the two collide (glare).
  const iceGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceGiveUpRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceRestartsRef = useRef(0);
  const iceRestartRef = useRef<(() => Promise<void>) | null>(null);
  // When the call FIRST connected. Kept out of callState so an ICE restart
  // (which briefly drops us back to 'connecting') doesn't reset the on-screen
  // call duration to 00:00.
  const connectedAtRef = useRef<number | null>(null);

  const clearIceTimers = useCallback(() => {
    if (iceGraceRef.current) {
      clearTimeout(iceGraceRef.current);
      iceGraceRef.current = null;
    }
    if (iceGiveUpRef.current) {
      clearTimeout(iceGiveUpRef.current);
      iceGiveUpRef.current = null;
    }
  }, []);

  const clearCallTimers = useCallback(() => {
    if (outgoingTimeoutRef.current) {
      clearTimeout(outgoingTimeoutRef.current);
      outgoingTimeoutRef.current = null;
    }
    if (offerResendRef.current) {
      clearInterval(offerResendRef.current);
      offerResendRef.current = null;
    }
    if (incomingTimeoutRef.current) {
      clearTimeout(incomingTimeoutRef.current);
      incomingTimeoutRef.current = null;
    }
    outgoingOfferMsgRef.current = null;
  }, []);

  // ── Audio mode helpers ──────────────────────────────────────────────────────

  const setCallAudioMode = useCallback(async (active: boolean, speaker = false) => {
    try {
      if (active) {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: !speaker,
        });
      } else {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: false,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      }
    } catch (err) {
      console.warn('[call] setAudioMode failed:', err);
    }
  }, []);

  // ── Microphone permission ───────────────────────────────────────────────────
  // react-native-webrtc's getUserMedia does NOT reliably trigger the runtime
  // permission prompt on Android — request it explicitly (same expo-av flow
  // the voice recorder uses) so the user sees the system dialog.

  const ensureMicPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert(
          'Microphone access needed',
          'Cricchat needs the microphone to make voice calls. Please enable it in your system settings.',
        );
      }
      return granted;
    } catch (err) {
      console.warn('[call] mic permission request failed:', err);
      return false;
    }
  }, []);

  // ── Peer connection factory ─────────────────────────────────────────────────

  // Takes the (already-fetched, cached) ICE servers so the network round-trip
  // can be parallelised with mic capture / callee lookup by the caller.
  const createPeerConnection = useCallback((iceServers: any[]) => {
    const pc = new RTCPeerConnection({ iceServers } as any);

    // Retain the remote stream so its audio track stays alive for playback.
    // (react-native-webrtc auto-plays remote audio; holding the ref also
    // future-proofs video and guarantees the track isn't GC'd mid-call.)
    (pc as any).ontrack = (event: any) => {
      console.log('[call] Remote track received');
      const [stream] = event.streams ?? [];
      if (stream) remoteStreamRef.current = stream;
    };

    // The UI must reflect whether MEDIA actually flows — not just that the
    // answer SDP arrived. Promote to "connected" only once ICE establishes.
    //
    // 'disconnected' and 'failed' are NOT immediate hang-ups: they are exactly
    // what a screen-off, a Wi-Fi→cellular handover, or a few seconds of Doze
    // look like, and the connection very often heals itself or after an ICE
    // restart. Only a connection that stays broken past ICE_GIVE_UP_MS ends
    // the call.
    const onIceState = () => {
      const state = (pc as any).iceConnectionState;
      console.log('[call] ICE state:', state);

      if (state === 'connected' || state === 'completed') {
        clearIceTimers();
        iceRestartsRef.current = 0;
        if (connectedAtRef.current == null) connectedAtRef.current = Date.now();
        const connectedAt = connectedAtRef.current;
        setCallState((prev) =>
          prev && prev.mode !== 'connected'
            ? { ...prev, mode: 'connected', startedAt: connectedAt }
            : prev,
        );
        return;
      }

      if (state !== 'disconnected' && state !== 'failed') return;

      // Whichever state got us here, one hard deadline governs the recovery.
      if (!iceGiveUpRef.current) {
        const deadline =
          connectedAtRef.current == null ? ICE_GIVE_UP_SETUP_MS : ICE_GIVE_UP_MS;
        iceGiveUpRef.current = setTimeout(() => {
          console.warn('[call] ICE never recovered — ending call');
          void endCallRef.current('failed');
        }, deadline);
      }

      const attemptRestart = () => {
        iceGraceRef.current = null;
        const restart = iceRestartRef.current;
        if (!restart || iceRestartsRef.current >= MAX_ICE_RESTARTS) {
          // Answerer side, or out of attempts: nothing to do but wait for the
          // offerer's restart offer until the give-up timer fires.
          return;
        }
        iceRestartsRef.current += 1;
        console.log('[call] attempting ICE restart', iceRestartsRef.current);
        void restart();
      };

      if (state === 'failed') {
        // Terminal without intervention — restart now, don't wait out the grace.
        if (iceGraceRef.current) {
          clearTimeout(iceGraceRef.current);
          iceGraceRef.current = null;
        }
        attemptRestart();
      } else if (!iceGraceRef.current) {
        // 'disconnected' frequently recovers on its own; give it a moment
        // before spending a restart on it.
        iceGraceRef.current = setTimeout(attemptRestart, ICE_DISCONNECT_GRACE_MS);
      }
    };
    (pc as any).oniceconnectionstatechange = onIceState;
    (pc as any).onconnectionstatechange = () => {
      console.log('[call] PC state:', (pc as any).connectionState);
    };

    return pc;
  }, [clearIceTimers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup call ───────────────────────────────────────────────────────────

  const cleanupCall = useCallback(async () => {
    clearCallTimers();
    clearIceTimers();
    iceRestartsRef.current = 0;
    iceRestartRef.current = null;
    connectedAtRef.current = null;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t: any) => t.stop());
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingIceRef.current = [];
    pendingOfferRef.current = null;
    setMediaActive(false);
    setMuted(false);
    setSpeakerOn(false);
    setCallState(null);
    await setCallAudioMode(false);
    // Belt-and-braces: the lifecycle effect below also stops the service when
    // callState clears, but a call must never leave a stuck "Ongoing call"
    // notification (and a held wake lock) behind.
    await stopCallForegroundService();
  }, [setCallAudioMode, clearCallTimers, clearIceTimers]);

  // ── User WebSocket management ───────────────────────────────────────────────

  const connectUserWs = useCallback(async () => {
    if (userWsRef.current?.readyState === WebSocket.OPEN) return;
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) return;

    const url = buildUserWebSocketUrl(token);
    const ws = new WebSocket(url);
    userWsRef.current = ws;

    ws.onopen = () => {
      console.log('[call] User WS connected');
      // Pre-warm the ICE/TURN config so the first call doesn't pay for the
      // fetch on the critical path. Failure is non-fatal (call setup refetches).
      void fetchIceServers().catch(() => {});
    };

    ws.onmessage = (event) => {
      let data: any;
      try { data = JSON.parse(event.data); } catch { return; }

      const type: string = data.type;

      if (type === 'call_offer') {
        // An ICE restart on the caller's side arrives as a fresh offer for the
        // call we're already on. Renegotiate in place — no ringing, no new UI.
        if (data.ice_restart && pcRef.current && pendingOfferRef.current?.callId === data.call_id) {
          const pc = pcRef.current;
          void (async () => {
            try {
              await pc.setRemoteDescription(
                new RTCSessionDescription({ type: 'offer', sdp: data.sdp }),
              );
              const answer = await (pc as any).createAnswer();
              await pc.setLocalDescription(answer);
              ws.send(JSON.stringify({
                type: 'call_answer',
                to_user_id: data.from_user_id,
                conversation_id: data.conversation_id,
                call_id: data.call_id,
                sdp: answer.sdp,
              }));
              console.log('[call] answered ICE-restart offer');
            } catch (err) {
              console.warn('[call] ICE-restart renegotiation failed:', err);
            }
          })();
          return;
        }

        // The caller re-sends the offer every few seconds while ringing, so
        // ignore duplicates for a call we're already handling (banner shown
        // or already accepted) — only the first one rings.
        if (pendingOfferRef.current?.callId === data.call_id) return;

        // Incoming call — show banner
        const contactName = data.caller_display_name ?? 'Unknown';
        const contactPrivateNumber = data.caller_private_number ?? '';
        pendingOfferRef.current = {
          sdp: data.sdp,
          callId: data.call_id,
          fromUserId: data.from_user_id,
          conversationId: data.conversation_id,
          contactName,
          contactPrivateNumber,
        };
        setCallState({
          mode: 'incoming-banner',
          callId: data.call_id,
          peerUserId: data.from_user_id,
          conversationId: data.conversation_id ?? '',
          contactName,
          contactPrivateNumber,
          startedAt: Date.now(),
          minimized: false,
        });

        // Auto-decline as "missed" if the user never picks up in time.
        if (incomingTimeoutRef.current) clearTimeout(incomingTimeoutRef.current);
        incomingTimeoutRef.current = setTimeout(() => {
          const offer = pendingOfferRef.current;
          // Still un-accepted? (acceptCall starts the peer connection.)
          if (!offer || pcRef.current) return;
          try {
            ws.send(JSON.stringify({
              type: 'call_end',
              to_user_id: offer.fromUserId,
              conversation_id: offer.conversationId,
              call_id: offer.callId,
              reason: 'missed',
            }));
          } catch { /* ws may be gone; the call row is still marked below */ }
          void updateCallApi(offer.callId, {
            ended_at: new Date().toISOString(),
            end_reason: 'missed',
          }).catch(() => {});
          void cleanupCall();
        }, RING_TIMEOUT_MS);
      } else if (type === 'call_answer') {
        // Our outgoing call was accepted — stop ringing/re-sending.
        clearCallTimers();
        if (pcRef.current) {
          const desc = new RTCSessionDescription({ type: 'answer', sdp: data.sdp });
          pcRef.current.setRemoteDescription(desc).then(() => {
            // Flush any pending ICE candidates
            for (const c of pendingIceRef.current) {
              pcRef.current?.addIceCandidate(c).catch(() => {});
            }
            pendingIceRef.current = [];
            // SDP is exchanged — but audio doesn't flow until ICE connects.
            // Show "Connecting…" until oniceconnectionstatechange promotes us.
            setCallState((prev) =>
              prev ? { ...prev, mode: 'connecting' } : prev,
            );
          }).catch((err: any) => console.warn('[call] setRemoteDescription (answer):', err));
        }
      } else if (type === 'call_ice') {
        const candidate = new RTCIceCandidate(data.candidate);
        if (pcRef.current?.remoteDescription) {
          pcRef.current.addIceCandidate(candidate).catch(() => {});
        } else {
          pendingIceRef.current.push(candidate);
        }
      } else if (type === 'call_end') {
        // Peer hung up or call was cancelled
        void cleanupCall();
      } else {
        // Non-call frame (e.g. message_notification) — hand off to the bus so
        // chat features can react without coupling into the call layer.
        userSocketBus.emit(data);
      }
    };

    ws.onerror = (err) => console.warn('[call] User WS error:', err);

    ws.onclose = () => {
      console.log('[call] User WS closed');
      userWsRef.current = null;
      // Reconnect after a delay if still authenticated
      setTimeout(() => {
        if (isAuthenticated) void connectUserWs();
      }, 3000);
    };
  }, [isAuthenticated, cleanupCall, clearCallTimers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect user WS when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      void connectUserWs();
    } else {
      userWsRef.current?.close();
      userWsRef.current = null;
    }
    return () => {
      userWsRef.current?.close();
      userWsRef.current = null;
    };
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reconnect user WS when app comes to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && isAuthenticated) {
        void connectUserWs();
      }
    });
    return () => sub.remove();
  }, [isAuthenticated, connectUserWs]);

  // ── Send signaling helper ───────────────────────────────────────────────────

  const sendSignal = useCallback((msg: object) => {
    const ws = userWsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      console.warn('[call] User WS not ready, cannot send signal');
    }
  }, []);

  // ── Start outgoing call ─────────────────────────────────────────────────────

  const startOutgoingCall = useCallback(async (contact: CallContact) => {
    if (callState) return; // already in a call

    // Show the call screen IMMEDIATELY so the user gets instant feedback —
    // callId/peerUserId are filled in as the async setup completes. endCall
    // knows an empty callId means "setup phase" (no server row yet).
    setCallState({
      mode: 'outgoing',
      callId: '',
      peerUserId: '',
      conversationId: contact.conversationId,
      contactName: contact.name,
      contactPrivateNumber: contact.number,
      startedAt: Date.now(),
      minimized: false,
    });

    // Set on success; used by the catch to close the server row on failure
    // so the Calls tab never accumulates eternal "In progress" entries.
    let createdCallId: string | null = null;

    try {
      // 1. Mic permission first — the most common silent failure on Android.
      if (!(await ensureMicPermission())) {
        await cleanupCall();
        return;
      }

      // 2. Independent setup runs concurrently — the callee lookup, mic
      //    capture, and ICE config don't depend on each other, so overlapping
      //    them (instead of three serial round-trips) cuts the time before the
      //    callee's phone rings. setCallAudioMode is a fast local call.
      await setCallAudioMode(true, false);

      const [lookupResult, stream, iceServers] = await Promise.all([
        withNetworkRetry(() => lookupContactApi(contact.number)),
        mediaDevices.getUserMedia({ audio: true, video: false }),
        fetchIceServers(),
      ]);
      // Track the stream immediately so cleanupCall always releases the mic,
      // even if we bail on the not-found path below.
      localStreamRef.current = stream;
      // Mic is live — safe to raise the Android foreground service now.
      setMediaActive(true);

      if (!lookupResult.found || !lookupResult.user) {
        Alert.alert('Call failed', 'This user is no longer on Cricchat.');
        await cleanupCall();
        return;
      }
      const calleeId = lookupResult.user.id;
      setCallState((prev) => (prev ? { ...prev, peerUserId: calleeId } : prev));

      const pc = createPeerConnection(iceServers);
      pcRef.current = pc;

      // 3. Log the call in the backend now that setup can't silently fail
      const callRecord = await withNetworkRetry(() =>
        createCallApi({
          conversation_id: contact.conversationId,
          callee_id: calleeId,
        }),
      );
      createdCallId = callRecord.id;
      setCallState((prev) => (prev ? { ...prev, callId: callRecord.id } : prev));

      // Attach ICE candidate sender with current call context
      (pc as any).onicecandidate = (event: any) => {
        if (!event.candidate) return;
        sendSignal({
          type: 'call_ice',
          to_user_id: calleeId,
          conversation_id: contact.conversationId,
          call_id: callRecord.id,
          candidate: event.candidate.toJSON(),
        });
      };

      stream.getTracks().forEach((track: any) => (pc as any).addTrack(track, stream));

      const offer = await (pc as any).createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      const offerMsg = {
        type: 'call_offer',
        to_user_id: calleeId,
        conversation_id: contact.conversationId,
        call_id: callRecord.id,
        sdp: offer.sdp,
        // Fallback identity; the server also enriches this authoritatively.
        caller_display_name: myDisplayName ?? undefined,
        caller_private_number: myPrivateNumber ?? undefined,
      };
      outgoingOfferMsgRef.current = offerMsg;
      sendSignal(offerMsg);

      // We're the offerer, so we own ICE recovery for this call (the answerer
      // deliberately has no restarter — two simultaneous restarts glare). The
      // `ice_restart` flag tells the far side to renegotiate in place instead
      // of ringing again, and tells the server not to re-push "Incoming call".
      iceRestartRef.current = async () => {
        const livePc = pcRef.current;
        if (!livePc) return;
        try {
          const restartOffer = await (livePc as any).createOffer({ iceRestart: true });
          await livePc.setLocalDescription(restartOffer);
          sendSignal({
            type: 'call_offer',
            to_user_id: calleeId,
            conversation_id: contact.conversationId,
            call_id: callRecord.id,
            sdp: restartOffer.sdp,
            ice_restart: true,
          });
        } catch (err) {
          console.warn('[call] ICE restart offer failed:', err);
        }
      };

      // Re-send while ringing so a recipient whose WS reconnects on
      // foreground (after the push) still receives the offer.
      offerResendRef.current = setInterval(() => {
        if (outgoingOfferMsgRef.current) sendSignal(outgoingOfferMsgRef.current);
      }, OFFER_RESEND_MS);

      // Give up if unanswered. clearCallTimers() (fired on call_answer /
      // cleanup) cancels this, so reaching here means the call never
      // connected — mark it as a missed/no-answer call and tear down.
      outgoingTimeoutRef.current = setTimeout(() => {
        sendSignal({
          type: 'call_end',
          to_user_id: calleeId,
          conversation_id: contact.conversationId,
          call_id: callRecord.id,
          reason: 'missed',
        });
        void updateCallApi(callRecord.id, {
          ended_at: new Date().toISOString(),
          end_reason: 'missed',
        }).catch(() => {});
        void cleanupCall();
      }, RING_TIMEOUT_MS);
    } catch (err) {
      console.warn('[call] startOutgoingCall failed:', err);
      // Close the server row so the Calls tab doesn't show "In progress" forever
      if (createdCallId) {
        void updateCallApi(createdCallId, {
          ended_at: new Date().toISOString(),
          end_reason: 'failed',
        }).catch(() => {});
      }
      Alert.alert(
        'Call failed',
        err instanceof Error && err.message
          ? err.message
          : 'Could not start the call. Please try again.',
      );
      await cleanupCall();
    }
  }, [callState, ensureMicPermission, setCallAudioMode, createPeerConnection, sendSignal, cleanupCall, myDisplayName, myPrivateNumber]);

  // ── Accept incoming call ────────────────────────────────────────────────────

  const acceptCall = useCallback(async () => {
    const offer = pendingOfferRef.current;
    if (!offer) return;

    // Picked up — stop the auto-decline ring timer.
    clearCallTimers();

    try {
      if (!(await ensureMicPermission())) {
        // Can't take the call without a mic — tell the caller we're out.
        sendSignal({
          type: 'call_end',
          to_user_id: offer.fromUserId,
          conversation_id: offer.conversationId,
          call_id: offer.callId,
          reason: 'failed',
        });
        void updateCallApi(offer.callId, {
          ended_at: new Date().toISOString(),
          end_reason: 'failed',
        }).catch(() => {});
        await cleanupCall();
        return;
      }

      await setCallAudioMode(true, false);

      // Capture mic + fetch (cached) ICE config concurrently to answer faster.
      const [stream, iceServers] = await Promise.all([
        mediaDevices.getUserMedia({ audio: true, video: false }),
        fetchIceServers(),
      ]);
      localStreamRef.current = stream;
      // Mic is live — safe to raise the Android foreground service now.
      setMediaActive(true);

      const pc = createPeerConnection(iceServers);
      pcRef.current = pc;

      (pc as any).onicecandidate = (event: any) => {
        if (!event.candidate) return;
        sendSignal({
          type: 'call_ice',
          to_user_id: offer.fromUserId,
          conversation_id: offer.conversationId,
          call_id: offer.callId,
          candidate: event.candidate.toJSON(),
        });
      };

      stream.getTracks().forEach((track: any) => (pc as any).addTrack(track, stream));

      const desc = new RTCSessionDescription({ type: 'offer', sdp: offer.sdp });
      await pc.setRemoteDescription(desc);

      // Flush pending ICE
      for (const c of pendingIceRef.current) {
        await pc.addIceCandidate(c).catch(() => {});
      }
      pendingIceRef.current = [];

      const answer = await (pc as any).createAnswer();
      await pc.setLocalDescription(answer);

      // The answer signal is what actually connects the call — send it first.
      sendSignal({
        type: 'call_answer',
        to_user_id: offer.fromUserId,
        conversation_id: offer.conversationId,
        call_id: offer.callId,
        sdp: answer.sdp,
      });

      // Recording acceptance server-side is bookkeeping for the Calls tab —
      // best-effort, never abort an already-answered call over it.
      void withNetworkRetry(() =>
        updateCallApi(offer.callId, { accepted_at: new Date().toISOString() }),
      ).catch(() => {});

      // Answer sent — wait for ICE to actually connect before "Connected".
      setCallState((prev) =>
        prev ? { ...prev, mode: 'connecting' } : prev,
      );
    } catch (err) {
      console.warn('[call] acceptCall failed:', err);
      // Tell the caller + close the row so neither side shows "In progress"
      sendSignal({
        type: 'call_end',
        to_user_id: offer.fromUserId,
        conversation_id: offer.conversationId,
        call_id: offer.callId,
        reason: 'failed',
      });
      void updateCallApi(offer.callId, {
        ended_at: new Date().toISOString(),
        end_reason: 'failed',
      }).catch(() => {});
      Alert.alert(
        'Call failed',
        err instanceof Error && err.message
          ? err.message
          : 'Could not answer the call. Please try again.',
      );
      await cleanupCall();
    }
  }, [ensureMicPermission, setCallAudioMode, createPeerConnection, sendSignal, cleanupCall, clearCallTimers]);

  // ── Decline incoming call ───────────────────────────────────────────────────

  const declineCall = useCallback(async () => {
    const offer = pendingOfferRef.current;
    const cs = callState;
    if (!cs) return;
    sendSignal({
      type: 'call_end',
      to_user_id: cs.peerUserId,
      conversation_id: cs.conversationId,
      call_id: cs.callId,
      reason: 'declined',
    });
    if (offer) {
      await updateCallApi(offer.callId, {
        ended_at: new Date().toISOString(),
        end_reason: 'declined',
      }).catch(() => {});
    }
    await cleanupCall();
  }, [callState, sendSignal, cleanupCall]);

  // ── End active call ─────────────────────────────────────────────────────────

  const endCall = useCallback(async (reason = 'completed') => {
    const cs = callState;
    if (!cs) return;
    // Hung up while setup was still in flight (no server row, peer never
    // signaled) — just tear down locally.
    if (!cs.callId) {
      await cleanupCall();
      return;
    }
    sendSignal({
      type: 'call_end',
      to_user_id: cs.peerUserId,
      conversation_id: cs.conversationId,
      call_id: cs.callId,
      reason,
    });
    await updateCallApi(cs.callId, {
      ended_at: new Date().toISOString(),
      end_reason: reason as any,
    }).catch(() => {});
    await cleanupCall();
  }, [callState, sendSignal, cleanupCall]);

  // Keep the ICE-failure escape hatch pointed at the current endCall.
  useEffect(() => {
    endCallRef.current = endCall;
  }, [endCall]);

  // ── Expand incoming banner to fullscreen ────────────────────────────────────

  const expandIncoming = useCallback(() => {
    setCallState((prev) =>
      prev?.mode === 'incoming-banner' ? { ...prev, mode: 'incoming-fullscreen' } : prev,
    );
  }, []);

  // ── Minimise / restore the call UI ──────────────────────────────────────────
  // An un-answered incoming call has nothing to minimise to — it stays modal
  // until the user accepts or declines.

  const minimizeCall = useCallback(() => {
    setCallState((prev) =>
      prev && prev.mode !== 'incoming-banner' && prev.mode !== 'incoming-fullscreen'
        ? { ...prev, minimized: true }
        : prev,
    );
  }, []);

  const restoreCall = useCallback(() => {
    setCallState((prev) => (prev ? { ...prev, minimized: false } : prev));
  }, []);

  // ── Mute / Speaker ─────────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      const newMuted = !muted;
      audioTracks.forEach((t: any) => { t.enabled = !newMuted; });
      setMuted(newMuted);
    }
  }, [muted]);

  const toggleSpeaker = useCallback(async () => {
    const newSpeaker = !speakerOn;
    setSpeakerOn(newSpeaker);
    await setCallAudioMode(true, newSpeaker);
  }, [speakerOn, setCallAudioMode]);

  // ── Background survival (Android foreground service) ────────────────────────
  // Android 9+ cuts microphone access to any process that isn't at foreground
  // importance, so locking the screen mid-call silenced the mic and then killed
  // the peer connection. A `microphone` foreground service holds that
  // importance for as long as the call is up. No-op on iOS, where the `audio`
  // background mode in app.json does the same job.
  //
  // Keyed on mediaActive (mic captured), NOT on "a call exists": Android 14+
  // throws a SecurityException if a `microphone`-type service starts before
  // RECORD_AUDIO is granted, and getUserMedia succeeding is the proof that it
  // is. It also scopes the service correctly — a phone that is merely ringing
  // has no capture to protect.
  //
  // Read the name inside the effect rather than depending on it, so renaming a
  // contact mid-call can't stop and restart the service.
  const serviceNameRef = useRef('');
  serviceNameRef.current = callState?.contactName ?? '';

  useEffect(() => {
    ensureCallForegroundServiceRegistered();
  }, []);

  useEffect(() => {
    if (!mediaActive) return;
    void startCallForegroundService(serviceNameRef.current || 'Cricchat call');
    return () => {
      void stopCallForegroundService();
    };
  }, [mediaActive]);

  // ── Context value ───────────────────────────────────────────────────────────

  const value: CallContextValue = {
    state: callState,
    muted,
    speakerOn,
    startOutgoingCall,
    acceptCall,
    declineCall,
    endCall,
    expandIncoming,
    minimizeCall,
    restoreCall,
    toggleMute,
    toggleSpeaker,
  };

  const minimized = callState?.minimized === true;

  return (
    <CallContext.Provider value={value}>
      {/* Pad the app down while the call bar is up so it never covers a screen
          header the user is trying to tap. */}
      <View style={{ flex: 1, paddingTop: minimized ? ACTIVE_CALL_BAR_HEIGHT : 0 }}>
        {children}

        {callState?.mode === 'incoming-banner' && (
          <IncomingCallBanner
            contactName={callState.contactName}
            contactNumber={callState.contactPrivateNumber}
            onAccept={acceptCall}
            onDecline={declineCall}
            onExpand={expandIncoming}
          />
        )}

        {callState && callState.mode !== 'incoming-banner' && !minimized && (
          <CallScreen
            mode={callState.mode}
            contactName={callState.contactName}
            contactNumber={callState.contactPrivateNumber}
            startedAt={callState.startedAt}
            muted={muted}
            speakerOn={speakerOn}
            onAccept={acceptCall}
            onDecline={declineCall}
            onEnd={() => void endCall()}
            onToggleMute={toggleMute}
            onToggleSpeaker={() => void toggleSpeaker()}
            // Only an answered / outgoing call can be minimised.
            onMinimize={
              callState.mode === 'incoming-fullscreen' ? undefined : minimizeCall
            }
          />
        )}

        {callState && minimized && callState.mode !== 'incoming-banner'
          && callState.mode !== 'incoming-fullscreen' && (
          <ActiveCallBar
            mode={callState.mode}
            contactName={callState.contactName}
            startedAt={callState.startedAt}
            muted={muted}
            onRestore={restoreCall}
            onEnd={() => void endCall()}
          />
        )}
      </View>
    </CallContext.Provider>
  );
};

export const useCall = () => useContext(CallContext);
