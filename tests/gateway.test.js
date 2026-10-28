import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAirtelAlert } from '../src/utils/airtel-parser.js';

test('Airtel Parser extracts amount, UTR and payer VPA from standard SMS', () => {
  const sms = 'Dear Customer, Your Airtel Payments Bank A/c 9876543210 is credited with Rs 1.00 on 28-OCT-26 by UPI:hhtpubgclub@ptyes (UPI Ref no 561028232084564). Avail Bal: Rs 43.00.';
  const parsed = parseAirtelAlert(sms);

  assert.ok(parsed, 'Parsed object should not be null');
  assert.equal(parsed.amount, 1.00);
  assert.equal(parsed.utr, '561028232084564');
  assert.equal(parsed.payerVpa, 'hhtpubgclub@ptyes');
});

test('Airtel Parser extracts dashboard format transaction', () => {
  const alertText = 'Payment received from itudutta.2014@oksbi Transaction ID: 561015214927904 Amount: +₹40.00';
  const parsed = parseAirtelAlert(alertText);

  assert.ok(parsed, 'Parsed object should not be null');
  assert.equal(parsed.amount, 40.00);
  assert.equal(parsed.utr, '561015214927904');
  assert.equal(parsed.payerVpa, 'itudutta.2014@oksbi');
});

test('Airtel Parser rejects invalid or irrelevant messages', () => {
  const invalidText = 'Your OTP for login is 123456. Do not share with anyone.';
  const parsed = parseAirtelAlert(invalidText);

  assert.equal(parsed, null);
});
