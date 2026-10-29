const { extractIntent } = require('./intent.agent');
const { discoverSchema } = require('../services/schemaDiscovery.service');
const { generateSQL } = require('./sqlGenerator.agent');
const { validateSQL } = require('../services/sqlValidator.service');
const { getReadOnlyPool } = require('../config/database');
const { getChatHistory, saveMessage } = require('./memory.agent');
const axios = require('axios');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Local response formatter for fallback and simple text responses
function formatLocalResponse(intent, rawData, params) {
  const title = params.titlePeriod || "Business";

  if (intent === 'get_sales_metrics') {
    const revenue = Number(rawData.TotalRevenue || 0).toFixed(2);
    const orders = rawData.TotalOrders || 0;
    const avg = Number(rawData.AvgTicketSize || 0).toFixed(2);
    const discount = Number(rawData.TotalDiscount || 0).toFixed(2);
    const tax = Number(rawData.TotalTax || 0).toFixed(2);
    return [
      `📊 ${title} Sales Report`,
      ``,
      `• Total Revenue:       SGD ${revenue}`,
      `• Total Bills:         ${orders}`,
      `• Avg Ticket Size:     SGD ${avg}`,
      `• Total Discounts:     SGD ${discount}`,
      `• Total GST/Tax:       SGD ${tax}`,
    ].join('\n');
  }

  if (intent === 'get_top_selling_items') {
    if (!Array.isArray(rawData) || rawData.length === 0) {
      return `🍽️ No menu item sales found for ${title} period.`;
    }
    const lines = rawData.map((item, i) =>
      `${i + 1}. ${item.item_name}\n   Qty: ${Number(item.TotalQuantity).toFixed(0)}  |  Rev: SGD ${Number(item.TotalRevenue).toFixed(2)}`
    );
    return [`🏆 Top Items — ${title}`, ``, ...lines].join('\n');
  }

  if (intent === 'get_unsold_items') {
    if (!Array.isArray(rawData) || rawData.length === 0) {
      return `🍽️ No unsold or slow moving items found for ${title} period.`;
    }
    const lines = rawData.map((item, i) =>
      `${i + 1}. ${item.item_name}\n   Qty: ${Number(item.TotalQuantity).toFixed(0)}  |  Rev: SGD ${Number(item.TotalRevenue).toFixed(2)}`
    );
    return [`📉 Unsold / Slow Items — ${title}`, ``, ...lines].join('\n');
  }

  if (intent === 'get_staff_performance') {
    if (!Array.isArray(rawData) || rawData.length === 0) {
      return `👤 No staff performance data found for ${title} period.`;
    }
    const lines = rawData.map((s, i) =>
      `${i + 1}. ${s.staff_name}\n   Bills: ${s.TotalBills}  |  Rev: SGD ${Number(s.TotalRevenue).toFixed(2)}  |  Avg: SGD ${Number(s.AvgBillAmount || 0).toFixed(2)}`
    );
    return [`👤 Staff Performance — ${title}`, ``, ...lines].join('\n');
  }

  if (intent === 'get_discount_analysis') {
    const discountedBills = rawData.DiscountedBills || 0;
    const totalDiscount = Number(rawData.TotalDiscountGiven || 0).toFixed(2);
    const maxDiscount = Number(rawData.MaxDiscount || 0).toFixed(2);
    const avgDiscount = Number(rawData.AvgDiscountPerBill || 0).toFixed(2);
    const totalBills = rawData.TotalBills || 0;
    return [
      `🎟️ ${title} Discount Report`,
      ``,
      `• Total Bills:         ${totalBills}`,
      `• Discounted Bills:    ${discountedBills}`,
      `• Total Discount:      SGD ${totalDiscount}`,
      `• Max Single Discount: SGD ${maxDiscount}`,
      `• Avg Discount/Bill:   SGD ${avgDiscount}`,
    ].join('\n');
  }

  if (intent === 'get_cancelled_orders') {
    return [
      `❌ ${title} Cancellation Report`,
      ``,
      `• Cancelled Bills:     ${rawData.CancelledCount || 0}`,
      `• Cancelled Amount:    SGD ${Number(rawData.CancelledAmount || 0).toFixed(2)}`,
    ].join('\n');
  }

  if (intent === 'get_tax_analysis') {
    const tax = Number(rawData.TotalTax || 0).toFixed(2);
    const revenue = Number(rawData.TotalRevenue || 0).toFixed(2);
    const percentage = Number(rawData.TaxPercentage || 0).toFixed(1);
    return [
      `📝 ${title} Tax & GST Report`,
      ``,
      `• Total Tax Collected:  SGD ${tax}`,
      `• Taxable Revenue:      SGD ${revenue}`,
      `• Effective Tax Rate:   ${percentage}%`
    ].join('\n');
  }

  if (intent === 'get_payment_distribution') {
    const items = Array.isArray(rawData) ? rawData : [rawData];
    if (items.length === 0 || !items[0]) {
      return `💳 No payment transaction methods records found for ${title} period.`;
    }
    const lines = items.map((p, i) =>
      `${i + 1}. Mode: ${p.mode}\n   Bills: ${p.TotalBills}  |  Revenue: SGD ${Number(p.TotalRevenue).toFixed(2)}`
    );
    return [`💳 Payment Methods Breakdown — ${title}`, ``, ...lines].join('\n');
  }

  return `Here is your data:\n${JSON.stringify(rawData, null, 2)}`;
}

