// Reads .env.local (or .env) into process.env. Handles comments, quotes and "VALUE   # note" lines.
const fs = require('fs'), path = require('path');
module.exports = function loadEnv() {
  const root = path.join(__dirname, '..'); let used = null;
  for (const f of ['.env.local', '.env']) {
    const p = path.join(root, f); if (!fs.existsSync(p)) continue; used = f;
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(line => {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line); if (!m || line.trim().startsWith('#')) return;
      let v = m[2].trim();
      if (/^["']/.test(v)) { const q = v[0], e = v.indexOf(q, 1); v = e > 0 ? v.slice(1, e) : v.slice(1); } else v = v.replace(/\s+#.*$/, '').trim();
      if (!(m[1] in process.env) || !process.env[m[1]]) process.env[m[1]] = v;
    });
    break;
  }
  return used;
};
