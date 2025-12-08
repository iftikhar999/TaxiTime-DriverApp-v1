import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, {
  MapPressEvent,
  Marker,
  MarkerDragEndEvent,
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

  useEffect(() => {
    if (!visible) {
      return;
    }
    setSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
    setSelectedLocation(initialValue);
    setMapRegion(defaultRegion);
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

  const handleMarkerDragEnd = useCallback(
    (event: MarkerDragEndEvent) => {
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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.iconButton}>
            <MCIcon name="close" size={22} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Choose Drop-off</Text>
          <TouchableOpacity onPress={clearSelection} style={styles.iconButton}>
            <MCIcon name="map-marker-off" size={22} color="#ef4444" />
          </TouchableOpacity>
        </View>

        <View style={styles.searchBar}>
          <MCIcon name="magnify" size={20} color="#94a3b8" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by street, building, or landmark"
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#94a3b8"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searchLoading ? (
            <ActivityIndicator size="small" color="#f5b400" />
          ) : null}
        </View>

        <View style={styles.mapWrapper}>
          <MapView
            ref={mapRef}
            key={`walkin-dropoff-${providerConstant}`}
            style={StyleSheet.absoluteFill}
            provider={providerConstant}
            initialRegion={defaultRegion}
            onRegionChangeComplete={setMapRegion}
            onPress={handleMapPress}
          >
            {selectedLocation ? (
              <Marker
                coordinate={{
                  latitude: selectedLocation.latitude,
                  longitude: selectedLocation.longitude,
                }}
                draggable
                onDragEnd={handleMarkerDragEnd}
              >
                <View style={styles.marker}>
                  <MCIcon name="map-marker" size={34} color="#f5b400" />
                </View>
              </Marker>
            ) : null}
          </MapView>
          {mapProviderLoading ? (
            <View style={styles.mapLoadingOverlay}>
              <ActivityIndicator size="large" color="#f5b400" />
              <Text style={styles.mapLoadingText}>Loading map settings…</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.selectionSummary}>
          <View style={styles.selectionText}>
            <Text style={styles.selectionLabel}>Selected Drop-off</Text>
            <Text
              style={[
                styles.selectionAddress,
                !selectedLocation && styles.selectionPlaceholder,
              ]}
              numberOfLines={2}
            >
              {selectedLocation
                ? selectedLocation.address
                : "Pick a spot on the map or search above"}
            </Text>
            {resolvingAddress ? (
              <Text style={styles.selectionHint}>Resolving address…</Text>
            ) : null}
          </View>
          <TouchableOpacity
            style={[
              styles.confirmButton,
              !canConfirm && styles.confirmButtonDisabled,
            ]}
            disabled={!canConfirm}
            onPress={handleConfirmSelection}
          >
            <Text style={styles.confirmButtonText}>Use this location</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.resultsHeader}>
          <Text style={styles.resultsTitle}>Suggestions</Text>
          {searchError ? (
            <Text style={styles.resultsError}>{searchError}</Text>
          ) : null}
        </View>

        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.resultsList}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.resultItem}
              onPress={() => handleSelectResult(item)}
            >
              <MCIcon
                name="map-marker-radius"
                size={20}
                color="#f5b400"
                style={styles.resultIcon}
              />
              <View style={styles.resultTextContainer}>
                <Text style={styles.resultTitle}>{item.title}</Text>
                {item.subtitle ? (
                  <Text style={styles.resultSubtitle} numberOfLines={2}>
                    {item.subtitle}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            searchQuery.length >= MIN_QUERY_LENGTH && !searchLoading ? (
              <View style={styles.emptyState}>
                <MCIcon name="map-search" size={32} color="#94a3b8" />
                <Text style={styles.emptyLabel}>
                  Enter an address or drop a pin to set the destination.
                </Text>
              </View>
            ) : null
          }
        />
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
});
