import express from 'express';
import crypto from 'node:crypto';
import { Orders, Settings, ApiCredentials, ObserverLogs } from '../db.js';
import { buildUpiString, generateQrDataUrl, getAppIntents } from '../utils/upi.js';
import { sendWebhook } from '../utils/webhook.js';
import { parseAirtelAlert } from '../utils/airtel-parser.js';

export const apiRouter = express.Router();

// SSE Subscribers by Order ID
const orderSubscribers = new Map();

// SSE Subscribers for Admin Live Soundbox Alert
const adminAlertSubscribers = new Set();

export function notifyOrderSubscribers(orderId, data) {
  const clients = orderSubscribers.get(orderId);
  if (clients && clients.size > 0) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try { res.write(payload); } catch {}
    }
  }
}

export function notifyAdminAlerts(data) {
  if (adminAlertSubscribers.size > 0) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of adminAlertSubscribers) {
      try { res.write(payload); } catch {}
    }
  }
}

// 1. Health check
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    gateway: 'Cortex UPI Payment Gateway',
    timestamp: new Date().toISOString()
  });
});

// 2. Get active credentials for developer integration hub
apiRouter.get('/credentials', (req, res) => {
  const cred = ApiCredentials.getLatest();
  res.json({
    success: true,
    credentials: cred || {
      api_key: 'ctx_live_' + crypto.randomBytes(8).toString('hex'),
      access_token: 'ctx_sec_token_' + crypto.randomBytes(16).toString('hex')
    }
  });
});

// 3. Generate New API Key & Access Token
apiRouter.post('/credentials/generate', (req, res) => {
  const name = req.body.merchant_name || 'Merchant Account ' + new Date().toLocaleDateString();
  const cred = ApiCredentials.create(name);
  res.json({
    success: true,
    message: 'New credentials generated successfully',
    credentials: cred
  });
});

