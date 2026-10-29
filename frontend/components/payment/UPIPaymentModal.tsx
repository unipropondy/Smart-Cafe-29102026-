import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { Theme } from "../../constants/theme";
import { usePaymentSettingsStore } from "../../stores/paymentSettingsStore";

const { width } = Dimensions.get('window');

interface UPIPaymentModalProps {
  visible: boolean;
  onClose: () => void;
  amount: number;
  onSuccess: () => void;
  onFailed?: () => void;
}

const UPIPaymentModal: React.FC<UPIPaymentModalProps> = ({
  visible,
  onClose,
  amount,
  onSuccess,
  onFailed
}) => {
  const { settings } = usePaymentSettingsStore();
  const [showQR, setShowQR] = useState(false);
  
  useEffect(() => {
    if (visible) {
      // Small delay to ensure modal is fully visible before drawing QR
      const timer = setTimeout(() => setShowQR(true), 300);
      return () => clearTimeout(timer);
    } else {
      setShowQR(false);
    }
  }, [visible]);

  const handleManualSuccess = () => {
    console.log("✅ UPI Payment Received clicked");
    if (Platform.OS === 'web') {
      onSuccess();
      onClose();
    } else {
      Alert.alert(
        'Confirm Payment',
        'Have you verified the payment in your bank account?',
        [
          { text: 'No', style: 'cancel' },
          {
            text: 'Yes, Received',
            onPress: () => {
              onSuccess();
              onClose();
            }
          }
        ]
      );
    }
  };

  // Generate UPI URL using the same logic provided in the prompt
  const generateUPIUrl = () => {
    if (!settings.upiId) return '';
    const cleanUpiId = settings.upiId.trim();
    const cleanShopName = settings.shopName.replace(/[&?=]/g, '').trim();
    // cu=INR is standard, but we'll use it as the base
    return `upi://pay?pa=${cleanUpiId}&pn=${encodeURIComponent(cleanShopName)}&am=${amount.toFixed(2)}&cu=INR`;
  };

  if (!settings.upiId) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>UPI QR Payment</Text>
                <Text style={styles.subtitle} numberOfLines={1}>{settings.shopName}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color={Theme.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Amount Box */}
            <View style={styles.amountContainer}>
              <Text style={styles.amountLabel}>Total Amount to Collect</Text>
              <Text style={styles.amountValue}>${amount.toFixed(2)}</Text>
            </View>

            {/* QR Code Container */}
            <View style={styles.qrContainer}>
              {showQR ? (
                <View style={styles.qrBox}>
                  <QRCode
                    value={generateUPIUrl()}
                    size={160}
                    color="#000"
                    backgroundColor="#fff"
                  />
                </View>
              ) : (
                <View style={[styles.qrBox, styles.qrLoader]}>
                  <ActivityIndicator size="large" color={Theme.primary} />
                </View>
              )}
              <Text style={styles.qrSubtext}>
                Ask customer to scan with any UPI App
              </Text>
            </View>

            {/* Action Buttons */}
            <TouchableOpacity
              style={styles.successButton}
              onPress={handleManualSuccess}
            >
              <Ionicons name="checkmark-circle" size={24} color="#fff" />
              <Text style={styles.successButtonText}>Payment Received</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.failedButton}
              activeOpacity={0.6}
              onPress={() => {
                console.log("❌ UPI Cancel clicked");
                if (Platform.OS === 'web') {
                  if (onFailed) onFailed();
                  onClose();
                } else {
                  Alert.alert('Cancel Payment', 'Are you sure you want to cancel this UPI transaction?', [
                    { text: 'No', style: 'cancel' },
                    {
                      text: 'Yes, Cancel',
                      onPress: () => {
                        if (onFailed) onFailed();
                        onClose();
                      }
                    }
                  ]);
                }
              }}
            >
              <Text style={styles.failedButtonText}>Cancel Transaction</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 320,
    maxHeight: '85%',
    backgroundColor: '#fff',
    borderRadius: 20,
    overflow: 'hidden',
    ...Theme.shadowLg,
  },
  scrollContent: {
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: Theme.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: Theme.textSecondary,
    marginTop: 1,
  },
  closeBtn: {
    padding: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
  },
  amountContainer: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  amountLabel: {
    fontSize: 11,
    color: Theme.textSecondary,
    fontWeight: '600',
    marginBottom: 2,
  },
  amountValue: {
    fontSize: 22,
    fontWeight: '900',
    color: Theme.primary,
  },
  qrContainer: {
    alignItems: 'center',
    marginBottom: 10,
  },
  qrBox: {
    padding: 10,
    backgroundColor: '#fff',
    borderRadius: 16,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  qrLoader: {
    width: width > 500 ? 180 : 150,
    height: width > 500 ? 180 : 150,
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrSubtext: {
    fontSize: 11,
    color: Theme.textSecondary,
    marginTop: 8,
    fontWeight: '500',
  },
  successButton: {
    flexDirection: 'row',
    backgroundColor: '#22c55e',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  successButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  failedButton: {
    padding: 6,
    alignItems: 'center',
  },
  failedButtonText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default UPIPaymentModal;
