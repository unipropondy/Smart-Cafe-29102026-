import React, { useEffect, useState, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  ActivityIndicator,
  Modal,
  Alert,
  Animated,
  Easing,
} from "react-native";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { Fonts } from "../../constants/Fonts";
import { Theme } from "../../constants/theme";
import UPIPaymentModal from "./UPIPaymentModal";
import PayNowPaymentModal from "./PayNowPaymentModal";
import { API_URL } from "@/constants/Config";  // ✅ ADD
import { useToast } from "../Toast";  
import { CustomerDisplaySync } from "../../utils/CustomerDisplaySync";
import { useCartStore } from "../../stores/cartStore";
import { useOrderContextStore } from "../../stores/orderContextStore";
import { usePaymentSettingsStore } from "../../stores/paymentSettingsStore";
import { useAuthStore } from "../../stores/authStore";
import { useTerminalPaymentStore } from "../../stores/terminalPaymentStore";

// Module-level map: persists split terminal sessions across component unmounts.
// Keyed by tableId (same key used in useTerminalPaymentStore).
const ongoingSplitSessions: Record<string, {
  status: "processing" | "success" | "cancelled" | "failed";
  splitRowId: string;
  amount: number;
  payMode: string;
  onUpdate?: (status: "processing" | "success" | "cancelled" | "failed", message?: string) => void;
}> = {};
const formatMoney = (symbol: string, amount: number) => {
  try {
    return `${symbol}${(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch (e) {
    return `${symbol}${(amount || 0).toFixed(2)}`;
  }
};

// --- ROTATING SYNC ICON COMPONENT ---
const RotatingSyncIcon = ({ size = 16, color = "#3b82f6" }: { size?: number; color?: string }) => {
  const spinValue = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Ionicons name="sync" size={size} color={color} />
    </Animated.View>
  );
};

export type SplitPaymentRow = {
  id: string;
  payModeId: number;
  payMode: string;
  amount: string;
  referenceNo: string;
  status: "Paid" | "Pending" | "Cancelled";
  terminalStatus?: "idle" | "processing" | "success" | "cancelled" | "failed";
  terminalMsg?: string;
};

type PaymentMethodType = {
  payMode: string;
  description: string;
  position: number;
  deviceSn?: string | null;    // ✅ ADD THIS
  deviceSalt?: string | null;
  yeahPayEnabled?: boolean;
};

interface SplitPaymentComponentProps {
  targetTotal: number;
  paymentMethods: PaymentMethodType[];
  onComplete: (
    payments: Array<{ payModeId: number; payMode: string; amount: number; referenceNo?: string }>,
    focAmount?: number
  ) => void;
  onCancel: () => void;
  processing: boolean;
  setProcessing?: (value: boolean) => void;
  memberFlow?: boolean;
  currencySymbol?: string;
  selectedMember?: any;
  onSelectMember?: (payMode?: string) => void;
}

// ─── Payment mode helpers — use EXACT normalized comparisons only ───────────
// Never use .includes() for payment mode routing; substring checks cause
// "Yeahpay Paynow" and "Yeahpay Card" to bleed into the wrong flows.

const normalizeMode = (modeName: string): string =>
  (modeName ?? "").trim().toUpperCase();

/** true ONLY for payment mode exactly named "PAYNOW" (any casing) */
const isNormalPayNow = (modeName: string): boolean =>
  normalizeMode(modeName) === "PAYNOW";

/** true ONLY for "Yeahpay Paynow" — terminal-based PayNow */
const isYeahPayPayNow = (modeName: string): boolean =>
  normalizeMode(modeName) === "YEAHPAY PAYNOW";

/** true ONLY for "Yeahpay Card" — terminal-based Card */
const isYeahPayCard = (modeName: string): boolean =>
  normalizeMode(modeName) === "YEAHPAY CARD";

/** true for EITHER YeahPay terminal mode — these are the ONLY modes
 *  that should ask for Device SN or call the terminal */
const isYeahPayTerminal = (modeName: string): boolean =>
  isYeahPayPayNow(modeName) || isYeahPayCard(modeName);

/** true for NETS terminal modes (NETS / NETS CARD / NETS QR) */
const isNetsTerminal = (modeName: string): boolean => {
  const n = normalizeMode(modeName);
  return n === "NETS" || n === "NETS CARD" || n === "NETS QR";
};

/** Modes that trigger a terminal call (YeahPay or NETS ECR II) */
const needsTerminalCall = (modeName: string): boolean =>
  isYeahPayTerminal(modeName) || isNetsTerminal(modeName);

/** UPI-style modes that open the UPI QR modal */
const isUpiMode = (modeName: string): boolean => {
  const n = normalizeMode(modeName);
  return n === "UPI" || n === "GPAY" || n.startsWith("PHONE") || n === "PAYTM";
};

export default function SplitPaymentComponent({
  targetTotal,
  paymentMethods,
  onComplete,
  onCancel,
  processing,
  memberFlow = false,
  currencySymbol = "$",
  selectedMember = null,
  onSelectMember,
}: SplitPaymentComponentProps) {
  const [rows, setRows] = useState<SplitPaymentRow[]>([]);
  const context = useOrderContextStore((s) => s.currentOrder);
  const tableId = context?.tableId?.toString();

  const storeSplitRows = useTerminalPaymentStore(
    (s) => tableId ? s.splitRows[tableId] : undefined
  );

  useEffect(() => {
    if (storeSplitRows && storeSplitRows.length > 0) {
      const rowsChanged = JSON.stringify(storeSplitRows) !== JSON.stringify(rows);
      if (rowsChanged) {
        setRows(storeSplitRows);
      }
    }
  }, [storeSplitRows]);

  const [activeDropdownRowId, setActiveDropdownRowId] = useState<string | null>(null);

  // Digital verification modal states
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [qrModalType, setQrModalType] = useState<"PAYNOW" | "UPI" | null>(null);
  const [qrModalAmount, setQrModalAmount] = useState(0);
  const [activeQrRowId, setActiveQrRowId] = useState<string | null>(null);
const { showToast } = useToast();  
const [isGeneratingQR, setIsGeneratingQR] = useState(false);
  // Filter payment methods: for member collections, we shouldn't allow paying with MEMBER credit
  const availableMethods = useMemo(() => {
    if (memberFlow) {
      return paymentMethods.filter(
        (m) => m.payMode.toUpperCase().trim() !== "MEMBER" && m.payMode.toUpperCase().trim() !== "CREDIT"
      );
    }
    return paymentMethods;
  }, [paymentMethods, memberFlow]);

  // Helper: FOC rows are discounts, not real payments (Disabled: FOC is now a regular paymode)
  const isFocRow = (r: SplitPaymentRow) => String(r.payMode || "").trim().toUpperCase() === "FOC";

  // Sum of ALL rows (including FOC) — used for validation and balance
  const totalAllRows = useMemo(() => {
    return rows.reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);
  }, [rows]);

  // Sum of all rows — actual payment collected (including FOC)
  const totalPaid = useMemo(() => {
    return rows.reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);
  }, [rows]);

  // Remaining balance: how much of the bill is still uncovered by any row
  const remainingBalance = useMemo(() => {
    return Math.max(0, targetTotal - totalAllRows);
  }, [targetTotal, totalAllRows]);

  // Sync to customer display
  useEffect(() => {
    if (rows.length === 0) return;
    try {
      const context = useOrderContextStore.getState().currentOrder;
      const currentContextId = useCartStore.getState().currentContextId;
      const cart = (currentContextId ? useCartStore.getState().carts[currentContextId] : []) || [];
      const gstPercentage = usePaymentSettingsStore.getState().settings.gstPercentage || 0;

      CustomerDisplaySync.syncCart({
        orderContext: {
          tableId: context?.tableId?.toString(),
          tableNo: context?.tableNo,
          takeawayNo: context?.takeawayNo,
          orderType: context?.orderType || "MANUAL",
          section: context?.section,
          serverId: context?.serverId,
          serverName: context?.serverName,
        },
        cart: cart,
        discountInfo: null,
        gstPercentage: gstPercentage,
        roundOff: 0,
        active: true,
        isSplit: true,
        splitPayments: rows.map((r) => ({
          payMode: r.payMode,
          amount: parseFloat(r.amount) || 0,
          status: r.status,
        })),
        memberName: selectedMember?.Name || "",
      });
    } catch (e) {
      console.error("Failed to sync split payments to customer display:", e);
    }
  }, [rows, selectedMember, targetTotal]);

  // Initial rows: default to 2 payment rows or load from store
  useEffect(() => {
    const context = useOrderContextStore.getState().currentOrder;
    const tableId = context?.tableId?.toString();
    if (tableId && rows.length === 0) {
      const persistedRows = useTerminalPaymentStore.getState().splitRows[tableId];
      if (persistedRows && persistedRows.length > 0) {
        setRows(persistedRows);
        return;
      }
    }

    if (availableMethods.length > 0 && rows.length === 0) {
      const firstMode = availableMethods[0];
      const secondMode = availableMethods.length > 1 ? availableMethods[1] : availableMethods[0];
      
      const firstStatus = "Pending";
      const secondStatus = "Pending";
      
      setRows([
        {
          id: Math.random().toString(36).substring(7),
          payModeId: firstMode.position,
          payMode: firstMode.payMode,
          amount: targetTotal.toFixed(2),
          referenceNo: "",
          status: firstStatus,
          terminalStatus: "idle",
          terminalMsg: "",
        },
        {
          id: Math.random().toString(36).substring(7),
          payModeId: secondMode.position,
          payMode: secondMode.payMode,
          amount: "0.00",
          referenceNo: "",
          status: secondStatus,
          terminalStatus: "idle",
          terminalMsg: "",
        },
      ]);
    }
  }, [availableMethods, targetTotal, rows.length]);

  // Autosave rows to Zustand store for persistence
  useEffect(() => {
    const context = useOrderContextStore.getState().currentOrder;
    const tableId = context?.tableId?.toString();
    if (tableId && rows.length > 0) {
      useTerminalPaymentStore.getState().setSplitRows(tableId, rows);
    }
  }, [rows]);

  // 🚀 RESTORE FLOW: On mount, check if a terminal session completed in the background
  useEffect(() => {
    const context = useOrderContextStore.getState().currentOrder;
    const tableId = context?.tableId?.toString();
    if (!tableId) return;

    const pending = ongoingSplitSessions[tableId];
    if (!pending) return;

    if (pending.status === "success") {
      // Payment succeeded while component was unmounted — auto-mark the row
      setRows(prevRows =>
        prevRows.map(r =>
          r.id === pending.splitRowId
            ? { ...r, status: "Paid", terminalStatus: "success", terminalMsg: `✅ Paid via ${pending.payMode}` }
            : r
        )
      );
      showToast({
        type: "success",
        message: `✅ Payment Successful`,
        subtitle: `$${pending.amount.toFixed(2)} paid via ${pending.payMode}`,
      });
      useTerminalPaymentStore.getState().clearSession(tableId);
      delete ongoingSplitSessions[tableId];
    } else if (pending.status === "processing") {
      // Still running — reconnect the onUpdate callback
      pending.onUpdate = (status, msg) => {
        if (status === "success") {
          setRows(prevRows =>
            prevRows.map(r =>
              r.id === pending.splitRowId
                ? { ...r, status: "Paid", terminalStatus: "success", terminalMsg: `✅ Paid via ${pending.payMode}` }
                : r
            )
          );
          showToast({
            type: "success",
            message: `✅ Payment Successful`,
            subtitle: `$${pending.amount.toFixed(2)} paid via ${pending.payMode}`,
          });
          useTerminalPaymentStore.getState().clearSession(tableId);
          delete ongoingSplitSessions[tableId];
        } else if (status === "cancelled" || status === "failed") {
          setRows(prevRows =>
            prevRows.map(r =>
              r.id === pending.splitRowId
                ? { ...r, terminalStatus: status, terminalMsg: msg || (status === "cancelled" ? "❌ Transaction cancelled" : "❌ Payment failed") }
                : r
            )
          );
          useTerminalPaymentStore.getState().updateSession(tableId, { status, message: msg });
          delete ongoingSplitSessions[tableId];
        }
      };
    } else if (pending.status === "cancelled" || pending.status === "failed") {
      const store = useTerminalPaymentStore.getState();
      const session = store.sessions[tableId];
      const errorMsg = session?.message || (pending.status === "cancelled" ? "❌ Transaction cancelled" : "❌ Payment failed");
      setRows(prevRows =>
        prevRows.map(r =>
          r.id === pending.splitRowId
            ? { ...r, terminalStatus: pending.status, terminalMsg: errorMsg }
            : r
        )
      );
      delete ongoingSplitSessions[tableId];
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check if a row is locked (a verified paid digital row)
  const isRowLocked = (row: SplitPaymentRow) => {
    return row.status === "Paid";
  };

  // Adjust rows when targetTotal changes (rounding etc.) — uses totalAllRows
  useEffect(() => {
    if (rows.length === 0) return;

    const diff = targetTotal - totalAllRows;
    if (Math.abs(diff) < 0.005) return;

    // Adjust last editable non-FOC row
    const editableNonFocRows = rows.filter(r => !isRowLocked(r) && !isFocRow(r));
    if (editableNonFocRows.length > 0) {
      const lastEditable = editableNonFocRows[editableNonFocRows.length - 1];
      setRows(prevRows =>
        prevRows.map(r => {
          if (r.id === lastEditable.id) {
            const currentAmt = parseFloat(r.amount) || 0;
            const newAmt = Math.max(0, currentAmt + diff);
            return { ...r, amount: newAmt.toFixed(2) };
          }
          return r;
        })
      );
    }
  }, [targetTotal]);

  // Get available payment methods for a specific row
  const getAvailableMethodsForRow = (rowId: string) => {
    return availableMethods;
  };

  // Check validations programmatically
  const validationError = useMemo((): string | null => {
    // ALL rows (CASH + FOC) must together cover the full targetTotal.
    // FOC covers its share as a discount; non-FOC rows cover the cash portion.
    const sumDiff = Math.abs(totalAllRows - targetTotal);
    if (sumDiff > 0.01) {
      return `Total paid (${currencySymbol}${totalAllRows.toFixed(2)}) must match target (${currencySymbol}${targetTotal.toFixed(2)})`;
    }

    const totalMemberAmt = rows.reduce((sum, r) => {
      const isMemberMode = r.payMode.toUpperCase().trim() === "MEMBER" || r.payMode.toUpperCase().trim() === "CREDIT";
      return sum + (isMemberMode ? (parseFloat(r.amount) || 0) : 0);
    }, 0);

    for (const r of rows) {
      const amt = parseFloat(r.amount);
      if (isNaN(amt) || amt <= 0) {
        return "Please enter a valid amount greater than zero in all rows.";
      }
      if (!r.payMode) {
        return "Please select a payment mode in all rows.";
      }

      // Member credit validation
      const isMemberMode = r.payMode.toUpperCase().trim() === "MEMBER" || r.payMode.toUpperCase().trim() === "CREDIT";
      if (isMemberMode && !memberFlow) {
        if (!selectedMember) {
          return "Please select a member first to use Member Credit.";
        }
        const availLimit = (selectedMember.CreditLimit || 0) - (selectedMember.CurrentBalance || 0);
        if (totalMemberAmt > availLimit) {
          return `Total member payment (${formatMoney(currencySymbol, totalMemberAmt)}) exceeds available credit limit (${formatMoney(currencySymbol, availLimit)}).`;
        }
      }
    }

    return null;
  }, [rows, totalPaid, targetTotal, selectedMember, memberFlow, currencySymbol]);

  const isValid = useMemo(() => {
    return validationError === null;
  }, [validationError]);

  const handleAddRow = () => {
    if (remainingBalance <= 0) {
      Alert.alert("Fully Paid", "Remaining balance is already zero.");
      return;
    }

    // Find first unused paymode
    const unusedMethods = availableMethods.filter(m => !rows.some(r => r.payModeId === m.position));
    const nextMode = unusedMethods.length > 0 ? unusedMethods[0] : availableMethods[0];
    if (!nextMode) return;

    const initialStatus = "Pending";

    setRows([
      ...rows,
      {
        id: Math.random().toString(36).substring(7),
        payModeId: nextMode.position,
        payMode: nextMode.payMode,
        amount: remainingBalance.toFixed(2),
        referenceNo: "",
        status: initialStatus,
        terminalStatus: "idle",
        terminalMsg: "",
      },
    ]);
  };

  const handleRemoveRow = (id: string) => {
    const targetRow = rows.find(r => r.id === id);
    if (targetRow && isRowLocked(targetRow)) {
      Alert.alert("Locked Row", "This payment has already been verified and cannot be deleted.");
      return;
    }
    setRows(rows.filter((r) => r.id !== id));
  };

  const handleUpdateRow = (id: string, updates: Partial<SplitPaymentRow>) => {
    setRows(prevRows => {
      const rowIndex = prevRows.findIndex(r => r.id === id);
      if (rowIndex === -1) return prevRows;
      const targetRow = prevRows[rowIndex];
      if (isRowLocked(targetRow)) return prevRows;

      const updatedRow = { ...targetRow, ...updates };

      if (updates.payModeId !== undefined) {
        const method = availableMethods.find((m) => m.position === updates.payModeId);
        if (method) {
          updatedRow.payMode = method.payMode;
          updatedRow.status = "Pending";

          // If they selected Member and no member is set, trigger lookup
          const isMember = method.payMode.toUpperCase().trim() === "MEMBER" || method.payMode.toUpperCase().trim() === "CREDIT";
          if (isMember && !selectedMember && onSelectMember) {
            onSelectMember(method.payMode);
          }
        }
      }

      let nextRows = prevRows.map(r => r.id === id ? updatedRow : r);

      if (updates.amount !== undefined) {
        // Clean numeric input
        let cleanVal = updates.amount.replace(/[^0-9.]/g, "");
        const parsedVal = parseFloat(cleanVal) || 0;

        // Cap split row amount to targetTotal
        if (parsedVal > targetTotal) {
          cleanVal = targetTotal.toFixed(2);
        }
        updatedRow.amount = cleanVal;

        const finalParsed = parseFloat(cleanVal) || 0;
        const otherEditableRows = nextRows.filter(
          r => r.id !== id && !isRowLocked(r)
        );

        if (otherEditableRows.length === 1) {
          const otherRow = otherEditableRows[0];
          const otherVal = Math.max(0, targetTotal - finalParsed);
          nextRows = nextRows.map(r => r.id === otherRow.id ? { ...r, amount: otherVal.toFixed(2) } : r);
        } else if (otherEditableRows.length > 1) {
          const lastOtherRow = otherEditableRows[otherEditableRows.length - 1];
          const sumOfOthersExceptLast = nextRows
            .filter(r => r.id !== id && r.id !== lastOtherRow.id)
            .reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
          const lastVal = Math.max(0, targetTotal - finalParsed - sumOfOthersExceptLast);
          nextRows = nextRows.map(r => r.id === lastOtherRow.id ? { ...r, amount: lastVal.toFixed(2) } : r);
        }
      }

      return nextRows;
    });
  };

  const handleOpenDropdown = (row: SplitPaymentRow) => {
    if (isRowLocked(row)) return;
    setActiveDropdownRowId(row.id);
  };

  const handleSelectMode = (method: PaymentMethodType) => {
    if (activeDropdownRowId) {
      handleUpdateRow(activeDropdownRowId, { payModeId: method.position });
      setActiveDropdownRowId(null);
    }
  };

  // Launch digital payment sequential verification
 // components/payment/SplitPaymentComponent.tsx

// SplitPaymentComponent.tsx - Update handleGenerateQR

const handleGenerateQR = async (row: SplitPaymentRow) => {
  const amt = parseFloat(row.amount);
  if (isNaN(amt) || amt <= 0) {
    Alert.alert('Invalid Amount', 'Please enter a valid amount.');
    return;
  }

  setActiveQrRowId(row.id);
  setQrModalAmount(amt);

  // ── Route by EXACT payment mode name ────────────────────────────────────
  // "PAYNOW" (exact) → show static QR popup (no terminal, no SN)
  if (isNormalPayNow(row.payMode)) {
    setQrModalType("PAYNOW");
    setQrModalVisible(true);
    return;
  }

  // 💳 NETS ECR II Terminal (NETS, NETS CARD, NETS QR)
  if (isNetsTerminal(row.payMode)) {
    try {
      setIsGeneratingQR(true);
      setRows(prevRows =>
        prevRows.map(r =>
          r.id === row.id
            ? { ...r, terminalStatus: "processing", terminalMsg: "Please follow prompt on NETS terminal..." }
            : r
        )
      );

      const context = useOrderContextStore.getState().currentOrder;
      const tableId = context?.tableId?.toString();
      const isQr = normalizeMode(row.payMode) === 'NETS QR';

      if (tableId) {
        ongoingSplitSessions[tableId] = {
          status: "processing",
          splitRowId: row.id,
          amount: amt,
          payMode: row.payMode,
        };
        useTerminalPaymentStore.getState().setSession(tableId, {
          tableId,
          status: "processing",
          message: "Processing on NETS terminal...",
          method: row.payMode,
          total: amt,
          splitRowId: row.id,
          isSplit: true,
        });
      }

      const response = await fetch(`${API_URL}/api/nets/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(useAuthStore.getState().token ? { 'Authorization': `Bearer ${useAuthStore.getState().token}` } : {}),
        },
        body: JSON.stringify({
          amount: amt,
          isQrOnTerminal: isQr,
          ecrRef: `SPLIT_${row.id}_${Date.now()}`,
          tableId: tableId || ''
        })
      });

      const result = await response.json();
      console.log('✅ [SplitPayment] NETS response:', result);

      if (result.success || result.isApproved) {
        if (tableId && ongoingSplitSessions[tableId]) {
          ongoingSplitSessions[tableId].status = "success";
          ongoingSplitSessions[tableId].onUpdate?.("success");
          useTerminalPaymentStore.getState().clearSession(tableId);
          delete ongoingSplitSessions[tableId];
        }
        setRows(prevRows =>
          prevRows.map(r =>
            r.id === row.id
              ? {
                  ...r,
                  status: 'Paid',
                  terminalStatus: 'success',
                  terminalMsg: `✅ Paid via ${row.payMode}`
                }
              : r
          )
        );
      } else {
        if (tableId && ongoingSplitSessions[tableId]) {
          useTerminalPaymentStore.getState().clearSession(tableId);
          delete ongoingSplitSessions[tableId];
        }
        setRows(prevRows =>
          prevRows.map(r =>
            r.id === row.id
              ? {
                  ...r,
                  terminalStatus: 'failed',
                  terminalMsg: `❌ ${result.message || result.responseDesc || 'Payment declined'}`
                }
              : r
          )
        );
        Alert.alert('❌ Payment Failed', result.message || 'NETS payment declined');
      }
    } catch (e: any) {
      console.error('❌ [SplitPayment] NETS error:', e);
      setRows(prevRows =>
        prevRows.map(r =>
          r.id === row.id
            ? { ...r, terminalStatus: 'failed', terminalMsg: `❌ ${e.message}` }
            : r
        )
      );
      Alert.alert('❌ Payment Failed', e.message);
    } finally {
      setIsGeneratingQR(false);
    }
    return;
  }

  // "Yeahpay Paynow" or "Yeahpay Card" → YeahPay terminal (SN required)
  if (!isYeahPayTerminal(row.payMode)) {
    // Safety net: non-terminal mode somehow called handleGenerateQR.
    console.warn('[SplitPayment] handleGenerateQR called for non-terminal mode:', row.payMode);
    setRows(prevRows =>
      prevRows.map(r => r.id === row.id ? { ...r, status: 'Paid' } : r)
    );
    return;
  }

  try {
    setIsGeneratingQR(true);
    setRows(prevRows =>
      prevRows.map(r =>
        r.id === row.id
          ? { ...r, terminalStatus: "processing", terminalMsg: "Processing payment..." }
          : r
      )
    );

    const selectedMethod = paymentMethods.find(m => 
      m.payMode.trim().toUpperCase() === row.payMode.trim().toUpperCase() ||
      normalizeMode(m.payMode) === normalizeMode(row.payMode)
    );
    const deviceSn = (selectedMethod?.deviceSn || (selectedMethod as any)?.DeviceSN || '').trim();
    const salt = (selectedMethod?.deviceSalt || (selectedMethod as any)?.DeviceSalt || '').trim();

    console.log('🔄 [SplitPayment] Calling YeahPay terminal for:', row.payMode);
    console.log('   Amount:', amt);
    console.log('   DeviceSN:', deviceSn);
    console.log('   Salt:', salt ? 'Yes' : 'No');

    if (!deviceSn) {
      setRows(prevRows =>
        prevRows.map(r =>
          r.id === row.id
            ? { ...r, terminalStatus: "failed", terminalMsg: "DeviceSN not configured" }
            : r
        )
      );
      Alert.alert('Configuration Error', 'DeviceSN not configured.');
      setIsGeneratingQR(false);
      return;
    }

    // Register in module-level map + store before awaiting, so Home press during wait can restore
    const context = useOrderContextStore.getState().currentOrder;
    const tableId = context?.tableId?.toString();
    if (tableId) {
      ongoingSplitSessions[tableId] = {
        status: "processing",
        splitRowId: row.id,
        amount: amt,
        payMode: row.payMode,
      };
      useTerminalPaymentStore.getState().setSession(tableId, {
        tableId,
        status: "processing",
        message: "Processing split payment...",
        method: row.payMode,
        total: amt,
        splitRowId: row.id,
        isSplit: true,
      });
    }

    // Endpoint: "Yeahpay Card" → card-payment, "Yeahpay Paynow" → paynow-payment
    const endpoint = isYeahPayCard(row.payMode)
      ? '/api/yeahpay/card-payment'
      : '/api/yeahpay/paynow-payment';

    const response = await fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(useAuthStore.getState().token ? { 'Authorization': `Bearer ${useAuthStore.getState().token}` } : {}),
      },
      body: JSON.stringify({
        amount: amt,
        deviceSn: deviceSn,
        salt: salt || '',
        tableId: tableId || '',
        isSplit: true,
        splitRowId: row.id
      })
    });

    const result = await response.json();
    console.log('✅ [SplitPayment] Terminal response:', result);

    const responseCode = result.code;
    const isCardMode = isYeahPayCard(row.payMode);
    const ctx = useOrderContextStore.getState().currentOrder;
    const tblId = ctx?.tableId?.toString();

    if (result.success || responseCode === 0) {
      if (tblId && ongoingSplitSessions[tblId]) {
        ongoingSplitSessions[tblId].status = "success";
        ongoingSplitSessions[tblId].onUpdate?.("success");
        useTerminalPaymentStore.getState().clearSession(tblId);
        delete ongoingSplitSessions[tblId];
      }
      setRows(prevRows =>
        prevRows.map(r =>
          r.id === row.id
            ? {
                ...r,
                status: 'Paid',
                terminalStatus: 'success',
                terminalMsg: `✅ Paid successfully via terminal`
              }
            : r
        )
      );

      showToast({
        type: 'success',
        message: `✅ ${isCardMode ? 'Card' : 'PayNow'} Payment Successful`,
        subtitle: `$${amt.toFixed(2)} paid via ${row.payMode}`
      });

      setQrModalVisible(false);
      setQrModalType(null);
      setActiveQrRowId(null);

    } else if (responseCode === -1027) {
      if (tblId && ongoingSplitSessions[tblId]) {
        ongoingSplitSessions[tblId].status = "cancelled";
        ongoingSplitSessions[tblId].onUpdate?.("cancelled", '❌ Transaction cancelled on terminal');
        useTerminalPaymentStore.getState().updateSession(tblId, { status: "cancelled", message: '❌ Transaction cancelled on terminal' });
        delete ongoingSplitSessions[tblId];
      }
      setRows(prevRows =>
        prevRows.map(r =>
          r.id === row.id
            ? {
                ...r,
                status: 'Cancelled' as const,
                terminalStatus: 'cancelled',
                terminalMsg: '❌ Transaction cancelled on terminal'
              }
            : r
        )
      );

      Alert.alert(
        'Transaction Cancelled',
        `${isCardMode ? 'Card' : 'Payment'} was cancelled on the terminal.`,
        [{ text: 'OK' }]
      );

      setQrModalVisible(false);
      setQrModalType(null);
      setActiveQrRowId(null);

    } else if (responseCode === -1028 || responseCode === -1008) {
      if (tblId && ongoingSplitSessions[tblId]) {
        ongoingSplitSessions[tblId].status = "failed";
        ongoingSplitSessions[tblId].onUpdate?.("failed", '⏰ Transaction timeout');
        useTerminalPaymentStore.getState().updateSession(tblId, { status: "failed", message: '⏰ Transaction timeout' });
        delete ongoingSplitSessions[tblId];
      }
      setRows(prevRows =>
        prevRows.map(r =>
          r.id === row.id
            ? {
                ...r,
                terminalStatus: 'failed',
                terminalMsg: '⏰ Transaction timeout'
              }
            : r
        )
      );

      Alert.alert(
        'Transaction Timeout',
        `${isCardMode ? 'Card' : 'Payment'} read timed out. Please try again.`,
        [{ text: 'OK' }]
      );

    } else {
      const errorMsg = result.msg || result.error || 'Payment failed';
      if (tblId && ongoingSplitSessions[tblId]) {
        ongoingSplitSessions[tblId].status = "failed";
        ongoingSplitSessions[tblId].onUpdate?.("failed", `❌ ${errorMsg}`);
        useTerminalPaymentStore.getState().updateSession(tblId, { status: "failed", message: `❌ ${errorMsg}` });
        delete ongoingSplitSessions[tblId];
      }
      setRows(prevRows =>
        prevRows.map(r =>
          r.id === row.id
            ? {
                ...r,
                terminalStatus: 'failed',
                terminalMsg: `❌ ${errorMsg}`
              }
            : r
        )
      );
      Alert.alert('Payment Failed', errorMsg);
    }

  } catch (error: any) {
    const errorMsg = error.message || 'Failed to connect to terminal';
    console.error('❌ [SplitPayment] Terminal error:', error);
    const ctx2 = useOrderContextStore.getState().currentOrder;
    const tblId2 = ctx2?.tableId?.toString();
    if (tblId2 && ongoingSplitSessions[tblId2]) {
      ongoingSplitSessions[tblId2].status = "failed";
      ongoingSplitSessions[tblId2].onUpdate?.("failed", `❌ ${errorMsg}`);
      useTerminalPaymentStore.getState().updateSession(tblId2, { status: "failed", message: `❌ ${errorMsg}` });
      delete ongoingSplitSessions[tblId2];
    }
    setRows(prevRows =>
      prevRows.map(r =>
        r.id === row.id
          ? {
              ...r,
              terminalStatus: 'failed',
              terminalMsg: `❌ ${errorMsg}`
            }
          : r
      )
    );
    Alert.alert('Error', errorMsg);
  } finally {
    setIsGeneratingQR(false);
  }
};
  const handleQrPaymentSuccess = () => {
    if (activeQrRowId) {
      setRows(prevRows =>
        prevRows.map(r => (r.id === activeQrRowId ? { ...r, status: "Paid" } : r))
      );
      Alert.alert("Success", "QR payment confirmed successfully.");
    }
    setQrModalVisible(false);
    setQrModalType(null);
    setActiveQrRowId(null);
  };

  const handlePay = () => {
    if (!isValid) {
      Alert.alert("Validation Error", validationError || "Invalid payments.");
      return;
    }

    const pendingQR = rows.some(r => r.status === "Pending");
    if (pendingQR) {
      Alert.alert("Payments Pending", "Please verify and complete all QR payments first.");
      return;
    }


    const finalPayments = rows.map((r) => ({
      payModeId: r.payModeId,
      payMode: r.payMode,
      amount: parseFloat(r.amount) || 0,
      referenceNo: r.referenceNo || undefined,
    }));

    onComplete(finalPayments, undefined);
  };

  const activeRowForDropdown = rows.find(r => r.id === activeDropdownRowId);
  const dropdownOptions = activeDropdownRowId ? getAvailableMethodsForRow(activeDropdownRowId) : [];

  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>
        {memberFlow ? "Collect Member Credit Payment" : "Split Payment Checkout"}
      </Text>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {rows.map((row, idx) => {
          const locked = isRowLocked(row);
          const isMemberMode = row.payMode.toUpperCase().trim() === "MEMBER" || row.payMode.toUpperCase().trim() === "CREDIT";
          const availLimit = selectedMember
            ? (selectedMember.CreditLimit || 0) - (selectedMember.CurrentBalance || 0)
            : 0;
          const exceedsLimit = isMemberMode && !memberFlow && selectedMember && (parseFloat(row.amount) || 0) > availLimit;

          return (
            <View key={row.id} style={[styles.rowContainer, locked && styles.lockedRow]}>
              <View style={styles.rowHeader}>
                <View style={styles.rowTitleContainer}>
                  <Text style={styles.rowLabel}>Payment Method #{idx + 1}</Text>
                  {locked && (
                    <View style={styles.lockBadge}>
                      <Ionicons name="lock-closed" size={10} color={Theme.success} />
                      <Text style={styles.lockText}>VERIFIED</Text>
                    </View>
                  )}
                </View>
                {rows.length > 1 && !locked && (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => handleRemoveRow(row.id)}
                    style={styles.removeBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color={Theme.danger} />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.inputsRow}>
                {/* Custom Styled Dropdown Selector */}
                <TouchableOpacity
                  activeOpacity={locked ? 1 : 0.7}
                  onPress={() => handleOpenDropdown(row)}
                  style={[styles.dropdownTrigger, locked && styles.disabledInput]}
                  disabled={locked}
                >
                  <Text style={[styles.dropdownTriggerText, locked && styles.disabledText]}>
                    {row.payMode.toUpperCase()}
                  </Text>
                  {!locked && <Ionicons name="chevron-down" size={18} color={Theme.textSecondary} />}
                </TouchableOpacity>

                {/* Amount Input */}
                <View style={[styles.amountInputWrapper, locked && styles.disabledInput, exceedsLimit && styles.errorBorder]}>
                  <Text style={[styles.currencyPrefix, locked && styles.disabledText]}>{currencySymbol}</Text>
                  <TextInput
                    style={[styles.amountInput, locked && styles.disabledText]}
                    keyboardType="numeric"
                    value={row.amount}
                    onChangeText={(val) => handleUpdateRow(row.id, { amount: val })}
                    placeholder="0.00"
                    placeholderTextColor={Theme.textMuted}
                    editable={!locked}
                  />
                </View>
              </View>

              {/* Member specific info */}
              {isMemberMode && !memberFlow && (
                <View style={styles.memberInfoBox}>
                  {selectedMember ? (
                    <View>
                      <Text style={styles.memberInfoName}>
                        Member: <Text style={{ fontFamily: Fonts.black }}>{selectedMember.Name}</Text>
                      </Text>
                      <Text style={[styles.memberLimitText, exceedsLimit && { color: Theme.danger }]}>
                        Avail Limit: {formatMoney(currencySymbol, availLimit)}
                      </Text>
                    </View>
                  ) : (
                    <TouchableOpacity onPress={() => onSelectMember && onSelectMember(row.payMode)} style={styles.memberSelectLink}>
                      <Ionicons name="people" size={14} color={Theme.primary} />
                      <Text style={styles.memberSelectLinkText}>Tap to select customer</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Status and QR Generation Actions */}


{/* Status and Action Buttons */}
<View style={styles.rowFooter}>
  <View style={styles.statusBox}>
    <Text style={styles.statusLabel}>Status: </Text>
    <View style={[
      styles.statusBadge,
      row.status === "Paid" ? styles.badgePaid :
      row.status === "Cancelled" ? styles.badgeCancelled :
      styles.badgePending
    ]}>
      <Text style={[
        styles.statusText,
        row.status === "Paid" ? styles.textPaid :
        row.status === "Cancelled" ? styles.textCancelled :
        styles.textPending
      ]}>
        {row.status === "Paid" ? "PAID" :
         row.status === "Cancelled" ? "CANCELLED" :
         "PENDING"}
      </Text>
    </View>
  </View>

 {row.status === "Pending" && (
  <TouchableOpacity
    activeOpacity={0.8}
    disabled={isGeneratingQR}
    onPress={() => {
      if (isNormalPayNow(row.payMode)) {
        // "PAYNOW" (exact) → show static QR modal
        handleGenerateQR(row);
      } else if (isYeahPayTerminal(row.payMode)) {
        // "Yeahpay Paynow" or "Yeahpay Card" → YeahPay terminal
        handleGenerateQR(row);
      } else {
        // All other modes (Cash, Card, GPay, QR, Paytm, etc.) → instant confirm
        handleUpdateRow(row.id, { status: "Paid" });
      }
    }}
    style={[styles.generateQrBtn, isGeneratingQR && { opacity: 0.7 }]}
  >
    {isGeneratingQR && activeQrRowId === row.id ? (
      <ActivityIndicator size="small" color="#fff" />
    ) : (
      <Ionicons
        name={
          isNormalPayNow(row.payMode)
            ? "qr-code"
            : isYeahPayTerminal(row.payMode)
              ? "call-outline"
              : "checkmark-circle-outline"
        }
        size={14}
        color="#fff"
      />
    )}
    <Text style={styles.generateQrText}>
      {isGeneratingQR && activeQrRowId === row.id
        ? "Calling..."
        : isNormalPayNow(row.payMode)
          ? "Generate QR"
          : isYeahPayTerminal(row.payMode)
            ? "Call Terminal"
            : "Confirm Payment"}
    </Text>
  </TouchableOpacity>
)}
</View>

              {/* Terminal Feedback Status Banner (Linked directly to backend results) */}
              {row.terminalStatus && row.terminalStatus !== "idle" && (
                <View style={[
                  styles.statusContainer,
                  row.terminalStatus === "success" && styles.statusSuccess,
                  row.terminalStatus === "cancelled" && styles.statusCancelled,
                  row.terminalStatus === "failed" && styles.statusFailed,
                  row.terminalStatus === "processing" && styles.statusProcessing,
                  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }
                ]}>
                  <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: 6 }}>
                    {row.terminalStatus === "processing" ? (
                      <RotatingSyncIcon size={16} color="#3b82f6" />
                    ) : (
                      <Ionicons
                        name={
                          row.terminalStatus === "success" ? "checkmark-circle" :
                            row.terminalStatus === "cancelled" ? "close-circle" :
                              "alert-circle"
                        }
                        size={16}
                        color={
                          row.terminalStatus === "success" ? "#22c55e" :
                            row.terminalStatus === "cancelled" ? "#f59e0b" :
                              "#ef4444"
                        }
                      />
                    )}
                    <Text style={[
                      styles.statusMessageText,
                      row.terminalStatus === "success" && styles.statusMessageSuccess,
                      row.terminalStatus === "cancelled" && styles.statusMessageCancelled,
                      row.terminalStatus === "failed" && styles.statusMessageFailed,
                      row.terminalStatus === "processing" && styles.statusMessageProcessing,
                      { flex: 1 }
                    ]}>
                      {row.terminalMsg}
                    </Text>
                  </View>
                  {/* X dismiss button — only shown for failed/cancelled states */}
                  {(row.terminalStatus === "failed" || row.terminalStatus === "cancelled") && (
                    <TouchableOpacity
                      onPress={() => {
                        setRows(prev => prev.map(r =>
                          r.id === row.id
                            ? { ...r, terminalStatus: undefined, terminalMsg: undefined }
                            : r
                        ));
                      }}
                      style={{ padding: 4, marginLeft: 4 }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close" size={16} color={row.terminalStatus === "cancelled" ? "#f59e0b" : "#ef4444"} />
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Reference Number for Non-Cash, editable only if unlocked */}
              {row.payMode.toUpperCase().trim() !== "CASH" && row.payMode.toUpperCase().trim() !== "CAS" && (
                <TextInput
                  style={[styles.refInput, locked && styles.disabledInput]}
                  placeholder="Reference / Transaction Number (Optional)"
                  placeholderTextColor={Theme.textMuted}
                  value={row.referenceNo}
                  onChangeText={(val) => handleUpdateRow(row.id, { referenceNo: val })}
                  editable={!locked}
                />
              )}
            </View>
          );
        })}

        {/* Add Payment Method Button */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleAddRow}
          style={[styles.addMethodBtn, remainingBalance <= 0 && styles.addMethodBtnDisabled]}
          disabled={remainingBalance <= 0}
        >
          <Ionicons name="add-circle-outline" size={20} color={remainingBalance <= 0 ? Theme.textMuted : Theme.primary} />
          <Text style={[styles.addMethodBtnText, remainingBalance <= 0 && { color: Theme.textMuted }]}>
            Add Payment Method
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Bill & Payment Status Board */}
      <View style={styles.summaryBoard}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total Bill</Text>
          <Text style={styles.summaryValue}>{formatMoney(currencySymbol, targetTotal)}</Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total Paid</Text>
          <Text style={[styles.summaryValue, { color: Theme.success }]}>
            {formatMoney(currencySymbol, totalPaid)}
          </Text>
        </View>

        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Remaining Balance</Text>
          <Text
            style={[
              styles.summaryValue,
              { color: remainingBalance > 0.01 ? Theme.danger : Theme.success, fontFamily: Fonts.black },
            ]}
          >
            {formatMoney(currencySymbol, remainingBalance)}
          </Text>
        </View>

        {validationError && (
          <View style={styles.errorBanner}>
            <Ionicons name="warning" size={14} color={Theme.danger} />
            <Text style={styles.errorBannerText}>{validationError}</Text>
          </View>
        )}
      </View>

      {/* Action Row */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onCancel}
          style={styles.cancelBtn}
          disabled={processing}
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handlePay}
          style={[styles.payBtn, (!isValid || rows.some(r => r.status === "Pending")) && styles.payBtnDisabled]}
          disabled={!isValid || rows.some(r => r.status === "Pending") || processing}
        >
          {processing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.payBtnText}>
              {memberFlow ? "Submit Payment" : "Complete Checkout"}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* DROPDOWN SELECTOR MODAL */}
      <Modal visible={activeDropdownRowId !== null} transparent animationType="fade" onRequestClose={() => setActiveDropdownRowId(null)}>
        <TouchableOpacity
          style={styles.dropdownOverlay}
          activeOpacity={1}
          onPress={() => setActiveDropdownRowId(null)}
        >
          <View style={styles.dropdownModal}>
            <Text style={styles.dropdownTitle}>Select Payment Mode</Text>
            <ScrollView style={styles.dropdownScroll}>
              {dropdownOptions.map((m) => (
                <TouchableOpacity
                  key={m.position}
                  style={styles.dropdownOption}
                  onPress={() => handleSelectMode(m)}
                >
                  <Text style={styles.dropdownOptionText}>{m.description.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* SEQUENTIAL QR MODALS */}
      {qrModalType === "PAYNOW" && (
        <PayNowPaymentModal
          visible={qrModalVisible}
          onClose={() => {
            setQrModalVisible(false);
            setQrModalType(null);
            setActiveQrRowId(null);
          }}
          amount={qrModalAmount}
          onSuccess={handleQrPaymentSuccess}
          onFailed={() => {
            if (activeQrRowId) {
              setRows(prevRows =>
                prevRows.map(r => 
                  r.id === activeQrRowId 
                    ? { ...r, status: 'Cancelled' as const } 
                    : r
                )
              );
            }
          }}
        />
      )}

      {qrModalType === "UPI" && (
        <UPIPaymentModal
          visible={qrModalVisible}
          onClose={() => setQrModalVisible(false)}
          amount={qrModalAmount}
          onSuccess={handleQrPaymentSuccess}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
    badgeCancelled: {
  backgroundColor: '#FEE2E2',  // Red background
},
textCancelled: {
  color: '#DC2626',  // Red text
},
  sectionTitle: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginBottom: 16,
  },
  scrollContent: {
    gap: 16,
    paddingBottom: 20,
  },
  rowContainer: {
    backgroundColor: Theme.bgCard,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Theme.border,
    marginBottom: 10,
    ...Theme.shadowSm,
  },
  lockedRow: {
    backgroundColor: Theme.bgInput + "25",
    borderColor: Theme.success + "30",
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  rowTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowLabel: {
    fontSize: 12,
    fontFamily: Fonts.black,
    color: Theme.textSecondary,
    letterSpacing: 0.5,
  },
  lockBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.success + "15",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  lockText: {
    fontSize: 9,
    fontFamily: Fonts.bold,
    color: Theme.success,
  },
  removeBtn: {
    padding: 4,
  },
  inputsRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  dropdownTrigger: {
    flex: 1.2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Theme.bgInput,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    paddingHorizontal: 12,
    height: 52,
  },
  dropdownTriggerText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  amountInputWrapper: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.bgInput,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    paddingHorizontal: 12,
    height: 52,
  },
  currencyPrefix: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    marginRight: 4,
  },
  amountInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    padding: 0,
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  disabledInput: {
    backgroundColor: Theme.bgInput + "10",
    borderColor: Theme.border + "50",
  },
  disabledText: {
    color: Theme.textMuted,
  },
  errorBorder: {
    borderColor: Theme.danger,
  },
  refInput: {
    marginTop: 12,
    height: 44,
    backgroundColor: Theme.bgInput,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.border,
    paddingHorizontal: 12,
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  memberInfoBox: {
    backgroundColor: Theme.primary + "08",
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: Theme.primary + "15",
  },
  memberInfoName: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
  },
  memberLimitText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.success,
    marginTop: 2,
  },
  memberSelectLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },


  memberSelectLinkText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  rowFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Theme.border + "40",
  },
  statusBox: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusLabel: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgePaid: {
    backgroundColor: Theme.success + "15",
  },
  badgePending: {
    backgroundColor: Theme.warningBg || "#FFF8E1",
  },
  statusText: {
    fontSize: 10,
    fontFamily: Fonts.black,
  },
  textPaid: {
    color: Theme.success,
  },
  textPending: {
    color: Theme.warning || "#F57F17",
  },
  generateQrBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    gap: 5,
    ...Theme.shadowSm,
  },
  generateQrText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: Fonts.black,
  },
  addMethodBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.primary,
    borderStyle: "dashed",
    marginTop: 8,
  },
  addMethodBtnDisabled: {
    borderColor: Theme.border,
  },
  addMethodBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  summaryBoard: {
    backgroundColor: Theme.bgCard,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Theme.border,
    gap: 6,
    marginTop: 16,
    marginBottom: 16,
    ...Theme.shadowSm,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  summaryValue: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.danger + "08",
    padding: 10,
    borderRadius: 10,
    gap: 6,
    marginTop: 6,
    borderWidth: 1,
    borderColor: Theme.danger + "15",
  },
  errorBannerText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.danger,
    flex: 1,
  },
  actionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    height: 54,
    borderRadius: 12,
    backgroundColor: Theme.bgInput,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  payBtn: {
    flex: 1.8,
    height: 54,
    borderRadius: 12,
    backgroundColor: Theme.primary,
    justifyContent: "center",
    alignItems: "center",
    ...Theme.shadowSm,
  },
  payBtnDisabled: {
    backgroundColor: Theme.border,
    opacity: 0.6,
  },
  payBtnText: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: "#fff",
  },
  // Dropdown Picker Modal
  dropdownOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  dropdownModal: {
    width: "80%",
    maxWidth: 300,
    maxHeight: 350,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    ...Theme.shadowLg,
  },
  dropdownTitle: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginBottom: 12,
    textAlign: "center",
    borderBottomWidth: 1,
    borderBottomColor: Theme.border + "40",
    paddingBottom: 8,
  },
  dropdownScroll: {
    marginVertical: 4,
  },
  dropdownOption: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border + "20",
  },
  dropdownOptionText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    textAlign: "center",
  },
  // Inline Terminal Feedback Status Styles
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginVertical: 8,
    gap: 8,
    borderWidth: 1,
  },
  statusSuccess: {
    backgroundColor: '#dcfce7',
    borderColor: '#22c55e',
  },
  statusCancelled: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
  },
  statusFailed: {
    backgroundColor: '#fee2e2',
    borderColor: '#ef4444',
  },
  statusProcessing: {
    backgroundColor: '#dbeafe',
    borderColor: '#3b82f6',
  },
  statusMessageText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    flex: 1,
  },
  statusMessageSuccess: {
    color: '#16a34a',
  },
  statusMessageCancelled: {
    color: '#d97706',
  },
  statusMessageFailed: {
    color: '#dc2626',
  },
  statusMessageProcessing: {
    color: '#2563eb',
  },
});
