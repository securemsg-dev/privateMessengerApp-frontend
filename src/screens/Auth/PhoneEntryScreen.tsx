import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, SafeAreaView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeContext';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';

export const PhoneEntryScreen = () => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [error, setError] = useState('');
  const navigation = useNavigation<any>();
  const { colors } = useTheme();

  const handleNext = () => {
    if (phoneNumber.length < 8) {
      setError('Please enter a valid phone number');
      return;
    }
    setError('');
    // In a real app, we'd trigger the OTP send API here
    navigation.navigate('OTPVerification', { phoneNumber });
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView 
        style={styles.container} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Text style={[styles.title, { color: colors.text }]}>Enter your phone number</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Zangi will send you an SMS message to verify your phone number.
        </Text>
        
        <Input 
          label="Phone Number"
          placeholder="+1 234 567 8900"
          keyboardType="phone-pad"
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          error={error}
          autoFocus
        />

        <View style={styles.buttonContainer}>
          <Button 
            title="Next" 
            onPress={handleNext} 
            disabled={phoneNumber.length === 0}
            style={{ width: '100%' }}
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
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  buttonContainer: {
    marginTop: 24,
  }
});
