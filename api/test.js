// Exam engine API. The browser never gets correct answers or solutions until the test is submitted.
const L = require('./_lib');
const GRACE = 90; // seconds of network grace after the timer ends
const enc = encodeURIComponent;
const remaining = a => Math.floor((Date.parse(a.started_at) + a.duration_sec * 1000 - Date.now()) / 1000);

// Keep only the fields we use, so a student can't stuff junk into the database.
function clean(state) {
  if (!state || !Array.isArray(state.q) || !Array.isArray(state.S) || state.q.length !== state.S.length || state.q.length > 300) throw L.err(400, 'Invalid test data.');
  const out = {
    v: 1, cur: Math.max(0, parseInt(state.cur) || 0), spent: Math.max(0, Math.round(+state.spent || 0)),
    cfg: { order: state.cfg && state.cfg.order === 'sec' ? 'sec' : 'mix', shq: !!(state.cfg && state.cfg.shq), sho: !!(state.cfg && state.cfg.sho), showtm: !(state.cfg && state.cfg.showtm === false), min: Math.max(1, Math.min(600, parseInt(state.cfg && state.cfg.min) || 120)), name: String((state.cfg && state.cfg.name) || '').slice(0, 80), label: '' },
    q: state.q.map(p => [parseInt(p[0]), Array.isArray(p[1]) ? p[1].slice(0, 4).map(x => parseInt(x)) : [0, 1, 2, 3]]),
    S: state.S.map(s => ({ ans: Number.isInteger(s.ans) && s.ans >= 0 && s.ans < 4 ? s.ans : null, mark: !!s.mark, bm: !!s.bm, vis: !!s.vis, t: Math.max(0, Math.min(36000, Math.round((+s.t || 0) * 10) / 10)), tag: ['C', 'T', 'S', 'G'].includes(s.tag) ? s.tag : '' }))
  };
  if (JSON.stringify(out).length > 250000) throw L.err(413, 'Too much data.');
  return out;
}
function derive(state, answers) {
  const out = {};
  if (!state || !Array.isArray(state.q) || !Array.isArray(state.S)) return out;
  state.q.forEach((p, i) => {
    const n = p[0], ord = p[1], s = state.S[i];
    if (!(n in answers) || !s || !Array.isArray(ord)) return;
    const a = s.ans;
    if (Number.isInteger(a) && a >= 0 && a < 4 && Number.isInteger(ord[a]) && ord[a] >= 0 && ord[a] < 4) out[n] = ord[a];
  });
  return out;
}
async function getTest(id) {
  const t = (await L.select('tests', 'id=eq.' + enc(id || '') + '&published=eq.true&limit=1'))[0];
  if (!t) throw L.err(404, 'Test not found.');
  return t;
}
const getAttempt = async (uid, tid) => (await L.select('attempts', 'user_id=eq.' + uid + '&test_id=eq.' + enc(tid) + '&limit=1'))[0];
const clientQ = r => ({ n: r.n, s: r.subject, d: r.difficulty, q: r.q, c: r.code || '', o: r.options });

async function rankOf(test, att) {
  const base = 'test_id=eq.' + enc(test.id) + '&submitted_at=not.is.null';
  const [total, better, tie] = await Promise.all([
    L.count('attempts', base),
    L.count('attempts', base + '&score=gt.' + att.score),
    L.count('attempts', base + '&score=eq.' + att.score + '&time_spent=lt.' + att.time_spent)
  ]);
  return { rank: better + tie + 1, total };
}
async function buildResult(att, test) {
  const rows = await L.select('questions', 'test_id=eq.' + enc(test.id) + '&order=n.asc');
  const review = {};
  rows.forEach(r => { review[r.n] = { a: r.answer, sol: r.solution, key: r.takeaway }; });
  const { rank, total } = await rankOf(test, att);
  return { test: L.publicTest(test), questions: rows.map(clientQ), review, state: att.state, score: att.score, correct: att.correct, wrong: att.wrong, unattempted: att.unattempted, max: rows.length * test.positive, time_spent: att.time_spent, rank, total, late: att.late };
}
async function doSubmit(att, test, state, late) {
  const rows = await L.select('questions', 'test_id=eq.' + enc(test.id) + '&select=n,answer');
  const key = {}; rows.forEach(r => { key[r.n] = r.answer; });
  const ans = derive(state, key);
  let c = 0, w = 0;
  Object.keys(ans).forEach(n => { ans[n] === key[n] ? c++ : w++; });
  const upd = await L.update('attempts', 'id=eq.' + att.id + '&submitted_at=is.null', {
    submitted_at: new Date().toISOString(), state, correct: c, wrong: w, unattempted: rows.length - c - w,
    score: c * test.positive - w * test.negative,
    time_spent: Math.max(1, Math.min(att.duration_sec, Math.round((Date.now() - Date.parse(att.started_at)) / 1000))), late: !!late
  });
  const done = upd[0] || await getAttempt(att.user_id, test.id);   // second click / retry: return the stored result
  return buildResult(done, test);
}

