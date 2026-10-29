// components/SunmiPrinterService.ts - AUTOMATIC 58MM/80MM DETECTOR AND FORMATTER
import { Platform, NativeModules } from "react-native";
import { API_URL } from "../constants/Config";
import { formatToSingaporeDate, formatToSingaporeTime, parseDatabaseDate } from "../utils/timezoneHelper";
import { useCompanySettingsStore } from "../stores/companySettingsStore";

const { SunmiPrinterDetector } = NativeModules;

// ✅ Guarded imports for native module to prevent crashes on non-Android platforms
let SunmiModule: any = null;
if (Platform.OS === "android") {
  try {
    SunmiModule = require("sunmi-printer-expo");
  } catch (e) {
    console.log("Sunmi module load failed:", e);
  }
}

// ─── CLEAN ARCHITECTURE FORMATTERS ───

export interface PrintFormatter {
  getLineWidth(): number;
  center(text: any): string;
  left(text: any): string;
  divider(char?: string): string;
  doubleDivider(char?: string): string;
  twoCols(left: any, right: any): string;
  itemRow(name: any, qty: any, price: any, total: any): string;
  itemHeader(): string;
}

export class PrintFormatter58mm implements PrintFormatter {
  getLineWidth(): number {
    return 32;
  }

  center(text: any): string {
    const maxWidth = 32;
    let displayText = String(text || "");
    if (displayText.length > maxWidth) {
      displayText = displayText.substring(0, maxWidth - 3) + "...";
    }
    const padding = Math.max(0, Math.floor((maxWidth - displayText.length) / 2));
    return " ".repeat(padding) + displayText + "\n";
  }

  left(text: any): string {
    return String(text || "") + "\n";
  }

  divider(char: string = "-"): string {
    return char.repeat(32) + "\n";
  }

  doubleDivider(char: string = "="): string {
    return char.repeat(32) + "\n";
  }

  twoCols(left: any, right: any): string {
    const cleanLeft = String(left || "");
    const cleanRight = String(right || "");
    const totalWidth = 32;
    const spaceCount = totalWidth - cleanLeft.length - cleanRight.length;
    if (spaceCount > 0) {
      return cleanLeft + " ".repeat(spaceCount) + cleanRight + "\n";
    } else {
      return cleanLeft + "\n" + cleanRight.padStart(totalWidth, " ") + "\n";
    }
  }

  itemRow(name: any, qty: any, price: any, total: any): string {
    const cleanName = String(name || "");
    const cleanQty = String(qty || "");
    const cleanPrice = String(price || "");
    const cleanTotal = String(total || "");

    const nameWidth = 12;
    const qtyWidth = 3;
    const priceWidth = 7;
    const totalWidth = 10;

    let line = cleanName.substring(0, nameWidth).padEnd(nameWidth, " ");
    line += cleanQty.padStart(qtyWidth, " ");
    line += cleanPrice.padStart(priceWidth, " ");
    line += cleanTotal.padStart(totalWidth, " ");
    return line + "\n";
  }

  itemHeader(): string {
    let line = "ITEM".padEnd(12, " ");
    line += "QTY".padStart(3, " ");
    line += "PRICE".padStart(7, " ");
    line += "TOTAL".padStart(10, " ");
    return line + "\n";
  }
}

export class PrintFormatter80mm implements PrintFormatter {
  getLineWidth(): number {
    return 48;
  }

  center(text: any): string {
    const maxWidth = 48;
    let displayText = String(text || "");
    if (displayText.length > maxWidth) {
      displayText = displayText.substring(0, maxWidth - 3) + "...";
    }
    const padding = Math.max(0, Math.floor((maxWidth - displayText.length) / 2));
    return " ".repeat(padding) + displayText + "\n";
  }

  left(text: any): string {
    return String(text || "") + "\n";
  }

  divider(char: string = "-"): string {
    return char.repeat(48) + "\n";
  }

  doubleDivider(char: string = "="): string {
    return char.repeat(48) + "\n";
  }

  twoCols(left: any, right: any): string {
    const cleanLeft = String(left || "");
    const cleanRight = String(right || "");
    const totalWidth = 48;
    const spaceCount = totalWidth - cleanLeft.length - cleanRight.length;
    if (spaceCount > 0) {
      return cleanLeft + " ".repeat(spaceCount) + cleanRight + "\n";
    } else {
      return cleanLeft + "\n" + cleanRight.padStart(totalWidth, " ") + "\n";
    }
  }

