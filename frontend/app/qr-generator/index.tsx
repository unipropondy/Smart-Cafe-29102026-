import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Share,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Theme } from "../../constants/theme";
import { API_URL } from "../../constants/Config";
import * as Print from "expo-print";
import UniversalPrinter from "../../components/UniversalPrinter";

// QR Code via web service — works on all platforms (web + native)
// Uses qrserver.com free API to generate QR images
const QR_API = (data: string, size = 200) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&format=png&margin=10`;

// Resolve the customer-facing base URL for the QR code
// On web: use current browser's host
// On native: use the configured API_URL host (same PC)
function getCustomerBaseUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    // Expo web runs on :8081 by default
    return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
  }
  // For native
  const apiHost = API_URL.replace(/:\d+$/, ""); // strip port
  if (apiHost.includes("localhost") || apiHost.includes("192.168")) {
    return `${apiHost}:8081`;
  }
  // Production customer client served directly from backend server
  return apiHost;
}

interface Table {
  id: string;
  label: string;
  DiningSection: string;
  Status: number;
}

const SECTION_NAMES: Record<string, string> = {
  "1": "SECTION_1",
  "2": "SECTION_2",
  "3": "SECTION_3",
  "4": "TAKEAWAY",
};


export default function QRGeneratorScreen() {
  const router = useRouter();
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [selectedSection, setSelectedSection] = useState<string>("1");
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    setBaseUrl(getCustomerBaseUrl());
    fetchTables();
  }, []);

  const fetchTables = async () => {
    try {
      const res = await fetch(`${API_URL}/api/tables/all`);
      const data = await res.json();
      if (Array.isArray(data)) {
        // Include all tables (dine-in + takeaway)
        setTables(data);
      }
    } catch {
      Alert.alert("Error", "Failed to load tables from database.");
    } finally {
      setLoading(false);
    }
  };

  const fetchQrAsBase64 = async (qrUrl: string): Promise<string> => {
    const qrImgUrl = QR_API(qrUrl, 450);
    const response = await fetch(qrImgUrl);
    if (!response.ok) throw new Error("Failed to fetch QR image");
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const buildQrUrl = (table: Table) => {
    const isTakeaway = table.DiningSection === "4" || String(table.label).toUpperCase().startsWith("TW");
    if (isTakeaway) {
      return `${baseUrl}/qr-takeaway?tableId=${table.id}&tableNo=${encodeURIComponent(table.label)}&section=TAKEAWAY`;
    }
    const sectionName = SECTION_NAMES[table.DiningSection] || "SECTION_1";
    return `${baseUrl}/customer?tableId=${table.id}&tableNo=${encodeURIComponent(table.label)}&section=${sectionName}`;
  };

  const sections = ["1", "2", "3", "4"];
  const sectionLabels: Record<string, string> = {
    "1": "Section 1",
    "2": "Section 2",
    "3": "Section 3",
    "4": "Takeaway",
  };

  const filteredTables = tables.filter((t) => t.DiningSection === selectedSection);

  const handleShare = async (table: Table) => {
    const url = buildQrUrl(table);
    try {
      await Share.share({
        message: `Table ${table.label} QR Link:\n${url}`,
        title: `Table ${table.label} QR Code`,
      });
    } catch {
      // Sharing not supported, just show the URL
      Alert.alert("QR Link", url);
    }
  };

  const handlePrintSingle = async (table: Table) => {
    setPrinting(true);
    try {
      const qrUrl = buildQrUrl(table);
      const sectionName = sectionLabels[table.DiningSection] || "Section 1";

      // 🖨️ Try printing directly to configured cashier receipt printer
      const directPrinted = await UniversalPrinter.printQRDirect(table.label, sectionName, qrUrl);
      if (directPrinted) {
        return;
      }

      const base64Qr = await fetchQrAsBase64(qrUrl);

      const htmlContent = `
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
            <style>
              @page {
                size: auto;
                margin: 0mm;
              }
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: flex-start;
                margin: 0;
                padding: 10px;
                box-sizing: border-box;
                text-align: center;
                background-color: #fff;
              }
              .card {
                border: 2px dashed #0F172A;
                border-radius: 12px;
                padding: 24px;
                width: 380px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                align-items: center;
                background: #fff;
                margin: 10px auto;
              }
              .qr-image {
                width: 320px;
                height: 320px;
                margin-bottom: 16px;
              }
              .title {
                font-size: 28px;
                font-weight: 800;
                margin: 8px 0 6px 0;
                color: #0F172A;
              }
              .section {
                font-size: 16px;
                font-weight: 600;
                color: #475569;
                background: #F1F5F9;
                padding: 4px 12px;
                border-radius: 8px;
                margin-bottom: 10px;
                display: inline-block;
              }
              .hint {
                font-size: 16px;
                color: #0284c7;
                font-weight: 700;
                margin-top: 6px;
                text-transform: uppercase;
                letter-spacing: 1px;
              }
              .url {
                font-size: 12px;
                color: #64748B;
                word-break: break-all;
                max-width: 100%;
                margin-top: 8px;
                font-family: monospace;
              }
            </style>
          </head>
          <body>
            <div class="card">
              <img class="qr-image" src="${base64Qr}" alt="QR Code" />
              <div class="title">Table ${table.label}</div>
              <div class="section">${sectionName}</div>
              <div class="hint">Scan to Order</div>
              <div class="url">${qrUrl}</div>
            </div>
          </body>
        </html>
      `;

      if (Platform.OS === "web") {
        const iframe = document.createElement("iframe");
        iframe.style.position = "absolute";
        iframe.style.width = "0px";
        iframe.style.height = "0px";
        iframe.style.border = "none";
        document.body.appendChild(iframe);

        const doc = iframe.contentWindow || iframe.contentDocument;
        // @ts-ignore
        const iframeDoc = doc.document || doc;
        iframeDoc.write(htmlContent);
        iframeDoc.close();

        iframe.onload = () => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          setTimeout(() => {
            document.body.removeChild(iframe);
          }, 1000);
        };

        setTimeout(() => {
          if (document.body.contains(iframe)) {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            setTimeout(() => {
              if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
              }
            }, 1000);
          }
        }, 500);
      } else {
        await Print.printAsync({
          html: htmlContent,
        });
      }
    } catch (error) {
      Alert.alert("Print Error", "Failed to print the QR code.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/(tabs)/category" as any);
            }
          }}
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={22} color={Theme.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Table QR Codes</Text>
          <Text style={styles.headerSub}>
            Print and place on each table for customer ordering
          </Text>
        </View>
      </View>

      {/* Info Banner */}
      <View style={styles.infoBanner}>
        <Ionicons name="information-circle-outline" size={18} color="#0369a1" />
        <Text style={styles.infoText}>
          Customer scans QR → browser opens → auto-sets table → places order
        </Text>
      </View>

      {/* Base URL Display */}
      <View style={styles.urlBanner}>
        <Ionicons name="link-outline" size={14} color="#6b7280" />
        <Text style={styles.urlText} numberOfLines={1}>
          Base URL: {baseUrl}/customer
        </Text>
      </View>

      {/* Section Filter */}
      <View style={styles.filterRow}>
        {sections.map((sec) => (
          <TouchableOpacity
            key={sec}
            style={[
              styles.filterChip,
              selectedSection === sec && styles.filterChipActive,
            ]}
            onPress={() => setSelectedSection(sec)}
          >
            <Text
              style={[
                styles.filterChipText,
                selectedSection === sec && styles.filterChipTextActive,
              ]}
            >
              {sectionLabels[sec]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator
          size="large"
          color={Theme.primary}
          style={{ marginTop: 60 }}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        >
          {filteredTables.map((table) => {
            const qrUrl = buildQrUrl(table);
            const qrImgUrl = QR_API(qrUrl, 180);
            return (
              <View key={table.id} style={styles.qrCard}>
                {/* QR Image */}
                <View style={styles.qrImageWrap}>
                  {/* Using img tag on web, Image on native */}
                  {Platform.OS === "web" ? (
                    // @ts-ignore
                    <img
                      src={qrImgUrl}
                      alt={`QR Table ${table.label}`}
                      style={{ width: 160, height: 160, borderRadius: 8 }}
                    />
                  ) : (
                    <Image
                      source={{ uri: qrImgUrl }}
                      style={{ width: 160, height: 160, borderRadius: 8 }}
                      resizeMode="contain"
                    />
                  )}
                </View>

                {/* Table Info */}
                <View style={styles.qrInfo}>
                  <Text style={styles.qrTableLabel}>Table {table.label}</Text>
                  <Text style={styles.qrSectionLabel}>
                    {sectionLabels[table.DiningSection] || "Section 1"}
                  </Text>
                  <Text style={styles.qrUrlSmall} numberOfLines={1} ellipsizeMode="middle">
                    {qrUrl}
                  </Text>
                </View>

                 {/* Actions */}
                 <View style={styles.qrActions}>
                   <TouchableOpacity
                     style={styles.printSingleBtn}
                     onPress={() => handlePrintSingle(table)}
                   >
                     <Ionicons name="print-outline" size={16} color="#fff" />
                     <Text style={styles.printSingleBtnText}>Print QR</Text>
                   </TouchableOpacity>

                   <View style={styles.qrRowActions}>
                     <TouchableOpacity
                       style={styles.shareBtn}
                       onPress={() => handleShare(table)}
                     >
                       <Ionicons name="share-outline" size={14} color={Theme.primary} />
                       <Text style={styles.shareBtnText}>Share</Text>
                     </TouchableOpacity>
                     <TouchableOpacity
                       style={styles.testBtn}
                       onPress={() => {
                         if (Platform.OS === "web") {
                           window.open(qrUrl, "_blank");
                         } else {
                           Alert.alert("QR URL", qrUrl);
                         }
                       }}
                     >
                       <Ionicons name="open-outline" size={14} color="#fff" />
                       <Text style={styles.testBtnText}>Test</Text>
                     </TouchableOpacity>
                   </View>
                 </View>
              </View>
            );
          })}

          {filteredTables.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="grid-outline" size={48} color="#CBD5E1" />
              <Text style={styles.emptyText}>No tables found</Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Print styles (web only — injected into DOM) */}
      {Platform.OS === "web" && (
        <style
          // @ts-ignore
          dangerouslySetInnerHTML={{
            __html: `
              @media print {
                body * { visibility: hidden; }
                .qr-print-area, .qr-print-area * { visibility: visible; }
                .qr-print-area { position: absolute; left: 0; top: 0; width: 100%; }
                .no-print { display: none !important; }
              }
            `,
          }}
        />
      )}

      {printing && (
        <View style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 9999,
        }}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={{ color: "#fff", marginTop: 12, fontWeight: "700" }}>Preparing Print...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 20,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
  },
  headerSub: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  printBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Theme.primary,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  printBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  infoBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#e0f2fe",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#bae6fd",
  },
  infoText: {
    fontSize: 12,
    color: "#0369a1",
    fontWeight: "500",
    flex: 1,
  },
  urlBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#f9fafb",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  urlText: {
    fontSize: 11,
    color: "#6b7280",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    flex: 1,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  filterChipActive: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  filterChipTextActive: {
    color: "#fff",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
    gap: 12,
    justifyContent: "center",
  },
  qrCard: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 16,
    width: 220,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  qrImageWrap: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  qrNativeBox: {
    width: 160,
    height: 160,
    alignItems: "center",
    justifyContent: "center",
  },
  qrNativeHint: {
    fontSize: 11,
    color: "#94A3B8",
    marginTop: 8,
    textAlign: "center",
  },
  qrInfo: {
    alignItems: "center",
    gap: 4,
    marginBottom: 12,
    width: "100%",
    overflow: "hidden",
  },
  qrTableLabel: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
  },
  qrSectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
  },
  qrUrlSmall: {
    fontSize: 10,
    color: "#94A3B8",
    textAlign: "center",
    marginTop: 4,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    width: "100%",
  },
   qrActions: {
     gap: 8,
     width: "100%",
   },
   qrRowActions: {
     flexDirection: "row",
     gap: 8,
     width: "100%",
   },
   printSingleBtn: {
     width: "100%",
     flexDirection: "row",
     alignItems: "center",
     justifyContent: "center",
     gap: 6,
     paddingVertical: 9,
     borderRadius: 10,
     backgroundColor: "#10B981", // Emerald green for printing
   },
   printSingleBtnText: {
     fontSize: 13,
     fontWeight: "700",
     color: "#fff",
   },
  shareBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Theme.primary,
    backgroundColor: "#fff",
  },
  shareBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: Theme.primary,
  },
  testBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: Theme.primary,
  },
  testBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
  },
  empty: {
    alignItems: "center",
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
    color: "#94A3B8",
    fontWeight: "600",
  },
});
