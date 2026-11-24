// Razorpay: create an order on the server, then verify the signature on the server.
const L = require('./_lib');
async function markPaid(orderId, paymentId) {
  const rows = await L.update('purchases', 'razorpay_order_id=eq.' + encodeURIComponent(orderId) + '&status=neq.paid',
    { status: 'paid', razorpay_payment_id: paymentId || null, paid_at: new Date().toISOString() });
  return rows.length;
}
module.exports = L.wrap(async req => {
  if (req.method !== 'POST') throw L.err(405, 'POST only');
  const user = await L.getUser(req);
  const action = L.q(req).get('action');
  const secret = L.env('RAZORPAY_KEY_SECRET'), keyId = L.env('RAZORPAY_KEY_ID');
  if (!secret || !keyId) throw L.err(503, 'Payments are not set up yet.');
  if (action === 'order') {
    await L.ensureProfile(user);
    if (await L.isPaid(user.id)) return { paid: true };
    const amount = L.PRICE();
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(keyId + ':' + secret).toString('base64') },
      body: JSON.stringify({ amount, currency: 'INR', receipt: 'cw_' + Date.now().toString(36), notes: { user_id: user.id, email: user.email } })
    });
    const o = await r.json();
    if (!r.ok) throw L.err(502, 'Could not start the payment. Please try again.');
    await L.insert('purchases', { user_id: user.id, razorpay_order_id: o.id, amount, status: 'created' });
    return { order_id: o.id, amount, currency: 'INR', key_id: keyId };
  }
  if (action === 'verify') {
    const b = L.body(req);
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = b;
    if (!oid || !pid || !sig) throw L.err(400, 'Missing payment details.');
    if (!L.safeEq(L.hmac(secret, oid + '|' + pid), sig)) throw L.err(400, 'Payment could not be verified.');
    const mine = await L.select('purchases', 'razorpay_order_id=eq.' + encodeURIComponent(oid) + '&user_id=eq.' + user.id + '&limit=1');
    if (!mine[0]) throw L.err(404, 'Order not found.');
    await markPaid(oid, pid);
    return { ok: true };
  }
  throw L.err(400, 'Unknown action');
});
module.exports.markPaid = markPaid;
