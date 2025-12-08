import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    FlatList,
    RefreshControl,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from "react-native";
import Toast from "react-native-toast-message";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import Typography from "../../components/design/Typography";
import { useAuth } from "../../context/AuthContext";
import { useLocation } from "../../context/LocationContext";
import { useShift } from "../../context/ShiftContext";
import { useZone } from "../../context/ZoneContext";
import { AppStackParamList } from "../../navigation/RootNavigator";
import { Colors } from "../../theme/colors";
import { Tariff } from "../../types/tariff";

const FALLBACK_LOCATION = {
  latitude: 25.2854,
  longitude: 51.531,
};

export type TariffSelectionScreenProps = NativeStackScreenProps<
  AppStackParamList,
  "TariffSelection"
>;

const TariffCard: React.FC<{
  tariff: Tariff;
  isSelected: boolean;
  isRecommended?: boolean;
  onPress: () => void;
}> = ({ tariff, isSelected, isRecommended, onPress }) => (
  <TouchableOpacity
    style={[styles.tariffCard, isSelected && styles.tariffCardSelected]}
    onPress={onPress}
    activeOpacity={0.85}
  >
    <View style={styles.tariffHeader}>
      <View>
        <Text
          style={[styles.tariffTitle, isSelected && styles.tariffTitleSelected]}
        >
          {tariff.name}
        </Text>
        <Text style={styles.tariffSubtitle}>
          {tariff.vehicleType || "Vehicle"}
        </Text>
      </View>
      {isSelected ? (
        <MCIcon
          name="checkbox-marked-circle"
          size={22}
          color={Colors.success}
        />
      ) : isRecommended ? (
        <Text style={[styles.badge, styles.recommendedBadge]}>Recommended</Text>
      ) : tariff.isDefault ? (
        <Text style={styles.badge}>Default</Text>
      ) : null}
    </View>

    <View style={styles.tariffRow}>
      <Text style={styles.tariffMetric}>
        Base: ${tariff.baseFare.toFixed(2)}
      </Text>
      <Text style={styles.tariffMetric}>
        Per km: ${tariff.perKmRate.toFixed(2)}
      </Text>
      <Text style={styles.tariffMetric}>
        Per min: ${tariff.perMinuteRate.toFixed(2)}
      </Text>
    </View>
    <Text style={styles.tariffMeta}>
      Minimum fare ${tariff.minimumFare.toFixed(2)}
    </Text>
    {tariff.features ? (
      <View style={styles.featureWrap}>
        {tariff.features.slice(0, 3).map((feature) => (
          <Text key={feature} style={styles.featureText}>
            • {feature}
          </Text>
        ))}
      </View>
    ) : null}
  </TouchableOpacity>
);

