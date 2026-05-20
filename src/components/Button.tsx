import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  variant?: 'primary' | 'secondary' | 'outline';
}

export const Button: React.FC<ButtonProps> = ({ 
  title, 
  onPress, 
  loading = false, 
  disabled = false,
  style,
  textStyle,
  variant = 'primary'
}) => {
  const { colors } = useTheme();

  let backgroundColor = colors.primary;
  let textColor = colors.background;
  let borderColor = 'transparent';

  if (variant === 'secondary') {
    backgroundColor = colors.surface;
    textColor = colors.text;
  } else if (variant === 'outline') {
    backgroundColor = 'transparent';
    textColor = colors.primary;
    borderColor = colors.primary;
  }

  if (disabled) {
    backgroundColor = colors.border;
    textColor = colors.textSecondary;
    borderColor = 'transparent';
  }

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        styles.button,
        { backgroundColor, borderColor, borderWidth: variant === 'outline' ? 1 : 0 },
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text style={[styles.text, { color: textColor }, textStyle]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
    marginVertical: 8,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
  },
});
