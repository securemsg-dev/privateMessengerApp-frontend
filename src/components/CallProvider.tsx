import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus, View } from 'react-native';
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
  }, [setCallAudioMode]);

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
      } else if (type === 'call_answer') {
        // Our outgoing call was accepted
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

    // Helper to send ICE candidates — attached as custom event handler
    ws.addEventListener('_send_ice', (e: any) => {
      const { candidate } = e.detail;
      const cs = callState;
      if (ws.readyState !== WebSocket.OPEN || !cs) return;
      ws.send(JSON.stringify({
        type: 'call_ice',
        to_user_id: cs.peerUserId,
        conversation_id: cs.conversationId,
        call_id: cs.callId,
        candidate: candidate.toJSON(),
      }));
    });
  }, [isAuthenticated, cleanupCall]); // eslint-disable-line react-hooks/exhaustive-deps

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

    try {
      // Resolve the callee's UUID from their private number
      const lookupResult = await lookupContactApi(contact.number);
      if (!lookupResult.found || !lookupResult.user) {
        console.warn('[call] Could not look up callee');
        return;
      }
      const calleeId = lookupResult.user.id;

      // Log call in backend
      const callRecord = await createCallApi({
        conversation_id: contact.conversationId,
        callee_id: calleeId,
      });

      await setCallAudioMode(true, false);

      // Capture mic
      const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;

      // Create peer connection
      const pc = await createPeerConnection();
      pcRef.current = pc;

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

      // Update call state to outgoing
      setCallState({
        mode: 'outgoing',
        callId: callRecord.id,
        peerUserId: calleeId,
        conversationId: contact.conversationId,
        contactName: contact.name,
        contactPrivateNumber: contact.number,
        startedAt: Date.now(),
      });

      sendSignal({
        type: 'call_offer',
        to_user_id: calleeId,
        conversation_id: contact.conversationId,
        call_id: callRecord.id,
        sdp: offer.sdp,
      });
    } catch (err) {
      console.warn('[call] startOutgoingCall failed:', err);
      await cleanupCall();
    }
  }, [callState, setCallAudioMode, createPeerConnection, sendSignal, cleanupCall]);

  // ── Accept incoming call ────────────────────────────────────────────────────

  const acceptCall = useCallback(async () => {
    const offer = pendingOfferRef.current;
    if (!offer) return;

    try {
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
      await cleanupCall();
    }
  }, [setCallAudioMode, createPeerConnection, sendSignal, cleanupCall]);

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
