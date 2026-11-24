// Local dev server: serves /public and runs the /api functions against the mock.
const http = require('http'), fs = require('fs'), path = require('path');
const LIVE = process.env.CW_LIVE === '1';   // live = real Supabase + Razorpay from .env.local, no fakes
if (!LIVE) Object.assign(process.env, { SUPABASE_URL: 'http://mock-supabase', SUPABASE_SERVICE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon', RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'rzp_secret', RAZORPAY_WEBHOOK_SECRET: 'whsec', ADMIN_EMAILS: 'owner@example.com', PRICE_PAISE: '9900' });
const mock = LIVE ? null : require('./mock');
const root = path.join(__dirname, '..');
// Local preview only: fake login + fake Razorpay window, so the whole site runs with no accounts.
const STUBS = `(function(){const reg=(e,m)=>fetch('/dev/register?email='+encodeURIComponent(e)+'&meta='+encodeURIComponent(JSON.stringify(m||{})));
window.supabase={createClient(){const L=[];const get=()=>{try{return JSON.parse(localStorage.getItem('dev-session'))}catch(e){return null}};
const set=e=>{const s=e?{access_token:'tok-'+e,user:{email:e}}:null;localStorage.setItem('dev-session',JSON.stringify(s));L.forEach(f=>f(e?'SIGNED_IN':'SIGNED_OUT',s));return s};
return{auth:{getSession:async()=>({data:{session:get()}}),onAuthStateChange:f=>{L.push(f);return{data:{subscription:{}}}},
signInWithPassword:async({email})=>{await reg(email);set(email);return{data:{},error:null}},
signUp:async({email,options})=>{await reg(email,options.data);set(email);return{data:{session:get(),user:{identities:[1]}},error:null}},
signInWithOAuth:async()=>{await reg('google.student@gmail.com',{full_name:'Google Student'});set('google.student@gmail.com');return{error:null}},
signOut:async()=>{set(null)},resetPasswordForEmail:async()=>({error:null}),updateUser:async()=>({})}}}};
document.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.textContent='PREVIEW MODE: fake login, fake payment, fake data. Run "npm run live" for the real site.';b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99;background:#d9534f;color:#fff;text-align:center;font:600 13px system-ui;padding:4px';document.body.appendChild(b);document.body.style.paddingTop='26px'});
window.Razorpay=function(o){this.o=o};window.Razorpay.prototype.on=function(){};
window.Razorpay.prototype.open=async function(){if(!confirm('LOCAL PREVIEW: pretend the payment of Rs '+(this.o.amount/100)+' succeeded?'))return this.o.modal.ondismiss();const pid='pay_local';const sig=await (await fetch('/dev/sign?o='+this.o.order_id+'&p='+pid)).text();this.o.handler({razorpay_order_id:this.o.order_id,razorpay_payment_id:pid,razorpay_signature:sig})};})();`;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
function start(port = 0) {
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      const name = u.pathname.slice(5);
      let fn; try { fn = require(path.join(root, 'api', name + '.js')); } catch (e) { res.statusCode = 404; return res.end('{}'); }
      const chunks = []; for await (const c of req) chunks.push(c);
      const text = Buffer.concat(chunks).toString();
      if (fn.config && fn.config.api && fn.config.api.bodyParser === false) { req.rawBody = text; }
      else { try { req.body = text ? JSON.parse(text) : {}; } catch (e) { req.body = {}; } }
      return fn(req, res);
    }
    if (mock && u.pathname === '/dev/stubs.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(STUBS); }
    if (mock && u.pathname === '/dev/register') { const e = u.searchParams.get('email'); if (!Object.values(mock.users).some(x => x.email === e)) mock.addUser(e, JSON.parse(u.searchParams.get('meta') || '{}')); return res.end('{}'); }
    if (mock && u.pathname === '/dev/sign') return res.end(require('crypto').createHmac('sha256', 'rzp_secret').update(u.searchParams.get('o') + '|' + u.searchParams.get('p')).digest('hex'));
    let f = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname);
    if (!f.startsWith(path.join(root, 'public')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
    if (!LIVE && !process.env.CW_NOSTUB && path.extname(f) === '.html') return res.end(fs.readFileSync(f, 'utf8').replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*supabase[^"]*"><\/script>/, '<script src="/dev/stubs.js"></script>'));
    res.end(fs.readFileSync(f));
  });
  return new Promise(ok => srv.listen(port, () => ok({ srv, url: 'http://localhost:' + srv.address().port, mock })));
}
module.exports = { start };
if (require.main === module && LIVE) start(+process.env.PORT || 3000).then(s => console.log('\nCSE WALE is running with your REAL Supabase and Razorpay keys.\n  Student site: ' + s.url + '\n  Admin page:   ' + s.url + '/admin.html\n  Stop: Ctrl+C\n'));
else if (require.main === module) start(3000).then(async s => {
  const tok = s.mock.addUser('owner@example.com'), seed = JSON.parse(fs.readFileSync(path.join(root, 'seed', 'mock-test-1.json'), 'utf8'));
  await fetch(s.url + '/api/admin?action=import', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ test: { id: 'mock-1', title: 'Mock Test 1', subtitle: 'SSC JE · IMD Scientific Assistant · Computer Science & Engineering', duration_min: 120, published: true, closes_at: new Date(Date.now() + 864e5).toISOString() }, questions: seed }) });
  console.log('\nCSE WALE local preview is running (fake database, fake login, fake payment).\n  Student site: ' + s.url + '\n  Admin page:   ' + s.url + '/admin.html   (log in with owner@example.com, any password)\n  Stop: press Ctrl+C. Data resets every time you restart.\n');
});
