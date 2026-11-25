// Shared helpers. No npm packages: only Node built-ins and fetch.
const crypto = require('crypto');
// Network hardening: some connections (Windows, some Indian ISPs) hang on IPv6 or on the first connect.
// Prefer IPv4, try the next address quickly, and retry once or twice on connection errors.
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (e) {}
try { const n = require('net'); n.setDefaultAutoSelectFamily && n.setDefaultAutoSelectFamily(true); n.setDefaultAutoSelectFamilyAttemptTimeout && n.setDefaultAutoSelectFamilyAttemptTimeout(1500); } catch (e) {}
const NETERR = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR|timeout|socket/i;
async function sfetch(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fetch(url, opts); }
    catch (e) { last = e; const m = String(e && e.message) + ' ' + String(e && e.cause && (e.cause.code || e.cause.message)); if (!NETERR.test(m) || i === tries - 1) break; await new Promise(r => setTimeout(r, 400 * (i + 1))); }
  }
  throw Object.assign(new Error('Cannot reach the database (Supabase). Check your internet connection or DNS and try again.'), { status: 503, cause: last });
}
const env = n => process.env[n] || '';
const SBURL = () => env('SUPABASE_URL').replace(/\/$/, '');
const KEY = () => env('SUPABASE_SERVICE_KEY');
const PRICE = () => parseInt(env('PRICE_PAISE') || '9900', 10);
const MRP = () => parseInt(env('MRP_PAISE') || '19900', 10);

const err = (status, message) => Object.assign(new Error(message), { status });

async function sb(method, path, { body, prefer, headers } = {}) {
  const r = await sfetch(SBURL() + '/rest/v1/' + path, {
    method,
    // Old-style keys are JWTs (start with eyJ) and go in both headers. New-style keys (sb_secret_...) go in apikey only.
    headers: Object.assign({ apikey: KEY(), 'Content-Type': 'application/json' }, KEY().startsWith('eyJ') ? { Authorization: 'Bearer ' + KEY() } : {},
      prefer ? { Prefer: prefer } : {}, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const txt = await r.text();
  let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) {}
  if (r.status === 416) return { data: [], res: r };   // asked for rows beyond the end
  if (!r.ok) throw err(500, 'Database error: ' + ((data && (data.message || data.hint)) || txt || r.status));
  return { data, res: r };
}
const select = async (table, qs) => (await sb('GET', table + (qs ? '?' + qs : ''))).data || [];
// Supabase returns at most 1000 rows per request, so read big tables page by page.
const selectAll = async (table, qs) => {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb('GET', table + (qs ? '?' + qs : ''), { headers: { Range: from + '-' + (from + 999), 'Range-Unit': 'items' } });
    const rows = data || []; out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
};
const insert = async (table, rows, opt = {}) => {
  const q = opt.onConflict ? '?on_conflict=' + opt.onConflict : '';
  const prefer = ['return=representation'].concat(opt.onConflict ? [opt.ignore ? 'resolution=ignore-duplicates' : 'resolution=merge-duplicates'] : []).join(',');
  return (await sb('POST', table + q, { body: rows, prefer })).data || [];
};
const update = async (table, qs, patch) => (await sb('PATCH', table + '?' + qs, { body: patch, prefer: 'return=representation' })).data || [];
const remove = async (table, qs) => (await sb('DELETE', table + '?' + qs, { prefer: 'return=representation' })).data || [];
const count = async (table, qs) => {
  const { res } = await sb('GET', table + '?' + (qs ? qs + '&' : '') + 'select=id', { prefer: 'count=exact', headers: { Range: '0-0', 'Range-Unit': 'items' } });
  const m = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
  return m ? +m[1] : 0;
};

// ---- auth: verify the Supabase access token sent by the browser ----
const cache = new Map();
async function getUser(req, required = true) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!tok) { if (required) throw err(401, 'Please log in.'); return null; }
  const hit = cache.get(tok);
  if (hit && hit.exp > Date.now()) return hit.user;
  const r = await sfetch(SBURL() + '/auth/v1/user', { headers: { apikey: env('SUPABASE_ANON_KEY') || KEY(), Authorization: 'Bearer ' + tok } });
  if (!r.ok) { if (required) throw err(401, 'Your session has expired. Please log in again.'); return null; }
  const u = await r.json();
  const user = { id: u.id, email: (u.email || '').toLowerCase(), meta: u.user_metadata || {} };
  if (cache.size > 2000) cache.clear();
  cache.set(tok, { user, exp: Date.now() + 60000 });
  return user;
}
const nameFromEmail = e => (e || '').split('@')[0].replace(/[._\d]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase()) || 'Student';

async function ensureProfile(user) {
  const rows = await select('profiles', 'id=eq.' + user.id + '&limit=1');
  if (rows[0]) return rows[0];
  const row = {
    id: user.id, email: user.email,
    name: String(user.meta.name || user.meta.full_name || nameFromEmail(user.email)).slice(0, 80),
    mobile: String(user.meta.mobile || user.meta.phone || '').slice(0, 15)
  };
  await insert('profiles', row, { onConflict: 'id', ignore: true });
  return row;
}
const isAdmin = user => env('ADMIN_EMAILS').toLowerCase().split(',').map(s => s.trim()).filter(Boolean).includes(user.email);
async function isPaid(userId) { return (await count('purchases', 'user_id=eq.' + userId + '&status=eq.paid')) > 0; }

function status(t, now = Date.now()) {
  if (t.opens_at && Date.parse(t.opens_at) > now) return 'upcoming';
  if (t.closes_at && Date.parse(t.closes_at) <= now) return 'closed';
  return 'live';
}
const publicTest = t => ({ id: t.id, title: t.title, subtitle: t.subtitle, duration_min: t.duration_min, questions: t.question_count,
  total_marks: t.question_count * t.positive, positive: t.positive, negative: t.negative, opens_at: t.opens_at, closes_at: t.closes_at, status: status(t), free: !!t.is_free });

function wrap(fn) {
  return async (req, res) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined && !res.writableEnded) { res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(out)); }
    } catch (e) {
      const code = e.status || 500;
      if (code === 500) console.error(e);
      res.statusCode = code; res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: code === 500 && !/^Database error/.test(e.message) ? 'Something went wrong. Please try again.' : e.message }));
    }
  };
}
const body = req => (req.body && typeof req.body === 'object') ? req.body : (() => { try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; } })();
const q = req => new URL(req.url, 'http://x').searchParams;
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };

module.exports = { sfetch, env, err, sb, select, selectAll, insert, update, remove, count, getUser, ensureProfile, isAdmin, isPaid, status, publicTest, wrap, body, q, hmac, safeEq, PRICE, MRP };