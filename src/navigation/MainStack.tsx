import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import { MainTabsScreen } from './MainTabsScreen';
import { ProfileScreen } from '../screens/Main/ProfileScreen';
import { StartChatScreen } from '../screens/Main/StartChatScreen';
import { ChatScreen } from '../screens/Main/ChatScreen';
import { CreateGroupScreen } from '../screens/Main/CreateGroupScreen';

export type MainStackParamList = {
  MainTabs: undefined;
  Profile: undefined;
  StartChat: undefined;
  CreateGroup: undefined;
  ChatScreen: {
    conversationId: string;
    contactName: string;
    contactPrivateNumber: string;
    isSelfChat?: boolean;
  };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export const MainStack = () => {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="MainTabs" component={MainTabsScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="StartChat" component={StartChatScreen} />
      <Stack.Screen name="CreateGroup" component={CreateGroupScreen} />
      <Stack.Screen name="ChatScreen" component={ChatScreen} />
    </Stack.Navigator>
  );
};