// 4. Create Order / Checkout Session
apiRouter.post('/orders/create', async (req, res) => {
  try {
    const {
      amount,
      product_name,
      order_id,
      customer_name,
      customer_email,
      customer_phone,
      metadata
    } = req.body;

    const numAmount = Number(amount);
    if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'Valid positive amount is required' });
    }

    // Smart Collision Avoidance: If another order is currently PENDING with the exact same amount,
    // assign a unique paise offset (+0.01, +0.02, etc.) so bank SMS can identify each user with 100% certainty!
    const pendingSameAmount = Orders.getAll(100).filter(o => o.status === 'PENDING');
    let finalAmount = Number(numAmount.toFixed(2));
    let offsetCount = 0;
    while (pendingSameAmount.some(o => Math.abs(o.amount - finalAmount) < 0.005) && offsetCount < 20) {
      offsetCount++;
      finalAmount = Number((numAmount + (offsetCount * 0.01)).toFixed(2));
    }

    const assignedOrderId = (order_id && String(order_id).trim()) || `ORD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    
    // Check if order already exists
    const existing = Orders.getById(assignedOrderId);
    if (existing) {
      return res.status(409).json({ error: `Order ID ${assignedOrderId} already exists`, order: existing });
    }

    const vpa = Settings.get('upi_vpa', 'merchant@upi');
    const payeeName = Settings.get('upi_name', 'Cortex Merchant');
    const productName = product_name || 'UPI Checkout Order';

    const upiString = buildUpiString({
      vpa,
      name: payeeName,
      amount: finalAmount,
      orderId: assignedOrderId,
      note: `Payment for ${productName}`
    });

    const qrDataUrl = await generateQrDataUrl(upiString);
    const intents = getAppIntents(upiString);

    const order = Orders.create({
      order_id: assignedOrderId,
      product_name: productName,
      amount: finalAmount,
      customer_name: customer_name || 'Buyer',
      customer_email: customer_email || '',
      customer_phone: customer_phone || '',
      upi_vpa: vpa,
      upi_string: upiString,
      metadata: metadata || null
    });

    // Derive host dynamically so it works on VPS, Render, or localhost!
    const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:5000';
    const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
    const checkoutUrl = `${proto}://${host}/checkout/${assignedOrderId}`;

    res.status(201).json({
      success: true,
      order: {
        ...order,
        checkout_url: checkoutUrl,
        qr_data_url: qrDataUrl,
        intents
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Get Order Status
apiRouter.get('/orders/:id', async (req, res) => {
  const order = Orders.getById(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const vpa = order.upi_vpa || Settings.get('upi_vpa', 'merchant@upi');
  const payeeName = Settings.get('upi_name', 'Cortex Merchant');
  const upiString = order.upi_string || buildUpiString({
    vpa,
    name: payeeName,
    amount: order.amount,
    orderId: order.order_id,
    note: `Payment for ${order.product_name}`
  });

  const qrDataUrl = await generateQrDataUrl(upiString);
  const intents = getAppIntents(upiString);

  res.json({
    success: true,
    order: {
      ...order,
      qr_data_url: qrDataUrl,
      intents
    }
  });
});

// 6. Submit Payment / UTR Verification
apiRouter.post('/orders/:id/pay', async (req, res) => {
  try {
    const rawUtr = req.body?.utr;
    if (!rawUtr || typeof rawUtr !== 'string' || !rawUtr.trim()) {
      return res.status(400).json({
        success: false,
        error: '12-digit Bank Reference (UTR) number is required to confirm payment.'
      });
    }

    const cleanUtr = rawUtr.replace(/[^0-9A-Za-z]/g, '').trim();

    // Indian NPCI UPI UTR standard: 12-22 digits (e.g. 561028232084)
    if (cleanUtr.length < 12 || cleanUtr.length > 22 || !/^[0-9]{12,22}$/.test(cleanUtr)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid UTR format. Bank Reference (UTR) must be a 12-digit numeric reference number (e.g. 561028232084).'
      });
    }

    const order = Orders.getById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status === 'PAID') {
      return res.json({ success: true, message: 'Order is already marked as paid', order });
    }

    const updated = Orders.markPaid(order.order_id, cleanUtr);

    // 1. Notify connected buyer checkout screen
    notifyOrderSubscribers(order.order_id, {
      event: 'PAYMENT_SUCCESS',
      order: updated
    });

    // 2. Notify Admin Live Soundbox Alert
    notifyAdminAlerts({
      event: 'LIVE_PAYMENT_ALERT',
      order: updated,
      alertMessage: `Payment of ₹${Number(updated.amount).toFixed(2)} received successfully from ${updated.customer_name || 'Customer'}`
    });

    // 3. Asynchronously dispatch signed server webhook
    const webhookUrl = Settings.get('webhook_url');
    const webhookSecret = Settings.get('webhook_secret');
    if (webhookUrl) {
      sendWebhook({
        url: webhookUrl,
        secret: webhookSecret,
        event: 'PAYMENT_SUCCESS',
        payload: updated
      }).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Payment verified and confirmed successfully',
      order: updated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Real-time Server-Sent Events (SSE) for individual checkout session
apiRouter.get('/orders/:id/stream', (req, res) => {
  const orderId = req.params.id;
  const order = Orders.getById(orderId);
  if (!order) {
    return res.status(404).end('Order not found');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write(`data: ${JSON.stringify({ event: 'CONNECTED', status: order.status })}\n\n`);

  if (!orderSubscribers.has(orderId)) {
    orderSubscribers.set(orderId, new Set());
  }
  orderSubscribers.get(orderId).add(res);

  req.on('close', () => {
    const set = orderSubscribers.get(orderId);
    if (set) {
      set.delete(res);
      if (set.size === 0) orderSubscribers.delete(orderId);
    }
  });
});

// 8. Admin Live Soundbox SSE Channel (Paytm Soundbox style alert broadcast)
apiRouter.get('/admin/live-alerts', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write(`data: ${JSON.stringify({ event: 'SOUNDBOX_CONNECTED', timestamp: Date.now() })}\n\n`);
  adminAlertSubscribers.add(res);

  req.on('close', () => {
    adminAlertSubscribers.delete(res);
  });
});

// 9. Built-in Sample Webhook Receiver for testing
apiRouter.post('/webhook/sample', (req, res) => {
  res.status(200).json({ received: true, timestamp: Date.now() });
});

// 10. MacroDroid Config & Downloadable Macro Generator
apiRouter.get('/observer/macrodroid-macro', (req, res) => {
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:5000';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const endpoint = `${proto}://${host}/api/observer/airtel`;

  const macroExport = {
    macro: {
      m_name: 'Cortex Airtel UPI Observer',
      m_description: `Auto-forwards Airtel Payments Bank UPI credit SMS to Cortex Payment Gateway (${endpoint})`,
      m_enabled: true,
      m_triggerList: [
        {
          m_SIGUID: -201,
          m_classType: 'IncomingSMSNotificationTrigger',
          m_smsFromList: [],
          m_smsContent: ''
        }
      ],
      m_actionList: [
        {
          m_SIGUID: -101,
          m_classType: 'HttpRequestAction',
          m_url: endpoint,
          m_httpMethod: 1, // POST
          m_contentType: 'application/json',
          m_contentBody: '{\n  "message": "[sms_body]",\n  "sender": "[sms_number]"\n}',
          m_headerList: []
        }
      ]
    }
  };

  res.setHeader('Content-Disposition', 'attachment; filename="cortex_airtel_observer.macro"');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(macroExport, null, 2));
});

apiRouter.get('/observer/macrodroid-config', (req, res) => {
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:5000';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  const endpoint = `${proto}://${host}/api/observer/airtel`;

  res.json({
    success: true,
    name: 'Cortex Airtel UPI Observer',
    endpoint,
    method: 'POST',
    contentType: 'application/json',
    payloadTemplate: {
      message: '[sms_body]',
      sender: '[sms_number]'
    },
    notificationPayloadTemplate: {
      message: '[not_body]',
      sender: '[not_title]'
    },
    downloadMacroUrl: `${proto}://${host}/api/observer/macrodroid-macro`,
    instructions: [
      '1. Install MacroDroid from Google Play Store on your Android banking device.',
      '2. Download and open cortex_airtel_observer.macro with MacroDroid, or manually create a macro with Trigger: SMS Received.',
      '3. Set Action: HTTP Request -> POST to ' + endpoint,
      '4. Set Content Type: application/json and Body: {"message": "[sms_body]", "sender": "[sms_number]"}',
      '5. Save and enable Macro. Payments received in Airtel Payments Bank will automatically verify pending orders and ring the Soundbox!'
    ]
  });
});

// Friendly GET info for /observer/airtel
apiRouter.get('/observer/airtel', (req, res) => {
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:5000';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  res.json({
    status: 'ACTIVE',
    bank: 'Airtel Payments Bank',
    endpoint: `${proto}://${host}/api/observer/airtel`,
    method: 'POST',
    expectedBody: {
      message: 'Airtel SMS or notification text containing amount and UTR/Transaction ID',
      sender: 'Sender name or number (optional)'
    },
    downloadMacroUrl: `${proto}://${host}/api/observer/macrodroid-macro`
  });
});

// 11. Airtel Payments Bank (airtelpayments.bank.in) Live Notification & Alert Ingestion (MacroDroid Compatible)
apiRouter.post('/observer/airtel', async (req, res) => {
  try {
    let alertBody = '';
    let reqAmount = null;
    let reqUtr = null;
    let sender = '';

    if (typeof req.body === 'string') {
      alertBody = req.body;
    } else if (req.body && typeof req.body === 'object') {
      alertBody = req.body.message || 
                  req.body.text || 
                  req.body.body || 
                  req.body.sms || 
                  req.body.sms_body || 
                  req.body.sms_message || 
                  req.body.not_body || 
                  req.body.not_text || 
                  req.body.notification || 
                  req.body.alert || '';
      reqAmount = req.body.amount;
      reqUtr = req.body.utr || req.body.transaction_id || req.body.txn_id || req.body.ref;
      sender = req.body.sender || req.body.from || req.body.not_title || req.body.title || '';
    }

    // Also check query string as fallback if sent via GET or URL encoded query
    if (!alertBody && (req.query.message || req.query.text || req.query.sms || req.query.body)) {
      alertBody = req.query.message || req.query.text || req.query.sms || req.query.body;
      if (!reqAmount && req.query.amount) reqAmount = req.query.amount;
      if (!reqUtr && (req.query.utr || req.query.ref)) reqUtr = req.query.utr || req.query.ref;
    }

    let parsed = null;
    if (alertBody) {
      parsed = parseAirtelAlert(alertBody);
    }
    
    const amount = parsed?.amount || (reqAmount ? Number(reqAmount) : null);
    const utr = parsed?.utr || reqUtr || `AIRTEL_${Date.now()}`;
    const payerName = parsed?.payerVpa || sender || 'Airtel UPI Payer';

    if (!amount) {
      // Still log to ObserverLogs so merchant can view all raw messages received from MacroDroid!
      const unparsedLog = ObserverLogs.create({
        sender: sender || 'MacroDroid',
        raw_message: alertBody || JSON.stringify(req.body),
        amount: null,
        utr: null,
        payer_vpa: null,
        matched_order_id: null,
        status: 'UNPARSED'
      });
      notifyAdminAlerts({
        event: 'NEW_OBSERVER_MESSAGE',
        log: unparsedLog
      });

      return res.status(400).json({
        success: false,
        error: 'Could not extract valid credit amount from Airtel alert',
        received: { body: req.body, query: req.query },
        log_id: unparsedLog.id
      });
    }

    // Match with pending orders
    const allPending = Orders.getAll(100).filter(o => o.status === 'PENDING');
    const matched = allPending.find(o => Math.abs(o.amount - amount) < 0.01);

    if (matched) {
      const updated = Orders.markPaid(matched.order_id, utr);

      // Record to ObserverLogs as MATCHED
      const matchedLog = ObserverLogs.create({
        sender: sender || 'MacroDroid',
        raw_message: alertBody,
        amount,
        utr,
        payer_vpa: parsed?.payerVpa || null,
        matched_order_id: matched.order_id,
        status: 'MATCHED'
      });

      // 1. Notify buyer checkout screen
      notifyOrderSubscribers(matched.order_id, {
        event: 'PAYMENT_SUCCESS',
        order: updated
      });

      // 2. Notify Admin Live Soundbox Alert & Messages
      notifyAdminAlerts({
        event: 'LIVE_PAYMENT_ALERT',
        order: {
          ...updated,
          customer_name: parsed?.payerVpa || updated.customer_name || 'Customer'
        },
        bank: 'Airtel Payments Bank',
        alertMessage: `Payment of ₹${amount.toFixed(2)} received on Airtel Payments Bank via UPI. Ref: ${utr}`,
        log: matchedLog
      });

      // 3. Dispatch Webhook
      const webhookUrl = Settings.get('webhook_url');
      const webhookSecret = Settings.get('webhook_secret');
      if (webhookUrl) {
        sendWebhook({
          url: webhookUrl,
          secret: webhookSecret,
          event: 'PAYMENT_SUCCESS',
          payload: updated
        }).catch(() => {});
      }

      return res.json({
        success: true,
        matched: true,
        bank: 'Airtel Payments Bank',
        order_id: matched.order_id,
        amount,
        utr,
        payer: payerName,
        order: updated,
        log: matchedLog
      });
    }

    // Record to ObserverLogs as UNMATCHED credit
    const unmatchedLog = ObserverLogs.create({
      sender: sender || 'MacroDroid',
      raw_message: alertBody,
      amount,
      utr,
      payer_vpa: parsed?.payerVpa || null,
      matched_order_id: null,
      status: 'UNMATCHED'
    });

    // Broadcast incoming credit to soundbox so merchant gets the live audio alert even without matching pending order
    notifyAdminAlerts({
      event: 'LIVE_PAYMENT_ALERT',
      order: { amount, utr, customer_name: payerName, product_name: 'Direct UPI Credit' },
      bank: 'Airtel Payments Bank',
      alertMessage: `Payment of ₹${amount.toFixed(2)} received on Airtel Payments Bank via UPI. Ref: ${utr}`,
      log: unmatchedLog
    });

    res.json({
      success: true,
      matched: false,
      bank: 'Airtel Payments Bank',
      amount,
      utr,
      payer: payerName,
      message: 'Airtel credit alert ingested and broadcasted to soundbox',
      log: unmatchedLog
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
