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
  buildUserWebSocketUrl,
  createCallApi,
  getWebRtcConfigApi,
  lookupContactApi,
  TOKEN_KEY,
  updateCallApi,
} from '../services/api';
import * as SecureStore from '../utils/secureStorage';

// How long an unanswered call rings before it auto-cancels (caller) / is
// marked missed (callee). Matches the standard ~30s phone-app behaviour.
const RING_TIMEOUT_MS = 30_000;
// While ringing, re-send the offer on this cadence so a recipient whose user
// WS reconnects on foreground (e.g. after the incoming-call push wakes them)
// still catches it — the WS publish itself is fire-and-forget.
const OFFER_RESEND_MS = 3_000;

// ─── Public types ──────────────────────────────────────────────────────────────

export type CallMode =
  | 'incoming-banner'
  | 'incoming-fullscreen'
  | 'outgoing'
  | 'connected';

export interface CallState {
  mode: CallMode;
  callId: string;
  peerUserId: string;
  conversationId: string;
  contactName: string;
  contactPrivateNumber: string;
  startedAt: number;
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

  // Non-state refs (avoid unnecessary re-renders)
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<any>(null);
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
          'PrivaChat needs the microphone to make voice calls. Please enable it in your system settings.',
        );
      }
      return granted;
    } catch (err) {
      console.warn('[call] mic permission request failed:', err);
      return false;
    }
  }, []);

  // ── Peer connection factory ─────────────────────────────────────────────────

  const createPeerConnection = useCallback(async () => {
    const { ice_servers } = await getWebRtcConfigApi();
    const pc = new RTCPeerConnection({ iceServers: ice_servers } as any);

    (pc as any).ontrack = (_event: any) => {
      console.log('[call] Remote track received');
    };

    (pc as any).onconnectionstatechange = () => {
      const state = (pc as any).connectionState;
      console.log('[call] PC state:', state);
    };

    return pc;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup call ───────────────────────────────────────────────────────────

  const cleanupCall = useCallback(async () => {
    clearCallTimers();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t: any) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingIceRef.current = [];
    pendingOfferRef.current = null;
    setMuted(false);
    setSpeakerOn(false);
    setCallState(null);
    await setCallAudioMode(false);
  }, [setCallAudioMode, clearCallTimers]);

  // ── User WebSocket management ───────────────────────────────────────────────

  const connectUserWs = useCallback(async () => {
    if (userWsRef.current?.readyState === WebSocket.OPEN) return;
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (!token) return;

    const url = buildUserWebSocketUrl(token);
    const ws = new WebSocket(url);
    userWsRef.current = ws;

    ws.onopen = () => console.log('[call] User WS connected');

    ws.onmessage = (event) => {
      let data: any;
      try { data = JSON.parse(event.data); } catch { return; }

      const type: string = data.type;

      if (type === 'call_offer') {
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
            setCallState((prev) =>
              prev ? { ...prev, mode: 'connected', startedAt: Date.now() } : prev,
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

      // 2. Resolve the callee's UUID from their private number
      const lookupResult = await lookupContactApi(contact.number);
      if (!lookupResult.found || !lookupResult.user) {
        Alert.alert('Call failed', 'This user is no longer on PrivaChat.');
        await cleanupCall();
        return;
      }
      const calleeId = lookupResult.user.id;
      setCallState((prev) => (prev ? { ...prev, peerUserId: calleeId } : prev));

      // 3. Local media + peer connection — do this BEFORE creating the
      //    server call row, so a failed setup never writes history.
      await setCallAudioMode(true, false);

      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      const pc = await createPeerConnection();
      pcRef.current = pc;

      // 4. Log the call in the backend now that setup can't silently fail
      const callRecord = await createCallApi({
        conversation_id: contact.conversationId,
        callee_id: calleeId,
      });
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

      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      const pc = await createPeerConnection();
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

      // Record acceptance in backend
      await updateCallApi(offer.callId, { accepted_at: new Date().toISOString() });

      sendSignal({
        type: 'call_answer',
        to_user_id: offer.fromUserId,
        conversation_id: offer.conversationId,
        call_id: offer.callId,
        sdp: answer.sdp,
      });

      setCallState((prev) =>
        prev ? { ...prev, mode: 'connected', startedAt: Date.now() } : prev,
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

  // ── Expand incoming banner to fullscreen ────────────────────────────────────

  const expandIncoming = useCallback(() => {
    setCallState((prev) =>
      prev?.mode === 'incoming-banner' ? { ...prev, mode: 'incoming-fullscreen' } : prev,
    );
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
    toggleMute,
    toggleSpeaker,
  };

  return (
    <CallContext.Provider value={value}>
      <View style={{ flex: 1 }}>
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

        {callState && callState.mode !== 'incoming-banner' && (
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
          />
        )}
      </View>
    </CallContext.Provider>
  );
};

export const useCall = () => useContext(CallContext);
