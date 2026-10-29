/**
 * Sales Report PDF Generation Example Component
 * Shows how to integrate professional PDF download/email features
 * 
 * INTEGRATION EXAMPLE:
 * 
 * 1. Import the handler:
 *    import pdfHandler from '@/utils/pdfReportHandler';
 * 
 * 2. Add download button:
 *    <Button 
 *      onPress={() => pdfHandler.downloadSalesReportPdf('daily')}
 *      title="Download Daily Report"
 *    />
 * 
 * 3. Add email option:
 *    const handleEmailReport = async () => {
 *      const email = 'admin@restaurant.com';
 *      const result = await pdfHandler.emailSalesReportPdf(email, 'daily');
 *      Alert.alert('Result', result.message);
 *    };
 */

import pdfHandler from '@/utils/pdfReportHandler';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';

interface SalesReportPdfProps {
  onClose?: () => void;
}

export const SalesReportPdfGenerator: React.FC<SalesReportPdfProps> = ({ onClose }) => {
  const [selectedFilter, setSelectedFilter] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [emailAddress, setEmailAddress] = useState('');
  const [loading, setLoading] = useState(false);

  const filters = [
    { key: 'daily' as const, label: 'Daily Report' },
    { key: 'weekly' as const, label: 'Weekly Report' },
    { key: 'monthly' as const, label: 'Monthly Report' },
    { key: 'yearly' as const, label: 'Yearly Report' }
  ];

  const handleDownload = async () => {
    try {
      setLoading(true);
      await pdfHandler.downloadSalesReportPdf(selectedFilter);
      Alert.alert('Success', `${selectedFilter} report downloaded successfully!`);
    } catch (error) {
      Alert.alert('Error', 'Failed to download report');
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = async () => {
    try {
      setLoading(true);
      await pdfHandler.previewSalesReportPdf(selectedFilter);
    } catch (error) {
      Alert.alert('Error', 'Failed to preview report');
    } finally {
      setLoading(false);
    }
  };

  const handleEmail = async () => {
    if (!emailAddress.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address');
      return;
    }

    try {
      setLoading(true);
      const result = await pdfHandler.emailSalesReportPdf(emailAddress, selectedFilter);
      
      if (result.success) {
        Alert.alert('Success', result.message);
        setEmailAddress('');
      } else {
        Alert.alert('Failed', result.message);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to send email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Sales Report PDF</Text>
      <Text style={styles.subtitle}>
        Period: {pdfHandler.getPeriodString(selectedFilter)}
      </Text>

      {/* Filter Selection */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Select Report Period</Text>
        {filters.map(filter => (
          <TouchableOpacity
            key={filter.key}
            style={[
              styles.filterButton,
              selectedFilter === filter.key && styles.filterButtonActive
            ]}
            onPress={() => setSelectedFilter(filter.key)}
          >
            <Text
              style={[
                styles.filterButtonText,
                selectedFilter === filter.key && styles.filterButtonTextActive
              ]}
            >
              {filter.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Download Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Download Options</Text>

        <TouchableOpacity
          style={[styles.button, styles.buttonPrimary]}
          onPress={handleDownload}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>📥 Download PDF</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary]}
          onPress={handlePreview}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#2c3e50" />
          ) : (
            <Text style={[styles.buttonText, styles.buttonTextDark]}>👁️ Preview PDF</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Email Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Email Report</Text>

        <TextInput
          style={styles.emailInput}
          placeholder="Enter recipient email..."
          placeholderTextColor="#999"
          value={emailAddress}
          onChangeText={setEmailAddress}
          keyboardType="email-address"
          editable={!loading}
        />

        <TouchableOpacity
          style={[styles.button, styles.buttonSuccess]}
          onPress={handleEmail}
          disabled={loading || !emailAddress.includes('@')}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>📧 Send Email</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.helpText}>
          Enter an email address to send the consolidated sales report
        </Text>
      </View>

      {/* Info Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Report Details</Text>
        <Text style={styles.infoText}>
          ✓ Professional A4 PDF format{'\n'}
          ✓ Consolidated financial summary{'\n'}
          ✓ Payment method breakdown{'\n'}
          ✓ Order and item summaries{'\n'}
          ✓ Ready for printing and archiving
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff'
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 4
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24
  },
  section: {
    marginBottom: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ecf0f1'
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2c3e50',
    marginBottom: 12
  },
  filterButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9'
  },
  filterButtonActive: {
    borderColor: '#2c3e50',
    backgroundColor: '#2c3e50'
  },
  filterButtonText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500'
  },
  filterButtonTextActive: {
    color: '#fff'
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonPrimary: {
    backgroundColor: '#2c3e50'
  },
  buttonSecondary: {
    backgroundColor: '#ecf0f1',
    borderWidth: 1,
    borderColor: '#bdc3c7'
  },
  buttonSuccess: {
    backgroundColor: '#27ae60'
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff'
  },
  buttonTextDark: {
    color: '#2c3e50'
  },
  emailInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    fontSize: 14,
    color: '#333'
  },
  helpText: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
    fontStyle: 'italic'
  },
  infoText: {
    fontSize: 13,
    color: '#555',
    lineHeight: 20
  }
});

export default SalesReportPdfGenerator;
