import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface JobRecalledModalProps {
  visible: boolean;
  title?: string;
  message?: string;
  type?: 'recalled' | 'cancelled' | 'taken';
  onDismiss: () => void;
}

const THEME = {
  recalled: {
    icon: 'arrow-u-left-top',
    gradient: ['#FF6B35', '#F7931E'],
    color: '#FF6B35',
    bgColor: '#FFF3EC',
    iconBg: '#FF6B35',
  },
  cancelled: {
    icon: 'close-circle-outline',
    gradient: ['#EF4444', '#DC2626'],
    color: '#EF4444',
    bgColor: '#FEF2F2',
    iconBg: '#EF4444',
  },
  taken: {
    icon: 'account-switch-outline',
    gradient: ['#8B5CF6', '#7C3AED'],
    color: '#8B5CF6',
    bgColor: '#F5F3FF',
    iconBg: '#8B5CF6',
  },
};

const JobRecalledModal: React.FC<JobRecalledModalProps> = ({
  visible,
  title = 'Job Recalled',
  message = 'This job has been taken back by dispatch.',
  type = 'recalled',
  onDismiss,
}) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const iconBounce = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  const theme = THEME[type];

  useEffect(() => {
    if (visible) {
      // Reset animations
      scaleAnim.setValue(0.3);
      opacityAnim.setValue(0);
      iconBounce.setValue(0);
      slideAnim.setValue(30);

      // Entrance animation sequence
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 6,
          tension: 100,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.spring(iconBounce, {
          toValue: 1,
          friction: 4,
          tension: 120,
          delay: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 400,
          delay: 150,
          useNativeDriver: true,
        }),
      ]).start();

      // Pulse animation loop for the ring
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.15,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();

      return () => pulse.stop();
    }
  }, [visible]);

  const handleDismiss = () => {
    // Exit animation
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.3,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  };

  const iconScale = iconBounce.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <Animated.View style={[styles.overlay, { opacity: opacityAnim }]}>
        <Animated.View
          style={[
            styles.card,
            {
              transform: [{ scale: scaleAnim }],
              opacity: opacityAnim,
            },
          ]}
        >
          {/* Top accent bar */}
          <View style={[styles.accentBar, { backgroundColor: theme.color }]} />

          {/* Icon container with pulse ring */}
          <View style={styles.iconSection}>
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  borderColor: theme.color + '30',
                  transform: [{ scale: pulseAnim }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.iconCircle,
                {
                  backgroundColor: theme.iconBg,
                  transform: [{ scale: iconScale }],
                },
              ]}
            >
              <Icon name={theme.icon} size={32} color="#fff" />
            </Animated.View>
          </View>

          {/* Content */}
          <Animated.View
            style={[
              styles.content,
              { transform: [{ translateY: slideAnim }] },
            ]}
          >
            <Text style={[styles.title, { color: theme.color }]}>{title}</Text>
            <Text style={styles.message}>{message}</Text>
          </Animated.View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Button */}
          <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.color }]}
            onPress={handleDismiss}
            activeOpacity={0.85}
          >
            <Text style={styles.buttonText}>Got it</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: SCREEN_WIDTH - 64,
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 24,
  },
  accentBar: {
    height: 4,
    width: '100%',
  },
  iconSection: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
    marginBottom: 4,
    height: 80,
  },
  pulseRing: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  message: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 21,
    letterSpacing: 0.1,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginHorizontal: 20,
  },
  button: {
    marginHorizontal: 20,
    marginVertical: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});

export default JobRecalledModal;
