import React from "react";
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Image } from "react-native";
import { usePODCapture } from "../../hooks/usePODCapture";

interface Props {
  stopId: string;
}

const PODCaptureScreen: React.FC<Props> = ({ stopId }) => {
  const {
    signature,
    setSignature,
    photo,
    setPhoto,
    pin,
    setPin,
    submitSignature,
    submitPhoto,
    submitPIN,
    requirements,
    refreshRequirements,
  } = usePODCapture(stopId);

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Proof of Delivery</Text>
      <TouchableOpacity style={styles.refresh} onPress={refreshRequirements}>
        <Text>Refresh requirements</Text>
      </TouchableOpacity>
      <Text style={styles.label}>Signature (base64)</Text>
      <TextInput
        style={styles.input}
        value={signature || ""}
        onChangeText={setSignature}
        placeholder="Paste signature data"
      />
      <TouchableOpacity style={styles.btn} onPress={submitSignature}>
        <Text style={styles.btnText}>Submit Signature</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Photo URL</Text>
      <TextInput
        style={styles.input}
        value={photo || ""}
        onChangeText={setPhoto}
        placeholder="Enter photo URL or base64"
      />
      {photo ? <Image source={{ uri: photo }} style={{ height: 80 }} /> : null}
      <TouchableOpacity style={styles.btn} onPress={submitPhoto}>
        <Text style={styles.btnText}>Submit Photo</Text>
      </TouchableOpacity>

      <Text style={styles.label}>PIN</Text>
      <TextInput
        style={styles.input}
        value={pin}
        onChangeText={setPin}
        placeholder="1234"
        keyboardType="numeric"
      />
      <TouchableOpacity style={styles.btn} onPress={submitPIN}>
        <Text style={styles.btnText}>Verify PIN</Text>
      </TouchableOpacity>

      {requirements && (
        <Text style={styles.meta}>Required: {requirements?.type || "ANY"}</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  heading: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  label: { marginTop: 12, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
  },
  btn: {
    marginTop: 8,
    padding: 10,
    backgroundColor: "#2563eb",
    borderRadius: 8,
  },
  btnText: { color: "#fff", textAlign: "center", fontWeight: "700" },
  meta: { marginTop: 12, color: "#4b5563" },
  refresh: { marginBottom: 8 },
});

export default PODCaptureScreen;
