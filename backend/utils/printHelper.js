/**
 * printHelper.js
 * Backend utility to format ESC/POS thermal text for KOT, KDS, and Payment Receipt prints.
 * Mirrors UniversalPrinter.ts logic so the backend can queue print jobs directly into
 * PrintJobQueue without relying on the frontend.
 *
 * Adheres strictly to General Settings toggles:
 * - EnableKOT: Enable / disable kitchen ticket printing.
 * - EnableKDS & EnableKDSPrint: Enable / disable KDS display and printing.
 * - EnableComboPrint ("Disable Combo Print"): If ON (true), do not print combo sub-items on KOT. If OFF (false), print them.
 * - EnableReceiptPrint ("Print Receipt"): If ON (true), print receipt automatically on payment. If OFF (false), skip printing.
 */

// In-memory cache to prevent duplicate print jobs within 10 minutes
const recentJobsCache = new Map();
function isDuplicateJob(key, ttlMs = 10 * 60 * 1000) {
  const now = Date.now();
  for (const [k, ts] of recentJobsCache.entries()) {
    if (now - ts > ttlMs) recentJobsCache.delete(k);
  }
  if (recentJobsCache.has(key)) return true;
  recentJobsCache.set(key, now);
  return false;
}

/**
 * Format two columns on a 48-column thermal printer line.
 * Strips formatting tags like <B>, </B>, <font ...>, </font> when measuring column width.
 */
function formatTwoCols48(left, right) {
  const plainLeft = String(left || "").replace(/<[^>]*>/g, "");
  const plainRight = String(right || "").replace(/<[^>]*>/g, "");
  const spaces = 48 - plainLeft.length - plainRight.length;
  if (spaces > 0) {
    return `[L]${left}${" ".repeat(spaces)}${right}\n`;
  }
  return `[L]${left}\n[L]${String(right || "").padStart(48, " ")}\n`;
}

/**
 * Word-wrap a string to fit within `maxChars` per line.
 */
function _wrapText(str, maxChars) {
  const words = String(str || "").split(" ");
  const result = [];
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
}

/**
 * Format a single item row for KOT / KDS ESC/POS output.
 * @param {object} item
 * @param {boolean} disableComboPrint - if true, combo sub-items are omitted
 */
function _formatItem(item, disableComboPrint = false) {
  let text = "";
  const qtyNum = item.quantity || item.qty || 1;
  const itemName = item.name || item.DishName || "";

  const DISH_WRAP = 20;
  const BIG_MOD_WRAP = 20;

  _wrapText(itemName.replace(/\n/g, " "), DISH_WRAP).forEach((chunk, idx) => {
    if (idx === 0) {
      text += `[L]<font size='big'><B>[${qtyNum}] ${chunk}</B></font>\n`;
    } else {
      text += `[L]<font size='big'><B>    ${chunk}</B></font>\n`;
    }
  });

  // Song name
  const songName = item.songName || item.SongName || "";
  if (songName) text += `[L]<font size='big'><B>  ♪ ${songName}</B></font>\n`;

  // Takeaway flag
  const isTakeaway = !!(item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway);
  if (isTakeaway) text += `[L]<font size='big'><B>  >> TAKEAWAY <<</B></font>\n`;

  // Modifiers
  if (item.modifiers && item.modifiers.length > 0) {
    item.modifiers.forEach((m) => {
      const modName = m.ModifierName || m.modifierName || m.name || m.ModifierNameEn || "";
      if (modName) {
        _wrapText(modName, BIG_MOD_WRAP).forEach((chunk, idx) => {
          text += idx === 0
            ? `[L]<font size='big'><B>  + ${chunk}</B></font>\n`
            : `[L]<font size='big'><B>    ${chunk}</B></font>\n`;
        });
      }
    });
  }

  // Combo selections (skipped if Disable Combo Print toggle is ON)
  if (!disableComboPrint) {
    let comboSels = item.comboSelections || item.selectedCombos || item.combos;
    if (!comboSels || (Array.isArray(comboSels) && comboSels.length === 0)) {
      const rawCombo = item.ComboDetailsJSON || item.comboDetailsJSON || item.ComboDetails || item.comboDetails;
      if (rawCombo) {
        if (typeof rawCombo === "string") {
          try {
            const parsed = JSON.parse(rawCombo);
            comboSels = Array.isArray(parsed) ? parsed : (parsed.groups || parsed.items || parsed.selections || []);
          } catch (e) {
            comboSels = [];
          }
        } else if (Array.isArray(rawCombo)) {
          comboSels = rawCombo;
        } else if (typeof rawCombo === "object") {
          comboSels = rawCombo.groups || rawCombo.items || rawCombo.selections || [];
        }
      }
    }

    if (Array.isArray(comboSels) && comboSels.length > 0) {
      comboSels.forEach((g) => {
        const choices = g.items || g.dishes || g.selections || g.selectedDishes || (Array.isArray(g) ? g : (g.name || g.DishName || g.itemName ? [g] : []));
        if (Array.isArray(choices)) {
          choices.forEach((opt) => {
            const optName = opt.name || opt.DishName || opt.itemName || "";
            if (optName) {
              _wrapText(optName, BIG_MOD_WRAP).forEach((chunk, idx) => {
                text += idx === 0
                  ? `[L]<font size='big'><B>  - ${chunk}</B></font>\n`
                  : `[L]<font size='big'><B>    ${chunk}</B></font>\n`;
              });
            }
          });
        }
      });
    }
  }

  // Remarks / Note
  const noteText = item.note || item.notes || item.Remarks || item.remarks;
  if (noteText) {
    _wrapText(noteText, BIG_MOD_WRAP).forEach((chunk, idx) => {
      text += idx === 0
        ? `[L]<font size='big'><B>  * ${chunk}</B></font>\n`
        : `[L]<font size='big'><B>    ${chunk}</B></font>\n`;
    });
  }

  return text;
}

