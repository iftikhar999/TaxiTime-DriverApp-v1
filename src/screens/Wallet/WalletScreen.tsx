import { useNavigation } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import MCIcon from "react-native-vector-icons/MaterialCommunityIcons";
import { useAuth } from "../../context/AuthContext";
import { useShift } from "../../context/ShiftContext";
import {
  fetchWalletBalance,
  fetchWalletSettlements,
  fetchWalletTransactions,
  WalletBalance,
  Settlement,
  WalletTransaction,
} from "../../services/driverService";
import { getSocket } from "../../services/driverSocket";
import { CURRENCY_SYMBOL } from "../../config/currency";
import { Colors } from "../../theme/colors";

/* ── helpers ────────────────────────────────────────── */

const fmt = (n: number, symbol = CURRENCY_SYMBOL) => {
  const abs = Math.abs(n);
  const str = abs.toFixed(2);
  return n < 0 ? `-${symbol} ${str}` : `${symbol} ${str}`;
};

const pct = (n: number) => `${n.toFixed(1)}%`;

/* ── component ──────────────────────────────────────── */

const WalletScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { driver } = useAuth();
  const { activeShift } = useShift();

  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ── load wallet data from server ── */
  // Issue each fetch independently: if settlements 500s we still want the
  // balance + transactions on screen. A blocking all-or-nothing load used to
  // leave the driver staring at an Alert for any transient failure.
  const loadWalletData = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh) setLoading(true);
    setError(null);
    const [balanceRes, settRes, txRes] = await Promise.allSettled([
      fetchWalletBalance(),
      fetchWalletSettlements({ limit: 10 }),
      fetchWalletTransactions({ limit: 20 }),
    ]);

    if (balanceRes.status === "fulfilled") {
      setBalance(balanceRes.value);
    }
    if (settRes.status === "fulfilled") {
      setSettlements(settRes.value.data);
    }
    if (txRes.status === "fulfilled") {
      setTransactions(txRes.value.data);
    }

    const failures = [balanceRes, settRes, txRes].filter(
      (r): r is PromiseRejectedResult => r.status === "rejected"
    );
    if (failures.length > 0) {
      const firstErr: any = failures[0].reason;
      const msg =
        firstErr?.response?.data?.error ||
        firstErr?.message ||
        "Failed to load some wallet data";
      setError(msg);
      // Only fire the blocking alert when *everything* failed; otherwise the
      // partial screen + inline error banner is less disruptive.
      if (!forceRefresh && failures.length === 3) {
        Alert.alert("Wallet Error", msg, [
          { text: "Retry", onPress: () => loadWalletData() },
          { text: "OK" },
        ]);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadWalletData();
  }, [loadWalletData]);

  /* ── Real-time earnings updates via socket ── */
  useEffect(() => {
    let socket: any = null;
    try {
      socket = getSocket();
    } catch {
      // Socket not available yet
    }
    if (!socket) return;

    const handleEarningsUpdate = (data: any) => {
      // Refresh wallet data when earnings update arrives
      loadWalletData(true);
    };

    socket.on("earnings:updated", handleEarningsUpdate);
    return () => {
      socket?.off("earnings:updated", handleEarningsUpdate);
    };
  }, [loadWalletData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadWalletData(true);
    setRefreshing(false);
  }, [loadWalletData]);

  const cp = balance?.currentPeriod;
  const shiftEarnings = activeShift?.stats?.totalEarnings ?? 0;
  const shiftTrips = activeShift?.stats?.totalRides ?? 0;

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
        <Text style={styles.headerTitle}>Wallet & Earnings</Text>
        <View style={{ width: 36 }} />
      </View>

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
        {loading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.accent.highlight} />
            <Text style={styles.loadingText}>Loading wallet data...</Text>
          </View>
        ) : balance && cp ? (
          <>
            {/* ── Driver Type Badge ── */}
            <View style={styles.driverTypeBadge}>
              <MCIcon
                name={balance.driverType === "CONTRACTOR" ? "account-hard-hat" : "account-tie"}
                size={16}
                color={Colors.accent.highlight}
              />
              <Text style={styles.driverTypeText}>
                {balance.driverType === "CONTRACTOR"
                  ? `Contractor · ${pct(balance.commissionPct)} commission`
                  : `Employee · ${balance.fixedPayPerRide ? fmt(balance.fixedPayPerRide) + '/ride' : pct(balance.commissionPct)}`}
              </Text>
              <Text style={styles.payoutFreqText}>
                Payout: {balance.payoutFrequency}
              </Text>
            </View>

            {/* ── Net Balance Card ── */}
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Net Balance</Text>
              <Text
                style={[
                  styles.balanceAmount,
                  (balance.runningBalance ?? cp.netBalance) >= 0
                    ? styles.balancePositive
                    : styles.balanceNegative,
                ]}
              >
                {fmt(balance.runningBalance ?? cp.netBalance)}
              </Text>
              <Text style={styles.balanceHint}>
                {(balance.runningBalance ?? cp.netBalance) > 0
                  ? "Company owes you"
                  : (balance.runningBalance ?? cp.netBalance) < 0
                  ? "You owe to company"
                  : "Settled up"}
              </Text>
              {balance.previousUnpaid !== 0 && (
                <Text style={styles.balanceCarryOver}>
                  Includes {fmt(balance.previousUnpaid)} carry-over
                </Text>
              )}
            </View>

            {/* ── Owes Summary ── */}
            <View style={styles.oweRow}>
              <View style={[styles.oweCard, styles.oweCardGreen]}>
                <MCIcon name="arrow-down-bold-circle" size={20} color="#4ade80" />
                <Text style={styles.oweLabel}>Company Owes You</Text>
                <Text style={[styles.oweAmount, { color: "#4ade80" }]}>
                  {fmt(cp.companyOwesDriver)}
                </Text>
                <Text style={styles.oweHint}>
                  {balance.driverType === "CONTRACTOR"
                    ? "Non-cash minus commission"
                    : "Fixed pay earned"}
                </Text>
              </View>
              <View style={[styles.oweCard, styles.oweCardRed]}>
                <MCIcon name="arrow-up-bold-circle" size={20} color="#f87171" />
                <Text style={styles.oweLabel}>You Owe Company</Text>
                <Text style={[styles.oweAmount, { color: "#f87171" }]}>
                  {fmt(cp.driverOwesCompany)}
                </Text>
                <Text style={styles.oweHint}>
                  {balance.driverType === "CONTRACTOR"
                    ? "Cash commission"
                    : `Cash collected${balance.weeklyRent > 0 ? " + rent" : ""}`}
                </Text>
              </View>
            </View>

            {/* ── Current Period Stats ── */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MCIcon name="calendar-today" size={16} color={Colors.accent.highlight} />
                <Text style={styles.sectionTitle}>Current Period</Text>
              </View>
              <View style={styles.statsGrid}>
                <StatTile
                  icon="cash-multiple"
                  label="Total Fare"
                  value={fmt(cp.totalFare)}
                  color="#4ade80"
                />
                <StatTile
                  icon="car"
                  label="Trips"
                  value={String(cp.totalTrips)}
                  color="#38bdf8"
                />
                <StatTile
                  icon="percent"
                  label={balance.driverType === "CONTRACTOR" ? "Commission" : "Pay Earned"}
                  value={fmt(balance.driverType === "CONTRACTOR" ? cp.commissionAmount : cp.fixedPayTotal)}
                  color="#f97316"
                />
                <StatTile
                  icon="steering"
                  label="Shift Trips"
                  value={String(shiftTrips)}
                  color="#a78bfa"
                />
              </View>
            </View>

            {/* ── Payment Method Breakdown ── */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MCIcon name="credit-card-multiple" size={16} color={Colors.accent.highlight} />
                <Text style={styles.sectionTitle}>Payment Breakdown</Text>
              </View>
              <View style={styles.breakdownList}>
                <BreakdownRow
                  icon="cash"
                  label="Cash"
                  amount={cp.cashCollected}
                  detail={`${balance.driverType === "CONTRACTOR" ? `${pct(balance.commissionPct)} commission applies` : "Returned to company"}`}
                  color="#4ade80"
                />
                <BreakdownRow
                  icon="credit-card-outline"
                  label="Card"
                  amount={cp.cardTotal}
                  detail={balance.driverType === "CONTRACTOR" ? `You keep ${pct(100 - balance.commissionPct)}` : "Company collects"}
                  color="#38bdf8"
                />
                <BreakdownRow
                  icon="contactless-payment"
                  label="EPOS / Terminal"
                  amount={cp.eposTotal}
                  detail={balance.driverType === "CONTRACTOR" ? `You keep ${pct(100 - balance.commissionPct)}` : "Company collects"}
                  color="#818cf8"
                />
                <BreakdownRow
                  icon="wallet-outline"
                  label="Account / Wallet"
                  amount={cp.accountTotal}
                  detail={balance.driverType === "CONTRACTOR" ? `You keep ${pct(100 - balance.commissionPct)}` : "Company collects"}
                  color="#a78bfa"
                />
              </View>
            </View>

            {/* ── Commission / Pay Info ── */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <MCIcon name="information-outline" size={16} color={Colors.accent.highlight} />
                <Text style={styles.sectionTitle}>
                  {balance.driverType === "CONTRACTOR" ? "Commission Details" : "Pay Details"}
                </Text>
              </View>
              <View style={styles.commissionCard}>
                {balance.driverType === "CONTRACTOR" ? (
                  <>
                    <InfoRow label="Commission Rate" value={pct(balance.commissionPct)} />
                    <InfoRow label="Total Commission" value={fmt(cp.commissionAmount)} />
                    <InfoRow label="You Own Vehicle" value={balance.ownsVehicle ? "Yes" : "No"} />
                  </>
                ) : (
                  <>
                    <InfoRow label="Pay Per Ride" value={balance.fixedPayPerRide ? fmt(balance.fixedPayPerRide) : "N/A"} />
                    <InfoRow label="Total Pay Earned" value={fmt(cp.fixedPayTotal)} />
                    {balance.weeklyRent > 0 && (
                      <InfoRow label="Weekly Vehicle Rent" value={fmt(balance.weeklyRent)} />
                    )}
                  </>
                )}
              </View>
            </View>

            {/* ── Recent Settlements ── */}
            {settlements.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MCIcon name="history" size={16} color={Colors.accent.highlight} />
                  <Text style={styles.sectionTitle}>Recent Settlements</Text>
                </View>
                <View style={styles.breakdownList}>
                  {settlements.map((s) => (
                    <View key={s.id} style={styles.settlementRow}>
                      <View style={styles.settlementMeta}>
                        <Text style={styles.settlementPeriod}>
                          {new Date(s.periodStart).toLocaleDateString()} – {new Date(s.periodEnd).toLocaleDateString()}
                        </Text>
                        <Text style={styles.settlementSub}>
                          {s.totalTrips} trips · {s.periodType}
                        </Text>
                      </View>
                      <View style={styles.settlementRight}>
                        <Text
                          style={[
                            styles.settlementAmount,
                            { color: s.netBalance >= 0 ? "#4ade80" : "#f87171" },
                          ]}
                        >
                          {fmt(s.netBalance)}
                        </Text>
                        <View
                          style={[
                            styles.statusBadge,
                            {
                              backgroundColor:
                                s.status === "PAID"
                                  ? "rgba(74, 222, 128, 0.15)"
                                  : s.status === "APPROVED"
                                  ? "rgba(56, 189, 248, 0.15)"
                                  : s.status === "DISPUTED"
                                  ? "rgba(248, 113, 113, 0.15)"
                                  : "rgba(141, 149, 173, 0.15)",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusText,
                              {
                                color:
                                  s.status === "PAID"
                                    ? "#4ade80"
                                    : s.status === "APPROVED"
                                    ? "#38bdf8"
                                    : s.status === "DISPUTED"
                                    ? "#f87171"
                                    : "#8d95ad",
                              },
                            ]}
                          >
                            {s.status}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ── Wallet Transactions Ledger ── */}
            {transactions.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <MCIcon name="swap-vertical" size={16} color={Colors.accent.highlight} />
                  <Text style={styles.sectionTitle}>Recent Transactions</Text>
                </View>
                <View style={styles.breakdownList}>
                  {transactions.map((tx) => {
                    const isCredit = tx.type === "CREDIT" || tx.type === "BONUS" || tx.type === "REFUND";
                    const iconName =
                      tx.type === "CREDIT" ? "arrow-down-bold" :
                      tx.type === "COMMISSION" ? "percent-outline" :
                      tx.type === "DEBIT" ? "arrow-up-bold" :
                      tx.type === "BONUS" ? "star" :
                      tx.type === "PENALTY" ? "alert-circle" :
                      tx.type === "REFUND" ? "undo" : "swap-horizontal";
                    const color = isCredit ? "#4ade80" : "#f87171";

                    return (
                      <View key={tx.id} style={styles.transactionRow}>
                        <View style={[styles.breakdownIcon, { backgroundColor: `${color}15` }]}>
                          <MCIcon name={iconName as any} size={16} color={color} />
                        </View>
                        <View style={styles.breakdownMeta}>
                          <Text style={styles.breakdownLabel}>
                            {tx.type} {tx.paymentMethod ? `· ${tx.paymentMethod}` : ""}
                          </Text>
                          <Text style={styles.breakdownSub} numberOfLines={1}>
                            {tx.description || (tx.jobId ? `Job ${tx.jobId.slice(0, 8)}...` : "")}
                          </Text>
                          <Text style={[styles.breakdownSub, { fontSize: 10 }]}>
                            {new Date(tx.createdAt).toLocaleString()}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={[styles.breakdownAmount, { color }]}>
                            {isCredit ? "+" : "-"}{fmt(tx.amount)}
                          </Text>
                          <Text style={[styles.breakdownSub, { fontSize: 10 }]}>
                            Bal: {fmt(tx.balanceAfter)}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </>
        ) : (
          <View style={styles.loadingContainer}>
            <MCIcon name="wallet-outline" size={48} color="#8d95ad" />
            <Text style={styles.loadingText}>
              {error ? error : "No wallet data available yet"}
            </Text>
            {error && (
              <TouchableOpacity onPress={() => loadWalletData()} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

/* ── sub-components ──────────────────────────────────── */

const StatTile: React.FC<{
  icon: string;
  label: string;
  value: string;
  color: string;
}> = ({ icon, label, value, color }) => (
  <View style={styles.statTile}>
    <MCIcon name={icon as any} size={18} color={color} />
    <Text style={styles.statTileValue}>{value}</Text>
    <Text style={styles.statTileLabel}>{label}</Text>
  </View>
);

const BreakdownRow: React.FC<{
  icon: string;
  label: string;
  amount: number;
  detail: string;
  color: string;
}> = ({ icon, label, amount, detail, color }) => (
  <View style={styles.breakdownItem}>
    <View style={[styles.breakdownIcon, { backgroundColor: `${color}15` }]}>
      <MCIcon name={icon as any} size={18} color={color} />
    </View>
    <View style={styles.breakdownMeta}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      <Text style={styles.breakdownSub}>{detail}</Text>
    </View>
    <Text style={[styles.breakdownAmount, { color }]}>{fmt(amount)}</Text>
  </View>
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={styles.infoValue}>{value}</Text>
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
  scrollContent: {
    padding: 12,
    paddingBottom: 40,
  },
  loadingContainer: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: "#8d95ad",
  },

  /* driver type badge */
  driverTypeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1d29",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  driverTypeText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
  },
  payoutFreqText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#8d95ad",
  },

  /* balance */
  balanceCard: {
    backgroundColor: "#1a1d29",
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  balanceLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8d95ad",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: "800",
  },
  balancePositive: {
    color: "#4ade80",
  },
  balanceNegative: {
    color: "#f87171",
  },
  balanceHint: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 4,
  },
  balanceCarryOver: {
    fontSize: 10,
    color: "#f97316",
    marginTop: 4,
  },

  /* owes */
  oweRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  oweCard: {
    flex: 1,
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
  },
  oweCardGreen: {
    backgroundColor: "rgba(74, 222, 128, 0.06)",
    borderColor: "rgba(74, 222, 128, 0.15)",
  },
  oweCardRed: {
    backgroundColor: "rgba(248, 113, 113, 0.06)",
    borderColor: "rgba(248, 113, 113, 0.15)",
  },
  oweLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#8d95ad",
  },
  oweAmount: {
    fontSize: 20,
    fontWeight: "800",
  },
  oweHint: {
    fontSize: 9,
    color: "#6b7280",
  },

  /* section */
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },

  /* stats grid */
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statTile: {
    flex: 1,
    minWidth: "45%",
    backgroundColor: "#1a1d29",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "#2a2f3f",
  },
  statTileValue: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
  },
  statTileLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "#8d95ad",
  },

  /* breakdown */
  breakdownList: {
    backgroundColor: "#1a1d29",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a2f3f",
    overflow: "hidden",
  },
  breakdownItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2f3f",
  },
  breakdownIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  breakdownMeta: {
    flex: 1,
  },
  breakdownLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
  },
  breakdownSub: {
    fontSize: 10,
    color: "#6b7280",
    marginTop: 1,
  },
  breakdownAmount: {
    fontSize: 15,
    fontWeight: "800",
  },

  /* commission / info card */
  commissionCard: {
    backgroundColor: "#1a1d29",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2a2f3f",
    gap: 8,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLabel: {
    fontSize: 13,
    color: "#8d95ad",
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },

  /* settlements */
  settlementRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2f3f",
  },
  settlementMeta: {
    flex: 1,
  },
  settlementPeriod: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  settlementSub: {
    fontSize: 10,
    color: "#6b7280",
    marginTop: 2,
  },
  settlementRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  settlementAmount: {
    fontSize: 15,
    fontWeight: "800",
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  /* transactions */
  transactionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2f3f",
  },

  /* retry button */
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: Colors.accent.highlight,
    borderRadius: 8,
  },
  retryText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
});

export default WalletScreen;
