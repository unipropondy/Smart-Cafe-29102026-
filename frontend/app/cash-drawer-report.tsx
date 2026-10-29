import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  StatusBar,
  useWindowDimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Theme } from '../constants/theme';
import { Fonts } from '../constants/Fonts';
import { API_URL } from '../constants/Config';
import { useAuthStore } from '../stores/authStore';
import { getSingaporeTimeTodayRange } from '../utils/timezoneHelper';
import axios from 'axios';

export default function CashDrawerReportScreen() {
  const router = useRouter();
  const { token } = useAuthStore();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  
  // Date filters
  const [fromDate] = useState<Date>(() => {
    const { from } = getSingaporeTimeTodayRange();
    return from;
  });
  const [toDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  });

  // Filter selections
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [terminalFilter, setTerminalFilter] = useState<string>('ALL');
  const [terminals, setTerminals] = useState<string[]>([]);

  useEffect(() => {
    loadTerminals();
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [actionFilter, terminalFilter]);

  const loadTerminals = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/settlement/terminals`);
      const codes = (res.data || []).map((t: any) => t.TerminalCode);
      setTerminals(codes);
    } catch (err) {
      console.warn('Failed to load terminals:', err);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      // Offset dates to local ISO format for API compatibility
      const pad = (n: number) => n.toString().padStart(2, '0');
      const formatLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      
      const fromStr = formatLocal(fromDate);
      const toStr = formatLocal(toDate);

      const url = `${API_URL}/api/cash-drawer/logs?fromDate=${fromStr}&toDate=${toStr}&actionType=${actionFilter}&terminalCode=${terminalFilter}`;
      const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.data.success) {
        setLogs(res.data.data || []);
      }
    } catch (err) {
      console.warn('Failed to fetch activity logs:', err);
    } finally {
      setLoading(false);
    }
  };

  // Computations
  const totalTriggers = logs.length;
  const successCount = logs.filter(l => l.IsSuccess).length;
  const successRate = totalTriggers > 0 ? Math.round((successCount / totalTriggers) * 100) : 100;
  
  const cashInTotal = logs
    .filter(l => (l.ActionType === 'CASH_IN' || l.ActionType === 'SALE' || l.ActionType === 'OPENING_FLOAT') && l.IsSuccess)
    .reduce((sum, l) => sum + (parseFloat(l.Amount) || 0), 0);

  const cashOutTotal = logs
    .filter(l => l.ActionType === 'CASH_OUT' && l.IsSuccess)
    .reduce((sum, l) => sum + (parseFloat(l.Amount) || 0), 0);

  const formatCurrency = (amount: any) => {
    const val = parseFloat(amount);
    return isNaN(val) ? '$0.00' : `$${val.toFixed(2)}`;
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      const day = d.getDate().toString().padStart(2, '0');
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const year = d.getFullYear();
      let hour = d.getHours();
      const min = d.getMinutes().toString().padStart(2, '0');
      const ampm = hour >= 12 ? 'PM' : 'AM';
      hour = hour % 12 || 12;
      return `${day}/${month}/${year} ${hour.toString().padStart(2, '0')}:${min} ${ampm}`;
    } catch (e) {
      return '';
    }
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case 'SALE': return '#16A34A';
      case 'CASH_IN': return '#2563EB';
      case 'CASH_OUT': return '#DC2626';
      case 'OPENING_FLOAT': return '#F59E0B';
      case 'DRAWER_CHECK': return '#EA580C';
      default: return '#6B7280';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/cash-drawer' as any))}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={24} color={Theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>📊 Drawer Activity Audit</Text>
        <TouchableOpacity onPress={fetchLogs} style={styles.refreshButton}>
          <Ionicons name="refresh" size={20} color={Theme.primary} />
        </TouchableOpacity>
      </View>

      {/* Summary KPI Cards */}
      <View style={styles.kpiContainer}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>TOTAL ACTIONS</Text>
          <Text style={styles.kpiValue}>{totalTriggers}</Text>
          <Text style={styles.kpiSub}>Success Rate: {successRate}%</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>CASH INFLOW</Text>
          <Text style={[styles.kpiValue, { color: '#16A34A' }]}>{formatCurrency(cashInTotal)}</Text>
          <Text style={styles.kpiSub}>Shift Additions</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiLabel}>CASH OUTFLOW</Text>
          <Text style={[styles.kpiValue, { color: '#DC2626' }]}>{formatCurrency(cashOutTotal)}</Text>
          <Text style={styles.kpiSub}>Manual Payouts</Text>
        </View>
      </View>

      {/* Filter Toolbar */}
      <View style={styles.filterBar}>
        <View style={styles.dropdownWrapper}>
          <Text style={styles.filterLabel}>Action Type</Text>
          <View style={styles.filterRow}>
            {['ALL', 'SALE', 'CASH_IN', 'CASH_OUT', 'OPENING_FLOAT', 'DRAWER_CHECK'].map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.filterChip, actionFilter === t && styles.filterChipActive]}
                onPress={() => setActionFilter(t)}
              >
                <Text style={[styles.filterChipText, actionFilter === t && styles.filterChipTextActive]}>
                  {t.replace('_', ' ')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.dropdownWrapper}>
          <Text style={styles.filterLabel}>Register / Terminal</Text>
          <View style={styles.filterRow}>
            {['ALL', ...terminals].map((code) => (
              <TouchableOpacity
                key={code}
                style={[styles.filterChip, terminalFilter === code && styles.filterChipActive]}
                onPress={() => setTerminalFilter(code)}
              >
                <Text style={[styles.filterChipText, terminalFilter === code && styles.filterChipTextActive]}>
                  {code}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {/* Audit Logs Table */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#F97316" />
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => item.LogId}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="document-text-outline" size={48} color="#9CA3AF" />
              <Text style={styles.emptyText}>No drawer actions logged for the selection.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.rowCard}>
              <View style={styles.rowHeader}>
                <View style={[styles.actionBadge, { backgroundColor: getActionColor(item.ActionType) + '15' }]}>
                  <Text style={[styles.actionText, { color: getActionColor(item.ActionType) }]}>
                    {item.ActionType}
                  </Text>
                </View>
                <Text style={styles.rowTime}>{formatDate(item.CreatedOn)}</Text>
              </View>

              <View style={styles.rowBody}>
                <View style={styles.fieldItem}>
                  <Text style={styles.fieldLabel}>Amount</Text>
                  <Text style={styles.fieldValue}>{formatCurrency(item.Amount)}</Text>
                </View>
                <View style={styles.fieldItem}>
                  <Text style={styles.fieldLabel}>Source</Text>
                  <Text style={styles.fieldValue}>{item.OpenSource}</Text>
                </View>
                <View style={styles.fieldItem}>
                  <Text style={styles.fieldLabel}>Terminal</Text>
                  <Text style={styles.fieldValue}>{item.TerminalCode || 'Global'}</Text>
                </View>
                <View style={styles.fieldItem}>
                  <Text style={styles.fieldLabel}>Status</Text>
                  <View style={styles.statusRow}>
                    <Ionicons
                      name={item.IsSuccess ? 'checkmark-circle' : 'alert-circle'}
                      size={14}
                      color={item.IsSuccess ? '#16A34A' : '#DC2626'}
                    />
                    <Text style={[styles.statusText, { color: item.IsSuccess ? '#16A34A' : '#DC2626' }]}>
                      {item.IsSuccess ? 'SUCCESS' : 'FAILED'}
                    </Text>
                  </View>
                </View>
              </View>

              {item.Remark || item.Reason ? (
                <View style={styles.remarksBlock}>
                  {item.Reason ? <Text style={styles.remarkText}>Reason: {item.Reason}</Text> : null}
                  {item.Remark ? <Text style={styles.remarkText}>Remark: {item.Remark}</Text> : null}
                </View>
              ) : null}

              <View style={styles.rowFooter}>
                <Text style={styles.footerUser}>Triggered By: {item.OpenedByName || 'Unknown'}</Text>
                {item.ApprovedByName ? (
                  <Text style={styles.footerUser}>Approved By: {item.ApprovedByName}</Text>
                ) : null}
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF9F6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    padding: 4,
  },
  refreshButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  kpiContainer: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    justifyContent: 'space-between',
  },
  kpiCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  kpiLabel: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  kpiValue: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginBottom: 2,
  },
  kpiSub: {
    fontSize: 9,
    fontFamily: Fonts.medium,
    color: '#9CA3AF',
  },
  filterBar: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    gap: 10,
  },
  dropdownWrapper: {
    gap: 6,
  },
  filterLabel: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
  },
  filterChipActive: {
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  filterChipText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: '#4B5563',
  },
  filterChipTextActive: {
    color: '#F97316',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 20,
    gap: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 10,
  },
  emptyText: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: '#9CA3AF',
  },
  rowCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  actionBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  actionText: {
    fontSize: 11,
    fontFamily: Fonts.black,
  },
  rowTime: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: '#9CA3AF',
  },
  rowBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  fieldItem: {
    alignItems: 'center',
  },
  fieldLabel: {
    fontSize: 9,
    fontFamily: Fonts.bold,
    color: '#9CA3AF',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  fieldValue: {
    fontSize: 12,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusText: {
    fontSize: 10,
    fontFamily: Fonts.black,
  },
  remarksBlock: {
    backgroundColor: '#FFFBEB',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FEF3C7',
    marginBottom: 10,
    gap: 2,
  },
  remarkText: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: '#D97706',
  },
  rowFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 8,
  },
  footerUser: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
});
