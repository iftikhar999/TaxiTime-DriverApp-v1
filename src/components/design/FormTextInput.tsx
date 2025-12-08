import React from 'react';
import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { Colors } from '../../theme/colors';

interface FormTextInputProps extends TextInputProps {
  label: string;
  error?: string;
}

const FormTextInput: React.FC<FormTextInputProps> = ({ label, error, style, ...textInputProps }) => {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, error ? styles.inputError : null, style]}
        placeholderTextColor={Colors.text.muted}
        {...textInputProps}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16
  },
  label: {
    fontSize: 14,
    color: '#a0aec0', // Bright secondary text for dark theme
    marginBottom: 6
  },
  input: {
    backgroundColor: '#0f1118', // Black background
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#2d3240', // Dark border
    color: '#ffffff' // White text
  },
  inputError: {
    borderColor: Colors.danger
  },
  error: {
    marginTop: 4,
    color: Colors.danger,
    fontSize: 13
  }
});

export default FormTextInput;
