/**
 * Operating Principles — plain-language driver policy reference.
 *
 * Lives off the home-screen drawer ("Operating Principles" row). Previously
 * that row had no route; now it opens this static content screen so drivers
 * know what's expected of them on shift.
 *
 * Content is intentionally static. When the ops team wants to edit, swap
 * the PRINCIPLES array here — no backend call.
 */
import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Colors } from '../../theme/colors';

const PRINCIPLES: {
  icon: string;
  title: string;
  body: string;
}[] = [
  {
    icon: 'shield-check-outline',
    title: 'Safety first',
    body:
      'Your own safety and the passenger\'s always comes before a trip fare. Pull over if you feel unsafe, use the SOS button on the Active Ride screen, and follow local traffic laws without exception.',
  },
  {
    icon: 'face-agent',
    title: 'Professional service',
    body:
      'Greet every passenger, confirm the pickup address, drive courteously, and take the shortest reasonable route. Do not smoke, eat, or take personal calls during a trip.',
  },
  {
    icon: 'cash-check',
    title: 'Honest metering',
    body:
      'Start the meter only after pickup. Do not pause, stretch, or restart the meter to inflate the fare. Cash collections must be remitted daily; discrepancies over $10 trigger an audit.',
  },
  {
    icon: 'account-heart-outline',
    title: 'Inclusive service',
    body:
      'Accept wheelchair, service-animal, and child-seat requests when your vehicle supports them. Refusing a passenger on the basis of race, religion, gender, or disability is grounds for immediate suspension.',
  },
  {
    icon: 'car-wrench',
    title: 'Vehicle readiness',
    body:
      'Your vehicle must be clean, odour-free, and mechanically sound before each shift. License, insurance, and registration documents must be current — the app blocks shift-start on any expired document.',
  },
  {
    icon: 'map-marker-path',
    title: 'Zone discipline',
    body:
      'Stay inside your assigned zone while AVAILABLE. Leaving the zone drops your queue position. Accept auto-dispatch offers within 15 seconds or the job rotates to the next driver.',
  },
  {
    icon: 'phone-alert-outline',
    title: 'Incident reporting',
    body:
      'Report accidents, aggressive passengers, or vehicle breakdowns to dispatch within 5 minutes. The SOS button notifies dispatch immediately; non-urgent issues can go through in-app chat.',
  },
  {
    icon: 'chart-bar',
    title: 'Fair earnings',
    body:
      'Driver earnings are calculated as total fare minus the commission rate shown on your tariff. Settlements run per your contract cycle. Disputes go to owner@citytaxi.com within 7 days.',
  },
];

const OperatingPrinciplesScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={styles.container} edges={['top','bottom','left','right']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
          <MCIcon name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Operating Principles</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          The principles below guide how we run the fleet. They exist to keep
          drivers, passengers, and the business safe and fair. Violations are
          investigated by dispatch; repeated violations may result in
          suspension.
        </Text>

        {PRINCIPLES.map((p, i) => (
          <View style={styles.principleCard} key={i}>
            <View style={styles.iconWrap}>
              <MCIcon name={p.icon as any} size={22} color="#f5b400" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.principleTitle}>{p.title}</Text>
              <Text style={styles.principleBody}>{p.body}</Text>
            </View>
          </View>
        ))}

        <View style={styles.footer}>
          <MCIcon name="information-outline" size={14} color="#7b7f8d" />
          <Text style={styles.footerText}>
            Questions? Ask your dispatcher or company owner.
          </Text>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

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

  intro: {
    fontSize: 13,
    lineHeight: 19,
    color: '#9ca3af',
    marginBottom: 18,
  },

  principleCard: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: '#1b2030',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(245,180,0,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  principleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  principleBody: { fontSize: 12, lineHeight: 18, color: '#c7cad1' },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    marginTop: 12,
  },
  footerText: { fontSize: 11, color: '#7b7f8d' },
});

export default OperatingPrinciplesScreen;