// Generate visual payload format
function constructVisuals(intent, rawData) {
  if (!rawData || (Array.isArray(rawData) && rawData.length === 0)) return null;

  if (intent === 'get_top_selling_items') {
    return {
      type: 'bar',
      data: rawData.map(item => ({
        name: item.item_name,
        quantity: Number(item.TotalQuantity),
        revenue: Number(item.TotalRevenue)
      })),
      keys: ['quantity', 'revenue']
    };
  }

  if (intent === 'get_unsold_items') {
    return {
      type: 'bar',
      data: rawData.map(item => ({
        name: item.item_name,
        quantity: Number(item.TotalQuantity)
      })),
      keys: ['quantity']
    };
  }

  if (intent === 'get_staff_performance') {
    return {
      type: 'bar',
      data: rawData.map(item => ({
        name: item.staff_name,
        revenue: Number(item.TotalRevenue),
        bills: Number(item.TotalBills)
      })),
      keys: ['revenue', 'bills']
    };
  }

  if (intent === 'get_sales_metrics') {
    const data = Array.isArray(rawData) ? rawData[0] : rawData;
    return {
      type: 'pie',
      data: [
        { name: 'Revenue', value: Number(data.TotalRevenue) },
        { name: 'Discounts', value: Number(data.TotalDiscount) },
        { name: 'GST/Tax', value: Number(data.TotalTax) }
      ],
      keys: ['value']
    };
  }

  if (intent === 'get_payment_distribution') {
    const items = Array.isArray(rawData) ? rawData : [rawData];
    return {
      type: 'bar',
      data: items.map(item => ({
        name: item.mode,
        value: Number(item.TotalRevenue)
      })),
      keys: ['value']
    };
  }

  if (intent === 'get_tax_analysis') {
    const data = Array.isArray(rawData) ? rawData[0] : rawData;
    return {
      type: 'pie',
      data: [
        { name: 'Tax Collected', value: Number(data.TotalTax) },
        { name: 'Revenue', value: Number(data.TotalRevenue) }
      ],
      keys: ['value']
    };
  }

  return null;
}

async function synthesizeResponse(userQuestion, intent, rawData, params = {}, chatHistory = []) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const isInvalidKey = !apiKey || apiKey.includes('your_openrouter_api_key') || apiKey === '';

  if (isInvalidKey) {
    return formatLocalResponse(intent, rawData, params);
  }

  try {
    const historyText = chatHistory.map(h => `${h.Sender}: ${h.ContentText}`).join('\n');
    const prompt = `
Context of past conversation:
${historyText}

User asked: "${userQuestion}"
Intent: ${intent}
Query Result Data: ${JSON.stringify(rawData)}
Time/Period Parameter Context: ${JSON.stringify(params)}

Please generate a professional, narrative-driven response summarizing this business intelligence data.
Highlight key takeaways (e.g. increase/decrease, top performers, areas of concern). 
Ensure the narrative is friendly, clear, and action-oriented for a restaurant owner.
Do NOT output SQL. Use clear formatting, emojis, and paragraph breaks.
`;

    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model: process.env.DEFAULT_LLM_MODEL || 'anthropic/claude-3.5-sonnet',
        messages: [{ role: 'user', content: prompt }]
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

    return response.data.choices[0].message.content;
  } catch (error) {
    console.warn('⚠️ OpenRouter Synthesizer unavailable, falling back to local formatting:', error.message);
    return formatLocalResponse(intent, rawData, params);
  }
}

