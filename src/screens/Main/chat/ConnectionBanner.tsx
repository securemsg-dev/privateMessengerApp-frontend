import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ConnectionState } from '../../../services/socket';
import { styles } from './styles';

interface Props {
  state: ConnectionState;
  colors: { surface: string; textSecondary: string };
}

/** Brief drops (and the first connect) are not worth a banner. */
const SHOW_AFTER_MS = 2000;

/**
 * Slim strip under the chat header while the live connection is down.
 * Messages typed meanwhile stay queued ("Sending…") and go out on reconnect.
 */
export const ConnectionBanner = ({ state, colors }: Props) => {
  const offline = state !== 'open';
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!offline) {
      setVisible(false);
      return;
    }
    const t = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [offline]);

  if (!visible) return null;
  return (
    <View
      style={[styles.connectionBanner, { backgroundColor: colors.surface }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name="cloud-offline-outline" size={14} color={colors.textSecondary} />
      <Text style={[styles.connectionBannerText, { color: colors.textSecondary }]}>
        Reconnecting… messages will send when you're back online
      </Text>
    </View>
  );
};
