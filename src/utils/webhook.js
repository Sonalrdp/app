import crypto from 'node:crypto';

/**
 * Dispatches authoritative server-to-server webhook
 */
export async function sendWebhook({ url, secret, event, payload }) {
  if (!url || !url.startsWith('http')) {
    return { skipped: true, reason: 'No valid webhook URL configured' };
  }

  const rawBody = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    payload
  });

  const signature = 'sha256=' + crypto.createHmac('sha256', secret || 'secret').update(rawBody).digest('hex');
  const deliveryId = crypto.randomUUID();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Event': event,
        'X-Gateway-Signature': signature,
        'X-Gateway-Delivery-Id': deliveryId,
        'X-Gateway-Timestamp': String(Date.now())
      },
      body: rawBody,
      signal: controller.signal
    });

    clearTimeout(timer);
    return {
      success: res.ok,
      status: res.status,
      deliveryId,
      signature
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      deliveryId
    };
  }
}

