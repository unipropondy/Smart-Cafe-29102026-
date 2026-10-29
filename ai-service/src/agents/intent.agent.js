const axios = require('axios');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const getFormattedDate = (offsetDays = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
};

function getLocalFallbackIntent(userMessage) {
  const msg = userMessage.toLowerCase();
  const today = getFormattedDate(0);

  // Determine date range
  let startDate = today;
  let endDate = today;
  let titlePeriod = "Today's";

  const daysMatch = msg.match(/(?:past|last)\s+(\d+)\s+days/i) || msg.match(/(\d+)\s+days/i);
  const customDateMatch = msg.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|and)\s*(\d{4}-\d{2}-\d{2})/i) || msg.match(/from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i);

  if (daysMatch) {
    const days = parseInt(daysMatch[1], 10);
    startDate = getFormattedDate(-days);
    endDate = today;
    titlePeriod = `Last ${days} Days'`;
  } else if (customDateMatch) {
    startDate = customDateMatch[1];
    endDate = customDateMatch[2];
    titlePeriod = `${startDate} to ${endDate}`;
  } else if (msg.includes('yesterday')) {
    startDate = getFormattedDate(-1);
    endDate = getFormattedDate(-1);
    titlePeriod = "Yesterday's";
  } else if (msg.includes('last week')) {
    startDate = getFormattedDate(-14);
    endDate = getFormattedDate(-7);
    titlePeriod = "Last Week's";
  } else if (msg.includes('this week') || msg.includes('week') || msg.includes('weekly')) {
    startDate = getFormattedDate(-7);
    titlePeriod = "This Week's";
  } else if (msg.includes('last month')) {
    startDate = getFormattedDate(-60);
    endDate = getFormattedDate(-30);
    titlePeriod = "Last Month's";
  } else if (msg.includes('this month') || msg.includes('month') || msg.includes('monthly')) {
    startDate = getFormattedDate(-30);
    titlePeriod = "This Month's";
  } else if (msg.includes('year') || msg.includes('yearly')) {
    startDate = getFormattedDate(-365);
    titlePeriod = "This Year's";
  }

  // Intent Detection
  if (
    msg.includes('not sale') || 
    msg.includes('no sale') || 
    msg.includes('unsold') || 
    msg.includes('not sold') || 
    msg.includes('zero sale') || 
    msg.includes('slow moving') || 
    msg.includes('least sold') || 
    msg.includes('worst')
  ) {
    return { intent: 'get_unsold_items', params: { startDate, endDate, limit: 5, titlePeriod } };
  }

  if (msg.includes('staff') || msg.includes('waiter') || msg.includes('server') || msg.includes('cashier') || msg.includes('perform') || msg.includes('best employee')) {
    return { intent: 'get_staff_performance', params: { startDate, endDate, titlePeriod } };
  }

  if (msg.includes('discount') || msg.includes('offer') || msg.includes('promo') || msg.includes('coupon') || msg.includes('misuse')) {
    return { intent: 'get_discount_analysis', params: { startDate, endDate, titlePeriod } };
  }

  if (msg.includes('cancel') || msg.includes('cancle') || msg.includes('void') || msg.includes('refund') || msg.includes('reject')) {
    return { intent: 'get_cancelled_orders', params: { startDate, endDate, titlePeriod } };
  }

  if (msg.includes('top') || msg.includes('best') || msg.includes('popular') || msg.includes('item') || msg.includes('dish') || msg.includes('menu') || msg.includes('selling')) {
    return { intent: 'get_top_selling_items', params: { startDate, endDate, limit: 5, titlePeriod } };
  }

  if (msg.includes('tax') || msg.includes('gst')) {
    return { intent: 'get_tax_analysis', params: { startDate, endDate, titlePeriod } };
  }

  if (msg.includes('payment') || msg.includes('paymode') || msg.includes('methods') || msg.includes('card') || msg.includes('upi')) {
    return { intent: 'get_payment_distribution', params: { startDate, endDate, titlePeriod } };
  }

  return { intent: 'get_sales_metrics', params: { startDate, endDate, titlePeriod } };
}

async function extractIntent(userMessage) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const isInvalidKey = !apiKey || apiKey.includes('your_openrouter_api_key') || apiKey === '';

  if (isInvalidKey) {
    return getLocalFallbackIntent(userMessage);
  }

  try {
    const response = await axios.post(
      OPENROUTER_API_URL,
      {
        model: process.env.DEFAULT_LLM_MODEL || 'anthropic/claude-3.5-sonnet',
        messages: [
          {
            role: 'system',
            content: `You are a NLU classifier for a Restaurant Business Intelligence assistant.
Identify the user's intent. The valid intents are:
1. get_sales_metrics (requests for revenue, bill counts, sales numbers, average ticket sizes, etc.)
2. get_top_selling_items (requests for best sellers, popular dishes, top menu items)
3. get_unsold_items (requests for unsold items, slow-moving products, items with zero sales)
4. get_staff_performance (requests for waiters/cashiers performance, best staff, orders served per employee)
5. get_discount_analysis (requests for total discounts, promo codes use, coupon analyses)
6. get_cancelled_orders (requests for void/cancelled bills, refund amounts)
7. get_payment_distribution (requests for payment methods breakdown, payment mode breakdown, cash vs card distribution, UPI/NETS/PayNow sales contribution)
8. general_query (questions not matching structural query intents, requiring direct answers or conversational chat)

Extract these parameters as JSON:
- startDate: String (YYYY-MM-DD)
- endDate: String (YYYY-MM-DD, defaults to today's date if not stated)
- limit: Number (defaults to 5)
- titlePeriod: String (human description, e.g. "This Week's", "Last Month's", "Yesterday's")

Return ONLY a valid JSON object matching this schema:
{
  "intent": "...",
  "params": {
    "startDate": "...",
    "endDate": "...",
    "limit": 5,
    "titlePeriod": "..."
  }
}`
          },
          { role: 'user', content: userMessage }
        ],
        response_format: { type: 'json_object' }
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://ucspos.com',
          'Content-Type': 'application/json'
        },
        timeout: 6000
      }
    );

    const content = response.data.choices[0].message.content;
    const parsed = JSON.parse(content);
    return parsed;
  } catch (error) {
    console.warn('⚠️ OpenRouter Intent Classifier failed or timed out. Falling back to local rules:', error.message);
    return getLocalFallbackIntent(userMessage);
  }
}

module.exports = {
  extractIntent,
  getLocalFallbackIntent
};