async function runConversationalChat(userQuestion, chatHistory = []) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const isInvalidKey = !apiKey || apiKey.includes('your_openrouter_api_key') || apiKey === '';

  if (isInvalidKey) {
    return "I'm currently running in local sandbox mode with no active LLM key. Try asking query-specific prompts like 'sales today' or 'top menu items'!";
  }

  try {
    const messages = chatHistory.map(h => ({
      role: h.Sender === 'USER' ? 'user' : 'assistant',
      content: h.ContentText
    }));
    messages.push({ role: 'user', content: userQuestion });
    messages.unshift({
      role: 'system',
      content: "You are a friendly, highly intelligent POS system business advisor. Chat with the user about their restaurant analytics, general restaurant operations advice, or menu configuration."
    });

    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model: process.env.DEFAULT_LLM_MODEL || 'anthropic/claude-3.5-sonnet',
        messages
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

    return response.data.choices[0].message.content;
  } catch (error) {
    console.warn('⚠️ OpenRouter chat failed:', error.message);
    return "I had trouble reaching my AI advisor engine. Please try asking about sales or performance reports.";
  }
}

async function orchestrateChat(message, sessionId, shopId, userId = 1) {
  const startTime = Date.now();
  
  // 1. Fetch chat history window
  const history = await getChatHistory(sessionId, 5);

  // 2. Parse User Message using Intent Agent
  const classification = await extractIntent(message);
  const { intent, params } = classification;

  let answer = "";
  let sqlExecuted = null;
  let rawData = null;
  let visuals = null;

  if (intent === 'general_query' || intent === 'fallback_chat') {
    // Conversational/Chitchat route
    answer = classification.params?.textResponse || await runConversationalChat(message, history);
  } else {
    // Dynamic Query route
    // 3. Schema Catalog Discovery
    const schema = await discoverSchema();

    // 4. SQL Query formulation
    sqlExecuted = await generateSQL(message, intent, params, schema);

    if (sqlExecuted) {
      // 5. Query Safety & Isolation Check
      validateSQL(sqlExecuted, shopId, schema);

      // 6. DB Execution
      const pool = await getReadOnlyPool();
      const dbResult = await pool.request().query(sqlExecuted);
      rawData = dbResult.recordsets && dbResult.recordsets.length > 1 ? dbResult.recordsets : dbResult.recordset;
      
      // If it's a single object in array (like metrics), extract it
      if (Array.isArray(rawData) && rawData.length === 1 && (intent === 'get_sales_metrics' || intent === 'get_discount_analysis' || intent === 'get_cancelled_orders')) {
        rawData = rawData[0];
      }

      // 7. Synthesis and Visual Formatting
      answer = await synthesizeResponse(message, intent, rawData, params, history);
      visuals = constructVisuals(intent, rawData);
    } else {
      answer = "I classified the request but was unable to formulate a secure query statement.";
    }
  }

  const responseTimeMs = Date.now() - startTime;

  // 8. Save session states and transaction records
  await saveMessage(
    sessionId,
    'USER',
    message,
    null,
    null,
    null,
    1, // OrgID fallback
    shopId,
    userId
  );

  await saveMessage(
    sessionId,
    'ASSISTANT',
    answer,
    visuals,
    sqlExecuted,
    responseTimeMs,
    1,
    shopId,
    userId
  );

  return {
    sessionId,
    answer,
    intent,
    insights: {
      summary: `Analyzed query intent [${intent}] over period: ${params?.titlePeriod || 'custom'}.`,
      keyFindings: rawData ? (Array.isArray(rawData) ? (intent === 'get_payment_distribution' ? rawData : rawData.slice(0, 3)) : [rawData]) : [],
      recommendedActions: []
    },
    visuals,
    sqlExecuted
  };
}

module.exports = {
  orchestrateChat
};
