import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AxiosError } from 'axios';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Toast from 'react-native-toast-message';
import FormTextInput from '../../components/design/FormTextInput';
import Typography from '../../components/design/Typography';
import PrimaryButton from '../../components/design/buttons/PrimaryButton';
import { DEFAULT_DRIVER_CREDENTIALS } from '../../config/environment';
import { useAuth } from '../../context/AuthContext';
import { AuthStackParamList } from '../../navigation/RootNavigator';
import { Colors } from '../../theme/colors';
import { requestAllPermissions } from '../../utils/permissions';

export type LoginScreenProps = NativeStackScreenProps<AuthStackParamList, 'Login'>;

const LoginScreen: React.FC<LoginScreenProps> = ({ navigation }) => {
  const { login } = useAuth();
  const [email, setEmail] = useState(DEFAULT_DRIVER_CREDENTIALS.email);
  const [password, setPassword] = useState(DEFAULT_DRIVER_CREDENTIALS.password);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    try {
      setLoading(true);
      const granted = await requestAllPermissions();
      if (!granted) {
        setLoading(false);
        return;
      }
      await login(email.trim(), password);
    } catch (error: unknown) {
      console.error('Login error', error);
      const message =
        (error as AxiosError<{ message?: string }>).response?.data?.message ||
        'Please check your credentials and try again.';
      Toast.show({
        type: 'error',
        text1: 'Login failed',
        text2: message
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.logoWrap}>
            <Text style={styles.logoText}>TT</Text>
          </View>
          <Typography variant="titleLarge" color={Colors.text.inverse}>
            Driver sign in
          </Typography>
          <Typography style={styles.subtitle}>
            Use your fleet credentials to access jobs, shift tools, and live earnings.
          </Typography>
          <View style={styles.credentialsCard}>
            <Text style={styles.credentialsTitle}>Quick start credentials</Text>
            <Text style={styles.credentialsValue}>{DEFAULT_DRIVER_CREDENTIALS.email}</Text>
            <Text style={styles.credentialsValue}>{DEFAULT_DRIVER_CREDENTIALS.password}</Text>
          </View>
        </View>

        <View style={styles.form}>
          <FormTextInput
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="driver@company.com"
            autoCorrect={false}
          />
          <FormTextInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Enter your password"
          />

          <PrimaryButton label="Sign in" onPress={handleLogin} loading={loading} />

          <TouchableOpacity
            style={styles.secondaryAction}
            onPress={() => navigation.navigate('Register')}
          >
            <Text style={styles.secondaryText}>Need access? Register for your fleet</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1118', // Black theme background
    paddingTop: 40
  },
  content: {
    padding: 24,
    flexGrow: 1,
    justifyContent: 'center'
  },
  header: {
    marginBottom: 32
  },
  logoWrap: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: '#2d3240', // Dark background for logo
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#3d4350'
  },
  logoText: {
    color: '#f5b400', // Highlight color
    fontSize: 24,
    fontWeight: '700'
  },
  subtitle: {
    marginTop: 12,
    color: '#a0aec0' // Bright secondary text
  },
  credentialsCard: {
    marginTop: 20,
    backgroundColor: '#1a1d26', // Dark elevated background
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2d3240' // Dark border
  },
  credentialsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#a0aec0', // Bright secondary text
    marginBottom: 8
  },
  credentialsValue: {
    fontSize: 14,
    color: '#ffffff' // White text
  },
  form: {
    backgroundColor: '#1a1d26', // Dark elevated background
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2d3240', // Dark border
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 6
  },
  secondaryAction: {
    marginTop: 20,
    alignItems: 'center'
  },
  secondaryText: {
    color: '#f5b400', // Highlight color
    fontWeight: '600'
  }
});

export default LoginScreen;
