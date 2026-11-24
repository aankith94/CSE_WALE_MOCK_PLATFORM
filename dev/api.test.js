// Backend tests against the mock database. Run: node dev/api.test.js
const assert = require('assert'), crypto = require('crypto'), fs = require('fs');
const { start } = require('./server');
const seed = JSON.parse(fs.readFileSync(__dirname + '/../seed/mock-test-1.json', 'utf8'));
let url, M, pass = 0;
const call = async (path, tok, body, method) => {
  const r = await fetch(url + '/api/' + path, { method: method || (body ? 'POST' : 'GET'), headers: Object.assign({ 'Content-Type': 'application/json' }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = t; } return { status: r.status, body: j };
};
const ok = (name, cond, extra) => { if (!cond) { console.log('FAIL', name, extra || ''); process.exitCode = 1; } else { pass++; console.log('ok  ', name); } };
const sign = (o, p) => crypto.createHmac('sha256', 'rzp_secret').update(o + '|' + p).digest('hex');
async function pay(tok) {
  const o = (await call('pay?action=order', tok, {})).body, pid = 'pay_' + Math.random().toString(36).slice(2);
  return call('pay?action=verify', tok, { razorpay_order_id: o.order_id, razorpay_payment_id: pid, razorpay_signature: sign(o.order_id, pid) });
}
// build a "state" like the browser does: shuffled order, answers by displayed index
function mkState(pickAns, shuffle) {
  const qs = seed.map(q => ({ n: q.n, ord: shuffle ? [1, 3, 0, 2] : [0, 1, 2, 3] }));
  return { v: 1, cur: 0, spent: 100, cfg: { order: 'mix', min: 120, name: 'x' }, q: qs.map(x => [x.n, x.ord]),
    S: qs.map(x => { const q = seed.find(s => s.n === x.n); const orig = pickAns(q); return { ans: orig == null ? null : x.ord.indexOf(orig), mark: false, bm: false, vis: true, t: 3, tag: '' }; }) };
}
(async () => {
  ({ url, mock: M } = await start());
  const owner = M.addUser('owner@example.com'), s1 = M.addUser('asha@gmail.com', { name: 'Asha Verma', mobile: '9876543210' }), s2 = M.addUser('bob@gmail.com', { full_name: 'Bob Kumar' }), s3 = M.addUser('c.d@gmail.com');

  ok('anonymous cannot start a test', (await call('test?action=start', null, { test_id: 'mock-1' })).status === 401);
  ok('student cannot use admin', (await call('admin?action=overview', s1)).status === 403);
  const bad = await call('admin?action=import', owner, { test: { id: 'mock-1', title: 'M' }, questions: [{ n: 1, s: 'x', q: 'q', o: ['a', 'b'], a: 9 }] });
  ok('import rejects bad questions with a clear message', bad.status === 400 && /exactly 4/.test(bad.body.error), JSON.stringify(bad.body));
  const imp = await call('admin?action=import', owner, { test: { id: 'mock-1', title: 'Mock Test 1', subtitle: 'CSE', duration_min: 120, published: true }, questions: seed });
  ok('admin imports 100 questions', imp.status === 200 && imp.body.questions === 100, JSON.stringify(imp.body));
  await call('admin?action=import', owner, { test: { id: 'mock-2', title: 'Mock Test 2', published: true, opens_at: new Date(Date.now() + 864e5).toISOString() }, questions: seed.slice(0, 5) });

  const pub = await call('me');
  ok('public test list works, no answers inside', pub.body.tests.length === 2 && !JSON.stringify(pub.body).includes('"sol"') && pub.body.tests[0].total_marks === 300, JSON.stringify(pub.body).slice(0, 200));
  const me1 = await call('me', s1);
  ok('profile created from sign-up name and mobile', me1.body.user.name === 'Asha Verma' && me1.body.user.mobile === '9876543210' && !me1.body.user.paid);
  ok('Google name is used', (await call('me', s2)).body.user.name === 'Bob Kumar');
  ok('name falls back to the email', (await call('me', s3)).body.user.name === 'C D');

  ok('unpaid student blocked (402)', (await call('test?action=start', s1, { test_id: 'mock-1' })).status === 402);
  const forged = await call('pay?action=verify', s1, { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: 'deadbeef' });
  ok('forged payment signature rejected', forged.status === 400);
  const o1 = (await call('pay?action=order', s1, {})).body;
  ok('order amount comes from the server (₹99)', o1.amount === 9900 && o1.key_id === 'rzp_test_key');
  const stolen = await call('pay?action=verify', s2, { razorpay_order_id: o1.order_id, razorpay_payment_id: 'pay_1', razorpay_signature: sign(o1.order_id, 'pay_1') });
  ok("cannot claim someone else's order", stolen.status === 404);
  ok('still unpaid after forged attempts', (await call('me', s1)).body.user.paid === false);
  ok('real payment unlocks', (await call('pay?action=verify', s1, { razorpay_order_id: o1.order_id, razorpay_payment_id: 'pay_1', razorpay_signature: sign(o1.order_id, 'pay_1') })).body.ok === true && (await call('me', s1)).body.user.paid === true);
  ok('already paid: no second charge', (await call('pay?action=order', s1, {})).body.paid === true);
  // webhook
  const o2 = (await call('pay?action=order', s2, {})).body;
  const wb = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_w', order_id: o2.order_id } } } });
  const post = (sig) => fetch(url + '/api/webhook', { method: 'POST', headers: { 'x-razorpay-signature': sig }, body: wb });
  ok('webhook with bad signature rejected', (await post('nope')).status === 400 && (await call('me', s2)).body.user.paid === false);
  ok('webhook with good signature unlocks', (await post(crypto.createHmac('sha256', 'whsec').update(wb).digest('hex'))).status === 200 && (await call('me', s2)).body.user.paid === true);

  const st = await call('test?action=start', s1, { test_id: 'mock-1' });
  ok('start returns 100 questions without answers or solutions', st.status === 200 && st.body.questions.length === 100 && !JSON.stringify(st.body).match(/"(a|sol|key|answer)"/) && st.body.remaining_sec > 7100, JSON.stringify(st.body).slice(0, 150));
  ok('upcoming test cannot be started', (await call('test?action=start', s1, { test_id: 'mock-2' })).status === 403);
  const again = await call('test?action=start', s1, { test_id: 'mock-1' });
  ok('starting again resumes (same clock)', again.status === 200 && again.body.remaining_sec <= st.body.remaining_sec);
  const sv = await call('test?action=save', s1, { test_id: 'mock-1', state: mkState(q => q.a, true) });
  ok('autosave works', sv.status === 200 && sv.body.remaining_sec > 7000);
  ok('resume returns saved state', (await call('test?action=start', s1, { test_id: 'mock-1' })).body.state.q.length === 100);
  ok('result hidden until submitted', (await call('test?action=result&test=mock-1', s1)).status === 404);

  // Asha: 60 right, 20 wrong, 20 skipped, options shuffled => 60*3-20=160
  let k = 0; const pick = q => { k++; return k <= 60 ? q.a : k <= 80 ? (q.a + 1) % 4 : null; };
  const sub = await call('test?action=submit', s1, { test_id: 'mock-1', state: mkState(pick, true) });
  ok('server scores correctly (+3/-1, shuffled options)', sub.body.score === 160 && sub.body.correct === 60 && sub.body.wrong === 20 && sub.body.unattempted === 20, JSON.stringify(sub.body).slice(0, 200));
  ok('rank 1 of 1, review with solutions only now', sub.body.rank === 1 && sub.body.total === 1 && sub.body.review['1'].sol.length > 5 && sub.body.review['1'].a === seed[0].a);
  const dbl = await call('test?action=submit', s1, { test_id: 'mock-1', state: mkState(q => q.a, false) });
  ok('cannot resubmit to improve score', dbl.body.score === 160);
  ok('cannot restart a submitted test', (await call('test?action=start', s1, { test_id: 'mock-1' })).status === 409);
  const res = await call('test?action=result&test=mock-1', s1);
  ok('result can be reopened later', res.body.score === 160 && res.body.questions.length === 100 && res.body.state.q.length === 100);

  // Bob scores higher -> rank 1; Asha rank 2
  await call('test?action=start', s2, { test_id: 'mock-1' });
  const sb = await call('test?action=submit', s2, { test_id: 'mock-1', state: mkState(q => q.a, false) });
  ok('perfect score = 300, rank 1 of 2', sb.body.score === 300 && sb.body.rank === 1 && sb.body.total === 2);
  ok('first student is now rank 2', (await call('test?action=result&test=mock-1', s1)).body.rank === 2);
  // bad state tampering
  await pay(s3); await call('test?action=start', s3, { test_id: 'mock-1' });
  ok('junk state rejected', (await call('test?action=save', s3, { test_id: 'mock-1', state: { q: [1], S: [] } })).status === 400);
  const evil = mkState(q => q.a, false); evil.S.forEach(s => { s.ans = 99; });
  ok('out-of-range answers ignored (score 0)', (await call('test?action=submit', s3, { test_id: 'mock-1', state: evil })).body.score === 0);

  // timer: expire an attempt on the server clock
  const s4 = M.addUser('late@gmail.com'); await pay(s4); await call('test?action=start', s4, { test_id: 'mock-1' });
  await call('test?action=save', s4, { test_id: 'mock-1', state: mkState(q => (q.n <= 10 ? q.a : null), false) });
  const att = M.DB.attempts.find(a => a.user_id === M.users[s4].id); att.started_at = new Date(Date.now() - 125 * 60 * 1000).toISOString();
  const late = await call('test?action=submit', s4, { test_id: 'mock-1', state: mkState(q => q.a, false) });
  ok('late submit: only last autosave counts (30 not 300)', late.body.score === 30 && late.body.late === true, JSON.stringify(late.body).slice(0, 120));
  // closed window
  const s5 = M.addUser('closed@gmail.com'); await pay(s5);
  await call('admin?action=settings', owner, { id: 'mock-1', patch: { closes_at: new Date(Date.now() - 1000).toISOString() } });
  ok('closed test cannot be started by new students', (await call('test?action=start', s5, { test_id: 'mock-1' })).status === 403);
  await call('admin?action=settings', owner, { id: 'mock-1', patch: { closes_at: null } });
  const ov = await call('admin?action=overview', owner);
  ok('admin overview: buyers, revenue, attempts', ov.body.buyers === 5 && ov.body.revenue === 495 && ov.body.tests[0].submitted === 4, JSON.stringify(ov.body).slice(0, 220));
  const csv = await fetch(url + '/api/admin?action=buyers', { headers: { Authorization: 'Bearer ' + owner } }).then(r => r.text());
  ok('buyers CSV has names, emails, mobiles', csv.includes('Asha Verma') && csv.includes('9876543210') && csv.split('\n').length === 6, csv.slice(0, 160));
  const lb = await fetch(url + '/api/admin?action=leaderboard&test=mock-1', { headers: { Authorization: 'Bearer ' + owner } }).then(r => r.text());
  ok('leaderboard CSV sorted', lb.split('\n')[1].startsWith('1,Bob Kumar'), lb.slice(0, 200));

  // load: 200 students at once
  const t0 = Date.now(), N = 200;
  const toks = Array.from({ length: N }, (_, i) => M.addUser('load' + i + '@x.com', { name: 'Load ' + i }));
  await Promise.all(toks.map(async (t, i) => {
    await pay(t); const r = await call('test?action=start', t, { test_id: 'mock-1' }); if (r.status !== 200) throw new Error('start ' + r.status);
    let kk = 0; await call('test?action=save', t, { test_id: 'mock-1', state: mkState(q => (++kk % 2 ? q.a : null), true) });
    const s = await call('test?action=submit', t, { test_id: 'mock-1', state: mkState(q => (kk++ % (i % 7 + 2) ? q.a : (q.a + 1) % 4), true) });
    if (s.status !== 200) throw new Error('submit ' + s.status);
  }));
  const ranks = M.DB.attempts.filter(a => a.submitted_at && a.user_id !== M.users[owner]).length;
  ok('200 simultaneous students all pay, start, autosave, submit (' + (Date.now() - t0) + ' ms)', ranks >= N);
  const top = (await call('test?action=result&test=mock-1', toks[0])).body;
  ok('ranks consistent after load', top.total === ranks && top.rank >= 1 && top.rank <= top.total, top.rank + '/' + top.total);

  // ---- admin data, profile update, paging beyond 1000 rows
  ok('profile: bad mobile rejected', (await call('me?action=profile', s2, { mobile: '12345' })).status === 400);
  ok('profile: mobile saved', (await call('me?action=profile', s2, { mobile: '9123456780' })).body.ok === true && (await call('me', s2)).body.user.mobile === '9123456780');
  const stu = (await call('admin?action=students', owner)).body.students;
  const asha = stu.find(x => x.email === 'asha@gmail.com');
  ok('students list has real rows with payment and scores', stu.length >= 200 && asha.paid === true && asha.mobile === '9876543210' && asha.attempts[0].score === 160, JSON.stringify(asha));
  const pays = (await call('admin?action=payments', owner)).body;
  ok('payments list: paid + abandoned checkouts', pays.paid.length >= 200 && pays.paid[0].email && Array.isArray(pays.abandoned));
  const td = (await call('admin?action=test_detail&test=mock-1', owner)).body;
  ok('test detail: counts, histogram, subjects, hardest, top', td.submitted >= 200 && td.bins.reduce((a, b) => a + b.count, 0) === td.submitted && td.subjects.length === 10 && td.hardest.length === 10 && td.top.length === 20 && td.top[0].rank === 1 && td.best === 300 && td.max === 300, JSON.stringify(td).slice(0, 200));
  const totalAns = td.subjects.reduce((a, x) => a + x.correct + x.wrong + x.skip, 0);
  ok('test detail: every student x question counted once', totalAns === td.submitted * 100, totalAns + ' vs ' + td.submitted * 100);
  const ov2 = (await call('admin?action=overview', owner)).body;
  ok('overview: 14-day series, conversion, in-progress', ov2.series.length === 14 && ov2.series[13].signups >= 200 && ov2.conversion > 0 && typeof ov2.inProgress === 'number' && ov2.tests[0].avg > 0, JSON.stringify(ov2).slice(0, 160));
  for (let i = 0; i < 1300; i++) M.DB.profiles.push({ id: 'bulk-' + i, name: 'Bulk ' + i, email: 'bulk' + i + '@x.com', mobile: '', created_at: new Date().toISOString() });
  const big = (await call('admin?action=students', owner)).body.students;
  ok('more than 1000 students: all are returned (paging works)', big.length >= 1500, big.length);
  const csvAll = await fetch(url + '/api/admin?action=students_csv', { headers: { Authorization: 'Bearer ' + owner } }).then(r => r.text());
  ok('students CSV downloads', csvAll.split('\n').length >= 1500 && csvAll.startsWith('Name,Email,Mobile'));
  const cfg = (await call('config')).body;
  ok('config reports no missing settings in the test setup', Array.isArray(cfg.missing) && cfg.missing.length === 0 && cfg.price === 99);
  console.log('\n' + pass + ' checks passed' + (process.exitCode ? ', SOME FAILED' : ''));
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
