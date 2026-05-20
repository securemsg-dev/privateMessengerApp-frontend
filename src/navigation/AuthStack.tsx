import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import { WelcomeScreen } from '../screens/Auth/WelcomeScreen';
import { SetPasswordScreen } from '../screens/Auth/SetPasswordScreen';
import { PrivateNumberRevealScreen } from '../screens/Auth/PrivateNumberRevealScreen';
import { LoginScreen } from '../screens/Auth/LoginScreen';

const Stack = createNativeStackNavigator();

export const AuthStack = () => {
  const { colors } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="SetPassword" component={SetPasswordScreen} />
      <Stack.Screen name="PrivateNumberReveal" component={PrivateNumberRevealScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
};
