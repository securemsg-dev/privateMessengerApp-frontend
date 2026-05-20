/**
 * secureStorage.ts
 *
 * Platform-aware secure storage wrapper.
 *   - Native (iOS / Android): expo-secure-store (hardware-backed Keychain / Keystore)
 *   - Web: localStorage (no hardware security, but lets the app run in a browser for dev/testing)
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export async function getItemAsync(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
    return;
  }
  return SecureStore.setItemAsync(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
    return;
  }
  return SecureStore.deleteItemAsync(key);
}
