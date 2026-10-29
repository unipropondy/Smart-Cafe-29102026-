import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Share,
  Image,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Theme } from "../../constants/theme";
import { API_URL } from "../../constants/Config";
import * as Print from "expo-print";
import UniversalPrinter from "../../components/UniversalPrinter";

const QR_API = (data: string, size = 300) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&format=png&margin=10`;

function getCustomerBaseUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
  }
  const apiHost = API_URL.replace(/:\d+$/, "");
  if (apiHost.includes("localhost") || apiHost.includes("192.168")) {
    return `${apiHost}:8081`;
  }
  return apiHost;
}

export default function TakeawayQRScreen() {
  const router = useRouter();
  const [printing, setPrinting] = useState(false);

  const baseUrl = getCustomerBaseUrl();
  const takeawayQrUrl = `${baseUrl}/qr-takeaway`;

  const fetchQrAsBase64 = async (url: string): Promise<string> => {
    try {
      const qrApiUrl = QR_API(url, 350);
      const res = await fetch(qrApiUrl);
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch {
      return QR_API(url, 350);
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Takeaway Online Ordering Link:\n${takeawayQrUrl}`,
        title: "Takeaway QR Code",
      });
    } catch {
      Alert.alert("QR Link", takeawayQrUrl);
    }
  };

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const directPrinted = await UniversalPrinter.printQRDirect(
        "Takeaway",
        "Takeaway / Pickup",
        takeawayQrUrl
      );
      if (directPrinted) {
        return;
      }

      const base64Qr = await fetchQrAsBase64(takeawayQrUrl);

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
                width: 300px;
                height: 300px;
                margin-bottom: 16px;
              }
              .title {
                font-size: 26px;
                font-weight: 800;
                margin: 8px 0 6px 0;
                color: #0F172A;
              }
              .badge {
                font-size: 15px;
                font-weight: 700;
                color: #ea580c;
                background: #fff7ed;
                border: 1px solid #fed7aa;
                padding: 4px 14px;
                border-radius: 20px;
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
              <img class="qr-image" src="${base64Qr}" alt="Takeaway QR Code" />
              <div class="title">Takeaway Order</div>
              <div class="badge">Online Takeaway / Pickup</div>
              <div class="hint">Scan to Order Takeaway</div>
              <div class="url">${takeawayQrUrl}</div>
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
        iframeDoc.open();
        iframeDoc.write(htmlContent);
        iframeDoc.close();

        setTimeout(() => {
          // @ts-ignore
          (iframe.contentWindow || iframe).focus();
          // @ts-ignore
          (iframe.contentWindow || iframe).print();
          setTimeout(() => document.body.removeChild(iframe), 1500);
        }, 600);
      } else {
        await Print.printAsync({ html: htmlContent });
      }
    } catch (e: any) {
      Alert.alert("Print Error", e.message || "Failed to print QR code");
    } finally {
      setPrinting(false);
    }
  };

  const handleTestOrder = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(takeawayQrUrl, "_blank");
    } else {
      router.push("/qr-takeaway" as any);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backButton}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={22} color="#1E293B" />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>QR for Takeaway</Text>
            <Text style={styles.headerSubtitle}>Common Online Takeaway Ordering QR</Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.testOrderButton}
            onPress={handleTestOrder}
            activeOpacity={0.8}
          >
            <Ionicons name="flash-outline" size={17} color={Theme.primary} />
            <Text style={styles.testOrderText}>Test Order</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.printAllButton, printing && { opacity: 0.6 }]}
            onPress={handlePrint}
            disabled={printing}
            activeOpacity={0.8}
          >
            <Ionicons name="print-outline" size={18} color="#FFFFFF" />
            <Text style={styles.printAllText}>
              {printing ? "Printing..." : "Print QR"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <Ionicons name="bag-handle" size={15} color={Theme.primary} />
            <Text style={styles.badgeText}>Takeaway & Pickup</Text>
          </View>

          <Text style={styles.cardHeading}>Scan to Place Takeaway Order</Text>
          <Text style={styles.cardSubheading}>
            Customers can scan this QR code with their mobile device to browse the menu, customize dishes, and place takeaway orders directly.
          </Text>

          <View style={styles.qrWrapper}>
            <Image
              source={{ uri: QR_API(takeawayQrUrl, 320) }}
              style={styles.qrImage}
              resizeMode="contain"
            />
          </View>

          <TouchableOpacity
            style={styles.urlContainer}
            onPress={handleTestOrder}
            activeOpacity={0.7}
          >
            <Ionicons name="link-outline" size={16} color={Theme.primary} />
            <Text style={styles.urlText} numberOfLines={1} selectable>
              {takeawayQrUrl}
            </Text>
            <Ionicons name="open-outline" size={16} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleShare}
              activeOpacity={0.8}
            >
              <Ionicons name="share-social-outline" size={18} color={Theme.primary} />
              <Text style={styles.actionBtnText}>Share Link</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnSecondary]}
              onPress={handleTestOrder}
              activeOpacity={0.8}
            >
              <Ionicons name="rocket-outline" size={18} color={Theme.primary} />
              <Text style={[styles.actionBtnText, { color: Theme.primary }]}>
                Open Customer View
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={handlePrint}
              disabled={printing}
              activeOpacity={0.8}
            >
              <Ionicons name="print-outline" size={18} color="#FFFFFF" />
              <Text style={[styles.actionBtnText, { color: "#FFFFFF" }]}>
                Print QR
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: Platform.OS === "web" ? 18 : 50,
    paddingBottom: 18,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  headerTitleContainer: {
    marginLeft: 14,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#0F172A",
  },
  headerSubtitle: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  testOrderButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    borderWidth: 1.5,
    borderColor: Theme.primary,
    paddingVertical: 9,
    paddingHorizontal: 15,
    borderRadius: 8,
    gap: 6,
  },
  testOrderText: {
    color: Theme.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  printAllButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.primary,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 8,
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  printAllText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  contentContainer: {
    paddingVertical: 40,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    flexGrow: 1,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    maxWidth: 500,
    width: "100%",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FDBA74",
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 20,
    marginBottom: 16,
  },
  badgeText: {
    color: Theme.primary,
    fontSize: 13,
    fontWeight: "700",
  },
  cardHeading: {
    fontSize: 23,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
    marginBottom: 8,
  },
  cardSubheading: {
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
  qrWrapper: {
    backgroundColor: "#FFFFFF",
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    marginBottom: 22,
  },
  qrImage: {
    width: 260,
    height: 260,
  },
  urlContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    width: "100%",
    gap: 8,
    marginBottom: 24,
  },
  urlText: {
    color: Theme.primary,
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Theme.primary,
    backgroundColor: "#FFFFFF",
    gap: 6,
  },
  actionBtnSecondary: {
    borderColor: "#FDBA74",
    backgroundColor: "#FFF7ED",
  },
  actionBtnPrimary: {
    borderColor: Theme.primary,
    backgroundColor: Theme.primary,
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  actionBtnText: {
    color: Theme.primary,
    fontSize: 13,
    fontWeight: "700",
  },
});

