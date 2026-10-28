import QRCode from 'qrcode';

/**
 * Builds standard NPCI compliant UPI specification string
 */
export function buildUpiString({ vpa, name, amount, orderId, note }) {
  const cleanVpa = String(vpa || '').trim();
  const cleanName = encodeURIComponent(String(name || 'Merchant').trim());
  const formattedAmount = Number(amount).toFixed(2);
  const cleanNote = encodeURIComponent(String(note || `Order ${orderId}`).trim());
  const cleanOrderId = encodeURIComponent(String(orderId).trim());

  return `upi://pay?pa=${cleanVpa}&pn=${cleanName}&am=${formattedAmount}&cu=INR&tn=${cleanNote}&tr=${cleanOrderId}`;
}

/**
 * Generates Base64 Data URL for QR Code
 */
export async function generateQrDataUrl(upiString) {
  return await QRCode.toDataURL(upiString, {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    margin: 1,
    width: 320,
    color: {
      dark: '#0f172a',
      light: '#ffffff'
    }
  });
}

/**
 * Generates Mobile Deep-Link Intents for top Indian UPI applications
 */
export function getAppIntents(upiString) {
  const stripped = upiString.replace(/^upi:\/\/pay\?/, '');
  return {
    generic: upiString,
    gpay: `tez://upi/pay?${stripped}`,
    phonepe: `phonepe://pay?${stripped}`,
    paytm: `paytmmp://pay?${stripped}`,
    cred: `cred://pay?${stripped}`,
    bhim: `upi://pay?${stripped}`
  };
}

