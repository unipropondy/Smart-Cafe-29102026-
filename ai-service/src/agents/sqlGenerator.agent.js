const axios = require('axios');
const { getSchemaPromptRepresentation } = require('../services/schemaDiscovery.service');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const STATIC_TEMPLATES = {
  get_sales_metrics: (params) => `
    SELECT 
      ISNULL(SUM(SysAmount), 0) AS TotalRevenue,
      ISNULL(SUM(DiscountAmount), 0) AS TotalDiscount,
      ISNULL(SUM(TotalTax), 0) AS TotalTax,
      COUNT(SettlementID) AS TotalOrders,
      CASE WHEN COUNT(SettlementID) > 0 
        THEN ISNULL(SUM(SysAmount), 0) / COUNT(SettlementID) 
        ELSE 0 END AS AvgTicketSize
    FROM SettlementHeader 
    WHERE CAST(start_date AS DATE) BETWEEN '${params.startDate}' AND '${params.endDate}';
  `,
  get_top_selling_items: (params) => `
    SELECT TOP (${params.limit || 5})
      sid.DishName AS item_name,
      SUM(sid.Qty) AS TotalQuantity,
      SUM(sid.Qty * sid.Price) AS TotalRevenue
    FROM SettlementItemDetail sid
    INNER JOIN SettlementHeader sh ON sid.SettlementID = sh.SettlementID
    WHERE CAST(sh.start_date AS DATE) BETWEEN '${params.startDate}' AND '${params.endDate}'
    GROUP BY sid.DishName
    ORDER BY TotalQuantity DESC;
  `,
  get_staff_performance: (params) => `
    SELECT TOP 10
      ISNULL(SER_NAME, 'Unknown') AS staff_name,
      COUNT(SettlementID) AS TotalBills,
      ISNULL(SUM(SysAmount), 0) AS TotalRevenue,
      ISNULL(SUM(SysAmount), 0) / NULLIF(COUNT(SettlementID), 0) AS AvgBillAmount
    FROM SettlementHeader
    WHERE CAST(start_date AS DATE) BETWEEN '${params.startDate}' AND '${params.endDate}'
      AND SER_NAME IS NOT NULL
    GROUP BY SER_NAME
    ORDER BY TotalRevenue DESC;
  `,
  get_discount_analysis: (params) => `
    SELECT 
      COUNT(CASE WHEN DiscountAmount > 0 THEN 1 END) AS DiscountedBills,
      ISNULL(SUM(DiscountAmount), 0) AS TotalDiscountGiven,
      ISNULL(MAX(DiscountAmount), 0) AS MaxDiscount,
      ISNULL(AVG(CASE WHEN DiscountAmount > 0 THEN DiscountAmount END), 0) AS AvgDiscountPerBill,
      COUNT(SettlementID) AS TotalBills
    FROM SettlementHeader
    WHERE CAST(start_date AS DATE) BETWEEN '${params.startDate}' AND '${params.endDate}';
  `,
  get_cancelled_orders: (params) => `
    SELECT 
      COUNT(SettlementID) AS CancelledCount,
      ISNULL(SUM(SysAmount), 0) AS CancelledAmount
    FROM SettlementHeader
    WHERE CAST(start_date AS DATE) BETWEEN '${params.startDate}' AND '${params.endDate}'
      AND IsCancelled = 1;
  `,
  get_unsold_items: (params) => `
    SELECT TOP (${params.limit || 5})
      d.Name AS item_name,
      ISNULL(SUM(sid.Qty), 0) AS TotalQuantity,
      ISNULL(SUM(sid.Qty * sid.Price), 0) AS TotalRevenue
    FROM DishMaster d
    LEFT JOIN SettlementItemDetail sid ON d.Name = sid.DishName
    LEFT JOIN SettlementHeader sh ON sid.SettlementID = sh.SettlementID 
      AND CAST(sh.start_date AS DATE) BETWEEN '${params.startDate}' AND '${params.endDate}'
    WHERE d.IsActive = 1
    GROUP BY d.Name
    ORDER BY TotalQuantity ASC;
  `,
  get_tax_analysis: (params) => `
    SELECT 
      ISNULL(SUM(TotalTax), 0) AS TotalTax,
      ISNULL(SUM(SysAmount), 0) AS TotalRevenue,
      CASE WHEN SUM(SysAmount) > 0 THEN (SUM(TotalTax) / SUM(SysAmount)) * 100 ELSE 0 END AS TaxPercentage
    FROM SettlementHeader
    WHERE CAST(start_date AS DATE) BETWEEN '${params.startDate}' AND '${params.endDate}';
  `,
  get_payment_distribution: (params) => `
    SELECT 
      ISNULL(sts.PayMode, 'Unknown') AS mode,
      COUNT(DISTINCT sh.SettlementID) AS TotalBills,
      ISNULL(SUM(sts.SysAmount), 0) AS TotalRevenue
    FROM SettlementHeader sh
    INNER JOIN SettlementTotalSales sts ON sh.SettlementID = sts.SettlementID
    WHERE CAST(sh.start_date AS DATE) BETWEEN '${params.startDate}' AND '${params.endDate}'
    GROUP BY sts.PayMode;
  `
};