const TariffSelectionScreen: React.FC<TariffSelectionScreenProps> = ({
  route,
  navigation,
}) => {
  const { vehicleId, mode } = route.params;
  const { driver } = useAuth();
  const {
    vehicles,
    vehiclesLoading,
    selectedVehicle,
    selectVehicle,
    refreshVehicles,
    tariffs,
    tariffsLoading,
    tariffsError,
    selectedTariff,
    refreshTariffs,
    selectTariff,
    startShift,
    refreshCurrentShift,
    refreshRecentJobs,
    activeShift,
  } = useShift();
  const { location: currentLocation } = useLocation();
  const {
    currentZone,
    zoneTariffs,
    recommendedTariffId,
    autoSelectedTariffId,
    manualTariffId,
    loading: zoneLoading,
    error: zoneError,
    forceRefresh,
    setManualTariff,
    lastUpdatedAt: lastZoneCheckAt,
  } = useZone();
  const [refreshing, setRefreshing] = useState(false);
  const [isStartingShift, setIsStartingShift] = useState(false);
  const isChangeMode = mode === "change" || Boolean(activeShift);

  // Fetch vehicles when screen loads
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
      // ✅ Refresh vehicles, tariffs, and zone info
      if (currentZone?.id) {
        await Promise.all([
          refreshVehicles(),
          refreshTariffs(driver?.companyId || undefined),
          forceRefresh()
        ]);
      } else {
        await Promise.all([
          refreshVehicles(),
          refreshTariffs(driver?.companyId || undefined)
        ]);
      }
    } finally {
      setRefreshing(false);
    }
  }, [driver?.companyId, forceRefresh, refreshTariffs, refreshVehicles, currentZone?.id]);

  const handleConfirm = useCallback(async () => {
    if (!selectedTariff) {
      Toast.show({
        type: "info",
        text1: "Tariff",
        text2: "Select a tariff to continue.",
      });
      return;
    }

 
 
    if (isChangeMode) {
      try {
        await Promise.all([refreshCurrentShift(), refreshRecentJobs(3)]);
      } catch (error) {
        console.error("Tariff change refresh error", error);
      }
      Toast.show({
        type: "success",
        text1: "Tariff updated",
        text2: `${selectedTariff.name} will be used for upcoming jobs.`,
      });
      
      // ✅ Navigate to Home - it will automatically show:
      // - Dashboard if no active job
      // - Active job screen if job exists (via HomeScreen's useFocusEffect)
      navigation.navigate("Home");
      return;
    }

    const activeVehicleId = selectedVehicle?.id || vehicleId;
    if (!activeVehicleId) {
      Toast.show({
        type: "info",
        text1: "Vehicle required",
        text2: "Select a vehicle before starting your shift.",
      });
      return;
    }

    setIsStartingShift(true);
    try {
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
    
       
      // ✅ Start shift with selected vehicle and tariff
      await startShift({
        vehicleId: activeVehicleId,
        tariffId: selectedTariff.id,
        location: locationPayload,
      });
      
      // ✅ REMOVED: refreshCurrentShift() - startShift already returns and persists the shift
      // Calling refreshCurrentShift immediately might find old cached shift or get null from server
      // The HomeScreen will refresh stats after 3 seconds anyway
      
      // ✅ Refresh ride history to show latest completed trips
      await refreshRecentJobs(3);

      // ✅ Navigate to Home - HomeScreen will automatically:
      // 1. Show dashboard if no job
      // 2. Navigate to appropriate job screen if active job exists (via useFocusEffect)
      try{
           navigation.navigate("Home");
      }catch(error){
        console.error("Navigation error", error);
        Alert.alert("Navigation Error", error?.message);
      }
      
      Toast.show({
        type: "success",
        text1: "Shift started",
        text2: "You are now online and ready for jobs.",
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
    }
  }, [
    currentLocation,
    isChangeMode,
    navigation,
    refreshCurrentShift,
    refreshRecentJobs,
    selectedTariff,
    selectedVehicle?.id,
    startShift,
    vehicleId,
  ]);

  const zoneSpecificTariffs = useMemo(
    () => zoneTariffs.map((entry) => entry.tariff),
    [zoneTariffs]
  );

  const displayedTariffs = useMemo(() => {
    if (zoneSpecificTariffs.length > 0) {
      return zoneSpecificTariffs;
    }
    return tariffs;
  }, [tariffs, zoneSpecificTariffs]);

  const renderItem = useCallback(
    ({ item }: { item: Tariff }) => (
      <TariffCard
        tariff={item}
        isSelected={selectedTariff?.id === item.id}
        isRecommended={item.id === recommendedTariffId}
        onPress={() => {
          if (item.id === recommendedTariffId) {
            setManualTariff(null);
          } else {
            setManualTariff(item.id);
          }
          selectTariff(item);
        }}
      />
    ),
    [recommendedTariffId, selectTariff, selectedTariff?.id, setManualTariff]
  );

  const isLoadingTariffs = tariffsLoading || zoneLoading;
  const ctaLabel = useMemo(() => {
    if (isLoadingTariffs) return "Loading tariffs…";
    if (isStartingShift) return "Starting shift…";
    if (isChangeMode)
      return selectedTariff ? "Apply Tariff" : "Select a tariff";
    return selectedTariff ? "Confirm Selection" : "Select a tariff";
  }, [isChangeMode, isLoadingTariffs, isStartingShift, selectedTariff]);

  const combinedError = tariffsError || zoneError;

  const activeSelectionHint = useMemo(() => {
    if (selectedTariff?.id && selectedTariff.id === manualTariffId) {
      return "Using manual tariff selection.";
    }
    if (selectedTariff?.id && selectedTariff.id === autoSelectedTariffId) {
      return "Tariff matched to your current zone.";
    }
    return null;
  }, [autoSelectedTariffId, manualTariffId, selectedTariff?.id]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.topRow}>
          <View>
            <Typography variant="titleLarge" color={Colors.text.inverse}>
              {!selectedVehicle ? "Select Your Vehicle" : "Choose Your Tariff"}
            </Typography>
            {selectedVehicle && (
              <Text style={styles.subtitle}>
                Vehicle <Text style={styles.highlight}>{selectedVehicle.licensePlate}</Text>
              </Text>
            )}
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

        {/* Selected Vehicle Header - Show change button */}
        {selectedVehicle && (
          <TouchableOpacity 
            style={styles.selectedVehicleBanner}
            onPress={async () => {
              // Clear vehicle selection to show vehicle list again
              await selectVehicle(null);
            }}
            activeOpacity={0.85}
          >
            <View style={styles.selectedVehicleInfo}>
              <MCIcon name="car" size={20} color={Colors.accent.highlight} />
              <View>
                <Text style={styles.selectedVehiclePlate}>{selectedVehicle.licensePlate}</Text>
                <Text style={styles.selectedVehicleDetails}>
                  {selectedVehicle.make} {selectedVehicle.model}
                </Text>
              </View>
            </View>
            <View style={styles.changeVehicleButton}>
              <MCIcon name="swap-horizontal" size={16} color={Colors.accent.highlight} />
              <Text style={styles.changeVehicleText}>Change</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Vehicle Selection Section */}
        {!selectedVehicle && (
          <>
            <Text style={styles.sectionTitle}>Available Vehicles</Text>
            {vehiclesLoading ? (
              <View style={styles.loaderWrap}>
                <ActivityIndicator size="large" color={Colors.accent.highlight} />
                <Text style={styles.loaderText}>Loading vehicles...</Text>
              </View>
            ) : vehicles.length > 0 ? (
              <View style={styles.vehicleListContainer}>
                {vehicles.map((item, index) => (
                  <React.Fragment key={item.id}>
                    <TouchableOpacity
                      style={styles.vehicleCard}
                      onPress={async () => {
                        await selectVehicle(item);
                        Toast.show({
                          type: "success",
                          text1: "Vehicle Selected",
                          text2: `${item.licensePlate} - ${item.make} ${item.model}`,
                        });
                      }}
                      activeOpacity={0.85}
                    >
                      <View style={styles.vehicleHeader}>
                        <MCIcon name="car" size={24} color={Colors.accent.highlight} />
                        <View style={styles.vehicleInfo}>
                          <Text style={styles.vehiclePlate}>{item.licensePlate}</Text>
                          <Text style={styles.vehicleDetails}>
                            {item.make} {item.model} - {item.year}
                          </Text>
                        </View>
                        <MCIcon name="chevron-right" size={24} color="#8d95ad" />
                      </View>
                    </TouchableOpacity>
                    {index < vehicles.length - 1 && <View style={styles.separator} />}
                  </React.Fragment>
                ))}
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <MCIcon name="car-off" size={48} color="#8d95ad" />
                <Text style={styles.emptyState}>
                  No vehicles assigned. Contact your fleet manager.
                </Text>
              </View>
            )}
          </>
        )}

        {/* Tariff Section Title - Always show */}
        <Text style={styles.sectionTitle}>Select Tariff</Text>

        {/* Tariff Selection Section - Only show when vehicle is selected */}
        {selectedVehicle && (
          <>
            {currentZone ? (
              <View style={styles.zoneBanner}>
                <Text style={styles.zoneBannerTitle}>{currentZone.name}</Text>
                <Text style={styles.zoneBannerSubtitle}>
                  Tariffs tailored for this zone update automatically.
                </Text>
              </View>
            ) : zoneLoading ? (
              <View style={styles.zoneBannerInactive}>
                <Text style={styles.zoneBannerSubtitle}>
                  Waiting for location lock to determine your zone.
                </Text>
              </View>
            ) : lastZoneCheckAt ? (
              <View style={styles.zoneBannerWarning}>
                <Text style={styles.zoneBannerTitle}>Outside service area</Text>
                <Text style={styles.zoneBannerSubtitle}>
                  Move into a supported zone to unlock tariffs.
                </Text>
              </View>
            ) : null}
          </>
        )}

        {selectedVehicle && currentZone ? (
          <Text style={styles.selectionHint}>{activeSelectionHint}</Text>
        ) : null}

        {isLoadingTariffs && !refreshing && displayedTariffs.length === 0 ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={Colors.accent.highlight} size="large" />
            <Text style={styles.loaderText}>Fetching tariffs…</Text>
          </View>
        ) : (
          <FlatList
            data={displayedTariffs}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            refreshControl={
              <RefreshControl
                tintColor="#fff"
                refreshing={refreshing}
                onRefresh={handleRefresh}
              />
            }
            ListEmptyComponent={
              !isLoadingTariffs ? (
                <Text style={styles.emptyState}>
                  No tariffs available. Please contact your dispatcher.
                </Text>
              ) : null
            }
            contentContainerStyle={
              displayedTariffs.length === 0 ? styles.emptyContainer : undefined
            }
          />
        )}

        {combinedError ? (
          <View style={styles.errorBanner}>
            <View style={styles.errorBannerCopy}>
              <MCIcon name="alert-circle" size={18} color={Colors.danger} />
              <Text style={styles.errorBannerText} numberOfLines={2}>
                {combinedError}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.errorBannerButton}
              onPress={handleRefresh}
              disabled={refreshing || isLoadingTariffs}
              activeOpacity={0.85}
            >
              {refreshing ? (
                <ActivityIndicator color={Colors.danger} size="small" />
              ) : (
                <Text style={styles.errorBannerButtonText}>Retry</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity
          style={[
            styles.confirmButton,
            (!selectedTariff || isLoadingTariffs || isStartingShift) &&
              styles.confirmButtonDisabled,
          ]}
          onPress={handleConfirm}
          disabled={!selectedTariff || isLoadingTariffs || isStartingShift}
          activeOpacity={0.9}
        >
          {isStartingShift ? (
            <ActivityIndicator color={Colors.text.inverse} size="small" />
          ) : (
            <Text style={styles.confirmButtonText}>{ctaLabel}</Text>
          )}
        </TouchableOpacity>
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
  },
  highlight: {
    color: Colors.accent.highlight,
    fontWeight: "600",
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
  zoneBanner: {
    backgroundColor: "rgba(99, 102, 241, 0.12)",
    borderColor: Colors.accent.highlight,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  zoneBannerInactive: {
    backgroundColor: "rgba(148, 163, 184, 0.12)",
    borderColor: "rgba(148, 163, 184, 0.4)",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  zoneBannerTitle: {
    color: Colors.text.inverse,
    fontWeight: "700",
    fontSize: 16,
    marginBottom: 4,
  },
  zoneBannerSubtitle: {
    color: "#a7b1cb",
    fontSize: 13,
  },
  zoneBannerWarning: {
    backgroundColor: "rgba(248, 113, 113, 0.12)",
    borderColor: "rgba(248, 113, 113, 0.6)",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  selectionHint: {
    color: "#8d95ad",
    marginBottom: 12,
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
  separator: {
    height: 12,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: "center",
  },
  emptyState: {
    textAlign: "center",
    color: "#8d95ad",
  },
  errorText: {
    color: Colors.danger,
    marginTop: 12,
    textAlign: "center",
  },
  errorBanner: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 77, 97, 0.4)",
    backgroundColor: "rgba(255, 77, 97, 0.12)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  errorBannerCopy: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  errorBannerText: {
    color: Colors.danger,
    flex: 1,
  },
  errorBannerButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(255, 77, 97, 0.16)",
  },
  errorBannerButtonText: {
    color: Colors.danger,
    fontWeight: "700",
  },
  tariffCard: {
    backgroundColor: Colors.background.elevated,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.accent.border,
  },
  tariffCardSelected: {
    borderColor: Colors.accent.highlight,
    shadowColor: Colors.accent.highlight,
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  tariffHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  recommendedBadge: {
    backgroundColor: "rgba(99, 102, 241, 0.18)",
    color: Colors.accent.highlight,
  },
  tariffTitle: {
    color: "#dfe3f3",
    fontWeight: "600",
    fontSize: 14,
  },
  tariffTitleSelected: {
    color: Colors.accent.highlight,
  },
  tariffSubtitle: {
    color: "#8d95ad",
    fontSize: 12,
    marginTop: 2,
  },
  tariffRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  tariffMetric: {
    color: "#a7b1cb",
    fontSize: 12,
  },
  tariffMeta: {
    color: "#a7b1cb",
    marginTop: 6,
    fontSize: 12,
  },
  featureWrap: {
    marginTop: 6,
    gap: 2,
  },
  featureText: {
    color: "#8d95ad",
    fontSize: 11,
  },
  badge: {
    backgroundColor: "rgba(245, 180, 0, 0.15)",
    color: Colors.accent.highlight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    fontWeight: "600",
    fontSize: 12,
  },
  confirmButton: {
    marginTop: 20,
    backgroundColor: Colors.success,
    paddingVertical: 16,
    borderRadius: 28,
    alignItems: "center",
  },
  confirmButtonDisabled: {
    backgroundColor: "#2d3342",
  },
  confirmButtonText: {
    color: Colors.text.inverse,
    fontWeight: "700",
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text.inverse,
    marginBottom: 12,
    marginTop: 20,
  },
  vehicleListContainer: {
    marginBottom: 8,
  },
  vehicleCard: {
    backgroundColor: Colors.background.elevated,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.accent.border,
  },
  vehicleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  vehicleInfo: {
    flex: 1,
  },
  vehiclePlate: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text.inverse,
  },
  vehicleDetails: {
    fontSize: 13,
    color: "#8d95ad",
    marginTop: 4,
  },
  selectedVehicleBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.background.elevated,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.accent.border,
  },
  selectedVehicleInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectedVehiclePlate: {
    fontSize: 14,
    fontWeight: "700",
    color: Colors.text.inverse,
  },
  selectedVehicleDetails: {
    fontSize: 12,
    color: "#8d95ad",
  },
  changeVehicleButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(99, 102, 241, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  changeVehicleText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.accent.highlight,
  },
});

export default TariffSelectionScreen;