  itemRow(name: any, qty: any, price: any, total: any): string {
    const cleanName = String(name || "");
    const cleanQty = String(qty || "");
    const cleanPrice = String(price || "");
    const cleanTotal = String(total || "");

    const nameWidth = 24;
    const qtyWidth = 4;
    const priceWidth = 10;
    const totalWidth = 10;

    let line = cleanName.substring(0, nameWidth).padEnd(nameWidth, " ");
    line += cleanQty.padStart(qtyWidth, " ");
    line += cleanPrice.padStart(priceWidth, " ");
    line += cleanTotal.padStart(totalWidth, " ");
    return line + "\n";
  }

  itemHeader(): string {
    let line = "ITEM".padEnd(24, " ");
    line += "QTY".padStart(4, " ");
    line += "PRICE".padStart(10, " ");
    line += "TOTAL".padStart(10, " ");
    return line + "\n";
  }
}

// ─── PRINTER MANAGER & CAPABILITY DETECTOR ───

export class SunmiPrinterManager {
  private static paperSize: "58mm" | "80mm" = "58mm";
  private static formatter: PrintFormatter = new PrintFormatter58mm();
  private static isInitialized = false;

  static async init(): Promise<void> {
    if (this.isInitialized) return;
    
    console.log("🖨️ [SunmiPrinterManager] Detected Sunmi printer");
    try {
      const model = ((Platform.constants as any).Model || '').toUpperCase();
      console.log(`🖨️ [SunmiPrinterManager] Device Model: ${model}`);
      if (model.includes("D3")) {
        this.paperSize = "80mm";
      } else if (model.includes("T2")) {
        this.paperSize = "58mm";
      } else if (Platform.OS === "android" && SunmiPrinterDetector) {
        // Fallback to native capabilities detector if model is ambiguous
        const size = await SunmiPrinterDetector.getPrinterPaperSize();
        this.paperSize = size === "80mm" ? "80mm" : "58mm";
      } else {
        // Default fallback prioritizes 80mm
        this.paperSize = "80mm";
      }
    } catch (e) {
      console.warn("🖨️ [SunmiPrinterManager] Size detection failed, falling back to 80mm", e);
      this.paperSize = "80mm";
    }

    if (this.paperSize === "80mm") {
      console.log("🖨️ [SunmiPrinterManager] Selected print template: PrintFormatter80mm");
      this.formatter = new PrintFormatter80mm();
    } else {
      console.log("🖨️ [SunmiPrinterManager] Selected print template: PrintFormatter58mm");
      this.formatter = new PrintFormatter58mm();
    }
    this.isInitialized = true;
  }

  static getFormatter(): PrintFormatter {
    return this.formatter;
  }

  static getPaperSize(): "58mm" | "80mm" {
    return this.paperSize;
  }
}

class SunmiPrinterService {
  static async init(): Promise<boolean> {
    if (Platform.OS !== "android") {
      console.log("Not Android - cannot use Sunmi printer");
      return false;
    }

    try {
      if (!SunmiModule) return false;
      await SunmiModule.initPrinter();
      await SunmiPrinterManager.init();
      console.log("✅ Sunmi printer initialized");
      return true;
    } catch (error) {
      console.log("❌ Printer init failed:", error);
      return false;
    }
  }

