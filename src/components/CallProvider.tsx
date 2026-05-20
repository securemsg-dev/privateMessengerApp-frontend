import React, { createContext, ReactNode, useContext } from 'react';
import { Alert } from 'react-native';

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
  startOutgoingCall: (contact: CallContact) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  endCall: () => Promise<void>;
  expandIncoming: () => void;
}

const noop = async () => {};
const noopSync = () => {};

const CallContext = createContext<CallContextValue>({
  state: null,
  startOutgoingCall: noop,
  acceptCall: noop,
  declineCall: noop,
  endCall: noop,
  expandIncoming: noopSync,
});

export const CallProvider = ({ children }: { children: ReactNode }) => {
  const startOutgoingCall = async (_contact: CallContact) => {
    Alert.alert('Coming soon', 'Voice calls will be available in the next release.');
  };

  const value: CallContextValue = {
    state: null,
    startOutgoingCall,
    acceptCall: noop,
    declineCall: noop,
    endCall: noop,
    expandIncoming: noopSync,
  };

  return (
    <CallContext.Provider value={value}>
      {children}
    </CallContext.Provider>
  );
};

export const useCall = () => useContext(CallContext);
