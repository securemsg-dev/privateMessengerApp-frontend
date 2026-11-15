import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import { MainTabsScreen } from './MainTabsScreen';
import { ProfileScreen } from '../screens/Main/ProfileScreen';
import { StartChatScreen } from '../screens/Main/StartChatScreen';
import { ChatScreen } from '../screens/Main/ChatScreen';
import { CreateGroupScreen } from '../screens/Main/CreateGroupScreen';
import { GroupInfoScreen } from '../screens/Main/GroupInfoScreen';
import { ChangePasswordScreen } from '../screens/Main/ChangePasswordScreen';
import { BlockedUsersScreen } from '../screens/Main/BlockedUsersScreen';
import { ContactInfoScreen } from '../screens/Main/ContactInfoScreen';
import { SharedMediaScreen } from '../screens/Main/SharedMediaScreen';

export type MainStackParamList = {
  MainTabs: undefined;
  Profile: undefined;
  ChangePassword: undefined;
  StartChat: undefined;
  /** With addToConversationId: add contacts to an existing group. */
  CreateGroup: { addToConversationId?: string } | undefined;
  GroupInfo: { conversationId: string };
  BlockedUsers: undefined;
  /** One-to-one contact details (opened from the chat header). */
  ContactInfo: { conversationId: string; contactName: string; contactPrivateNumber: string };
  /** Photos, videos, files, voice and links shared in a chat. */
  SharedMedia: { conversationId: string; title: string };
  ChatScreen: {
    conversationId: string;
    contactName: string;
    contactPrivateNumber: string;
    isSelfChat?: boolean;
    contactPublicKey?: string | null;
    isGroup?: boolean;
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
      <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
      <Stack.Screen name="StartChat" component={StartChatScreen} />
      <Stack.Screen name="CreateGroup" component={CreateGroupScreen} />
      <Stack.Screen name="GroupInfo" component={GroupInfoScreen} />
      <Stack.Screen name="ChatScreen" component={ChatScreen} />
      <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
      <Stack.Screen name="ContactInfo" component={ContactInfoScreen} />
      <Stack.Screen name="SharedMedia" component={SharedMediaScreen} />
    </Stack.Navigator>
  );
};