  private static async urlToBase64(url: string): Promise<string> {
    console.log("🔄 Converting URL to Base64 (Robust):", url);
    try {
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        const FileSystem = require('expo-file-system');
        const filename = 'temp_logo_sunmi_' + Date.now() + '.png';
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
    } catch (err) {
      console.warn("⚠️ FileSystem Base64 conversion failed, trying fallback fetch:", err);
    }

    const response = await fetch(url);
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        let base64 = reader.result as string;
        if (base64.includes(",")) {
          base64 = base64.split(",")[1];
        }
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private static async printLogos(companySettings: any): Promise<void> {
    const hasCompanyLogo = companySettings.showCompanyLogo && companySettings.companyLogo;
    const hasHalalLogo = companySettings.showHalalLogo && companySettings.halalLogo;

    if (hasCompanyLogo) {
      try {
        let logoUrl = companySettings.companyLogo;
        if (logoUrl && !logoUrl.startsWith("http")) {
          logoUrl = logoUrl.startsWith("/") ? `${API_URL}${logoUrl}` : `${API_URL}/${logoUrl}`;
        }
        const base64Image = await this.urlToBase64(logoUrl);
        await SunmiModule.printImageBase64(base64Image);
        await SunmiModule.lineWrap(1);
        console.log("✅ Company logo printed");
      } catch (e) {
        console.log("❌ Company logo failed:", e);
        try {
          let prodUrl = companySettings.companyLogo;
          if (prodUrl && !prodUrl.startsWith("http")) {
            prodUrl = prodUrl.startsWith("/") ? `${API_URL}${prodUrl}` : `${API_URL}/${prodUrl}`;
            const base64Image = await this.urlToBase64(prodUrl);
            await SunmiModule.printImageBase64(base64Image);
            await SunmiModule.lineWrap(1);
          }
        } catch (e2) {}
      }
    }

    if (hasHalalLogo) {
      try {
        let halalUrl = companySettings.halalLogo;
        if (halalUrl && !halalUrl.startsWith("http")) {
          halalUrl = halalUrl.startsWith("/") ? `${API_URL}${halalUrl}` : `${API_URL}/${halalUrl}`;
        }
        const base64Image = await this.urlToBase64(halalUrl);
        await SunmiModule.printImageBase64(base64Image);
        await SunmiModule.lineWrap(1);
        console.log("✅ Halal logo printed");
      } catch (e) {
        console.log("❌ Halal logo failed:", e);
        try {
          let prodUrl = companySettings.halalLogo;
          if (prodUrl && !prodUrl.startsWith("http")) {
            prodUrl = prodUrl.startsWith("/") ? `${API_URL}${prodUrl}` : `${API_URL}/${prodUrl}`;
            const base64Image = await this.urlToBase64(prodUrl);
            await SunmiModule.printImageBase64(base64Image);
            await SunmiModule.lineWrap(1);
          }
        } catch (e2) {}
      }
    }
  }

  static async printReceipt(saleData: any, companySettings: any): Promise<boolean> {
    try {
      if (!SunmiModule) {
        const initialized = await this.init();
        if (!initialized) return false;
      }
      
      await SunmiPrinterManager.init();
      const formatter = SunmiPrinterManager.getFormatter();
      const nameLimit = formatter.getLineWidth() === 48 ? 24 : 12;
      const symbol = companySettings.currencySymbol || "$";

      // ============ HEADER SECTION ============
      await SunmiModule.printText(formatter.doubleDivider("="));
      await SunmiModule.lineWrap(1);

      if (saleData.isCheckout) {
        await SunmiModule.printText(formatter.center("CHECKOUT BILL"));
        await SunmiModule.printText(formatter.center("PAYMENT PENDING"));
        await SunmiModule.printText(formatter.doubleDivider("="));
        await SunmiModule.lineWrap(1);
      }

      await this.printLogos(companySettings);

      try {
        if (SunmiModule.setFontSize) await SunmiModule.setFontSize(32);
        else if (SunmiModule.setTextSize) await SunmiModule.setTextSize(32);
        if (SunmiModule.setBold) await SunmiModule.setBold(true);
      } catch (_) {}

      await SunmiModule.printText(formatter.center(companySettings.name || "YOUR STORE"));
      await SunmiModule.lineWrap(1);

      try {
        if (SunmiModule.setFontSize) await SunmiModule.setFontSize(24);
        else if (SunmiModule.setTextSize) await SunmiModule.setTextSize(24);
        if (SunmiModule.setBold) await SunmiModule.setBold(false);
      } catch (_) {}

      if (companySettings.address) {
        const addressLines = companySettings.address.split("\n");
        for (const line of addressLines) {
          if (line.trim()) {
            await SunmiModule.printText(formatter.center(line.trim()));
          }
        }
      }

      if (companySettings.phone) {
        await SunmiModule.printText(formatter.center(`📞 ${companySettings.phone}`));
      }

      if (companySettings.email) {
        await SunmiModule.printText(formatter.center(`📧 ${companySettings.email}`));
      }

      if (companySettings.gstNo) {
        await SunmiModule.printText(formatter.center(`GST: ${companySettings.gstNo}`));
      }

      await SunmiModule.printText(formatter.doubleDivider("="));
      await SunmiModule.lineWrap(1);

      // ============ BILL DETAILS ============
      const saleDate = saleData.originalDate ? parseDatabaseDate(saleData.originalDate) : 
                       saleData.date ? parseDatabaseDate(saleData.date) : 
                       new Date();
      const dateStr = formatToSingaporeDate(saleDate, { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = formatToSingaporeTime(saleDate).replace(/(am|pm)/gi, (m) => m.toUpperCase());

      if (saleData.tableNo) {
        const cleanTableNo = /^\d+$/.test(String(saleData.tableNo).trim()) 
          ? String(saleData.tableNo).trim().padStart(2, '0') 
          : saleData.tableNo;
        try {
          if (SunmiModule.setBold) await SunmiModule.setBold(true);
        } catch (_) {}
        await SunmiModule.printText(formatter.twoCols(`INVOICE NO: ${saleData.invoiceNumber || saleData.id}`, `TABLE: ${cleanTableNo}`));
        try {
          if (SunmiModule.setBold) await SunmiModule.setBold(false);
        } catch (_) {}
      } else {
        await SunmiModule.printText(formatter.left(`INVOICE NO: ${saleData.invoiceNumber || saleData.id}`));
      }
      await SunmiModule.printText(formatter.left(`DATE: ${dateStr} ${timeStr}`));
      if (saleData.waiterName && saleData.waiterName !== "Staff") {
        const displayWaiter = String(saleData.waiterName).replace(/\s*\(quick serve\)/gi, "").trim() || "Staff";
        await SunmiModule.printText(formatter.left(`WAITER: ${displayWaiter}`));
      }
      await SunmiModule.printText(formatter.divider("-"));

      // ============ ITEMS SECTION ============
      await SunmiModule.printText(formatter.itemHeader());
      await SunmiModule.printText(formatter.divider("-"));

      const printItems = (saleData.items || []).filter((i: any) => i.status !== "VOIDED");
      const activeItems = (saleData.items || []).filter((i: any) => i.status !== "VOIDED" && i.statusCode !== 0);
      const allItemsHaveSC = activeItems.length > 0 && activeItems.every((item: any) => {
        const isTakeawayItem = item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway;
        return !isTakeawayItem && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true);
      });

      for (const item of printItems) {
        const fullItemName = item.name || item.DishName || item.ProductName || "";
        const qtyNum = parseInt(String(item.qty || item.quantity || item.Quantity || 1)) || 1;
        const qty = qtyNum.toString();
        const priceNum = parseFloat(String(item.price || item.Price || item.Cost || 0)) || 0;
        const price = `${symbol}${priceNum.toFixed(2)}`;
        const totalNum = priceNum * qtyNum;
        const total = `${symbol}${totalNum.toFixed(2)}`;

        if (fullItemName.length > nameLimit) {
          await SunmiModule.printText(formatter.left(fullItemName));
          await SunmiModule.printText(formatter.itemRow("", qty, price, total));
        } else {
          await SunmiModule.printText(formatter.itemRow(fullItemName, qty, price, total));
        }

        const songName = item.songName || item.SongName || "";
        if (songName) {
          await SunmiModule.printText(formatter.left(`   ` + "🎵 " + songName));
        }

        if (item.modifiers && Array.isArray(item.modifiers)) {
          for (const m of item.modifiers) {
            const mName = (m.ModifierName || m.name || "").trim();
            const mAmt = parseFloat(String(m.Amount ?? m.Price ?? m.amount ?? m.price ?? 0)) || 0;
            if (mAmt > 0) {
              await SunmiModule.printText(formatter.twoCols(`   + ${mName}`, `${symbol}${(mAmt * qtyNum).toFixed(2)}`));
            }
          }
        }

        const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
        if (discAmt > 0) {
          const discType = item.discountType || "percentage";
          const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
          const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
          const effectiveDisc = discType === "percentage" ? discAmt : Math.min(discAmt, discountBasis);
          const discStr = discType === "percentage" ? `-${discAmt}%` : `-${symbol}${effectiveDisc.toFixed(2)}`;
          await SunmiModule.printText(formatter.left(`    Discount: ${discStr}`));
        }
      }

      await SunmiModule.printText(formatter.divider("-"));

      // ============ SUBTOTAL & DISCOUNT ============
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
          } else {
            itemDiscount = Math.min(discAmt, discountBasis) * qtyNum;
          }
        }
        grossTotal += baseTotal;
        totalItemDiscount += itemDiscount;
      });

