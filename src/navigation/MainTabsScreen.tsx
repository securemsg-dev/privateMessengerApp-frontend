import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeContext';
import { selectTotalUnread } from '../store/slices/chatSlice';
import { ChatListScreen } from '../screens/Main/ChatListScreen';
import { CallsScreen } from '../screens/Main/CallsScreen';
import { ContactListScreen } from '../screens/Main/ContactListScreen';
import { SettingsScreen } from '../screens/Main/SettingsScreen';

type TabKey = 'Chats' | 'Calls' | 'Contacts' | 'Settings';

interface Tab {
  key: TabKey;
  /** i18n key — resolved with t() at render time so labels switch language live. */
  labelKey: string;
  icon: string;
  activeIcon: string;
}

const TABS: Tab[] = [
  { key: 'Chats', labelKey: 'tabs.chats', icon: 'chatbubble-outline', activeIcon: 'chatbubble' },
  { key: 'Calls', labelKey: 'tabs.calls', icon: 'call-outline', activeIcon: 'call' },
  { key: 'Contacts', labelKey: 'tabs.contacts', icon: 'people-outline', activeIcon: 'people' },
  { key: 'Settings', labelKey: 'tabs.you', icon: 'person-circle-outline', activeIcon: 'person-circle' },
];

export const MainTabsScreen = () => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<TabKey>('Chats');
  const totalUnread = useSelector(selectTotalUnread);

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

      {/* Custom bottom tab bar. Reserve the bottom safe-area inset so the
          Android system nav bar (edge-to-edge draws behind us) sits below the
          tab row instead of overlapping the icons. */}
      <View
        style={[
          styles.tabBar,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const badge = tab.key === 'Chats' ? totalUnread : 0;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.tabItem}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.7}
            >
              <View>
                <Ionicons
                  name={(isActive ? tab.activeIcon : tab.icon) as any}
                  size={24}
                  color={isActive ? colors.primary : colors.textSecondary}
                />
                {badge > 0 && (
                  <View style={[styles.badge, { backgroundColor: colors.danger, borderColor: colors.surface }]}>
                    <Text style={styles.badgeText} numberOfLines={1}>
                      {badge > 99 ? '99+' : badge}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.tabLabel,
                  { color: isActive ? colors.primary : colors.textSecondary },
                ]}
              >
                {t(tab.labelKey)}
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
    paddingTop: 8,
    // paddingBottom is applied inline from the safe-area inset (see above).
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
  badge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
});
