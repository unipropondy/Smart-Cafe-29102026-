// frontend/src/components/UniversalPrinter.ts - COMPLETE WITH DISCOUNT SUPPORT âœ…

import { format } from "date-fns";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Alert, Platform } from "react-native";
import ThermalPrinterImport from "react-native-thermal-printer";

// Safe wrapper around react-native-thermal-printer to prevent null-reference crashes
const ThermalPrinter = {
  printTcp: async (args: any) => {
    if (!ThermalPrinterImport || typeof ThermalPrinterImport.printTcp !== "function") {
      throw new Error("ThermalPrinter module is not available on this device/platform");
    }
    return ThermalPrinterImport.printTcp(args);
  },
  printBluetooth: async (args: any) => {
    if (!ThermalPrinterImport || typeof ThermalPrinterImport.printBluetooth !== "function") {
      throw new Error("ThermalPrinter module is not available on this device/platform");
    }
    return ThermalPrinterImport.printBluetooth(args);
  }
};

import { API_URL } from "../constants/Config";
import { formatToSingaporeDate, formatToSingaporeTime, formatToSingaporeDateTime, parseDatabaseDate } from "../utils/timezoneHelper";
import BillPDFGenerator from "./BillPDFGenerator";
import { PrinterDetector } from "./PrinterDetector";
import SunmiPrinterService from "./SunmiPrinterService";
import { useCompanySettingsStore } from "../stores/companySettingsStore";

// Printer types
export type PrinterType =
  | "thermal"
  | "receipt"
  | "label"
  | "laser"
  | "bluetooth"
  | "network"
  | "usb"
  | "unknown";

interface PrinterInfo {
  type: PrinterType;
  name: string;
  address?: string;
  isDefault: boolean;
  paperSize?: "58mm" | "80mm" | "A4" | "label";
}

interface DiscountInfo {
  applied: boolean;
  type: "percentage" | "fixed";
  value: number;
  amount: number;
}

class UniversalPrinter {
  private static detectedPrinters: PrinterInfo[] = [];
  private static defaultPrinter: PrinterInfo | null = null;
  private static cachedPrinters: any = null;
  private static lastPrintersFetchTime: number = 0;

  // ==================== DEDUPLICATION CACHE ====================
  // Cache key = "orderId:itemFingerprint" so that a legitimate additional-round
  // KOT (same orderId, different new items) is never blocked.
  // Only a byte-identical replay of the same orderId + same item set is rejected.
  // Entries older than 15 minutes are evicted to bound memory usage.
  private static printedOrdersCache = new Map<string, number>();
  private static printedReceiptsCache = new Map<string, number>();

  /**
   * Builds a stable, order-independent fingerprint from the items array.
   * Uses the most-specific ID available per item, then sorts so the key is
   * the same regardless of the order items arrive in the payload.
   */
  private static buildItemFingerprint(items: any[]): string {
    return items
      .map(
        (i: any) =>
          String(
            i.lineItemId ??
            i.LineItemId ??
            i.dishId ??
            i.DishId ??
            i.id ??
            i.name ??
            "?"
          )
      )
      .sort()
      .join(",");
  }

  private static isDuplicatePrint(orderId: string, items: any[]): boolean {
    const now = Date.now();
    const TTL = 15 * 60 * 1000; // 15 minutes
    // Evict stale entries to prevent unbounded memory growth
    for (const [key, ts] of this.printedOrdersCache.entries()) {
      if (now - ts > TTL) this.printedOrdersCache.delete(key);
    }
    // Composite key: orderId + exact item set â€” allows additional KOTs for the same order
    const cacheKey = `${orderId}:${this.buildItemFingerprint(items)}`;
    if (this.printedOrdersCache.has(cacheKey)) {
      console.log(
        `ðŸ›¡ï¸ [UniversalPrinter] Duplicate print blocked | Order: ${orderId} | Items: ${items.length}`
      );
      return true;
    }
    this.printedOrdersCache.set(cacheKey, now);
    return false;
  }

  private static isDuplicateReceiptPrint(orderId: string): boolean {
    const now = Date.now();
    const TTL = 15 * 60 * 1000; // 15 minutes
    for (const [key, ts] of this.printedReceiptsCache.entries()) {
      if (now - ts > TTL) this.printedReceiptsCache.delete(key);
    }
    if (this.printedReceiptsCache.has(orderId)) {
      console.log(`ðŸ›¡ï¸ [UniversalPrinter] Duplicate receipt print blocked for Order: ${orderId}`);
      return true;
    }
    this.printedReceiptsCache.set(orderId, now);
    return false;
  }

  static async detectAllPrinters(): Promise<PrinterInfo[]> {
    const printers: PrinterInfo[] = [];
    if (Platform.OS !== "android") return printers;

    try {
      // Android Print Service
      try {
        const hasPrintService = await this.checkAndroidPrintService();
        if (hasPrintService) {
          printers.push({
            type: "laser",
            name: "Android Print Service",
            isDefault: false,
            paperSize: "A4",
          });
        }
      } catch (e) {}

      this.detectedPrinters = printers;
      this.defaultPrinter =
        printers.find((p) => p.type === "thermal") || printers[0] || null;
      return printers;
    } catch (error) {
      return [];
    }
  }

  static async openCashDrawer(printerIpOverride?: string): Promise<boolean> {
    try {
      const { default: CashDrawerService } = await import('../services/CashDrawerService');
      const ip = printerIpOverride || await CashDrawerService.getCashierPrinterIp();
      return await CashDrawerService.openCashDrawer(ip);
    } catch (e) {
      console.warn('[UniversalPrinter] Cash drawer open failed:', e);
      return false;
    }
  }

  private static getPrintWidth(printer: PrinterInfo): number {
    switch (printer.paperSize) {
      case "58mm":
        return 164;
      case "80mm":
        return 226;
      case "A4":
        return 612;
      case "label":
        return 300;
      default:
        return 226;
    }
  }

