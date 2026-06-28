import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View, ViewStyle } from 'react-native';

import { downloadAvatar } from '../services/media';
import { useTheme } from '../theme/ThemeContext';

const getInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '#';

interface Props {
  /** The user's profile_picture_key (media blob id); null/undefined → initials. */
  profilePictureKey?: string | null;
  name: string;
  size?: number;
  /** Extra style merged onto the image/fallback (e.g. margins). */
  style?: ViewStyle;
}

/**
 * Shows a user's profile picture, falling back to their initials when they
 * have none (or the image can't be fetched). The picture is downloaded once
 * to a cached file and rendered from there (see downloadAvatar).
 */
export const Avatar = ({ profilePictureKey, name, size = 44, style }: Props) => {
  const { colors } = useTheme();
  const [fileUri, setFileUri] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setFileUri(null);
    if (profilePictureKey) {
      downloadAvatar(profilePictureKey)
        .then((uri) => active && setFileUri(uri))
        .catch(() => active && setFileUri(null));
    }
    return () => {
      active = false;
    };
  }, [profilePictureKey]);

  const dim = { width: size, height: size, borderRadius: size / 2 };

  if (fileUri) {
    return (
      <Image
        source={{ uri: fileUri }}
        style={[dim, { backgroundColor: colors.surface }, style as object]}
      />
    );
  }

  return (
    <View
      style={[
        dim,
        styles.fallback,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      <Text style={[styles.text, { color: colors.textSecondary, fontSize: size * 0.4 }]}>
        {getInitials(name)}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  text: { fontWeight: '700' },
});
