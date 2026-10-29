import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import { formatToSingaporeDate, formatToSingaporeTime } from "../utils/timezoneHelper";

interface TransactionCardProps {
  item: any;
  onPress: (item: any) => void;
  formatOrderId: (order: any) => string;
  formatCurrency: (amount: number) => string;
}

const TransactionCard = React.memo(
  ({ item, onPress, formatOrderId, formatCurrency }: TransactionCardProps) => {
    const { width: SCREEN_W } = useWindowDimensions();

    const modeUpper = String(item.PayMode || "").toUpperCase().trim();
    const isSplitMode = modeUpper.includes("+");
    const isUpi = !isSplitMode && (modeUpper.includes("UPI") || modeUpper.includes("GPAY"));
    const isYeahpayPaynow = !isSplitMode && modeUpper.includes("YEAHPAY PAYNOW");
    const isYeahpayCard = !isSplitMode && modeUpper.includes("YEAHPAY CARD");
    const isPayNow = !isSplitMode && modeUpper.includes("PAYNOW");
    const isNets = !isSplitMode && modeUpper.includes("NETS");

    return (
      <TouchableOpacity
        onPress={() => onPress(item)}
        style={[
          styles.transactionCard,
          (item.DiscountAmount > 0 || (item.TotalDiscountAmount && item.TotalDiscountAmount > 0) || (item.TotalLineItemDiscountAmount && item.TotalLineItemDiscountAmount > 0)) && {
            borderColor: Theme.success,
            borderWidth: 1.2,
            backgroundColor: Theme.successBg,
          },
          (item.VoidAmount > 0 || item.IsCancelled) && {
            borderColor: Theme.danger,
            borderWidth: 1.2,
            backgroundColor: Theme.dangerBg,
          },
        ]}
      >
        <View style={styles.txIconWrap}>
          <Ionicons
            name={
              isSplitMode
                ? "git-compare-outline"
                : modeUpper === "CASH"
                ? "cash-outline"
                : modeUpper === "MEMBER"
                ? "person-outline"
                : modeUpper === "CREDIT"
                ? "pricetag-outline"
                : isUpi
                ? "flash-outline"
                : isYeahpayPaynow
                ? "qr-code-outline"
                : isYeahpayCard
                ? "card-outline"
                : isPayNow
                ? "qr-code-outline"
                : isNets
                ? "grid-outline"
                : "card-outline"
            }
            size={16}
            color={
              isSplitMode
                ? "#ea580c"
                : modeUpper === "CASH"
                ? "#22c55e"
                : modeUpper === "MEMBER"
                ? "#ec4899"
                : modeUpper === "CREDIT"
                ? "#e11d48"
                : isUpi
                ? "#a855f7"
                : isYeahpayPaynow
                ? "#f97316"
                : isYeahpayCard
                ? "#818cf8"
                : isPayNow
                ? "#f97316"
                : isNets
                ? "#3b82f6"
                : "#818cf8"
            }
          />
        </View>
        <View style={styles.txOrderInfo}>
          <Text style={styles.txTitle} numberOfLines={1}>
            {item.OrderType === "LEDGER" 
              ? `${item.OrderId || (item.CustomerType === 'MEMBER' ? 'Member Payment Collected' : 'Credit Payment Collected')}: ${item.Section || 'Customer'}`
              : (SCREEN_W < 450 ? `#${formatOrderId(item).split("-").pop()}` : `Order #${formatOrderId(item)}`)}
          </Text>
          {item.OrderType !== "LEDGER" && item.CustomerName && (modeUpper === "CREDIT" || modeUpper === "MEMBER") && (
            <Text style={styles.txMemberName}>
              {modeUpper === "CREDIT" ? "Credit Customer: " : "Member: "}{item.CustomerName}
            </Text>
          )}
          {item.OrderType === "DINE-IN" && item.GuestName && (
            <Text style={styles.txMemberName}>
              Guest Name: {item.GuestName}
            </Text>
          )}
          {item.OrderType === "DINE-IN" && item.Pax && (
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
              <Ionicons name="people-outline" size={10} color={Theme.textSecondary} />
              <Text style={[styles.txSmall, { marginLeft: 4, fontFamily: Fonts.bold }]}>
                {item.Pax} Pax
              </Text>
            </View>
          )}
          <Text style={styles.txSmall} numberOfLines={1}>
            {item.OrderType === "LEDGER"
              ? (item.CreditOrderNo
                  ? `Order #${item.CreditOrderNo}`
                  : `${
                      modeUpper === "CASH"
                        ? "💵"
                        : modeUpper === "MEMBER"
                        ? "👤"
                        : modeUpper === "CREDIT"
                        ? "🏷️"
                        : isUpi
                        ? "⚡"
                        : isYeahpayPaynow
                        ? "📱"
                        : isYeahpayCard
                        ? "💳"
                        : isPayNow
                        ? "📱"
                        : isNets
                        ? "🔳"
                        : "💳"
                    } Member Account Settlement`
                )
              : `${item.OrderType === "TAKEAWAY" ? "🛍️ Takeaway" : `🪑 Table ${item.TableNo || "N/A"}`}${(item.entryStatus === "q" || item.entry_status === "q" || item.isQROrder) ? " • 📱 QR" : ""} • ${
                  isSplitMode
                    ? (item.PayMode || "Split").trim()
                    : modeUpper === "CASH"
                    ? "Cash"
                    : modeUpper === "MEMBER"
                    ? "Member"
                    : modeUpper === "CREDIT"
                    ? "Credit"
                    : isUpi
                    ? "UPI"
                    : isYeahpayPaynow
                    ? "Yeahpay Paynow"
                    : isYeahpayCard
                    ? "Yeahpay Card"
                    : isPayNow
                    ? "PayNow"
                    : isNets
                    ? "NETS"
                    : (item.PayMode || "Other").trim()
                }`}
            {item.CashierName ? ` • By: ${item.CashierName}` : (item.SER_NAME && item.OrderType !== "LEDGER" ? ` • ${item.SER_NAME}` : "")}
          </Text>
          {(item.isMerged || item.isSplit) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {item.isMerged && (
                <View style={styles.mergedBadge}>
                  <Ionicons name="git-merge-outline" size={9} color="#ea580c" />
                  <Text style={styles.mergedBadgeText}>Merged</Text>
                </View>
              )}
              {item.isSplit && (
                <View style={styles.splitBadge}>
                  <Ionicons name="cut-outline" size={9} color="#2563eb" />
                  <Text style={styles.splitBadgeText}>Split: {item.splitNo || 'Yes'}</Text>
                </View>
              )}
            </View>
          )}
        </View>
        <View style={styles.txRightInfo}>
          <Text style={[styles.txAmount, item.IsCancelled && { color: Theme.danger, textDecorationLine: 'line-through' }]}>
            {formatCurrency(item.SysAmount || 0)}
          </Text>
          <Text style={styles.txDatetime}>
            {formatToSingaporeDate(item.SettlementDate)} • {formatToSingaporeTime(item.SettlementDate)}
          </Text>
          {/* Only show Pending for CREDIT customers — Members are prepaid */}
          {item.OutstandingAmount !== undefined && Number(item.OutstandingAmount) > 0 && !item.IsCancelled && modeUpper !== "MEMBER" && (
            <Text style={{ fontSize: 9, fontFamily: Fonts.black, color: "#e11d48", marginTop: 2 }}>
              Pending: {formatCurrency(Number(item.OutstandingAmount))}
            </Text>
          )}
        </View>
        <View style={styles.paidIndicator}>
           {item.IsCancelled || item.VoidAmount > 0 ? (
             <Ionicons name="close-circle" size={16} color={Theme.danger} />
           ) : item.OrderType !== "LEDGER" && modeUpper === "CREDIT" && Number(item.OutstandingAmount) > 0 ? (
             Number(item.OutstandingAmount) === Number(item.SysAmount) ? (
               <Ionicons name="alert-circle" size={16} color="#e11d48" />
             ) : (
               <Ionicons name="time" size={16} color="#f59e0b" />
             )
           ) : (
             <Ionicons name="checkmark-circle" size={16} color={Theme.success} />
           )}
        </View>
      </TouchableOpacity>
    );
  },
);

