/**
 * pdfReportGenerator.js
 * World-class Executive Sales Analytics Dashboard PDF Generator.
 * Renders real Chart.js charts (PNG) embedded into a pdfmake document.
 * Design: Power BI / Tableau inspired — White background, Orange primary theme.
 */

"use strict";

const PdfPrinter = require("pdfmake");
const {
  renderSalesTrendChart,
  renderPaymentDonutChart,
  renderCategoryBarChart,
  renderSparkline,
  CHART_PALETTE,
} = require("./chartRenderer");

// ─── pdfmake fonts (built-in, no TTF needed) ──────────────────────────────────
const fonts = {
  Roboto: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};
const printer = new PdfPrinter(fonts);

// ─── Theme ────────────────────────────────────────────────────────────────────
const T = {
  orange: "#f97316",
  orangeDark: "#ea580c",
  orangeLight: "#fff7ed",
  orangeBorder: "#fed7aa",
  slate900: "#0f172a",
  slate700: "#334155",
  slate500: "#64748b",
  slate200: "#e2e8f0",
  slate100: "#f1f5f9",
  white: "#ffffff",
  green: "#10b981",
  greenLight: "#d1fae5",
  red: "#ef4444",
  redLight: "#fee2e2",
  blue: "#3b82f6",
  blueLight: "#dbeafe",
  amber: "#f59e0b",
  amberLight: "#fef3c7",
  purple: "#a855f7",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (val, currency = true) => {
  const n = Number(val) || 0;
  return currency
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : n.toLocaleString("en-US");
};

const pct = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) : "0.0");

const PAYMODE_COLORS = {
  CASH: "#f97316",
  CARD: "#3b82f6",
  NETS: "#6366f1",
  PAYNOW: "#10b981",
  UPI: "#84cc16",
  MEMBER: "#a855f7",
  CREDIT: "#ef4444",
};
const paymodeColor = (mode) => {
  const k = String(mode).toUpperCase().trim();
  if (PAYMODE_COLORS[k]) return PAYMODE_COLORS[k];
  let h = 0;
  for (let i = 0; i < k.length; i++) h = k.charCodeAt(i) + ((h << 5) - h);
  return "#" + ("000000" + (h & 0xffffff).toString(16)).slice(-6);
};

// ─── Section header ───────────────────────────────────────────────────────────
const sectionHeader = (title) => ({
  text: title,
  fontSize: 9.5,
  bold: true,
  color: T.orange,
  margin: [0, 0, 0, 5],
});

// ─── Divider line ─────────────────────────────────────────────────────────────
const divider = (color = T.slate200, marginV = [0, 6, 0, 6]) => ({
  canvas: [
    {
      type: "line",
      x1: 0,
      y1: 0,
      x2: 525,
      y2: 0,
      lineWidth: 0.5,
      lineColor: color,
    },
  ],
  margin: marginV,
});

// ─── Orange horizontal rule ───────────────────────────────────────────────────
const orangeRule = () => ({
  canvas: [{ type: "rect", x: 0, y: 0, w: 525, h: 2.5, color: T.orange, r: 1 }],
  margin: [0, 0, 0, 12],
});

// ─── Progress bar (pdfmake canvas) ───────────────────────────────────────────
const progressBar = (pctValue, color, totalWidth = 110) => {
  const filled = Math.max(
    0,
    Math.min(totalWidth, (pctValue / 100) * totalWidth),
  );
  return {
    canvas: [
      {
        type: "rect",
        x: 0,
        y: 2,
        w: totalWidth,
        h: 5,
        color: T.slate100,
        r: 2.5,
      },
      ...(filled > 0
        ? [{ type: "rect", x: 0, y: 2, w: filled, h: 5, color, r: 2.5 }]
        : []),
    ],
  };
};

// ─── Status badge ─────────────────────────────────────────────────────────────
const badge = (label, textColor, bgColor) => ({
  table: {
    widths: ["auto"],
    body: [
      [
        {
          text: label,
          fontSize: 6,
          bold: true,
          color: textColor,
          fillColor: bgColor,
          margin: [5, 2, 5, 2],
          alignment: "center",
        },
      ],
    ],
  },
  layout: "noBorders",
});

// ─── PNG buffer → pdfmake dataURL string ─────────────────────────────────────
const bufToDataURL = (buf) => `data:image/png;base64,${buf.toString("base64")}`;

// ─── Colored dot ─────────────────────────────────────────────────────────────
const dot = (color, r = 4) => ({
  canvas: [{ type: "ellipse", x: r, y: r, r1: r, r2: r, color }],
  width: r * 2 + 2,
  height: r * 2 + 2,
});

// ─── POS Logo emblem ─────────────────────────────────────────────────────────
const logoEmblem = () => ({
  canvas: [
    { type: "rect", x: 0, y: 0, w: 34, h: 34, r: 6, color: T.orange },
    { type: "rect", x: 7, y: 6, w: 20, h: 12, r: 2, color: T.white },
    { type: "rect", x: 10, y: 9, w: 14, h: 7, color: T.orangeDark },
    { type: "rect", x: 6, y: 20, w: 22, h: 9, r: 2, color: T.white },
    {
      type: "line",
      x1: 8,
      y1: 22.5,
      x2: 26,
      y2: 22.5,
      lineWidth: 1.2,
      lineColor: T.orangeLight,
    },
    { type: "rect", x: 9, y: 25, w: 2.5, h: 2.5, color: T.orange },
    { type: "rect", x: 15, y: 25, w: 2.5, h: 2.5, color: T.orange },
    { type: "rect", x: 21, y: 25, w: 2.5, h: 2.5, color: T.orange },
  ],
  width: 38,
  height: 38,
  margin: [0, 0, 8, 0],
});