      const finalDiscountInfo =
        saleData.discount ||
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

      let orderDiscount = finalDiscountInfo?.amount || parseFloat(String(saleData.discountAmount || 0)) || 0;
      if (orderDiscount === 0 && finalDiscountInfo && finalDiscountInfo.applied !== false && finalDiscountInfo.value > 0) {
        const subtotalPostItemDisc = Math.max(0, grossTotal - totalItemDiscount);
        if (finalDiscountInfo.type === "percentage") {
          orderDiscount = (subtotalPostItemDisc * finalDiscountInfo.value) / 100;
        } else {
          orderDiscount = Math.min(finalDiscountInfo.value, subtotalPostItemDisc);
        }
      }

      const hasAnyDiscount = totalItemDiscount > 0 || orderDiscount > 0;
      let currentSubtotal = grossTotal;

      await SunmiModule.printText(formatter.twoCols("Sub Total:", `${symbol}${grossTotal.toFixed(2)}`));

      if (totalItemDiscount > 0) {
        await SunmiModule.printText(formatter.twoCols("Item Discounts:", `-${symbol}${totalItemDiscount.toFixed(2)}`));
        currentSubtotal -= totalItemDiscount;
      }

      if (orderDiscount > 0) {
        const discType = finalDiscountInfo?.type || saleData.discountType || "percentage";
        const discVal = finalDiscountInfo?.value ?? saleData.discountValue;
        const discLabel = discType === "percentage" ? `Discount (${discVal}%):` : "Discount:";
        await SunmiModule.printText(formatter.twoCols(discLabel, `-${symbol}${orderDiscount.toFixed(2)}`));
        currentSubtotal -= orderDiscount;
      }

