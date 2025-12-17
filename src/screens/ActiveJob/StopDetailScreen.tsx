import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking } from "react-native";
import StopProgressBar from "../../components/StopProgressBar";

interface Props {
  stop: any;
  total: number;
  completed: number;
  onArrive: () => void;
  onComplete: () => void;
  onPOD: () => void;
}

const StopDetailScreen: React.FC<Props> = ({
  stop,
  total,
  completed,
  onArrive,
  onComplete,
  onPOD,
}) => {
  if (!stop) return null;
  const openMaps = () => {
    if (stop.latitude && stop.longitude) {
      Linking.openURL(`https://www.google.com/maps?q=${stop.latitude},${stop.longitude}`);
    }
  };

  return (
    <View style={styles.container}>
      <StopProgressBar total={total} completed={completed} />
      <Text style={styles.title}>{stop.address}</Text>
      {stop.contactName && <Text style={styles.meta}>Contact: {stop.contactName}</Text>}
      {stop.contactPhone && <Text style={styles.meta}>Phone: {stop.contactPhone}</Text>}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.btn} onPress={openMaps}>
          <Text style={styles.btnText}>Navigate</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={onArrive}>
          <Text style={styles.btnText}>Arrived</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={onComplete}>
          <Text style={styles.btnText}>Complete</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={onPOD}>
          <Text style={styles.btnText}>POD</Text>
        </TouchableOpacity>
      </View>
      {stop.notes && <Text style={styles.notes}>Notes: {stop.notes}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 18, fontWeight: "700", marginVertical: 8 },
  meta: { color: "#4b5563", marginTop: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#2563eb",
  },
  btnText: { color: "#fff", fontWeight: "600" },
  notes: { marginTop: 12, color: "#6b7280" },
});

export default StopDetailScreen;
