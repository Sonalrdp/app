/**
 * Airtel Payments Bank (airtelpayments.bank.in) Live Notification & SMS Parser
 * Matches authentic Airtel Payments Bank SMS formats, Android push notifications,
 * and NPCI 12-16 digit UPI reference/transaction numbers.
 */

export function parseAirtelAlert(text) {
  if (!text || (typeof text !== 'string' && typeof text !== 'object')) return null;

  let raw = '';
  if (typeof text === 'object') {
    raw = [
      text.message,
      text.text,
      text.body,
      text.sms,
      text.sms_body,
      text.not_body,
      text.not_title,
      text.title
    ].filter(Boolean).join(' ');
  } else {
    raw = String(text).trim();
  }

  if (!raw) return null;

  // 1. Amount Extraction
  // Priority 1: Match explicit credit phrases first to avoid accidentally picking up balance
  let amount = null;
  const creditPhrases = [
    // "credited with INR 1.00", "credited with Rs 1.00", "credited with Rs.1.00", "credited with ₹1.00"
    /(?:credited\s+with|credited\s+by|has\s+been\s+credited\s+with|credited\s+for)\s+(?:INR|Rs\.?|₹)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
    // "received payment of Rs 1.00", "payment received of ₹1.00"
    /(?:received\s+payment\s+of|payment\s+received\s+of|payment\s+of)\s+(?:INR|Rs\.?|₹)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
    // "Payment received ... +₹1.00" or "+ ₹1.00" or "+1.00"
    /\+\s*(?:INR|Rs\.?|₹)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
    // "₹1.00 received" or "Rs 1.00 received"
    /(?:INR|Rs\.?|₹)\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:received|deposited|added)/i,
    // General fallback: (?:INR|Rs\.?|₹)\s*1.00 (not preceded by Bal or Balance)
    /(?<!(?:bal|balance|avail\s+bal)[\s:]*)(?:INR|Rs\.?|₹)\s*([0-9]+(?:\.[0-9]{1,2})?)/i
  ];

  for (const regex of creditPhrases) {
    const match = raw.match(regex);
    if (match && match[1]) {
      const val = parseFloat(match[1]);
      if (!isNaN(val) && val > 0) {
        amount = val;
        break;
      }
    }
  }

  // 2. Reference ID (UTR / 12-16 digit Transaction ID)
  // Handles:
  // "Transaction ID: 561028232084564" (15-digit Airtel transaction ID)
  // "UPI Ref no 561028232084564" or "UPI Ref 561028232084564"
  // "UTR: 561028232084" or "Ref: 561028232084564"
  let utr = null;
  const utrRegex = /(?:Transaction\s+ID|Txn\s+ID|TxnID|UPI\s+Ref(?:\s+no)?\.?|UTR|Ref\s*no\.?|Ref)[\s:]*([0-9]{10,18})/i;
  const utrMatch = raw.match(utrRegex);
  if (utrMatch) {
    utr = utrMatch[1];
  } else {
    // Fallback: search for any standalone 12-16 digit numeric sequence
    const standaloneDigits = raw.match(/\b([0-9]{12,16})\b/);
    if (standaloneDigits) {
      utr = standaloneDigits[1];
    }
  }

  // 3. Payer UPI VPA extraction (e.g. "from hhtpubgclub@ptyes" or "by UPI:hhtpubgclub@ptyes")
  let payerVpa = null;
  const vpaRegex = /(?:from|by\s+UPI:?)\s*([a-zA-Z0-9.\-_]{2,45}@[a-zA-Z0-9]{2,25})/i;
  const vpaMatch = raw.match(vpaRegex);
  if (vpaMatch) {
    payerVpa = vpaMatch[1];
  }

  // 4. Account ending
  const acctRegex = /(?:A\/c|account)[\s:]*(?:ending\s+in|ending\s+with|no\.?|XX)?\s*([0-9]{3,10})/i;
  const acctMatch = raw.match(acctRegex);
  const accountEnding = acctMatch ? acctMatch[1] : null;

  if (!amount && !utr) {
    return null;
  }

  return {
    bank: 'Airtel Payments Bank',
    amount: amount || 0,
    utr: utr || `AIRTEL_${Date.now()}`,
    payerVpa,
    accountEnding,
    rawText: raw,
    timestamp: new Date().toISOString()
  };
}