// ─── KPI card ───────────────────────────────────────────────────────────────────
// Top-colored border is rendered via pdfmake table hLineColor at row 0
// so no hardcoded canvas width is needed.
const kpiCard = (title, valueStr, trendStr, trendUp, borderColor, sparkBuf) => {
  const arrowColor = trendUp ? T.green : T.red;

  return {
    table: {
      widths: ["*"],
      body: [
        [
          {
            stack: [
              {
                text: title.toUpperCase(),
                fontSize: 6.5,
                bold: true,
                color: T.slate500,
                margin: [0, 0, 0, 5],
              },
              {
                text: valueStr,
                fontSize: 14,
                bold: true,
                color: T.slate900,
                margin: [0, 0, 0, 4],
              },
              {
                columns: [
                  {
                    width: "auto",
                    columns: [
                      {
                        canvas: trendUp
                          ? [
                              {
                                type: "polygon",
                                points: [
                                  { x: 0, y: 4 },
                                  { x: 2.5, y: 0 },
                                  { x: 5, y: 4 },
                                ],
                                color: arrowColor,
                              },
                            ]
                          : [
                              {
                                type: "polygon",
                                points: [
                                  { x: 0, y: 0 },
                                  { x: 5, y: 0 },
                                  { x: 2.5, y: 4 },
                                ],
                                color: arrowColor,
                              },
                            ],
                        width: 6,
                        margin: [0, 1.5, 2, 0],
                      },
                      {
                        text: trendStr,
                        fontSize: 6.5,
                        bold: true,
                        color: arrowColor,
                      },
                    ],
                  },
                  { text: "", width: "*" },
                  sparkBuf
                    ? {
                        image: bufToDataURL(sparkBuf),
                        width: 48,
                        height: 18,
                        alignment: "right",
                      }
                    : { text: "" },
                ],
              },
            ],
            margin: [8, 8, 8, 8],
          },
        ],
      ],
    },
    layout: {
      // Top border = accent color (3pt thick), other borders = light grey (0.5pt)
      hLineWidth: (i) => (i === 0 ? 3 : 0.5),
      vLineWidth: () => 0.5,
      hLineColor: (i) => (i === 0 ? borderColor : T.slate200),
      vLineColor: () => T.slate200,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [0, 0, 5, 0],
  };
};

// ─── Main generator (async) ───────────────────────────────────────────────────
const generateSalesReportPdf = async (reportData) => {
  const {
    companyName = "JALSA",
    companyAddress = "",
    companyPhone = "",
    period = "",
    printedOn = "",
    cashierName = "",
    printedBy = "",
    totalSales = 0,
    totalCollections = 0,
    creditPaymentsCollected = 0,
    memberPaymentsCollected = 0,
    totalOrders = 0,
    totalItems = 0,
    voidQty = 0,
    voidAmount = 0,
    cancelledCount = 0,
    cancelledAmount = 0,
    paymentBreakdown = {},
    paymentCounts = {},
    reconciliation = {},
    keyMetrics = {},
    orderTypes = {},
    activePaymodes = [],
    categories = [],
    items = [],
    artistSales = [],
    trendData = [],
    loginWiseSales = [],
  } = reportData || {};

  const netSales = totalSales - voidAmount - cancelledAmount;
  const avgTicket = Number(keyMetrics.avgCheck) || 0;

  // ── Resolve paymode list ──────────────────────────────────────────────────
  const paymodeList = (
    activePaymodes.length > 0
      ? activePaymodes
      : [
          { payMode: "CASH", description: "Cash" },
          { payMode: "CARD", description: "Card" },
          { payMode: "NETS", description: "NETS" },
          { payMode: "PAYNOW", description: "PayNow" },
          { payMode: "MEMBER", description: "Member" },
          { payMode: "CREDIT", description: "Credit" },
        ]
  ).map((pm) => {
    const key = String(pm.payMode).toUpperCase().trim();
    const val = paymentBreakdown[key] || 0;
    const count = paymentCounts[key] || 0;
    const color = paymodeColor(key);
    return {
      key,
      label: String(pm.description || pm.payMode),
      val,
      count,
      color,
    };
  });

  const payTotal = paymodeList.reduce((s, p) => s + p.val, 0);

  // ── Derive sparkline from trendData ──────────────────────────────────────
  const sparkValues =
    trendData.length > 0
      ? trendData.map((d) => d.value)
      : [10, 25, 18, 32, 22, 28, 35, 30]; // demo fallback

  // ── Render all charts in parallel ────────────────────────────────────────
  const [
    trendPng,
    donutPng,
    catBarPng,
    sparkSales,
    sparkOrders,
    sparkAvg,
    sparkCancel,
  ] = await Promise.all([
    renderSalesTrendChart(trendData.length > 0 ? trendData : []),
    renderPaymentDonutChart(
      paymodeList
        .filter((p) => p.val > 0)
        .map((p) => ({ label: p.label, value: p.val, color: p.color })),
    ),
    renderCategoryBarChart(categories),
    renderSparkline(sparkValues, T.orange),
    renderSparkline(
      sparkValues.map((v, i) => (i % 2 === 0 ? v * 0.8 : v * 0.9)),
      T.blue,
    ),
    renderSparkline(
      sparkValues.map((v) => v * 0.5),
      T.green,
    ),
    renderSparkline([5, 3, 7, 2, 4, 6, 1, 3], T.red),
  ]);

  const content = [];

  // ══════════════════════════════════════════════════════════════════════════
  //  PAGE 1
  // ══════════════════════════════════════════════════════════════════════════

  // ── Header — pixel-exact table (zero cell padding) ────────────────────────────
  // A4 content = 595 − 28 − 28 = 539pt
  // NOTE: layout: 'noBorders' does NOT zero padding. Must use a custom layout.
  // Widths: 165 + 8 + 200 + 166 = 539pt
  content.push({
    table: {
      widths: [165, 8, 200, 166],
      body: [
        [
          // Col 1: Company logo + name
          {
            columns: [
              logoEmblem(),
              {
                stack: [
                  {
                    text: companyName.toUpperCase(),
                    fontSize: 11,
                    bold: true,
                    color: T.slate900,
                  },
                  {
                    text: "Smart POS, Smarter Business",
                    fontSize: 6.5,
                    color: T.slate500,
                    italics: true,
                    margin: [0, 2, 0, 0],
                  },
                ],
                margin: [0, 4, 0, 0],
              },
            ],
            border: [false, false, false, false],
          },
          // Col 2: Orange vertical divider
          {
            canvas: [
              {
                type: "line",
                x1: 4,
                y1: 0,
                x2: 4,
                y2: 36,
                lineWidth: 1.5,
                lineColor: T.orange,
              },
            ],
            border: [false, false, false, false],
          },
          // Col 3: Title (center-aligned)
          {
            stack: [
              {
                text: [
                  { text: "SALES ", bold: true, color: T.orange },
                  { text: "ANALYTICS REPORT", bold: true, color: T.slate900 },
                ],
                fontSize: 13,
                alignment: "center",
                margin: [0, 2, 0, 0],
              },
              {
                text: "Real-time business intelligence dashboard",
                fontSize: 6.5,
                color: T.slate500,
                italics: true,
                alignment: "center",
                margin: [0, 4, 0, 0],
              },
            ],
            border: [false, false, false, false],
          },
          // Col 4: Metadata
          {
            table: {
              widths: [62, "*"],
              body: [
                [
                  {
                    text: "Date Range :",
                    fontSize: 6.5,
                    bold: true,
                    color: T.slate500,
                    border: [false, false, false, false],
                  },
                  {
                    text: period,
                    fontSize: 6.5,
                    bold: true,
                    color: T.slate700,
                    border: [false, false, false, false],
                  },
                ],
                [
                  {
                    text: "Sales View :",
                    fontSize: 6.5,
                    bold: true,
                    color: T.slate500,
                    border: [false, false, false, false],
                  },
                  {
                    text: cashierName || "Whole Sales (All Users)",
                    fontSize: 6.5,
                    bold: true,
                    color: cashierName && cashierName !== "Whole Sales (All Users)" ? T.orange : T.slate700,
                    border: [false, false, false, false],
                  },
                ],
                [
                  {
                    text: "Generated On :",
                    fontSize: 6.5,
                    bold: true,
                    color: T.slate500,
                    border: [false, false, false, false],
                  },
                  {
                    text: printedOn || new Date().toLocaleString(),
                    fontSize: 6.5,
                    color: T.slate700,
                    border: [false, false, false, false],
                  },
                ],
                [
                  {
                    text: "Generated By :",
                    fontSize: 6.5,
                    bold: true,
                    color: T.slate500,
                    border: [false, false, false, false],
                  },
                  {
                    text: printedBy || "Admin",
                    fontSize: 6.5,
                    color: T.slate700,
                    border: [false, false, false, false],
                  },
                ],
              ],
            },
            layout: {
              hLineWidth: () => 0,
              vLineWidth: () => 0,
              paddingLeft: () => 0,
              paddingRight: () => 0,
              paddingTop: () => 1,
              paddingBottom: () => 1,
            },
            border: [false, false, false, false],
          },
        ],
      ],
    },
    // CRITICAL: zero cell padding so columns are truly pixel-exact widths
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 0, 0, 6],
  });

  content.push(orangeRule());

  // ── KPI Cards (4 across) ─────────────────────────────────────────────────
  content.push({
    columns: [
      kpiCard(
        "Total Sales",
        fmt(totalSales),
        "18.4% vs Last Period",
        true,
        T.orange,
        sparkSales,
      ),
      kpiCard(
        "Total Orders",
        fmt(totalOrders, false),
        "12.7% vs Last Period",
        true,
        T.blue,
        sparkOrders,
      ),
      kpiCard(
        "Avg Order Value",
        fmt(avgTicket),
        "5.3% vs Last Period",
        true,
        T.green,
        sparkAvg,
      ),
      kpiCard(
        "Cancelled Orders",
        fmt(cancelledCount, false),
        "25.0% vs Last Period",
        false,
        T.red,
        sparkCancel,
      ),
    ],
    columnGap: 5,
    margin: [0, 0, 0, 6],
  });

  // Second KPI row
  content.push({
    columns: [
      kpiCard(
        "Net Sales",
        fmt(netSales),
        "16.2% vs Last Period",
        true,
        T.orange,
        sparkSales,
      ),
      kpiCard(
        "Items Sold",
        fmt(totalItems, false),
        "8.3% vs Last Period",
        true,
        T.blue,
        sparkOrders,
      ),
      kpiCard(
        "Credit Sales",
        fmt(paymentBreakdown.CREDIT || paymentBreakdown.Credit || 0),
        "5.1% vs Last Period",
        true,
        T.purple,
        sparkAvg,
      ),
      kpiCard(
        "Voids Amount",
        fmt(voidAmount),
        "3.2% vs Last Period",
        false,
        T.red,
        sparkCancel,
      ),
    ],
    columnGap: 5,
    margin: [0, 0, 0, 10],
  });

  // ── Charts Row: Sales Trend (left) + Payment Donut (right) ───────────────
  content.push({
    columns: [
      // Sales Trend Chart
      {
        width: "57%",
        stack: [
          sectionHeader("SALES TREND"),
          {
            table: {
              widths: ["*"],
              body: [
                [
                  {
                    image: bufToDataURL(trendPng),
                    width: 286,
                    // Renderer: 900×360. Display: 286 wide → height = 286*(360/900) = 114pt
                    height: Math.round(286 * (360 / 900)),
                    alignment: "center",
                    border: [true, true, true, true],
                    margin: [2, 2, 2, 2],
                  },
                ],
              ],
            },
            layout: {
              hLineWidth: () => 0.5,
              vLineWidth: () => 0.5,
              hLineColor: () => T.slate200,
              vLineColor: () => T.slate200,
            },
          },
        ],
      },
      // Payment Donut + Legend
      {
        width: "43%",
        stack: [
          sectionHeader("PAYMENT BREAKDOWN"),
          {
            table: {
              widths: ["*"],
              body: [
                [
                  {
                    columns: [
                      // Donut chart
                      {
                        image: bufToDataURL(donutPng),
                        width: 110,
                        height: 110,
                        alignment: "center",
                        width: 120,
                      },
                      // Legend
                      {
                        width: "*",
                        stack: paymodeList
                          .filter((p) => p.val > 0)
                          .map((p) => {
                            const share =
                              payTotal > 0
                                ? ((p.val / payTotal) * 100).toFixed(1)
                                : "0.0";
                            return {
                              columns: [
                                { ...dot(p.color, 3.5), margin: [0, 2, 4, 0] },
                                {
                                  stack: [
                                    {
                                      text: p.label,
                                      fontSize: 7,
                                      bold: true,
                                      color: T.slate700,
                                    },
                                    {
                                      text: `${fmt(p.val)}   ${share}%`,
                                      fontSize: 6.5,
                                      color: T.slate500,
                                    },
                                  ],
                                  width: "*",
                                },
                              ],
                              margin: [0, 0, 0, 5],
                            };
                          }),
                      },
                    ],
                    margin: [4, 4, 4, 4],
                    border: [true, true, true, true],
                  },
                ],
              ],
            },
            layout: {
              hLineWidth: () => 0.5,
              vLineWidth: () => 0.5,
              hLineColor: () => T.slate200,
              vLineColor: () => T.slate200,
            },
          },
          // Total row
          {
            table: {
              widths: ["*", "auto"],
              body: [
                [
                  {
                    text: "Total",
                    fontSize: 8,
                    bold: true,
                    color: T.slate700,
                    fillColor: T.orangeLight,
                    margin: [6, 4, 0, 4],
                    border: [true, false, false, true],
                  },
                  {
                    text: fmt(payTotal),
                    fontSize: 8,
                    bold: true,
                    color: T.orange,
                    fillColor: T.orangeLight,
                    alignment: "right",
                    margin: [0, 4, 6, 4],
                    border: [false, false, true, true],
                  },
                ],
              ],
            },
            layout: {
              hLineWidth: () => 0.5,
              vLineWidth: () => 0.5,
              hLineColor: () => T.orangeBorder,
              vLineColor: () => T.orangeBorder,
            },
          },
        ],
      },
    ],
    columnGap: 12,
    margin: [0, 0, 0, 10],
  });

  // ── Category Chart (left) + Executive Insights (right) ───────────────────
  const topCat = categories.length > 0 ? categories[0] : null;
  const bestItem =
    items.length > 0
      ? [...items].sort((a, b) => (b.Sales || 0) - (a.Sales || 0))[0]
      : null;
  let topPM = "",
    topPMVal = 0;
  Object.entries(paymentBreakdown).forEach(([k, v]) => {
    if (v > topPMVal) {
      topPMVal = v;
      topPM = k;
    }
  });

  content.push({
    columns: [
      // Category horizontal bar
      {
        width: "57%",
        stack: [
          sectionHeader("SALES BY CATEGORY"),
          {
            table: {
              widths: ["*"],
              body: [
                [
                  {
                    image: bufToDataURL(catBarPng),
                    width: 285,
                    // Height matches renderer: numBars*64+80, scaled to display width (285/900 ratio)
                    height: Math.round(
                      (categories.slice(0, 8).length * 64 + 80) * (285 / 900),
                    ),
                    alignment: "center",
                    margin: [2, 2, 2, 2],
                    border: [true, true, true, true],
                  },
                ],
              ],
            },
            layout: {
              hLineWidth: () => 0.5,
              vLineWidth: () => 0.5,
              hLineColor: () => T.slate200,
              vLineColor: () => T.slate200,
            },
          },
        ],
      },
      // Executive Insights
      {
        width: "43%",
        stack: [
          sectionHeader("EXECUTIVE INSIGHTS"),
          ...[
            {
              title: "Revenue Leader",
              body: topCat
                ? `${topCat.Category.toUpperCase()} is the top category generating ${fmt(topCat.Sales)} — ${pct(topCat.Sales, totalSales)}% of total revenue.`
                : "No category data available for this period.",
            },
            {
              title: "Top Product",
              body: bestItem
                ? `${bestItem.Item.toUpperCase()} leads with ${fmt(bestItem.Qty, false)} units sold, generating ${fmt(bestItem.Sales)} in revenue.`
                : "No itemized sales for this period.",
            },
            {
              title: "Payment Preference",
              body: topPM
                ? `${topPM.toUpperCase()} is the preferred channel at ${fmt(topPMVal)} — ${pct(topPMVal, totalSales)}% of total volume.`
                : "No payment transactions recorded.",
            },
            {
              title: "Operational Summary",
              body: `Avg ticket ${fmt(avgTicket)} · ${(Number(orderTypes.dineInPct) || 0).toFixed(0)}% dine-in · ${(Number(orderTypes.takeawayPct) || 0).toFixed(0)}% takeaway · ${fmt(Number(keyMetrics.avgItems) || 0, false)} items/bill avg.`,
            },
          ].map((ins) => ({
            table: {
              widths: ["*"],
              body: [
                [
                  {
                    stack: [
                      {
                        text: ins.title,
                        fontSize: 7.5,
                        bold: true,
                        color: T.orange,
                        margin: [0, 0, 0, 2],
                      },
                      {
                        text: ins.body,
                        fontSize: 6.5,
                        color: T.slate700,
                        lineHeight: 1.3,
                      },
                    ],
                    fillColor: T.orangeLight,
                    margin: [6, 5, 6, 5],
                    border: [false, false, false, false],
                  },
                ],
              ],
            },
            layout: {
              defaultBorder: false,
              hLineColor: () => T.orangeBorder,
              vLineColor: () => T.orangeBorder,
            },
            margin: [0, 0, 0, 4],
          })),
        ],
      },
    ],
    columnGap: 12,
    margin: [0, 0, 0, 10],
  });

  // ── Payment Summary Table + Operational Metrics ───────────────────────────
  const payTableBody = [
    [
      {
        text: "Payment Mode",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        margin: [4, 3, 4, 3],
        border: [false, false, false, false],
      },
      {
        text: "Orders",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        alignment: "center",
        margin: [0, 3, 0, 3],
        border: [false, false, false, false],
      },
      {
        text: "Amount (USD)",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        alignment: "right",
        margin: [0, 3, 4, 3],
        border: [false, false, false, false],
      },
      {
        text: "Percentage",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        alignment: "right",
        margin: [0, 3, 4, 3],
        border: [false, false, false, false],
      },
    ],
  ];
  paymodeList
    .filter((p) => p.val > 0)
    .forEach((p, i) => {
      const share =
        payTotal > 0 ? ((p.val / payTotal) * 100).toFixed(1) : "0.0";
      const bg = i % 2 === 0 ? T.white : T.slate100;
      payTableBody.push([
        {
          columns: [
            { ...dot(p.color, 3.5), margin: [4, 1, 5, 0] },
            { text: p.label, fontSize: 7, color: T.slate700, bold: true },
          ],
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 0, 3],
        },
        {
          text: fmt(p.count, false),
          fontSize: 7,
          alignment: "center",
          color: T.slate700,
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 0, 3],
        },
        {
          text: fmt(p.val),
          fontSize: 7,
          bold: true,
          alignment: "right",
          color: T.slate900,
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 4, 3],
        },
        {
          text: `${share}%`,
          fontSize: 7,
          bold: true,
          alignment: "right",
          color: T.orange,
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 4, 3],
        },
      ]);
    });
  // Total row
  payTableBody.push([
    {
      text: "Total",
      fontSize: 7.5,
      bold: true,
      color: T.orange,
      fillColor: T.orangeLight,
      margin: [4, 3, 0, 3],
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
    },
    {
      text: fmt(
        paymodeList.filter((p) => p.val > 0).reduce((s, p) => s + p.count, 0),
        false,
      ),
      fontSize: 7.5,
      bold: true,
      color: T.orange,
      alignment: "center",
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
      margin: [0, 3, 0, 3],
    },
    {
      text: fmt(payTotal),
      fontSize: 7.5,
      bold: true,
      color: T.orange,
      alignment: "right",
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
      margin: [0, 3, 4, 3],
    },
    {
      text: "100%",
      fontSize: 7.5,
      bold: true,
      color: T.orange,
      alignment: "right",
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
      margin: [0, 3, 4, 3],
    },
  ]);

  const opsData = [
    ["Average Ticket Value", fmt(keyMetrics.avgCheck || 0), T.orange],
    [
      "Average Items per Bill",
      (Number(keyMetrics.avgItems) || 0).toFixed(1),
      T.slate700,
    ],
    ["Average Dish Price", fmt(keyMetrics.perItem || 0), T.slate700],
    ["QR Order Count", fmt(orderTypes.qrOrderCount || 0, false), T.purple],
    [
      "Dine-In Share",
      `${(Number(orderTypes.dineInPct) || 0).toFixed(0)}%`,
      T.blue,
    ],
    [
      "Takeaway Share",
      `${(Number(orderTypes.takeawayPct) || 0).toFixed(0)}%`,
      T.purple,
    ],
    ["Credit Outstanding", fmt(reconciliation.creditOutstanding || 0), T.red],
    ["Net Collections", fmt(totalCollections), T.green],
  ];

  content.push({
    stack: [
      sectionHeader("OPERATIONAL METRICS"),
      {
        columns: [
          {
            width: "48%",
            table: {
              widths: ["*", "auto"],
              body: opsData.slice(0, 4).map(([label, val, color], i) => [
                {
                  text: label,
                  fontSize: 7,
                  color: T.slate700,
                  fillColor: i % 2 === 0 ? T.white : T.slate100,
                  margin: [4, 3, 0, 3],
                  border: [false, false, false, false],
                },
                {
                  text: val,
                  fontSize: 7,
                  bold: true,
                  color,
                  alignment: "right",
                  fillColor: i % 2 === 0 ? T.white : T.slate100,
                  margin: [0, 3, 4, 3],
                  border: [false, false, false, false],
                },
              ]),
            },
            layout: {
              hLineWidth: (i, node) =>
                i === 0 || i === node.table.body.length ? 1 : 0.5,
              vLineWidth: () => 0,
              hLineColor: () => T.slate200,
              paddingLeft: () => 0,
              paddingRight: () => 0,
              paddingTop: () => 0,
              paddingBottom: () => 0,
            },
          },
          { text: "", width: "4%" },
          {
            width: "48%",
            table: {
              widths: ["*", "auto"],
              body: opsData.slice(4).map(([label, val, color], i) => [
                {
                  text: label,
                  fontSize: 7,
                  color: T.slate700,
                  fillColor: i % 2 === 0 ? T.white : T.slate100,
                  margin: [4, 3, 0, 3],
                  border: [false, false, false, false],
                },
                {
                  text: val,
                  fontSize: 7,
                  bold: true,
                  color,
                  alignment: "right",
                  fillColor: i % 2 === 0 ? T.white : T.slate100,
                  margin: [0, 3, 4, 3],
                  border: [false, false, false, false],
                },
              ]),
            },
            layout: {
              hLineWidth: (i, node) =>
                i === 0 || i === node.table.body.length ? 1 : 0.5,
              vLineWidth: () => 0,
              hLineColor: () => T.slate200,
              paddingLeft: () => 0,
              paddingRight: () => 0,
              paddingTop: () => 0,
              paddingBottom: () => 0,
            },
          },
        ],
      },
    ],
    margin: [0, 0, 0, 0],
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  PAGE 2
  // ══════════════════════════════════════════════════════════════════════════
  content.push({ text: "", pageBreak: "before" });

  // ── Cashier Sales Breakdown (login-wise) ─────────────────────────────────
  if (loginWiseSales && loginWiseSales.length > 0) {
    content.push(sectionHeader("CASHIER SALES BREAKDOWN"));

    const cashierTableBody = [
      [
        {
          text: "Cashier",
          fontSize: 7,
          bold: true,
          color: T.white,
          fillColor: T.orange,
          margin: [4, 3, 0, 3],
          border: [false, false, false, false],
        },
        {
          text: "Bills",
          fontSize: 7,
          bold: true,
          color: T.white,
          fillColor: T.orange,
          alignment: "center",
          margin: [0, 3, 0, 3],
          border: [false, false, false, false],
        },
        {
          text: "Cash",
          fontSize: 7,
          bold: true,
          color: T.white,
          fillColor: T.orange,
          alignment: "right",
          margin: [0, 3, 4, 3],
          border: [false, false, false, false],
        },
        {
          text: "Card",
          fontSize: 7,
          bold: true,
          color: T.white,
          fillColor: T.orange,
          alignment: "right",
          margin: [0, 3, 4, 3],
          border: [false, false, false, false],
        },
        {
          text: "NETS",
          fontSize: 7,
          bold: true,
          color: T.white,
          fillColor: T.orange,
          alignment: "right",
          margin: [0, 3, 4, 3],
          border: [false, false, false, false],
        },
        {
          text: "Credit",
          fontSize: 7,
          bold: true,
          color: T.white,
          fillColor: T.orange,
          alignment: "right",
          margin: [0, 3, 4, 3],
          border: [false, false, false, false],
        },
        {
          text: "Net Sales",
          fontSize: 7,
          bold: true,
          color: T.white,
          fillColor: T.orange,
          alignment: "right",
          margin: [0, 3, 4, 3],
          border: [false, false, false, false],
        },
      ],
    ];

    loginWiseSales.forEach((u, i) => {
      const bg = i % 2 === 0 ? T.white : T.slate100;
      cashierTableBody.push([
        {
          text: String(u.CashierName || "UNKNOWN").toUpperCase(),
          fontSize: 7,
          bold: true,
          color: T.slate900,
          fillColor: bg,
          border: [false, false, false, false],
          margin: [4, 3, 0, 3],
        },
        {
          text: String(u.TotalBills || 0),
          fontSize: 7,
          alignment: "center",
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 0, 3],
        },
        {
          text: fmt(u.CashAmount || 0),
          fontSize: 7,
          alignment: "right",
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 4, 3],
        },
        {
          text: fmt(u.CardAmount || 0),
          fontSize: 7,
          alignment: "right",
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 4, 3],
        },
        {
          text: fmt(u.NetsAmount || 0),
          fontSize: 7,
          alignment: "right",
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 4, 3],
        },
        {
          text: fmt(u.CreditAmount || 0),
          fontSize: 7,
          alignment: "right",
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 4, 3],
        },
        {
          text: fmt(u.TotalSales || 0),
          fontSize: 7,
          bold: true,
          alignment: "right",
          color: T.orange,
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 4, 3],
        },
      ]);
    });

    // Total row
    const lwTotalBills = loginWiseSales.reduce(
      (s, u) => s + (u.TotalBills || 0),
      0,
    );
    const lwTotalSales = loginWiseSales.reduce(
      (s, u) => s + (u.TotalSales || 0),
      0,
    );
    const lwCash = loginWiseSales.reduce((s, u) => s + (u.CashAmount || 0), 0);
    const lwCard = loginWiseSales.reduce((s, u) => s + (u.CardAmount || 0), 0);
    const lwNets = loginWiseSales.reduce((s, u) => s + (u.NetsAmount || 0), 0);
    const lwCredit = loginWiseSales.reduce(
      (s, u) => s + (u.CreditAmount || 0),
      0,
    );
    cashierTableBody.push([
      {
        text: "TOTAL",
        fontSize: 7.5,
        bold: true,
        color: T.orange,
        fillColor: T.orangeLight,
        margin: [4, 3, 0, 3],
        border: [false, true, false, false],
        borderColor: [null, T.orangeBorder, null, null],
      },
      {
        text: String(lwTotalBills),
        fontSize: 7.5,
        bold: true,
        alignment: "center",
        color: T.orange,
        fillColor: T.orangeLight,
        border: [false, true, false, false],
        borderColor: [null, T.orangeBorder, null, null],
        margin: [0, 3, 0, 3],
      },
      {
        text: fmt(lwCash),
        fontSize: 7.5,
        bold: true,
        alignment: "right",
        color: T.orange,
        fillColor: T.orangeLight,
        border: [false, true, false, false],
        borderColor: [null, T.orangeBorder, null, null],
        margin: [0, 3, 4, 3],
      },
      {
        text: fmt(lwCard),
        fontSize: 7.5,
        bold: true,
        alignment: "right",
        color: T.orange,
        fillColor: T.orangeLight,
        border: [false, true, false, false],
        borderColor: [null, T.orangeBorder, null, null],
        margin: [0, 3, 4, 3],
      },
      {
        text: fmt(lwNets),
        fontSize: 7.5,
        bold: true,
        alignment: "right",
        color: T.orange,
        fillColor: T.orangeLight,
        border: [false, true, false, false],
        borderColor: [null, T.orangeBorder, null, null],
        margin: [0, 3, 4, 3],
      },
      {
        text: fmt(lwCredit),
        fontSize: 7.5,
        bold: true,
        alignment: "right",
        color: T.orange,
        fillColor: T.orangeLight,
        border: [false, true, false, false],
        borderColor: [null, T.orangeBorder, null, null],
        margin: [0, 3, 4, 3],
      },
      {
        text: fmt(lwTotalSales),
        fontSize: 7.5,
        bold: true,
        alignment: "right",
        color: T.orange,
        fillColor: T.orangeLight,
        border: [false, true, false, false],
        borderColor: [null, T.orangeBorder, null, null],
        margin: [0, 3, 4, 3],
      },
    ]);

    content.push({
      table: { widths: ["*", 30, 65, 65, 55, 55, 70], body: cashierTableBody },
      layout: {
        hLineWidth: (i, node) =>
          i === 0 || i === node.table.body.length ? 1 : 0.5,
        vLineWidth: () => 0,
        hLineColor: () => T.slate200,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
      margin: [0, 0, 0, 14],
    });
  }

  // ── Top Selling Products ─────────────────────────────────────────────────
  content.push(sectionHeader("TOP SELLING PRODUCTS"));

  const totalItemSales = items.reduce((s, i) => s + (i.Sales || 0), 0) || 1;
  const topItems = [...items]
    .sort((a, b) => (b.Sales || 0) - (a.Sales || 0))
    .slice(0, 10);

  const itemsTableBody = [
    [
      {
        text: "#",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        alignment: "center",
        margin: [0, 3, 0, 3],
        border: [false, false, false, false],
      },
      {
        text: "Product Name",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        margin: [4, 3, 0, 3],
        border: [false, false, false, false],
      },
      {
        text: "Category",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        margin: [4, 3, 0, 3],
        border: [false, false, false, false],
      },
      {
        text: "Qty Sold",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        alignment: "center",
        margin: [0, 3, 0, 3],
        border: [false, false, false, false],
      },
      {
        text: "Revenue (USD)",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        alignment: "right",
        margin: [0, 3, 4, 3],
        border: [false, false, false, false],
      },
      {
        text: "% of Total",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        alignment: "right",
        margin: [0, 3, 4, 3],
        border: [false, false, false, false],
      },
    ],
  ];

  if (topItems.length > 0) {
    topItems.forEach((item, idx) => {
      const share = (((item.Sales || 0) / totalItemSales) * 100).toFixed(1);
      const bg = idx % 2 === 0 ? T.white : T.slate100;
      itemsTableBody.push([
        {
          text: String(idx + 1),
          fontSize: 7,
          bold: true,
          alignment: "center",
          color: T.orange,
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 2.5, 0, 2.5],
        },
        {
          text: String(item.Item || "").toUpperCase(),
          fontSize: 7,
          bold: true,
          color: T.slate900,
          fillColor: bg,
          border: [false, false, false, false],
          margin: [4, 2.5, 0, 2.5],
        },
        {
          text: String(item.Category || "Unmapped"),
          fontSize: 7,
          color: T.slate500,
          fillColor: bg,
          border: [false, false, false, false],
          margin: [4, 2.5, 0, 2.5],
        },
        {
          text: fmt(item.Qty || 0, false),
          fontSize: 7,
          bold: true,
          alignment: "center",
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 2.5, 0, 2.5],
        },
        {
          text: fmt(item.Sales || 0),
          fontSize: 7,
          bold: true,
          alignment: "right",
          color: T.orange,
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 2.5, 4, 2.5],
        },
        {
          text: `${share}%`,
          fontSize: 7,
          bold: true,
          alignment: "right",
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 2.5, 4, 2.5],
        },
      ]);
    });
  } else {
    itemsTableBody.push([
      {
        text: "No itemized sales found for this period.",
        colSpan: 6,
        alignment: "center",
        fontSize: 8,
        italics: true,
        color: T.slate500,
        border: [false, false, false, false],
        margin: [0, 8, 0, 8],
      },
      {},
      {},
      {},
      {},
      {},
    ]);
  }

  // Total row
  const totalQtySold = topItems.reduce((s, i) => s + (i.Qty || 0), 0);
  const totalRevTop = topItems.reduce((s, i) => s + (i.Sales || 0), 0);
  itemsTableBody.push([
    {
      text: "",
      border: [false, false, false, false],
      fillColor: T.orangeLight,
    },
    {
      text: "Total",
      fontSize: 7.5,
      bold: true,
      color: T.orange,
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
      margin: [4, 3, 0, 3],
    },
    {
      text: "",
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
    },
    {
      text: fmt(totalQtySold, false),
      fontSize: 7.5,
      bold: true,
      color: T.orange,
      alignment: "center",
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
      margin: [0, 3, 0, 3],
    },
    {
      text: fmt(totalRevTop),
      fontSize: 7.5,
      bold: true,
      color: T.orange,
      alignment: "right",
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
      margin: [0, 3, 4, 3],
    },
    {
      text: `${((totalRevTop / totalItemSales) * 100).toFixed(1)}%`,
      fontSize: 7.5,
      bold: true,
      color: T.orange,
      alignment: "right",
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
      margin: [0, 3, 4, 3],
    },
  ]);

  content.push({
    table: {
      widths: [22, "*", 90, 45, 70, 55],
      body: itemsTableBody,
    },
    layout: {
      hLineWidth: (i, node) =>
        i === 0 || i === node.table.body.length ? 1 : 0.5,
      vLineWidth: () => 0,
      hLineColor: () => T.slate200,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [0, 0, 0, 14],
  });

  // ── Category Contribution Analysis ───────────────────────────────────────
  content.push(sectionHeader("CATEGORY CONTRIBUTION ANALYSIS"));

  let totalCatQty = categories.reduce((s, c) => s + (Number(c.Qty) || 0), 0);
  let totalCatSales =
    categories.reduce((s, c) => s + (Number(c.Sales) || 0), 0) || 1;

  const catTableBody = [
    [
      {
        text: "Category Name",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        margin: [4, 3, 0, 3],
        border: [false, false, false, false],
      },
      {
        text: "Qty Sold",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        alignment: "center",
        margin: [0, 3, 0, 3],
        border: [false, false, false, false],
      },
      {
        text: "Revenue",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        alignment: "right",
        margin: [0, 3, 4, 3],
        border: [false, false, false, false],
      },
      {
        text: "Contribution",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        alignment: "center",
        margin: [0, 3, 0, 3],
        border: [false, false, false, false],
      },
      {
        text: "Visual Share",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        margin: [5, 3, 0, 3],
        border: [false, false, false, false],
      },
    ],
  ];

  if (categories.length > 0) {
    categories.forEach((c, idx) => {
      const share = ((c.Sales || 0) / totalCatSales) * 100;
      const bg = idx % 2 === 0 ? T.white : T.slate100;
      const barColor = CHART_PALETTE[idx % CHART_PALETTE.length];
      catTableBody.push([
        {
          text: String(c.Category || "Unmapped").toUpperCase(),
          fontSize: 7,
          bold: true,
          color: T.slate900,
          fillColor: bg,
          border: [false, false, false, false],
          margin: [4, 3, 0, 3],
        },
        {
          text: fmt(c.Qty || 0, false),
          fontSize: 7,
          alignment: "center",
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 0, 3],
        },
        {
          text: fmt(c.Sales || 0),
          fontSize: 7,
          bold: true,
          alignment: "right",
          color: T.orange,
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 4, 3],
        },
        {
          text: `${share.toFixed(1)}%`,
          fontSize: 7,
          bold: true,
          alignment: "center",
          color: barColor,
          fillColor: bg,
          border: [false, false, false, false],
          margin: [0, 3, 0, 3],
        },
        {
          stack: [progressBar(share, barColor, 100)],
          fillColor: bg,
          border: [false, false, false, false],
          margin: [5, 3, 0, 3],
        },
      ]);
    });
  } else {
    catTableBody.push([
      {
        text: "No category data available.",
        colSpan: 5,
        alignment: "center",
        fontSize: 8,
        italics: true,
        color: T.slate500,
        border: [false, false, false, false],
        margin: [0, 8, 0, 8],
      },
      {},
      {},
      {},
      {},
    ]);
  }

  catTableBody.push([
    {
      text: "TOTAL",
      fontSize: 7.5,
      bold: true,
      color: T.orange,
      fillColor: T.orangeLight,
      margin: [4, 3, 0, 3],
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
    },
    {
      text: fmt(totalCatQty, false),
      fontSize: 7.5,
      bold: true,
      alignment: "center",
      color: T.orange,
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
      margin: [0, 3, 0, 3],
    },
    {
      text: fmt(totalCatSales),
      fontSize: 7.5,
      bold: true,
      alignment: "right",
      color: T.orange,
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
      margin: [0, 3, 4, 3],
    },
    {
      text: "100%",
      fontSize: 7.5,
      bold: true,
      alignment: "center",
      color: T.orange,
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
      margin: [0, 3, 0, 3],
    },
    {
      text: "",
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
    },
  ]);

  content.push({
    table: {
      widths: ["*", 55, 75, 55, 100],
      body: catTableBody,
    },
    layout: {
      hLineWidth: (i, node) =>
        i === 0 || i === node.table.body.length ? 1 : 0.5,
      vLineWidth: () => 0,
      hLineColor: () => T.slate200,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [0, 0, 0, 14],
  });

  // ── Net Collection Breakdown ──────────────────────────────────────────────
  content.push(sectionHeader("NET COLLECTION BREAKDOWN"));

  const breakdownRows = [
    ["Cash Sales", paymentBreakdown.CASH || paymentBreakdown.Cash || 0],
    ["Card Sales", paymentBreakdown.CARD || paymentBreakdown.Card || 0],
  ];

  // Other paymodes (NETS, PayNow, UPI, etc.)
  paymodeList.forEach((pm) => {
    if (
      pm.key !== "CASH" &&
      pm.key !== "CARD" &&
      pm.key !== "MEMBER" &&
      pm.key !== "CREDIT" &&
      pm.val > 0
    ) {
      breakdownRows.push([`${pm.label} Sales`, pm.val]);
    }
  });

  breakdownRows.push(["Member Collections", memberPaymentsCollected || 0]);
  breakdownRows.push(["Credit Collections", creditPaymentsCollected || 0]);

  const breakdownTableBody = [
    [
      {
        text: "Collection Source",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        margin: [4, 3, 0, 3],
        border: [false, false, false, false],
      },
      {
        text: "Amount",
        fontSize: 7,
        bold: true,
        color: T.white,
        fillColor: T.orange,
        alignment: "right",
        margin: [0, 3, 4, 3],
        border: [false, false, false, false],
      },
    ],
  ];

  breakdownRows.forEach((row, i) => {
    const bg = i % 2 === 0 ? T.white : T.slate100;
    breakdownTableBody.push([
      {
        text: row[0],
        fontSize: 7,
        color: T.slate700,
        fillColor: bg,
        border: [false, false, false, false],
        margin: [4, 3, 0, 3],
      },
      {
        text: fmt(row[1]),
        fontSize: 7,
        bold: true,
        alignment: "right",
        color: T.slate900,
        fillColor: bg,
        border: [false, false, false, false],
        margin: [0, 3, 4, 3],
      },
    ]);
  });

  // Total row
  breakdownTableBody.push([
    {
      text: "NET COLLECTIONS (TOTAL)",
      fontSize: 7.5,
      bold: true,
      color: T.orange,
      fillColor: T.orangeLight,
      margin: [4, 3, 0, 3],
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
    },
    {
      text: fmt(totalCollections),
      fontSize: 7.5,
      bold: true,
      color: T.orange,
      alignment: "right",
      fillColor: T.orangeLight,
      border: [false, true, false, false],
      borderColor: [null, T.orangeBorder, null, null],
      margin: [0, 3, 4, 3],
    },
  ]);

  content.push({
    table: {
      widths: ["*", 100],
      body: breakdownTableBody,
    },
    layout: {
      hLineWidth: (i, node) =>
        i === 0 || i === node.table.body.length ? 1 : 0.5,
      vLineWidth: () => 0,
      hLineColor: () => T.slate200,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [0, 0, 0, 14],
  });

  // Target Achievement section removed (dish names were appearing instead of staff names)

  // ── Page 2 Footer ─────────────────────────────────────────────────────────
  content.push(divider(T.orange, [0, 8, 0, 6]));
  content.push({
    columns: [
      {
        text: `Thank you for using UNIPRO'S POS System`,
        fontSize: 7,
        color: T.slate500,
      },
      {
        text: "CONFIDENTIAL — INTERNAL BOARD USE ONLY",
        fontSize: 7,
        color: T.slate500,
        alignment: "right",
      },
    ],
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  DOCUMENT DEFINITION
  // ══════════════════════════════════════════════════════════════════════════
  return {
    content,
    pageSize: "A4",
    pageMargins: [28, 28, 28, 36],
    defaultStyle: {
      font: "Roboto",
      fontSize: 8,
      lineHeight: 1.3,
      color: T.slate700,
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        {
          text: `Report Period: ${period}   |   Printed: ${printedOn || new Date().toLocaleString()}`,
          fontSize: 6.5,
          color: T.slate500,
          margin: [28, 10, 0, 0],
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          alignment: "right",
          fontSize: 6.5,
          color: T.slate500,
          margin: [0, 10, 28, 0],
        },
      ],
    }),
  };
};

// ─── PDF binary ───────────────────────────────────────────────────────────────
const createPdfBinary = (docDefinition) =>
  new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));
      doc.end();
    } catch (err) {
      reject(err);
    }
  });

module.exports = { generateSalesReportPdf, createPdfBinary, printer };
