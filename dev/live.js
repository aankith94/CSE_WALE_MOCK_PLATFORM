// npm run live  -> the real site on http://localhost:3000 using the keys in .env.local
const used = require('./env')();
if (!used) { console.error('\nNo .env.local file found. Copy .env.example to .env.local and fill in your keys first.\n'); process.exit(1); }
process.env.CW_LIVE = '1';
console.log('Using keys from ' + used);
require('./server').start(+process.env.PORT || 3000).then(s => console.log('\nCSE WALE is running with your REAL Supabase and Razorpay keys.\n  Student site: ' + s.url + '\n  Admin page:   ' + s.url + '/admin.html\n  Stop: Ctrl+C\n'));
