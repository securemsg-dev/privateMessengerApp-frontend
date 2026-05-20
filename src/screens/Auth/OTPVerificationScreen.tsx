import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, SafeAreaView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useDispatch } from 'react-redux';
import { setAuth } from '../../store/slices/authSlice';
import * as SecureStore from '../../utils/secureStorage';
import { useTheme } from '../../theme/ThemeContext';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';

export const OTPVerificationScreen = () => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const navigation = useNavigation();
  const route = useRoute<any>();
  const dispatch = useDispatch();
  const { colors } = useTheme();

  const phoneNumber = route.params?.phoneNumber || 'Unknown';

  const handleVerify = async () => {
    if (code.length < 4) {
      setError('Please enter the full code');
      return;
    }
    
    setLoading(true);
    setError('');

    try {
      // Mock API delay and auth response
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const mockToken = 'mock_jwt_token_123';
      
      // Securely store the token
      await SecureStore.setItemAsync('userToken', mockToken);
      
      // Update global state, triggers RootNavigator to show MainStack
      dispatch(setAuth({ 
        token: mockToken, 
        phone: phoneNumber, 
        userId: 'user-1' 
      }));
      
    } catch (e) {
      setError('Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView 
        style={styles.container} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Text style={[styles.title, { color: colors.text }]}>Verify your number</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Enter the code we sent to {phoneNumber}
        </Text>
        
        <Input 
          label="Verification Code"
          placeholder="- - - -"
          keyboardType="number-pad"
          value={code}
          onChangeText={setCode}
          error={error}
          maxLength={6}
          autoFocus
          style={{ textAlign: 'center', fontSize: 24, letterSpacing: 4 }}
        />

        <View style={styles.buttonContainer}>
          <Button 
            title="Verify Code" 
            onPress={handleVerify} 
            loading={loading}
            disabled={code.length === 0}
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
