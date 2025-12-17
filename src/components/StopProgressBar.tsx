import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface Props {
  total: number;
  completed: number;
  etaMinutes?: number;
}

const StopProgressBar: React.FC<Props> = ({ total, completed, etaMinutes }) => {
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      <View style={styles.meta}>
        <Text style={styles.text}>
          {completed}/{total} stops completed
        </Text>
        {etaMinutes !== undefined && (
          <Text style={styles.text}>ETA: {etaMinutes}m</Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { width: "100%" },
  bar: {
    height: 8,
    backgroundColor: "#e5e7eb",
    borderRadius: 6,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    backgroundColor: "#2563eb",
  },
  meta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  text: {
    fontSize: 12,
    color: "#4b5563",
  },
});

export default StopProgressBar;
