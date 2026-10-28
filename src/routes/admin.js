import express from 'express';
import { Orders, Settings, ObserverLogs } from '../db.js';
import { notifyOrderSubscribers, notifyAdminAlerts } from './api.js';
import { sendWebhook } from '../utils/webhook.js';

export const adminRouter = express.Router();

// 1. Admin Login Verification
adminRouter.post('/login', (req, res) => {
  const { passkey } = req.body;
  const configured = Settings.get('admin_passkey', 'admin123');
  
  if (passkey === configured) {
    return res.json({ success: true, token: 'ctx_admin_session_' + Date.now() });
  }
  return res.status(401).json({ success: false, error: 'Invalid admin passcode' });
});

// 2. Overview metrics
adminRouter.get('/metrics', (req, res) => {
  const stats = Orders.getStats();
  const settings = Settings.getAll();
  res.json({
    success: true,
    stats,
    settings: {
      upi_vpa: settings.upi_vpa || 'merchant@upi',
      upi_name: settings.upi_name || 'Cortex Store',
      webhook_url: settings.webhook_url || '',
      merchant_api_key: settings.merchant_api_key || '',
      store_name: settings.store_name || 'Cortex UPI Payment Gateway'
    }
  });
});

// 3. Orders Ledger
adminRouter.get('/orders', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const orders = Orders.getAll(limit);
  res.json({ success: true, orders });
});

// 4. Update Order Status (Approve / Reject / Simulate)
adminRouter.post('/orders/:id/status', async (req, res) => {
  try {
    const { status, utr } = req.body;
    const orderId = req.params.id;

    const order = Orders.getById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const assignedUtr = utr || (status === 'PAID' ? `UTR${Date.now()}` : null);
    const updated = Orders.updateStatus(orderId, status, assignedUtr);

    // Notify connected checkout sessions in real time
    notifyOrderSubscribers(orderId, {
      event: status === 'PAID' ? 'PAYMENT_SUCCESS' : 'ORDER_UPDATED',
      order: updated
    });

    // Notify Paytm-style Live Soundbox Alert terminal
    if (status === 'PAID') {
      notifyAdminAlerts({
        event: 'LIVE_PAYMENT_ALERT',
        order: updated,
        alertMessage: `Payment of ₹${Number(updated.amount).toFixed(2)} received successfully via UPI`
      });

      // Dispatch signed webhook
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
    }

    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Get Settings
adminRouter.get('/settings', (req, res) => {
  const all = Settings.getAll();
  // Don't expose passkey in plaintext
  const sanitized = { ...all };
  delete sanitized.admin_passkey;
  res.json({
    success: true,
    settings: sanitized
  });
});

// 6. Clear All Orders (Purge Ledger)
adminRouter.post('/orders/clear', (req, res) => {
  try {
    Orders.clearAll();
    res.json({ success: true, message: 'All orders cleared successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Update Settings
adminRouter.post('/settings', (req, res) => {
  const { upi_vpa, upi_name, webhook_url, webhook_secret, merchant_api_key, store_name, admin_passkey } = req.body;
  
  if (upi_vpa) Settings.set('upi_vpa', upi_vpa.trim());
  if (upi_name) Settings.set('upi_name', upi_name.trim());
  if (webhook_url !== undefined) Settings.set('webhook_url', webhook_url.trim());
  if (webhook_secret !== undefined) Settings.set('webhook_secret', webhook_secret.trim());
  if (merchant_api_key !== undefined) Settings.set('merchant_api_key', merchant_api_key.trim());
  if (store_name !== undefined) Settings.set('store_name', store_name.trim());
  if (admin_passkey) Settings.set('admin_passkey', admin_passkey.trim());

  res.json({
    success: true,
    message: 'Settings saved successfully'
  });
});

// 7. Test Webhook Delivery
adminRouter.post('/webhook/test', async (req, res) => {
  const webhookUrl = Settings.get('webhook_url');
  const webhookSecret = Settings.get('webhook_secret');

  if (!webhookUrl) {
    return res.status(400).json({ error: 'No Webhook URL configured in settings' });
  }

  const samplePayload = {
    order_id: `TEST-${Date.now()}`,
    amount: 499.00,
    currency: 'INR',
    customer_name: 'Test Buyer',
    status: 'PAID',
    utr: `SIM${Date.now()}`,
    paid_at: new Date().toISOString()
  };

  const outcome = await sendWebhook({
    url: webhookUrl,
    secret: webhookSecret,
    event: 'TEST_WEBHOOK',
    payload: samplePayload
  });

  res.json({
    success: outcome.success,
    outcome
  });
});

// 8. Get All Incoming Messages from MacroDroid
adminRouter.get('/observer-logs', (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const logs = ObserverLogs.getAll(limit);
  const count = ObserverLogs.getCount();
  res.json({ success: true, count, logs });
});

// 9. Clear Incoming MacroDroid Messages
adminRouter.post('/observer-logs/clear', (req, res) => {
  try {
    ObserverLogs.clearAll();
    res.json({ success: true, message: 'All incoming MacroDroid messages cleared successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
