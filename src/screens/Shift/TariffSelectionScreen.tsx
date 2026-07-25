import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import { API_BASE_URL } from "../../config/environment";
import { SafeAreaView } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import Typography from "../../components/design/Typography";
import { useAuth } from "../../context/AuthContext";
import { useLocation } from "../../context/LocationContext";
import { useShift } from "../../context/ShiftContext";
import { AppStackParamList } from "../../navigation/RootNavigator";
import { Colors } from "../../theme/colors";

const FALLBACK_LOCATION = {
  latitude: 25.2854,
  longitude: 51.531,
};

export type TariffSelectionScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "TariffSelection"
>;

/**
 * Vehicle Selection Screen
 * - Shows list of available vehicles
 * - On vehicle tap: selects vehicle, auto-selects tariff[0], starts shift
 * - Tariff selection is handled automatically (no manual tariff picking)
 */
const TariffSelectionScreen: React.FC<TariffSelectionScreenProps> = ({
  route,
  navigation,
}) => {
  const { mode } = route.params;
  const { driver } = useAuth();
  const {
    vehicles,
    vehiclesLoading,
    refreshVehicles,
    tariffs,
    selectedTariff,
    refreshTariffs,
    selectTariff,
    selectVehicle,
    startShift,
    refreshRecentJobs,
  } = useShift();
  const { location: currentLocation } = useLocation();
  const [refreshing, setRefreshing] = useState(false);
  const [isStartingShift, setIsStartingShift] = useState(false);
  const [startingVehicleId, setStartingVehicleId] = useState<string | null>(null);

  // Fetch vehicles + tariffs when screen loads
  useEffect(() => {
    if (driver?.id) {
      refreshVehicles().catch((error) =>
        console.error("Vehicle refresh error", error)
      );
    }
  }, [driver?.id, refreshVehicles]);

  useEffect(() => {
    if (driver?.companyId) {
      refreshTariffs(driver.companyId).catch((error) =>
        console.error("Tariff refresh error", error)
      );
    }
  }, [driver?.companyId, refreshTariffs]);

  const handleRefresh = useCallback(async () => {
    try {
      setRefreshing(true);
      await Promise.all([
        refreshVehicles(),
        refreshTariffs(driver?.companyId || undefined),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [driver?.companyId, refreshTariffs, refreshVehicles]);

  // Handle vehicle tap → select vehicle + auto-select tariff + start shift
  const handleVehicleSelect = useCallback(async (vehicle: typeof vehicles[0]) => {
    if (isStartingShift) return;

    setIsStartingShift(true);
    setStartingVehicleId(vehicle.id);

    try {
      // 1. Select the vehicle
      await selectVehicle(vehicle);

      // 2. Auto-select tariff (default or first available)
      // refreshTariffs auto-selects in ShiftContext, but ensure we have one
      let activeTariff = selectedTariff;
      if (!activeTariff && tariffs.length > 0) {
        activeTariff = tariffs.find((t) => t.isDefault) || tariffs[0];
        await selectTariff(activeTariff);
      } else if (!activeTariff) {
        // Fetch tariffs if not loaded yet
        const fetched = await refreshTariffs(driver?.companyId || undefined);
        if (fetched.length > 0) {
          activeTariff = fetched.find((t) => t.isDefault) || fetched[0];
          await selectTariff(activeTariff);
        }
      }

      // 3. Build location payload
      const locationPayload =
        currentLocation && typeof currentLocation.latitude === "number"
          ? {
              latitude: currentLocation.latitude,
              longitude: currentLocation.longitude,
              accuracy: currentLocation.accuracy,
              heading: currentLocation.heading,
              speed: currentLocation.speed,
            }
          : FALLBACK_LOCATION;

      // 4. Start shift
      await startShift({
        vehicleId: vehicle.id,
        tariffId: activeTariff?.id,
        location: locationPayload,
      });

      // 5. Refresh ride history
      await refreshRecentJobs(3);

      // 6. Navigate home
      try {
        navigation.navigate("Home");
      } catch (error: any) {
        console.error("Navigation error", error);
        Alert.alert("Navigation Error", error?.message);
      }

      Toast.show({
        type: "success",
        text1: "Shift started",
        text2: `Vehicle ${vehicle.licensePlate} — You are now online.`,
      });
    } catch (error) {
      console.error("Failed to start shift", error);
      Toast.show({
        type: "error",
        text1: "Shift start failed",
        text2: "Unable to start shift. Please try again.",
      });
    } finally {
      setIsStartingShift(false);
      setStartingVehicleId(null);
    }
  }, [
    currentLocation,
    driver?.companyId,
    isStartingShift,
    navigation,
    refreshRecentJobs,
    refreshTariffs,
    selectTariff,
    selectVehicle,
    selectedTariff,
    startShift,
    tariffs,
  ]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.topRow}>
          <View>
            <Typography variant="titleLarge" color={Colors.text.inverse}>
              Select Your Vehicle
            </Typography>
            <Text style={styles.subtitle}>
              Choose a vehicle to start your shift
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backPill}
            activeOpacity={0.85}
          >
            <MCIcon name="arrow-left" size={18} color={Colors.text.inverse} />
            <Text style={styles.backPillText}>Back</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Available Vehicles</Text>

        {/* Vehicle List */}
        {vehiclesLoading && vehicles.length === 0 ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color={Colors.accent.highlight} />
            <Text style={styles.loaderText}>Loading vehicles...</Text>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollArea}
            contentContainerStyle={vehicles.length === 0 ? styles.emptyContainer : undefined}
            refreshControl={
              <RefreshControl
                tintColor="#fff"
                refreshing={refreshing}
                onRefresh={handleRefresh}
              />
            }
          >
            {vehicles.length > 0 ? (
              <View style={styles.vehicleListContainer}>
                {vehicles.map((item, index) => {
                  const isThisStarting = startingVehicleId === item.id;
                  const isEngaged = !!item.isEngaged;
                  // Resolve the master vehicle-type photo. Backend returns
                  // imageUrl as either an absolute URL or a path under
                  // /shared/assets/...; we prepend the static base when
                  // relative so React Native can fetch it.
                  const STATIC_BASE = API_BASE_URL.replace(/\/api\/?$/, "");
                  const resolvedImage = item.imageUrl
                    ? item.imageUrl.startsWith("http")
                      ? item.imageUrl
                      : `${STATIC_BASE}${item.imageUrl}`
                    : null;
                  return (
                    <React.Fragment key={item.id}>
                      <TouchableOpacity
                        style={[
                          styles.vehicleCard,
                          isThisStarting && styles.vehicleCardActive,
                          isEngaged && styles.vehicleCardEngaged,
                        ]}
                        onPress={() => handleVehicleSelect(item)}
                        activeOpacity={isEngaged ? 1 : 0.85}
                        disabled={isStartingShift || isEngaged}
                      >
                        <View style={styles.vehicleHeader}>
                          {resolvedImage ? (
                            <Image
                              source={{ uri: resolvedImage }}
                              style={[styles.vehicleImage, isEngaged && styles.vehicleImageEngaged]}
                              resizeMode="cover"
                            />
                          ) : (
                            <MCIcon
                              name="car"
                              size={28}
                              color={isEngaged ? "#5a6275" : isThisStarting ? Colors.success : Colors.accent.highlight}
                            />
                          )}
                          <View style={styles.vehicleInfo}>
                            <Text style={[styles.vehiclePlate, isEngaged && styles.vehicleTextEngaged]}>{item.licensePlate}</Text>
                            <Text style={[styles.vehicleDetails, isEngaged && styles.vehicleSubtextEngaged]}>
                              {item.make} {item.model} {item.year ? `- ${item.year}` : ""}
                              {isEngaged ? "  •  In use by another driver" : ""}
                            </Text>
                          </View>
                          {isEngaged ? (
                            <View style={styles.engagedBadge}>
                              <MCIcon name="lock" size={14} color="#8d95ad" />
                              <Text style={styles.engagedBadgeText}>In use</Text>
                            </View>
                          ) : isThisStarting ? (
                            <ActivityIndicator size="small" color={Colors.success} />
                          ) : (
                            <View style={styles.selectBadge}>
                              <Text style={styles.selectBadgeText}>Start</Text>
                              <MCIcon name="play-circle" size={18} color={Colors.success} />
                            </View>
                          )}
                        </View>
                      </TouchableOpacity>
                      {index < vehicles.length - 1 && <View style={styles.separator} />}
                    </React.Fragment>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyContent}>
                <MCIcon name="car-off" size={48} color="#8d95ad" />
                <Text style={styles.emptyState}>
                  No vehicles assigned. Contact your fleet manager.
                </Text>
              </View>
            )}
          </ScrollView>
        )}

        {/* Loading overlay hint */}
        {isStartingShift && (
          <View style={styles.startingOverlay}>
            <ActivityIndicator size="small" color={Colors.accent.highlight} />
            <Text style={styles.startingText}>Starting shift...</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background.base,
    paddingTop: 40,
  },
  container: {
    flex: 1,
    padding: 24,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  subtitle: {
    color: "#8d95ad",
    marginTop: 4,
    fontSize: 14,
  },
  backPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  backPillText: {
    color: Colors.text.inverse,
    fontWeight: "600",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text.inverse,
    marginBottom: 12,
    marginTop: 8,
  },
  scrollArea: {
    flex: 1,
  },
  loaderWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  loaderText: {
    color: "#8d95ad",
  },
  vehicleListContainer: {
    gap: 0,
  },
  vehicleCard: {
    backgroundColor: Colors.background.elevated,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.accent.border,
  },
  vehicleCardActive: {
    borderColor: Colors.success,
    backgroundColor: "rgba(34, 197, 94, 0.08)",
  },
  vehicleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  vehicleImage: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  vehicleImageEngaged: {
    opacity: 0.35,
  },
  vehicleCardEngaged: {
    opacity: 0.55,
    backgroundColor: "rgba(141,149,173,0.06)",
  },
  vehicleTextEngaged: {
    color: "#8d95ad",
  },
  vehicleSubtextEngaged: {
    color: "#5a6275",
  },
  engagedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(141,149,173,0.4)",
  },
  engagedBadgeText: {
    fontSize: 11,
    color: "#8d95ad",
    fontWeight: "600",
  },
  vehicleInfo: {
    flex: 1,
  },
  vehiclePlate: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text.inverse,
  },
  vehicleDetails: {
    fontSize: 14,
    color: "#8d95ad",
    marginTop: 4,
  },
  selectBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(34, 197, 94, 0.12)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  selectBadgeText: {
    color: Colors.success,
    fontWeight: "700",
    fontSize: 14,
  },
  separator: {
    height: 12,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyContent: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 40,
  },
  emptyState: {
    textAlign: "center",
    color: "#8d95ad",
    fontSize: 15,
  },
  startingOverlay: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    backgroundColor: "rgba(99, 102, 241, 0.12)",
    borderRadius: 16,
    marginTop: 12,
  },
  startingText: {
    color: Colors.accent.highlight,
    fontWeight: "600",
    fontSize: 15,
  },
});

export default TariffSelectionScreen;
