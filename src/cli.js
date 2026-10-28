import readline from 'node:readline';
import { db, Orders, Settings, Products } from './db.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function printBanner() {
  console.clear();
  console.log('============================================================');
  console.log('  ⚡ CORTEX UPI GATEWAY — LOCAL TERMINAL DATABASE CLI');
  console.log('============================================================');
  console.log('  Commands:');
  console.log('    1. orders          - List recent orders and payment status');
  console.log('    2. stats           - View summary revenue and conversion metrics');
  console.log('    3. approve <id>    - Manually approve order and mark as PAID');
  console.log('    4. view <id>       - View complete JSON record for an order');
  console.log('    5. settings        - View active UPI VPA & Webhook settings');
  console.log('    6. set-vpa <vpa>   - Update receiving UPI VPA');
  console.log('    7. sql <query>     - Execute raw SQL query on local SQLite DB');
  console.log('    8. help            - Show this menu');
  console.log('    9. exit            - Exit CLI');
  console.log('============================================================\n');
}

function showOrders() {
  const rows = Orders.getAll(20);
  if (rows.length === 0) {
    console.log('[-] No orders recorded yet.');
    return;
  }
  console.table(rows.map(r => ({
    'Order ID': r.order_id,
    'Product': r.product_name,
    'Amount (₹)': r.amount.toFixed(2),
    'Status': r.status,
    'UTR': r.utr || '—',
    'Date': r.created_at.replace('T', ' ').slice(0, 19)
  })));
}

function showStats() {
  const stats = Orders.getStats();
  console.log('\n--- Gateway Summary Metrics ---');
  console.log(`• Total Orders    : ${stats.totalOrders}`);
  console.log(`• Paid Orders     : ${stats.paidOrders}`);
  console.log(`• Pending Orders  : ${stats.pendingOrders}`);
  console.log(`• Total Volume (₹): ₹${stats.totalVolume.toLocaleString('en-IN')}`);
  console.log(`• Conversion Rate : ${stats.conversionRate}%\n`);
}

function handleInput() {
  rl.question('cortex-db> ', (line) => {
    const raw = line.trim();
    const [cmd, ...args] = raw.split(/\s+/);

    switch (cmd.toLowerCase()) {
      case '1':
      case 'orders':
        showOrders();
        break;

      case '2':
      case 'stats':
        showStats();
        break;

      case '3':
      case 'approve': {
        const orderId = args[0];
        if (!orderId) {
          console.log('[!] Usage: approve <order_id> [utr]');
        } else {
          const utr = args[1] || `MANUAL_CLI_${Date.now()}`;
          const updated = Orders.markPaid(orderId, utr);
          if (updated) {
            console.log(`[✓] Order ${orderId} marked as PAID with UTR ${utr}`);
          } else {
            console.log(`[-] Order ${orderId} not found.`);
          }
        }
        break;
      }

      case '4':
      case 'view': {
        const orderId = args[0];
        if (!orderId) {
          console.log('[!] Usage: view <order_id>');
        } else {
          const order = Orders.getById(orderId);
          if (order) {
            console.log(JSON.stringify(order, null, 2));
          } else {
            console.log(`[-] Order ${orderId} not found.`);
          }
        }
        break;
      }

      case '5':
      case 'settings': {
        const settings = Settings.getAll();
        console.table(Object.entries(settings).map(([k, v]) => ({ Setting: k, Value: v })));
        break;
      }

      case '6':
      case 'set-vpa': {
        const vpa = args[0];
        if (!vpa) {
          console.log('[!] Usage: set-vpa <upi_id@bank>');
        } else {
          Settings.set('upi_vpa', vpa);
          console.log(`[✓] Receiving UPI VPA updated to: ${vpa}`);
        }
        break;
      }

      case '7':
      case 'sql': {
        const query = args.join(' ');
        if (!query) {
          console.log('[!] Usage: sql <SELECT ...>');
        } else {
          try {
            if (/^\s*select/i.test(query)) {
              const res = db.prepare(query).all();
              console.table(res);
            } else {
              db.exec(query);
              console.log('[✓] Query executed successfully.');
            }
          } catch (err) {
            console.log(`[-] SQL Error: ${err.message}`);
          }
        }
        break;
      }

      case '8':
      case 'help':
        printBanner();
        break;

      case '9':
      case 'exit':
      case 'quit':
        rl.close();
        process.exit(0);
        return;

      case '':
        break;

      default:
        console.log(`[-] Unknown command '${cmd}'. Type 'help' for instructions.`);
        break;
    }

    handleInput();
  });
}

printBanner();
handleInput();

