// components/BillPDFGenerator.ts - WITH DISCOUNT SUPPORT ✅

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform, Alert } from 'react-native';
import API from '../api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { API_URL } from '@/constants/Config';
import { formatToSingaporeDate, formatToSingaporeTime, parseDatabaseDate } from '../utils/timezoneHelper';

interface CompanySettings {
  name: string;
  address: string;
  gstNo: string;
  gstPercentage: number;
  serviceChargePercentage?: number;
  phone: string;
  email: string;
  reportEmail?: string;
  cashierName: string;
  currency: string;
  currencySymbol: string;
  companyLogo?: string;        // ✅ ADD THIS
  halalLogo?: string;          // ✅ ADD THIS
  printerIp?: string;          // ✅ ADD THIS
  takeawayCharges?: number;    // ✅ ADD THIS
  showCompanyLogo?: boolean;   // ✅ ADD THIS
  showHalalLogo?: boolean; 
}

// ✅ DISCOUNT INFO INTERFACE
interface DiscountInfo {
  applied: boolean;
  type: 'percentage' | 'fixed';
  value: number;
  amount: number;
}

class BillPDFGenerator {
  private static settingsCache: Record<string, { data: CompanySettings; time: number }> = {};
  
  static async uploadImage(fileUri: string): Promise<string | null> {
    try {
      const formData = new FormData();
      
      if (Platform.OS === 'web') {
        // ✅ WEB: Convert URI to Blob
        const response = await fetch(fileUri);
        const blob = await response.json ? await response.blob() : await response.blob();
        formData.append('image', blob, 'logo.png');
      } else {
        // ✅ MOBILE: Use the URI object trick
        const filename = fileUri.split('/').pop() || 'image.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : `image/jpeg`;

        formData.append('image', {
          uri: fileUri,
          name: filename,
          type,
        } as any);
      }

      const response = await API.post('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (response.data && response.data.success) {
        return response.data.imageUrl;
      }
      return null;
    } catch (error: any) {
      console.log('Upload error:', error.response?.data || error.message);
      return null;
    }
  }
  
static async loadSettings(userId?: string | number): Promise<CompanySettings> {
    try {
        if (!userId) return this.getDefaultSettings();
        
        const targetId = '1';

        // Check cache (valid for 30 seconds)
        const now = Date.now();
        const cached = this.settingsCache[targetId];
        if (cached && (now - cached.time < 30000)) {
            console.log(`📥 USING CACHED SETTINGS for target: ${targetId}`);
            return cached.data;
        }
        
        // Add timestamp to prevent caching
        const timestamp = Date.now();
        
        console.log(`📥 LOADING SETTINGS for target: ${targetId}`);
        
        let response = await API.get(`/company-settings/${targetId}?_t=${timestamp}`);
        
        // ✅ CRITICAL FALLBACK: If we got a record but it has no name, try loading Master Settings (ID 1)
        if (targetId !== '1' && (!response.data?.settings?.CompanyName || response.data.settings.CompanyName.trim() === '')) {
            console.log('⚠️ Got empty settings for GUID, falling back to Master Settings (ID 1)');
            const masterResponse = await API.get(`/company-settings/1?_t=${timestamp}`);
            if (masterResponse.data?.success && masterResponse.data.settings?.CompanyName) {
                response = masterResponse;
            }
        }
        
        if (response.data && response.data.success) {
            const settings = response.data.settings;
            
            // Fix boolean conversion
            const showCompanyLogo = settings.ShowCompanyLogo === 1 || settings.ShowCompanyLogo === true;
            const showHalalLogo = settings.ShowHalalLogo === 1 || settings.ShowHalalLogo === true;
            
            // ✅ FIX: Handle GST percentage correctly (allow 0)
            const gstPercentage = settings.GSTPercentage !== undefined && settings.GSTPercentage !== null 
                ? settings.GSTPercentage 
                : 9;
            
            console.log('✅ CONVERTED VALUES:', {
                showCompanyLogo,
                showHalalLogo,
                gstPercentage,
                rawGST: settings.GSTPercentage
            });
            
            const formatUrl = (url: string) => {
                if (!url) return '';
                if (url.startsWith('data:image')) return url;
                if (url.startsWith('http')) return url;
                return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
            };
            
            const result = {
                name: settings.CompanyName || 'Komban',
                address: settings.Address || '',
                gstNo: settings.GSTNo || '',
                gstPercentage: gstPercentage,
                serviceChargePercentage: parseFloat(settings.ServiceChargePercentage) || 0,
                phone: settings.Phone || '',
                email: settings.Email || '',
                reportEmail: settings.ReportEmail || '',
                cashierName: settings.CashierName || '',
                currency: settings.Currency || 'SGD',
                currencySymbol: settings.CurrencySymbol || '$',
                companyLogo: formatUrl(settings.CompanyLogoUrl),
                halalLogo: formatUrl(settings.HalalLogoUrl),
                printerIp: settings.PrinterIP || '',
                showCompanyLogo: showCompanyLogo === true,
                showHalalLogo: showHalalLogo === true,
                takeawayCharges: parseFloat(settings.TakeawayCharges) || 0,
            };

            this.settingsCache[targetId] = {
                data: result,
                time: now
            };

            return result;
        }
        return this.getDefaultSettings();
    } catch (error) {
        console.log('❌ Error loading settings:', error);
        return this.getDefaultSettings();
    }
}

