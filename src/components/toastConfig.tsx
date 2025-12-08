import React from 'react';
import { BaseToast, ErrorToast, ToastConfig } from 'react-native-toast-message';
import { Colors } from '../theme/colors';

const baseText1Style = {
  fontSize: 15,
  fontWeight: '600' as const,
};

const baseText2Style = {
  fontSize: 13,
  color: Colors.text.secondary,
};

export const toastConfig: ToastConfig = {
  success: (props) => (
    <BaseToast
      {...props}
      style={{ borderLeftColor: Colors.success }}
      text1Style={baseText1Style}
      text2Style={baseText2Style}
    />
  ),
  error: (props) => (
    <ErrorToast
      {...props}
      style={{ borderLeftColor: Colors.danger }}
      text1Style={baseText1Style}
      text2Style={baseText2Style}
    />
  ),
  info: (props) => (
    <BaseToast
      {...props}
      style={{ borderLeftColor: Colors.primary[500] }}
      text1Style={baseText1Style}
      text2Style={baseText2Style}
    />
  ),
  warning: (props) => (
    <BaseToast
      {...props}
      style={{ borderLeftColor: Colors.warning }}
      text1Style={baseText1Style}
      text2Style={baseText2Style}
    />
  ),
};