// Progress across mocks and weak-question practice: both use only tests this student has already SUBMITTED, so no answers leak early.
async function progress(user, action) {
  const atts = await L.select('attempts', 'user_id=eq.' + user.id + '&submitted_at=not.is.null&select=test_id,score,time_spent,state');
  if (!atts.length) return action === 'weak' ? { questions: [] } : { tests: [] };
  const ids = [...new Set(atts.map(a => a.test_id))].map(enc).join(',');
  const [tests, qs] = await Promise.all([
    L.select('tests', 'id=in.(' + ids + ')&published=eq.true&order=sort.asc,created_at.asc&select=id,title,sort,positive,negative'),
    L.selectAll('questions', 'test_id=in.(' + ids + ')&order=n.asc')
  ]);
  const by = {}; qs.forEach(r => { (by[r.test_id] = by[r.test_id] || []).push(r); });
  const out = [], weak = [];
  tests.forEach(t => {
    const a = atts.find(x => x.test_id === t.id), rows = by[t.id] || [];
    if (!a || !rows.length) return;
    const key = {}; rows.forEach(r => { key[r.n] = r.answer; });
    const ans = derive(a.state, key), sub = {};
    let c = 0, w = 0;
    rows.forEach(r => {
      const o = sub[r.subject] = sub[r.subject] || { n: 0, c: 0, w: 0 };
      o.n++;
      if (!(r.n in ans)) { weak.push({ st: 'skip', r, t }); return; }
      if (ans[r.n] === r.answer) { o.c++; c++; } else { o.w++; w++; weak.push({ st: 'bad', r, t }); }
    });
    Object.values(sub).forEach(o => { o.score = o.c * t.positive - o.w * t.negative; o.max = o.n * t.positive; });
    out.push({ id: t.id, title: t.title, score: a.score, max: rows.length * t.positive, correct: c, wrong: w, unattempted: rows.length - c - w, time_spent: a.time_spent, subjects: sub });
  });
  if (action === 'history') return { tests: out };
  weak.sort((x, y) => (x.st === y.st ? 0 : x.st === 'bad' ? -1 : 1));
  return { questions: weak.slice(0, 400).map(({ st, r, t }) => ({ st, src_t: t.id, src_title: t.title, src_n: r.n, s: r.subject, d: r.difficulty, q: r.q, c: r.code || '', o: r.options, a: r.answer, sol: r.solution, key: r.takeaway })) };
}

module.exports = L.wrap(async req => {
  const user = await L.getUser(req);
  const p = L.q(req), action = p.get('action');
  if (action === 'result') {
    const test = await getTest(p.get('test'));
    const att = await getAttempt(user.id, test.id);
    if (!att || !att.submitted_at) throw L.err(404, 'No submitted attempt for this test.');
    return buildResult(att, test);
  }
  if (action === 'history' || action === 'weak') return progress(user, action);
  if (req.method !== 'POST') throw L.err(405, 'POST only');
  const b = L.body(req);
  const test = await getTest(b.test_id);
  if (!test.is_free && !(await L.isPaid(user.id))) throw L.err(402, 'Buy the test series to start.');
  let att = await getAttempt(user.id, test.id);

  if (action === 'start') {
    await L.ensureProfile(user);
    if (att && att.submitted_at) throw L.err(409, 'You have already submitted this test.');
    if (att && remaining(att) < -GRACE) { await doSubmit(att, test, att.state, true); throw L.err(409, 'The time for this test is over. Your saved answers were submitted.'); }
    if (!att) {
      const st = L.status(test);
      if (st === 'upcoming') throw L.err(403, 'This test has not opened yet.');
      if (st === 'closed') throw L.err(403, 'This test is closed.');
      att = (await L.insert('attempts', { user_id: user.id, test_id: test.id, duration_sec: test.duration_min * 60 }, { onConflict: 'user_id,test_id', ignore: true }))[0] || await getAttempt(user.id, test.id);
    }
    const rows = await L.select('questions', 'test_id=eq.' + enc(test.id) + '&order=n.asc&select=n,subject,difficulty,q,code,options');
    return { test: L.publicTest(test), remaining_sec: Math.max(0, remaining(att)), state: att.state || null, questions: rows.map(clientQ) };
  }
  if (!att) throw L.err(404, 'Start the test first.');
  if (att.submitted_at) { if (action === 'submit') return doSubmit(att, test, att.state, att.late); throw L.err(409, 'Already submitted.'); }
  const rem = remaining(att);

  if (action === 'save') {
    if (rem < -GRACE) { await doSubmit(att, test, att.state, true); return { submitted: true }; }
    if (rem > 0) await L.update('attempts', 'id=eq.' + att.id + '&submitted_at=is.null', { state: clean(b.state) });
    return { remaining_sec: Math.max(0, rem) };
  }
  if (action === 'submit') {
    // On time (or inside the grace window): use what the student sends. Later than that: only the last autosave counts.
    if (rem >= -GRACE) return doSubmit(att, test, clean(b.state), false);
    return doSubmit(att, test, att.state, true);
  }
  throw L.err(400, 'Unknown action');
});