      if (hasAnyDiscount) {
        await SunmiModule.printText(formatter.divider("-"));
        await SunmiModule.printText(formatter.twoCols("Net Amount:", `${symbol}${currentSubtotal.toFixed(2)}`));
      }
      await SunmiModule.printText(formatter.divider("-"));

      // ============ SERVICE CHARGE & GST ============
      let finalTotal = saleData.total || saleData.totalAmount || currentSubtotal;
      const gstRate = companySettings.gstPercentage || 0;
      const scPercentage = companySettings.serviceChargePercentage || 0;
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
      const companySettingsStore = useCompanySettingsStore.getState().settings;
      const takeawayRateFromSettings = companySettingsStore?.takeawayCharges || 0;
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
      const gstAmountRaw = gstRate > 0 ? taxableAmount * (gstRate / 100) : 0;
      const gstAmount = Math.round(gstAmountRaw * 100) / 100;
      
      if (finalTotal === 0) {
        finalTotal = taxableAmount + gstAmount;
      }
      
      const printedRoundOff = saleData.roundOff && saleData.roundOff !== 0
        ? parseFloat((finalTotal - (taxableAmount + gstAmount)).toFixed(2))
        : 0;


      if (hasSC) {
        await SunmiModule.printText(formatter.twoCols(
          allItemsHaveSC ? "Service Charge:" : "Item Service Charge:",
          `${symbol}${serviceChargeAmount.toFixed(2)}`
        ));
      }

      if (takeawayCharge > 0) {
        await SunmiModule.printText(formatter.twoCols("Takeaway Charges:", `${symbol}${takeawayCharge.toFixed(2)}`));
      }

      if (gstRate > 0) {
        await SunmiModule.printText(formatter.twoCols(`GST (${gstRate}%):`, `${symbol}${gstAmount.toFixed(2)}`));
        await SunmiModule.printText(formatter.divider("-"));
      }

      if (printedRoundOff && printedRoundOff !== 0) {
        const roLabel = printedRoundOff > 0 ? "+Round Off:" : "Round Off:";
        await SunmiModule.printText(formatter.twoCols(roLabel, `${symbol}${printedRoundOff.toFixed(2)}`));
        await SunmiModule.printText(formatter.divider("-"));
      }

