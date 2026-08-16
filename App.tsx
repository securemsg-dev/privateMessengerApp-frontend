import React, { useEffect } from 'react';
// Initialize i18next before any screen renders (side-effect import).
import './src/i18n';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { Provider } from 'react-redux';
import { store } from './src/store';
import { ThemeProvider } from './src/theme/ThemeContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { StatusBar } from 'expo-status-bar';
import { initDB } from './src/services/database';
import { CallProvider } from './src/components/CallProvider';

export default function App() {
  useEffect(() => {
    initDB();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/*
       * SafeAreaProvider must sit above everything: react-native-safe-area-context's
       * SafeAreaView reads its insets from the nearest provider and silently applies
       * zero padding when there is none. Without this, only screens rendered inside
       * React Navigation (which ships its own provider) were safe-area aware.
       */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <Provider store={store}>
          <ThemeProvider>
            <CallProvider>
              <RootNavigator />
            </CallProvider>
            <StatusBar style="auto" />
          </ThemeProvider>
        </Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
