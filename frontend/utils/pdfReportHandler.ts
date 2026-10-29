/**
 * Professional PDF Report Handler
 * Handles downloading and emailing consolidated sales reports
 */

import axios from "axios";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import { Alert, Platform } from "react-native";
import { API_URL } from "../constants/Config";

const API_BASE_URL = `${API_URL}/api`;

/**
 * Download consolidated sales report PDF
 * @param {string} filter - 'daily' | 'weekly' | 'monthly' | 'yearly'
 * @param {string} date - Optional specific date (YYYY-MM-DD format)
 * @returns {Promise<void>}
 */
export const downloadSalesReportPdf = async (filter = "daily", date = null) => {
  try {
    // Build API URL
    let url = `${API_BASE_URL}/sales/consolidated-report/pdf?filter=${filter}`;
    if (date) {
      url += `&date=${date}`;
    }

    console.log("[PDF Download] Fetching from:", url);

    // Download PDF
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000, // 30 second timeout
    });

    if (!response.data || response.status !== 200) {
      throw new Error(`Failed to download PDF: ${response.status}`);
    }

    // Save to file system
    const fileName = `Sales_Report_${filter}_${new Date().toISOString().split("T")[0]}.pdf`;
    const fileUri = `${FileSystem.documentDirectory}${fileName}`;

    console.log("[PDF Download] Saving to:", fileUri);

    await FileSystem.writeAsStringAsync(
      fileUri,
      Buffer.from(response.data).toString("base64"),
      { encoding: FileSystem.EncodingType.Base64 },
    );

    console.log("[PDF Download] File saved successfully");

    // Open share dialog
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(fileUri, {
        mimeType: "application/pdf",
        dialogTitle: `Sales Report - ${filter}`,
        UTI: "com.adobe.pdf",
      });
    } else {
      Alert.alert("Success", `Report saved to: ${fileName}`, [
        { text: "OK", onPress: () => {} },
      ]);
    }
  } catch (error: any) {
    console.error("[PDF Download] Error:", error.message);
    Alert.alert(
      "Download Failed",
      error.message || "Failed to download the sales report PDF",
      [{ text: "OK", onPress: () => {} }],
    );
  }
};

/**
 * Email consolidated sales report PDF
 * @param {string} recipientEmail - Email address to send to
 * @param {string} filter - 'daily' | 'weekly' | 'monthly' | 'yearly'
 * @param {string} date - Optional specific date (YYYY-MM-DD format)
 * @returns {Promise<{success: boolean, message: string}>}
 */
export const emailSalesReportPdf = async (
  recipientEmail: string,
  filter = "daily",
  date = null,
) => {
  try {
    if (!recipientEmail || !recipientEmail.includes("@")) {
      throw new Error("Please provide a valid email address");
    }

    // Build API URL for PDF generation
    let reportUrl = `${API_BASE_URL}/sales/consolidated-report/pdf?filter=${filter}`;
    if (date) {
      reportUrl += `&date=${date}`;
    }

    console.log("[PDF Email] Requesting PDF generation from:", reportUrl);

    // Request email send
    const emailUrl = `${API_BASE_URL}/export/email-pdf`;
    const response = await axios.post(
      emailUrl,
      {
        email: recipientEmail,
        reportData: {
          // Pass minimal data; the endpoint will generate fresh data
          period: getPeriodString(filter, date),
          filterType: filter,
        },
      },
      { timeout: 30000 },
    );

    //javi
    if (response.data?.success) {
      return {
        success: true,
        message: `Report sent successfully to ${recipientEmail}`,
      };
    } else {
      throw new Error(response.data?.error || "Failed to send email");
    }
  } catch (error: any) {
    console.error("[PDF Email] Error:", error.message);
    return {
      success: false,
      message:
        error.response?.data?.error ||
        error.message ||
        "Failed to send report email",
    };
  }
};

/**
 * Get human-readable period string
 * @param {string} filter - 'daily' | 'weekly' | 'monthly' | 'yearly'
 * @param {string} date - Optional specific date
 * @returns {string} Period description
 */
export const getPeriodString = (filter = "daily", date = null) => {
  const today = new Date();
  const todayStr = today.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  switch (filter) {
    case "weekly": {
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - 6);
      const weekStartStr = weekStart.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      return `${weekStartStr} to ${todayStr}`;
    }
    case "monthly": {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      const monthStartStr = monthStart.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      return `${monthStartStr} to ${todayStr}`;
    }
    case "yearly": {
      const yearStart = new Date(today.getFullYear(), 0, 1);
      const yearStartStr = yearStart.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
      return `${yearStartStr} to ${todayStr}`;
    }
    case "daily":
    default:
      return todayStr;
  }
};

/**
 * Generate and preview report in device's PDF viewer (if available)
 * @param {string} filter - 'daily' | 'weekly' | 'monthly' | 'yearly'
 * @param {string} date - Optional specific date
 * @returns {Promise<void>}
 */
export const previewSalesReportPdf = async (filter = "daily", date = null) => {
  try {
    if (Platform.OS === "web") {
      // On web, open in new tab
      let url = `${API_BASE_URL}/sales/consolidated-report/pdf?filter=${filter}`;
      if (date) {
        url += `&date=${date}`;
      }
      window.open(url, "_blank");
      return;
    }

    // On mobile, download then open
    let url = `${API_BASE_URL}/sales/consolidated-report/pdf?filter=${filter}`;
    if (date) {
      url += `&date=${date}`;
    }

    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
    });

    const fileName = `Sales_Report_${filter}_${new Date().toISOString().split("T")[0]}.pdf`;
    const fileUri = `${FileSystem.documentDirectory}${fileName}`;

    await FileSystem.writeAsStringAsync(
      fileUri,
      Buffer.from(response.data).toString("base64"),
      { encoding: FileSystem.EncodingType.Base64 },
    );

    // Open with default PDF viewer
    if (Platform.OS === "ios") {
      await Sharing.shareAsync(fileUri, { mimeType: "application/pdf" });
    } else if (Platform.OS === "android") {
      try {
        await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
          data: fileUri,
          flags: 1,
          type: "application/pdf",
        });
      } catch (error) {
        // Fallback to share dialog
        await Sharing.shareAsync(fileUri, { mimeType: "application/pdf" });
      }
    }
  } catch (error: any) {
    console.error("[PDF Preview] Error:", error.message);
    Alert.alert(
      "Preview Failed",
      error.message || "Failed to preview the report",
      [{ text: "OK", onPress: () => {} }],
    );
  }
};

export default {
  downloadSalesReportPdf,
  emailSalesReportPdf,
  previewSalesReportPdf,
  getPeriodString,
};
