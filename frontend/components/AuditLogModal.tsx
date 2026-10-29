import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../constants/theme';
import { Fonts } from '../constants/Fonts';
import { API_URL } from '@/constants/Config';
import { formatToSingaporeDate, formatToSingaporeTime } from '../utils/timezoneHelper';

interface AuditLogItem {
  AuditId: string;
  Category: string;
  FieldName: string;
  FieldLabel: string;
  OldValue: string;
  NewValue: string;
  ModifiedBy: string;
  UserId: string;
  UserRole: string;
  CreatedAt: string;
}

interface AuditLogModalProps {
  visible: boolean;
  onClose: () => void;
  defaultCategory?: string;
}

const CATEGORY_TABS = [
  { id: 'ALL', label: 'All' },
  { id: 'TAX_CURRENCY', label: 'Tax & Currency' },
  { id: 'STORE_INFO', label: 'Shop Info' },
  { id: 'BRANDING', label: 'Branding' },
  { id: 'GENERAL_SETTINGS', label: 'General Settings' },
];

export default function AuditLogModal({ visible, onClose, defaultCategory = 'ALL' }: AuditLogModalProps) {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedCategory, setSelectedCategory] = useState<string>(defaultCategory);
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    if (visible) {
      fetchAuditLogs();
    }
  }, [visible, selectedCategory]);

  const fetchAuditLogs = async () => {
    try {
      setLoading(true);
      const url = `${API_URL}/api/settings/audit-logs?category=${encodeURIComponent(selectedCategory)}&search=${encodeURIComponent(searchQuery)}&limit=150`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && Array.isArray(data.logs)) {
        setLogs(data.logs);
      } else {
        setLogs([]);
      }
    } catch (err) {
      console.warn("Failed to fetch audit logs:", err);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    fetchAuditLogs();
  };

  const formatLogDate = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      const dateObj = new Date(dateStr);
      const d = formatToSingaporeDate(dateObj, { day: '2-digit', month: 'short', year: 'numeric' });
      const t = formatToSingaporeTime(dateObj);
      return `${d} • ${t}`;
    } catch (_) {
      return dateStr;
    }
  };

  const getCategoryBadgeStyle = (category: string) => {
    switch (category) {
      case 'TAX_CURRENCY':
        return { bg: '#EBF8FF', text: '#2B6CB0', label: 'Tax & Currency' };
      case 'STORE_INFO':
        return { bg: '#FEFCBF', text: '#744210', label: 'Shop Info' };
      case 'BRANDING':
        return { bg: '#E9D8FD', text: '#553C9A', label: 'Branding' };
      case 'GENERAL_SETTINGS':
        return { bg: '#C6F6D5', text: '#22543D', label: 'General Settings' };
      default:
        return { bg: '#EDF2F7', text: '#4A5568', label: category };
    }
  };

  const renderLogItem = ({ item }: { item: AuditLogItem }) => {
    const badge = getCategoryBadgeStyle(item.Category);
    const displayOld = (!item.OldValue || item.OldValue === '0' || item.OldValue === 'false') ? (item.OldValue === '0' || item.OldValue === 'false' ? 'Disabled' : item.OldValue || 'Disabled') : item.OldValue;
    const displayNew = (!item.NewValue || item.NewValue === '0' || item.NewValue === 'false') ? (item.NewValue === '0' || item.NewValue === 'false' ? 'Disabled' : item.NewValue || 'Disabled') : item.NewValue;

    return (
      <View style={styles.logCard}>
        <View style={styles.logCardHeader}>
          <View style={styles.userRow}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarText}>{(item.ModifiedBy || item.UserId || '')[0]?.toUpperCase() || 'U'}</Text>
            </View>
            <View>
              <Text style={styles.userName}>{item.ModifiedBy || item.UserId || ''}</Text>
              <Text style={styles.userRole}>{item.UserRole ? `${item.UserRole} • ` : ''}{formatLogDate(item.CreatedAt)}</Text>
            </View>
          </View>
          <View style={[styles.categoryBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.categoryBadgeText, { color: badge.text }]}>{badge.label}</Text>
          </View>
        </View>

        <View style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{item.FieldLabel || item.FieldName}</Text>
        </View>

        <View style={styles.diffContainer}>
          <View style={styles.diffBoxOld}>
            <Text style={styles.diffTag}>OLD</Text>
            <Text style={styles.diffValOld} numberOfLines={2}>{displayOld}</Text>
          </View>

          <Ionicons name="arrow-forward" size={16} color="#94A3B8" style={{ marginHorizontal: 8 }} />

          <View style={[styles.diffBoxNew, displayNew === 'Disabled' && { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' }]}>
            <Text style={[styles.diffTagNew, displayNew === 'Disabled' && { color: '#64748B' }]}>NEW</Text>
            <Text style={[styles.diffValNew, displayNew === 'Disabled' && { color: '#475569' }]} numberOfLines={2}>{displayNew}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={styles.headerIconBg}>
                <Ionicons name="receipt-outline" size={22} color={Theme.primary} />
              </View>
              <View>
                <Text style={styles.title}>Settings Change History</Text>
                <Text style={styles.subtitle}>Audit trail of modifications by staff & admins</Text>
              </View>
            </View>
            
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={Theme.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Search & Filter Controls */}
          <View style={styles.filterSection}>
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={18} color="#A0AEC0" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by user, setting name..."
                placeholderTextColor="#A0AEC0"
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleSearch}
                returnKeyType="search"
              />
              {!!searchQuery && (
                <TouchableOpacity onPress={() => { setSearchQuery(''); fetchAuditLogs(); }}>
                  <Ionicons name="close-circle" size={16} color="#A0AEC0" />
                </TouchableOpacity>
              )}
            </View>

            {/* Category Filter Pills */}
            <FlatList
              horizontal
              data={CATEGORY_TABS}
              keyExtractor={(item) => item.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingVertical: 10 }}
              renderItem={({ item }) => {
                const isActive = selectedCategory === item.id;
                return (
                  <TouchableOpacity
                    style={[styles.pill, isActive && styles.pillActive]}
                    onPress={() => setSelectedCategory(item.id)}
                  >
                    <Text style={[styles.pillText, isActive && styles.pillTextActive]}>{item.label}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>

          {/* List Content */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Theme.primary} />
              <Text style={styles.loadingText}>Fetching audit records...</Text>
            </View>
          ) : (
            <FlatList
              data={logs}
              keyExtractor={(item) => item.AuditId}
              renderItem={renderLogItem}
              contentContainerStyle={{ padding: 16 }}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="clipboard-outline" size={48} color="#CBD5E0" />
                  <Text style={styles.emptyTitle}>No Settings Changes Found</Text>
                  <Text style={styles.emptySubtitle}>
                    {selectedCategory !== 'ALL' || searchQuery
                      ? 'Try clearing filters or search terms'
                      : 'Setting updates will automatically log changes here.'}
                  </Text>
                </View>
              }
            />
          )}

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#F7FAFC',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  headerIconBg: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#EDF2F7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  title: {
    fontFamily: Fonts.bold,
    fontSize: 18,
    color: Theme.textPrimary,
  },
  subtitle: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    color: Theme.textMuted,
  },
  closeBtn: {
    padding: 6,
  },
  filterSection: {
    backgroundColor: '#FFF',
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 38,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 6,
  },
  searchInput: {
    flex: 1,
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: Theme.textPrimary,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#EDF2F7',
    marginRight: 8,
  },
  pillActive: {
    backgroundColor: Theme.primary,
  },
  pillText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: '#4A5568',
  },
  pillTextActive: {
    color: '#FFF',
    fontFamily: Fonts.bold,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: Theme.textMuted,
    marginTop: 10,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontFamily: Fonts.bold,
    fontSize: 16,
    color: Theme.textPrimary,
    marginTop: 12,
  },
  emptySubtitle: {
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: Theme.textMuted,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  logCard: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  logCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    color: '#FFF',
    fontFamily: Fonts.bold,
    fontSize: 14,
  },
  userName: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: Theme.textPrimary,
  },
  userRole: {
    fontFamily: Fonts.regular,
    fontSize: 11,
    color: Theme.textMuted,
  },
  categoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  categoryBadgeText: {
    fontFamily: Fonts.bold,
    fontSize: 11,
  },
  fieldRow: {
    marginBottom: 8,
  },
  fieldLabel: {
    fontFamily: Fonts.bold,
    fontSize: 13,
    color: Theme.textPrimary,
  },
  diffContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7FAFC',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  diffBoxOld: {
    flex: 1,
    backgroundColor: '#FFF5F5',
    padding: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FEB2B2',
  },
  diffTag: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    color: '#E53E3E',
    marginBottom: 2,
  },
  diffValOld: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: '#C53030',
  },
  diffBoxNew: {
    flex: 1,
    backgroundColor: '#F0FFF4',
    padding: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#9AE6B4',
  },
  diffTagNew: {
    fontFamily: Fonts.bold,
    fontSize: 9,
    color: '#38A169',
    marginBottom: 2,
  },
  diffValNew: {
    fontFamily: Fonts.bold,
    fontSize: 12,
    color: '#276749',
  },
});
