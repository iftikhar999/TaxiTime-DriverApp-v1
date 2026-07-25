/**
 * RatePassengerScreen — driver rates passenger after completed ride.
 * Mirrors the passenger's RateDriverScreen. Posts to /api/ratings.
 *
 * Route params: { jobId, tripId?, passengerId, passengerName? }
 */
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import axios from 'axios';
import { API_BASE_URL } from '../../config/environment';
import { useAuth } from '../../context/AuthContext';

const POSITIVE_TAGS = [
  'On time',
  'Polite',
  'Clean',
  'Good communication',
  'Easy pickup',
];
const NEGATIVE_TAGS = [
  'Late',
  'Rude',
  'Wrong pickup',
  'Unsafe behaviour',
];

const RatePassengerScreen: React.FC<any> = ({ navigation, route }) => {
  const { jobId, tripId, passengerId, passengerName } = route.params || {};
  const { token } = useAuth();
  const [rating, setRating] = useState(0);
  const [positive, setPositive] = useState<string[]>([]);
  const [negative, setNegative] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggle = (tag: string, list: string[], setter: (v: string[]) => void) => {
    setter(list.includes(tag) ? list.filter(t => t !== tag) : [...list, tag]);
  };

  const submit = async () => {
    if (rating === 0 || !passengerId) {
      Alert.alert('Pick a rating', 'Please rate the passenger from 1 to 5 stars');
      return;
    }
    setSubmitting(true);
    try {
      const body: any = {
        rateeId: passengerId,
        rating,
        comment: comment || undefined,
        tags: [...positive, ...negative].length ? [...positive, ...negative] : undefined,
      };
      // Pass tripId and jobId separately. The backend resolves FK-safe
      // trip / delivery IDs from the job when we only have a jobId, and it
      // won't reject the rating if the job never materialised as a ride
      // (dispatch-only walk-in taxi flow).
      if (tripId) body.tripId = tripId;
      if (jobId) body.jobId = jobId;

      await axios.post(
        `${API_BASE_URL.replace(/\/api$/, '')}/api/ratings`,
        body,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Failed to submit rating';
      // 409 = already rated — just go home
      if (err?.response?.status === 409) {
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const skip = () => navigation.reset({ index: 0, routes: [{ name: 'Home' }] });

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={skip} style={{ padding: 6 }}>
          <Icon name="close" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rate your passenger</Text>
        <TouchableOpacity onPress={skip}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{(passengerName || 'P').charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{passengerName || 'Passenger'}</Text>
        </View>

        <Text style={styles.prompt}>How was your passenger?</Text>

        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map(s => (
            <TouchableOpacity key={s} onPress={() => setRating(s)}>
              <Icon
                name={s <= rating ? 'star' : 'star-border'}
                size={42}
                color={s <= rating ? '#FFD166' : '#555'}
                style={{ marginHorizontal: 4 }}
              />
            </TouchableOpacity>
          ))}
        </View>

        {rating >= 4 && (
          <>
            <Text style={styles.sectionTitle}>What went well?</Text>
            <View style={styles.tagRow}>
              {POSITIVE_TAGS.map(tag => (
                <TouchableOpacity
                  key={tag}
                  style={[styles.tag, positive.includes(tag) && styles.tagActive]}
                  onPress={() => toggle(tag, positive, setPositive)}>
                  <Text style={[styles.tagText, positive.includes(tag) && styles.tagTextActive]}>
                    {tag}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {rating > 0 && rating < 4 && (
          <>
            <Text style={styles.sectionTitle}>What could be better?</Text>
            <View style={styles.tagRow}>
              {NEGATIVE_TAGS.map(tag => (
                <TouchableOpacity
                  key={tag}
                  style={[styles.tag, negative.includes(tag) && styles.tagActiveNeg]}
                  onPress={() => toggle(tag, negative, setNegative)}>
                  <Text style={[styles.tagText, negative.includes(tag) && styles.tagTextActive]}>
                    {tag}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {rating > 0 && (
          <>
            <Text style={styles.sectionTitle}>Leave a note (optional)</Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Add a comment"
              placeholderTextColor="#777"
              multiline
              style={styles.commentInput}
            />
          </>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, (submitting || rating === 0) && { opacity: 0.5 }]}
          onPress={submit}
          disabled={submitting || rating === 0}>
          {submitting
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.submitText}>Submit rating</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#161b22',
  },
  headerTitle: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  skipText: { color: '#FFD166', fontSize: 15 },
  avatarWrap: { alignItems: 'center', marginVertical: 24 },
  avatar: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: '#FFD166',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 34, fontWeight: '700', color: '#000' },
  name: { color: '#FFF', fontSize: 18, fontWeight: '600', marginTop: 10 },
  prompt: { color: '#FFF', fontSize: 16, textAlign: 'center', marginBottom: 18 },
  starsRow: { flexDirection: 'row', justifyContent: 'center', marginBottom: 24 },
  sectionTitle: { color: '#8b949e', fontSize: 13, letterSpacing: 1, marginBottom: 10, marginTop: 16 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d',
  },
  tagActive: { backgroundColor: '#FFD166', borderColor: '#FFD166' },
  tagActiveNeg: { backgroundColor: '#f85149', borderColor: '#f85149' },
  tagText: { color: '#8b949e', fontSize: 13 },
  tagTextActive: { color: '#000', fontWeight: '600' },
  commentInput: {
    backgroundColor: '#21262d',
    color: '#FFF',
    borderRadius: 12,
    padding: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  submitBtn: {
    backgroundColor: '#FFD166',
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitText: { color: '#000', fontSize: 15, fontWeight: '700' },
});

export default RatePassengerScreen;