  private static async isIpReachable(ip: string, port: number = 80, timeoutMs: number = 600): Promise<boolean> {
    if (!ip || ip.trim() === "") return false;
    const cleanIp = ip.trim();
    const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(cleanIp);
    if (!isIp) return false;

    // Avoid HTTP requests to raw TCP port 9100 as the printer will print the HTTP headers!
    if (port === 9100) {
      return true;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      await fetch(`http://${cleanIp}:${port}`, {
        method: "GET",
        signal: controller.signal,
        mode: "no-cors",
        headers: { "Cache-Control": "no-cache" }
      });
      clearTimeout(timer);
      console.log(`ðŸ”Œ [isIpReachable] Connected/Alive: ${cleanIp}`);
      return true;
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        console.log(`ðŸ”Œ [isIpReachable] Offline/Timeout on ${cleanIp}`);
        return false;
      }
      console.log(`ðŸ”Œ [isIpReachable] Host responded (alive): ${cleanIp}`);
      return true;
    }
  }

  // ==================== SALES REPORT ====================
  static async printSalesReport(
    reportData: any,
    userId?: string | number,
    t?: any,
  ): Promise<boolean> {
    try {
      const company = await BillPDFGenerator.loadSettings(userId);
      const html = this.generateSalesReportHTML(reportData, company);

      // âœ… Save as PDF (no preview)
      const { uri } = await Print.printToFileAsync({ html });
      console.log("ðŸ“„ Sales report saved at:", uri);

      // âœ… Optionally share the PDF
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      }

      return true;
    } catch (error) {
      console.log("Sales report error:", error);
      return false;
    }
  }
  private static generateSalesReportHTML(data: any, company: any): string {
    const symbol = company.currencySymbol || "$";
    return `<!DOCTYPE html><html><head><style>
      body { font-family: monospace; padding: 20px; max-width: 800px; margin: 0 auto; }
      .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
      .company-name { font-size: 24px; font-weight: bold; }
      .report-title { font-size: 20px; font-weight: bold; margin: 15px 0; text-align: center; }
      .section-title { font-size: 16px; font-weight: bold; margin: 15px 0 10px; background: #f0f0f0; padding: 5px; }
      table { width: 100%; border-collapse: collapse; margin: 10px 0; }
      th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
      .amount { text-align: right; }
      .summary-box { display: inline-block; width: 30%; padding: 10px; margin: 5px; background: #f9f9f9; text-align: center; border-radius: 5px; }
      .footer { margin-top: 30px; text-align: center; font-size: 12px; border-top: 1px solid #ddd; padding-top: 10px; }
    </style></head><body>
      <div class="header"><div class="company-name">${company.name || "POS SYSTEM"}</div><div>${company.address || ""}</div><div>GST: ${company.gstNo || "N/A"}</div><div class="report-title">SALES REPORT</div><div>Period: ${data.period || "Today"}</div></div>
      <div style="text-align:center"><div class="summary-box"><div>Total Sales</div><div style="font-size:24px">${data.summary?.totalSales || 0}</div></div>
      <div class="summary-box"><div>Total Items</div><div style="font-size:24px">${data.summary?.totalItems || 0}</div></div>
      <div class="summary-box"><div>Total Revenue</div><div style="font-size:24px">${symbol}${(data.summary?.totalRevenue || 0).toFixed(2)}</div></div></div>
      <div class="section-title">ðŸ’³ PAYMENT BREAKDOWN</div>${this.generateTableFromObject(data.paymentBreakdown || {}, symbol)}</div>
      ${data.items && data.items.length > 0 ? `<div class="section-title">ðŸ“‹ ITEM WISE SALES</div>${this.generateItemsTable(data.items, symbol)}` : ""}
      <div class="footer"><p>Â© ${new Date().getFullYear()} UNIPRO SOFTWARES SG PTE LTD</p></div>
    </body></html>`;
  }

  // ==================== CATEGORY REPORT ====================
  static async printCategoryReport(
    categories: any[],
    selectedCategory: string | null,
    categoryItems: any[],
    categoryTransactions: any[],
    userId?: string | number,
    t?: any,
    options?: any,
  ): Promise<boolean> {
    try {
      const company = await BillPDFGenerator.loadSettings(userId);
      const html = selectedCategory
        ? this.generateCategoryDetailHTML(
            selectedCategory,
            categoryItems,
            categoryTransactions,
            company,
            options,
          )
        : this.generateAllCategoriesHTML(categories, company, options);

      // âœ… Save as PDF (no preview)
      const { uri } = await Print.printToFileAsync({ html });
      console.log("ðŸ“„ Category report saved at:", uri);

      // âœ… Optionally share the PDF
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      }

      return true;
    } catch (error) {
      console.log("Category report error:", error);
      return false;
    }
  }
  private static generateCategoryDetailHTML(
    categoryName: string,
    items: any[],
    transactions: any[],
    company: any,
    options?: any,
  ): string {
    const symbol = company.currencySymbol || "$";
    const groupTransactions = (tx: any[]) => {
      const grouped: any = {};
      tx.forEach((t) => {
        if (!grouped[t.saleId])
          grouped[t.saleId] = {
            id: t.saleId,
            date: t.saleDate,
            items: [],
            total: 0,
          };
        grouped[t.saleId].items.push({
          name: t.name,
          quantity: t.quantity,
          price: t.price,
        });
        grouped[t.saleId].total += t.price * t.quantity;
      });
      return Object.values(grouped).sort(
        (a: any, b: any) =>
          new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
    };
    return `<!DOCTYPE html><html><head><style>
      body { font-family: Arial; padding: 20px; max-width: 800px; margin: 0 auto; }
      .header { text-align: center; border-bottom: 2px solid #000; margin-bottom: 20px; }
      .category-title { font-size: 22px; font-weight: bold; text-align: center; margin: 20px 0; }
      .section-title { font-size: 18px; font-weight: bold; margin: 20px 0 10px; background: #f0f0f0; padding: 8px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
      th, td { padding: 8px; text-align: left; border-bottom: 1px solid #eee; }
      .amount { text-align: right; }
      .transaction-card { border: 1px solid #ddd; border-radius: 5px; padding: 15px; margin-bottom: 15px; }
      .footer { margin-top: 30px; text-align: center; font-size: 12px; border-top: 1px solid #ddd; padding-top: 10px; }
    </style></head><body>
      <div class="header"><div class="company-name">${company.name || "Store"}</div><div>${company.address || ""}</div><div>GST: ${company.gstNo || "N/A"}</div></div>
      <div class="category-title">ðŸ“¦ ${categoryName}</div>
      <div style="display:flex;justify-content:space-around;margin:20px 0;padding:15px;background:#f9f9f9;border-radius:5px">
        <div><div>Total Items</div><div style="font-size:18px;font-weight:bold">${items.length}</div></div>
        <div><div>Quantity Sold</div><div style="font-size:18px;font-weight:bold">${items.reduce((s, i) => s + (i.quantity || 0), 0)}</div></div>
        <div><div>Total Revenue</div><div style="font-size:18px;font-weight:bold">${symbol}${items.reduce((s, i) => s + (i.revenue || 0), 0).toFixed(2)}</div></div>
      </div>
      <div class="section-title">ðŸ“‹ Items Sold</div>${this.generateItemsTable(items, symbol)}
      <div class="section-title">ðŸ“„ Transaction History</div>${
        transactions.length
          ? groupTransactions(transactions)
              .map(
                (sale: any) =>
                  `<div class="transaction-card"><div><strong>#${sale.id}</strong> - ${symbol}${sale.total.toFixed(2)}</div><div>${formatToSingaporeDateTime(sale.date)}</div>${sale.items.map((item: any) => `<div>â€¢ ${item.name} x${item.quantity} - ${symbol}${(item.price * item.quantity).toFixed(2)}</div>`).join("")}</div>`,
              )
              .join("")
          : "<p>No transactions</p>"
      }
      <div class="footer"><p>End of Report</p></div>
    </body></html>`;
  }

  private static generateAllCategoriesHTML(
    categories: any[],
    company: any,
    options?: any,
  ): string {
    const symbol = company.currencySymbol || "$";
    const summary = options?.summary || {
      totalSales: 0,
      totalItems: 0,
      totalRevenue: 0,
      paymentBreakdown: {},
    };
    return `<!DOCTYPE html><html><head><style>
      body { font-family: Arial; padding: 20px; max-width: 800px; margin: 0 auto; }
      .header { text-align: center; border-bottom: 2px solid #000; margin-bottom: 20px; }
      .summary-section { display: flex; justify-content: space-between; margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 5px; }
      .category-card { margin-bottom: 20px; border: 1px solid #ddd; border-radius: 5px; padding: 15px; }
      .category-name { font-size: 18px; font-weight: bold; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th, td { padding: 8px; text-align: left; border-bottom: 1px solid #eee; }
      .amount { text-align: right; }
      .footer { margin-top: 30px; text-align: center; font-size: 12px; border-top: 1px solid #ddd; padding-top: 10px; }
    </style></head><body>
      <div class="header"><div class="company-name">${company.name || "Store"}</div><div>${company.address || ""}</div><div>GST: ${company.gstNo || "N/A"}</div><div class="report-title">ðŸ“Š CATEGORY WISE SALES</div></div>
      <div class="summary-section"><div><div>Total Sales</div><div>${summary.totalSales}</div></div><div><div>Total Items</div><div>${summary.totalItems}</div></div><div><div>Total Revenue</div><div>${symbol}${summary.totalRevenue.toFixed(2)}</div></div></div>
      <div><h3>ðŸ’³ PAYMENT BREAKDOWN</h3>${Object.entries(
        summary.paymentBreakdown,
      )
        .map(
          ([m, a]) => `<div>${m}: ${symbol}${(a as number).toFixed(2)}</div>`,
        )
        .join("")}</div>
      ${categories.map((cat) => `<div class="category-card"><div class="category-name">${cat.name}</div><div>Revenue: ${symbol}${(cat.totalRevenue || 0).toFixed(2)} | Items: ${cat.totalQuantity || 0}</div>${this.generateItemsTable(cat.items || [], symbol)}</div>`).join("")}
      <div class="footer"><p>Â© ${new Date().getFullYear()} UNIPRO SOFTWARES SG PTE LTD</p></div>
    </body></html>`;
  }

  private static generateItemsTable(items: any[], symbol: string): string {
    if (!items.length) return "<p>No items</p>";
    return `<table><thead><tr><th>Item</th><th class="amount">Qty</th><th class="amount">Price</th><th class="amount">Total</th></tr></thead><tbody>${items.map((i) => `<tr><td>${i.name}</td><td class="amount">${i.quantity || 0}</td><td class="amount">${symbol}${(i.price || 0).toFixed(2)}</td><td class="amount">${symbol}${(i.revenue || 0).toFixed(2)}</td></tr>`).join("")}</tbody></table>`;
  }

  private static generateTableFromObject(
    obj: Record<string, any>,
    symbol: string,
  ): string {
    const entries = Object.entries(obj);
    if (!entries.length) return "<p>No data</p>";
    return `<table><tbody>${entries.map(([k, v]) => `<tr><td>${k}</td><td class="amount">${symbol}${(v as number).toFixed(2)}</td></tr>`).join("")}</tbody></table>`;
  }

  // Cache bridge status for 5s to avoid hammering the endpoint on every print
  private static _bridgeOnlineCache: { value: boolean; at: number } | null = null;

  private static async isBridgeOnline(): Promise<boolean> {
    const now = Date.now();
    if (this._bridgeOnlineCache && now - this._bridgeOnlineCache.at < 5000) {
      return this._bridgeOnlineCache.value;
    }
    try {
      const response = await fetch(`${API_URL}/api/print-jobs/bridge-status`);
      const data = await response.json();
      const online = !!(data && data.success && data.online);
      this._bridgeOnlineCache = { value: online, at: now };
      return online;
    } catch (e) {
      console.warn("[UniversalPrinter] Failed to check print bridge status:", e);
      this._bridgeOnlineCache = { value: false, at: now };
      return false;
    }
  }

  static async detectUsbPrinters(): Promise<Array<{ name: string; port: string; status: string; isUsb: boolean }>> {
    try {
      const res = await fetch(`http://localhost:3050/api/printers`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.printers)) {
        return data.printers;
      }
    } catch (e) {
      console.warn("[UniversalPrinter] Could not fetch USB printers from print bridge:", e);
    }
    return [];
  }

  private static async waitForJobCompletion(
    jobId: string,
    timeoutMs: number = 15000
  ): Promise<{ success: boolean; error?: string }> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const res = await fetch(`${API_URL}/api/print-jobs/status/${jobId}`);
        const data = await res.json();
        if (data && data.success) {
          if (data.status === "COMPLETED") {
            return { success: true };
          }
          if (data.status === "FAILED") {
            return {
              success: false,
              error: data.error || "Print job failed on thermal printer.",
            };
          }
        }
      } catch (e) {
        // continue polling
      }
    }
    // Job is still in the queue - bridge will pick it up and print.
    // Don't treat this as a failure; return success so the UI isn't blocked.
    console.warn(`[UniversalPrinter] Job ${jobId} still PENDING after ${timeoutMs}ms - bridge will print it shortly.`);
    return { success: true };
  }

  private static async queuePrintJob(
    printerType: number,
    kitchenTypeValue: string | number | undefined,
    content: string,
    waitForResult: boolean = true,
    targetPrinterIp?: string
  ): Promise<boolean> {
    try {
      const storeId = "STORE_001";
      const response = await fetch(`${API_URL}/api/print-jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer unipro-pos-bridge-token-2026",
          "x-store-id": storeId
        },
        body: JSON.stringify({
          printerType,
          kitchenTypeValue: kitchenTypeValue !== undefined ? String(kitchenTypeValue) : undefined,
          content,
          targetPrinterIp
        })
      });
      const data = await response.json();
      if (data.success !== true || !data.jobId) {
        console.warn(`[UniversalPrinter] queuePrintJob failed — backend returned:`, data);
        return false;
      }

      console.log(`✅ [UniversalPrinter] Print job ${data.jobId} queued to bridge (Printer: ${data.printerName || data.printerIp || 'unknown'})`);
      this._bridgeOnlineCache = null;

      // Fire-and-forget: Job is safely in the DB. Don't block the UI waiting for completion.
      // The Print Bridge will pick it up and print within its next poll cycle (every 500ms).
      if (waitForResult) {
        // Only wait in background without blocking; log result for debugging
        this.waitForJobCompletion(data.jobId).then((result) => {
          if (result.success) {
            console.log(`🎉 [UniversalPrinter] Print job ${data.jobId} confirmed completed.`);
          } else {
            console.warn(`⚠️ [UniversalPrinter] Print job ${data.jobId} status:`, result.error);
          }
        }).catch(() => {});
      }
      return true;
    } catch (e: any) {
      // Don't block the user with an alert if the backend is temporarily unreachable.
      console.warn("[UniversalPrinter] Failed to queue print job:", e);
      return false;
    }
  }

  // ==================== KOT PRINTING (80mm) ====================
  private static async logPrintJob(
    orderId: string,
    orderNo: string,
    type: "NEW" | "ADDITIONAL" | "REPRINT" | "KDS_PRINT"
  ): Promise<void> {
    try {
      const baseUrl = API_URL;
      await fetch(`${baseUrl}/api/orders/log-print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: orderId && orderId.length > 30 ? orderId : null,
          orderNumber: orderNo,
          printType: 1, // KOT
          isEdit: type === "ADDITIONAL",
          isReprint: type === "REPRINT",
          isHold: false,
        }),
      });
      console.log("ðŸ“ Print job logged to PrintReport");
    } catch (logErr) {
      console.warn("Failed to log print to DB:", logErr);
    }
  }

  static async printKDSOrder(
    orderData: any,
    userId?: string | number,
    kdsPrinterIp?: string,
  ): Promise<boolean> {
    if (Platform.OS === "web") {
      try {
        const isOnline = await this.isBridgeOnline();
        if (!isOnline) {
          console.log("ðŸ“¡ [Web Print Bridge] Bridge is OFFLINE. Direct fallback to preview.");
          const html = this.generateKOTHTML(orderData, "KDS_PRINT");
          let frame = document.getElementById("kot-print-iframe") as HTMLIFrameElement;
          if (!frame) {
            frame = document.createElement("iframe");
            frame.id = "kot-print-iframe";
            frame.style.display = "none";
            document.body.appendChild(frame);
          }

          const doc = frame.contentWindow?.document || frame.contentDocument;
          if (doc) {
            doc.open();
            doc.write(html);
            doc.close();

            const triggerPrint = () => {
              frame.contentWindow?.focus();
              frame.contentWindow?.print();
            };

            frame.contentWindow?.addEventListener("load", triggerPrint);
            setTimeout(triggerPrint, 50);
          }
          await this.logPrintJob(orderData.orderId, orderData.orderNo, "REPRINT");
          return true;
        }

        const text = this.formatKOTThermalText(orderData, "KDS_PRINT");
        console.log(`ðŸ“¡ [Web Print Bridge] Queueing KDS print`);
        const success = await this.queuePrintJob(4, undefined, text);
        if (success) {
          await this.logPrintJob(orderData.orderId, orderData.orderNo, "REPRINT");
          return true;
        }

        // Web Fallback: If Print Bridge failed, trigger iframe preview
        console.log("âš ï¸ [Web KDS Print] Print Bridge queue failed. Falling back to iframe print preview.");
        const html = this.generateKOTHTML(orderData, "KDS_PRINT");
        let frame = document.getElementById("kot-print-iframe") as HTMLIFrameElement;
        if (!frame) {
          frame = document.createElement("iframe");
          frame.id = "kot-print-iframe";
          frame.style.display = "none";
          document.body.appendChild(frame);
        }

        const doc = frame.contentWindow?.document || frame.contentDocument;
        if (doc) {
          doc.open();
          doc.write(html);
          doc.close();

          const triggerPrint = () => {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
          };

          frame.contentWindow?.addEventListener("load", triggerPrint);
          setTimeout(triggerPrint, 800);
        }
        await this.logPrintJob(orderData.orderId, orderData.orderNo, "REPRINT");
        return true;
      } catch (err) {
        console.warn("[Web Print Bridge] KDS Print failed, falling back to iframe print preview:", err);
        try {
          const html = this.generateKOTHTML(orderData, "KDS_PRINT");
          let frame = document.getElementById("kot-print-iframe") as HTMLIFrameElement;
          if (!frame) {
            frame = document.createElement("iframe");
            frame.id = "kot-print-iframe";
            frame.style.display = "none";
            document.body.appendChild(frame);
          }

          const doc = frame.contentWindow?.document || frame.contentDocument;
          if (doc) {
            doc.open();
            doc.write(html);
            doc.close();

            const triggerPrint = () => {
              frame.contentWindow?.focus();
              frame.contentWindow?.print();
            };

            frame.contentWindow?.addEventListener("load", triggerPrint);
            setTimeout(triggerPrint, 800);
          }
          await this.logPrintJob(orderData.orderId, orderData.orderNo, "REPRINT");
          return true;
        } catch (fallbackErr) {
          console.error("Web KDS print fallback failed:", fallbackErr);
          return false;
        }
      }
    }

    // Mobile/Native
    return this.printKOT(orderData, userId, "KDS_PRINT", kdsPrinterIp);
  }

  /** Create a uniquely-named hidden iframe for each KOT print to avoid concurrent overwrites */
  private static createKOTFrame(): HTMLIFrameElement {
    const frameId = `kot-print-iframe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const frame = document.createElement("iframe");
    frame.id = frameId;
    frame.style.display = "none";
    document.body.appendChild(frame);
    // Auto-remove after 15s
    setTimeout(() => { try { frame.remove(); } catch (_) {} }, 15000);
    return frame;
  }

  /** Print KOT HTML via a fresh hidden iframe */
  private static printKOTViaFrame(html: string, delay = 50): void {
    const frame = this.createKOTFrame();
    const doc = frame.contentWindow?.document || frame.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
    let printed = false;
    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    };
    frame.contentWindow?.addEventListener("load", triggerPrint);
    setTimeout(triggerPrint, delay);
  }

  static async printKOT(
    orderData: any,
    userId?: string | number,
    type: "NEW" | "ADDITIONAL" | "REPRINT" | "KDS_PRINT" = "NEW",
    printerIpOverride?: string,
  ): Promise<boolean> {
    if (Platform.OS === "web") {
      try {
        const isOnline = await this.isBridgeOnline();
        if (!isOnline) {
          console.log("ðŸ“¡ [Web Print Bridge] Bridge is OFFLINE. Direct fallback to preview.");
          this.printKOTViaFrame(this.generateKOTHTML(orderData, type), 50);
          await this.logPrintJob(orderData.orderId, orderData.orderNo, type);
          return true;
        }

        const text = this.formatKOTThermalText(orderData, type);
        // Map kitchenCode or kitchenTypeValue
        const kitchenTypeValue = orderData.kitchenCode || orderData.KitchenCode || orderData.kitchenTypeValue || orderData.KitchenTypeValue || "0";
        console.log(`ðŸ“¡ [Web Print Bridge] Queueing KOT to Kitchen type: ${kitchenTypeValue}`);
        const success = await this.queuePrintJob(2, kitchenTypeValue, text);
        if (success) {
          await this.logPrintJob(orderData.orderId, orderData.orderNo, type);
          return true;
        }

        // ðŸš€ Fallback: If Print Bridge failed or printer not detected on web, trigger iframe print preview immediately
        console.log("âš ï¸  [Web KOT Print] Print Bridge queue failed. Falling back to iframe print preview.");
        this.printKOTViaFrame(this.generateKOTHTML(orderData, type), 800);
        await this.logPrintJob(orderData.orderId, orderData.orderNo, type);
        return true;
      } catch (err) {
        console.warn("[Web Print Bridge] KOT Queue failed, falling back to iframe print preview:", err);
        try {
          this.printKOTViaFrame(this.generateKOTHTML(orderData, type), 800);
          await this.logPrintJob(orderData.orderId, orderData.orderNo, type);
          return true;
        } catch (fallbackErr) {
          console.error("Web KOT print fallback failed:", fallbackErr);
          return false;
        }
      }
    }

    try {
      const company = await BillPDFGenerator.loadSettings(userId);
      const html = this.generateKOTHTML(orderData, type);
      
      let targetIp: string = printerIpOverride || "";
      if (!targetIp) {
        if (type === "KDS_PRINT") {
          try {
            const res = await fetch(`${API_URL}/api/settings/kitchen-printers`);
            const printers = await res.json();
            const kdsPrinter = printers.find((p: any) => p.PrinterType === 4);
            targetIp = kdsPrinter?.PrinterPath || kdsPrinter?.PrinterIP || "";
          } catch (err) {
            console.warn("Failed to fetch KDS printer IP:", err);
          }
        }
        if (!targetIp && type !== "KDS_PRINT") {
          targetIp = company.printerIp || "";
        }
      }

      // âœ… 1. Try Hardware Printer (WiFi or Bluetooth)
      const hasConfiguredIp = targetIp && targetIp.trim().length > 0;
      if (hasConfiguredIp) {
        let isReachable = false;
        const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(targetIp.trim());
        if (isIp) {
          isReachable = await this.isIpReachable(targetIp, 9100);
        } else {
          isReachable = true;
        }

        if (isReachable) {
          try {
            const text = this.formatKOTThermalText(orderData, type);

            if (isIp) {
              console.log(`ðŸŒ KOT WiFi print to: ${targetIp}`);
              const printPromise = ThermalPrinter.printTcp({
                ip: targetIp,
                port: 9100,
                payload: text,
                mmFeedPaper: 25,
              });
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("WiFi Timeout")), 1500),
              );
              await Promise.race([printPromise, timeoutPromise]);
            } else {
              console.log(`🔵 KOT Bluetooth print to: ${targetIp}`);
              await ThermalPrinterImport?.getBluetoothDeviceList?.().catch(() => {});
              const printPromise = ThermalPrinter.printBluetooth({
                macAddress: targetIp,
                payload: text,
                mmFeedPaper: 25,
              });
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("BT Timeout")), 12000),
              );
              await Promise.race([printPromise, timeoutPromise]);
            }
            await this.logPrintJob(orderData.orderId, orderData.orderNo, type);
            return true;
          } catch (printError) {
            console.warn("âŒ Hardware KOT failed/timeout, falling back directly to PDF...");
          }
        } else {
          console.warn(`âŒ configured printer IP ${targetIp} not reachable, falling back directly to PDF...`);
        }
      } else {
        // âœ… 2. Try Sunmi direct print (Silent) (Only if IP is NOT entered)
        const sunmiReady = await SunmiPrinterService.init().catch(() => false);
        if (sunmiReady) {
          try {
            const printPromise = SunmiPrinterService.printKOT(orderData, type);
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Sunmi Timeout")), 2000),
            );
            const printed = await Promise.race([printPromise, timeoutPromise]);

            if (printed) {
              console.log("âœ… KOT Printed with Sunmi - NO PREVIEW");
              await this.logPrintJob(orderData.orderId, orderData.orderNo, type);
              return true;
            }
          } catch (sunmiErr) {
            console.warn("âŒ Sunmi KOT failed/timeout:", sunmiErr);
          }
        }
      }

      // âœ… 3. Mobile Fallback (Android/iOS)
      const { uri } = await Print.printToFileAsync({
        html,
        width: 302, // 80mm at 96dpi (80 Ã— 3.7795 â‰ˆ 302px)
      });

      if (Platform.OS === "android" || Platform.OS === "ios") {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri);
        }
      }

      // âœ… 4. LOG TO DATABASE (Audit Trail)
      await this.logPrintJob(orderData.orderId, orderData.orderNo, type);
      return true;
    } catch (error) {
      console.log("KOT Print Error:", error);
      return false;
    }
  }

  private static generateKOTHTML(data: any, type: string): string {
    let title =
      type === "KDS_PRINT"
        ? "KDS PRINT"
        : type === "REPRINT"
          ? "REPRINT"
          : type === "ADDITIONAL"
            ? "ADDITIONAL"
            : "NEW ORDER";
    title = title.replace(/\s*KOT\s*/gi, "").trim();

    const items = (data.items || []).filter((item: any) => (item.status || item.Status || "").toUpperCase() !== "VOIDED");
    const rawTableNo = data.tableNo || "";
    const deviceNo = data.deviceNo || "1";
    const orderNo = data.orderNo || data.orderId || "N/A";
    const rawWaiter = data.waiterName || "Staff";
    
    const isTakeaway =
      data.orderType === "TAKEAWAY" ||
      data.orderContext?.orderType === "TAKEAWAY" ||
      data.context?.orderType === "TAKEAWAY" ||
      data.isTakeaway ||
      data.IsTakeaway ||
      String(rawTableNo).toUpperCase().includes("TAKEAWAY") ||
      String(rawTableNo).toUpperCase().startsWith("TW");

    let displayTable = "";
    const shortOrderNo = (orderNo && orderNo !== "N/A") ? `#${String(orderNo).slice(-4)}` : "";
    if (isTakeaway) {
      const rawTw = data.takeawayNo || data.orderContext?.takeawayNo || data.context?.takeawayNo || data.tableNo || rawTableNo;
      const cleanTw = (rawTw && String(rawTw) !== "undefined" && String(rawTw).trim() !== "")
        ? String(rawTw).trim()
        : "";
      const formattedTw = cleanTw.toUpperCase().startsWith("TW") ? cleanTw.toUpperCase() : (cleanTw ? `TW${cleanTw}` : "TW");
      const qsSuffix = (data.isQuickServe || data.orderContext?.isQuickServe) ? " (QS)" : "";
      displayTable = shortOrderNo ? `TW - ${formattedTw} ${shortOrderNo}${qsSuffix}` : (cleanTw ? `TAKEAWAY #${cleanTw}${qsSuffix}` : `TAKEAWAY${qsSuffix}`);
    } else {
      const cleanTableNo = String(rawTableNo || "1")
        .replace(/\s*\(quick serve\)/gi, "")
        .replace(/^table\s+/gi, "")
        .trim() || "1";
      displayTable = cleanTableNo;
    }

    const waiter = (typeof rawWaiter === "string") ? rawWaiter.replace(/\s*\(quick serve\)/gi, "").trim() || "Staff" : "Staff";
    const kotDateStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
    const kotTimeStr = formatToSingaporeTime(new Date(), { hour: '2-digit', minute: '2-digit', hour12: false });
    const timestamp = `${kotDateStr} ${kotTimeStr}`;
    const kitchenName = data.kitchenName || "";

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          @page { 
            size: 80mm auto; 
            margin: 0; 
          }
          body { 
            font-family: 'Arial', sans-serif; 
            width: 80mm; 
            padding: 0; 
            margin: 0; 
            color: #000; 
            background: #fff;
          }
          .kot-container { 
            padding: 15mm 2mm 1mm 2mm; 
            width: 76mm;
          }
          
          .header-box { 
            background: #000 !important; 
            color: #fff !important; 
            padding: 3px 5px; 
            text-align: center; 
            font-weight: bold; 
            font-size: 15px; 
            display: block;
            margin-bottom: 2px;
            text-transform: uppercase;
            -webkit-print-color-adjust: exact;
          }
          
          .timestamp {
            font-size: 10px;
            font-weight: bold;
            margin-bottom: 3px;
            color: #333;
            text-align: center;
          }
          
          .table-info {
            display: flex;
            justify-content: space-between;
            border-bottom: 1.5px dashed #000;
            padding: 1px 0;
            margin-bottom: 2px;
            font-size: 14px;
            font-weight: 900;
          }
          
          .headers {
            display: flex;
            border-bottom: 1px dashed #000;
            padding: 1px 0;
            font-size: 11px;
            font-weight: bold;
            text-transform: uppercase;
          }
          .qty-head { width: 30px; margin-right: 4px; }
          
          .item-row {
            border-bottom: 1px solid #000;
            padding: 3px 0;
          }
          
          .item-main {
            display: flex;
            align-items: flex-start;
          }
          
          .item-qty {
            font-size: 22px;
            font-weight: 900;
            width: 30px;
            line-height: 1;
            margin-right: 4px;
          }
          
          .item-name {
            font-size: 20px;
            font-weight: 900;
            flex: 1;
            line-height: 1.1;
          }
          
          .modifier-list {
            margin-left: 34px;
            margin-top: 1px;
          }
          
          .modifier-item {
            font-size: 16px;
            font-weight: 900;
            color: #000;
            display: block;
          }
          
          .remarks {
            margin-left: 34px;
            font-size: 16px;
            font-weight: 900;
            margin-top: 2px;
          }
          
          .footer {
            margin-top: 4px;
            font-size: 10px;
            font-weight: bold;
            font-family: monospace;
          }
          
          .kitchen-name {
            text-align: center;
            font-size: 18px;
            font-weight: bold;
            margin-top: 6px;
            text-transform: uppercase;
            border-top: 1.5px dashed #000;
            border-bottom: 1.5px dashed #000;
            padding: 3px 0;
          }
          
          @media print {
            @page {
              size: 80mm auto;
              margin: 0;
            }
            body { width: 80mm; }
            .header-box { -webkit-print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div class="kot-container">
          <div class="header-box">${title}</div>
          <div class="timestamp">${timestamp}</div>
          
          <div class="table-info" style="font-size: 18px; font-weight: 900; white-space: nowrap;">
            <span>${isTakeaway ? displayTable : `TABLE: ${displayTable}`}</span>
          </div>
          
          <div class="headers">
            <div class="qty-head">Qty</div>
            <div>Item</div>
          </div>

          <div class="item-list">
            ${(() => {
              if (type === "KDS_PRINT") {
                const kitchenGroups: Record<string, any[]> = {};
                items.forEach((item: any) => {
                  const kName = (item.KitchenTypeName || item.kitchenTypeName || item.dishGroupName || item.categoryName || "KITCHEN").toUpperCase().trim();
                  if (!kitchenGroups[kName]) kitchenGroups[kName] = [];
                  kitchenGroups[kName].push(item);
                });

                return Object.entries(kitchenGroups).map(([kName, groupItems]) => {
                  return `
                    <div style="font-size: 18px; font-weight: bold; margin-top: 10px; border-bottom: 1.5px solid #000; padding-bottom: 2px; text-transform: uppercase;">
                      <b>${kName}</b>
                    </div>
                    ${groupItems.map((item: any) => {
                      const noteText = item.note || item.notes || item.Remarks || item.remarks;
                      const rawCombo = item.comboSelections || item.selectedCombos || item.combos ||
                        (typeof item.ComboDetailsJSON === 'string' && item.ComboDetailsJSON 
                          ? (() => { try { const p = JSON.parse(item.ComboDetailsJSON); return Array.isArray(p) ? p : (p.groups || p.items || p.selections || []); } catch { return undefined; } })() 
                          : (Array.isArray(item.ComboDetailsJSON) ? item.ComboDetailsJSON : (typeof item.ComboDetailsJSON === 'object' && item.ComboDetailsJSON ? (item.ComboDetailsJSON.groups || item.ComboDetailsJSON.items || []) : undefined)));
                      const comboSels = Array.isArray(rawCombo) ? rawCombo : [];
                      const hasCombo = comboSels.length > 0;

                      return `
                        <div class="item-row">
                          <div class="item-main">
                            <div class="item-qty">${item.quantity || item.qty || 1}</div>
                            <div class="item-name">
                              <b>${(item.name || "").replace(/\n/g, '<br/>')}</b>
                              ${item.songName || item.SongName ? `<div style="font-size: 12px; font-weight: normal; color: #555; margin-top: 4px;">🎵 ${item.songName || item.SongName}</div>` : ''}
                            </div>
                          </div>
                          ${
                            item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway
                              ? `<div class="modifier-list"><span class="modifier-item">- Takeaway</span></div>`
                              : ""
                          }
                          ${
                            item.modifiers && item.modifiers.length > 0
                              ? `<div class="modifier-list">${item.modifiers.map((m: any) => `<span class="modifier-item">+ ${m.name || m.ModifierName}</span>`).join("")}</div>`
                              : ""
                          }
                          ${
                            hasCombo
                              ? `<div class="modifier-list">${comboSels.map((g: any) => {
                                  const choices = g.items || g.dishes || g.selections || g.selectedDishes || (Array.isArray(g) ? g : (g.name || g.DishName || g.itemName ? [g] : []));
                                  if (Array.isArray(choices)) {
                                    return choices.map((opt: any) => {
                                      const optName = opt.name || opt.DishName || opt.itemName || "";
                                      return optName ? `<span class="modifier-item">- ${optName}</span>` : "";
                                    }).join("");
                                  }
                                  return "";
                                }).join("")}</div>`
                              : ""
                          }
                          ${noteText ? `<div class="remarks">* ${noteText}</div>` : ""}
                        </div>
                      `;
                    }).join("")}
                  `;
                }).join("");
              }

              return items.map((item: any) => {
                const noteText = item.note || item.notes || item.Remarks || item.remarks;
                const rawCombo = item.comboSelections || item.selectedCombos || item.combos || 
                  (typeof item.ComboDetailsJSON === 'string' && item.ComboDetailsJSON 
                    ? (() => { try { const p = JSON.parse(item.ComboDetailsJSON); return Array.isArray(p) ? p : (p.groups || p.items || p.selections || []); } catch { return undefined; } })() 
                    : (Array.isArray(item.ComboDetailsJSON) ? item.ComboDetailsJSON : (typeof item.ComboDetailsJSON === 'object' && item.ComboDetailsJSON ? (item.ComboDetailsJSON.groups || item.ComboDetailsJSON.items || []) : undefined)));
                const comboSels = Array.isArray(rawCombo) ? rawCombo : [];
                const hasCombo = comboSels.length > 0;

                return `
                  <div class="item-row">
                    <div class="item-main">
                      <div class="item-qty">${item.quantity || item.qty || 1}</div>
                      <div class="item-name">
                        <b>${(item.name || "").replace(/\n/g, '<br/>')}</b>
                        ${item.songName || item.SongName ? `<div style="font-size: 12px; font-weight: normal; color: #555; margin-top: 4px;">🎵 ${item.songName || item.SongName}</div>` : ''}
                      </div>
                    </div>
                    ${
                      item.isTakeaway ||
                      item.IsTakeaway ||
                      item.isTakeAway ||
                      item.IsTakeAway
                        ? `
                      <div class="modifier-list">
                        <span class="modifier-item">- Takeaway</span>
                      </div>
                    `
                        : ""
                    }
                    ${
                      item.modifiers && item.modifiers.length > 0
                        ? `
                      <div class="modifier-list">
                        ${item.modifiers
                          .map(
                            (m: any) => `
                          <span class="modifier-item">+ ${m.name || m.ModifierName}</span>
                        `,
                          )
                          .join("")}
                      </div>
                    `
                        : ""
                    }
                    ${
                      hasCombo
                        ? `
                      <div class="modifier-list">
                        ${comboSels
                          .map((g: any) => {
                            const choices = g.items || g.dishes || g.selections || g.selectedDishes || (Array.isArray(g) ? g : (g.name || g.DishName || g.itemName ? [g] : []));
                            if (Array.isArray(choices)) {
                              return choices.map((opt: any) => {
                                const optName = opt.name || opt.DishName || opt.itemName || "";
                                return optName ? `<span class="modifier-item">- ${optName}</span>` : "";
                              }).join("");
                            }
                            return "";
                          })
                          .join("")}
                      </div>
                    `
                        : ""
                    }
                    ${
                      noteText
                        ? `
                      <div class="remarks">
                        * ${noteText}
                      </div>
                    `
                        : ""
                    }
                  </div>
                `;
              }).join("");
            })()}
          </div>

          <div class="footer">
            Order By : ${waiter} #OR-${orderNo}
          </div>

          ${kitchenName && kitchenName !== "KDS" ? `<div class="kitchen-name">${kitchenName.toUpperCase()}  /  ${isTakeaway ? displayTable : `T.NO: ${displayTable}`}</div>` : ""}
        </div>
      </body>
      </html>
    `;
  }

  private static formatKOTThermalText(data: any, type: string = "NEW"): string {
    const title =
      type === "KDS_PRINT"    ? "KDS PRINT"
      : type === "REPRINT"    ? "REPRINT"
      : type === "ADDITIONAL" ? "ADDITIONAL ORDER"
      : "NEW ORDER";

    const items       = (data.items || []).filter((i: any) => (i.status || i.Status || "").toUpperCase() !== "VOIDED");
    const rawTableNo  = data.tableNo || "";
    const rawWaiter   = data.waiterName || "Staff";
    const orderNo     = data.orderNo || data.orderId || "";
    const kitchenName = data.kitchenName || "";

    const isTakeaway =
      data.orderType === "TAKEAWAY" ||
      data.orderContext?.orderType === "TAKEAWAY" ||
      data.context?.orderType === "TAKEAWAY" ||
      data.isTakeaway ||
      data.IsTakeaway ||
      String(rawTableNo).toUpperCase().includes("TAKEAWAY") ||
      String(rawTableNo).toUpperCase().startsWith("TW");

    let displayTable = "";
    const shortOrderNo = orderNo ? `#${String(orderNo).slice(-4)}` : "";
    if (isTakeaway) {
      const rawTw = data.takeawayNo || data.orderContext?.takeawayNo || data.context?.takeawayNo || data.tableNo || rawTableNo;
      const cleanTw = (rawTw && String(rawTw) !== "undefined" && String(rawTw).trim() !== "")
        ? String(rawTw).trim()
        : "";
      const formattedTw = cleanTw.toUpperCase().startsWith("TW") ? cleanTw.toUpperCase() : (cleanTw ? `TW${cleanTw}` : "TW");
      const qsSuffix = (data.isQuickServe || data.orderContext?.isQuickServe) ? " (QS)" : "";
      displayTable = shortOrderNo ? `TW - ${formattedTw} ${shortOrderNo}${qsSuffix}` : (cleanTw ? `TAKEAWAY #${cleanTw}${qsSuffix}` : `TAKEAWAY${qsSuffix}`);
    } else {
      const cleanTableNo = String(rawTableNo || "1")
        .replace(/\s*\(quick serve\)/gi, "")
        .replace(/^table\s+/gi, "")
        .trim() || "1";
      displayTable = cleanTableNo;
    }

    const waiter = (typeof rawWaiter === "string") ? rawWaiter.replace(/\s*\(quick serve\)/gi, "").trim() || "Staff" : "Staff";

    const kotDateStr = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date()).replace(/[\u202F\u00A0\uFEFF]/g, ' ');
    const kotTimeStr = formatToSingaporeTime(new Date(), { hour: "2-digit", minute: "2-digit", hour12: false }).replace(/[\u202F\u00A0\uFEFF]/g, ' ');

    const DIV = "[L]------------------------------------------------\n";

    const DISH_WRAP = 20;
    const BIG_MOD_WRAP = 20;

    const wrapText = (str: string, maxChars: number): string[] => {
      const words = String(str || "").split(" ");
      const result: string[] = [];
      let current = "";
      for (const word of words) {
        if (!word) continue;
        if (!current) {
          current = word;
        } else if ((current + " " + word).length <= maxChars) {
          current += " " + word;
        } else {
          result.push(current);
          current = word;
        }
      }
      if (current) result.push(current);
      return result.length ? result : [""];
    };

    const formatItem = (item: any): string => {
      let t = "";
      const qtyNum   = item.quantity || item.qty || 1;
      const itemName = item.name || item.DishName || "";

      wrapText(itemName.replace(/\n/g, " "), DISH_WRAP).forEach((chunk: string, idx: number) => {
        if (idx === 0) t += `[L]<font size='big'><B>[${qtyNum}] ${chunk}</B></font>\n`;
        else           t += `[L]<font size='big'><B>    ${chunk}</B></font>\n`;
      });

      const songName = item.songName || item.SongName || "";
      if (songName) t += `[L]<font size='big'><B>  ♪ ${songName}</B></font>\n`;

      const isTw = !!(item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway);
      if (isTw) t += `[L]<font size='big'><B>  >> TAKEAWAY <<</B></font>\n`;

      if (item.modifiers && item.modifiers.length > 0) {
        item.modifiers.forEach((m: any) => {
          const modName = m.ModifierName || m.modifierName || m.name || m.ModifierNameEn || "";
          if (modName) {
            wrapText(modName, BIG_MOD_WRAP).forEach((chunk: string, idx: number) => {
              t += idx === 0 ? `[L]<font size='big'><B>  + ${chunk}</B></font>\n` : `[L]<font size='big'><B>    ${chunk}</B></font>\n`;
            });
          }
        });
      }

      let comboSels = item.comboSelections || item.selectedCombos || item.combos;
      if (!comboSels || (Array.isArray(comboSels) && comboSels.length === 0)) {
        const rawCombo = item.ComboDetailsJSON || item.comboDetailsJSON || item.ComboDetails || item.comboDetails;
        if (rawCombo) {
          if (typeof rawCombo === 'string') {
            try {
              const parsed = JSON.parse(rawCombo);
              comboSels = Array.isArray(parsed) ? parsed : (parsed.groups || parsed.items || parsed.selections || []);
            } catch (e) {
              comboSels = [];
            }
          } else if (Array.isArray(rawCombo)) {
            comboSels = rawCombo;
          } else if (typeof rawCombo === 'object') {
            comboSels = rawCombo.groups || rawCombo.items || rawCombo.selections || [];
          }
        }
      }

      if (Array.isArray(comboSels) && comboSels.length > 0) {
        comboSels.forEach((g: any) => {
          const choices = g.items || g.dishes || g.selections || g.selectedDishes || (Array.isArray(g) ? g : (g.name || g.DishName || g.itemName ? [g] : []));
          if (Array.isArray(choices)) {
            choices.forEach((opt: any) => {
              const optName = opt.name || opt.DishName || opt.itemName || "";
              if (optName) {
                wrapText(optName, BIG_MOD_WRAP).forEach((chunk: string, idx: number) => {
                  t += idx === 0 ? `[L]<font size='big'><B>  - ${chunk}</B></font>\n` : `[L]<font size='big'><B>    ${chunk}</B></font>\n`;
                });
              }
            });
          }
        });
      }

      const noteText = item.note || item.notes || item.Remarks || item.remarks;
      if (noteText) {
        wrapText(noteText, BIG_MOD_WRAP).forEach((chunk: string, idx: number) => {
          t += idx === 0 ? `[L]<font size='big'><B>  * ${chunk}</B></font>\n` : `[L]<font size='big'><B>    ${chunk}</B></font>\n`;
        });
      }

      return t;
    };

    let text = "";
    text += "[L]\n".repeat(4);
    text += `[C]<font size='big'><B>${title}</B></font>\n`;
    text += `[C]<B>${kotDateStr}  ${kotTimeStr}</B>\n`;
    text += DIV;

    if (isTakeaway) {
      text += `[C]<font size='big'><B>${displayTable}</B></font>\n`;
    } else {
      text += `[C]<font size='big'><B>TABLE: ${displayTable}</B></font>\n`;
    }
    text += DIV;

    text += "[L]<B>QTY  ITEM</B>\n";
    text += DIV;

    if (type === "KDS_PRINT") {
      const groups: Record<string, any[]> = {};
      items.forEach((item: any) => {
        const k = (item.KitchenTypeName || item.kitchenTypeName || item.dishGroupName || item.categoryName || "KITCHEN").toUpperCase().trim();
        if (!groups[k]) groups[k] = [];
        groups[k].push(item);
      });

      for (const [kName, groupItems] of Object.entries(groups)) {
        text += `[C]<B>--- ${kName} ---</B>\n`;
        text += DIV;
        groupItems.forEach((item: any, idx: number) => {
          text += formatItem(item);
          if (idx < groupItems.length - 1) text += "[L]\n";
        });
        text += DIV;
      }
    } else {
      const kotGroups: Record<string, any[]> = {};
      items.forEach((item: any) => {
        const k = (item.KitchenTypeName || item.kitchenTypeName || item.dishGroupName || item.categoryName || "KITCHEN").toUpperCase().trim();
        if (!kotGroups[k]) kotGroups[k] = [];
        kotGroups[k].push(item);
      });

      const kotGroupEntries = Object.entries(kotGroups);
      kotGroupEntries.forEach(([kName, groupItems]: [string, any[]], gIdx: number) => {
        if (kotGroupEntries.length > 1) {
          text += `[C]<B>--- ${kName} ---</B>\n`;
          text += DIV;
        }
        groupItems.forEach((item: any, idx: number) => {
          text += formatItem(item);
          if (idx < groupItems.length - 1) text += "[L]\n";
        });
        text += DIV;
      });
    }

    text += `[L]<B>Order By : ${waiter}</B>\n`;
    text += `[L]<B>Order No : ${orderNo}</B>\n`;

    if (type !== "KDS_PRINT") {
      let kotLabel = "";
      if (isTakeaway) {
        kotLabel = kitchenName && kitchenName !== "KDS"
          ? `${kitchenName.toUpperCase()}  /  ${displayTable}`
          : displayTable;
      } else {
        kotLabel = kitchenName && kitchenName !== "KDS"
          ? `${kitchenName.toUpperCase()}  /  T.NO : ${displayTable}`
          : `T.NO : ${displayTable}`;
      }
      if (kotLabel) {
        text += DIV;
        text += `[C]<B>${kotLabel}</B>\n`;
        text += DIV;
      }
    }

    // ── FEED LINES at end ──
    text += "[L]\n";

    return text;
  }

  // ==================== MAIN SMART PRINT WITH DISCOUNT ====================
  static async smartPrint(
    saleData: any,
    outletId?: string | number,
    t?: any,
    discountInfo?: DiscountInfo,
    preferredType?: PrinterType,
    isReprint: boolean = false,
  ): Promise<boolean> {
    if (Platform.OS === "web") {
      try {
        const company = await BillPDFGenerator.loadSettings(outletId);
        const text = this.formatThermalTextWithDiscount(
          saleData,
          company,
          discountInfo,
        );
        const isTakeaway =
          !saleData.tableNo ||
          String(saleData.tableNo).trim() === "" ||
          String(saleData.tableNo).toUpperCase().startsWith("TW") ||
          String(saleData.tableNo).toUpperCase() === "TAKEAWAY" ||
          String(saleData.tableNo).toUpperCase() === "TAKE AWAY";

        let cashierIp = company.printerIp || "";
        let takeawayIp = company.printerIp || "";
        try {
          const now = Date.now();
          let printers = this.cachedPrinters;
          if (!printers || (now - this.lastPrintersFetchTime > 30000)) {
            const response = await fetch(`${API_URL}/api/settings/kitchen-printers`);
            printers = await response.json();
            this.cachedPrinters = printers;
            this.lastPrintersFetchTime = now;
          }
          if (Array.isArray(printers)) {
            const cashierPrinter = printers.find((p: any) => p.PrinterType === 1);
            const takeawayPrinter = printers.find((p: any) => p.PrinterType === 3);
            cashierIp = cashierPrinter?.PrinterPath || cashierPrinter?.PrinterIP || cashierIp;
            takeawayIp = takeawayPrinter?.PrinterPath || takeawayPrinter?.PrinterIP || takeawayIp;
          }
        } catch (err) {
          console.warn("[UniversalPrinter] Failed to fetch printer IPs from PrintMaster:", err);
        }

        const targetIp = isTakeaway
          ? (takeawayIp || cashierIp || company.printerIp || "")
          : (cashierIp || company.printerIp || "");

        const pType = isTakeaway ? 3 : 1;
        console.log(`📡 [Web Print Bridge] Queueing receipt (Type ${pType}, Target IP: ${targetIp || "default"})`);
        const success = await this.queuePrintJob(pType, undefined, text, true, targetIp);
        if (success) return true;

        console.log("⚠️ [Web Receipt Print] Print Bridge queue failed. Falling back to iframe print preview.");
        return await this.offerPDFFallback(saleData, outletId, t, discountInfo);
      } catch (err) {
        console.warn("[Web Print Bridge] Receipt Queue failed, falling back to iframe print preview:", err);
        return await this.offerPDFFallback(saleData, outletId, t, discountInfo);
      }
    }

    // ðŸš€ NON-BLOCKING BACKGROUND EXECUTION: Run printing in the background to prevent UI lag on APK
    (async () => {
      try {
        const company = await BillPDFGenerator.loadSettings(outletId);

        // Load printer IPs dynamically from PrintMaster with caching
        let cashierIp = "";
        let takeawayIp = "";
        try {
          const now = Date.now();
          let printers = this.cachedPrinters;
          if (!printers || (now - this.lastPrintersFetchTime > 30000)) {
            const response = await fetch(
              `${API_URL}/api/settings/kitchen-printers`,
            );
            printers = await response.json();
            this.cachedPrinters = printers;
            this.lastPrintersFetchTime = now;
          }
          if (Array.isArray(printers)) {
            const cashierPrinter = printers.find((p) => p.PrinterType === 1);
            const takeawayPrinter = printers.find((p) => p.PrinterType === 3);
            cashierIp = cashierPrinter?.PrinterPath || "";
            takeawayIp = takeawayPrinter?.PrinterPath || "";
          }
        } catch (err) {
          console.warn("Failed to fetch printer IPs from PrintMaster:", err);
        }

        // Determine target printer IP based on order type (Dine-in vs Takeaway)
        const isTakeaway =
          !saleData.tableNo ||
          String(saleData.tableNo).trim() === "" ||
          String(saleData.tableNo).toUpperCase().startsWith("TW") ||
          String(saleData.tableNo).toUpperCase() === "TAKEAWAY" ||
          String(saleData.tableNo).toUpperCase() === "TAKE AWAY";

        let targetIp = "";
        if (isTakeaway) {
          targetIp = takeawayIp || cashierIp || company.printerIp || "";
        } else {
          targetIp = cashierIp || company.printerIp || "";
        }

        const hasConfiguredIp = targetIp && targetIp.trim().length > 0;

        if (hasConfiguredIp) {
          console.log(`ðŸŒ Trying configured printer: ${targetIp}`);
          const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(targetIp.trim());

          // 📲 Try Print Bridge if active on network (supports USB / Shared printers from APK)
          const isBridge = await this.isBridgeOnline();
          if (isBridge) {
            try {
              console.log(`📡 [APK Print Bridge] Queueing receipt to Print Bridge for: ${targetIp}`);
              const text = this.formatThermalTextWithDiscount(saleData, company, discountInfo);
              const pType = isTakeaway ? 3 : 1;
              const success = await this.queuePrintJob(pType, undefined, text);
              if (success) return;
            } catch (bridgeErr) {
              console.warn("APK Print Bridge queue failed, trying direct connection:", bridgeErr);
            }
          }
          let isReachable = false;
          if (isIp) {
            isReachable = await this.isIpReachable(targetIp, 9100);
          } else {
            isReachable = true; // For Bluetooth MAC addresses etc.
          }

          if (isReachable) {
            try {
              const printPromise = this.printNetwork(
                saleData,
                outletId,
                {
                  type: isIp ? "network" : "bluetooth",
                  address: targetIp,
                } as any,
                discountInfo,
              );

              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("WiFi Timeout")), 3000),
              );
              const printed = await Promise.race([printPromise, timeoutPromise]);

              if (printed) return;
            } catch (err) {
              console.log("WiFi failed/timeout:", err);
            }
          }
          Alert.alert(
            "Printer Connection Error",
            `Could not connect to the configured LAN/Wi-Fi printer at ${targetIp}. Opening print preview...`,
          );
          await this.offerPDFFallback(saleData, outletId, t, discountInfo);
          return;
        }

        // If no IP is configured, print using the Sunmi built-in printer
        console.log("ðŸ–¨ï¸ No printer IP configured. Printing to Sunmi built-in printer.");
        try {
          const printed = await this.printThermalReceipt(
            saleData,
            outletId,
            undefined,
            discountInfo,
          );
          if (printed) return;
        } catch (e) {
          console.log("Sunmi failed/timeout", e);
        }

        // Fallback to PDF/Web (Guaranteed)
        console.log("ðŸ”„ Fallback to PDF Preview");
        await this.offerPDFFallback(saleData, outletId, t, discountInfo);
      } catch (error) {
        console.log("SmartPrint error:", error);
        await this.offerPDFFallback(saleData, outletId, t, discountInfo);
      }
    })();

    return true;
  }

  /**
   * Print Checkout Bill (Guest Check)
   * Uses the same branding as the receipt but shows 'PAYMENT PENDING'
   */
  static async printCheckoutBill(
    saleData: any,
    outletId?: string | number,
    discountInfo?: DiscountInfo,
  ): Promise<boolean> {
    try {
      // Check General Settings: Print Receipt & Checkout Bill
      const { useGeneralSettingsStore } = await import("../stores/generalSettingsStore");
      const { enableReceiptPrint, enableCheckoutBill } = useGeneralSettingsStore.getState().settings;
      if (enableReceiptPrint === false || enableCheckoutBill === false) {
        if (__DEV__) console.log("🧾 [UniversalPrinter] Checkout bill receipt printing is disabled in General Settings.");
        return false;
      }

      // ✅ FIX: Match the logic in PaymentSuccess by ensuring we have a valid ID
      const targetUserId = outletId || "1";
      const company = await BillPDFGenerator.loadSettings(targetUserId);

      const effectiveDiscountInfo = discountInfo || saleData.discount || (saleData.discountAmount > 0 ? {
        applied: true,
        type: saleData.discountType || 'percentage',
        value: saleData.discountValue || 0,
        amount: saleData.discountAmount
      } : undefined);

      // Set checkout flag for the template
      const enhancedSaleData = {
        ...saleData,
        discount: effectiveDiscountInfo,
        discountAmount: saleData.discountAmount ?? effectiveDiscountInfo?.amount,
        isCheckout: true,
        // Ensure branding is present for the template
        shopName: company.name,
        shopAddress: company.address,
        shopPhone: company.phone,
        shopEmail: company.email,
        shopGst: company.gstNo,
      };

      // Use the standard smartPrint logic but with the checkout flag
      return await this.smartPrint(
        enhancedSaleData,
        targetUserId,
        undefined,
        effectiveDiscountInfo,
      );
    } catch (error: any) {
      console.error("❌ Checkout Print Error:", error);
      return false;
    }
  }

  // ==================== THERMAL PRINTING WITH DISCOUNT ====================
  private static async printThermalReceipt(
    saleData: any,
    userId?: string | number,
    printer?: PrinterInfo,
    discountInfo?: DiscountInfo,
  ): Promise<boolean> {
    try {
      // ✅ STEP 1: Try Sunmi direct print (NO preview)
      const sunmiReady = await SunmiPrinterService.init();
      if (sunmiReady) {
        const company = await BillPDFGenerator.loadSettings(userId);

        // ✅ Pass discount to saleData for Sunmi printer
        const enhancedSaleData = { ...saleData };
        const effectiveDisc = discountInfo || saleData.discount;
        if (effectiveDisc?.applied !== false || saleData.discountAmount > 0) {
          enhancedSaleData.discount = effectiveDisc;
          if (effectiveDisc?.amount) enhancedSaleData.discountAmount = effectiveDisc.amount;
          if (effectiveDisc?.type) enhancedSaleData.discountType = effectiveDisc.type;
          if (effectiveDisc?.value != null) enhancedSaleData.discountValue = effectiveDisc.value;
        }

        const printed = await SunmiPrinterService.printReceipt(
          enhancedSaleData,
          company,
        );
        if (printed) {
          console.log("✅ Printed with Sunmi printer - NO PREVIEW");
          return true;
        }
      }

      // âœ… STEP 2: If Sunmi fails, return false so smartPrint falls back to PDF dialog/share
      return false;
    } catch (error: any) {
      console.log("Thermal print error:", error);
      return false;
    }
  }
  private static async getBase64LogoStr(logoUrl: string): Promise<string | null> {
    if (!logoUrl) return null;
    try {
      let url = logoUrl;
      if (url && !url.startsWith("http") && !url.startsWith("data:")) {
        url = url.startsWith("/") ? `${API_URL}${url}` : `${API_URL}/${url}`;
      }
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        const FileSystem = require('expo-file-system');
        const filename = 'temp_logo_thermal_' + Date.now() + '.png';
        const fileUri = FileSystem.cacheDirectory + filename;
        const downloadRes = await FileSystem.downloadAsync(url, fileUri);
        const base64 = await FileSystem.readAsStringAsync(downloadRes.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        try {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch (_) {}
        return base64;
      }
    } catch (e) {
      console.warn("Failed to convert logo to base64 for thermal printer:", e);
    }
    return null;
  }

  // ==================== NETWORK PRINTING ====================
  private static async printNetwork(
    saleData: any,
    userId?: string | number,
    printer?: PrinterInfo,
    discountInfo?: DiscountInfo,
  ): Promise<boolean> {
    try {
      const company = await BillPDFGenerator.loadSettings(userId);
      let text = this.formatThermalTextWithDiscount(
        saleData,
        company,
        discountInfo,
      );

      // Prepend company logo if configured and visible
      if (company.showCompanyLogo && company.companyLogo) {
        const base64Logo = await this.getBase64LogoStr(company.companyLogo);
        if (base64Logo) {
          text = `[C]<img>${base64Logo}</img>\n\n` + text;
        }
      }

      // Append halal logo at the end if configured and visible
      if (company.showHalalLogo && company.halalLogo) {
        const base64Halal = await this.getBase64LogoStr(company.halalLogo);
        if (base64Halal) {
          text = text + `\n\n[C]<img>${base64Halal}</img>\n`;
        }
      }

      const targetAddress = printer?.address || company.printerIp || "";

      if (!targetAddress) return false;

      const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(targetAddress);

      if (isIp) {
        await ThermalPrinter.printTcp({
          ip: targetAddress,
          port: 9100,
          payload: text,
          mmFeedPaper: 25,
        });
      } else {
        console.log(`🔵 Receipt Bluetooth print to: ${targetAddress}`);
        await ThermalPrinterImport?.getBluetoothDeviceList?.().catch(() => {});
        await ThermalPrinter.printBluetooth({
          macAddress: targetAddress,
          payload: text,
          mmFeedPaper: 25,
        });
      }
      return true;
    } catch (error: any) {
      console.log("âŒ Network print error:", error);
      return false;
    }
  }

  private static formatTwoCols48(left: any, right: any): string {
    const cleanLeft = String(left || "").replace(/<[^>]*>/g, "");
    const cleanRight = String(right || "").replace(/<[^>]*>/g, "");
    const totalWidth = 48;
    const spaceCount = totalWidth - cleanLeft.length - cleanRight.length;
    if (spaceCount > 0) {
      return `[L]${left}${" ".repeat(spaceCount)}${right}\n`;
    } else {
      return `[L]${left}\n[L]${right.padStart(totalWidth, " ")}\n`;
    }
  }

  private static formatThermalTextWithDiscount(
    saleData: any,
    company: any,
    discountInfo?: DiscountInfo,
  ): string {
    const symbol = company.currencySymbol || "$";
    const isCheckout = !!saleData.isCheckout;

    // ── Upside White Space ──
    let text = "\n\n[C]================================================\n";
    if (isCheckout) {
      text += "[C]<font size='big'><B>CHECKOUT BILL</B></font>\n";
      text += "[C]<B>PAYMENT PENDING</B>\n";
    } else {
      text += "[C]<font size='big'><B>PAYMENT RECEIPT</B></font>\n";
    }
    text += "[C]================================================\n";

    // Header Info
    text += `[C]<font size='big'><B>${(company.name || "YOUR STORE").toUpperCase()}</B></font>\n`;
    if (company.address) text += `[C]${company.address}\n`;
    if (company.phone) text += `[C]Tel: ${company.phone}\n`;
    if (company.email) text += `[C]Email: ${company.email}\n`;
    text += "[C]------------------------------------------------\n";

    const saleDate = saleData.originalDate ? parseDatabaseDate(saleData.originalDate) : 
                     saleData.date ? parseDatabaseDate(saleData.date) : 
                     new Date();

    const isReceiptTW =
      saleData.orderType === "TAKEAWAY" ||
      saleData.isTakeaway ||
      saleData.IsTakeaway ||
      String(saleData.tableNo || "").toUpperCase().includes("TAKEAWAY") ||
      String(saleData.tableNo || "").toUpperCase().startsWith("TW");

    const billNumber =
      saleData.invoiceNumber ||
      saleData.billNo ||
      saleData.BillNo ||
      saleData.id ||
      saleData.orderNumber ||
      saleData.orderNo ||
      saleData.orderId ||
      "";

    if (isReceiptTW) {
      const shortOrderNo = billNumber ? String(billNumber).slice(-4) : "";
      const twLabel = shortOrderNo ? `TW#${shortOrderNo}` : "TW";
      text += this.formatTwoCols48(`<B>Bill No: ${billNumber}</B>`, `<B>${twLabel}</B>`);
    } else if (saleData.tableNo) {
      const cleanTableNo = String(saleData.tableNo).replace(/\s*\(quick serve\)/gi, "").replace(/^table\s+/gi, "").trim();
      text += this.formatTwoCols48(`<B>Bill No: ${billNumber}</B>`, `<B>TABLE: ${cleanTableNo}</B>`);
    } else {
      text += `[L]<B>Bill No: ${billNumber}</B>\n`;
    }
    const dateFormatted = formatToSingaporeDate(saleDate, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeFormatted = formatToSingaporeTime(saleDate).replace(/(am|pm)/gi, (m) => m.toUpperCase());
    text += `[L]<B>Date: ${dateFormatted} ${timeFormatted}</B>\n`;
    if (saleData.waiterName && saleData.waiterName !== "Staff") {
      const displayWaiter = String(saleData.waiterName).replace(/\s*\(quick serve\)/gi, "").trim() || "Staff";
      text += `[L]<B>Waiter: ${displayWaiter}</B>\n`;
    }
    // Print Member Mobile Number on receipt
    if (saleData.mobileNo) {
      text += `[L]<B>Member Phone: ${saleData.mobileNo}</B>\n`;
    }
    text += "[L]------------------------------------------------\n";

    // Items Header
    text += "[L]<B>ITEM                        QTY   PRICE    TOTAL</B>\n";
    text += "[L]------------------------------------------------\n";

    const printItems = (saleData.items || []).filter(
      (i: any) => i.status !== "VOIDED",
    );
    const activeItems = (saleData.items || []).filter((i: any) => i.status !== "VOIDED" && i.statusCode !== 0);
    const allItemsHaveSC = activeItems.length > 0 && activeItems.every((item: any) => {
      const isTakeawayItem = item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway;
      return !isTakeawayItem && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true);
    });

    printItems.forEach((item: any) => {
      // Robust field mapping
      const name = (item.name || item.DishName || item.ProductName || "")
        .substring(0, 26)
        .padEnd(26);
      const qtyNum =
        parseInt(String(item.qty || item.quantity || item.Quantity || 1)) || 1;
      const qty = `[${qtyNum}]`.padStart(5);

      const priceNum =
        parseFloat(String(item.price || item.Price || item.Cost || 0)) || 0;
      const price = `${symbol}${priceNum.toFixed(2)}`.padStart(8);

      const totalNum = priceNum * qtyNum;
      const total = `${symbol}${totalNum.toFixed(2)}`.padStart(9);

      text += `[L]<B>${name}${qty}${price}${total}</B>\n`;

      const songName = item.songName || item.SongName || "";
      if (songName) {
        text += `[L]<B>   ♪ ${songName}</B>\n`;
      }

      // If name was truncated, print full name on next line
      if ((item.name || "").length > 26) {
        text += `[L]<B>   ${item.name}</B>\n`;
      }

      // Modifiers
      if (item.modifiers && Array.isArray(item.modifiers)) {
        item.modifiers.forEach((m: any) => {
          const mName = (m.ModifierName || m.name || "").trim();
          if (mName) {
            text += `[L]<B>   + ${mName}</B>\n`;
          }
        });
      }

      // Combo selections
      const comboSels = item.comboSelections || 
        (typeof item.ComboDetailsJSON === 'string' && item.ComboDetailsJSON 
          ? (() => { try { const p = JSON.parse(item.ComboDetailsJSON); return Array.isArray(p) ? p : p.groups || p.items || []; } catch { return undefined; } })() 
          : (Array.isArray(item.ComboDetailsJSON) ? item.ComboDetailsJSON : undefined)) || [];
      const hasCombo = Array.isArray(comboSels) && comboSels.length > 0;
      if (hasCombo) {
        comboSels.forEach((group: any) => {
          const choices = group.items || group.dishes || (Array.isArray(group) ? group : [group]);
          if (Array.isArray(choices)) {
            choices.forEach((opt: any) => {
              const optName = opt.name || opt.DishName || opt.itemName || "";
              if (optName) {
                text += `[L]<B>   - ${optName}</B>\n`;
              }
            });
          }
        });
      }

      // Item Discount
      const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
      if (discAmt > 0) {
        const discType = item.discountType || "percentage";
        const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
        const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
        const effectiveDisc = discType === "percentage" ? discAmt : Math.min(discAmt, discountBasis);
        const discStr =
          discType === "FOC"
            ? "FOC"
            : discType === "percentage"
            ? `-${discAmt}%`
            : `-${symbol}${effectiveDisc.toFixed(2)}`;
        text += `[L]<B>      Discount: ${discStr}</B>\n`;
      }
    });

    text += "[L]------------------------------------------------\n";

    // Totals
    // Calculate item-level discounts and gross total
    let grossTotal = 0;
    let totalItemDiscount = 0;
    (saleData.items || []).forEach((item: any) => {
      if (item.status === "VOIDED") return;
      const qtyNum = parseInt(String(item.qty || item.quantity || 1)) || 1;
      const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
      const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
      const baseTotal = (item.price || 0) * qtyNum;
      let itemDiscount = 0;
      const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
      const discType = item.discountType || "percentage";
      if (discAmt > 0) {
        if (discType === "percentage") {
          itemDiscount = (discountBasis * (discAmt / 100)) * qtyNum;
        } else if (discType === "FOC") {
          itemDiscount = baseTotal;
        } else {
          itemDiscount = Math.min(discAmt, discountBasis) * qtyNum;
        }
      }
      grossTotal += baseTotal;
      totalItemDiscount += itemDiscount;
    });

    const finalDiscountInfo =
      discountInfo ||
      (saleData.discount
        ? {
            applied: true,
            type: saleData.discount.type || "percentage",
            value: saleData.discount.value || 0,
            amount: saleData.discount.amount || saleData.discountAmount || 0,
          }
        : saleData.discountAmount && saleData.discountAmount > 0
          ? {
              applied: true,
              type: saleData.discountType || "percentage",
              value: saleData.discountValue || 0,
              amount: saleData.discountAmount,
            }
          : null);

    const focPayment = (saleData.payments || []).find((p: any) => String(p.payMode || p.payModeName || p.Remarks || '').trim().toUpperCase() === 'FOC');
    const focAmt = focPayment ? Number(focPayment.amount ?? focPayment.Amount ?? 0) : 0;
    
    let orderDiscount = finalDiscountInfo?.amount || saleData.discountAmount || 0;
    if (orderDiscount === 0 && finalDiscountInfo && finalDiscountInfo.applied !== false && finalDiscountInfo.value > 0) {
      const subtotalPostItemDisc = Math.max(0, grossTotal - totalItemDiscount);
      if (finalDiscountInfo.type === "percentage") {
        orderDiscount = (subtotalPostItemDisc * finalDiscountInfo.value) / 100;
      } else {
        orderDiscount = Math.min(finalDiscountInfo.value, subtotalPostItemDisc);
      }
    }

    const normalDiscount = Math.max(0, orderDiscount - focAmt);
    // FOC is a payment method, not a pre-tax discount — exclude from subtotal calculation
    const hasAnyDiscount = totalItemDiscount > 0 || normalDiscount > 0;
    let currentSubtotal = Math.max(0, grossTotal - totalItemDiscount - normalDiscount);

    text += this.formatTwoCols48("<B>Sub Total:</B>", `<B>${symbol}${grossTotal.toFixed(2)}</B>`);

    if (totalItemDiscount > 0) {
      text += this.formatTwoCols48("<B>Item Discounts:</B>", `<B>-${symbol}${totalItemDiscount.toFixed(2)}</B>`);
    }

    if (normalDiscount > 0) {
      const discLabel =
        finalDiscountInfo?.type === "percentage"
          ? `<B>Discount (${finalDiscountInfo.value}%):</B>`
          : "<B>Discount:</B>";
      text += this.formatTwoCols48(discLabel, `<B>-${symbol}${normalDiscount.toFixed(2)}</B>`);
    }

    if (hasAnyDiscount) {
      text += "[L]------------------------------------------------\n";
      const netLabel = "<B>Net Amount:</B>";
      text += this.formatTwoCols48(netLabel, `<B>${symbol}${currentSubtotal.toFixed(2)}</B>`);
    }

    let finalTotal = saleData.total || saleData.totalAmount || currentSubtotal;
    const hasGST = (company.gstPercentage || 0) > 0;
    const gstRate = company.gstPercentage || 0;
    const scPercentage = company.serviceChargePercentage || 0;
    // For reprints, use stored SC amount; otherwise calculate fresh
    const savedSC = saleData.serviceCharge != null ? parseFloat(String(saleData.serviceCharge)) : null;
    
    let serviceChargeAmount = 0;
    if (savedSC !== null) {
      serviceChargeAmount = savedSC;
    } else {
      let scEligibleSubtotal = 0;
      (saleData.items || []).forEach((item: any) => {
        if (item.status === "VOIDED") return;
        const qtyNum = parseInt(String(item.qty || item.quantity || 1)) || 1;
        const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
        const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
        const baseTotal = (item.price || 0) * qtyNum;
        let itemDiscount = 0;
        const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
        const discType = item.discountType || "percentage";
        if (discAmt > 0) {
          if (discType === "percentage") {
            itemDiscount = (discountBasis * (discAmt / 100)) * qtyNum;
          } else {
            itemDiscount = Math.min(discAmt, discountBasis) * qtyNum;
          }
        }
        const itemSubtotal = baseTotal - itemDiscount;
        const isTakeawayItem = item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway;
        const isSC = !isTakeawayItem && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true);
        if (isSC) {
          scEligibleSubtotal += itemSubtotal;
        }
      });
      let scEligibleNet = scEligibleSubtotal;
      if (grossTotal > 0 && orderDiscount > 0) {
        const subtotalPostItemDisc = grossTotal - totalItemDiscount;
        if (subtotalPostItemDisc > 0) {
          const proportion = scEligibleSubtotal / subtotalPostItemDisc;
          scEligibleNet = Math.max(0, scEligibleSubtotal - proportion * orderDiscount);
        }
      }
      serviceChargeAmount = scEligibleNet * (scPercentage / 100);
    }

    const hasSC = serviceChargeAmount > 0;
    const effectiveSCPercentage = serviceChargeAmount > 0 && currentSubtotal > 0
      ? Math.round((serviceChargeAmount / currentSubtotal) * 100)
      : scPercentage;

    const companySettings = useCompanySettingsStore.getState().settings;
    const takeawayRateFromSettings = companySettings?.takeawayCharges || 0;
    let takeawayCharge = saleData.takeawayCharge !== undefined ? parseFloat(String(saleData.takeawayCharge)) : 0;
    
    let firstRate: number | null = null;
    let mixed = false;
    let calculatedTWCharge = 0;
    let takeawayQty = 0;

    (saleData.items || []).forEach((item: any) => {
      const isTW = item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway;
      const isVoided = item.status === "VOIDED" || item.StatusCode === 0;
      if (isTW && !isVoided) {
        const qtyNum = parseInt(String(item.qty || item.quantity || 1)) || 1;
        takeawayQty += qtyNum;

        const dishSpecificTW = Number(item.takeawayCharge ?? item.TakeawayCharge ?? 0);
        const effectiveTWRate = dishSpecificTW > 0 ? dishSpecificTW : takeawayRateFromSettings;
        calculatedTWCharge += qtyNum * effectiveTWRate;

        if (firstRate === null) {
          firstRate = effectiveTWRate;
        } else if (firstRate !== effectiveTWRate) {
          mixed = true;
        }
      }
    });

    if (takeawayQty === 0 && takeawayCharge > 0) {
      const effectiveRate = takeawayRateFromSettings > 0 ? takeawayRateFromSettings : takeawayCharge;
      takeawayQty = Math.round(takeawayCharge / effectiveRate) || 1;
    } else if (takeawayQty > 0 && takeawayCharge === 0) {
      takeawayCharge = calculatedTWCharge > 0 ? calculatedTWCharge : takeawayQty * takeawayRateFromSettings;
    }
    const takeawayRate = takeawayQty > 0 ? (firstRate !== null && !mixed ? firstRate : takeawayCharge / takeawayQty) : takeawayRateFromSettings;
    const taxableAmount = currentSubtotal + serviceChargeAmount + takeawayCharge;
    const gstAmountRaw = hasGST ? taxableAmount * (gstRate / 100) : 0;
    const gstAmount = Math.round(gstAmountRaw * 100) / 100;
    
    // FOC Fix: When FOC is involved, always recompute finalTotal from
    // taxableAmount + GST so payments (FOC + Cash) add up to the displayed total.
    if (finalTotal === 0 || isCheckout || focAmt > 0) {
      finalTotal = taxableAmount + gstAmount;
    }
    
    const printedRoundOff = saleData.roundOff && saleData.roundOff !== 0
      ? parseFloat((finalTotal - (taxableAmount + gstAmount)).toFixed(2))
      : 0;


    if (hasSC) {
      text += this.formatTwoCols48(allItemsHaveSC ? "<B>Service Charge:</B>" : "<B>Item Service Charge:</B>", `<B>${symbol}${serviceChargeAmount.toFixed(2)}</B>`);
    }

    if (takeawayCharge > 0) {
      text += this.formatTwoCols48("<B>Takeaway Charges:</B>", `<B>${symbol}${takeawayCharge.toFixed(2)}</B>`);
    }

    if (hasGST && gstAmount > 0) {
      text += this.formatTwoCols48(`<B>GST (${gstRate}%):</B>`, `<B>${symbol}${gstAmount.toFixed(2)}</B>`);
      text += "[L]------------------------------------------------\n";
    }

    if (printedRoundOff && printedRoundOff !== 0) {
      const roSign = printedRoundOff > 0 ? "+" : "";
      text += this.formatTwoCols48("<B>Round Off:</B>", `<B>${roSign}${symbol}${printedRoundOff.toFixed(2)}</B>`);
      text += "[L]------------------------------------------------\n";
    }

    // Payment Details (only print on settled receipts, hide on checkout bills)
    if (!isCheckout) {
      if (!text.endsWith("[L]------------------------------------------------\n")) {
        text += "[L]------------------------------------------------\n";
      }
      if (saleData.payments && Array.isArray(saleData.payments) && saleData.payments.length > 0) {
        text += "[L]<B>Payment Details:</B>\n";
        saleData.payments.forEach((p: any) => {
          let modeText = String(p.payMode || p.payModeName || p.Remarks || "Payment");
          if (modeText.toUpperCase().trim() === "FOC") modeText = "FOC (Discount)";
          const modeLabel = `  ${modeText}`;
          const amountVal = `${symbol}${parseFloat(p.amount).toFixed(2)}`;
          text += this.formatTwoCols48(`<B>${modeLabel}</B>`, `<B>${amountVal}</B>`);
        });
        text += "[L]------------------------------------------------\n";
      } else {
        let methodText = String(saleData.paymentMethod || "Payment");
        if (methodText.toUpperCase().trim() === "FOC") methodText = "FOC (Discount)";
        const methodLabel = `  ${methodText}`;
        const amountVal = `${symbol}${parseFloat(finalTotal).toFixed(2)}`;
        text += this.formatTwoCols48(`<B>${methodLabel}</B>`, `<B>${amountVal}</B>`);
        text += "[L]------------------------------------------------\n";
      }
    }

    text += `[R]<font size=\'big\'><B>TOTAL: ${symbol}${finalTotal.toFixed(2)}</B></font>\n`;
    text += "[C]================================================\n";

    // Print Reward point transaction stats
    if (parseFloat(saleData.rewardPointsEarned) > 0) {
      text += `[L]<B>Reward Points Earned: +$${parseFloat(saleData.rewardPointsEarned).toFixed(2)}</B>\n`;
    }
    if (parseFloat(saleData.memberRewardBalance) > 0) {
      text += `[L]<B>Available Member Credit: $${parseFloat(saleData.memberRewardBalance).toFixed(2)}</B>\n`;
      text += "[C]------------------------------------------------\n";
    }

    text += "[C]<B>THANK YOU! COME AGAIN!</B>\n";
    text += "[C]SMART-CAFE BY UNIPROSG\n";

    return text.replace(/[\u202F\u00A0\uFEFF]/g, ' ');
  }

  // ==================== PDF FALLBACK WITH DISCOUNT ====================
  static async offerPDFFallback(
    saleData: any,
    userId?: string | number,
    t?: any,
    discountInfo?: DiscountInfo,
  ): Promise<boolean> {
    if (Platform.OS === "web") {
      // âœ… WEB: Fail-proof Iframe printing
      try {
        const company = await BillPDFGenerator.loadSettings(userId);
        const html = await BillPDFGenerator.generateHTML(
          saleData,
          userId,
          discountInfo,
          company,
        );
        const invoiceName = `Invoice_${saleData.invoiceNumber || saleData.id}`;

        // âœ… CRITICAL: Temporarily change main document title for the browser's Save dialog
        const originalTitle = document.title;
        document.title = invoiceName;

        let frame = document.getElementById(
          "print-iframe",
        ) as HTMLIFrameElement;
        if (!frame) {
          frame = document.createElement("iframe");
          frame.id = "print-iframe";
          frame.style.display = "none";
          document.body.appendChild(frame);
        }

        const doc = frame.contentWindow?.document || frame.contentDocument;
        if (doc) {
          doc.open();
          doc.write(html);
          doc.close();

          let printed = false;
          const triggerPrint = () => {
            if (printed) return;
            printed = true;
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
            setTimeout(() => {
              document.title = originalTitle;
            }, 1000);
          };

          // Wait for images to load in the iframe
          frame.contentWindow?.addEventListener("load", triggerPrint);

          // Fallback if load event doesn't fire
          setTimeout(triggerPrint, 1000);
        }
        return true;
      } catch (err) {
        console.error("Web print error:", err);
        return false;
      }
    }

    // Native Silent PDF Fallback without Alert prompt
    try {
      console.log("Generating PDF fallback silently...");
      const company = await BillPDFGenerator.loadSettings(userId);
      const html = await BillPDFGenerator.generateHTML(
        saleData,
        userId,
        discountInfo,
        company,
      );

      if (Platform.OS === "ios") {
        await Print.printAsync({ html });
      } else {
        const { uri } = await Print.printToFileAsync({
          html,
          width: 302, // 80mm at 96dpi
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri);
        }
      }
      return true;
    } catch (error) {
      console.error("PDF Fallback Error:", error);
      return false;
    }
  }

  // ==================== UTILITIES ====================
  private static async checkAndroidPrintService(): Promise<boolean> {
    return Platform.OS === "android";
  }

  static async routeAndPrintOrderKOT(
    orderId: string,
    orderContext: { orderType?: string; tableNo?: string; takeawayNo?: string; section?: string; isQuickServe?: boolean; isQuick?: boolean; isQuickServeMode?: boolean },
    items: any[],
    isAdditional: boolean = false,
    waiterName: string = "Staff",
    skipDuplicateGuard: boolean = false,
    isReprint: boolean = false
  ): Promise<boolean> {
    try {
      // 1. Duplicate-print guard (QR socket path only; cashier path passes skipDuplicateGuard=true)
      if (!isReprint && !skipDuplicateGuard && this.isDuplicatePrint(orderId, items)) {
        return false;
      }

      // 2. Check enableKOT & enableKDS / enableKDSPrint settings
      const { useGeneralSettingsStore } = await import("../stores/generalSettingsStore");
      const { enableKOT, enableKDS, enableKDSPrint, enableComboPrint } = useGeneralSettingsStore.getState().settings;

      const shouldPrintKOT = enableKOT !== false;
      const shouldPrintKDS = enableKDS !== false && enableKDSPrint !== false;

      if (!shouldPrintKOT && !shouldPrintKDS) {
        if (__DEV__) console.log("🖨️ [UniversalPrinter] Both KOT and KDS printing are disabled in General Settings.");
        return false;
      }

      const isTakeaway =
        orderContext.orderType === "TAKEAWAY" ||
        orderContext.tableNo?.toUpperCase?.() === "TAKEAWAY" ||
        orderContext.section?.toUpperCase?.() === "TAKEAWAY" ||
        String(orderContext.tableNo || "").toUpperCase().startsWith("TW");

      let tableNo = "";
      let takeawayNo = orderContext.takeawayNo;
      if (isTakeaway) {
        if (!takeawayNo || String(takeawayNo) === "undefined") {
          takeawayNo = orderId ? String(orderId).slice(-4) : "1";
        }
        tableNo = `TAKEAWAY #${takeawayNo}`;
      } else {
        const cleanT = (orderContext.tableNo || "Table 1").replace(/\s*\(quick serve\)/gi, "").trim();
        const baseTableNo = cleanT.toLowerCase().startsWith("table") ? cleanT : `Table ${cleanT}`;
        const isQS = !!(orderContext.isQuickServe || orderContext.isQuick || orderContext.isQuickServeMode);
        tableNo = isQS ? `${baseTableNo} (QS)` : baseTableNo;
      }

      // 3 & 4 & 5. Print one KOT per kitchen group if KOT printing is enabled
      if (shouldPrintKOT) {
        // Expand combo sub-items that belong to a different kitchen
        const expandedItems: any[] = [];
        items.forEach((item: any) => {
          expandedItems.push(item);
          if (!enableComboPrint && item.comboSelections && item.comboSelections.length > 0) {
            item.comboSelections.forEach((g: any) => {
              if (Array.isArray(g.items)) {
                g.items.forEach((opt: any) => {
                  const optKitchenCode =
                    opt.KitchenTypeCode || opt.kitchenCode || opt.kitchenTypeCode;
                  const parentKitchenCode =
                    item.KitchenTypeCode || item.kitchenCode || item.kitchenTypeCode || "0";
                  if (optKitchenCode && optKitchenCode !== parentKitchenCode) {
                    expandedItems.push({
                      ...opt,
                      id: opt.dishId,
                      qty: item.quantity || item.qty || 1,
                      price: 0,
                      name: `${opt.name} (Combo: ${item.name})`,
                      KitchenTypeCode: optKitchenCode,
                      KitchenTypeName: opt.KitchenTypeName || opt.kitchenTypeName,
                      PrinterIP: opt.PrinterIP || opt.printerIp,
                    });
                  }
                });
              }
            });
          }
        });

        // Group by KitchenTypeCode → one KOT per kitchen
        const kitchenGroups: Record<string, any[]> = {};
        expandedItems.forEach((item: any) => {
          const kCode = item.KitchenTypeCode || "0";
          if (!kitchenGroups[kCode]) kitchenGroups[kCode] = [];
          kitchenGroups[kCode].push(item);
        });

        for (const [kCode, groupItems] of Object.entries(kitchenGroups)) {
          const printerIp = groupItems[0].PrinterIP || groupItems[0].printerIp;
          const kotData = {
            orderId,
            orderNo: orderId,
            tableNo,
            takeawayNo,
            orderType: isTakeaway ? "TAKEAWAY" : "DINE_IN",
            isTakeaway,
            waiterName,
            isQuickServe: !!(orderContext.isQuickServe || orderContext.isQuick || orderContext.isQuickServeMode),
            items: groupItems,
            kitchenCode: kCode,
            kitchenName:
              groupItems[0].KitchenTypeName || (kCode === "0" ? "KITCHEN" : kCode),
            disableComboPrint: false,
          };
          try {
            console.log(`🖨️ [UniversalPrinter] Printing KOT for kitchen ${kotData.kitchenName} to ${printerIp}`);
            await this.printKOT(
              kotData,
              "SYSTEM",
              isReprint ? "REPRINT" : (isAdditional ? "ADDITIONAL" : "NEW"),
              printerIp
            );
          } catch (grpErr: any) {
            console.error(`❌ [UniversalPrinter] KOT print failed for kitchen group ${kCode} (${kotData.kitchenName}):`, grpErr.message);
          }
        }
      } else {
        if (__DEV__) console.log("🖨️ [UniversalPrinter] KOT printing is disabled in General Settings.");
      }

      // 6. KDS backup copy (respects enableKDSPrint setting)
      if (shouldPrintKDS) {
        try {
          let kdsPrinterIp = "";
          try {
            let printers = this.cachedPrinters;
            if (!printers) {
              const res = await fetch(`${API_URL}/api/settings/kitchen-printers`);
              printers = await res.json();
              this.cachedPrinters = printers;
            }
            if (Array.isArray(printers)) {
              const kdsPrinter = printers.find((p: any) => p.PrinterType === 4 || (p.KitchenName && p.KitchenName.toUpperCase() === "KDS"));
              kdsPrinterIp = kdsPrinter?.PrinterPath || kdsPrinter?.PrinterIP || "";
            }
          } catch (e) {}

          const kdsData = {
            orderId,
            orderNo: orderId,
            tableNo,
            takeawayNo,
            orderType: isTakeaway ? "TAKEAWAY" : "DINE_IN",
            isTakeaway,
            waiterName,
            isQuickServe: !!(orderContext.isQuickServe || orderContext.isQuick || orderContext.isQuickServeMode),
            items,
            kitchenName: "KDS",
          };
          console.log(`🖨️ [UniversalPrinter] Printing KDS order (Printer IP: ${kdsPrinterIp || "default"})`);
          await this.printKDSOrder(kdsData, "SYSTEM", kdsPrinterIp);
        } catch (kdsErr) {
          console.error("[UniversalPrinter] KDS backup print failed:", kdsErr);
        }
      }

      return true;
    } catch (err) {
      console.error("[UniversalPrinter] routeAndPrintOrderKOT error:", err);
      return false;
    }
  }

  static async printReceiptAuto(settlementData: any): Promise<boolean> {
    try {
      // Check General Settings: Print Receipt
      const { useGeneralSettingsStore } = await import("../stores/generalSettingsStore");
      const { enableReceiptPrint } = useGeneralSettingsStore.getState().settings;
      if (enableReceiptPrint === false) {
        if (__DEV__) console.log("🧾 [UniversalPrinter] Automatic receipt printing is disabled in General Settings.");
        return false;
      }

      const header = settlementData?.header || {};
      const orderId = header.OrderId || header.SettlementID || "";
      if (orderId && this.isDuplicateReceiptPrint(orderId)) {
        return false;
      }

      const items = settlementData?.items || [];
      const payments = settlementData?.payments || [];

      const isPercentage = header.DiscountType === "percentage";
      const discountValue = isPercentage
        ? Number(header.DiscountPercentage ?? 0)
        : Number(header.DiscountAmount ?? 0);

      const discountInfo: DiscountInfo = {
        applied: Number(header.DiscountAmount ?? 0) > 0,
        type: (header.DiscountType || "fixed") as "fixed" | "percentage",
        value: discountValue,
        amount: Number(header.DiscountAmount ?? 0),
      };

      const saleData = {
        invoiceNumber: header.BillNo || header.SettlementID,
        tableNo: header.TableNo || "TAKEAWAY",
        total: Number(header.SysAmount ?? 0),
        paymentMethod: header.PayMode || "CASH",
        cashPaid: Number(header.SysAmount ?? 0),
        change: 0,
        items: items.map((i: any) => ({
          name: i.DishName || i.Description,
          price: Number(i.Price || i.PricePerUnit || 0),
          qty: Number(i.Qty || i.Quantity || 1),
          status: i.Status || "NORMAL",
          discountAmount: Number(i.DiscountAmount || 0),
          discountType: i.DiscountType || "fixed",
          modifiers: i.modifiers || [],
        })),
        payments: payments.map((p: any) => ({
          payMode: p.PayModeName || p.Remarks || "CASH",
          payModeName: p.PayModeName || p.Remarks || "CASH",
          amount: Number(p.Amount ?? 0),
          referenceNo: p.ReferenceNo || ""
        })),
        roundOff: Number(header.RoundedBy ?? 0),
        date: header.SettlementDate || header.LastSettlementDate || new Date(),
        originalDate: header.SettlementDate || header.LastSettlementDate || null,
        discountAmount: Number(header.DiscountAmount ?? 0),
        discountType: header.DiscountType || null,
        discountValue: discountValue,
        subTotal: Number(header.SubTotal ?? 0),
        serviceCharge: Number(header.ServiceCharge ?? 0),
        takeawayCharge: Number(header.TakeawayCharge ?? 0),
      };

      return await this.smartPrint(saleData, "1", {}, discountInfo);
    } catch (err) {
      console.error("[UniversalPrinter] printReceiptAuto failed:", err);
      return false;
    }
  }

  static async processPendingPrintJobs(): Promise<void> {
    // Web clients must never pull and process the print job queue.
    // The print queue is meant for native apps or a desktop print bridge daemon.
    if ((Platform.OS as string) === "web") return;

    try {
      const { useAuthStore } = require("../stores/authStore");
      const role = useAuthStore.getState().user?.role;
      const allowedRoles = ["ADMIN", "MANAGER", "CASHIER", "SUPERVISOR"];
      if (role && !allowedRoles.includes(role)) {
        return; // Only ADMIN, MANAGER, CASHIER, SUPERVISOR devices process the print queue
      }
    } catch (authErr) {
      console.warn("[UniversalPrinter] Could not check auth state for print queue:", authErr);
    }


    try {
      const storeId = "STORE_001";
      const headers = {
        "Authorization": "Bearer unipro-pos-bridge-token-2026",
        "x-store-id": storeId,
        "Content-Type": "application/json"
      };

      // 1. Fetch pending print jobs from backend
      const response = await fetch(`${API_URL}/api/print-jobs/pending`, {
        method: "GET",
        headers
      });
      const data = await response.json();
      if (!data.success || !Array.isArray(data.data)) {
        return;
      }

      const jobs = data.data;
      if (jobs.length === 0) return;

      // Group jobs by target Printer IP to process different printers in parallel
      const jobsByPrinter = new Map<string, any[]>();
      for (const job of jobs) {
        const printerKey = `${job.PrinterIp || ""}:${job.PrinterPort || 9100}`;
        if (!jobsByPrinter.has(printerKey)) {
          jobsByPrinter.set(printerKey, []);
        }
        jobsByPrinter.get(printerKey)!.push(job);
      }

      // Process each printer's queue sequentially, but run different printers in parallel
      const printerPromises = Array.from(jobsByPrinter.values()).map(async (printerJobs) => {
        for (const job of printerJobs) {
          const { JobId, PrinterIp, PrinterPort, Content } = job;
          if (!Content || !PrinterIp) {
            await fetch(`${API_URL}/api/print-jobs/${JobId}/failed`, {
              method: "POST",
              headers,
              body: JSON.stringify({ errorMessage: "Missing Printer IP or Content" })
            });
            continue;
          }

          try {
            const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(PrinterIp.trim());
            let printSuccess = false;

            if ((Platform.OS as string) === "web") {
              // Web fallback: cashier web client shouldn't process directly if daemon is used.
              // For now, let the desktop print bridge process it.
              continue;
            }

            console.log(`[PrintQueue] Printer connection started: PrinterIp=${PrinterIp}, Port=${PrinterPort || 9100}, JobId=${JobId}`);

            if (isIp) {
              console.log(`ðŸŒ [UniversalPrinter] WiFi print to: ${PrinterIp}`);
              const printPromise = ThermalPrinter.printTcp({
                ip: PrinterIp,
                port: PrinterPort || 9100,
                payload: Content,
                mmFeedPaper: 25,
              });
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Connection to printer timed out")), 15000)
              );
              await Promise.race([printPromise, timeoutPromise]);
              printSuccess = true;
            } else {
              console.log(`ðŸ”µ [UniversalPrinter] Bluetooth print to: ${PrinterIp}`);
              const printPromise = ThermalPrinter.printBluetooth({
                macAddress: PrinterIp,
                payload: Content,
                mmFeedPaper: 25,
              });
              const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Connection to printer timed out")), 15000)
              );
              await Promise.race([printPromise, timeoutPromise]);
              printSuccess = true;
            }

            if (printSuccess) {
              console.log(`[PrintQueue] Print successful: JobId=${JobId}`);
              await fetch(`${API_URL}/api/print-jobs/${JobId}/complete`, {
                method: "POST",
                headers
              });
              console.log(`âœ… [UniversalPrinter] Print job ${JobId} completed successfully`);
            }
          } catch (printErr: any) {
            const errorMsg = printErr.message || "Hardware print error";
            console.log(`[PrintQueue] Printer connection failed: ${errorMsg}. JobId=${JobId}`);
            console.error(`âŒ [UniversalPrinter] Failed to print job ${JobId}:`, printErr);
            // If it's a network timeout/connection error, release the job back to queue so other local devices can print it
            const isTimeoutOrNetworkError = 
              errorMsg.toLowerCase().includes("timeout") || 
              errorMsg.toLowerCase().includes("connect") || 
              errorMsg.toLowerCase().includes("unreachable") ||
              errorMsg.toLowerCase().includes("host");

            const endpoint = isTimeoutOrNetworkError
              ? `${API_URL}/api/print-jobs/${JobId}/release`
              : `${API_URL}/api/print-jobs/${JobId}/failed`;

            await fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({ errorMessage: errorMsg })
            });
          }
          // Delay for 1 second between consecutive jobs to the same printer to clear the TCP socket
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      });

      await Promise.all(printerPromises);

    } catch (err: any) {
      console.error("[UniversalPrinter] processPendingPrintJobs error:", err.message);
    }
  }

  /**
   * Converts a QR URL into a raw ESC/POS binary buffer (base64-encoded).
   * Downloads the QR as a PNG from qrserver.com, converts to monochrome bitmap,
   * and wraps it in ESC/POS GS v 0 (raster bit image) commands.
   * The print bridge detects base64 content and bypasses tag parsing.
   */
  private static async buildQREscPosBase64(
    tableLabel: string,
    sectionName: string,
    qrUrl: string
  ): Promise<string | null> {
    try {
      // Text helper: encode UTF-8 string to bytes
      const enc = (s: string) => Array.from(new TextEncoder().encode(s));

      // ESC/POS command bytes
      const ESC = 0x1B;
      const GS = 0x1D;
      const LF = 0x0A;

      const alignCenter = [ESC, 0x61, 0x01];
      const alignLeft   = [ESC, 0x61, 0x00];
      const boldOn      = [ESC, 0x45, 0x01];
      const boldOff     = [ESC, 0x45, 0x00];
      const dblSize     = [GS,  0x21, 0x11]; // double width + height
      const normalSize  = [GS,  0x21, 0x00];
      const cut         = [GS,  0x56, 0x42, 0x00];

      // ── Download QR image (350x350 px PNG) ──────────────────────────
      const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qrUrl)}&format=png&margin=5`;
      const imgRes = await fetch(qrImgUrl);
      if (!imgRes.ok) throw new Error("QR image download failed");
      const imgBlob = await imgRes.blob();

      // Decode the PNG to raw pixel data via OffscreenCanvas (web only)
      const imgBitmap = await createImageBitmap(imgBlob);
      const W = imgBitmap.width;
      const H = imgBitmap.height;
      const canvas = new OffscreenCanvas(W, H);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(imgBitmap, 0, 0);
      const { data: pixels } = ctx.getImageData(0, 0, W, H); // RGBA flat array

      // Convert to 1-bit monochrome raster (1 = black, 0 = white)
      // ESC/POS GS v 0: each byte holds 8 horizontal pixels, MSB first
      const bytesPerRow = Math.ceil(W / 8);
      const rasterBytes: number[] = [];
      for (let row = 0; row < H; row++) {
        for (let byteIdx = 0; byteIdx < bytesPerRow; byteIdx++) {
          let byte = 0;
          for (let bit = 0; bit < 8; bit++) {
            const col = byteIdx * 8 + bit;
            if (col < W) {
              const px = (row * W + col) * 4;
              // Luminance threshold: pixel is "black" if it's dark enough
              const lum = 0.299 * pixels[px] + 0.587 * pixels[px + 1] + 0.114 * pixels[px + 2];
              if (lum < 128) byte |= (0x80 >> bit);
            }
          }
          rasterBytes.push(byte);
        }
      }

      // GS v 0: [GS 0x76 0x30 m xL xH yL yH d1...dk]
      //   m=0 (normal), xL/xH = bytes per row (little-endian), yL/yH = rows
      const xL = bytesPerRow & 0xFF;
      const xH = (bytesPerRow >> 8) & 0xFF;
      const yL = H & 0xFF;
      const yH = (H >> 8) & 0xFF;
      const gsv0Header = [GS, 0x76, 0x30, 0x00, xL, xH, yL, yH];

      // ── Assemble full ESC/POS payload ────────────────────────────────
      const parts: number[][] = [
        [LF],
        alignCenter,
        enc("================================\n"),
        alignCenter, boldOn, dblSize,
        enc(`TABLE QR CODE\n`),
        normalSize, boldOff,
        alignCenter,
        enc("================================\n"),
        [LF],
        alignCenter, boldOn, dblSize,
        enc(`Table ${tableLabel}\n`),
        normalSize, boldOff,
        alignCenter,
        enc(`${sectionName}\n`),
        [LF],
        // QR bitmap
        alignCenter,
        gsv0Header,
        rasterBytes,
        [LF, LF],
        alignCenter, boldOn,
        enc(`Scan to Order\n`),
        boldOff,
        alignCenter,
        enc("================================\n"),
        [LF, LF, LF],
        cut,
      ];

      const allBytes = parts.reduce<number[]>((acc, arr) => acc.concat(arr), []);
      const buf = new Uint8Array(allBytes);
      // Base64-encode
      let binary = "";
      buf.forEach((b) => (binary += String.fromCharCode(b)));
      return btoa(binary);
    } catch (err) {
      console.warn("[printQRDirect] ESC/POS QR bitmap build failed:", err);
      return null;
    }
  }

  static async printQRDirect(
    tableLabel: string,
    sectionName: string,
    qrUrl: string,
    outletId?: string | number
  ): Promise<boolean> {
    // Fallback text-only payload (used if image conversion fails or for BT/LAN path)
    const payload = `\n[C]================================================\n[C]<font size='big'><B>TABLE QR CODE</B></font>\n[C]================================================\n[C]<font size='big'><B>Table ${tableLabel}</B></font>\n[C]${sectionName}\n[C]\n[C]<qrcode size='22'>${qrUrl}</qrcode>\n[C]\n[C]<font size='normal'><B>Scan to Order</B></font>\n[C]================================================\n\n\n\n`;

    if (Platform.OS === "web") {
      try {
        const isOnline = await this.isBridgeOnline();
        if (!isOnline) return false;

        // âœ… Build proper ESC/POS binary with QR bitmap â€” the bridge sends it raw
        // bypassing parseFormatting() which doesn't understand <qrcode> tags
        const escPosBase64 = await this.buildQREscPosBase64(tableLabel, sectionName, qrUrl);
        if (escPosBase64) {
          return await this.queuePrintJob(1, undefined, escPosBase64);
        }

        // Fallback: send text payload (QR won't be a real barcode image)
        console.warn("[printQRDirect] Falling back to text payload â€” QR image will not print correctly");
        return await this.queuePrintJob(1, undefined, payload);
      } catch {
        return false;
      }
    }

    // Native/Mobile (Android APK/iOS)
    try {
      // âœ… QR Fix: Always try Sunmi native SDK first on Android.
      // The XML <qrcode> payload is only understood by react-native-thermal-printer,
      // NOT by the Sunmi built-in printer â€” sending it there prints raw text.
      if (Platform.OS === "android") {
        try {
          const sunmiPrinted = await SunmiPrinterService.printQR(qrUrl, tableLabel, sectionName);
          if (sunmiPrinted) {
            console.log("âœ… QR printed via Sunmi built-in printer (native SDK)");
            return true;
          }
        } catch (sunmiErr) {
          console.warn("Sunmi QR print failed, trying LAN/BT fallback:", sunmiErr);
        }
      }

      // Fallback: Try configured LAN/Bluetooth printer with ESCPOS XML payload
      const company = await BillPDFGenerator.loadSettings(outletId);
      let cashierIp = "";
      try {
        const response = await fetch(`${API_URL}/api/settings/kitchen-printers`);
        const printers = await response.json();
        if (Array.isArray(printers)) {
          const cashierPrinter = printers.find((p) => p.PrinterType === 1);
          cashierIp = cashierPrinter?.PrinterPath || "";
        }
      } catch (err) {
        console.warn("Failed to fetch printer IPs from PrintMaster:", err);
      }

      const targetIp = cashierIp || company.printerIp || "";

      if (!targetIp || targetIp.trim().length === 0) {
        console.warn("No LAN/BT printer IP configured and Sunmi SDK unavailable.");
        return false;
      }

      const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(targetIp.trim());
      if (isIp) {
        await ThermalPrinter.printTcp({
          ip: targetIp.trim(),
          port: 9100,
          payload,
          mmFeedPaper: 25,
        });
      } else {
        await ThermalPrinter.printBluetooth({
          macAddress: targetIp.trim(),
          payload,
          mmFeedPaper: 25,
        });
      }
      return true;
    } catch (e) {
      console.warn("Native printQRDirect failed:", e);
      return false;
    }
  }

  // ==================== SETTLEMENT REPORT HTML ====================
  static generateSettlementReportHTML(settlementRows: any[], company: any, period?: string): string {
    const symbol = company.currencySymbol || "$";
    const now = new Date();
    const printDate = (now.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })).replace(/[\u202F\u00A0\uFEFF]/g, ' ');

    // Aggregate totals by payment mode
    const paymentTotals: Record<string, number> = {};
    let grandTotal = 0;
    let totalOrders = 0;
    const orderSet = new Set<string>();
    settlementRows.forEach((row: any) => {
      const sId = row.SettlementID || row.settlementId || "";
      if (sId && !orderSet.has(sId)) {
        orderSet.add(sId);
        totalOrders++;
      }
      const mode = String(row.PayMode || row.PayModeName || row.payMode || "CASH").trim().toUpperCase();
      const amt = Number(row.Amount || row.SysAmount || 0);
      paymentTotals[mode] = (paymentTotals[mode] || 0) + amt;
      if (mode !== "FOC") {
        grandTotal += amt;
      }
    });

    const paymentRows = Object.entries(paymentTotals)
      .map(([mode, amt]) => `<tr><td>${mode}</td><td class="amount">${symbol}${(amt as number).toFixed(2)}</td></tr>`)
      .join("");

    return `<!DOCTYPE html><html><head><style>
      body { font-family: monospace; padding: 20px; max-width: 800px; margin: 0 auto; }
      .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
      .company-name { font-size: 22px; font-weight: bold; }
      .report-title { font-size: 18px; font-weight: bold; margin: 10px 0; }
      .section-title { font-size: 14px; font-weight: bold; margin: 12px 0 6px; background: #f0f0f0; padding: 4px 6px; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0; }
      th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #ddd; }
      .amount { text-align: right; font-weight: bold; }
      .grand-total { font-size: 16px; font-weight: bold; border-top: 2px solid #000; padding-top: 8px; }
      .footer { margin-top: 20px; text-align: center; font-size: 11px; border-top: 1px solid #ddd; padding-top: 8px; }
      .summary-grid { display: flex; gap: 12px; margin: 10px 0; }
      .summary-box { flex: 1; padding: 8px; background: #f9f9f9; text-align: center; border-radius: 4px; }
    </style></head><body>
      <div class="header">
        <div class="company-name">${company.name || "POS SYSTEM"}</div>
        <div>${company.address || ""}</div>
        ${company.gstNo ? `<div>GST: ${company.gstNo}</div>` : ""}
        <div class="report-title">SETTLEMENT REPORT</div>
        <div>${period || "Current Period"}</div>
        <div>Printed: ${printDate}</div>
      </div>
      <div class="summary-grid">
        <div class="summary-box"><div>Total Orders</div><div style="font-size:20px;font-weight:bold">${totalOrders}</div></div>
        <div class="summary-box"><div>Grand Total</div><div style="font-size:20px;font-weight:bold">${symbol}${grandTotal.toFixed(2)}</div></div>
      </div>
      <div class="section-title">💳 PAYMENT MODE BREAKDOWN</div>
      <table><thead><tr><th>Payment Mode</th><th class="amount">Amount</th></tr></thead><tbody>${paymentRows}</tbody>
        <tfoot><tr class="grand-total"><td>GRAND TOTAL</td><td class="amount">${symbol}${grandTotal.toFixed(2)}</td></tr></tfoot>
      </table>
      <div class="footer"><p>© ${new Date().getFullYear()} UNIPRO SOFTWARES SG PTE LTD</p></div>
    </body></html>`;
  }
  
  static async printSettlementReportDirect(
    settlementRows: any[],
    company: any,
    period: string
  ): Promise<boolean> {
    try {
      const symbol = company.currencySymbol || "$";
      const now = new Date();
      const printDate = (now.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })).replace(/[\u202F\u00A0\uFEFF]/g, ' ');

      // Aggregate totals by payment mode
      const paymentTotals: Record<string, number> = {};
      let grandTotal = 0;
      let totalOrders = 0;
      const orderSet = new Set<string>();
      settlementRows.forEach((row: any) => {
        const sId = row.SettlementID || row.settlementId || "";
        if (sId && !orderSet.has(sId)) {
          orderSet.add(sId);
          totalOrders++;
        }
        const mode = String(row.PayMode || row.PayModeName || row.payMode || "CASH").trim().toUpperCase();
        const amt = Number(row.Amount || row.SysAmount || 0);
        paymentTotals[mode] = (paymentTotals[mode] || 0) + amt;
        if (mode !== "FOC") {
          grandTotal += amt;
        }
      });

      let text = "";
      text += "\n[C]================================================\n";
      text += `[C]<font size='big'><B>${company.name || "POS SYSTEM"}</B></font>\n`;
      if (company.address) {
        text += `[C]${company.address.split("\n")[0]}\n`;
      }
      text += "[C]================================================\n";
      text += "[C]<font size='big'><B>SETTLEMENT REPORT</B></font>\n";
      text += `[C]${period}\n`;
      text += `[C]Printed: ${printDate}\n`;
      text += "------------------------------------------------\n";
      text += `[L]Total Orders: ${totalOrders}\n`;
      text += `[L]Grand Total: ${symbol}${grandTotal.toFixed(2)}\n`;
      text += "------------------------------------------------\n";
      text += "[C]💳 PAYMENT MODE BREAKDOWN\n";
      text += "------------------------------------------------\n";
      for (const [mode, amt] of Object.entries(paymentTotals)) {
        text += `[L]${mode.padEnd(20, " ")}: ${symbol}${amt.toFixed(2)}\n`;
      }
      text += "------------------------------------------------\n";
      text += `[C]<font size='big'><B>TOTAL: ${symbol}${grandTotal.toFixed(2)}</B></font>\n`;
      text += "================================================\n\n\n\n";

      if (Platform.OS === "web") {
        try {
          let cashierIp = company.cashierPrinterIp || company.printerIp || "";
          try {
            let printers = this.cachedPrinters;
            if (!printers) {
              const res = await fetch(`${API_URL}/api/settings/kitchen-printers`);
              printers = await res.json();
              this.cachedPrinters = printers;
            }
            if (Array.isArray(printers)) {
              const cashierPrinter = printers.find((p: any) => p.PrinterType === 1);
              cashierIp = cashierPrinter?.PrinterPath || cashierPrinter?.PrinterIP || cashierIp;
            }
          } catch (e) {}

          console.log(`📡 [Web Print Bridge] Queueing settlement report (Target IP: ${cashierIp || "default"})`);
          const success = await this.queuePrintJob(1, undefined, text, true, cashierIp);
          if (success) return true;
        } catch (err) {
          console.warn("Print Bridge failed for Z-Report:", err);
        }
        return false;
      }

      // Native Bluetooth/WiFi fallback
      try {
        let targetIp = company.printerIp || "";
        if (!targetIp) return false;
        const isIp = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(targetIp.trim());
        if (isIp) {
          await ThermalPrinter.printTcp({
            ip: targetIp.trim(),
            port: 9100,
            payload: text,
            mmFeedPaper: 25,
          });
        } else {
          await ThermalPrinter.printBluetooth({
            macAddress: targetIp.trim(),
            payload: text,
            mmFeedPaper: 25,
          });
        }
        return true;
      } catch (e) {
        console.warn("Native printSettlementReportDirect failed:", e);
        return false;
      }
    } catch (err) {
      console.error("printSettlementReportDirect error:", err);
      return false;
    }
  }

  static async testAllPrinters(): Promise<void> {
    const printers = await this.detectAllPrinters();
    let message = `ðŸ“‹ Found ${printers.length} printer(s):\n\n`;
    printers.forEach((p, i) => {
      message += `${i + 1}. ${p.name}\n   Type: ${p.type}\n   Paper: ${p.paperSize || "Unknown"}\n   Default: ${p.isDefault ? "âœ…" : "âŒ"}\n\n`;
    });
    Alert.alert("Printer Detection", message);
  }
}

export default UniversalPrinter;