      // ============ GRAND TOTAL ============
      await SunmiModule.printText(formatter.twoCols("GRAND TOTAL:", `${symbol}${finalTotal.toFixed(2)}`));
      await SunmiModule.printText(formatter.doubleDivider("="));

      // ============ PAYMENT ============
      if (saleData.isCheckout) {
        await SunmiModule.printText(formatter.center("PAYMENT STATUS: PENDING"));
      } else {
        await SunmiModule.printText(formatter.twoCols("PAYMENT:", saleData.paymentMethod || "Cash"));

        if (saleData.cashPaid && saleData.cashPaid > 0) {
          await SunmiModule.printText(formatter.twoCols("PAID:", `${symbol}${saleData.cashPaid.toFixed(2)}`));
          if (saleData.change && saleData.change > 0) {
            await SunmiModule.printText(formatter.twoCols("CHANGE:", `${symbol}${saleData.change.toFixed(2)}`));
          }
        }
      }

      // 🏆 Print member reward stats on Sunmi Receipt
      if (saleData.mobileNo) {
        await SunmiModule.printText(formatter.divider("-"));
        await SunmiModule.printText(formatter.twoCols("Member Phone:", String(saleData.mobileNo)));
        if (parseFloat(saleData.rewardPointsEarned) > 0) {
          await SunmiModule.printText(formatter.twoCols("Points Earned:", `+$${parseFloat(saleData.rewardPointsEarned).toFixed(2)}`));
        }
        if (parseFloat(saleData.memberRewardBalance) > 0) {
          await SunmiModule.printText(formatter.twoCols("Avail Member Credit:", `$${parseFloat(saleData.memberRewardBalance).toFixed(2)}`));
        }
      }

      await SunmiModule.lineWrap(1);

      // ============ FOOTER ============
      if (saleData.isCheckout) {
        await SunmiModule.printText(formatter.center("PLEASE PAY AT THE COUNTER"));
      } else {
        await SunmiModule.printText(formatter.center("THANK YOU! COME AGAIN!"));
      }
      await SunmiModule.lineWrap(1);
      await SunmiModule.printText(formatter.center("SMART-CAFE BY UNIPROSG"));

      if (companySettings.gstPercentage > 0) {
        await SunmiModule.printText(formatter.center(`* Prices include ${companySettings.gstPercentage}% GST`));
      }

      await SunmiModule.lineWrap(3);
      await SunmiModule.cutPaper();