async function generateSQL(userMessage, intent, params, schema) {
  // If the intent is not a structured query, return N/A
  if (intent === 'general_query' || intent === 'fallback_chat') {
    return null;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const isInvalidKey = !apiKey || apiKey.includes('your_openrouter_api_key') || apiKey === '';

  // Fallback to static pre-defined queries if OpenRouter is not set up
  if (isInvalidKey) {
    if (STATIC_TEMPLATES[intent]) {
      return STATIC_TEMPLATES[intent](params).trim();
    }
    throw new Error(`Unsupported fallback template for intent: ${intent}`);
  }

  try {
    const schemaRep = getSchemaPromptRepresentation(schema);
    const systemPrompt = `You are a professional MSSQL DBA and Text-to-SQL agent.
Generate a valid read-only Microsoft SQL Server query based on the user request, the database schema provided, and intent context.
Follow these rules:
1. ONLY return the plain SQL query text. Do NOT wrap it in markdown codeblocks (no \`\`\`sql), and do not include explanations.
2. The query must be purely read-only (SELECT queries).
3. Be mindful of existing table schemas:
${schemaRep}
4. Crucially, when querying SettlementHeader or SettlementItemDetail by date range, always filter by the "start_date" column (e.g., CAST(start_date AS DATE) BETWEEN 'YYYY-MM-DD' AND 'YYYY-MM-DD') rather than LastSettlementDate, as start_date represents the business date.
5. When writing dates, format them as YYYY-MM-DD strings.
6. Limit results appropriately based on the request (e.g. SELECT TOP 5).`;

    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model: process.env.DEFAULT_LLM_MODEL || 'anthropic/claude-3.5-sonnet',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Intent: ${intent}. Parameters: ${JSON.stringify(params)}. User question: "${userMessage}"` }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://ucspos.com',
          'Content-Type': 'application/json'
        },
        timeout: 8000
      }
    );

    let sqlText = response.data.choices[0].message.content.trim();
    // Clean up codeblocks if the LLM ignored instructions
    if (sqlText.startsWith('```')) {
      sqlText = sqlText.replace(/```sql|```/gi, '').trim();
    }
    return sqlText;
  } catch (error) {
    console.warn(`⚠️ OpenRouter SQL generation failed. Falling back to static SQL template for ${intent}:`, error.message);
    if (STATIC_TEMPLATES[intent]) {
      return STATIC_TEMPLATES[intent](params).trim();
    }
    throw error;
  }
}

module.exports = {
  generateSQL,
  STATIC_TEMPLATES
};
