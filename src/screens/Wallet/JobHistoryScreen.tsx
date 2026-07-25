import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import {
  fetchJobHistory,
  getCachedJobHistory,
  setCachedJobHistory,
  JobHistoryResponse,
} from "../../services/driverService";
import { CURRENCY_SYMBOL } from "../../config/currency";
import { Colors } from "../../theme/colors";
import { RecentJobSummary } from "../../types/recentJob";
import { RecentJobsSection } from "../Home/components/RecentJobsSection";

/* ── helpers ────────────────────────────────────────── */

const fmt = (n: number, symbol = CURRENCY_SYMBOL) => `${symbol} ${Math.abs(n).toFixed(2)}`;
const fmtDuration = (seconds: number) => {
  if (!seconds || seconds <= 0) return "–";
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
};

const extractEarnings = (job: RecentJobSummary): number => {
  const v =
    job.fare?.driverEarnings ??
    job.fare?.total ??
    job.payment?.driverEarnings ??
    job.payment?.amount ??
    0;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};

const paymentMethodOf = (j: RecentJobSummary): string =>
  (j.paymentMethod || "").toUpperCase();

type FilterKey = "today" | "yesterday" | "week" | "month" | "all";

const FILTERS: { key: FilterKey; label: string; icon: string }[] = [
  { key: "today", label: "Today", icon: "calendar-today" },
  { key: "yesterday", label: "Yesterday", icon: "calendar-minus" },
  { key: "week", label: "This Week", icon: "calendar-week" },
  { key: "month", label: "This Month", icon: "calendar-month" },
  { key: "all", label: "All", icon: "calendar-blank-multiple" },
];

const getFilterRange = (
  key: FilterKey
): { start: string; end: string } => {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  switch (key) {
    case "today":
      return { start: todayStart.toISOString(), end: now.toISOString() };
    case "yesterday": {
      const ydayStart = new Date(todayStart);
      ydayStart.setDate(ydayStart.getDate() - 1);
      return { start: ydayStart.toISOString(), end: todayStart.toISOString() };
    }
    case "week": {
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
      return { start: weekStart.toISOString(), end: now.toISOString() };
    }
    case "month": {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: monthStart.toISOString(), end: now.toISOString() };
    }
    case "all":
    default:
      // Don't send date params – let API return everything
      return { start: "", end: "" };
  }
};

/* ── component ──────────────────────────────────────── */

const JobHistoryScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [jobs, setJobs] = useState<RecentJobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Default to "week" — "today" would show empty for any driver who hasn't
  // driven today (which is most of the time in a part-time fleet). Users can
  // still filter down to today via the FILTERS row.
  const [activeFilter, setActiveFilter] = useState<FilterKey>("week");
  const [pagination, setPagination] = useState<
    JobHistoryResponse["pagination"] | null
  >(null);

  /* ── fetch data from API (with cache fallback) ── */
  const loadJobs = useCallback(
    async (filter: FilterKey, forceRefresh = false) => {
      // 1. Try cache first (unless forced refresh)
      if (!forceRefresh) {
        const cached = await getCachedJobHistory(filter);
        if (cached) {
          setJobs(cached.data);
          setPagination(cached.pagination);
          setLoading(false);
          // Still refresh in background
          fetchFromServer(filter, true);
          return;
        }
      }

      setLoading(true);
      await fetchFromServer(filter, false);
    },
    []
  );

  const fetchFromServer = async (
    filter: FilterKey,
    isSilent: boolean
  ) => {
    try {
      const { start, end } = getFilterRange(filter);
      const params: Record<string, any> = {
        limit: 100,
        // JobStatus enum uses NOSHOW (no underscore). Earlier code sent
        // "NO_SHOW" and the backend rejected the whole request with
        // "Invalid value for argument `in`. Expected JobStatus." →
        // the entire history screen came back empty.
        status: "COMPLETED,CANCELLED,NOSHOW",
      };
      if (start) params.startDate = start;
      if (end) params.endDate = end;

      const result = await fetchJobHistory(params);
      setJobs(result.data);
      setPagination(result.pagination);

      // Cache the result
      await setCachedJobHistory(filter, result.data, result.pagination);
    } catch (err) {
      console.warn("Failed to fetch job history:", err);
      // On error, try loading from cache as fallback
      if (!isSilent) {
        const cached = await getCachedJobHistory(filter);
        if (cached) {
          setJobs(cached.data);
          setPagination(cached.pagination);
        }
      }
    } finally {
      if (!isSilent) setLoading(false);
    }
  };

  // Load on mount and when filter changes
  useEffect(() => {
    loadJobs(activeFilter);
  }, [activeFilter, loadJobs]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadJobs(activeFilter, true);
    setRefreshing(false);
  }, [activeFilter, loadJobs]);

  const onFilterChange = useCallback((key: FilterKey) => {
    setActiveFilter(key);
    setJobs([]); // Clear while loading new filter
  }, []);

  /* ── earnings breakdown for the fetched period ── */
  const breakdown = useMemo(() => {
    let total = 0;
    let cash = 0;
    let card = 0;
    let epos = 0;
    let account = 0;
    let completed = 0;
    let cancelled = 0;
    let noShow = 0;

    for (const job of jobs) {
      const earnings = extractEarnings(job);
      const method = paymentMethodOf(job);
      const status = (job.status || "").toUpperCase();

      total += earnings;
      if (status === "COMPLETED" || status === "FINISHED") completed++;
      else if (status === "CANCELLED") cancelled++;
      else if (status === "NOSHOW" || status === "NO_SHOW") noShow++;

      switch (method) {
        case "CASH":
        case "CASH_COLLECTION":
          cash += earnings;
          break;
        case "CARD":
        case "STRIPE":
        case "CREDIT_CARD":
          card += earnings;
          break;
        case "EPOS":
        case "POS":
        case "TERMINAL":
          epos += earnings;
          break;
        case "WALLET":
        case "ACCOUNT":
        case "COMPANY_ACCOUNT":
          account += earnings;
          break;
        default:
          break;
      }
    }

    return { total, cash, card, epos, account, completed, cancelled, noShow };
  }, [jobs]);

  /* ── render ── */
  return (
    <SafeAreaView style={styles.screen} edges={['top','bottom','left','right']}>
      {/* header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          activeOpacity={0.85}
        >
          <MCIcon name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Job History</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* filter tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
      >
        {FILTERS.map((f) => {
          const active = f.key === activeFilter;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => onFilterChange(f.key)}
              activeOpacity={0.85}
            >
              <MCIcon
                name={f.icon as any}
                size={14}
                color={active ? "#000" : "#8d95ad"}
              />
              <Text
                style={[
                  styles.filterChipText,
                  active && styles.filterChipTextActive,
                ]}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.accent.highlight}
          />
        }
      >
        {/* ── earnings breakdown card ── */}
        <View style={styles.earningsCard}>
          <View style={styles.earningsTop}>
            <Text style={styles.earningsLabel}>
              {activeFilter === "all"
                ? "Total Earnings"
                : activeFilter === "today"
                ? "Today's Earnings"
                : activeFilter === "yesterday"
                ? "Yesterday's Earnings"
                : activeFilter === "week"
                ? "This Week's Earnings"
                : "This Month's Earnings"}
            </Text>
            <Text style={styles.earningsTotal}>{fmt(breakdown.total)}</Text>
          </View>

          {/* payment method pills */}
          <View style={styles.methodRow}>
            <MethodPill icon="cash" label="Cash" amount={breakdown.cash} color="#4ade80" />
            <MethodPill icon="credit-card-outline" label="Card" amount={breakdown.card} color="#38bdf8" />
            <MethodPill icon="contactless-payment" label="EPOS" amount={breakdown.epos} color="#818cf8" />
            <MethodPill icon="wallet-outline" label="Account" amount={breakdown.account} color="#a78bfa" />
          </View>

          {/* job status row */}
          <View style={styles.statusRow}>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: "#4ade80" }]} />
              <Text style={styles.statusCount}>{breakdown.completed}</Text>
              <Text style={styles.statusLabel}>Completed</Text>
            </View>
            <View style={styles.statusDivider} />
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: "#f87171" }]} />
              <Text style={styles.statusCount}>{breakdown.cancelled}</Text>
              <Text style={styles.statusLabel}>Cancelled</Text>
            </View>
            <View style={styles.statusDivider} />
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: "#f97316" }]} />
              <Text style={styles.statusCount}>{breakdown.noShow}</Text>
              <Text style={styles.statusLabel}>No-Show</Text>
            </View>
            <View style={styles.statusDivider} />
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: "#8d95ad" }]} />
              <Text style={styles.statusCount}>{jobs.length}</Text>
              <Text style={styles.statusLabel}>Total</Text>
            </View>
          </View>
        </View>

        {/* ── jobs list ── */}
        {loading && !refreshing ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="small" color={Colors.accent.highlight} />
            <Text style={styles.loadingText}>Loading jobs...</Text>
          </View>
        ) : jobs.length === 0 ? (
          <View style={styles.emptyWrap}>
            <MCIcon name="calendar-blank" size={36} color="#3a3f52" />
            <Text style={styles.emptyText}>No jobs for this period</Text>
            <Text style={styles.emptySubtext}>
              Try selecting a different time range above
            </Text>
          </View>
        ) : (
          <>
            <RecentJobsSection
              jobs={jobs}
              loading={false}
              formatCurrency={(n) => fmt(n)}
              formatDuration={fmtDuration}
              maxVisible={100}
            />
            {pagination && pagination.hasMore && (
              <View style={styles.paginationInfo}>
                <Text style={styles.paginationText}>
                  Showing {jobs.length} of {pagination.total} jobs
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

/* ── sub-components ──────────────────────────────────── */

const MethodPill: React.FC<{
  icon: string;
  label: string;
  amount: number;
  color: string;
}> = ({ icon, label, amount, color }) => (
  <View style={[styles.methodPill, { borderColor: `${color}25` }]}>
    <MCIcon name={icon as any} size={14} color={color} />
    <Text style={styles.methodPillLabel}>{label}</Text>
    <Text style={[styles.methodPillAmount, { color }]}>{fmt(amount)}</Text>
  </View>
);

/* ── styles ──────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0e1117",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1d29",
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1a1d29",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },

  /* filter tabs */
  filterScroll: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1d29",
  },
  filterRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    // Padding tuned so the chip width is identical whether text is rendered
    // at fontWeight 600 (inactive) or 700 (active) — previously a tight
    // paddingHorizontal meant the bold active label overran its chip and
    // showed as "Yester…" on Android.
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#1a1d29",
    borderWidth: 1,
    borderColor: "#2a2f3f",
    flexShrink: 0,
  },
  filterChipActive: {
    backgroundColor: Colors.accent.highlight,
    borderColor: Colors.accent.highlight,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8d95ad",
  },
  filterChipTextActive: {
    color: "#000",
    fontWeight: "700",
  },

  scrollContent: {
    paddingVertical: 12,
    paddingBottom: 40,
  },

  /* earnings card */
  earningsCard: {
    marginHorizontal: 12,
    backgroundColor: "#1a1d29",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2a2f3f",
    marginBottom: 14,
  },
  earningsTop: {
    alignItems: "center",
    marginBottom: 12,
  },
  earningsLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#8d95ad",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  earningsTotal: {
    fontSize: 30,
    fontWeight: "800",
    color: Colors.accent.highlight,
    marginTop: 2,
  },

  /* method pills */
  methodRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 12,
  },
  methodPill: {
    flex: 1,
    minWidth: "22%",
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#151821",
    borderWidth: 1,
    gap: 2,
  },
  methodPillLabel: {
    fontSize: 9,
    fontWeight: "600",
    color: "#8d95ad",
  },
  methodPillAmount: {
    fontSize: 12,
    fontWeight: "800",
  },

  /* status row */
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    backgroundColor: "#151821",
    borderRadius: 10,
    paddingVertical: 8,
  },
  statusItem: {
    alignItems: "center",
    gap: 2,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusCount: {
    fontSize: 14,
    fontWeight: "800",
    color: "#fff",
  },
  statusLabel: {
    fontSize: 9,
    fontWeight: "600",
    color: "#6b7280",
  },
  statusDivider: {
    width: 1,
    height: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
  },

  /* loading / empty */
  loadingWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 12,
    color: "#8d95ad",
  },
  emptyWrap: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 6,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#6b7280",
  },
  emptySubtext: {
    fontSize: 12,
    color: "#4b5563",
  },
  paginationInfo: {
    alignItems: "center",
    paddingVertical: 12,
  },
  paginationText: {
    fontSize: 11,
    color: "#6b7280",
    fontWeight: "600",
  },
});

export default JobHistoryScreen;
