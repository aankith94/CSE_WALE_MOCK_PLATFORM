// Local stand-in for Supabase (PostgREST + auth) and Razorpay, so the real API code can be tested offline.
const crypto = require('crypto');
const DB = { profiles: [], tests: [], questions: [], purchases: [], attempts: [] };
const seq = { questions: 0, purchases: 0 };
const realFetch = global.fetch;
const users = {}; // token -> user
const j = (code, obj, headers) => new Response(obj === undefined ? '' : JSON.stringify(obj), { status: code, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) });

function match(row, [k, v]) {
  const x = row[k];
  if (v.startsWith('eq.')) return String(x) === v.slice(3);
  if (v.startsWith('neq.')) return String(x) !== v.slice(4);
  if (v.startsWith('gt.')) return x != null && +x > +v.slice(3);
  if (v.startsWith('lt.')) return x != null && +x < +v.slice(3);
  if (v === 'is.null') return x == null;
  if (v === 'not.is.null') return x != null;
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(x));
  throw new Error('mock: unsupported filter ' + k + '=' + v);
}
function defaults(table, r) {
  const now = new Date().toISOString();
  if (table === 'profiles') r.created_at = r.created_at || now;
  if (table === 'questions') r.id = r.id || ++seq.questions;
  if (table === 'purchases') { r.id = r.id || ++seq.purchases; r.status = r.status || 'created'; r.created_at = now; r.paid_at = r.paid_at || null; r.razorpay_payment_id = r.razorpay_payment_id || null; }
  if (table === 'attempts') { r.id = r.id || crypto.randomUUID(); r.started_at = r.started_at || now; r.submitted_at = r.submitted_at || null; r.late = r.late || false; r.state = r.state || null; r.score = r.score ?? null; r.time_spent = r.time_spent ?? null; }
  if (table === 'tests') { r.positive = r.positive ?? 3; r.negative = r.negative ?? 1; r.created_at = r.created_at || now; r.sort = r.sort ?? 0; r.opens_at = r.opens_at ?? null; r.closes_at = r.closes_at ?? null; r.subtitle = r.subtitle ?? ''; }
  return r;
}
const UNIQUE = { profiles: ['id'], tests: ['id'], purchases: ['razorpay_order_id'], attempts: ['user_id', 'test_id'], questions: ['test_id', 'n'] };

async function rest(method, url, headers, bodyText) {
  const u = new URL(url), table = u.pathname.split('/').pop();
  if (!DB[table]) return j(404, { message: 'no table ' + table });
  const prefer = headers.Prefer || headers.prefer || '';
  const reserved = ['select', 'order', 'limit', 'on_conflict'];
  const filters = [...u.searchParams.entries()].filter(([k]) => !reserved.includes(k));
  let rows = DB[table].filter(r => filters.every(f => match(r, f)));
  if (method === 'GET') {
    const ord = u.searchParams.get('order');
    if (ord) ord.split(',').reverse().forEach(o => { const [c, d] = o.split('.'); rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (d === 'desc' ? -1 : 1)); });
    const total = rows.length;
    const lim = u.searchParams.get('limit'); if (lim) rows = rows.slice(0, +lim);
    const rg = headers.Range || headers.range; if (rg) { const [a, b] = rg.split('-').map(Number); rows = rows.slice(a, b + 1); }
    const sel = u.searchParams.get('select');
    if (sel && sel !== '*') rows = rows.map(r => Object.fromEntries(sel.split(',').map(c => [c, r[c]])));
    return j(200, rows, prefer.includes('count=exact') ? { 'content-range': (rows.length ? '0-' + (rows.length - 1) : '*') + '/' + total } : {});
  }
  if (method === 'POST') {
    let list = JSON.parse(bodyText); if (!Array.isArray(list)) list = [list];
    const out = [], conflict = u.searchParams.get('on_conflict'), uq = conflict ? conflict.split(',') : UNIQUE[table];
    for (const r of list) {
      const dup = DB[table].find(x => uq.every(k => String(x[k]) === String(r[k])));
      if (dup) {
        if (prefer.includes('ignore-duplicates')) continue;
        if (prefer.includes('merge-duplicates')) { Object.assign(dup, r); out.push(dup); continue; }
        return j(409, { message: 'duplicate key value violates unique constraint' });
      }
      const row = defaults(table, Object.assign({}, r)); DB[table].push(row); out.push(row);
    }
    return j(201, out);
  }
  if (method === 'PATCH') { const patch = JSON.parse(bodyText); rows.forEach(r => Object.assign(r, patch)); return j(200, rows); }
  if (method === 'DELETE') { DB[table] = DB[table].filter(r => !rows.includes(r)); return j(200, rows); }
}
let orderN = 0;
global.fetch = async (url, opt = {}) => {
  url = String(url); const m = (opt.method || 'GET').toUpperCase(), h = opt.headers || {};
  if (url.startsWith('http://mock-supabase/rest/v1/')) return rest(m, url, h, opt.body);
  if (url === 'http://mock-supabase/auth/v1/user') {
    const t = (h.Authorization || '').replace('Bearer ', ''), u = users[t];
    return u ? j(200, u) : j(401, { message: 'invalid token' });
  }
  if (url === 'https://api.razorpay.com/v1/orders') {
    const want = 'Basic ' + Buffer.from('rzp_test_key:rzp_secret').toString('base64');
    if (h.Authorization !== want) return j(401, { error: 'bad auth' });
    const b = JSON.parse(opt.body); return j(200, { id: 'order_' + (++orderN), amount: b.amount, currency: b.currency });
  }
  return realFetch(url, opt);
};
const addUser = (email, meta = {}) => { const tok = 'tok-' + email; users[tok] = { id: crypto.createHash('md5').update(email).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5'), email, user_metadata: meta }; return tok; };
module.exports = { DB, users, addUser };
