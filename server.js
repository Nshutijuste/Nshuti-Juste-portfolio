'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

/* ---------- config ---------- */
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (_) { /* no .env file, that is fine */ }

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const DEFAULT_CONTENT = path.join(__dirname, 'defaults', 'content.json');
const DEFAULT_PASSWORD = 'ChangeMe123!';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- small file helpers ---------- */
const readJSON = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
};
const writeJSON = (file, data) => {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
};

if (!fs.existsSync(CONTENT_FILE)) fs.copyFileSync(DEFAULT_CONTENT, CONTENT_FILE);
if (!fs.existsSync(MESSAGES_FILE)) writeJSON(MESSAGES_FILE, []);

/* ---------- password handling ---------- */
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({
  salt,
  hash: crypto.scryptSync(password, salt, 64).toString('hex'),
});
const checkPassword = (password, record) => {
  const test = crypto.scryptSync(password, record.salt, 64);
  const real = Buffer.from(record.hash, 'hex');
  return test.length === real.length && crypto.timingSafeEqual(test, real);
};
if (!fs.existsSync(AUTH_FILE)) {
  const initial = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
  writeJSON(AUTH_FILE, { ...hashPassword(initial), isDefault: initial === DEFAULT_PASSWORD });
  if (initial === DEFAULT_PASSWORD) {
    console.warn('\n  Admin password is the default one. Log in and change it in Admin > Security.\n');
  }
}

/* ---------- sessions and rate limits ---------- */
const sessions = new Map(); // token -> expiry
const SESSION_MS = 1000 * 60 * 60 * 8;
const attempts = new Map(); // key -> { count, until }

const parseCookies = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));

const isAuthed = (req) => {
  const token = parseCookies(req).sid;
  const exp = token && sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
};
const requireAdmin = (req, res, next) => (isAuthed(req) ? next() : res.status(401).json({ error: 'Please log in.' }));

const limited = (key, max, windowMs) => {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.until < now) { attempts.set(key, { count: 1, until: now + windowMs }); return false; }
  rec.count += 1;
  return rec.count > max;
};
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  for (const [k, v] of sessions) if (v < now) sessions.delete(k);
}, 60 * 1000).unref();

/* ---------- content cleaning ---------- */
const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const link = (v) => { const s = str(v, 600); return /^(https?:\/\/|mailto:|\/uploads\/)/i.test(s) ? s : ''; };
const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
const strList = (v, n, max) => list(v, n).map((x) => str(x, max)).filter(Boolean);
const color = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#0b6e6e');

function cleanContent(c = {}) {
  const site = c.site || {};
  const about = c.about || {};
  return {
    site: {
      name: str(site.name, 80) || 'Your Name',
      role: str(site.role, 120),
      tagline: str(site.tagline, 400),
      location: str(site.location, 120),
      email: str(site.email, 200),
      availability: str(site.availability, 160),
      accent: color(site.accent),
      profileImage: link(site.profileImage),
      resumeUrl: link(site.resumeUrl),
      metaDescription: str(site.metaDescription, 300),
      footerText: str(site.footerText, 200),
    },
    about: {
      heading: str(about.heading, 80) || 'About me',
      paragraphs: strList(about.paragraphs, 8, 2000),
      highlights: list(about.highlights, 6).map((h) => ({ label: str(h && h.label, 80), value: str(h && h.value, 40) })).filter((h) => h.label || h.value),
    },
    socials: list(c.socials, 10).map((s) => ({ label: str(s && s.label, 40), url: link(s && s.url) })).filter((s) => s.label),
    skills: list(c.skills, 12).map((g) => ({ group: str(g && g.group, 60), items: strList(g && g.items, 30, 60) })).filter((g) => g.group),
    projects: list(c.projects, 40).map((p) => {
      p = p || {};
      return {
        id: str(p.id, 60).replace(/[^a-z0-9-]/gi, '') || crypto.randomBytes(4).toString('hex'),
        title: str(p.title, 120) || 'Untitled project',
        category: str(p.category, 60),
        summary: str(p.summary, 400),
        description: str(p.description, 6000),
        role: str(p.role, 200),
        tags: strList(p.tags, 15, 40),
        image: link(p.image),
        link: link(p.link),
        linkLabel: str(p.linkLabel, 40) || 'View project',
        featured: !!p.featured,
      };
    }),
    journey: list(c.journey, 20).map((j) => ({
      period: str(j && j.period, 40), title: str(j && j.title, 120), place: str(j && j.place, 160), description: str(j && j.description, 600),
    })).filter((j) => j.title),
  };
}

