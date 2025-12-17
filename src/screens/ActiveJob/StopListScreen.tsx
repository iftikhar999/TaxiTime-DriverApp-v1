import React from "react";
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from "react-native";
import StopProgressBar from "../../components/StopProgressBar";

interface StopListScreenProps {
  stops: any[];
  currentStopId?: string;
  onSelect: (stopId: string) => void;
  onArrive: (stopId: string) => void;
  onComplete: (stopId: string) => void;
}

const StopListScreen: React.FC<StopListScreenProps> = ({
  stops,
  currentStopId,
  onSelect,
  onArrive,
  onComplete,
}) => {
  const completed = stops.filter((s) => s.status === "COMPLETED").length;
  return (
    <View style={styles.container}>
      <StopProgressBar total={stops.length} completed={completed} />
      <FlatList
        data={stops}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const isCurrent = item.id === currentStopId;
          return (
            <TouchableOpacity
              style={[styles.stop, isCurrent && styles.current]}
              onPress={() => onSelect(item.id)}
            >
              <View style={styles.row}>
                <Text style={styles.seq}>#{item.sequence}</Text>
                <Text style={styles.address}>{item.address}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.status}>{item.status}</Text>
                <View style={styles.actions}>
                  <TouchableOpacity onPress={() => onArrive(item.id)}>
                    <Text style={styles.action}>Arrive</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onComplete(item.id)}>
                    <Text style={styles.action}>Complete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  stop: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#fff",
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  current: {
    borderColor: "#2563eb",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  seq: { fontWeight: "700", marginRight: 8 },
  address: { flex: 1, color: "#374151" },
  status: { color: "#6b7280" },
  actions: { flexDirection: "row", gap: 10 },
  action: { color: "#2563eb", marginLeft: 8 },
});

export default StopListScreen;