  private static getDefaultSettings(): CompanySettings {
    return {
      name: '',
      address: '',
      gstNo: '',
      gstPercentage: 0,
      phone: '',
      email: '',
      reportEmail: '',
      cashierName: '',
      currency: 'SGD',
      currencySymbol: '$',
      takeawayCharges: 0,
    };
  }
  
 static async saveSettings(settings: CompanySettings, userId?: string | number): Promise<boolean> {
    try {
        if (!userId) return false;
        
        const targetId = '1';
        
        console.log(`💾 SAVING SETTINGS TO BACKEND for target: 1`, {
            showCompanyLogo: settings.showCompanyLogo ? 1 : 0,
            showHalalLogo: settings.showHalalLogo ? 1 : 0,
            companyLogo: settings.companyLogo ? 'YES' : 'NO',
            halalLogo: settings.halalLogo ? 'YES' : 'NO'
        });
        
        const dbSettings = {
            CompanyName: settings.name,
            Address: settings.address,
            GSTNo: settings.gstNo,
            GSTPercentage: settings.gstPercentage,
            Phone: settings.phone,
            Email: settings.email,
            ReportEmail: settings.reportEmail || (settings as any).ReportEmail || '',
            CashierName: settings.cashierName,
            Currency: settings.currency,
            CurrencySymbol: settings.currencySymbol,
            CompanyLogoUrl: settings.companyLogo || '',
            HalalLogoUrl: settings.halalLogo || '',
            PrinterIP: settings.printerIp || '', // ✅ ADDED
            ShowCompanyLogo: settings.showCompanyLogo ? 1 : 0,  // ✅ Simplified
            ShowHalalLogo: settings.showHalalLogo ? 1 : 0,      // ✅ Simplified
            ServiceChargePercentage: settings.serviceChargePercentage || 0,
            TakeawayCharges: settings.takeawayCharges || 0,
            userName: (settings as any).userName,
            userId: (settings as any).userId,
            userRole: (settings as any).userRole
        };
        
        // ✅ Add timestamp to prevent caching
        const timestamp = Date.now();
        const url = `${API_URL}/api/company-settings/${targetId}?_t=${timestamp}`;

        // Attempt save via native fetch first to bypass any axios interceptor/response parsing issue
        try {
            const fetchRes = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(dbSettings)
            });
            if (fetchRes.ok) {
                delete this.settingsCache[targetId];
                return true;
            }
        } catch (fetchErr) {
            console.log('⚠️ Fetch post attempt failed, trying API axios fallback:', fetchErr);
        }
        
        // Fallback to API axios client
        const response = await API.post(`/company-settings/${targetId}?_t=${timestamp}`, dbSettings);
        console.log('✅ SAVE RESPONSE:', response.data);
        
        if (response.status === 200 || response.status === 201 || (response.data && (response.data.success !== false))) {
            delete this.settingsCache[targetId];
            return true;
        }
        