/* ---------- uploads ---------- */
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const looksLikeImage = (buf, mime) => {
  if (mime === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8;
  if (mime === 'image/png') return buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/gif') return buf.slice(0, 3).toString() === 'GIF';
  if (mime === 'image/webp') return buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
  return false;
};
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + (EXT[file.mimetype] || '')),
  }),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new Error('Only JPG, PNG, WebP or GIF images are allowed.'))),
});

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'",
  });
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));

/* public API */
app.get('/api/content', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(cleanContent(readJSON(CONTENT_FILE, {})));
});

app.post('/api/messages', (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot field, bots fill it in
  if (limited('msg:' + req.ip, 5, 60 * 60 * 1000)) return res.status(429).json({ error: 'Too many messages. Please try again later.' });
  const name = str(b.name, 100), email = str(b.email, 200), message = str(b.message, 4000);
  if (!name || !message) return res.status(400).json({ error: 'Please enter your name and a message.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  const all = readJSON(MESSAGES_FILE, []);
  all.unshift({ id: crypto.randomBytes(6).toString('hex'), name, email, message, date: new Date().toISOString(), read: false });
  writeJSON(MESSAGES_FILE, all.slice(0, 500));
  res.json({ ok: true });
});

/* admin API */
app.post('/api/admin/login', (req, res) => {
  const key = 'login:' + req.ip;
  const rec = attempts.get(key);
  if (rec && rec.count >= 5 && rec.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const auth = readJSON(AUTH_FILE, null);
  const pw = typeof (req.body || {}).password === 'string' ? req.body.password : '';
  if (!auth || !pw || !checkPassword(pw, auth)) {
    limited(key, 5, 15 * 60 * 1000);
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  attempts.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  res.json({ ok: true, isDefault: !!auth.isDefault });
});

app.post('/api/admin/logout', (req, res) => {
  sessions.delete(parseCookies(req).sid);
  res.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/me', (req, res) => {
  const ok = isAuthed(req);
  res.json({ authenticated: ok, isDefault: ok ? !!(readJSON(AUTH_FILE, {}).isDefault) : false });
});

app.get('/api/admin/content', requireAdmin, (_req, res) => res.json(cleanContent(readJSON(CONTENT_FILE, {}))));

app.put('/api/admin/content', requireAdmin, (req, res) => {
  const clean = cleanContent(req.body);
  writeJSON(CONTENT_FILE, clean);
  res.json(clean);
});

app.post('/api/admin/upload', requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large. Maximum size is 6 MB.' : err.message });
    if (!req.file) return res.status(400).json({ error: 'No image was received.' });
    const buf = fs.readFileSync(req.file.path);
    if (!looksLikeImage(buf, req.file.mimetype)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'That file is not a valid image.' });
    }
    res.json({ url: '/uploads/' + req.file.filename });
  });
});

app.get('/api/admin/uploads', requireAdmin, (_req, res) => {
  const files = fs.readdirSync(UPLOAD_DIR)
    .filter((f) => /\.(jpg|png|webp|gif)$/.test(f))
    .map((f) => ({ url: '/uploads/' + f, name: f, time: fs.statSync(path.join(UPLOAD_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  res.json(files);
});

app.delete('/api/admin/uploads/:name', requireAdmin, (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(UPLOAD_DIR, name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

app.get('/api/admin/messages', requireAdmin, (_req, res) => res.json(readJSON(MESSAGES_FILE, [])));
app.patch('/api/admin/messages/:id', requireAdmin, (req, res) => {
  const all = readJSON(MESSAGES_FILE, []);
  const m = all.find((x) => x.id === req.params.id);
  if (m) { m.read = !!(req.body || {}).read; writeJSON(MESSAGES_FILE, all); }
  res.json({ ok: true });
});
app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  writeJSON(MESSAGES_FILE, readJSON(MESSAGES_FILE, []).filter((x) => x.id !== req.params.id));
  res.json({ ok: true });
});

app.post('/api/admin/password', requireAdmin, (req, res) => {
  const { current, next } = req.body || {};
  const auth = readJSON(AUTH_FILE, null);
  if (typeof current !== 'string' || !auth || !checkPassword(current, auth)) return res.status(400).json({ error: 'Your current password is incorrect.' });
  if (typeof next !== 'string' || next.length < 10) return res.status(400).json({ error: 'The new password must be at least 10 characters.' });
  if (next === DEFAULT_PASSWORD) return res.status(400).json({ error: 'Please choose a different password.' });
  writeJSON(AUTH_FILE, { ...hashPassword(next), isDefault: false });
  res.json({ ok: true });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Something went wrong on the server.' }); });

app.listen(PORT, () => {
  console.log(`\n  Portfolio:    http://localhost:${PORT}`);
  console.log(`  Admin portal: http://localhost:${PORT}/admin\n`);
});
