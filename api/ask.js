// AI tutor: explains a question (or any CSE exam topic) to a student who has PAID and has SUBMITTED the test.
// The OpenAI key lives only in the server environment (OPENAI_API_KEY). It is never sent to the browser.
const L = require('./_lib');
const enc = encodeURIComponent;
const LIMIT = () => parseInt(L.env('AI_DAILY_LIMIT') || '100', 10);   // messages per student per day (safety cap)
const MODEL = () => L.env('OPENAI_MODEL') || 'gpt-4o-mini';

const SYSTEM = `You are the CSE WALE AI tutor. You help a student who is preparing for the SSC JE 2026 Scientific Assistant (IMD) exam, Part-D Computer Science & IT. The student has just finished a mock test and does not understand a solution.

How to answer:
- Default: explain THIS question properly but efficiently. Take the short official solution and expand it into clear numbered steps, with small calculations shown. Do NOT teach the whole chapter from scratch unless the student asks ("from scratch", "I don't know X", "teach me X").
- End with a short "Remember" line: the one idea or formula that unlocks this type of question.
- If the question rests on an important theory topic, add one short line such as "Likely important topic: ...". Never promise it will come in the exam. Part-D is a new pattern with no past papers, so say "likely" or "often tested", never "will come".
- If the student says they still do not understand, explain again in a different, simpler way, with a small example. Do not repeat the same words.
- If the student asks a general CSE doubt (theory, a concept, a similar question, a shortcut), answer it fully. It does not have to be about the 100 questions. If they ask to teach from scratch, do it properly.
- Trust the official correct option and solution you are given. If you honestly think they conflict with the question, say so briefly and suggest the student checks, but do not confuse them.
- Refer to options by their text, not by letter, because the student's options may be shuffled.
- Stay on Computer Science, engineering mathematics and exam preparation. Politely refuse unrelated requests (one sentence).
- Write in the language the student uses (English or Hinglish). Use plain text, short paragraphs, "1." "2." steps, and simple symbols. No LaTeX. Use \`backticks\` for code. Keep most answers under about 300 words unless the student asks for more.`;

async function usage(userId) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const row = (await L.select('ai_usage', 'user_id=eq.' + userId + '&day=eq.' + day + '&limit=1'))[0];
    return { day, count: row ? row.count : 0, ok: true };
  } catch (e) { return { day, count: 0, ok: false }; }   // table not created yet: do not block students
}

function fakeReply(msg, ctx) {
  return '(Preview mode: sample reply, no real AI is called.)\n\n1. Read what the question asks.\n2. Use the official solution step by step.\n3. Check each option.\n\nRemember: this is a placeholder. You asked: "' + String(msg).slice(0, 80) + '"' + (ctx ? '\nQuestion topic: ' + ctx.subject : '');
}

module.exports = L.wrap(async req => {
  if (req.method !== 'POST') throw L.err(405, 'POST only');
  const user = await L.getUser(req);
  const b = L.body(req);
  const key = L.env('OPENAI_API_KEY');
  if (!key && !process.env.CW_FAKE_AI) throw L.err(503, 'The AI tutor is not switched on yet.');
  if (!L.isAdmin(user) && !(await L.isPaid(user.id))) throw L.err(402, 'The AI tutor is available with the full test series.');

  // Never help during a running test: block while any of the student's attempts is still in progress.
  const open = await L.select('attempts', 'user_id=eq.' + user.id + '&submitted_at=is.null&select=started_at,duration_sec');
  if (open.some(a => Date.parse(a.started_at) + a.duration_sec * 1000 + 90000 > Date.now())) throw L.err(403, 'Finish your running test first. The AI tutor opens after you submit.');

  let ctx = null;
  if (b.test_id && b.n) {
    const att = (await L.select('attempts', 'user_id=eq.' + user.id + '&test_id=eq.' + enc(b.test_id) + '&limit=1'))[0];
    if (!att || !att.submitted_at) throw L.err(403, 'Submit this test first to ask about its questions.');
    ctx = (await L.select('questions', 'test_id=eq.' + enc(b.test_id) + '&n=eq.' + (parseInt(b.n) || 0) + '&limit=1'))[0] || null;
  }
  const message = String(b.message || '').trim().slice(0, 1200);
  if (!message) throw L.err(400, 'Type your doubt first.');

  const u = await usage(user.id);
  if (u.count >= LIMIT()) throw L.err(429, 'You have reached today\'s AI tutor limit. It resets tomorrow.');

  let reply;
  if (!key) reply = fakeReply(message, ctx);
  else {
    const msgs = [{ role: 'system', content: SYSTEM }];
    if (ctx) {
      const opts = ctx.options.map((o, i) => '- ' + o + (i === ctx.answer ? '   <-- CORRECT' : '')).join('\n');
      msgs.push({ role: 'system', content: 'The question the student is asking about:\nSubject: ' + ctx.subject + (ctx.difficulty ? ' (' + ctx.difficulty + ')' : '') + '\nQuestion: ' + ctx.q + (ctx.code ? '\nCode:\n' + ctx.code : '') + '\nOptions:\n' + opts + '\nOfficial solution: ' + (ctx.solution || '(none)') + '\nKey takeaway: ' + (ctx.takeaway || '(none)') + (b.chosen ? '\nThe student chose: ' + String(b.chosen).slice(0, 300) : '\nThe student did not attempt this question.') });
    }
    (Array.isArray(b.history) ? b.history.slice(-8) : []).forEach(h => { if (h && (h.role === 'user' || h.role === 'assistant') && h.content) msgs.push({ role: h.role, content: String(h.content).slice(0, 2000) }); });
    msgs.push({ role: 'user', content: message });
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 26000);
    let r, j;
    try {
      r = await L.sfetch((L.env('OPENAI_BASE_URL') || 'https://api.openai.com/v1') + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ model: MODEL(), messages: msgs, temperature: 0.3, max_tokens: 1100 }) }, 1);
      j = await r.json().catch(() => ({}));
    } catch (e) { throw L.err(504, 'The AI tutor took too long. Please try again.'); } finally { clearTimeout(timer); }
    if (!r.ok) {
      console.error('OpenAI error', r.status, j && j.error && j.error.message);
      if (r.status === 429 || r.status === 402 || (j.error && /quota|billing/i.test(j.error.message || ''))) throw L.err(503, 'The AI tutor is resting right now. Please try again later.');
      throw L.err(502, 'The AI tutor could not answer. Please try again.');
    }
    reply = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
    if (!reply) throw L.err(502, 'The AI tutor gave an empty answer. Please try again.');
  }
  if (u.ok) { try { await L.insert('ai_usage', { user_id: user.id, day: u.day, count: u.count + 1 }, { onConflict: 'user_id,day' }); } catch (e) {} }
  return { reply, left: u.ok ? Math.max(0, LIMIT() - u.count - 1) : null };
});