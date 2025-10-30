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
    color: Colors.text.secondary,
    marginBottom: 6
  },
  input: {
    backgroundColor: Colors.surface.card,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: Colors.divider,
    color: Colors.text.primary
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
