import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export interface JobChange {
  field: string;
  oldValue: string;
  newValue: string;
}

interface JobUpdatedModalProps {
  visible: boolean;
  changes: JobChange[];
  onDismiss: () => void;
}

const FIELD_ICONS: Record<string, string> = {
  'Pickup Location': 'map-marker',
  'Drop-off Location': 'map-marker-check',
  'Payment Method': 'credit-card-outline',
  'Vehicle Type': 'car-side',
  'Passenger Name': 'account-outline',
  'Passenger Phone': 'phone-outline',
  'Instructions': 'text-box-outline',
  'Notes': 'note-text-outline',
  'Estimated Fare': 'cash',
  'Schedule': 'clock-outline',
};

const FIELD_COLORS: Record<string, string> = {
  'Pickup Location': '#10B981',
  'Drop-off Location': '#3B82F6',
  'Payment Method': '#F59E0B',
  'Vehicle Type': '#8B5CF6',
  'Passenger Name': '#EC4899',
  'Passenger Phone': '#06B6D4',
  'Instructions': '#6366F1',
  'Notes': '#78716C',
  'Estimated Fare': '#22C55E',
  'Schedule': '#F97316',
};

const JobUpdatedModal: React.FC<JobUpdatedModalProps> = ({
  visible,
  changes,
  onDismiss,
}) => {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const iconBounce = useRef(new Animated.Value(0)).current;
  const itemAnims = useRef<Animated.Value[]>([]).current;

  // Ensure enough animated values for each change
  while (itemAnims.length < changes.length) {
    itemAnims.push(new Animated.Value(0));
  }

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0.3);
      opacityAnim.setValue(0);
      iconBounce.setValue(0);
      itemAnims.forEach((a) => a.setValue(0));

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
      ]).start();

      // Stagger animate each change item
      const itemAnimations = itemAnims.slice(0, changes.length).map((anim, index) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 300,
          delay: 350 + index * 100,
          useNativeDriver: true,
        })
      );
      Animated.stagger(80, itemAnimations).start();
    }
  }, [visible, changes.length]);

  const handleDismiss = () => {
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

  const formatValue = (field: string, value: string): string => {
    if (!value || value === 'null' || value === 'undefined') return 'Not set';
    if (field === 'Payment Method') {
      const map: Record<string, string> = {
        CASH: 'Cash',
        CARD: 'Card',
        WALLET: 'Wallet',
        DIGITAL_WALLET: 'Digital Wallet',
        BANK_TRANSFER: 'Bank Transfer',
        NAPS: 'NAPS',
        EPOS: 'ePOS',
      };
      return map[value.toUpperCase()] || value;
    }
    if (field === 'Estimated Fare') {
      const num = parseFloat(value);
      return isNaN(num) ? value : `$${num.toFixed(2)}`;
    }
    if (field === 'Vehicle Type') {
      return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
    }
    return value;
  };

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
          {/* Top accent bar - blue gradient stripe */}
          <View style={styles.accentBar} />

          {/* Icon */}
          <View style={styles.iconSection}>
            <Animated.View
              style={[
                styles.iconCircle,
                { transform: [{ scale: iconScale }] },
              ]}
            >
              <Icon name="pencil-box-outline" size={30} color="#fff" />
            </Animated.View>
          </View>

          {/* Header */}
          <Text style={styles.title}>Job Updated</Text>
          <Text style={styles.subtitle}>
            {changes.length === 1
              ? 'A detail has been changed by dispatch'
              : `${changes.length} details have been changed by dispatch`}
          </Text>

          {/* Changes list */}
          <ScrollView
            style={styles.changesList}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {changes.map((change, index) => {
              const fieldIcon = FIELD_ICONS[change.field] || 'information-outline';
              const fieldColor = FIELD_COLORS[change.field] || '#6366F1';
              const anim = itemAnims[index] || new Animated.Value(1);

              const translateY = anim.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              });

              return (
                <Animated.View
                  key={`${change.field}-${index}`}
                  style={[
                    styles.changeItem,
                    {
                      opacity: anim,
                      transform: [{ translateY }],
                    },
                  ]}
                >
                  {/* Field header with icon */}
                  <View style={styles.changeHeader}>
                    <View style={[styles.fieldIconBg, { backgroundColor: fieldColor + '18' }]}>
                      <Icon name={fieldIcon} size={16} color={fieldColor} />
                    </View>
                    <Text style={[styles.fieldName, { color: fieldColor }]}>
                      {change.field}
                    </Text>
                  </View>

                  {/* Old value - crossed out */}
                  <View style={styles.valueRow}>
                    <View style={[styles.valueBadge, styles.oldBadge]}>
                      <Icon name="minus-circle" size={12} color="#EF4444" />
                      <Text style={styles.oldValue} numberOfLines={2}>
                        {formatValue(change.field, change.oldValue)}
                      </Text>
                    </View>
                  </View>

                  {/* Arrow */}
                  <View style={styles.arrowRow}>
                    <Icon name="arrow-down" size={14} color="#94A3B8" />
                  </View>

                  {/* New value - highlighted */}
                  <View style={styles.valueRow}>
                    <View style={[styles.valueBadge, styles.newBadge]}>
                      <Icon name="plus-circle" size={12} color="#10B981" />
                      <Text style={styles.newValue} numberOfLines={2}>
                        {formatValue(change.field, change.newValue)}
                      </Text>
                    </View>
                  </View>
                </Animated.View>
              );
            })}
          </ScrollView>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Button */}
          <TouchableOpacity
            style={styles.button}
            onPress={handleDismiss}
            activeOpacity={0.85}
          >
            <Icon name="check" size={18} color="#fff" style={{ marginRight: 6 }} />
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
    paddingHorizontal: 24,
  },
  card: {
    width: SCREEN_WIDTH - 48,
    maxWidth: 380,
    maxHeight: '80%',
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
    backgroundColor: '#3B82F6',
  },
  iconSection: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1E293B',
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: 0.3,
  },
  subtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
    paddingHorizontal: 24,
  },
  changesList: {
    maxHeight: 320,
    paddingHorizontal: 16,
  },
  changeItem: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  changeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  fieldIconBg: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  fieldName: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  valueRow: {
    paddingLeft: 4,
  },
  valueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    gap: 6,
  },
  oldBadge: {
    backgroundColor: '#FEF2F2',
  },
  newBadge: {
    backgroundColor: '#F0FDF4',
  },
  oldValue: {
    fontSize: 13,
    color: '#991B1B',
    textDecorationLine: 'line-through',
    flex: 1,
  },
  arrowRow: {
    paddingLeft: 12,
    paddingVertical: 2,
  },
  newValue: {
    fontSize: 13,
    color: '#166534',
    fontWeight: '600',
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginHorizontal: 16,
    marginTop: 6,
  },
  button: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginVertical: 14,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#3B82F6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});

export default JobUpdatedModal;
