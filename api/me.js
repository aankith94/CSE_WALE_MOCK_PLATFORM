// Public list of tests + (when logged in) the student's profile, payment and attempt status.
const L = require('./_lib');
let statsCache = { at: 0, v: null };
async function publicStats() {
  if (Date.now() - statsCache.at < 60000 && statsCache.v) return statsCache.v;
  const [students, submitted] = await Promise.all([L.count('profiles', ''), L.count('attempts', 'submitted_at=not.is.null')]);
  statsCache = { at: Date.now(), v: { students, submitted } };
  return statsCache.v;
}
module.exports = L.wrap(async req => {
  if (req.method === 'POST' && L.q(req).get('action') === 'profile') {
    const user = await L.getUser(req); await L.ensureProfile(user);
    const b = L.body(req), patch = {};
    if (b.mobile !== undefined) { if (!/^[6-9]\d{9}$/.test(String(b.mobile))) throw L.err(400, 'Enter a valid 10-digit mobile number.'); patch.mobile = String(b.mobile); }
    if (b.name !== undefined) { const n = String(b.name).trim(); if (n.length < 2 || n.length > 80) throw L.err(400, 'Enter your full name.'); patch.name = n; }
    if (!Object.keys(patch).length) throw L.err(400, 'Nothing to save.');
    await L.update('profiles', 'id=eq.' + user.id, patch);
    return { ok: true };
  }
  const tests = (await L.select('tests', 'published=eq.true&order=sort.asc,created_at.asc')).map(L.publicTest);
  const user = await L.getUser(req, false);
  const stats = await publicStats();
  if (!user) return { tests, user: null, stats };
  const profile = await L.ensureProfile(user);
  const [paid, att] = await Promise.all([L.isPaid(user.id), L.select('attempts', 'user_id=eq.' + user.id + '&select=test_id,submitted_at,score,started_at,duration_sec')]);
  const attempts = {};
  att.forEach(a => {
    const over = Date.parse(a.started_at) + a.duration_sec * 1000 + 90000 < Date.now();
    attempts[a.test_id] = a.submitted_at ? { status: 'submitted', score: a.score } : { status: over ? 'expired' : 'in_progress' };
  });
  return { tests, stats, user: { id: user.id, name: profile.name, email: profile.email, mobile: profile.mobile, paid, admin: L.isAdmin(user) }, attempts };
});