const styles = StyleSheet.create({
  transactionCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.bgCard,
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowSm,
  },
  txIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: Theme.bgMuted,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  txOrderInfo: { flex: 1, marginRight: 8 },
  txTitle: {
    fontSize: 14,
    fontFamily: Fonts.extraBold,
    color: Theme.textPrimary,
  },
  txSmall: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.textMuted,
    marginTop: 2,
  },
  txDatetime: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: Theme.textMuted,
    marginTop: 2,
  },
  txRightInfo: { alignItems: "flex-end", marginRight: 10 },
  txAmount: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  paidIndicator: {
    justifyContent: "center",
    alignItems: "center",
  },
  voidTag: {
    backgroundColor: Theme.danger + "15",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: Theme.danger + "30",
  },
  voidTagText: {
    color: Theme.danger,
    fontSize: 10,
    fontFamily: Fonts.black,
  },
  paidBadgeSmall: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Theme.success + "15",
    justifyContent: "center",
    alignItems: "center",
  },
  cancelledBadge: {
    backgroundColor: Theme.danger + "15",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Theme.danger + "30",
    alignItems: 'center',
  },
  cancelledBadgeText: {
    color: Theme.danger,
    fontSize: 9,
    fontFamily: Fonts.black,
  },
  cancelledReason: {
    color: Theme.danger,
    fontSize: 10,
    fontFamily: Fonts.bold,
    marginTop: 2,
    fontStyle: 'italic',
  },
  mergedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    borderColor: '#ffedd5',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 3,
  },
  mergedBadgeText: {
    color: '#ea580c',
    fontSize: 9,
    fontFamily: Fonts.black,
  },
  splitBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderColor: '#dbeafe',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    gap: 3,
  },
  splitBadgeText: {
    color: '#2563eb',
    fontSize: 9,
    fontFamily: Fonts.black,
  },
  txMemberName: {
    fontSize: 11.5,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginTop: 2,
  },
});

export default TransactionCard;
