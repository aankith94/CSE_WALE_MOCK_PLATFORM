// Owner dashboard API. Only emails listed in ADMIN_EMAILS can use it. Everything here is read from the real database.
const L = require('./_lib');
const enc = encodeURIComponent;
const safe = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) ? "'" + v : v;   // stop Excel running a student's name as a formula
const csv = rows => rows.map(r => r.map(v => { v = v == null ? '' : String(safe(v)); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n');
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const day = ts => { const t = Date.parse(ts); return isNaN(t) ? '' : new Date(t + 19800000).toISOString().slice(0, 10); };   // India date
const lastDays = n => Array.from({ length: n }, (_, i) => new Date(Date.now() + 19800000 - (n - 1 - i) * 864e5).toISOString().slice(0, 10));
async function profilesFor(ids) {
  const map = {};
  for (const part of chunk([...new Set(ids)], 80)) (await L.select('profiles', 'id=in.(' + part.join(',') + ')')).forEach(p => { map[p.id] = p; });
  return map;
}
function validate(list) {
  if (!Array.isArray(list) || !list.length) throw L.err(400, 'The questions file must be a list of questions.');
  const seen = new Set(), problems = [], rows = [];
  list.forEach((x, i) => {
    const at = 'Question ' + (i + 1) + ': ';
    if (!Number.isInteger(x.n) || x.n < 1) problems.push(at + 'n must be a whole number');
    else if (seen.has(x.n)) problems.push(at + 'n ' + x.n + ' is repeated'); else seen.add(x.n);
    if (!x.s || !x.q) problems.push(at + 'subject (s) and question text (q) are required');
    if (!Array.isArray(x.o) || x.o.length !== 4 || x.o.some(o => !String(o).trim())) problems.push(at + 'o must have exactly 4 non-empty options');
    if (!Number.isInteger(x.a) || x.a < 0 || x.a > 3) problems.push(at + 'a (correct option) must be 0, 1, 2 or 3');
    rows.push({ n: x.n, subject: String(x.s || ''), difficulty: String(x.d || ''), q: String(x.q || ''), code: String(x.c || ''), options: (x.o || []).map(String), answer: x.a, solution: String(x.sol || ''), takeaway: String(x.key || '') });
  });
  if (problems.length) throw L.err(400, 'Please fix these first:\n' + problems.slice(0, 15).join('\n') + (problems.length > 15 ? '\n…and ' + (problems.length - 15) + ' more' : ''));
  return rows;
}
// one row per student: profile + payment + every attempt
async function studentRows() {
  const [prof, paid, att] = await Promise.all([
    L.selectAll('profiles', 'order=created_at.desc'),
    L.selectAll('purchases', 'status=eq.paid&order=paid_at.desc'),
    L.selectAll('attempts', 'select=user_id,test_id,submitted_at,score,time_spent,started_at')
  ]);
  const pay = {}; paid.forEach(x => { if (!pay[x.user_id]) pay[x.user_id] = x; });
  const at = {}; att.forEach(a => (at[a.user_id] = at[a.user_id] || []).push(a));
  return prof.map(p => ({ id: p.id, name: p.name, email: p.email, mobile: p.mobile, joined: p.created_at, paid: !!pay[p.id], paid_at: pay[p.id] && pay[p.id].paid_at, amount: pay[p.id] ? pay[p.id].amount / 100 : 0,
    attempts: (at[p.id] || []).map(a => ({ test: a.test_id, status: a.submitted_at ? 'submitted' : 'in_progress', score: a.score, time: a.time_spent })) }));
}
module.exports = L.wrap(async (req, res) => {
  const user = await L.getUser(req);
  if (!L.isAdmin(user)) throw L.err(403, 'Admins only.');
  const p = L.q(req), action = p.get('action');

  if (action === 'overview') {
    const [tests, paid, prof, att, created] = await Promise.all([
      L.select('tests', 'order=sort.asc,created_at.asc'),
      L.selectAll('purchases', 'status=eq.paid&select=amount,user_id,paid_at'),
      L.selectAll('profiles', 'select=created_at'),
      L.selectAll('attempts', 'select=test_id,submitted_at,score'),
      L.count('purchases', 'status=eq.created')
    ]);
    const per = {};
    att.forEach(a => { const o = per[a.test_id] = per[a.test_id] || { started: 0, submitted: 0, sum: 0 }; o.started++; if (a.submitted_at) { o.submitted++; o.sum += a.score || 0; } });
    const days = lastDays(14), su = {}, rv = {};
    prof.forEach(x => { const d = day(x.created_at); su[d] = (su[d] || 0) + 1; });
    paid.forEach(x => { const d = day(x.paid_at); rv[d] = (rv[d] || 0) + x.amount / 100; });
    const buyers = new Set(paid.map(x => x.user_id)).size;
    return {
      users: prof.length, buyers, revenue: paid.reduce((s, x) => s + x.amount, 0) / 100, abandoned: created,
      inProgress: att.filter(a => !a.submitted_at).length, conversion: prof.length ? Math.min(100, Math.round(1000 * buyers / prof.length) / 10) : 0,
      series: days.map(d => ({ day: d, signups: su[d] || 0, revenue: rv[d] || 0 })),
      tests: tests.map(t => { const o = per[t.id] || { started: 0, submitted: 0, sum: 0 }; return Object.assign({}, L.publicTest(t), { published: t.published, sort: t.sort, started: o.started, submitted: o.submitted, avg: o.submitted ? Math.round(10 * o.sum / o.submitted) / 10 : null }); })
    };
  }
  if (action === 'students') return { students: await studentRows() };
  if (action === 'payments') {
    const rows = await L.selectAll('purchases', 'order=created_at.desc');
    const prof = await profilesFor(rows.map(x => x.user_id));
    const f = x => { const q = prof[x.user_id] || {}; return { name: q.name, email: q.email, mobile: q.mobile, amount: x.amount / 100, status: x.status, created_at: x.created_at, paid_at: x.paid_at, order: x.razorpay_order_id, payment: x.razorpay_payment_id }; };
    return { paid: rows.filter(x => x.status === 'paid').map(f), abandoned: rows.filter(x => x.status !== 'paid').map(f) };
  }
  if (action === 'test_detail') {
    const id = p.get('test') || '';
    const test = (await L.select('tests', 'id=eq.' + enc(id) + '&limit=1'))[0];
    if (!test) throw L.err(404, 'Test not found.');
    const [qs, att] = await Promise.all([L.select('questions', 'test_id=eq.' + enc(id) + '&order=n.asc&select=n,subject,answer,q'), L.selectAll('attempts', 'test_id=eq.' + enc(id) + '&submitted_at=not.is.null&order=score.desc,time_spent.asc')]);
    const key = {}, subj = {}, per = {}; qs.forEach(q => { key[q.n] = q; subj[q.subject] = subj[q.subject] || { subject: q.subject, correct: 0, wrong: 0, skip: 0 }; per[q.n] = { n: q.n, subject: q.subject, q: q.q.slice(0, 110), correct: 0, wrong: 0, skip: 0 }; });
    att.forEach(a => {
      const seen = {};
      ((a.state && a.state.q) || []).forEach((pr, i) => { const q = key[pr[0]], s = a.state.S[i]; if (!q || !s) return; seen[q.n] = 1; const orig = Number.isInteger(s.ans) ? pr[1][s.ans] : null; const k = orig == null ? 'skip' : orig === q.answer ? 'correct' : 'wrong'; per[q.n][k]++; subj[q.subject][k]++; });
      qs.forEach(q => { if (!seen[q.n]) { per[q.n].skip++; subj[q.subject].skip++; } });
    });
    const max = qs.length * test.positive, scores = att.map(a => a.score), bins = Array.from({ length: 10 }, (_, i) => ({ from: Math.round(max * i / 10), to: Math.round(max * (i + 1) / 10), count: 0 }));
    scores.forEach(s => { const i = Math.max(0, Math.min(9, Math.floor(10 * Math.max(0, s) / (max || 1)))); bins[i].count++; });
    const sorted = scores.slice().sort((a, b) => a - b), prof = await profilesFor(att.slice(0, 20).map(a => a.user_id));
    const attempted = x => x.correct + x.wrong;
    return {
      test: L.publicTest(test), submitted: att.length, started: await L.count('attempts', 'test_id=eq.' + enc(id)), max,
      avg: att.length ? Math.round(10 * scores.reduce((s, x) => s + x, 0) / att.length) / 10 : null, median: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null, best: sorted.length ? sorted[sorted.length - 1] : null, lowest: sorted[0] ?? null,
      avgTime: att.length ? Math.round(att.reduce((s, a) => s + a.time_spent, 0) / att.length) : null, late: att.filter(a => a.late).length,
      bins, subjects: Object.values(subj).map(x => Object.assign(x, { accuracy: attempted(x) ? Math.round(1000 * x.correct / attempted(x)) / 10 : null })),
      hardest: Object.values(per).filter(x => attempted(x) >= 1).map(x => Object.assign(x, { pct: Math.round(1000 * x.correct / attempted(x)) / 10 })).sort((a, b) => a.pct - b.pct).slice(0, 10),
      top: att.slice(0, 20).map((a, i) => { const q = prof[a.user_id] || {}; return { rank: i + 1, name: q.name, email: q.email, score: a.score, correct: a.correct, wrong: a.wrong, time: a.time_spent }; })
    };
  }
  if (action === 'import') {
    const b = L.body(req), t = b.test || {};
    if (!/^[a-z0-9-]{2,40}$/.test(t.id || '')) throw L.err(400, 'Test id must be lowercase letters, numbers and dashes, e.g. mock-2.');
    if (!t.title) throw L.err(400, 'Title is required.');
    const rows = validate(b.questions);
    const done = await L.count('attempts', 'test_id=eq.' + enc(t.id));
    if (done && !b.force) throw L.err(409, done + ' students have already started this test. Replacing its questions would break their results. Tick the "replace anyway" box only if you are sure.');
    const date = v => v ? new Date(v).toISOString() : null;
    const meta = { id: t.id, title: String(t.title).slice(0, 80), subtitle: String(t.subtitle || '').slice(0, 200), duration_min: Math.max(1, parseInt(t.duration_min) || 120), question_count: rows.length, opens_at: date(t.opens_at), closes_at: date(t.closes_at), sort: parseInt(t.sort) || 0 };
    // Keep the test hidden while its questions are being replaced, so students never see a half-saved test.
    await L.insert('tests', Object.assign({}, meta, { published: false }), { onConflict: 'id' });
    await L.remove('questions', 'test_id=eq.' + enc(t.id));
    for (const part of chunk(rows.map(r => Object.assign({ test_id: t.id }, r)), 100)) await L.insert('questions', part);
    if (t.published) await L.update('tests', 'id=eq.' + enc(t.id), { published: true });
    return { ok: true, questions: rows.length };
  }
  if (action === 'settings') {
    const b = L.body(req), patch = {}, a = b.patch || {};
    ['title', 'subtitle'].forEach(k => { if (k in a) patch[k] = String(a[k]).slice(0, 200); });
    if ('published' in a) patch.published = !!a.published;
    if ('is_free' in a) patch.is_free = !!a.is_free;
    if ('duration_min' in a) patch.duration_min = Math.max(1, parseInt(a.duration_min) || 120);
    if ('sort' in a) patch.sort = parseInt(a.sort) || 0;
    ['opens_at', 'closes_at'].forEach(k => { if (k in a) patch[k] = a[k] ? new Date(a[k]).toISOString() : null; });
    if (!Object.keys(patch).length) throw L.err(400, 'Nothing to change.');
    const out = await L.update('tests', 'id=eq.' + enc(b.id || ''), patch);
    if (!out.length) throw L.err(404, 'Test not found.');
    return { ok: true };
  }
  if (action === 'buyers' || action === 'leaderboard' || action === 'students_csv') {
    let head, rows;
    if (action === 'students_csv') {
      const st = await studentRows();
      head = ['Name', 'Email', 'Mobile', 'Joined', 'Paid', 'Paid at', 'Tests submitted', 'Scores'];
      rows = st.map(x => [x.name, x.email, x.mobile, x.joined, x.paid ? 'yes' : 'no', x.paid_at, x.attempts.filter(a => a.status === 'submitted').length, x.attempts.filter(a => a.status === 'submitted').map(a => a.test + ':' + a.score).join(' ')]);
    } else if (action === 'buyers') {
      const pur = await L.selectAll('purchases', 'status=eq.paid&order=paid_at.desc');
      const prof = await profilesFor(pur.map(x => x.user_id));
      head = ['Name', 'Email', 'Mobile', 'Amount (INR)', 'Paid at', 'Razorpay payment id'];
      rows = pur.map(x => { const q = prof[x.user_id] || {}; return [q.name, q.email, q.mobile, x.amount / 100, x.paid_at, x.razorpay_payment_id]; });
    } else {
      const att = await L.selectAll('attempts', 'test_id=eq.' + enc(p.get('test') || '') + '&submitted_at=not.is.null&order=score.desc,time_spent.asc&select=user_id,score,correct,wrong,unattempted,time_spent,late');
      const prof = await profilesFor(att.map(x => x.user_id));
      head = ['Rank', 'Name', 'Email', 'Mobile', 'Score', 'Correct', 'Wrong', 'Unattempted', 'Time (s)', 'Submitted late'];
      rows = att.map((x, i) => { const q = prof[x.user_id] || {}; return [i + 1, q.name, q.email, q.mobile, x.score, x.correct, x.wrong, x.unattempted, x.time_spent, x.late ? 'yes' : '']; });
    }
    res.statusCode = 200; res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.end(csv([head].concat(rows)));
    return;
  }
  throw L.err(400, 'Unknown action');
});