/**
 * Format KOT or KDS thermal ESC/POS text.
 * @param {object} data - { orderId, orderNo, tableNo, waiterName, items, kitchenName }
 * @param {string} type - 'NEW' | 'ADDITIONAL' | 'REPRINT' | 'KDS_PRINT'
 * @param {boolean} disableComboPrint - if true, omit combo sub-items
 * @returns {string} ESC/POS formatted text
 */
function formatKOTThermalText(data, type = "NEW", disableComboPrint = false) {
  const title =
    type === "KDS_PRINT"    ? "KDS PRINT"
    : type === "REPRINT"    ? "REPRINT"
    : type === "ADDITIONAL" ? "ADDITIONAL ORDER"
    : "NEW ORDER";

  const items       = (data.items || []).filter((i) => (i.status || i.Status || "").toUpperCase() !== "VOIDED");
  const tableNo     = data.tableNo     || "N/A";
  const rawWaiter   = data.waiterName  || "Staff";
  const isTakeaway  = (tableNo || "").toUpperCase().startsWith("TW") || (tableNo || "").toUpperCase().includes("TAKEAWAY");
  const isQuick     = !!(data.isQuickServe || data.isQuick || data.isQuickServeMode || data.orderContext?.isQuickServe || data.context?.orderType === "QUICK_SERVE" || data.orderType === "QUICK_SERVE" || data.section === "QUICK_SERVE" || (typeof rawWaiter === "string" && rawWaiter.toLowerCase().includes("(quick serve)")));
  const cleanTableNo = (tableNo || "").replace(/^table\s+/gi, "").trim() || tableNo;
  const displayTable = isQuick ? (cleanTableNo.toLowerCase().includes("(quick serve)") ? cleanTableNo : `${cleanTableNo} (quick serve)`) : tableNo;
  const waiter      = isQuick ? (rawWaiter.replace(/\s*\(quick serve\)/gi, "").trim() || "Staff") : rawWaiter;
  const orderNo     = data.orderNo     || data.orderId || "";
  const kitchenName = data.kitchenName || "";

  // Timestamp formatted in Asia/Singapore
  const now = data.date ? new Date(data.date) : (data.createdAt ? new Date(data.createdAt) : new Date());
  const dateStr = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", day: "2-digit", month: "2-digit", year: "2-digit" }).format(now);
  const timeStr = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);

  const DIV = "[L]------------------------------------------------\n";

  let text = "";
  // White space at top
  text += "[L]\n".repeat(4);
  text += `[C]<font size='big'><B>${title}</B></font>\n`;
  text += `[C]<B>${dateStr}  ${timeStr}</B>\n`;
  text += DIV;

  // TABLE or TAKEAWAY at top
  const shortOrderNo = orderNo ? `#${String(orderNo).slice(-4)}` : "";
  let tableHeader = "";
  if (isTakeaway) {
    const cleanTw = String(displayTable).replace(/\s*\(quick serve\)/gi, "").trim();
    const formattedTw = cleanTw.toUpperCase().startsWith("TW") ? cleanTw.toUpperCase() : `TW${cleanTw}`;
    tableHeader = shortOrderNo ? `TW - ${formattedTw} ${shortOrderNo}` : `TAKEAWAY: ${displayTable}`;
  } else {
    tableHeader = `TABLE: ${displayTable}`;
  }
  text += `[C]<font size='big'><B>${tableHeader}</B></font>\n`;
  text += DIV;

  text += "[L]<B>QTY  ITEM</B>\n";
  text += DIV;

  // Group items by kitchen section
  const groups = {};
  items.forEach((item) => {
    const k = (item.KitchenTypeName || item.kitchenTypeName || item.dishGroupName || item.categoryName || "KITCHEN").toUpperCase().trim();
    if (!groups[k]) groups[k] = [];
    groups[k].push(item);
  });

  const groupEntries = Object.entries(groups);
  groupEntries.forEach(([kName, groupItems], gIdx) => {
    if (type === "KDS_PRINT" || groupEntries.length > 1) {
      text += `[C]<B>--- ${kName} ---</B>\n`;
      text += DIV;
    }
    groupItems.forEach((item, idx) => {
      text += _formatItem(item, disableComboPrint);
      if (idx < groupItems.length - 1) text += "[L]\n";
    });
    text += DIV;
  });

  // Footer
  text += `[L]<B>Order By : ${waiter}</B>\n`;
  text += `[L]<B>Order No : ${orderNo}</B>\n`;

  if (type !== "KDS_PRINT") {
    const cleanTw = String(tableNo).replace(/\s*\(quick serve\)/gi, "").trim();
    const formattedTw = cleanTw.toUpperCase().startsWith("TW") ? cleanTw.toUpperCase() : `TW${cleanTw}`;
    const twBottomLabel = shortOrderNo ? `TW - ${formattedTw} ${shortOrderNo}` : `T.NO : ${tableNo}`;

    const kotLabel = kitchenName && kitchenName !== "KDS"
      ? (tableNo && tableNo !== "N/A"
          ? (isTakeaway ? `${kitchenName.toUpperCase()}  /  ${twBottomLabel}` : `${kitchenName.toUpperCase()}  /  T.NO : ${tableNo}`)
          : kitchenName.toUpperCase())
      : (tableNo && tableNo !== "N/A"
          ? (isTakeaway ? twBottomLabel : `T.NO : ${tableNo}`)
          : "");
    if (kotLabel) {
      text += DIV;
      text += `[C]<B>${kotLabel}</B>\n`;
      text += DIV;
    }
  }

  text += "[L]\n";
  return text;
}

