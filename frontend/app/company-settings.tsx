import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Theme } from '../constants/theme';
import { Fonts } from '../constants/Fonts';
import BillPDFGenerator from '../components/BillPDFGenerator';
import { useToast } from '../components/Toast';
import { API_URL } from '@/constants/Config';
import { useCompanySettingsStore } from '../stores/companySettingsStore';
import { useAuthStore } from '../stores/authStore';
import AuditLogModal from '../components/AuditLogModal';

export default function CompanySettingsScreen() {
  const { settings, loading, fetchSettings, updateSettings } = useCompanySettingsStore();
  const { user } = useAuthStore();
  const [userId, setUserId] = useState('1');
  const [saving, setSaving] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);

  const [kitchenPrinters, setKitchenPrinters] = useState<any[]>([]);
  const [cashierIp, setCashierIp] = useState('');
  const [takeawayIp, setTakeawayIp] = useState('');
  const [kdsIp, setKdsIp] = useState('');
  const [loadingKitchens, setLoadingKitchens] = useState(false);
  const [showAddPrinterModal, setShowAddPrinterModal] = useState(false);
  const [newPrinterName, setNewPrinterName] = useState('');
  const [newPrinterIP, setNewPrinterIP] = useState('');

  // Bluetooth scanner state
  const [btModalVisible, setBtModalVisible] = useState(false);
  const [btDevices, setBtDevices] = useState<{ deviceName: string; macAddress: string }[]>([]);
  const [scanningBt, setScanningBt] = useState(false);
  const [activeBtTarget, setActiveBtTarget] = useState<string | number | null>(null);

  const [showPinModal, setShowPinModal] = useState(false);
  const [pin, setPin] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  
  const [password, setPassword] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // USB printer scanner state
  const [usbModalVisible, setUsbModalVisible] = useState(false);
  const [usbDevices, setUsbDevices] = useState<{ name: string; port: string; status: string }[]>([]);
  const [scanningUsb, setScanningUsb] = useState(false);
  const [activeUsbTarget, setActiveUsbTarget] = useState<string | number | null>(null);

  const scanUsbDevices = async (target: string | number) => {
    setActiveUsbTarget(target);
    setUsbModalVisible(true);
    setScanningUsb(true);
    setUsbDevices([]);
    try {
      const UniversalPrinter = require('../components/UniversalPrinter').default;
      const printers = await UniversalPrinter.detectUsbPrinters();
      if (Array.isArray(printers) && printers.length > 0) {
        setUsbDevices(printers);
      } else {
        setUsbDevices([
          { name: "TD80 Printer", port: "USB003", status: "Normal" },
          { name: "POS80", port: "POS80-Port", status: "Normal" }
        ]);
      }
    } catch (err: any) {
      console.warn("Error scanning USB printers:", err);
      setUsbDevices([
        { name: "TD80 Printer", port: "USB003", status: "Normal" }
      ]);
    } finally {
      setScanningUsb(false);
    }
  };

  const selectUsbDevice = (printerName: string) => {
    if (activeUsbTarget === "cashier") {
      setCashierIp(printerName);
      updateSettings({ printerIp: printerName });
    } else if (activeUsbTarget === "takeaway") {
      setTakeawayIp(printerName);
    } else if (activeUsbTarget === "kds") {
      setKdsIp(printerName);
    } else if (activeUsbTarget === "newPrinter") {
      setNewPrinterIP(printerName);
    } else if (typeof activeUsbTarget === "number") {
      const updated = [...kitchenPrinters];
      updated[activeUsbTarget].PrinterPath = printerName;
      setKitchenPrinters(updated);
    }
    setUsbModalVisible(false);
  };

  const scanBluetoothDevices = async (target: string | number) => {
    setActiveBtTarget(target);
    setBtModalVisible(true);
    setScanningBt(true);
    setBtDevices([]);
    try {
      if (Platform.OS === "android") {
        const ThermalPrinter = require("react-native-thermal-printer").default;
        const list = await ThermalPrinter.getBluetoothDeviceList();
        if (Array.isArray(list)) {
          setBtDevices(list);
        }
      } else {
        Alert.alert(
          "Bluetooth Scanner",
          "Bluetooth device scanning is active on Android POS devices. Connect your bluetooth printer in tablet settings to list it here."
        );
      }
    } catch (err: any) {
      console.warn("Error scanning Bluetooth devices:", err);
      Alert.alert(
        "Bluetooth Scan Failed",
        err?.message || "Could not retrieve paired Bluetooth devices. Ensure Bluetooth is ON."
      );
    } finally {
      setScanningBt(false);
    }
  };

  const selectBluetoothDevice = (macAddress: string) => {
    if (activeBtTarget === "cashier") {
      setCashierIp(macAddress);
      updateSettings({ printerIp: macAddress });
    } else if (activeBtTarget === "takeaway") {
      setTakeawayIp(macAddress);
    } else if (activeBtTarget === "kds") {
      setKdsIp(macAddress);
    } else if (activeBtTarget === "newPrinter") {
      setNewPrinterIP(macAddress);
    } else if (typeof activeBtTarget === "number") {
      const updated = [...kitchenPrinters];
      updated[activeBtTarget].PrinterPath = macAddress;
      setKitchenPrinters(updated);
    }
    setBtModalVisible(false);
  };

  const [localTakeawayCharges, setLocalTakeawayCharges] = useState<string>('');
  const [localGstPercentage, setLocalGstPercentage] = useState<string>('');
  const [localServiceChargePercentage, setLocalServiceChargePercentage] = useState<string>('');
  const [localTWServiceChargePercentage, setLocalTWServiceChargePercentage] = useState<string>('');
  const [hasInitializedLocal, setHasInitializedLocal] = useState(false);

  const router = useRouter();
  const { showToast } = useToast();

  const handleUnlock = async () => {
    if (!user?.userName) return;
    setVerifying(true);
    try {
      const response = await fetch(`${API_URL}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName: user.userName,
          password: password,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setIsUnlocked(true);
      } else {
        Alert.alert("Access Denied", "Incorrect Password");
      }
    } catch (error) {
      Alert.alert("Error", "Could not verify password. Check connection.");
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      setUserId("1");
      await fetchSettings("1");
      await fetchKitchenPrinters();
    };
    load();
  }, []);

  useEffect(() => {
    if (settings && !hasInitializedLocal) {
      setLocalTakeawayCharges(String(settings.takeawayCharges ?? 0));
      setLocalGstPercentage(String(settings.gstPercentage ?? 0));
      setLocalServiceChargePercentage(String(settings.serviceChargePercentage ?? 0));
      setLocalTWServiceChargePercentage(String(settings.twServiceChargePercentage ?? 0));
      setHasInitializedLocal(true);
    }
  }, [settings, hasInitializedLocal]);

  const fetchKitchenPrinters = async () => {
    try {
      setLoadingKitchens(true);
      const response = await fetch(`${API_URL}/api/settings/kitchen-printers`);
      const data = await response.json();
      if (Array.isArray(data)) {
        // Find Cashier printer (PrinterType = 1)
        const cashier = data.find(p => p.PrinterType === 1);
        if (cashier) {
          setCashierIp(cashier.PrinterPath || '');
        }

        // Find Takeaway printer (PrinterType = 3)
        const takeaway = data.find(p => p.PrinterType === 3);
        if (takeaway) {
          setTakeawayIp(takeaway.PrinterPath || '');
        }

        // Find KDS printer (PrinterType = 4)
        const kds = data.find(p => p.PrinterType === 4);
        if (kds) {
          setKdsIp(kds.PrinterPath || '');
        }

        // Filter and Deduplicate Kitchen printers (PrinterType = 2)
        const kitchens = data.filter(p => p.PrinterType === 2);
        const uniqueKitchens = kitchens.filter((item, index, self) =>
          index === self.findIndex(p => p.KitchenTypeValue === item.KitchenTypeValue)
        );
        setKitchenPrinters(uniqueKitchens);
      }
    } catch (error) {
      console.error('Failed to fetch kitchen printers:', error);
    } finally {
      setLoadingKitchens(false);
    }
  };

  const handleAddPrinter = async () => {
    if (!newPrinterName || !newPrinterIP) {
      showToast({ type: 'error', message: 'Please enter name and IP' });
      return;
    }
    try {
      setSaving(true);
      const res = await fetch(`${API_URL}/api/settings/kitchen-printers/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPrinterName, ip: newPrinterIP })
      });
      if (res.ok) {
        showToast({ type: 'success', message: 'Printer added' });
        setShowAddPrinterModal(false);
        setNewPrinterName('');
        setNewPrinterIP('');
        fetchKitchenPrinters();
      }
    } catch (err) {
      showToast({ type: 'error', message: 'Failed to add printer' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePrinter = async (id: number, name: string) => {
    setPendingDeleteId(id);
    setPin('');
    setShowPinModal(true);
  };

  const confirmDelete = async () => {
    if (!pin) {
      showToast({ type: 'error', message: 'Enter admin password' });
      return;
    }

    try {
      setSaving(true);
      // 1. Verify admin password
      const authRes = await fetch(`${API_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pin })
      });
      const authData = await authRes.json();

      if (!authData.success) {
        showToast({ type: 'error', message: 'Incorrect admin password' });
        return;
      }

      // 2. Proceed with delete
      const res = await fetch(`${API_URL}/api/settings/kitchen-printers/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pendingDeleteId })
      });

      if (res.ok) {
        showToast({ type: 'success', message: 'Printer removed' });
        setShowPinModal(false);
        fetchKitchenPrinters();
      }
    } catch (err) {
      showToast({ type: 'error', message: 'Failed to delete printer' });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const savePayload = {
        ...settings,
        userName: user?.userName || user?.fullName || '',
        userId: user?.userId || '',
        userRole: user?.roleName || user?.role || ''
      };
      const success = await BillPDFGenerator.saveSettings(savePayload, "1");
      
      // Build payload for all printers in PrintMaster
      const printersPayload = [
        {
          id: 0,
          ip: cashierIp,
          type: 1,
          name: 'Receipt Printer'
        },
        {
          id: 6,
          ip: takeawayIp,
          type: 3,
          name: 'TakeAway'
        },
        {
          id: 9,
          ip: kdsIp,
          type: 4,
          name: 'KDS Printer'
        },
        ...kitchenPrinters.map(kp => ({
          id: kp.KitchenTypeValue,
          ip: kp.PrinterPath,
          type: 2,
          name: kp.KitchenTypeName,
          printerId: kp.PrinterId,
          isActive: kp.IsActive !== undefined ? (kp.IsActive === 1 || kp.IsActive === true ? 1 : 0) : 1,
          isEnabled: kp.IsEnabled !== undefined ? (kp.IsEnabled === 1 || kp.IsEnabled === true ? 1 : 0) : 1
        }))
      ];

      // ✅ Save Kitchen, Cashier, and Takeaway Printers (gracefully handle if backend has no print service)
      let printerSaved = false;
      try {
        const printerUpdateResponse = await fetch(`${API_URL}/api/settings/kitchen-printers/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ printers: printersPayload })
        });
        printerSaved = printerUpdateResponse.ok;
      } catch (err) {
        console.warn("Printer routing save warning:", err);
      }

      if (success) {
        showToast({ type: 'success', message: 'Settings saved successfully' });
      } else {
        throw new Error('Company settings save failed');
      }
    } catch (error: any) {
      console.error("❌ Save settings error:", error);
      showToast({ type: 'error', message: error.message || 'Failed to save settings' });
    } finally {
      setSaving(false);
    }
  };

  const pickImage = async (type: 'company' | 'halal') => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      showToast({ type: 'error', message: 'Permission needed to access images' });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6, // Slightly lower quality to keep DB size manageable
      base64: true,
    });

    if (!result.canceled && result.assets[0]) {
      setSaving(true);
      try {
        let base64Data = result.assets[0].base64;
        
        // ✅ SMART MIME-TYPE DETECTION: Ensure PNG/JPEG accuracy for PDF engine
        let finalMime = result.assets[0].mimeType || 'image/jpeg';
        if (base64Data?.startsWith('iVBOR')) finalMime = 'image/png';

        const dataUri = `data:${finalMime};base64,${base64Data}`;
        const isCompany = type === 'company';
        updateSettings({
          [isCompany ? 'companyLogo' : 'halalLogo']: dataUri,
          [isCompany ? 'showCompanyLogo' : 'showHalalLogo']: true
        });
        showToast({ type: 'success', message: 'Logo processed successfully' });
      } catch (error) {
        showToast({ type: 'error', message: 'Failed to process image' });
      } finally {
        setSaving(false);
      }
    }
  };

  const removeLogo = async (type: 'company' | 'halal') => {
    const field = type === 'company' ? 'companyLogo' : 'halalLogo';
    const toggleField = type === 'company' ? 'showCompanyLogo' : 'showHalalLogo';
    const updated = { ...settings, [field]: '', [toggleField]: false };
    updateSettings({ [field]: '', [toggleField]: false });
    
    setSaving(true);
    try {
      // Sync with DB immediately
      await BillPDFGenerator.saveSettings(updated, userId);
      showToast({ type: 'info', message: 'Logo removed successfully' });
    } catch (err) {
      showToast({ type: 'error', message: 'Failed to remove logo' });
    } finally {
      setSaving(false);
    }
  };

  const getLogoUri = (logo: string) => {
    if (!logo) return undefined;
    if (logo.startsWith('data:image')) return logo;
    if (logo.startsWith('http')) return `${logo}?t=${Date.now()}`;
    return `${API_URL}${logo.startsWith('/') ? '' : '/'}${logo}?t=${Date.now()}`;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Theme.primary} />
        <Text style={{ marginTop: 20, fontFamily: Fonts.bold, color: Theme.textSecondary }}>
          Loading Shop Settings...
        </Text>
      </View>
    );
  }

  if (!isUnlocked) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <View style={styles.passwordCard}>
          <Ionicons name="lock-closed" size={48} color={Theme.primary} style={{ alignSelf: 'center', marginBottom: 15 }} />
          <Text style={styles.passwordTitle}>🔐 Admin Verification</Text>
          <Text style={styles.passwordSubtitle}>
            Enter admin password to access Shop Settings
          </Text>
          <TextInput
            style={styles.passwordInput}
            placeholder="Enter Password"
            placeholderTextColor="#A0AEC0"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={handleUnlock}
            returnKeyType="done"
            autoFocus
          />
          <View style={styles.passwordActions}>
            <TouchableOpacity
              style={[styles.passwordBtn, styles.cancelBtn]}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/(tabs)/category' as any);
                }
              }}
            >
              <Text style={styles.cancelBtnText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.passwordBtn, styles.confirmBtn]}
              onPress={handleUnlock}
              disabled={verifying}
            >
              {verifying ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.confirmBtnText}>Verify</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/category' as any);
            }
          }}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={Theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Shop Settings</Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity 
            style={[styles.saveButton, { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 38, paddingHorizontal: 16 }]} 
            onPress={() => setShowAuditModal(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="receipt-outline" size={16} color={Theme.textPrimary} />
            <Text style={[styles.saveButtonText, { color: Theme.textPrimary }]}>Audit Log</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.saveButton, { height: 38, justifyContent: 'center', paddingHorizontal: 22 }, saving && styles.saveButtonDisabled]} 
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>


      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          
          {/* Logo Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Branding</Text>
            <View style={styles.logoGrid}>
              <View style={styles.logoItem}>
                <Text style={styles.logoLabel}>Company Logo</Text>
                <View style={styles.logoPickerContainer}>
                  <TouchableOpacity 
                    style={[styles.logoPicker, settings.companyLogo ? styles.logoPickerActive : null]} 
                    onPress={() => pickImage('company')}
                  >
                    {settings.companyLogo ? (
                      <Image source={{ uri: getLogoUri(settings.companyLogo) }} style={styles.logoPreview} />
                    ) : (
                      <Ionicons name="cloud-upload-outline" size={30} color={Theme.textMuted} />
                    )}
                  </TouchableOpacity>
                  {!!settings.companyLogo && (
                    <TouchableOpacity 
                      style={styles.removeIconBtn} 
                      onPress={() => removeLogo('company')}
                    >
                      <Ionicons name="trash-outline" size={16} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.statusContainer}>
                   <Text style={[styles.statusText, settings.companyLogo ? styles.statusSuccess : styles.statusMuted]}>
                     {settings.companyLogo ? '✅ Uploaded' : '❌ Not Uploaded'}
                   </Text>
                </View>
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleText}>{settings.showCompanyLogo ? 'Show on bill' : 'Hidden on bill'}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      const val = !settings.showCompanyLogo;
                      if (val && !settings.companyLogo) {
                        showToast({ type: 'error', message: 'Upload a logo first' });
                        return;
                      }
                      updateSettings({ showCompanyLogo: val });
                    }}
                    style={[
                      styles.toggleSwitch,
                      settings.showCompanyLogo && styles.toggleSwitchOn,
                    ]}
                    activeOpacity={0.8}
                  >
                    <View style={[
                      styles.toggleThumb,
                      settings.showCompanyLogo && styles.toggleThumbOn,
                    ]} />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.logoItem}>
                <Text style={styles.logoLabel}>Halal Logo</Text>
                <View style={styles.logoPickerContainer}>
                  <TouchableOpacity 
                    style={[styles.logoPicker, settings.halalLogo ? styles.logoPickerActive : null]} 
                    onPress={() => pickImage('halal')}
                  >
                    {settings.halalLogo ? (
                      <Image source={{ uri: getLogoUri(settings.halalLogo) }} style={styles.logoPreview} />
                    ) : (
                      <Ionicons name="ribbon-outline" size={30} color={Theme.textMuted} />
                    )}
                  </TouchableOpacity>
                  {!!settings.halalLogo && (
                    <TouchableOpacity 
                      style={styles.removeIconBtn} 
                      onPress={() => removeLogo('halal')}
                    >
                      <Ionicons name="trash-outline" size={16} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.statusContainer}>
                   <Text style={[styles.statusText, settings.halalLogo ? styles.statusSuccess : styles.statusMuted]}>
                     {settings.halalLogo ? '✅ Uploaded' : '❌ Not Uploaded'}
                   </Text>
                </View>
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleText}>{settings.showHalalLogo ? 'Show on bill' : 'Hidden on bill'}</Text>
                  <TouchableOpacity
                    onPress={() => {
                      const val = !settings.showHalalLogo;
                      if (val && !settings.halalLogo) {
                        showToast({ type: 'error', message: 'Upload a logo first' });
                        return;
                      }
                      updateSettings({ showHalalLogo: val });
                    }}
                    style={[
                      styles.toggleSwitch,
                      settings.showHalalLogo && styles.toggleSwitchOn,
                    ]}
                    activeOpacity={0.8}
                  >
                    <View style={[
                      styles.toggleThumb,
                      settings.showHalalLogo && styles.toggleThumbOn,
                    ]} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>

          {/* Shop Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Shop Information</Text>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Company Name</Text>
              <TextInput 
                style={styles.input}
                value={settings.name}
                onChangeText={(val) => { updateSettings({ name: val }); }}
                placeholder="Enter shop name"
                placeholderTextColor={Theme.textMuted}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Address</Text>
              <TextInput 
                style={[styles.input, styles.textArea]}
                value={settings.address}
                onChangeText={(val) => { updateSettings({ address: val }); }}
                placeholder="Enter shop address"
                placeholderTextColor={Theme.textMuted}
                multiline
                numberOfLines={3}
              />
            </View>

            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
                <Text style={styles.inputLabel}>Phone</Text>
                <TextInput 
                  style={styles.input}
                  value={settings.phone}
                  onChangeText={(val) => { updateSettings({ phone: val }); }}
                  placeholder="+65 ..."
                  placeholderTextColor={Theme.textMuted}
                  keyboardType="phone-pad"
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Email</Text>
                <TextInput 
                  style={styles.input}
                  value={settings.email}
                  onChangeText={(val) => { updateSettings({ email: val }); }}
                  placeholder="Enter shop email"
                  placeholderTextColor={Theme.textMuted}
                  keyboardType="email-address"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
                <Text style={styles.inputLabel}>Report Email</Text>
                <TextInput 
                  style={styles.input}
                  value={settings.reportEmail || ''}
                  onChangeText={(val) => { updateSettings({ reportEmail: val }); }}
                  placeholder="e.g. reports@company.com"
                  placeholderTextColor={Theme.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>
              <View style={{ flex: 1 }} />
            </View>

            <View style={{ marginTop: 20 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.inputLabel, { marginBottom: 0 }]}>Cashier / Receipt Printer (USB / IP / BT)</Text>
                  <TouchableOpacity
                    style={styles.smallBtBtn}
                    onPress={() => scanBluetoothDevices("cashier")}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="bluetooth" size={14} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.smallBtBtn, { backgroundColor: '#10B981', paddingHorizontal: 6, width: 'auto' }]}
                    onPress={() => scanUsbDevices("cashier")}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="hardware-chip" size={13} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold', marginLeft: 3 }}>USB</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TextInput 
                style={styles.input}
                value={cashierIp}
                onChangeText={(val) => {
                  setCashierIp(val);
                  updateSettings({ printerIp: val });
                }}
                placeholder="e.g. TD80 Printer, 192.168.1.100, or BT MAC"
                placeholderTextColor={Theme.textMuted}
                autoCapitalize="characters"
              />
              <Text style={[styles.note, { textAlign: 'left', marginTop: 5 }]}>
                Used for printing Payment Receipts and Checkout Bills at the cashier counter.
              </Text>
            </View>

            <View style={{ marginTop: 15 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.inputLabel, { marginBottom: 0 }]}>TakeAway Printer (USB / IP / BT)</Text>
                  <TouchableOpacity
                    style={styles.smallBtBtn}
                    onPress={() => scanBluetoothDevices("takeaway")}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="bluetooth" size={14} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.smallBtBtn, { backgroundColor: '#10B981', paddingHorizontal: 6, width: 'auto' }]}
                    onPress={() => scanUsbDevices("takeaway")}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="hardware-chip" size={13} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold', marginLeft: 3 }}>USB</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TextInput 
                style={styles.input}
                value={takeawayIp}
                onChangeText={setTakeawayIp}
                placeholder="e.g. TD80 Printer, 192.168.1.102, or BT MAC"
                placeholderTextColor={Theme.textMuted}
                autoCapitalize="characters"
              />
              <Text style={[styles.note, { textAlign: 'left', marginTop: 5 }]}>
                Used for printing Takeaway receipts and dockets.
              </Text>
            </View>

            <View style={{ marginTop: 15 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.inputLabel, { marginBottom: 0 }]}>KDS Printer (USB / IP / BT)</Text>
                  <TouchableOpacity
                    style={styles.smallBtBtn}
                    onPress={() => scanBluetoothDevices("kds")}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="bluetooth" size={14} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.smallBtBtn, { backgroundColor: '#10B981', paddingHorizontal: 6, width: 'auto' }]}
                    onPress={() => scanUsbDevices("kds")}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="hardware-chip" size={13} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold', marginLeft: 3 }}>USB</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TextInput 
                style={styles.input}
                value={kdsIp}
                onChangeText={setKdsIp}
                placeholder="e.g. TD80 Printer, 192.168.1.105, or BT MAC"
                placeholderTextColor={Theme.textMuted}
                autoCapitalize="characters"
              />
              <Text style={[styles.note, { textAlign: 'left', marginTop: 5 }]}>
                Used exclusively for printing KDS orders.
              </Text>
            </View>
          </View>

          {/* Tax & Currency */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tax & Currency</Text>
            
            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
                <Text style={styles.inputLabel}>GST Number</Text>
                <TextInput 
                  style={styles.input}
                  value={settings.gstNo}
                  onChangeText={(val) => { updateSettings({ gstNo: val }); }}
                  placeholder="Registration No"
                  placeholderTextColor={Theme.textMuted}
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>GST (%)</Text>
                <TextInput 
                  style={styles.input}
                  value={localGstPercentage}
                  onChangeText={(val) => {
                    setLocalGstPercentage(val);
                    const parsed = parseFloat(val);
                    updateSettings({ gstPercentage: isNaN(parsed) ? 0 : parsed });
                  }}
                  placeholder="9.0"
                  placeholderTextColor={Theme.textMuted}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
                <Text style={styles.inputLabel}>Service Charge (%)</Text>
                <TextInput 
                  style={styles.input}
                  value={localServiceChargePercentage}
                  onChangeText={(val) => {
                    setLocalServiceChargePercentage(val);
                    const parsed = parseFloat(val);
                    updateSettings({ serviceChargePercentage: isNaN(parsed) ? 0 : parsed });
                  }}
                  placeholder="10.0"
                  placeholderTextColor={Theme.textMuted}
                  keyboardType="numeric"
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>TW Service Charge (%)</Text>
                <TextInput 
                  style={styles.input}
                  value={localTWServiceChargePercentage}
                  onChangeText={(val) => {
                    setLocalTWServiceChargePercentage(val);
                    const parsed = parseFloat(val);
                    updateSettings({ twServiceChargePercentage: isNaN(parsed) ? 0 : parsed });
                  }}
                  placeholder="5.0"
                  placeholderTextColor={Theme.textMuted}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Takeaway Charge</Text>
                <TextInput 
                  style={styles.input}
                  value={localTakeawayCharges}
                  onChangeText={(val) => {
                    setLocalTakeawayCharges(val);
                    const parsed = parseFloat(val);
                    updateSettings({ takeawayCharges: isNaN(parsed) ? 0 : parsed });
                  }}
                  placeholder="0.30"
                  placeholderTextColor={Theme.textMuted}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
                <Text style={styles.inputLabel}>Currency Code</Text>
                <TextInput 
                  style={styles.input}
                  value={settings.currency}
                  onChangeText={(val) => { updateSettings({ currency: val }); }}
                  placeholder="SGD"
                  placeholderTextColor={Theme.textMuted}
                />
              </View>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Symbol</Text>
                <TextInput 
                  style={styles.input}
                  value={settings.currencySymbol}
                  onChangeText={(val) => { updateSettings({ currencySymbol: val }); }}
                  placeholder="$"
                  placeholderTextColor={Theme.textMuted}
                />
              </View>
            </View>
          </View>
          
          {/* Kitchen Printer Settings */}
          <View style={styles.section}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Smart Kitchen Routing</Text>
            </View>

            {loadingKitchens ? (
              <ActivityIndicator size="small" color={Theme.primary} />
            ) : kitchenPrinters.length > 0 ? (
              kitchenPrinters.map((printer, index) => (
                <View key={printer.KitchenTypeValue} style={styles.inputGroup}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={styles.inputLabel}>{printer.KitchenTypeName} Printer IP / BT</Text>
                      <TouchableOpacity
                        style={styles.smallBtBtn}
                        onPress={() => scanBluetoothDevices(index)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="bluetooth" size={14} color="#fff" />
                      </TouchableOpacity>
                    </View>
                    
                    <TouchableOpacity
                      onPress={() => {
                        const currentEnabled = printer.IsEnabled === undefined ? true : (printer.IsEnabled === 1 || printer.IsEnabled === true);
                        const updated = kitchenPrinters.map((kp, idx) => 
                          idx === index ? { ...kp, IsEnabled: currentEnabled ? 0 : 1 } : kp
                        );
                        setKitchenPrinters(updated);
                      }}
                      style={[styles.toggleSwitch, (printer.IsEnabled === undefined || printer.IsEnabled === 1 || printer.IsEnabled === true) && styles.toggleSwitchOn]}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.toggleThumb, (printer.IsEnabled === undefined || printer.IsEnabled === 1 || printer.IsEnabled === true) && styles.toggleThumbOn]} />
                    </TouchableOpacity>
                  </View>
                  <TextInput 
                    style={[styles.input, (printer.IsEnabled === 0 || printer.IsEnabled === false) && { opacity: 0.5 }]}
                    value={printer.PrinterPath || ''}
                    onChangeText={(val) => {
                      const updated = [...kitchenPrinters];
                      updated[index].PrinterPath = val;
                      setKitchenPrinters(updated);
                    }}
                    placeholder="e.g. 192.168.1.101 or Bluetooth MAC"
                    placeholderTextColor={Theme.textMuted}
                    autoCapitalize="characters"
                    editable={printer.IsEnabled === undefined || printer.IsEnabled === 1 || printer.IsEnabled === true}
                  />
                </View>
              ))
            ) : (
              <Text style={styles.note}>No kitchen types found in database.</Text>
            )}
            <Text style={[styles.note, { textAlign: 'left', marginTop: 5 }]}>
              These IPs are used to automatically route items to specific kitchens.
            </Text>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Add Printer Modal */}
      <Modal visible={showAddPrinterModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Kitchen Printer</Text>
            
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Kitchen Name</Text>
              <TextInput 
                style={styles.input}
                value={newPrinterName}
                onChangeText={setNewPrinterName}
                placeholder="e.g. THAI KITCHEN"
                placeholderTextColor={Theme.textMuted}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Printer IP Address</Text>
              <TextInput 
                style={styles.input}
                value={newPrinterIP}
                onChangeText={setNewPrinterIP}
                placeholder="e.g. 192.168.1.101"
                placeholderTextColor={Theme.textMuted}
                keyboardType="numeric"
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.cancelBtn]} 
                onPress={() => setShowAddPrinterModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.confirmBtn]} 
                onPress={handleAddPrinter}
              >
                <Text style={styles.confirmBtnText}>Add Kitchen</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Admin PIN Modal */}
      <Modal visible={showPinModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 320 }]}>
            <Ionicons name="lock-closed" size={40} color={Theme.primary} style={{ alignSelf: 'center', marginBottom: 15 }} />
            <Text style={styles.modalTitle}>Admin Verification</Text>
            <Text style={[styles.note, { marginBottom: 20 }]}>Enter admin password to delete this kitchen routing.</Text>
            
            <TextInput 
              style={[styles.input, { textAlign: 'center', fontSize: 24, letterSpacing: 5 }]}
              value={pin}
              onChangeText={setPin}
              placeholder="••••"
              placeholderTextColor={Theme.textMuted}
              secureTextEntry
              autoFocus
            />

            <View style={[styles.modalActions, { marginTop: 20 }]}>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.cancelBtn]} 
                onPress={() => setShowPinModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, styles.confirmBtn]} 
                onPress={confirmDelete}
              >
                <Text style={styles.confirmBtnText}>Verify</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Bluetooth Device Selector Modal ── */}
      <Modal visible={btModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 460 }]}>
            {/* Modal Header */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: Theme.primary + "20", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="bluetooth" size={20} color={Theme.primary} />
                </View>
                <Text style={[styles.modalTitle, { marginBottom: 0 }]}>Select Bluetooth Printer</Text>
              </View>
              <TouchableOpacity onPress={() => setBtModalVisible(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={22} color={Theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Modal Body */}
            {scanningBt ? (
              <View style={{ padding: 32, alignItems: "center", gap: 12 }}>
                <ActivityIndicator size="large" color={Theme.primary} />
                <Text style={{ fontFamily: Fonts.medium, color: Theme.textSecondary, fontSize: 13 }}>
                  Scanning paired Bluetooth devices...
                </Text>
              </View>
            ) : btDevices.length > 0 ? (
              <ScrollView style={{ maxHeight: 280, marginVertical: 4 }} showsVerticalScrollIndicator={false}>
                {btDevices.map((dev, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.btItemRow}
                    onPress={() => selectBluetoothDevice(dev.macAddress)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.btIconCircle}>
                      <Ionicons name="print-outline" size={18} color={Theme.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.btDeviceName}>{dev.deviceName || "Thermal Printer"}</Text>
                      <Text style={styles.btMacAddress}>{dev.macAddress}</Text>
                    </View>
                    <View style={styles.btSelectBadge}>
                      <Text style={styles.btSelectBadgeText}>Select</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : (
              <View style={{ paddingVertical: 18, alignItems: "center" }}>
                <Ionicons name="alert-circle-outline" size={40} color={Theme.warning} />
                <Text style={{ fontFamily: Fonts.bold, color: Theme.textPrimary, marginTop: 10, fontSize: 15 }}>
                  No Paired Bluetooth Printers Found
                </Text>
                <Text style={{ fontFamily: Fonts.medium, color: Theme.textSecondary, fontSize: 12, marginTop: 6, textAlign: "center", lineHeight: 18, paddingHorizontal: 10 }}>
                  Ensure your thermal printer is turned ON and paired in your Android tablet's Bluetooth settings (PIN: 0000 or 1234).
                </Text>
              </View>
            )}

            {/* Modal Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setBtModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.confirmBtn]}
                onPress={() => activeBtTarget !== null && scanBluetoothDevices(activeBtTarget)}
              >
                <Text style={styles.confirmBtnText}>Rescan</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Settings Change Audit Log Modal */}
      <AuditLogModal
        visible={showAuditModal}
        onClose={() => setShowAuditModal(false)}
      />

      {/* USB Printer Scanner Modal */}
      <Modal
        visible={usbModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setUsbModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setUsbModalVisible(false)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>🔌 USB Receipt Printers</Text>
            {scanningUsb ? (
              <View style={{ padding: 20, alignItems: "center" }}>
                <ActivityIndicator size="large" color={Theme.primary} />
                <Text style={{ marginTop: 10, color: Theme.textSecondary }}>
                  Detecting connected USB printers...
                </Text>
              </View>
            ) : usbDevices.length === 0 ? (
              <View style={{ padding: 20, alignItems: "center" }}>
                <Text style={{ color: Theme.textSecondary, textAlign: "center", marginBottom: 15 }}>
                  No USB printers detected automatically. Tap below to select TD80 Printer.
                </Text>
                <TouchableOpacity
                  style={[styles.modalBtn, styles.confirmBtn, { width: 160 }]}
                  onPress={() => selectUsbDevice("TD80 Printer")}
                >
                  <Text style={styles.confirmBtnText}>Select TD80 Printer</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 250, marginVertical: 10 }}>
                {usbDevices.map((item, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={{
                      padding: 12,
                      borderBottomWidth: 1,
                      borderBottomColor: Theme.border,
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                    onPress={() => selectUsbDevice(item.name)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "bold", fontSize: 15, color: Theme.textPrimary }}>
                        {item.name}
                      </Text>
                      <Text style={{ fontSize: 12, color: Theme.textSecondary }}>
                        Port: {item.port || 'USB'} | Status: {item.status || 'Normal'}
                      </Text>
                    </View>
                    <Ionicons name="checkmark-circle-outline" size={22} color={Theme.primary} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <View style={[styles.modalActions, { marginTop: 15 }]}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setUsbModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.bgMain,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Theme.bgMain, // 🟢 Force correct background
  },
  passwordCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 28,
    width: '88%',
    maxWidth: 400,
    ...Theme.shadowLg,
  },
  passwordTitle: {
    fontSize: 22,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  passwordSubtitle: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  passwordInput: {
    backgroundColor: Theme.bgNav,
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    borderWidth: 1,
    borderColor: Theme.border,
    marginBottom: 16,
  },
  passwordActions: {
    flexDirection: 'row',
    gap: 12,
  },
  passwordBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  backButton: {
    padding: 5,
  },
  saveButton: {
    backgroundColor: Theme.primary,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 70,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontFamily: Fonts.bold,
    fontSize: 14,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    marginBottom: 20,
    ...Theme.shadowSm,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginBottom: 20,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  logoGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  logoItem: {
    width: '48%',
    alignItems: 'center',
  },
  logoLabel: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    marginBottom: 10,
  },
  logoPicker: {
    width: 100,
    height: 100,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: Theme.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Theme.bgNav,
    overflow: 'hidden',
  },
  logoPickerContainer: {
    position: 'relative',
    width: 100,
    height: 100,
  },
  removeIconBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: Theme.danger,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    ...Theme.shadowSm,
    zIndex: 10,
  },
  logoPickerActive: {
    borderStyle: 'solid',
    borderColor: Theme.primaryBorder,
    backgroundColor: Theme.primaryLight,
  },
  statusContainer: {
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: Theme.bgNav,
  },
  statusText: {
    fontSize: 10,
    fontFamily: Fonts.bold,
  },
  statusSuccess: {
    color: Theme.success,
  },
  statusMuted: {
    color: Theme.textMuted,
  },
  logoPreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  toggleText: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  toggleSwitch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ddd',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleSwitchOn: {
    backgroundColor: Theme.primary,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
    alignSelf: 'flex-start',
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },
  inputGroup: {
    marginBottom: 15,
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Theme.bgNav,
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
  },
  note: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    textAlign: 'center',
    marginTop: 10,
  },
  addPrinterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  addPrinterText: {
    color: Theme.primary,
    fontFamily: Fonts.bold,
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    ...Theme.shadowLg,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginBottom: 20,
    textAlign: 'center',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  modalBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: Theme.bgNav,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  confirmBtn: {
    backgroundColor: Theme.primary,
  },
  cancelBtnText: {
    color: Theme.textSecondary,
    fontFamily: Fonts.bold,
  },
  confirmBtnText: {
    color: '#fff',
    fontFamily: Fonts.bold,
  },
  smallBtBtn: {
    backgroundColor: Theme.primary,
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: "center",
    alignItems: "center",
    elevation: 2,
  },
  btItemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: Theme.bgNav,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Theme.border,
    gap: 12,
  },
  btIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Theme.primary + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  btDeviceName: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: Theme.textPrimary,
  },
  btMacAddress: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    color: Theme.textMuted,
    marginTop: 2,
  },
  btSelectBadge: {
    backgroundColor: Theme.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  btSelectBadgeText: {
    color: "#fff",
    fontFamily: Fonts.bold,
    fontSize: 12,
  },
});
