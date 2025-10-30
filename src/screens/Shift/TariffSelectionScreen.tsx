import { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
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
    tariffs,
    tariffsLoading,
    tariffsError,
    selectedTariff,
    refreshTariffs,
    selectTariff,
    startShift,
    refreshCurrentShift,
    refreshRideHistory,
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
      await Promise.all([refreshTariffs(driver?.companyId || undefined), forceRefresh()]);
    } finally {
      setRefreshing(false);
    }
  }, [driver?.companyId, forceRefresh, refreshTariffs]);

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
        await Promise.all([refreshCurrentShift(), refreshRideHistory(3)]);
      } catch (error) {
        console.error("Tariff change refresh error", error);
      }
      Toast.show({
        type: "success",
        text1: "Tariff updated",
        text2: `${selectedTariff.name} will be used for upcoming jobs.`,
      });
      navigation.navigate("Home"); // ✅ FIX: Navigate to Home (will show dashboard or active job)
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

      await startShift({
        vehicleId,
        tariffId: selectedTariff.id,
        location: locationPayload,
      });

      await refreshCurrentShift();
      await refreshRideHistory(3);
      navigation.navigate("Home");
      Toast.show({
        type: "success",
        text1: "Shift started",
        text2: "You are now online.",
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
    refreshRideHistory,
    selectedTariff,
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
              Choose Your Tariff
            </Typography>
            <Text style={styles.subtitle}>
              Vehicle <Text style={styles.highlight}>{vehicleId}</Text>
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

        {activeSelectionHint ? (
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
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.accent.border,
  },
  tariffCardSelected: {
    borderColor: Colors.accent.highlight,
    shadowColor: Colors.accent.highlight,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
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
    fontSize: 16,
  },
  tariffTitleSelected: {
    color: Colors.accent.highlight,
  },
  tariffSubtitle: {
    color: "#8d95ad",
    marginTop: 4,
  },
  tariffRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  tariffMetric: {
    color: "#a7b1cb",
    fontSize: 13,
  },
  tariffMeta: {
    color: "#a7b1cb",
    marginTop: 8,
    fontSize: 13,
  },
  featureWrap: {
    marginTop: 10,
    gap: 4,
  },
  featureText: {
    color: "#8d95ad",
    fontSize: 13,
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
});

export default TariffSelectionScreen;
