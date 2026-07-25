/**
 * Driver Profile Screen.
 *
 * Shows the authenticated driver's identity, contact info, assigned vehicle +
 * tariff, company, and rating. Also exposes quick links to the Documents
 * screen and a Logout button so the whole account flow is reachable without
 * digging through the home-screen drawer.
 *
 * Previously the drawer's "Driver Profiles" row had no route — tapping it
 * closed the drawer and did nothing. This screen fills that gap.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useAuth } from '../../context/AuthContext';
import { useShift } from '../../context/ShiftContext';
import { fetchDriverProfile } from '../../services/driverService';
import { Colors } from '../../theme/colors';

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
};

const ProfileScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { driver, logout } = useAuth();
  const { selectedVehicle, selectedTariff, activeShift } = useShift();

  const [refreshing, setRefreshing] = useState(false);
  const [serverProfile, setServerProfile] = useState<any>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const profile = await fetchDriverProfile();
      setServerProfile(profile);
    } catch (err) {
      console.warn('[Profile] refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const onLogout = () => {
    Alert.alert('Log out?', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => logout() },
    ]);
  };

  // Use server data when we have it, fall back to whatever the auth context
  // loaded on login. Either is better than rendering placeholders.
  const combined = { ...(driver || {}), ...(serverProfile || {}) };
  const displayName =
    [combined.firstName, combined.lastName].filter(Boolean).join(' ').trim() ||
    combined.email ||
    'Driver';

  return (
    <SafeAreaView style={styles.container} edges={['top','bottom','left','right']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
          <MCIcon name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={Colors.accent.highlight}
          />
        }>
        {/* Identity card */}
        <View style={styles.card}>
          <View style={styles.avatar}>
            <MCIcon name="account-circle" size={72} color="#f5b400" />
          </View>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.email}>{combined.email || '—'}</Text>
          {combined.phone ? (
            <Text style={styles.phone}>{combined.phone}</Text>
          ) : null}

          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <MCIcon name="account-check" size={12} color="#22c55e" />
              <Text style={styles.badgeText}>
                {combined.isActive ? 'Active' : 'Inactive'}
              </Text>
            </View>
            {combined.isVerified ? (
              <View style={[styles.badge, { backgroundColor: 'rgba(59,130,246,0.12)' }]}>
                <MCIcon name="shield-check" size={12} color="#3b82f6" />
                <Text style={[styles.badgeText, { color: '#3b82f6' }]}>Verified</Text>
              </View>
            ) : null}
            {combined.rating?.average ? (
              <View style={[styles.badge, { backgroundColor: 'rgba(245,180,0,0.15)' }]}>
                <MCIcon name="star" size={12} color="#f5b400" />
                <Text style={[styles.badgeText, { color: '#f5b400' }]}>
                  {Number(combined.rating.average).toFixed(1)} ({combined.rating.count ?? 0})
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* Fleet assignment */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Fleet</Text>
          <Row
            icon="domain"
            label="Company"
            value={combined.company?.name || combined.companyName || '—'}
          />
          <Row
            icon="car"
            label="Vehicle"
            value={
              selectedVehicle
                ? `${selectedVehicle.make || ''} ${selectedVehicle.model || ''} (${selectedVehicle.licensePlate || '—'})`.trim()
                : 'Not selected'
            }
          />
          <Row
            icon="cash-multiple"
            label="Tariff"
            value={selectedTariff?.name || 'Not selected'}
          />
          <Row
            icon="clock-outline"
            label="Shift"
            value={activeShift ? 'On shift — ONLINE' : 'Off shift'}
          />
        </View>

        {/* Documents shortcut */}
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Documents')}>
          <View style={styles.rowHeader}>
            <MCIcon name="file-document-outline" size={22} color="#f5b400" />
            <Text style={styles.sectionTitle}>Documents</Text>
            <MCIcon name="chevron-right" size={22} color="#7b7f8d" />
          </View>
          <Text style={styles.helpText}>
            View and update driver license, insurance, and vehicle registration.
            Expired documents may block shift-start.
          </Text>
          {combined.licenseExpiry ? (
            <Row icon="card-account-details" label="License expires" value={fmtDate(combined.licenseExpiry)} />
          ) : null}
          {combined.insuranceExpiryDate ? (
            <Row icon="shield-check" label="Insurance expires" value={fmtDate(combined.insuranceExpiryDate)} />
          ) : null}
        </TouchableOpacity>

        {/* Account actions */}
        <TouchableOpacity
          style={[styles.card, styles.logoutCard]}
          activeOpacity={0.85}
          onPress={onLogout}>
          <MCIcon name="logout" size={22} color="#ef4444" />
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const Row: React.FC<{ icon: string; label: string; value: string }> = ({
  icon,
  label,
  value,
}) => (
  <View style={styles.kvRow}>
    <MCIcon name={icon as any} size={18} color={Colors.accent.highlight} />
    <Text style={styles.kvLabel}>{label}</Text>
    <Text style={styles.kvValue} numberOfLines={1}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background.base },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  scrollContent: { padding: 16, paddingBottom: 40 },

  card: {
    backgroundColor: '#1b2030',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  avatar: { alignItems: 'center', marginBottom: 8 },
  name: { fontSize: 20, fontWeight: '700', color: '#fff', textAlign: 'center' },
  email: { fontSize: 13, color: '#9ca3af', textAlign: 'center', marginTop: 2 },
  phone: { fontSize: 13, color: '#9ca3af', textAlign: 'center', marginTop: 2 },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(34,197,94,0.15)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#22c55e' },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 10 },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  helpText: { fontSize: 12, color: '#9ca3af', lineHeight: 18, marginBottom: 8 },

  kvRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  kvLabel: { fontSize: 13, color: '#9ca3af', flex: 1 },
  kvValue: { fontSize: 13, color: '#fff', fontWeight: '600', maxWidth: '55%' },

  logoutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    paddingVertical: 14,
  },
  logoutText: { color: '#ef4444', fontWeight: '700', fontSize: 15 },
});

export default ProfileScreen;
