import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { apiRouter } from './routes/api.js';
import { adminRouter } from './routes/admin.js';
import { Settings } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.resolve(rootDir, 'public');

const app = express();
const PORT = Number(process.env.PORT || 5000);

// Global Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Gateway-Event', 'X-Gateway-Signature']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: ['text/plain', 'text/*'] }));

// Serve static assets (youpi.js, styles.css)
app.use(express.static(publicDir));

// Primary Web UI Routes
// 1. Buyer Storefront
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// 2. Merchant Admin Dashboard
app.get('/admin', (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

// 3. Buyer Hosted Checkout Page / Modal
app.get('/checkout/:id', (req, res) => {
  res.sendFile(path.join(publicDir, 'checkout.html'));
});

// REST API Routers
app.use('/api', apiRouter);
app.use('/api/admin', adminRouter);

// Alias /observer directly so MacroDroid works even if user omitted /api/
app.use('/observer', (req, res, next) => {
  req.url = '/observer' + req.url;
  apiRouter(req, res, next);
});

// Start Single-Port Unified Server
const server = app.listen(PORT, '0.0.0.0', () => {
  const currentVpa = Settings.get('upi_vpa', 'merchant@upi');
  const currentName = Settings.get('upi_name', 'Cortex Store');

  console.log('\n============================================================');
  console.log('⚡ CORTEX UPI PAYMENT GATEWAY — UNIFIED 1-PORT SYSTEM');
  console.log('============================================================');
  console.log(`🟢 Gateway Online at:      http://localhost:${PORT}`);
  console.log('------------------------------------------------------------');
  console.log(`🛍️  Buyer Storefront:       http://localhost:${PORT}/`);
  console.log(`⚙️  Merchant Admin Hub:     http://localhost:${PORT}/admin`);
  console.log(`💳  Hosted Checkout Page:   http://localhost:${PORT}/checkout/:orderId`);
  console.log(`📦  Universal SDK Script:   http://localhost:${PORT}/youpi.js`);
  console.log(`🔌  Merchant REST API:      http://localhost:${PORT}/api/orders/create`);
  console.log(`🩺  Health Check:           http://localhost:${PORT}/api/health`);
  console.log('------------------------------------------------------------');
  console.log(`• Active Receiving UPI VPA: ${currentVpa}`);
  console.log(`• Merchant Payee Name:      ${currentName}`);
  console.log('============================================================');
  console.log('Press Ctrl+C in this terminal to gracefully stop the server.\n');
});

// Graceful termination
const shutdown = () => {
  console.log('\nStopping Cortex UPI Gateway gracefully...');
  server.close(() => {
    console.log('Server stopped cleanly.');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

