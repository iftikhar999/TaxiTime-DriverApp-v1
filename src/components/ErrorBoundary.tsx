/**
 * Error Boundary Component
 * 
 * Catches React errors and prevents full app crash
 * Maintains driver session and shift state even when errors occur
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

interface Props {
  children: ReactNode;
  fallbackComponent?: (error: Error, resetError: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log the error to console
    console.error('❌ ErrorBoundary caught an error:', error);
    console.error('❌ Error Info:', errorInfo);
    
    // TODO: Send error to logging service (e.g., Sentry, LogRocket)
    // errorLogger.logError(error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided
      if (this.props.fallbackComponent) {
        return this.props.fallbackComponent(this.state.error, this.resetError);
      }

      // Default fallback UI
      return (
        <SafeAreaView style={styles.container}>
          <View style={styles.content}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={64}
              color="#ef4444"
              style={styles.icon}
            />
            
            <Text style={styles.title}>Oops! Something went wrong</Text>
            
            <Text style={styles.message}>
              Don't worry, your shift is still active and your data is safe.
            </Text>
            
            <Text style={styles.errorDetails}>
              {this.state.error.message}
            </Text>
            
            <TouchableOpacity
              style={styles.button}
              onPress={this.resetError}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name="refresh"
                size={20}
                color="#fff"
                style={styles.buttonIcon}
              />
              <Text style={styles.buttonText}>Try Again</Text>
            </TouchableOpacity>
            
            <Text style={styles.hint}>
              If the problem persists, please restart the app.
            </Text>
          </View>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  icon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
    textAlign: 'center',
    marginBottom: 12,
  },
  message: {
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 16,
  },
  errorDetails: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 32,
    paddingHorizontal: 16,
    fontFamily: 'monospace',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3b82f6',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  buttonIcon: {
    marginRight: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  hint: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    marginTop: 24,
  },
});

export default ErrorBoundary;

