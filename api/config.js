const { env, PRICE, MRP, wrap } = require('./_lib');
const NEED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'ADMIN_EMAILS'];
module.exports = wrap(async () => ({
  supabaseUrl: env('SUPABASE_URL'), supabaseAnonKey: env('SUPABASE_ANON_KEY'),
  razorpayKeyId: env('RAZORPAY_KEY_ID'), price: PRICE() / 100, mrp: MRP() / 100,
  missing: NEED.filter(k => !env(k))
}));