        return false;
        
    } catch (error: any) {
        console.log('❌ Error saving settings:', error);
        console.log('❌ Error details:', error.response?.data || error.message);
        return false;
    }
}
// Add this method to the BillPDFGenerator class
private static escapeHtml(str: string): string {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
  // ✅ GENERATE HTML WITH DISCOUNT SUPPORT
  /**
   * Generate HTML for Bill/Receipt
   * @param saleData The sale/order data
   * @param userId User ID for loading settings (ignored if companyOverride provided)
   * @param discountInfo Optional discount information
   * @param companyOverride Optional pre-loaded company settings to prevent double-loading
   */
  static async generateHTML(
    saleData: any, 
    userId?: string | number, 
    discountInfo?: any,
    companyOverride?: CompanySettings
  ): Promise<string> {
    const company = companyOverride || await this.loadSettings(userId);
    
    // ✅ FIX: Get discount from saleData if discountInfo not provided
    let finalDiscountInfo = discountInfo;
    
    if (!finalDiscountInfo && saleData.discount) {
        // Get discount from sale data (for reprints)
        finalDiscountInfo = {
            applied: true,
            type: saleData.discount.type || 'percentage',
            value: saleData.discount.value || 0,
            amount: saleData.discount.amount || saleData.discountAmount || 0
        };
        console.log('📋 Using discount from saleData:', finalDiscountInfo);
    }
    
    // ✅ Also check saleData.discountAmount for direct field
    if (!finalDiscountInfo && saleData.discountAmount && saleData.discountAmount > 0) {
        finalDiscountInfo = {
            applied: true,
            type: saleData.discountType || 'percentage',
            value: saleData.discountValue || 0,
            amount: saleData.discountAmount
        };
        console.log('📋 Using discount from saleData fields:', finalDiscountInfo);
    }
    
    const saleDate = saleData.originalDate ? parseDatabaseDate(saleData.originalDate) : 
                     saleData.date ? parseDatabaseDate(saleData.date) : 
                     new Date();
    
    const isReprint = saleData.isReprint === true;
    const billNo = saleData.invoiceNumber || saleData.orderId || saleData.id || `ORD-${saleDate.getFullYear()}${(saleDate.getMonth()+1).toString().padStart(2,'0')}${saleDate.getDate().toString().padStart(2,'0')}-${Math.floor(1000 + Math.random()*9000)}`;
    
    const hasGST = company.gstPercentage > 0;
    const gstRate = company.gstPercentage !== undefined && company.gstPercentage !== null ? company.gstPercentage : 9;
    let finalTotal = saleData.total || saleData.totalAmount || 0;
    const currencySymbol = company.currencySymbol || '$';

    // Calculate item-level discounts and gross total
    let grossTotal = 0;
    let totalItemDiscount = 0;
    (saleData.items || []).forEach((item: any) => {
      if (item.status === 'VOIDED') return;
      const qtyNum = parseInt(String(item.qty || item.quantity || 1)) || 1;
      const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
      const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
      const baseTotal = (item.price || 0) * qtyNum;
      let itemDiscount = 0;
      const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
      const discType = item.discountType || 'percentage';
      if (discAmt > 0) {
        if (discType === 'percentage') {
          itemDiscount = (discountBasis * (discAmt / 100)) * qtyNum;
        } else {
          itemDiscount = Math.min(discAmt, discountBasis) * qtyNum;
        }
      }
      grossTotal += baseTotal;
      totalItemDiscount += itemDiscount;
    });

    if (finalDiscountInfo && (!finalDiscountInfo.amount || finalDiscountInfo.amount === 0) && finalDiscountInfo.value > 0) {
      const subtotalPostItemDisc = Math.max(0, grossTotal - totalItemDiscount);
      if (finalDiscountInfo.type === "percentage") {
        finalDiscountInfo.amount = (subtotalPostItemDisc * finalDiscountInfo.value) / 100;
      } else {
        finalDiscountInfo.amount = Math.min(finalDiscountInfo.value, subtotalPostItemDisc);
      }
    }

    const focPayment = (saleData.payments || []).find((p: any) => String(p.payMode || p.payModeName || p.Remarks || '').trim().toUpperCase() === 'FOC');
    const focAmt = focPayment ? Number(focPayment.amount ?? focPayment.Amount ?? 0) : 0;
    const orderDiscount = finalDiscountInfo?.amount || 0;
    const normalDiscount = Math.max(0, orderDiscount - focAmt);
    const hasOrderDiscount = normalDiscount > 0;
    const hasAnyDiscount = totalItemDiscount > 0 || orderDiscount > 0;
    const currentSubtotal = grossTotal - totalItemDiscount - orderDiscount;
    const originalSubTotal = grossTotal;

    const activeItems = (saleData.items || []).filter((i: any) => i.status !== 'VOIDED' && i.statusCode !== 0);
    const allItemsHaveSC = activeItems.length > 0 && activeItems.every((item: any) => {
      const isTakeawayItem = item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway;
      return !isTakeawayItem && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true);
    });

    const scPercentage = company.serviceChargePercentage || 0;
    const savedServiceCharge = saleData.serviceCharge != null ? parseFloat(String(saleData.serviceCharge)) : null;

    let serviceChargeAmount = 0;
    if (savedServiceCharge !== null) {
      serviceChargeAmount = savedServiceCharge;
    } else {
      let scEligibleSubtotal = 0;
      (saleData.items || []).forEach((item: any) => {
        if (item.status === 'VOIDED') return;
        const qtyNum = parseInt(String(item.qty || item.quantity || 1)) || 1;
        const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
        const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
        const baseTotal = (item.price || 0) * qtyNum;
        let itemDiscount = 0;
        const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
        const discType = item.discountType || 'percentage';
        if (discAmt > 0) {
          if (discType === 'percentage') {
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

    const takeawayRateFromSettings = parseFloat(String((company as any).TakeawayCharges ?? company.takeawayCharges ?? 0)) || 0;
    let takeawayCharge = saleData.takeawayCharge !== undefined ? parseFloat(String(saleData.takeawayCharge)) : 0;
    
    let firstRate: number | null = null;
    let mixed = false;
    let calculatedTWCharge = 0;
    let takeawayQty = 0;

    (saleData.items || []).forEach((item: any) => {
      const isTW = item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway;
      const isVoided = item.status === 'VOIDED' || item.status === 'VOID' || item.StatusCode === 0;
      if (isTW && !isVoided) {
        const qtyNum = parseInt(String(item.qty || item.Qty || item.quantity || 1)) || 1;
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
    const hasSC = serviceChargeAmount > 0;
    const effectiveSCPercentage = serviceChargeAmount > 0 && currentSubtotal > 0
      ? Math.round((serviceChargeAmount / currentSubtotal) * 100)
      : scPercentage;
    const gstAmountRaw = hasGST ? taxableAmount * (gstRate / 100) : 0;
    const gstAmount = Math.round(gstAmountRaw * 100) / 100;
    const amountWithoutGST = currentSubtotal;
    
    if (finalTotal === 0) {
      finalTotal = taxableAmount + gstAmount;
    }
    
    const printedRoundOff = saleData.roundOff && saleData.roundOff !== 0
      ? parseFloat((finalTotal - (taxableAmount + gstAmount)).toFixed(2))
      : 0;
    
    const companyLogoUrl = company.companyLogo || '';
    const halalLogoUrl = company.halalLogo || '';
    
    // ✅ STRICT CHECK: Ensure logos are only shown if BOTH the toggle is ON and the URL exists
    const showCompanyLogo = company.showCompanyLogo === true && !!companyLogoUrl;
    const showHalalLogo = company.showHalalLogo === true && !!halalLogoUrl;
    
    console.log('🖼️ LOGO RENDER CHECK:', {
        showCompanyLogo,
        showHalalLogo,
        companyLogoUrl: companyLogoUrl ? 'PRESENT' : 'MISSING',
        halalLogoUrl: halalLogoUrl ? 'PRESENT' : 'MISSING',
        rawShowCompany: company.showCompanyLogo
    });
    
    const itemsHTML = (saleData.items || [])
        .filter((item: any) => item.status !== 'VOIDED')
        .map((item: any) => {
          const qtyNum = item.qty || item.quantity || 1;
          const modifiersHTML = (item.modifiers && Array.isArray(item.modifiers))
            ? item.modifiers.map((m: any) => {
                const mName = (m.ModifierName || m.name || "").trim();
                return `<div class="item-modifiers">+ ${mName}</div>`;
              }).join('')
            : '';

          const comboSels = item.comboSelections || 
            (typeof item.ComboDetailsJSON === 'string' && item.ComboDetailsJSON 
              ? (() => { try { const p = JSON.parse(item.ComboDetailsJSON); return Array.isArray(p) ? p : p.groups || p.items || []; } catch { return undefined; } })() 
              : (Array.isArray(item.ComboDetailsJSON) ? item.ComboDetailsJSON : undefined)) || [];
          const hasCombo = Array.isArray(comboSels) && comboSels.length > 0;

          const comboSelectionsHTML = hasCombo
            ? comboSels.map((group: any) => {
                const choices = group.items || group.dishes || (Array.isArray(group) ? group : [group]);
                if (Array.isArray(choices)) {
                  return choices.map((opt: any) => {
                    const effectiveAdd = (parseFloat(opt.surcharge || 0) + parseFloat(opt.dishPrice || 0));
                    const optName = opt.name || opt.DishName || opt.itemName || "";
                    return `<div class="item-modifiers">↳ ${optName}${effectiveAdd > 0 ? ` (+${currencySymbol}${effectiveAdd.toFixed(2)})` : ''}</div>`;
                  }).join('') || '';
                }
                return '';
              }).join('')
            : '';

          return `
            <tr>
                <td class="item-name">
                    ${item.name || item.DishName || ''}
                    ${item.songName || item.SongName ? `<div style="font-size: 8.5px; color: #555; font-style: italic; margin-top: 0.5mm;">🎵 ${item.songName || item.SongName}</div>` : ''}
                    ${modifiersHTML}
                    ${comboSelectionsHTML}
                    ${(() => {
                      const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
                      if (discAmt > 0) {
                        const discType = item.discountType || 'percentage';
                        const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
                        const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
                        const effectiveDisc = discType === 'percentage' ? discAmt : Math.min(discAmt, discountBasis);
                        const discStr = discType === 'percentage' ? `-${discAmt}%` : `-${currencySymbol}${effectiveDisc.toFixed(2)}`;
                        return `<div style="font-size: 8.5px; color: #555; font-style: italic; margin-top: 0.5mm;">Discount: ${discStr}</div>`;
                      }
                      return '';
                    })()}
                </td>
                <td class="item-qty">${item.qty || item.quantity}</td>
                <td class="item-price">${currencySymbol}${item.price.toFixed(2)}</td>
                <td class="item-total">${currencySymbol}${(item.price * (item.qty || item.quantity)).toFixed(2)}</td>
            </tr>
          `;
        }).join('');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Invoice_${saleData.invoiceNumber || saleData.id}</title>
        <style>
          body {
            font-family: 'Courier New', Courier, monospace;
            background: #fff;
            margin: 0;
            padding: 0;
          }

          .print-wrapper {
            display: flex;
            justify-content: center;
            align-items: flex-start;
            width: 100%;
            min-height: 100vh;
          }
 
          @page {
            size: 80mm auto;
            margin: 0;
          }
          @media print {
            @page {
              size: 80mm auto;
              margin: 0;
            }
            body { background: white; }
            .print-wrapper {
              display: flex !important;
              justify-content: center !important;
            }
            .receipt {
              margin: 0 !important;
              box-shadow: none !important;
              width: 72mm !important;
            }
          }
          
          .receipt {
            width: 72mm;
            max-width: 72mm;
            background: white;
            padding: 4mm;
            box-shadow: 0 0 10px rgba(0,0,0,0.1); /* Visible on screen */
          }
          
          /* Logo Header */
          .logo-header {
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center; /* ✅ Center logos vertically relative to text */
            margin-bottom: 3mm;
            border-bottom: 2.5px solid #000; /* ✅ Thicker border like reference */
            padding-bottom: 3mm;
          }
          
          .company-logo { width: 45px; height: 45px; object-fit: contain; }
          .halal-logo { width: 45px; height: 45px; object-fit: contain; }
          
          .shop-info { 
            text-align: center; 
            flex: 1; 
            padding: 0 1mm;
          }
          
          .shop-name { 
            font-size: 22px; /* ✅ Bigger font size */
            font-weight: 900; /* ✅ Bolder font weight */
            text-transform: uppercase; 
            letter-spacing: 4px; /* ✅ Wide spacing like MC DONALDS ref */
            line-height: 1.2; 
            margin-bottom: 1.5mm;
            display: block;
            font-family: monospace;
          }
          
          .shop-address { 
            font-size: 8.5px; /* ✅ Slightly smaller for better contrast */
            font-weight: 600; 
            line-height: 1.3; 
            font-family: monospace; 
            white-space: pre-line; 
          }
          .gst-no { font-size: 9px; font-weight: 700; background: #eee; font-family: monospace; padding: 0.5mm; margin: 1mm 0; display: inline-block; }
          .contact { font-size: 9px; font-weight: 700; font-family: monospace; margin-top: 1.5mm; line-height: 1.3; }
          
          /* Reprint Indicator */
          .reprint-indicator {
            text-align: center;
            margin: 1mm 0;
            padding: 0.5mm;
            background: #eee;
            border: 1px dashed #000;
          }
          .reprint-text {
            font-size: 9px;
            font-weight: bold;
          }
          
          /* Bill Details */
          .bill-details {
            margin-bottom: 3mm;
            font-size: 11px;
            font-weight: 700;
          }
          
          .bill-box {
            border: 1px solid #000;
            padding: 1.5mm; /* ✅ Slimmer box */
            margin-bottom: 2mm;
            background: #f9f9f9;
          }
          
          .detail-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 1px;
            font-weight: 700;
          }
          
          .detail-label { font-weight: 800; font-family: monospace; font-size: 10px; }
          .detail-value { font-weight: 800; font-family: monospace; font-size: 10px; }
          
          /* Items Table */
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 3mm;
            font-size: 11px;
            font-family: monospace;
            font-weight: 800;
          }
          
          .items-table th {
            font-weight: 800;
            font-family: monospace;
            text-align: center;
            padding: 1.5mm 0.5mm;
            border-bottom: 1.5px solid #000;
            border-top: 1.5px solid #000;
            text-transform: uppercase;
          }
          
          .items-table th:first-child { text-align: left; }
          .items-table th:last-child { text-align: right; }
          
          .items-table td {
            padding: 1mm 0.5mm;
            border-bottom: 1px dashed #ddd;
            font-weight: 800;
            font-family: monospace;
          }
          
          .item-name { text-align: left; font-weight: 900; max-width: 38mm; }
          .item-modifiers { font-size: 8px; font-weight: normal; color: #444; margin-top: 0.5mm; padding-left: 1mm; }
          .item-qty { text-align: center; font-weight: 900; }
          .item-price { text-align: right; font-weight: 900; }
          .item-total { text-align: right; font-weight: 900; }
          
          /* Discount Section */
          .discount-section {
            margin-bottom: 3mm;
            padding: 1.5mm;
            border: 1px solid #000;
            background: #f9f9f9;
            font-family: monospace;
          }
          
          .discount-title { font-size: 10px; font-weight: 800; text-align: center; margin-bottom: 1mm; }
          .discount-row, .original-row {
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            font-weight: 800;
          }
          
          /* Totals */
          .totals {
            margin-bottom: 3mm;
            font-weight: 900;
            font-family: monospace;
          }
          
          .total-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 1.5px;
            font-size: 11px;
            font-weight: 900;
          }
          
          .grand-total {
            display: flex;
            justify-content: space-between;
            margin-top: 1.5mm;
            padding-top: 1.5mm;
            border-top: 1.5px solid #000;
            font-weight: 900;
            font-size: 13px;
          }
          
          /* Payment Info */
          .payment-info {
            margin-bottom: 3mm;
            font-weight: 700;
            font-family: monospace;
          }
          
          .payment-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 1px;
            font-size: 10px;
            font-weight: 700;
          }
          
          .payment-label { font-weight: 700; }
          .payment-value { font-weight: 700; }
          
          /* Footer */
          .footer {
            text-align: center;
            padding-top: 2mm;
            border-top: 1.5px solid #000;
            font-family: monospace;
          }
          
          .thankyou { font-size: 13px; font-weight: 800; margin-bottom: 1mm; }
          .copyright { font-size: 11px; font-weight: 900; color: #000; }
        </style>
      </head>
      <body>
        <div class="print-wrapper">
          <div class="receipt">
          
          ${saleData.isCheckout ? `
            <div style="text-align: center; border: 2.5px solid #000; padding: 1.5mm; margin-bottom: 4mm; font-weight: 900; font-size: 18px; letter-spacing: 2px;">
              CHECKOUT BILL
            </div>
          ` : ''}

          <!-- Logo Header -->
          <div class="logo-header">
            ${showCompanyLogo && companyLogoUrl ? 
              `<img src="${companyLogoUrl}" class="company-logo" />` : 
              '<div style="width:45px"></div>'
            }
            <div class="shop-info">
              <div class="shop-name">${saleData.shopName || company.name || 'POS SYSTEM'}</div>
              <div class="shop-address">${(saleData.shopAddress || company.address || '').replace(/\n/g, '<br/>')}</div>
              ${(saleData.shopGst || company.gstNo) ? `<div class="gst-no">GST: ${saleData.shopGst || company.gstNo}</div>` : ''}
              <div class="contact">
                ${(saleData.shopPhone || company.phone) ? `<div>Ph: ${saleData.shopPhone || company.phone}</div>` : ''} 
                ${(saleData.shopEmail || company.email) ? `<div>Email: ${saleData.shopEmail || company.email}</div>` : ''}
              </div>
            </div>
            ${showHalalLogo && halalLogoUrl ? 
              `<img src="${halalLogoUrl}" class="halal-logo" />` : 
              '<div style="width:45px"></div>'
            }
          </div>
          
        
          
          <!-- Bill Details - WITH ORIGINAL SALE DATE -->
          <div class="bill-details">
            <div class="bill-box">
              <div class="detail-row">
                <span class="detail-label">INVOICE NO: ${billNo}</span>
                ${saleData.tableNo ? `
                  <span class="detail-value" style="font-size: 14px; font-weight: bold;">
                    ${(saleData.orderType === "TAKEAWAY" || saleData.isTakeaway || String(saleData.tableNo).toUpperCase().includes("TAKEAWAY") || String(saleData.tableNo).toUpperCase().startsWith("TW"))
                      ? 'TAKEAWAY'
                      : `TABLE: ${/^\d+$/.test(String(saleData.tableNo).trim()) ? String(saleData.tableNo).trim().padStart(2, '0') : String(saleData.tableNo).replace(/\s*\(quick serve\)/gi, '')}`
                    }
                  </span>
                ` : ''}
              </div>
              ${saleData.waiterName && saleData.waiterName !== "Staff" ? `
                <div class="detail-row" style="margin-top: 1mm;">
                  <span class="detail-label" style="font-size: 9px; color: #666;">WAITER:</span>
                  <span class="detail-value" style="font-size: 9px; color: #666;">${saleData.waiterName}</span>
                </div>
              ` : ''}
            </div>
            
            <!-- ✅ ORIGINAL SALE DATE (DD/MM/YYYY) -->
            <div class="detail-row">
              <span class="detail-label">DATE:</span>
              <span class="detail-value">
                ${formatToSingaporeDate(saleDate, { day: '2-digit', month: '2-digit', year: 'numeric' })} ${formatToSingaporeTime(saleDate)}
              </span>
            </div>
            
            ${company.cashierName ? `
            <div class="detail-row">
               <span class="detail-label">CASHIER:</span>
               <span class="detail-value">${company.cashierName}</span>
            </div>
            ` : ''}
            ${saleData.mobileNo ? `
            <div class="detail-row">
               <span class="detail-label">MEMBER PHONE:</span>
               <span class="detail-value">${saleData.mobileNo}</span>
            </div>
            ` : ''}
          </div>
          
          <!-- Items Table -->
          <table class="items-table">
            <thead>
              <tr>
                <th style="text-align: left;">ITEM</th>
                <th style="text-align: center;">QTY</th>
                <th style="text-align: right;">PRICE</th>
                <th style="text-align: right;">TOTAL</th>
              </tr>
            </thead>
            <tbody>${itemsHTML}</tbody>
           </table>
          
          <!-- Totals -->
          <div class="totals">
            ${hasAnyDiscount ? `
            <div class="total-row">
              <span>Sub Total:</span>
              <span>${currencySymbol}${originalSubTotal.toFixed(2)}</span>
            </div>
            ${totalItemDiscount > 0 ? `
            <div class="total-row">
              <span>Item Discounts:</span>
              <span>-${currencySymbol}${totalItemDiscount.toFixed(2)}</span>
            </div>
            ` : ''}
            ${hasOrderDiscount ? `
            <div class="total-row">
              <span>Discount${finalDiscountInfo?.type === 'percentage' ? ` (${finalDiscountInfo?.value}%)` : ''}:</span>
              <span>-${currencySymbol}${normalDiscount.toFixed(2)}</span>
            </div>
            ` : ''}
            <div class="total-row" style="margin-top: 1.5mm; border-top: 1px dashed #ccc; padding-top: 1.5mm;">
              <span>Net Amount:</span>
              <span>${currencySymbol}${amountWithoutGST.toFixed(2)}</span>
            </div>
            ` : `
            <div class="total-row">
              <span>Sub Total:</span>
              <span>${currencySymbol}${amountWithoutGST.toFixed(2)}</span>
            </div>
            `}
            
             ${hasSC ? `
             <div class="total-row">
               <span>${allItemsHaveSC ? 'Service Charge' : 'Item Service Charge'}:</span>
               <span>${currencySymbol}${serviceChargeAmount.toFixed(2)}</span>
             </div>
             ` : ''}
             ${takeawayCharge > 0 ? `
              <div class="total-row">
                <span>Takeaway Charges:</span>
                <span>${currencySymbol}${takeawayCharge.toFixed(2)}</span>
              </div>
              ` : ''}
             ${hasGST && gstAmount > 0 ? `
             <div class="total-row">
               <span>GST (${gstRate}%):</span>
               <span>${currencySymbol}${gstAmount.toFixed(2)}</span>
             </div>
             ` : ''}
             ${printedRoundOff && printedRoundOff !== 0 ? `
             <div class="total-row">
               <span>Round Off:</span>
               <span>${printedRoundOff > 0 ? '+' : ''}${currencySymbol}${printedRoundOff.toFixed(2)}</span>
             </div>
             ` : ''}
            <div class="grand-total">
              <span>${hasGST ? 'GRAND TOTAL (incl GST):' : 'GRAND TOTAL:'}</span>
              <span>${currencySymbol}${finalTotal.toFixed(2)}</span>
            </div>
          </div>
          
          <!-- Payment Info -->
          <div class="payment-info">
            ${saleData.isCheckout ? `
              <div class="payment-row" style="margin-top: 5mm; border: 2px solid #000; padding: 2mm; text-align: center; justify-content: center;">
                <span class="payment-label" style="font-size: 14px;">PAYMENT STATUS: PENDING</span>
              </div>
            ` : `
              ${saleData.payments && Array.isArray(saleData.payments) && saleData.payments.length > 0 ? `
                <div style="font-weight: bold; border-top: 1px dashed #ccc; margin-top: 2mm; padding-top: 2mm; font-size: 10px; text-align: left; text-transform: uppercase; margin-bottom: 1.5mm;">PAYMENT DETAILS</div>
                ${saleData.payments.map((p: any) => {
                  let mode = String(p.payMode || p.payModeName || p.Remarks || 'Payment').toUpperCase();
                  if (mode.trim() === "FOC") mode = "FOC (DISCOUNT)";
                  return `
                  <div class="payment-row" style="font-size: 10px; font-weight: 700; display: flex; justify-content: space-between;">
                    <span>${mode}</span>
                    <span>${currencySymbol}${parseFloat(p.amount).toFixed(2)}</span>
                  </div>
                  `;
                }).join('')}
              ` : `
                <div class="payment-row">
                  <span>PAYMENT:</span>
                  <span>${saleData.paymentMethod || 'Cash'}</span>
                </div>
                ${saleData.cashPaid ? `
                <div class="payment-row">
                  <span>PAID:</span>
                  <span>${currencySymbol}${saleData.cashPaid.toFixed(2)}</span>
                </div>
                <div class="payment-row">
                  <span>CHANGE:</span>
                  <span>${currencySymbol}${(saleData.change || 0).toFixed(2)}</span>
                </div>
                ` : ''}
              `}
            `}
            
            <!-- 🏆 Print Reward point transaction stats on PDF Invoice -->
            ${parseFloat(saleData.rewardPointsEarned) > 0 ? `
              <div class="payment-row" style="font-size: 10px; font-weight: 700; display: flex; justify-content: space-between; background: #FFF7ED; padding: 1.5mm; border-radius: 4px; margin-top: 1.5mm;">
                <span style="color: #F97316;">POINTS EARNED:</span>
                <span style="color: #F97316;">+$${parseFloat(saleData.rewardPointsEarned).toFixed(2)}</span>
              </div>
            ` : ''}
            ${parseFloat(saleData.memberRewardBalance) > 0 ? `
              <div class="payment-row" style="font-size: 10px; font-weight: 700; display: flex; justify-content: space-between; padding: 1.5mm 0;">
                <span>AVAILABLE MEMBER CREDIT:</span>
                <span style="color: green;">$${parseFloat(saleData.memberRewardBalance).toFixed(2)}</span>
              </div>
            ` : ''}
          </div>
          
          <!-- Footer -->
          <div class="footer">
            ${saleData.isCheckout ? `
              <div class="thankyou">PLEASE PAY AT THE COUNTER</div>
            ` : `
              <div class="thankyou">THANK YOU! COME AGAIN!</div>
            `}
            <div class="copyright">SMART-CAFE BY UNIPROSG</div>
          </div>
          </div>
        </div>
      </body>
      </html>
    `;
}
  // ✅ Updated generatePDF with discount support
  static async generatePDF(saleData: any, userId?: string | number, discountInfo?: DiscountInfo): Promise<string> {
    try {
      const html = await this.generateHTML(saleData, userId, discountInfo);
      
      const { uri } = await Print.printToFileAsync({
        html: html,
        base64: false,
        width: 302
      });
      
      return uri;
    } catch (error) {
      throw error;
    }
  }

  // ✅ Updated downloadPDF with discount support
  static async downloadPDF(saleData: any, userId?: string | number, discountInfo?: DiscountInfo): Promise<void> {
    try {
      const pdfUri = await this.generatePDF(saleData, userId, discountInfo);
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(pdfUri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Save Receipt',
        });
      } else {
        Alert.alert('✅ Receipt Ready', `Saved at:\n${pdfUri}`);
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to generate receipt');
    }
  }
}

export default BillPDFGenerator;
