import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { ChatListScreen } from '../screens/Main/ChatListScreen';
import { CallsScreen } from '../screens/Main/CallsScreen';
import { ContactListScreen } from '../screens/Main/ContactListScreen';
import { SettingsScreen } from '../screens/Main/SettingsScreen';

type TabKey = 'Chats' | 'Calls' | 'Contacts' | 'Settings';

interface Tab {
  key: TabKey;
  label: string;
  icon: string;
  activeIcon: string;
}

const TABS: Tab[] = [
  { key: 'Chats', label: 'Chats', icon: 'chatbubble-outline', activeIcon: 'chatbubble' },
  { key: 'Calls', label: 'Calls', icon: 'call-outline', activeIcon: 'call' },
  { key: 'Contacts', label: 'Contacts', icon: 'people-outline', activeIcon: 'people' },
  { key: 'Settings', label: 'You', icon: 'person-circle-outline', activeIcon: 'person-circle' },
];

export const MainTabsScreen = () => {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<TabKey>('Chats');

  const renderScreen = () => {
    switch (activeTab) {
      case 'Chats':    return <ChatListScreen />;
      case 'Calls':    return <CallsScreen />;
      case 'Contacts': return <ContactListScreen />;
      case 'Settings': return <SettingsScreen />;
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1 }}>{renderScreen()}</View>

      {/* Custom bottom tab bar */}
      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
        ]}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tabItem}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={(isActive ? tab.activeIcon : tab.icon) as any}
                size={24}
                color={isActive ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.tabLabel,
                  { color: isActive ? colors.primary : colors.textSecondary },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    paddingBottom: Platform.OS === 'ios' ? 28 : 8,
    paddingTop: 8,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
});
