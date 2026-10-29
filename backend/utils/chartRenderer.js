/**
 * chartRenderer.js
 * Renders Chart.js charts to PNG buffers for embedding into pdfmake PDFs.
 * Uses chartjs-node-canvas for server-side rendering.
 */

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

// ─── Color Palette ────────────────────────────────────────────────────────────
const ORANGE       = '#f97316';
const ORANGE_DARK  = '#ea580c';
const ORANGE_LIGHT = '#fed7aa';
const SLATE_DARK   = '#1e293b';
const SLATE_MID    = '#475569';
const SLATE_LIGHT  = '#f1f5f9';
const WHITE        = '#ffffff';

// Predefined palette for payment modes / categories
const CHART_PALETTE = [
  '#f97316', // orange
  '#3b82f6', // blue
  '#10b981', // green
  '#a855f7', // purple
  '#ef4444', // red
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#6366f1', // indigo
];

/**
 * Create a ChartJSNodeCanvas instance with given dimensions.
 */
const makeCanvas = (width, height) =>
  new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: WHITE,
    chartCallback: (ChartJS) => {
      ChartJS.defaults.font.family = 'sans-serif';
    }
  });

// ─── Sales Trend Bar Chart ────────────────────────────────────────────────────
/**
 * Renders a bar chart showing sales trend over time (hourly or daily).
 * @param {Array<{label:string, value:number}>} trendData
 * @returns {Promise<Buffer>} PNG buffer
 */
async function renderSalesTrendChart(trendData = []) {
  // Render at 2x resolution for crisp PDF embedding
  const width  = 900;
  const height = 360;
  const canvas = makeCanvas(width, height);

  const labels = trendData.map(d => d.label);
  const values = trendData.map(d => d.value);
  const maxVal = Math.max(...values, 1);

  const config = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Sales ($)',
        data: values,
        backgroundColor: values.map(v =>
          v === maxVal && v > 0 ? ORANGE_DARK : ORANGE
        ),
        borderColor: 'transparent',
        borderRadius: 6,
        borderSkipped: false,
        barPercentage: 0.75,
        categoryPercentage: 0.8,
      }]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'start',
          labels: {
            color: SLATE_MID,
            font: { size: 16, weight: 'bold' },
            boxWidth: 18,
            padding: 16
          }
        },
        tooltip: { enabled: false }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: SLATE_MID,
            font: { size: 13 },
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: 16
          }
        },
        y: {
          grid: { color: '#f1f5f9', lineWidth: 1.5 },
          border: { display: false, dash: [4, 4] },
          ticks: {
            color: SLATE_MID,
            font: { size: 13 },
            callback: v => `$${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}`
          },
          beginAtZero: true
        }
      },
      layout: { padding: { top: 8, right: 20, bottom: 10, left: 10 } }
    }
  };

  return canvas.renderToBuffer(config);
}

// ─── Payment Donut Chart ──────────────────────────────────────────────────────
/**
 * Renders a donut chart for payment mode breakdown.
 * @param {Array<{label:string, value:number, color:string}>} segments
 * @returns {Promise<Buffer>} PNG buffer
 */
async function renderPaymentDonutChart(segments = []) {
  // 2x canvas for sharp PDF embed
  const width  = 500;
  const height = 380;
  const canvas = makeCanvas(width, height);

  const active = segments.filter(s => s.value > 0);
  if (active.length === 0) {
    active.push({ label: 'No Data', value: 1, color: SLATE_LIGHT });
  }

  const config = {
    type: 'doughnut',
    data: {
      labels: active.map(s => s.label),
      datasets: [{
        data: active.map(s => s.value),
        backgroundColor: active.map((s, i) => s.color || CHART_PALETTE[i % CHART_PALETTE.length]),
        borderColor: WHITE,
        borderWidth: 3,
        hoverOffset: 0,
        circumference: 360,
      }]
    },
    options: {
      responsive: false,
      animation: false,
      cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      layout: { padding: 16 }
    }
  };

  return canvas.renderToBuffer(config);
}

// ─── Category Horizontal Bar Chart ───────────────────────────────────────────
/**
 * Renders a horizontal bar chart for category revenue.
 * @param {Array<{Category:string, Sales:number, Qty:number}>} categories
 * @returns {Promise<Buffer>} PNG buffer
 */
async function renderCategoryBarChart(categories = []) {
  const topCats = [...categories]
    .sort((a, b) => (b.Sales || 0) - (a.Sales || 0))
    .slice(0, 8);

  const numBars = Math.max(topCats.length, 1);

  // 2x canvas: 900px wide, 64px per bar + header room
  const width  = 900;
  const height = numBars * 64 + 80;
  const canvas = makeCanvas(width, height);

  // Full category names — no truncation
  const labels = topCats.map(c => String(c.Category || 'Unknown'));
  const values = topCats.map(c => Number(c.Sales) || 0);

  const config = {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Revenue ($)',
        data: values,
        backgroundColor: values.map((_, i) => CHART_PALETTE[i % CHART_PALETTE.length]),
        borderColor: 'transparent',
        borderRadius: 5,
        borderSkipped: false,
        barPercentage: 0.65,
        categoryPercentage: 0.85,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: {
          grid: { color: '#f1f5f9', lineWidth: 1.5 },
          border: { display: false },
          ticks: {
            color: SLATE_MID,
            font: { size: 13 },
            callback: v => `$${v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v}`
          },
          beginAtZero: true
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: SLATE_DARK,
            font: { size: 14, weight: 'bold' }
          }
        }
      },
      layout: { padding: { top: 8, right: 60, bottom: 8, left: 8 } }
    }
  };

  return canvas.renderToBuffer(config);
}

// ─── Mini Sparkline Chart ─────────────────────────────────────────────────────
/**
 * Renders a tiny sparkline bar chart for embedding inside KPI cards.
 * @param {Array<number>} values  – 6-8 data points
 * @param {string} color
 * @returns {Promise<Buffer>} PNG buffer
 */
async function renderSparkline(values = [], color = ORANGE) {
  // 2x for sharpness in KPI cards
  const width  = 160;
  const height = 56;
  const canvas = makeCanvas(width, height);

  const config = {
    type: 'bar',
    data: {
      labels: values.map((_, i) => i),
      datasets: [{
        data: values,
        backgroundColor: color + 'bb',
        borderColor: 'transparent',
        borderRadius: 3,
        barPercentage: 0.85,
        categoryPercentage: 0.9,
      }]
    },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false, beginAtZero: true }
      },
      layout: { padding: 2 }
    }
  };

  return canvas.renderToBuffer(config);
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  renderSalesTrendChart,
  renderPaymentDonutChart,
  renderCategoryBarChart,
  renderSparkline,
  CHART_PALETTE,
  ORANGE,
  ORANGE_DARK,
  ORANGE_LIGHT,
};
