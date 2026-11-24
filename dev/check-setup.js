// npm run check  -> tests your keys and settings, and tells you exactly what to fix.
const used = require('./env')();
const E = n => process.env[n] || '';
let bad = 0, warn = 0;
const ok = m => console.log('  ✔ ' + m), no = m => { bad++; console.log('  ✖ ' + m); }, wa = m => { warn++; console.log('  ⚠ ' + m); };
const why = e => { const c = (e && e.cause && (e.cause.code || e.cause.message)) || e.message; const hint = { ENOTFOUND: 'That web address does not exist from your computer. Either SUPABASE_URL has a typo, or your internet provider/DNS is blocking supabase.co.', ETIMEDOUT: 'The connection timed out. Your network may be blocking supabase.co. Try mobile data or a VPN.', ECONNRESET: 'The connection was cut. Your network may be blocking supabase.co. Try mobile data or a VPN.', ECONNREFUSED: 'The connection was refused. Check SUPABASE_URL.', ERR_INVALID_URL: 'SUPABASE_URL is not a valid web address. It must look like https://abcdxyz.supabase.co', CERT_HAS_EXPIRED: 'Your computer clock or antivirus is interfering with secure connections.', UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'An antivirus or office/school network is interfering with secure connections.' }[c] || ''; return c + (hint ? '\n      -> ' + hint : ''); };
const role = k => { if (k.startsWith('sb_publishable_')) return 'anon'; if (k.startsWith('sb_secret_')) return 'service_role'; try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role; } catch (e) { return null; } };
(async () => {
  console.log('\nCSE WALE setup check' + (used ? ' (reading ' + used + ')' : '') + '\n');
  if (!used) no('No .env.local file. Copy .env.example to .env.local and fill it in.');
  console.log('Settings');
  ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET', 'ADMIN_EMAILS'].forEach(k => E(k) ? ok(k + ' is set') : no(k + ' is missing'));
  if (E('SUPABASE_URL') && !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(E('SUPABASE_URL'))) wa('SUPABASE_URL should look like https://abcdxyz.supabase.co');
  if (E('SUPABASE_ANON_KEY') && role(E('SUPABASE_ANON_KEY')) !== 'anon') no('SUPABASE_ANON_KEY is not the public key (the "anon" / "publishable" one). Do not paste the secret key here');
  if (E('SUPABASE_SERVICE_KEY') && role(E('SUPABASE_SERVICE_KEY')) !== 'service_role') no('SUPABASE_SERVICE_KEY is not the secret key ("service_role" / "secret"). You may have pasted the public key');
  if (E('ADMIN_EMAILS') && !/@/.test(E('ADMIN_EMAILS'))) no('ADMIN_EMAILS must contain your email address');
  const sh = () => Object.assign({ apikey: E('SUPABASE_SERVICE_KEY') }, E('SUPABASE_SERVICE_KEY').startsWith('eyJ') ? { Authorization: 'Bearer ' + E('SUPABASE_SERVICE_KEY') } : {});
  const base = E('SUPABASE_URL').replace(/\/$/, '');
  if (base && E('SUPABASE_SERVICE_KEY')) {
    console.log('\nSupabase');
    try {
      for (const t of ['profiles', 'tests', 'questions', 'purchases', 'attempts']) {
        const r = await fetch(base + '/rest/v1/' + t + '?select=*&limit=1', { headers: sh() });
        r.ok ? ok('table "' + t + '" exists') : no('table "' + t + '" not found (HTTP ' + r.status + '). Run supabase/schema.sql in the Supabase SQL Editor.');
      }
      const r = await fetch(base + '/rest/v1/tests?select=id&published=eq.true', { headers: sh() });
      if (r.ok) { const n = (await r.json()).length; n ? ok(n + ' published test(s)') : wa('No published test yet. Import one in /admin.html > Add tests.'); }
      const a = await fetch(base + '/auth/v1/settings', { headers: { apikey: E('SUPABASE_ANON_KEY') } });
      if (a.ok) {
        const s = await a.json(), ex = s.external || {};
        ex.email ? ok('email login is ON') : no('email login is OFF (Authentication > Providers > Email)');
        ex.google ? ok('Google login is ON') : no('Google login is OFF (Authentication > Providers > Google)');
        s.mailer_autoconfirm ? ok('"Confirm email" is OFF (good for many sign-ups)') : wa('"Confirm email" is ON. Supabase free email allows only a few mails per hour, so many students will get stuck. Turn it OFF in Authentication > Providers > Email.');
        s.disable_signup ? no('New sign-ups are disabled in Supabase') : ok('sign-ups are allowed');
      } else no('Could not read login settings (check SUPABASE_ANON_KEY)');
    } catch (e) { no('Could not reach Supabase (' + base.replace(/^https?:\/\//, '') + '): ' + why(e)); }
  }
  if (E('RAZORPAY_KEY_ID') && E('RAZORPAY_KEY_SECRET')) {
    console.log('\nRazorpay');
    const id = E('RAZORPAY_KEY_ID');
    id.startsWith('rzp_live_') ? ok('LIVE keys (real money)') : id.startsWith('rzp_test_') ? wa('TEST keys: payments are fake. Switch to rzp_live_ keys when you go live.') : no('Key id should start with rzp_test_ or rzp_live_');
    try {
      const r = await fetch('https://api.razorpay.com/v1/orders?count=1', { headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + E('RAZORPAY_KEY_SECRET')).toString('base64') } });
      r.ok ? ok('Razorpay accepted your key id and secret') : no('Razorpay rejected the keys (HTTP ' + r.status + '). Key id and secret must be from the same mode.');
    } catch (e) { no('Could not reach Razorpay: ' + why(e)); }
  }
  console.log('\n' + (bad ? bad + ' problem(s) to fix' : 'No problems found') + (warn ? ', ' + warn + ' warning(s).' : '.') + '\n');
  process.exit(bad ? 1 : 0);
})();
