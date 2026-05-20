import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeContext';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';

export const ProfileSetupScreen = () => {
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const { colors } = useTheme();
  const navigation = useNavigation<any>();

  const handleSave = async () => {
    if (!displayName.trim()) return;
    setLoading(true);
    // Mock save profile
    await new Promise(resolve => setTimeout(resolve, 800));
    setLoading(false);
    navigation.replace('Contacts');
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
        <Text style={[styles.title, { color: colors.text }]}>Profile Info</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Please provide your name and an optional profile photo.
        </Text>
        
        <TouchableOpacity style={[styles.avatarPlaceholder, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={{ color: colors.primary, fontSize: 32 }}>+</Text>
        </TouchableOpacity>

        <Input 
          label="Display Name"
          placeholder="Type your name..."
          value={displayName}
          onChangeText={setDisplayName}
        />

        <View style={styles.buttonContainer}>
          <Button 
            title="Save Profile" 
            onPress={handleSave} 
            loading={loading}
            disabled={!displayName.trim()}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  buttonContainer: {
    marginTop: 24,
    width: '100%'
  }
});
