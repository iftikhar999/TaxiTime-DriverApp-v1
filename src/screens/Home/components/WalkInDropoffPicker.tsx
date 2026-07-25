import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MapView, {
  MapPressEvent,
  PROVIDER_DEFAULT,
  PROVIDER_GOOGLE,
  Region,
} from "react-native-maps";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { MapProvider } from "../../../services/companySettingsService";
import {
  PlaceSuggestion,
  reverseGeocode,
  searchPlaces,
} from "../../../services/geocodingService";
import { MAPS_CONFIG } from "../../../config/maps";
import { Colors } from "../../../theme/colors";

export type WalkInDropoffSelection = {
  address: string;
  latitude: number;
  longitude: number;
  placeId?: string;
  source: "search" | "map";
};

interface WalkInDropoffPickerProps {
  visible: boolean;
  initialValue?: WalkInDropoffSelection | null;
  fallbackCoordinate?: { latitude: number; longitude: number } | null;
  mapProvider?: MapProvider;
  mapProviderLoading?: boolean;
  onClose: () => void;
  onConfirm: (selection: WalkInDropoffSelection) => void;
}

const MIN_QUERY_LENGTH = 3;

const mapProviderToNative = (provider?: MapProvider) => {
  if (provider === "GOOGLE_MAPS") {
    return PROVIDER_GOOGLE;
  }
  return PROVIDER_DEFAULT;
};

