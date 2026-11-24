// Razorpay webhook: unlocks access even if the student closes the tab right after paying.
// In Razorpay Dashboard -> Webhooks: URL https://YOUR-SITE/api/webhook, events payment.captured + order.paid, set a secret.
const L = require('./_lib');
const { markPaid } = require('./pay');
const raw = req => new Promise((ok, no) => { let d = ''; req.on('data', c => d += c); req.on('end', () => ok(d)); req.on('error', no); });
const handler = L.wrap(async (req, res) => {
  if (req.method !== 'POST') throw L.err(405, 'POST only');
  const text = req.rawBody !== undefined ? String(req.rawBody) : await raw(req);
  const secret = L.env('RAZORPAY_WEBHOOK_SECRET');
  if (!secret || !L.safeEq(L.hmac(secret, text), req.headers['x-razorpay-signature'] || '')) throw L.err(400, 'Bad signature');
  const ev = JSON.parse(text);
  const pay = ev.payload && ev.payload.payment && ev.payload.payment.entity;
  const order = ev.payload && ev.payload.order && ev.payload.order.entity;
  if (['payment.captured', 'order.paid'].includes(ev.event)) {
    const orderId = (pay && pay.order_id) || (order && order.id);
    if (orderId) await markPaid(orderId, pay && pay.id);
  }
  return { ok: true };
});
module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