      return true;
    } catch (error) {
      console.log("❌ Print error:", error);
      return false;
    }
  }

  // ✅ QR Fix: Print a scannable QR code using Sunmi built-in printer
  static async printQR(qrUrl: string, tableLabel: string, sectionName: string): Promise<boolean> {
    try {
      if (!SunmiModule) {
        const initialized = await this.init();
        if (!initialized) return false;
      }

      await SunmiPrinterManager.init();
      const formatter = SunmiPrinterManager.getFormatter();

      await SunmiModule.printText(formatter.doubleDivider("="));
      await SunmiModule.lineWrap(1);

      try {
        if (SunmiModule.setFontSize) await SunmiModule.setFontSize(28);
        if (SunmiModule.setBold) await SunmiModule.setBold(true);
      } catch (_) {}

      await SunmiModule.printText(formatter.center("TABLE QR CODE"));
      await SunmiModule.lineWrap(1);

      try {
        if (SunmiModule.setFontSize) await SunmiModule.setFontSize(24);
      } catch (_) {}

      if (tableLabel) await SunmiModule.printText(formatter.center(`Table: ${tableLabel}`));
      if (sectionName) await SunmiModule.printText(formatter.center(sectionName));
      await SunmiModule.lineWrap(1);

      try {
        if (SunmiModule.setBold) await SunmiModule.setBold(false);
      } catch (_) {}

      // Try native printBarCode2 (QR code command) first if available
      try {
        if (SunmiModule.printBarCode2) {
          // Sunmi SDK: printBarCode2(data, symbology, height, width, textPosition)
          // symbology 8 = QR Code
          await SunmiModule.printBarCode2(qrUrl, 8, 350, 350, 0);
          await SunmiModule.lineWrap(2);
          console.log("✅ QR printed via Sunmi printBarCode2");
        } else if (SunmiModule.printQRCode) {
          await SunmiModule.printQRCode(qrUrl, 12, 0);
          await SunmiModule.lineWrap(2);
          console.log("✅ QR printed via Sunmi printQRCode");
        } else {
          throw new Error("No native QR method available");
        }
      } catch (nativeQrErr) {
        console.warn("Native QR method failed, trying image fallback:", nativeQrErr);
        // Fallback: download QR as bitmap from API and print as image
        try {
          const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qrUrl)}`;
          const base64Qr = await this.urlToBase64(qrApiUrl);
          await SunmiModule.printImageBase64(base64Qr);
          await SunmiModule.lineWrap(2);
          console.log("✅ QR printed via image bitmap fallback");
        } catch (imgErr) {
          console.warn("QR image fallback also failed:", imgErr);
          // Last resort: just print the URL as text for scanning
          await SunmiModule.printText(formatter.center("SCAN URL:"));
          await SunmiModule.printText(formatter.left(qrUrl));
          await SunmiModule.lineWrap(1);
        }
      }

      await SunmiModule.printText(formatter.center("Scan to Order"));
      await SunmiModule.printText(formatter.doubleDivider("="));
      await SunmiModule.lineWrap(3);
      await SunmiModule.cutPaper();
      return true;
    } catch (error) {
      console.log("❌ Sunmi QR print error:", error);
      return false;
    }
  }

  static async printKOT(data: any, type: "NEW" | "ADDITIONAL" | "REPRINT" | "KDS_PRINT" = "NEW"): Promise<boolean> {
    try {
      if (!SunmiModule) {
        const initialized = await this.init();
        if (!initialized) return false;
      }
      
      await SunmiPrinterManager.init();
      const formatter = SunmiPrinterManager.getFormatter();

      const is80mm = SunmiPrinterManager.getPaperSize() === "80mm";
      const fontSizes = {
        title: is80mm ? 26 : 30,
        timestamp: is80mm ? 20 : 24,
        table: is80mm ? 28 : 34,
        item: is80mm ? 24 : 28,
        modifier: is80mm ? 22 : 26,
        note: is80mm ? 20 : 24,
        reset: is80mm ? 20 : 24,
      };

      const title = type === "KDS_PRINT" ? "KDS PRINT" : type === "REPRINT" ? "REPRINT" : type === "ADDITIONAL" ? "ADDITIONAL" : "NEW ORDER";
      const items = data.items || [];
      const tableNo = data.tableNo || "N/A";
      const orderNo = data.orderNo || data.orderId || "N/A";
      const rawWaiter = data.waiterName || "Staff";
      const isTakeaway =
        data.orderType === "TAKEAWAY" ||
        data.orderContext?.orderType === "TAKEAWAY" ||
        data.context?.orderType === "TAKEAWAY" ||
        data.isTakeaway ||
        data.IsTakeaway ||
        String(tableNo).toUpperCase().includes("TAKEAWAY") ||
        String(tableNo).toUpperCase().startsWith("TW");

      let displayTable = "";
      if (isTakeaway) {
        const rawTw = data.takeawayNo || data.orderContext?.takeawayNo || data.context?.takeawayNo;
        const cleanTw = (rawTw && String(rawTw) !== "undefined" && String(rawTw).trim() !== "")
          ? String(rawTw).replace(/^TW-?/i, "").trim()
          : (orderNo && orderNo !== "N/A" ? String(orderNo).slice(-4) : "");
        displayTable = cleanTw ? `TAKEAWAY #${cleanTw}` : "TAKEAWAY";
      } else {
        const cleanTableNo = String(tableNo || "1")
          .replace(/\s*\(quick serve\)/gi, "")
          .replace(/^table\s+/gi, "")
          .trim() || "1";
        displayTable = `Table ${cleanTableNo}`;
      }

      const waiter = (typeof rawWaiter === "string") ? rawWaiter.replace(/\s*\(quick serve\)/gi, "").trim() || "Staff" : "Staff";
      const now = new Date();
      const dateStr = formatToSingaporeDate(now, { day: '2-digit', month: '2-digit' });
      const timeStr = formatToSingaporeTime(now, { hour: '2-digit', minute: '2-digit', hour12: false });
      const timestamp = `${dateStr} ${timeStr}`;

      const setSize = async (size: number) => {
        try {
          if (SunmiModule.setFontSize) await SunmiModule.setFontSize(size);
          else if (SunmiModule.setTextSize) await SunmiModule.setTextSize(size);
          else if (SunmiModule.updateFontSize) await SunmiModule.updateFontSize(size);
        } catch (e) {
          console.log("Font size not supported");
        }
      };

      // ============ HEADER (Large & Bold) ============
      await setSize(fontSizes.title);
      await SunmiModule.printText(formatter.left(title));
      await SunmiModule.lineWrap(1);

      await setSize(fontSizes.timestamp);
      await SunmiModule.printText(formatter.left(timestamp));
      await SunmiModule.lineWrap(1);

      // ============ TABLE INFO ============
      await SunmiModule.printText(formatter.doubleDivider("="));
      await setSize(fontSizes.table);
      await SunmiModule.printText(formatter.left(isTakeaway ? displayTable : `TABLE: ${displayTable}`));
      await SunmiModule.lineWrap(1);

      await setSize(fontSizes.timestamp);
      await SunmiModule.printText(formatter.left(`Order: #${orderNo}`));
      await SunmiModule.printText(formatter.left(`Waiter: ${waiter}`));
      await SunmiModule.printText(formatter.doubleDivider("="));

      // ============ ITEMS ============
      await SunmiModule.lineWrap(1);
      for (const item of items) {
        await setSize(fontSizes.item);
        const lines = (item.name || "").split("\n");
        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx];
          if (idx === 0) {
            await SunmiModule.printText(formatter.left(`[${item.qty || item.quantity || 1}] ${line}`));
          } else {
            await SunmiModule.printText(formatter.left(`    ${line}`));
          }
        }

        const songName = item.songName || item.SongName || "";
        if (songName) {
          await setSize(fontSizes.note);
          await SunmiModule.printText(formatter.left(`  🎵 ${songName}`));
          await SunmiModule.lineWrap(1);
        }

        const isTw = !!(item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway);
        if (isTw) {
          await setSize(fontSizes.item);
          try {
            if (SunmiModule.setBold) await SunmiModule.setBold(true);
          } catch (_) {}
          await SunmiModule.printText(formatter.left(`  - Takeaway`));
          try {
            if (SunmiModule.setBold) await SunmiModule.setBold(false);
          } catch (_) {}
          await SunmiModule.lineWrap(1);
        }

        if (item.modifiers && item.modifiers.length > 0) {
          await setSize(fontSizes.modifier);
          try {
            if (SunmiModule.setBold) await SunmiModule.setBold(true);
          } catch (_) {}
          for (const mod of item.modifiers) {
            await SunmiModule.printText(formatter.left(`    + ${mod.ModifierName || mod.name}`));
            await SunmiModule.lineWrap(1);
          }
          try {
            if (SunmiModule.setBold) await SunmiModule.setBold(false);
          } catch (_) {}
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
          await setSize(fontSizes.modifier);
          for (const g of comboSels) {
            const choices = g.items || g.dishes || g.selections || g.selectedDishes || (Array.isArray(g) ? g : (g.name || g.DishName || g.itemName ? [g] : []));
            if (Array.isArray(choices)) {
              for (const opt of choices) {
                const optName = opt.name || opt.DishName || opt.itemName || "";
                if (optName) {
                  await SunmiModule.printText(formatter.left(`    - ${optName}`));
                  await SunmiModule.lineWrap(1);
                }
              }
            }
          }
        }

        const noteText = item.note || item.notes || item.Remarks || item.remarks;
        if (noteText) {
          await setSize(fontSizes.note);
          await SunmiModule.printText(formatter.left(`  * NOTE: ${noteText}`));
          await SunmiModule.lineWrap(1);
        }

        await SunmiModule.printText(formatter.divider("-"));
      }

      await setSize(fontSizes.reset);
      await SunmiModule.lineWrap(1);
      await SunmiModule.cutPaper();
      return true;
    } catch (err) {
      console.log("❌ Sunmi KOT Error:", err);
      return false;
    }
  }
}

export default SunmiPrinterService;