export const WalkInDropoffPicker: React.FC<WalkInDropoffPickerProps> = ({
  visible,
  initialValue = null,
  fallbackCoordinate = null,
  mapProvider = "NATIVE",
  mapProviderLoading = false,
  onClose,
  onConfirm,
}) => {
  const mountedRef = useRef(true);
  const mapRef = useRef<MapView | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PlaceSuggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] =
    useState<WalkInDropoffSelection | null>(initialValue);
  const [resolvingAddress, setResolvingAddress] = useState(false);

  const defaultRegion: Region = useMemo(
    () => ({
      latitude:
        initialValue?.latitude ??
        fallbackCoordinate?.latitude ??
        MAPS_CONFIG.defaultRegion.latitude,
      longitude:
        initialValue?.longitude ??
        fallbackCoordinate?.longitude ??
        MAPS_CONFIG.defaultRegion.longitude,
      latitudeDelta: MAPS_CONFIG.defaultRegion.latitudeDelta,
      longitudeDelta: MAPS_CONFIG.defaultRegion.longitudeDelta,
    }),
    [fallbackCoordinate?.latitude, fallbackCoordinate?.longitude, initialValue]
  );

  const [mapRegion, setMapRegion] = useState<Region>(defaultRegion);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSearchIdRef = useRef(0);

  // Reset picker state only when the modal TRANSITIONS to visible. Watching
  // `defaultRegion`/`initialValue` here caused the input to clear on every
  // GPS tick: the driver's position updates every 5s → new `fallbackCoordinate`
  // → new memoized `defaultRegion` reference → effect re-ran → setSearchQuery("")
  // wiped what the driver was typing.
  const prevVisibleRef = useRef(visible);
  useEffect(() => {
    const wasVisible = prevVisibleRef.current;
    prevVisibleRef.current = visible;
    if (visible && !wasVisible) {
      setSearchQuery("");
      setSearchResults([]);
      setSearchError(null);
      setSelectedLocation(initialValue);
      setMapRegion(defaultRegion);
    }
  }, [visible, initialValue, defaultRegion]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);
    const requestId = ++latestSearchIdRef.current;

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      searchPlaces(trimmedQuery, {
        latitude: mapRegion?.latitude,
        longitude: mapRegion?.longitude,
      })
        .then((results) => {
          if (!mountedRef.current || requestId !== latestSearchIdRef.current) {
            return;
          }
          setSearchResults(results);
          if (!results.length) {
            setSearchError("No matches found nearby.");
          }
        })
        .catch((error) => {
          if (!mountedRef.current || requestId !== latestSearchIdRef.current) {
            return;
          }
          console.error("Drop-off search failed:", error);
          setSearchError("Network issue fetching suggestions. Showing last results.");
        })
        .finally(() => {
          if (!mountedRef.current || requestId !== latestSearchIdRef.current) {
            return;
          }
          setSearchLoading(false);
        });
    }, 350);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [mapRegion?.latitude, mapRegion?.longitude, searchQuery, visible]);

  const updateAddressForCoordinate = useCallback(
    async (latitude: number, longitude: number) => {
      setResolvingAddress(true);
      try {
        const address =
          (await reverseGeocode(latitude, longitude)) || "Pinned location";
        if (!mountedRef.current) {
          return;
        }
        setSelectedLocation({
          address,
          latitude,
          longitude,
          source: "map",
        });
      } catch (error) {
        console.warn("⚠️ Reverse geocode failed:", error);
        if (!mountedRef.current) {
          return;
        }
        setSelectedLocation({
          address: "Pinned location",
          latitude,
          longitude,
          source: "map",
        });
      } finally {
        if (mountedRef.current) {
          setResolvingAddress(false);
        }
      }
    },
    []
  );

  const handleMapPress = useCallback(
    (event: MapPressEvent) => {
      const { latitude, longitude } = event.nativeEvent.coordinate;
      setSelectedLocation({
        address: "Resolving address…",
        latitude,
        longitude,
        source: "map",
      });
      updateAddressForCoordinate(latitude, longitude);
    },
    [updateAddressForCoordinate]
  );

  // Center-pin selection: as the driver drags the map, the pin stays fixed in
  // the viewport centre. When the gesture settles, we lock in the centre
  // coordinate as the drop-off and reverse-geocode the address. This is the
  // same flow Uber/Lyft use and is far easier than trying to tap an exact
  // spot on a small preview.
  const lastGeocodeCoordRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const handleRegionChangeComplete = useCallback(
    (region: Region) => {
      setMapRegion(region);
      if (!mapExpandedRef.current) {
        // If the map is closed we don't want passive pans (e.g. from
        // animateToRegion on a search result) to override the selection.
        return;
      }
      const last = lastGeocodeCoordRef.current;
      // Skip if the centre barely moved (noise from onRegionChangeComplete).
      if (
        last &&
        Math.abs(last.latitude - region.latitude) < 1e-5 &&
        Math.abs(last.longitude - region.longitude) < 1e-5
      ) {
        return;
      }
      lastGeocodeCoordRef.current = {
        latitude: region.latitude,
        longitude: region.longitude,
      };
      setSelectedLocation({
        address: "Resolving address…",
        latitude: region.latitude,
        longitude: region.longitude,
        source: "map",
      });
      updateAddressForCoordinate(region.latitude, region.longitude);
    },
    [updateAddressForCoordinate]
  );

  const handleSelectResult = useCallback(
    (result: PlaceSuggestion) => {
      const latitude = result.latitude;
      const longitude = result.longitude;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return;
      }
      setSelectedLocation({
        address: result.address || result.title,
        latitude,
        longitude,
        placeId: result.placeId || result.id,
        source: "search",
      });
      setSearchQuery(result.title);
      const nextRegion: Region = {
        latitude,
        longitude,
        latitudeDelta:
          mapRegion?.latitudeDelta ?? MAPS_CONFIG.defaultRegion.latitudeDelta,
        longitudeDelta:
          mapRegion?.longitudeDelta ?? MAPS_CONFIG.defaultRegion.longitudeDelta,
      };
      setMapRegion(nextRegion);
      if (mapRef.current) {
        mapRef.current.animateToRegion(nextRegion, 300);
      }
    },
    [mapRegion]
  );

  const handleConfirmSelection = useCallback(() => {
    if (selectedLocation) {
      onConfirm(selectedLocation);
    }
  }, [onConfirm, selectedLocation]);

  const clearSelection = useCallback(() => {
    setSelectedLocation(null);
  }, []);

  const providerConstant = useMemo(
    () => mapProviderToNative(mapProvider),
    [mapProvider]
  );

  const canConfirm = Boolean(
    selectedLocation &&
      Number.isFinite(selectedLocation.latitude) &&
      Number.isFinite(selectedLocation.longitude)
  );

  // The picker now leads with a prominent search field + autocomplete
  // suggestions directly below it — fast to type, fast to pick.
  // The map is collapsed by default and can be expanded on demand for
  // the "drop a pin" path. Drop-off stays optional (walk-in jobs can
  // start without one) so there's a "Skip for now" button.
  const [mapExpanded, setMapExpanded] = useState(false);
  // Mirrors mapExpanded for use inside onRegionChangeComplete (fires on native
  // thread, needs the latest value rather than the render-time closure).
  const mapExpandedRef = useRef(mapExpanded);
  useEffect(() => {
    mapExpandedRef.current = mapExpanded;
  }, [mapExpanded]);
  const searchHasQuery = searchQuery.trim().length >= MIN_QUERY_LENGTH;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.iconButton}>
            <MCIcon name="close" size={22} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Where to?</Text>
          <TouchableOpacity onPress={onClose} style={styles.headerSkipBtn} hitSlop={{top:8,bottom:8,left:8,right:8}}>
            <Text style={styles.headerSkipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchBar}>
          <MCIcon name="magnify" size={20} color="#94a3b8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Type address, hotel, landmark…"
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#94a3b8"
            autoCorrect={false}
            autoCapitalize="none"
            autoFocus
          />
          {searchLoading ? (
            <ActivityIndicator size="small" color="#f5b400" />
          ) : searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={{top:8,bottom:8,left:8,right:8}}>
              <MCIcon name="close-circle" size={18} color="#64748b" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Suggestions live directly under the search — the primary path. */}
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.resultsList}
          keyboardShouldPersistTaps="handled"
          style={styles.resultsListFlex}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.resultItem}
              onPress={() => handleSelectResult(item)}
              activeOpacity={0.85}
            >
              <View style={styles.resultIconWrap}>
                <MCIcon name="map-marker-radius" size={18} color="#f5b400" />
              </View>
              <View style={styles.resultTextContainer}>
                <Text style={styles.resultTitle} numberOfLines={1}>{item.title}</Text>
                {item.subtitle ? (
                  <Text style={styles.resultSubtitle} numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                ) : null}
              </View>
              <MCIcon name="chevron-right" size={18} color="#64748b" />
            </TouchableOpacity>
          )}
          ListHeaderComponent={
            searchError ? (
              <View style={styles.errorPill}>
                <MCIcon name="alert-circle-outline" size={14} color="#ef4444" />
                <Text style={styles.errorPillText}>{searchError}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            searchHasQuery && !searchLoading ? (
              <View style={styles.emptyState}>
                <MCIcon name="map-search-outline" size={28} color="#94a3b8" />
                <Text style={styles.emptyLabel}>No matches. Try a landmark or street name.</Text>
              </View>
            ) : !searchHasQuery ? (
              <View style={styles.emptyHint}>
                <Text style={styles.emptyHintText}>
                  Start typing where the passenger is going. Drop-off is optional — tap Skip to start without it.
                </Text>
                <TouchableOpacity
                  style={styles.mapToggleBtn}
                  onPress={() => setMapExpanded((v) => !v)}
                  activeOpacity={0.85}
                >
                  <MCIcon name={mapExpanded ? "chevron-up" : "map-outline"} size={16} color="#f5b400" />
                  <Text style={styles.mapToggleText}>
                    {mapExpanded ? "Hide map" : "Or pick a spot on the map"}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
        />

        {/* Collapsible map — hidden by default. When expanded the driver
            drags the map so a fixed centre pin lands on the drop-off spot.
            Their own current location is shown as a native blue dot so they
            always have a reference point to orient from. */}
        {(mapExpanded || selectedLocation) ? (
          <View style={styles.mapWrapperCompact}>
            <MapView
              ref={mapRef}
              key={`walkin-dropoff-${providerConstant}`}
              style={StyleSheet.absoluteFill}
              provider={providerConstant}
              initialRegion={defaultRegion}
              onRegionChangeComplete={handleRegionChangeComplete}
              onPress={handleMapPress}
              showsUserLocation
              showsMyLocationButton
              toolbarEnabled={false}
            />

            {/* Fixed centre pin — stays in the viewport centre so the driver
                drags the map to aim. `pointerEvents="none"` keeps gestures
                flowing through to the map itself. */}
            {mapExpanded ? (
              <View pointerEvents="none" style={styles.centerPinWrapper}>
                <MCIcon name="map-marker" size={44} color="#f5b400" />
                <View style={styles.centerPinShadow} />
              </View>
            ) : null}

            {/* Recentre on the driver's current location. */}
            {fallbackCoordinate ? (
              <TouchableOpacity
                style={styles.recenterBtn}
                onPress={() => {
                  if (!mapRef.current || !fallbackCoordinate) return;
                  mapRef.current.animateToRegion(
                    {
                      latitude: fallbackCoordinate.latitude,
                      longitude: fallbackCoordinate.longitude,
                      latitudeDelta:
                        mapRegion?.latitudeDelta ??
                        MAPS_CONFIG.defaultRegion.latitudeDelta,
                      longitudeDelta:
                        mapRegion?.longitudeDelta ??
                        MAPS_CONFIG.defaultRegion.longitudeDelta,
                    },
                    250
                  );
                }}
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MCIcon name="crosshairs-gps" size={20} color="#f5b400" />
              </TouchableOpacity>
            ) : null}

            {mapProviderLoading ? (
              <View style={styles.mapLoadingOverlay}>
                <ActivityIndicator size="large" color="#f5b400" />
                <Text style={styles.mapLoadingText}>Loading map…</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Sticky bottom action bar — only shown once the driver has picked something. */}
        {selectedLocation ? (
          <View style={styles.selectionBar}>
            <View style={styles.selectionText}>
              <Text style={styles.selectionLabel}>Drop-off</Text>
              <Text style={styles.selectionAddress} numberOfLines={2}>
                {selectedLocation.address}
              </Text>
              {resolvingAddress ? (
                <Text style={styles.selectionHint}>Resolving address…</Text>
              ) : null}
            </View>
            <View style={styles.selectionActions}>
              <TouchableOpacity onPress={clearSelection} style={styles.selectionClearBtn} hitSlop={{top:8,bottom:8,left:8,right:8}}>
                <MCIcon name="close" size={16} color="#94a3b8" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.confirmButton,
                  !canConfirm && styles.confirmButtonDisabled,
                ]}
                disabled={!canConfirm}
                onPress={handleConfirmSelection}
              >
                <Text style={styles.confirmButtonText}>Use</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.base,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background.elevated,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: Colors.background.elevated,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.text.primary,
  },
  mapWrapper: {
    height: 220,
    borderRadius: 18,
    marginHorizontal: 20,
    overflow: "hidden",
    backgroundColor: Colors.background.elevated,
  },
  mapLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    gap: 10,
  },
  mapLoadingText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  marker: {
    alignItems: "center",
    justifyContent: "center",
  },
  selectionSummary: {
    marginTop: 16,
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 18,
    backgroundColor: Colors.background.elevated,
    borderWidth: 1,
    borderColor: Colors.accent.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  selectionText: {
    flex: 1,
  },
  selectionLabel: {
    fontSize: 12,
    color: Colors.text.muted,
    letterSpacing: 0.5,
  },
  selectionAddress: {
    marginTop: 2,
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  selectionPlaceholder: {
    color: Colors.text.muted,
  },
  selectionHint: {
    marginTop: 2,
    fontSize: 12,
    color: Colors.text.muted,
  },
  confirmButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.accent.highlight,
  },
  confirmButtonDisabled: {
    backgroundColor: "#4b5563",
  },
  confirmButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 13,
  },
  resultsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 18,
    paddingHorizontal: 20,
  },
  resultsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  resultsError: {
    fontSize: 12,
    color: "#ef4444",
  },
  resultsList: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  resultItem: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.accent.border,
  },
  resultIcon: {
    marginTop: 4,
  },
  resultTextContainer: {
    flex: 1,
    gap: 4,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  resultSubtitle: {
    fontSize: 13,
    color: Colors.text.secondary,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
    gap: 10,
  },
  emptyLabel: {
    textAlign: "center",
    fontSize: 13,
    color: Colors.text.muted,
  },
  // --- new search-first layout bits ------------------------------------
  headerSkipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  headerSkipText: {
    color: "#f5b400",
    fontSize: 14,
    fontWeight: "700",
  },
  resultsListFlex: {
    flex: 1,
  },
  resultIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(245, 180, 0, 0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  errorPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  errorPillText: {
    color: "#ef4444",
    fontSize: 12,
    fontWeight: "600",
  },
  emptyHint: {
    paddingVertical: 20,
    paddingHorizontal: 4,
    gap: 14,
  },
  emptyHintText: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 18,
  },
  mapToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(245, 180, 0, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(245, 180, 0, 0.25)",
  },
  mapToggleText: {
    color: "#f5b400",
    fontSize: 13,
    fontWeight: "700",
  },
  mapWrapperCompact: {
    height: 260,
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: Colors.background.elevated,
  },
  centerPinWrapper: {
    position: "absolute",
    left: "50%",
    top: "50%",
    // MCIcon map-marker is 44px tall; offset so its tip sits on the centre.
    marginLeft: -22,
    marginTop: -40,
    alignItems: "center",
  },
  centerPinShadow: {
    marginTop: -2,
    width: 10,
    height: 4,
    borderRadius: 5,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  recenterBtn: {
    position: "absolute",
    right: 12,
    bottom: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(15, 23, 42, 0.88)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(245, 180, 0, 0.35)",
  },
  selectionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: Colors.background.elevated,
    borderWidth: 1,
    borderColor: Colors.accent.border,
  },
  selectionActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  selectionClearBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(148, 163, 184, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
});
