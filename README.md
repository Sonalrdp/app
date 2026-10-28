# ⚡ Cortex UPI Payment Gateway — Unified 1-Port Architecture

A self-hosted, sovereign, zero-fee UPI payment gateway designed to run entirely on **ONE PORT** (`http://localhost:5000`) with:
1. **Buyer Storefront**: Complete e-commerce buying experience with dynamic QR code & mobile UPI intent app triggers (GPay, PhonePe, Paytm, CRED).
2. **Merchant Admin Dashboard**: Real-time transaction ledger, metrics, receiving UPI ID configuration, and webhook HMAC testing.
3. **Universal 1-Script SDK & REST API**: For external websites to accept UPI payments in seconds.
4. **Local Terminal Database CLI**: Inspect and manage orders and settings directly from the terminal.

---

## 🚀 Quickstart

Simply run the batch file:
```cmd
run.bat
```

Or start with npm:
```bash
npm install
npm start
```

---

## 🌐 Unified Service Endpoints (Port 5000)

| Service | URL | Description |
| :--- | :--- | :--- |
| **Buyer Storefront** | [`http://localhost:5000/`](http://localhost:5000/) | Live storefront where buyers choose products & pay via UPI |
| **Merchant Admin Hub** | [`http://localhost:5000/admin`](http://localhost:5000/admin) | Dashboard for transactions, UPI VPA settings & webhooks |
| **Hosted Checkout Page** | `http://localhost:5000/checkout/:orderId` | Responsive checkout modal with dynamic QR & 1-tap app intents |
| **Universal Client SDK** | [`http://localhost:5000/youpi.js`](http://localhost:5000/youpi.js) | Embeddable 1-script drop-in for external merchant sites |
| **API Health Check** | [`http://localhost:5000/api/health`](http://localhost:5000/api/health) | Gateway uptime and health status |

---

## 💻 Local Terminal Database CLI

To manage orders, check metrics, or approve payments directly from your command line:
```bash
npm run db:cli
```

Available CLI commands:
- `orders` — View recent orders, amounts, and statuses in a table.
- `stats` — View revenue volume, total orders, and conversion rate.
- `approve <order_id> [utr]` — Manually approve an order and mark as PAID.
- `view <order_id>` — View full JSON record of an order.
- `set-vpa <upi_id>` — Update your receiving UPI address on the fly.
- `sql <query>` — Execute raw SQL queries on the local SQLite database.
- `help` — Show command menu.

---

## 🔌 Integrating into External Websites

### Method 1: Drop-in 1-Button Script (Zero-JS)
Add this script and tag any button:
```html
<script src="http://localhost:5000/youpi.js"></script>

<button data-youpi-pay
        data-amount="499"
        data-order-id="ORDER-1001"
        data-product-name="Pro Access">
  Buy Now with UPI
</button>
```

### Method 2: Programmatic JavaScript API
```javascript
Youpi.pay({
  amount: 499.00,
  order_id: 'ORDER-1002',
  product_name: 'Premium Subscription',
  customer: { name: 'Mohit', email: 'mohit@example.com' },
  handler: function(response) {
    console.log('Payment confirmed:', response.order_id, response.utr);
  }
});
```

### Method 3: Backend REST API
Create a checkout session via cURL or any backend:
```bash
curl -X POST http://localhost:5000/api/orders/create \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 499,
    "product_name": "Pro Membership",
    "customer_name": "Rohan"
  }'
```

Response includes `checkout_url`, `qr_data_url`, and mobile UPI app intents (`gpay`, `phonepe`, `paytm`, `cred`).
