#!/usr/bin/env node
// Receipt generator used by the invoice pipeline.
// Renders a plain-text "printable" receipt for an order.

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf('--' + name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : '';
}

const orderId = arg('order') || 'unknown';
const message = arg('message');
const items = (arg('items') || '').split(';').filter(Boolean);
const out = arg('out') || `/tmp/netpoint-receipt-${orderId}.txt`;

const lines = [];
lines.push('=====================================================');
lines.push('                NETPOINT STORE RECEIPT');
lines.push(`                 Order #${orderId}`);
lines.push('=====================================================');
lines.push('');
lines.push('ITEMS:');
for (const it of items) lines.push('  - ' + it.trim());
lines.push('');
if (message) {
  lines.push('GIFT NOTE:');
  lines.push('  ' + message);
  lines.push('');
}
lines.push('Thank you for shopping with NetPoint Store!');
lines.push('Questions? support@netpoint.store');

require('fs').writeFileSync(out, lines.join('\n'));
