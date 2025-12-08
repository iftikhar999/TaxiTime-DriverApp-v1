import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { AxiosError } from 'axios';
import React, { useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import Toast from 'react-native-toast-message';
import FormTextInput from '../../components/design/FormTextInput';
import Typography from '../../components/design/Typography';
import PrimaryButton from '../../components/design/buttons/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { AuthStackParamList } from '../../navigation/RootNavigator';
import { Colors } from '../../theme/colors';

export type RegisterScreenProps = NativeStackScreenProps<AuthStackParamList, 'Register'>;

const RegisterScreen: React.FC<RegisterScreenProps> = ({ navigation }) => {
  const { register } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [companyCode, setCompanyCode] = useState('CITY001');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const validateForm = () => {
    if (!firstName.trim() || !lastName.trim()) {
      Toast.show({ type: 'info', text1: 'Missing name', text2: 'Please provide both first and last name.' });
      return false;
    }
    if (!email.trim()) {
      Toast.show({ type: 'info', text1: 'Missing email', text2: 'Please provide your email address.' });
      return false;
    }
    if (!phone.trim()) {
      Toast.show({ type: 'info', text1: 'Missing phone', text2: 'Please provide your phone number.' });
      return false;
    }
    if (!companyCode.trim()) {
      Toast.show({ type: 'info', text1: 'Company code', text2: 'Enter the company code shared by your fleet admin.' });
      return false;
    }
    if (!password || password.length < 6) {
      Toast.show({ type: 'info', text1: 'Weak password', text2: 'Password must be at least 6 characters.' });
      return false;
    }
    if (password !== confirmPassword) {
      Toast.show({ type: 'info', text1: 'Password mismatch', text2: 'Passwords do not match.' });
      return false;
    }
    return true;
  };

  const handleRegister = async () => {
    if (!validateForm()) return;
    try {
      setLoading(true);
      await register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
        companyCode: companyCode.trim(),
        licenseNumber: licenseNumber.trim() || undefined
      });
      Toast.show({ type: 'success', text1: 'Registration submitted', text2: 'Your request has been captured. Please wait for approval.' });
      navigation.navigate('Login');
    } catch (error: unknown) {
      console.error('Registration error', error);
      const message =
        (error as AxiosError<{ message?: string }>).response?.data?.message ||
        'Unable to register right now. Please try again or reach your fleet admin.';
      Toast.show({ type: 'error', text1: 'Registration failed', text2: message });
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
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backText}>&lt; Back</Text>
          </TouchableOpacity>
          <Typography variant="titleLarge" color={Colors.text.primary}>
            Request driver access
          </Typography>
          <Typography style={styles.subtitle}>
            Submit your details so the fleet manager can approve your access quickly.
          </Typography>
        </View>

        <View style={styles.form}>
          <FormTextInput
            label="First name"
            value={firstName}
            onChangeText={setFirstName}
            placeholder="Jane"
          />
          <FormTextInput
            label="Last name"
            value={lastName}
            onChangeText={setLastName}
            placeholder="Doe"
          />
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
            label="Phone number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="e.g. +974 5555 1234"
          />
          <FormTextInput
            label="Company code"
            value={companyCode}
            onChangeText={setCompanyCode}
            autoCapitalize="characters"
            placeholder="CITY001"
          />
          <FormTextInput
            label="License number"
            value={licenseNumber}
            onChangeText={setLicenseNumber}
            placeholder="Optional"
          />
          <FormTextInput
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Minimum 6 characters"
          />
          <FormTextInput
            label="Confirm password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            placeholder="Re-enter password"
          />

          <PrimaryButton label="Submit request" onPress={handleRegister} loading={loading} />
        </View>

        <TouchableOpacity style={styles.secondaryAction} onPress={() => navigation.navigate('Login')}>
          <Text style={styles.secondaryText}>Already have credentials? Sign in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.surface.default,
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
  backText: {
    color: Colors.primary[600],
    fontWeight: '600',
    marginBottom: 12
  },
  subtitle: {
    marginTop: 12,
    color: Colors.text.secondary
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
    marginTop: 24,
    alignItems: 'center'
  },
  secondaryText: {
    color: Colors.primary[600],
    fontWeight: '600'
  }
});

export default RegisterScreen;
