import { configureStore } from '@reduxjs/toolkit';
import authReducer, { forceLogout } from './slices/authSlice';
import chatReducer from './slices/chatSlice';
import { setOnUnauthorized } from '../services/api';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    chat: chatReducer,
  },
});

setOnUnauthorized(() => store.dispatch(forceLogout()));

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
