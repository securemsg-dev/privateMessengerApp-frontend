/**
 * i18n/index.ts
 * ──────────────
 * App-wide i18next instance (English + Simplified Chinese).
 * The real language is applied asynchronously by loadSettingsThunk from the
 * persisted preference; 'en' here is just the pre-hydration default.
 * Import for side effects once in App.tsx before any screen renders.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import zh from './locales/zh.json';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
