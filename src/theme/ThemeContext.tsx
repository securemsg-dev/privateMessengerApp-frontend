import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { lightColors, darkColors, ThemeColors } from './colors';
import * as SecureStore from '../utils/secureStorage';

/** 'system' follows the phone's light/dark setting. */
export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_PREF_KEY = 'pref_theme';

interface ThemeContextType {
  isDark: boolean;
  colors: ThemeColors;
  /** The user's choice (Settings › Appearance). */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Flip between light and dark (turns "system" off). */
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  isDark: false,
  colors: lightColors,
  mode: 'system',
  setMode: () => {},
  toggleTheme: () => {},
});

const isMode = (v: unknown): v is ThemeMode => v === 'system' || v === 'light' || v === 'dark';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemColorScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Restore the saved choice (per device). Until it loads we follow the system.
  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(THEME_PREF_KEY)
      .then((saved) => {
        if (active && isMode(saved)) setModeState(saved);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    SecureStore.setItemAsync(THEME_PREF_KEY, next).catch(() => {});
  }, []);

  const isDark = mode === 'system' ? systemColorScheme === 'dark' : mode === 'dark';

  const value = useMemo<ThemeContextType>(
    () => ({
      isDark,
      colors: isDark ? darkColors : lightColors,
      mode,
      setMode,
      toggleTheme: () => setMode(isDark ? 'light' : 'dark'),
    }),
    [isDark, mode, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