/**
 * Format thermal receipt text (mirrors UniversalPrinter.formatThermalTextWithDiscount).
 * @param {object} saleData - { invoiceNumber, tableNo, total, paymentMethod, items, payments, ... }
 * @param {object} companySettings - { ShopName, CompanyName, Address, Phone, Email, GSTPercentage, ServiceChargePercentage, CurrencySymbol, TakeawayCharges }
 * @param {object} discountInfo - { applied, type, value, amount }
 * @returns {string} ESC/POS formatted receipt text
 */
function formatReceiptThermalText(saleData, companySettings = {}, discountInfo = null) {
  const symbol = companySettings.CurrencySymbol || companySettings.currencySymbol || "$";
  const storeName = (companySettings.ShopName || companySettings.CompanyName || companySettings.name || "YOUR STORE").toUpperCase();
  const address = companySettings.Address || companySettings.address || "";
  const phone = companySettings.Phone || companySettings.phone || "";
  const email = companySettings.Email || companySettings.email || "";

  let text = "\n\n[C]================================================\n";
  text += "[C]<font size='big'><B>PAYMENT RECEIPT</B></font>\n";
  text += "[C]================================================\n";
  text += `[C]<font size='big'><B>${storeName}</B></font>\n`;
  if (address) text += `[C]${address}\n`;
  if (phone) text += `[C]Tel: ${phone}\n`;
  if (email) text += `[C]Email: ${email}\n`;
  text += "[C]------------------------------------------------\n";

  const saleDate = saleData.date ? new Date(saleData.date) : new Date();
  const dateStr = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", day: "2-digit", month: "2-digit", year: "numeric" }).format(saleDate);
  const rawTimeStr = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hour12: true }).format(saleDate).replace(/[\u202F\u00A0\uFEFF]/g, ' ');
  const timeStr = rawTimeStr.replace(/(am|pm)/gi, (m) => m.toUpperCase());

  const billNo =
    saleData.invoiceNumber ||
    saleData.billNo ||
    saleData.BillNo ||
    saleData.id ||
    saleData.orderNumber ||
    saleData.orderNo ||
    saleData.orderId ||
    "";
  const tableNo = String(saleData.tableNo || "").trim();
  const isTakeaway = saleData.orderType === "TAKEAWAY" || saleData.isTakeaway || tableNo.toUpperCase().startsWith("TW") || tableNo.toUpperCase().includes("TAKEAWAY");

  if (isTakeaway) {
    const shortOrderNo = billNo ? String(billNo).slice(-4) : "";
    const twLabel = shortOrderNo ? `TW#${shortOrderNo}` : "TW";
    text += formatTwoCols48(`<B>Bill No: ${billNo}</B>`, `<B>${twLabel}</B>`);
  } else if (tableNo) {
    const cleanTableNo = tableNo.replace(/\s*\(quick serve\)/gi, "").replace(/^table\s+/gi, "").trim();
    text += formatTwoCols48(`<B>Bill No: ${billNo}</B>`, `<B>TABLE: ${cleanTableNo}</B>`);
  } else {
    text += `[L]<B>Bill No: ${billNo}</B>\n`;
  }

  text += `[L]<B>Date: ${dateStr} ${timeStr}</B>\n`;
  if (saleData.customerName) {
    text += `[L]<B>Customer: ${saleData.customerName}</B>\n`;
  } else if (saleData.waiterName && saleData.waiterName !== "Staff") {
    text += `[L]<B>Waiter: ${saleData.waiterName}</B>\n`;
  }
  if (saleData.mobileNo || saleData.phone) {
    text += `[L]<B>Member Phone: ${saleData.mobileNo || saleData.phone}</B>\n`;
  }
  text += "[L]------------------------------------------------\n";

  // Items Header
  text += "[L]<B>ITEM                        QTY   PRICE    TOTAL</B>\n";
  text += "[L]------------------------------------------------\n";

  const printItems = (saleData.items || []).filter((i) => (i.status || "").toUpperCase() !== "VOIDED" && i.statusCode !== 0);

  let grossTotal = 0;
  let totalItemDiscount = 0;

  printItems.forEach((item) => {
    const rawName = item.name || item.DishName || item.ProductName || "";
    const name = rawName.substring(0, 26).padEnd(26);
    const qtyNum = parseInt(String(item.qty || item.quantity || 1)) || 1;
    const qty = `[${qtyNum}]`.padStart(5);
    const priceNum = parseFloat(String(item.price || item.Price || item.PricePerUnit || 0)) || 0;
    const price = `${symbol}${priceNum.toFixed(2)}`.padStart(8);
    const totalNum = priceNum * qtyNum;
    const total = `${symbol}${totalNum.toFixed(2)}`.padStart(9);

    text += `[L]<B>${name}${qty}${price}${total}</B>\n`;

    const songName = item.songName || item.SongName || "";
    if (songName) text += `[L]<B>   ♪ ${songName}</B>\n`;

    if (rawName.length > 26) {
      text += `[L]<B>   ${rawName}</B>\n`;
    }

    // Modifiers
    if (item.modifiers && Array.isArray(item.modifiers)) {
      item.modifiers.forEach((m) => {
        const mName = (m.ModifierName || m.modifierName || m.name || "").trim();
        if (mName) text += `[L]<B>   + ${mName}</B>\n`;
      });
    }

    // Combos
    const comboSels = item.comboSelections || [];
    if (Array.isArray(comboSels) && comboSels.length > 0) {
      comboSels.forEach((g) => {
        const choices = g.items || g.dishes || (Array.isArray(g) ? g : [g]);
        if (Array.isArray(choices)) {
          choices.forEach((opt) => {
            const optName = opt.name || opt.DishName || opt.itemName || "";
            if (optName) text += `[L]<B>   - ${optName}</B>\n`;
          });
        }
      });
    }

    // Item Discount
    const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
    if (discAmt > 0) {
      const discType = item.discountType || "percentage";
      const effectiveDisc = discType === "percentage" ? (totalNum * (discAmt / 100)) : (discAmt * qtyNum);
      totalItemDiscount += effectiveDisc;
      const discStr = discType === "percentage" ? `-${discAmt}%` : `-${symbol}${effectiveDisc.toFixed(2)}`;
      text += `[L]<B>      Discount: ${discStr}</B>\n`;
    }

    grossTotal += totalNum;
  });

  text += "[L]------------------------------------------------\n";

  // Discount calculation
  const orderDiscount = Number(saleData.discountAmount || (discountInfo?.amount || 0));
  const hasAnyDiscount = totalItemDiscount > 0 || orderDiscount > 0;
  const currentSubtotal = Math.max(0, grossTotal - totalItemDiscount - orderDiscount);

  text += formatTwoCols48("<B>Sub Total:</B>", `<B>${symbol}${grossTotal.toFixed(2)}</B>`);

  if (totalItemDiscount > 0) {
    text += formatTwoCols48("<B>Item Discounts:</B>", `<B>-${symbol}${totalItemDiscount.toFixed(2)}</B>`);
  }

  if (orderDiscount > 0) {
    const discLabel = discountInfo?.type === "percentage"
      ? `<B>Discount (${discountInfo.value}%):</B>`
      : "<B>Discount:</B>";
    text += formatTwoCols48(discLabel, `<B>-${symbol}${orderDiscount.toFixed(2)}</B>`);
  }

  if (hasAnyDiscount) {
    text += "[L]------------------------------------------------\n";
    text += formatTwoCols48("<B>Net Amount:</B>", `<B>${symbol}${currentSubtotal.toFixed(2)}</B>`);
  }

  // Charges & Taxes
  const serviceCharge = Number(saleData.serviceCharge || 0);
  const takeawayCharge = Number(saleData.takeawayCharge || 0);
  const gstRate = Number(companySettings.GSTPercentage || companySettings.gstPercentage || 0);
  const totalTax = Number(saleData.totalTax || 0);

  if (serviceCharge > 0) {
    text += formatTwoCols48("<B>Service Charge:</B>", `<B>${symbol}${serviceCharge.toFixed(2)}</B>`);
  }

  if (takeawayCharge > 0) {
    text += formatTwoCols48("<B>Takeaway Charges:</B>", `<B>${symbol}${takeawayCharge.toFixed(2)}</B>`);
  }

  if (totalTax > 0 || gstRate > 0) {
    const taxVal = totalTax > 0 ? totalTax : (currentSubtotal + serviceCharge + takeawayCharge) * (gstRate / 100);
    if (taxVal > 0) {
      text += formatTwoCols48(`<B>GST (${gstRate}%):</B>`, `<B>${symbol}${taxVal.toFixed(2)}</B>`);
      text += "[L]------------------------------------------------\n";
    }
  }

  const roundOff = Number(saleData.roundOff || saleData.roundedBy || 0);
  if (roundOff !== 0) {
    const roSign = roundOff > 0 ? "+" : "";
    text += formatTwoCols48("<B>Round Off:</B>", `<B>${roSign}${symbol}${roundOff.toFixed(2)}</B>`);
    text += "[L]------------------------------------------------\n";
  }

  // Payment Details
  const finalTotal = Number(saleData.total || saleData.totalAmount || (currentSubtotal + serviceCharge + takeawayCharge + totalTax));
  const payments = Array.isArray(saleData.payments) && saleData.payments.length > 0 ? saleData.payments : [];

  if (!text.endsWith("[L]------------------------------------------------\n")) {
    text += "[L]------------------------------------------------\n";
  }

  // Payment mode & Cash tender tracking
  let hasCashPayment = false;
  let totalCashReceived = 0;
  let totalChangeReturn = 0;

  if (!text.endsWith("[L]------------------------------------------------\n")) {
    text += "[L]------------------------------------------------\n";
  }

  if (payments.length > 0) {
    payments.forEach((p) => {
      let modeText = String(p.payMode || p.payModeName || p.Remarks || "Payment");
      if (modeText.toUpperCase().trim() === "FOC") modeText = "FOC (Discount)";
      const mUpper = modeText.toUpperCase().trim();
      const isCash = mUpper === "CASH" || mUpper === "CAS" || mUpper.includes("CASH");
      const displayLabel = isCash ? "Cash:" : `${modeText}:`;
      const amountVal = `${symbol}${parseFloat(p.amount || p.Amount || finalTotal).toFixed(2)}`;
      text += formatTwoCols48(`<B>${displayLabel}</B>`, `<B>${amountVal}</B>`);

      if (isCash) {
        hasCashPayment = true;
        const pAmt = parseFloat(p.amount || p.Amount || finalTotal) || 0;
        const cashRec = (saleData.cashReceived !== undefined && saleData.cashReceived !== null && Number(saleData.cashReceived) > 0)
          ? Number(saleData.cashReceived)
          : (saleData.cashPaid !== undefined && saleData.cashPaid !== null && Number(saleData.cashPaid) > 0)
            ? Number(saleData.cashPaid)
            : pAmt;
        const changeRet = (saleData.changeReturn !== undefined && saleData.changeReturn !== null)
          ? Number(saleData.changeReturn)
          : (saleData.change !== undefined && saleData.change !== null)
            ? Number(saleData.change)
            : Math.max(0, cashRec - pAmt);
        totalCashReceived = cashRec;
        totalChangeReturn = changeRet;
      }
    });
  } else {
    const methodText = String(saleData.paymentMethod || saleData.payMode || "Payment");
    const mUpper = methodText.toUpperCase().trim();
    const isCash = mUpper === "CASH" || mUpper === "CAS" || mUpper.includes("CASH");
    const displayLabel = isCash ? "Cash:" : `${methodText}:`;
    const amountVal = `${symbol}${parseFloat(finalTotal).toFixed(2)}`;
    text += formatTwoCols48(`<B>${displayLabel}</B>`, `<B>${amountVal}</B>`);

    if (isCash) {
      hasCashPayment = true;
      const totAmt = parseFloat(finalTotal) || 0;
      const cashRec = (saleData.cashReceived !== undefined && saleData.cashReceived !== null && Number(saleData.cashReceived) > 0)
        ? Number(saleData.cashReceived)
        : (saleData.cashPaid !== undefined && saleData.cashPaid !== null && Number(saleData.cashPaid) > 0)
          ? Number(saleData.cashPaid)
          : totAmt;
      const changeRet = (saleData.changeReturn !== undefined && saleData.changeReturn !== null)
        ? Number(saleData.changeReturn)
        : (saleData.change !== undefined && saleData.change !== null)
          ? Number(saleData.change)
          : Math.max(0, cashRec - totAmt);
      totalCashReceived = cashRec;
      totalChangeReturn = changeRet;
    }
  }
  text += "[L]------------------------------------------------\n";

  text += `[R]<font size='big'><B>TOTAL: ${symbol}${finalTotal.toFixed(2)}</B></font>\n`;
  text += "[L]------------------------------------------------\n";

  if (hasCashPayment) {
    text += formatTwoCols48(`<B>Cash Received:</B>`, `<B>${symbol}${totalCashReceived.toFixed(2)}</B>`);
    text += formatTwoCols48(`<B>Change Return:</B>`, `<B>${symbol}${totalChangeReturn.toFixed(2)}</B>`);
  }

  // 💳 NETS Transaction Info (Section 2 of UAT Certification Requirements)
  if (saleData.receiptText || saleData.netsInfo) {
    text += "[L]------------------------------------------------\n";
    text += "[C]<B>--- NETS TRANSACTION ---</B>\n";
    if (saleData.receiptText) {
      const cleanReceipt = String(saleData.receiptText).trim();
      cleanReceipt.split('\n').forEach(line => {
        if (line.trim()) text += `[L]<B>${line.trim()}</B>\n`;
      });
    } else if (saleData.netsInfo) {
      const info = saleData.netsInfo;
      if (info.terminalId) text += formatTwoCols48("MID / TID:", `${info.terminalId}`);
      if (info.stan) text += formatTwoCols48("STAN:", `${info.stan}`);
      if (info.approvalCode) text += formatTwoCols48("APPROVAL CODE:", `${info.approvalCode}`);
      if (info.rrn) text += formatTwoCols48("REF NO (RRN):", `${info.rrn}`);
      if (info.cardName) text += formatTwoCols48("CARD:", `${info.cardName}`);
    }
  }

  text += "[C]================================================\n";
  text += "[C]<B>THANK YOU! COME AGAIN!</B>\n";
  text += "[C]SMART-CAFE BY UNIPROSG\n";

  return text.replace(/[\u202F\u00A0\uFEFF]/g, " ");
}

