import React, { useState } from 'react';
import { AxiosError } from 'axios';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AuthStackParamList } from '../../navigation/RootNavigator';
import { Colors } from '../../theme/colors';
import Typography from '../../components/design/Typography';
import FormTextInput from '../../components/design/FormTextInput';
import PrimaryButton from '../../components/design/buttons/PrimaryButton';
import { DEFAULT_DRIVER_CREDENTIALS } from '../../config/environment';
import { useAuth } from '../../context/AuthContext';
import Toast from 'react-native-toast-message';
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
          <Typography variant="titleLarge" color={Colors.text.primary}>
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
    backgroundColor: Colors.surface.default
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
    backgroundColor: Colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16
  },
  logoText: {
    color: Colors.primary[700],
    fontSize: 24,
    fontWeight: '700'
  },
  subtitle: {
    marginTop: 12,
    color: Colors.text.secondary
  },
  credentialsCard: {
    marginTop: 20,
    backgroundColor: Colors.surface.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.divider
  },
  credentialsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text.secondary,
    marginBottom: 8
  },
  credentialsValue: {
    fontSize: 14,
    color: Colors.text.primary
  },
  form: {
    backgroundColor: Colors.surface.card,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.divider,
    shadowColor: '#0b1b3f',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6
  },
  secondaryAction: {
    marginTop: 20,
    alignItems: 'center'
  },
  secondaryText: {
    color: Colors.primary[600],
    fontWeight: '600'
  }
});

export default LoginScreen;