/**
 * Queue KOT, KDS, and Payment Receipt print jobs directly into PrintJobQueue for a QR order.
 * Strictly respects General Settings toggles:
 * - EnableKOT: skips KOT print if disabled
 * - EnableKDS / EnableKDSPrint: skips KDS print if disabled
 * - EnableComboPrint: if ON (true), does not print combo sub-items on KOT
 * - EnableReceiptPrint: if ON (true) and order is paid, prints payment receipt
 *
 * @param {object} pool  - mssql connection pool
 * @param {object} sql   - mssql sql object
 * @param {object} opts  - { orderId, tableNo, sentItems, isAdditional, isPaid, payMode, io, ... }
 */
async function queueQRPrintJobs(pool, sql, opts = {}) {
  const { orderId, tableNo: initialTableNo, isAdditional = false, isPaid = false, payMode = "Yeahpay Paynow", io } = opts;
  const STORE_ID = "STORE_001";

  if (!orderId) {
    console.warn("[PrintHelper] Cannot queue print jobs: Missing orderId");
    return;
  }

  // 1. Fetch AppSettings & CompanySettings
  let appSettings = {};
  let companySettings = {};
  try {
    const appRes = await pool.request().query("SELECT TOP 1 * FROM AppSettings");
    if (appRes.recordset.length > 0) appSettings = appRes.recordset[0];
    const compRes = await pool.request().query("SELECT TOP 1 * FROM CompanySettings");
    if (compRes.recordset.length > 0) companySettings = compRes.recordset[0];
  } catch (err) {
    console.error("⚠️ [PrintHelper] Error fetching settings:", err.message);
  }

  const enableKOT = appSettings.EnableKOT !== false && appSettings.EnableKOT !== 0;
  const enableKDS = appSettings.EnableKDS !== false && appSettings.EnableKDS !== 0;
  const enableKDSPrint = appSettings.EnableKDSPrint !== false && appSettings.EnableKDSPrint !== 0;
  // Note: Toggle in General Settings is labelled "Disable Combo Print".
  // When EnableComboPrint == 1 / true, combo sub-items are NOT printed.
  const disableComboPrint = appSettings.EnableComboPrint === true || appSettings.EnableComboPrint === 1;
  const enableReceiptPrint = appSettings.EnableReceiptPrint !== false && appSettings.EnableReceiptPrint !== 0;

  console.log(`[PrintHelper] Settings toggles for order ${orderId}: EnableKOT=${enableKOT}, EnableKDS=${enableKDS}, EnableKDSPrint=${enableKDSPrint}, DisableComboPrint=${disableComboPrint}, EnableReceiptPrint=${enableReceiptPrint}, isPaid=${isPaid}`);

  // 2. Fetch order details & items from database if needed
  let sentItems = opts.sentItems || [];
  let tableNo = initialTableNo;
  let orderHeader = null;

  try {
    const ordRes = await pool.request()
      .input("ordNo", sql.NVarChar(50), String(orderId).trim())
      .query(`
        SELECT TOP 1 * FROM RestaurantOrderCur 
        WHERE OrderNumber = @ordNo OR (TRY_CAST(@ordNo AS UNIQUEIDENTIFIER) IS NOT NULL AND OrderId = TRY_CAST(@ordNo AS UNIQUEIDENTIFIER))
        ORDER BY CreatedOn DESC
      `);
    if (ordRes.recordset.length > 0) {
      orderHeader = ordRes.recordset[0];
      if (!tableNo || tableNo === "N/A" || tableNo === "TAKEAWAY") {
        tableNo = orderHeader.Tableno || tableNo;
      }
    }
  } catch (err) {
    console.warn("[PrintHelper] Could not fetch order header:", err.message);
  }

  // If items weren't passed or empty, query active items from RestaurantOrderDetailCur
  if (!sentItems || sentItems.length === 0) {
    try {
      const itemsRes = await pool.request()
        .input("ordNo", sql.NVarChar(50), String(orderId).trim())
        .query(`
          SELECT 
            d.OrderDetailId as lineItemId, d.DishId as id, d.Quantity as qty, 
            d.PricePerUnit as price, ISNULL(NULLIF(d.DishName, ''), dish.Name) as name,
            d.Remarks as note, d.isTakeAway as isTakeaway,
            d.ModifiersJSON, d.ComboDetailsJSON,
            ISNULL(ckt.KitchenTypeCode, '2') as KitchenTypeCode,
            ISNULL(ISNULL(ckt.KitchenTypeName, cat.CategoryName), 'KITCHEN') as KitchenTypeName
          FROM RestaurantOrderDetailCur d
          INNER JOIN RestaurantOrderCur h ON d.OrderId = h.OrderId
          LEFT JOIN DishMaster dish ON d.DishId = dish.DishId
          LEFT JOIN DishGroupMaster dgm ON dish.DishGroupId = dgm.DishGroupId
          LEFT JOIN CategoryMaster cat ON dgm.CategoryId = cat.CategoryId
          LEFT JOIN CategoryKitchenType ckt ON dgm.CategoryId = ckt.CategoryId
          WHERE (h.OrderNumber = @ordNo OR d.OrderNumber = @ordNo OR (TRY_CAST(@ordNo AS UNIQUEIDENTIFIER) IS NOT NULL AND h.OrderId = TRY_CAST(@ordNo AS UNIQUEIDENTIFIER)))
            AND d.StatusCode IN (1, 2)
        `);

      sentItems = (itemsRes.recordset || []).map((row) => {
        let mods = [];
        if (row.ModifiersJSON) {
          try { mods = JSON.parse(row.ModifiersJSON); } catch (e) {}
        }
        let combos = [];
        if (row.ComboDetailsJSON) {
          try { combos = JSON.parse(row.ComboDetailsJSON); } catch (e) {}
        }
        return {
          ...row,
          modifiers: mods,
          comboSelections: combos,
          isCombo: !!combos && (Array.isArray(combos) ? combos.length > 0 : !!combos.groups),
        };
      });
    } catch (err) {
      console.warn("[PrintHelper] Could not fetch items from DB:", err.message);
    }
  }

  let queuedAny = false;

  // ── A. KOT PRINTING ────────────────────────────────────────────────────────
  if (!enableKOT) {
    console.log(`[PrintHelper] ⏸️ KOT printing is DISABLED in General Settings — skipping KOT for order ${orderId}`);
  } else if (sentItems.length > 0) {
    const type = isAdditional ? "ADDITIONAL" : "NEW";
    // Group items by KitchenTypeCode
    const kitchenGroups = {};
    sentItems.forEach((item) => {
      const kCode = String(item.KitchenTypeCode || item.kitchenTypeCode || "0");
      if (!kitchenGroups[kCode]) {
        kitchenGroups[kCode] = {
          items: [],
          kitchenName: item.KitchenTypeName || item.kitchenTypeName || "KITCHEN",
          kitchenTypeValue: kCode,
        };
      }
      kitchenGroups[kCode].items.push(item);
    });

    for (const [kCode, group] of Object.entries(kitchenGroups)) {
      const kotJobKey = `KOT:${orderId}:${kCode}:${type}`;
      if (isDuplicateJob(kotJobKey)) {
        console.log(`[PrintHelper] ⏸️ Duplicate KOT print prevented for ${kotJobKey}`);
        continue;
      }

      const kotData = {
        orderId,
        orderNo: orderId,
        tableNo,
        waiterName: "QR Order",
        items: group.items,
        kitchenName: group.kitchenName,
      };
      const thermalText = formatKOTThermalText(kotData, type, disableComboPrint);

      // Resolve kitchen printer from PrintMaster
      let printerIp = "";
      let printerName = "";
      try {
        const printerRes = await pool.request()
          .input("KTN", sql.NVarChar(100), group.kitchenName || "")
          .input("KTV", sql.NVarChar(50), kCode)
          .query(`
            SELECT TOP 1 ISNULL(NULLIF(PrinterIP, ''), NULLIF(PrinterPath, '')) as PrinterIP, PrinterName
            FROM PrintMaster
            WHERE PrinterType = 2
              AND (LOWER(TRIM(KitchenTypeName)) = LOWER(TRIM(@KTN)) OR CAST(KitchenTypeValue AS VARCHAR(50)) = @KTV)
              AND IsActive = 1 AND IsEnabled = 1
              AND (PrinterIP IS NOT NULL AND PrinterIP <> '' OR PrinterPath IS NOT NULL AND PrinterPath <> '')
          `);
        if (printerRes.recordset.length > 0) {
          printerIp   = printerRes.recordset[0].PrinterIP;
          printerName = printerRes.recordset[0].PrinterName;
        }
      } catch (err) {
        console.warn(`[PrintHelper] Could not resolve kitchen printer for ${group.kitchenName}:`, err.message);
      }

      if (!printerIp) {
        console.warn(`[PrintHelper] No kitchen printer IP for kitchen="${group.kitchenName}" (KTV=${kCode}) — skipping KOT`);
        continue;
      }

      const jobId = require("crypto").randomUUID();
      try {
        await pool.request()
          .input("JobId",       sql.UniqueIdentifier, jobId)
          .input("StoreId",     sql.NVarChar(50),     STORE_ID)
          .input("PrinterName", sql.NVarChar(100),    printerName)
          .input("PrinterIp",   sql.NVarChar(100),    printerIp)
          .input("PrinterPort", sql.Int,              9100)
          .input("Content",     sql.NVarChar(sql.MAX), thermalText)
          .query(`
            INSERT INTO PrintJobQueue
              (JobId, StoreId, PrinterName, PrinterIp, PrinterPort, Content, Status, CreatedOn)
            VALUES
              (@JobId, @StoreId, @PrinterName, @PrinterIp, @PrinterPort, @Content, 'PENDING', GETDATE())
          `);
        console.log(`[PrintHelper] ✅ KOT queued for "${group.kitchenName}" → ${printerIp} [job: ${jobId}]`);
        queuedAny = true;
      } catch (err) {
        console.error(`[PrintHelper] ❌ Failed to insert KOT print job:`, err.message);
      }
    }
  }

  // ── B. KDS PRINTING ────────────────────────────────────────────────────────
  if (!enableKDS || !enableKDSPrint) {
    console.log(`[PrintHelper] ⏸️ KDS printing is DISABLED in General Settings (enableKDS=${enableKDS}, enableKDSPrint=${enableKDSPrint}) — skipping KDS for order ${orderId}`);
  } else if (sentItems.length > 0) {
    const kdsJobKey = `KDS:${orderId}`;
    if (!isDuplicateJob(kdsJobKey)) {
      try {
        const kdsRes = await pool.request().query(`
          SELECT TOP 1 ISNULL(NULLIF(PrinterIP, ''), NULLIF(PrinterPath, '')) as PrinterIP, PrinterName
          FROM PrintMaster
          WHERE PrinterType = 4 AND IsActive = 1
            AND (PrinterIP IS NOT NULL AND PrinterIP <> '' OR PrinterPath IS NOT NULL AND PrinterPath <> '')
        `);

        if (kdsRes.recordset.length > 0) {
          const { PrinterIP, PrinterName } = kdsRes.recordset[0];
          const kdsData = {
            orderId,
            orderNo: orderId,
            tableNo,
            waiterName: "QR Order",
            items: sentItems,
            kitchenName: "KDS",
          };
          const kdsText = formatKOTThermalText(kdsData, "KDS_PRINT", false);
          const kdsJobId = require("crypto").randomUUID();
          await pool.request()
            .input("JobId",       sql.UniqueIdentifier, kdsJobId)
            .input("StoreId",     sql.NVarChar(50),     STORE_ID)
            .input("PrinterName", sql.NVarChar(100),    PrinterName)
            .input("PrinterIp",   sql.NVarChar(100),    PrinterIP)
            .input("PrinterPort", sql.Int,              9100)
            .input("Content",     sql.NVarChar(sql.MAX), kdsText)
            .query(`
              INSERT INTO PrintJobQueue
                (JobId, StoreId, PrinterName, PrinterIp, PrinterPort, Content, Status, CreatedOn)
              VALUES
                (@JobId, @StoreId, @PrinterName, @PrinterIp, @PrinterPort, @Content, 'PENDING', GETDATE())
            `);
          console.log(`[PrintHelper] ✅ KDS queued → ${PrinterIP} [job: ${kdsJobId}]`);
          queuedAny = true;
        } else {
          console.warn("[PrintHelper] No active KDS printer (PrinterType=4) configured in PrintMaster");
        }
      } catch (kdsErr) {
        console.warn("[PrintHelper] KDS print queue error:", kdsErr.message);
      }
    } else {
      console.log(`[PrintHelper] ⏸️ Duplicate KDS print prevented for ${kdsJobKey}`);
    }
  }

  // ── C. PAYMENT RECEIPT PRINTING ───────────────────────────────────────────
  if (!isPaid) {
    console.log(`[PrintHelper] ⏸️ Order ${orderId} is not paid yet — skipping payment receipt.`);
  } else if (!enableReceiptPrint) {
    console.log(`[PrintHelper] ⏸️ Receipt printing is DISABLED in General Settings — skipping receipt for order ${orderId}`);
  } else {
    const receiptJobKey = `RECEIPT:${orderId}`;
    if (!isDuplicateJob(receiptJobKey)) {
      try {
        // Resolve Receipt Printer: First try Takeaway printer (PrinterType=3), then Cashier printer (PrinterType=1)
        const isTakeaway = (tableNo || "").toUpperCase().startsWith("TW") || (tableNo || "").toUpperCase().includes("TAKEAWAY");
        let receiptPrinterRes = null;

        if (isTakeaway) {
          receiptPrinterRes = await pool.request().query(`
            SELECT TOP 1 ISNULL(NULLIF(PrinterIP, ''), NULLIF(PrinterPath, '')) as PrinterIP, PrinterName
            FROM PrintMaster
            WHERE PrinterType = 3 AND IsActive = 1 AND IsEnabled = 1
              AND (PrinterIP IS NOT NULL AND PrinterIP <> '' OR PrinterPath IS NOT NULL AND PrinterPath <> '')
          `);
        }

        if (!receiptPrinterRes || receiptPrinterRes.recordset.length === 0) {
          receiptPrinterRes = await pool.request().query(`
            SELECT TOP 1 ISNULL(NULLIF(PrinterIP, ''), NULLIF(PrinterPath, '')) as PrinterIP, PrinterName
            FROM PrintMaster
            WHERE PrinterType = 1 AND IsActive = 1 AND IsEnabled = 1
              AND (PrinterIP IS NOT NULL AND PrinterIP <> '' OR PrinterPath IS NOT NULL AND PrinterPath <> '')
          `);
        }

        let receiptPrinterIp = receiptPrinterRes?.recordset?.[0]?.PrinterIP || companySettings.PrinterIP || "";
        let receiptPrinterName = receiptPrinterRes?.recordset?.[0]?.PrinterName || "Receipt Printer";

        if (!receiptPrinterIp) {
          console.warn("[PrintHelper] No active receipt printer IP found in PrintMaster or CompanySettings — skipping receipt");
        } else {
          // Construct saleData for receipt
          const discountAmt = Number(orderHeader?.DiscountAmount ?? opts.discountAmount ?? 0);
          const saleData = {
            invoiceNumber: orderId,
            orderNumber: orderId,
            tableNo,
            customerName: orderHeader?.CustomerName || opts.customerName || null,
            mobileNo: orderHeader?.Phone || opts.mobileNo || null,
            date: orderHeader?.CreatedOn || new Date(),
            items: sentItems,
            total: Number(orderHeader?.TotalAmount ?? opts.totalAmount ?? 0),
            totalAmount: Number(orderHeader?.TotalAmount ?? opts.totalAmount ?? 0),
            serviceCharge: Number(orderHeader?.ServiceCharge ?? 0),
            takeawayCharge: Number(orderHeader?.TakeawayCharge ?? opts.takeawayCharge ?? 0),
            totalTax: Number(orderHeader?.TotalTax ?? 0),
            discountAmount: discountAmt,
            discountType: orderHeader?.DiscountType || "percentage",
            roundOff: Number(orderHeader?.RoundedBy ?? 0),
            payMode: payMode,
            payments: [{ payMode, amount: Number(orderHeader?.TotalAmount ?? opts.totalAmount ?? 0) }],
          };

          const discountInfo = discountAmt > 0 ? {
            applied: true,
            type: orderHeader?.DiscountType || "percentage",
            value: Number(orderHeader?.DiscountPercentage ?? 0),
            amount: discountAmt,
          } : null;

          const receiptThermalText = formatReceiptThermalText(saleData, companySettings, discountInfo);
          const receiptJobId = require("crypto").randomUUID();

          await pool.request()
            .input("JobId",       sql.UniqueIdentifier, receiptJobId)
            .input("StoreId",     sql.NVarChar(50),     STORE_ID)
            .input("PrinterName", sql.NVarChar(100),    receiptPrinterName)
            .input("PrinterIp",   sql.NVarChar(100),    receiptPrinterIp)
            .input("PrinterPort", sql.Int,              9100)
            .input("Content",     sql.NVarChar(sql.MAX), receiptThermalText)
            .query(`
              INSERT INTO PrintJobQueue
                (JobId, StoreId, PrinterName, PrinterIp, PrinterPort, Content, Status, CreatedOn)
              VALUES
                (@JobId, @StoreId, @PrinterName, @PrinterIp, @PrinterPort, @Content, 'PENDING', GETDATE())
            `);
          console.log(`[PrintHelper] ✅ Payment Receipt queued for "${receiptPrinterName}" → ${receiptPrinterIp} [job: ${receiptJobId}]`);
          queuedAny = true;
        }
      } catch (receiptErr) {
        console.error("[PrintHelper] ❌ Failed to queue payment receipt print job:", receiptErr.message);
      }
    } else {
      console.log(`[PrintHelper] ⏸️ Duplicate receipt print prevented for ${receiptJobKey}`);
    }
  }

  // 3. Emit print_jobs_available if any jobs were inserted
  if (queuedAny && io) {
    try {
      io.emit("print_jobs_available", { orderId, storeId: STORE_ID });
    } catch (e) {}
  }
}

module.exports = {
  formatTwoCols48,
  formatKOTThermalText,
  formatReceiptThermalText,
  queueQRPrintJobs,
};
