'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

/* ---------- config ---------- */
const ROOT = path.join(__dirname, '..');
try {
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (_) { /* no .env file, that is fine */ }

const DEFAULT_CONTENT = require('../defaults/content.json'); // bundled so it works on any host
const DEFAULT_PASSWORD = 'ChangeMe123!';
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;                       // Vercel Blob
const USE_NETLIFY = process.env.STORAGE === 'netlify' || !!process.env.BLOBS_SITE_ID; // Netlify Blobs
const REMOTE = USE_BLOB || USE_NETLIFY;
const blob = USE_BLOB ? require('@vercel/blob') : null;
let nStore = null;
function netlifyStore() {
  if (!nStore) {
    const { getStore } = require('@netlify/blobs');
    nStore = process.env.BLOBS_SITE_ID
      ? getStore({ name: 'portfolio', siteID: process.env.BLOBS_SITE_ID, token: process.env.BLOBS_TOKEN })
      : getStore('portfolio');
  }
  return nStore;
}
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!REMOTE) { try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) { /* read-only host */ } }

/* Storage: Vercel Blob when BLOB_READ_WRITE_TOKEN is set (Vercel), otherwise local files. */
const PREFIX = USE_BLOB ? 'site-' + crypto.createHash('sha256').update(process.env.BLOB_READ_WRITE_TOKEN).digest('hex').slice(0, 20) : '';
async function readStore(name, fallback) {
  try {
    if (USE_NETLIFY) { const v = await netlifyStore().get(name, { type: 'json' }); return v == null ? fallback : v; }
    if (!USE_BLOB) return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
    const meta = await blob.head(`${PREFIX}/${name}`);
    const r = await fetch(meta.url + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('read failed');
    return await r.json();
  } catch (_) { return fallback; }
}
async function writeStore(name, data) {
  const body = JSON.stringify(data, null, 2);
  if (USE_NETLIFY) { await netlifyStore().set(name, body); return; }
  if (!USE_BLOB) {
    const file = path.join(DATA_DIR, name);
    fs.writeFileSync(file + '.tmp', body);
    fs.renameSync(file + '.tmp', file);
    return;
  }
  await blob.put(`${PREFIX}/${name}`, body, { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });
}
const defaultContent = () => JSON.parse(JSON.stringify(DEFAULT_CONTENT));
const loadContent = async () => (await readStore('content.json', null)) || defaultContent();

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
const ENV_PASSWORD = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;
let envAuth = null;
async function getAuth() {
  const stored = await readStore('auth.json', null); // set once the password is changed in the portal
  if (stored) return stored;
  if (!envAuth) envAuth = { ...hashPassword(ENV_PASSWORD), isDefault: ENV_PASSWORD === DEFAULT_PASSWORD };
  return envAuth;
}

/* ---------- sessions (signed cookie, works on serverless) and rate limits ---------- */
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('sess:' + ENV_PASSWORD + (process.env.BLOB_READ_WRITE_TOKEN || '')).digest('hex');
const SESSION_MS = 1000 * 60 * 60 * 8;
const sign = (p) => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
const makeToken = () => { const exp = String(Date.now() + SESSION_MS); return exp + '.' + sign(exp); };
const attempts = new Map(); // key -> { count, until } (per server instance)

const parseCookies = (req) =>
  Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, v.join('=')]));

const isAuthed = (req) => {
  const token = parseCookies(req).sid || '';
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return good.length === got.length && crypto.timingSafeEqual(good, got);
};
const requireAdmin = (req, res, next) => (isAuthed(req) ? next() : res.status(401).json({ error: 'Please log in.' }));
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const limited = (key, max, windowMs) => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
  const rec = attempts.get(key);
  if (!rec) { attempts.set(key, { count: 1, until: now + windowMs }); return false; }
  rec.count += 1;
  return rec.count > max;
};

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
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
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
if (!REMOTE) app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false }));
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
if (USE_NETLIFY) {
  app.get('/uploads/:name', ah(async (req, res) => {
    const name = path.basename(req.params.name);
    const data = await netlifyStore().get('uploads/' + name, { type: 'arrayBuffer' });
    if (!data) return res.status(404).end();
    res.set({ 'Content-Type': MIME[name.split('.').pop()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=604800' });
    res.send(Buffer.from(data));
  }));
}
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

/* public API */
app.get('/api/content', ah(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(cleanContent(await loadContent()));
}));

app.post('/api/messages', ah(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot field, bots fill it in
  if (limited('msg:' + req.ip, 5, 60 * 60 * 1000)) return res.status(429).json({ error: 'Too many messages. Please try again later.' });
  const name = str(b.name, 100), email = str(b.email, 200), message = str(b.message, 4000);
  if (!name || !message) return res.status(400).json({ error: 'Please enter your name and a message.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  const all = await readStore('messages.json', []);
  all.unshift({ id: crypto.randomBytes(6).toString('hex'), name, email, message, date: new Date().toISOString(), read: false });
  await writeStore('messages.json', all.slice(0, 500));
  res.json({ ok: true });
}));

/* admin API */
app.post('/api/admin/login', ah(async (req, res) => {
  const key = 'login:' + req.ip;
  const rec = attempts.get(key);
  if (rec && rec.count >= 5 && rec.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const auth = await getAuth();
  const pw = typeof (req.body || {}).password === 'string' ? req.body.password : '';
  if (!pw || !checkPassword(pw, auth)) {
    limited(key, 5, 15 * 60 * 1000);
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  attempts.delete(key);
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `sid=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  res.json({ ok: true, isDefault: !!auth.isDefault });
}));

app.post('/api/admin/logout', (_req, res) => {
  res.set('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/me', ah(async (req, res) => {
  const ok = isAuthed(req);
  res.json({ authenticated: ok, isDefault: ok ? !!(await getAuth()).isDefault : false });
}));

app.get('/api/admin/content', requireAdmin, ah(async (_req, res) => res.json(cleanContent(await loadContent()))));

app.put('/api/admin/content', requireAdmin, ah(async (req, res) => {
  const clean = cleanContent(req.body);
  await writeStore('content.json', clean);
  res.json(clean);
}));

app.post('/api/admin/upload', requireAdmin, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large. Maximum size is 4 MB.' : err.message });
    if (!req.file) return res.status(400).json({ error: 'No image was received.' });
    if (!looksLikeImage(req.file.buffer, req.file.mimetype)) return res.status(400).json({ error: 'That file is not a valid image.' });
    const name = Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex') + EXT[req.file.mimetype];
    (async () => {
      if (USE_NETLIFY) {
        await netlifyStore().set('uploads/' + name, req.file.buffer.buffer.slice(req.file.buffer.byteOffset, req.file.buffer.byteOffset + req.file.buffer.length));
        return res.json({ url: '/uploads/' + name });
      }
      if (USE_BLOB) {
        const r = await blob.put(`${PREFIX}/uploads/${name}`, req.file.buffer, { access: 'public', addRandomSuffix: false, contentType: req.file.mimetype });
        return res.json({ url: r.url });
      }
      fs.writeFileSync(path.join(UPLOAD_DIR, name), req.file.buffer);
      res.json({ url: '/uploads/' + name });
    })().catch(next);
  });
});

app.get('/api/admin/uploads', requireAdmin, ah(async (_req, res) => {
  if (USE_NETLIFY) {
    const { blobs } = await netlifyStore().list({ prefix: 'uploads/' });
    return res.json(blobs.map((b) => { const n = b.key.replace('uploads/', ''); return { url: '/uploads/' + n, name: n, time: parseInt(n.split('-')[0], 36) || 0 }; }).sort((a, b) => b.time - a.time));
  }
  if (USE_BLOB) {
    const { blobs } = await blob.list({ prefix: `${PREFIX}/uploads/`, limit: 200 });
    return res.json(blobs.map((b) => ({ url: b.url, name: b.url, time: +new Date(b.uploadedAt) })).sort((a, b) => b.time - a.time));
  }
  const files = fs.readdirSync(UPLOAD_DIR)
    .filter((f) => /\.(jpg|png|webp|gif)$/.test(f))
    .map((f) => ({ url: '/uploads/' + f, name: f, time: fs.statSync(path.join(UPLOAD_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  res.json(files);
}));

app.delete('/api/admin/uploads', requireAdmin, ah(async (req, res) => {
  const target = String(req.query.url || '');
  if (USE_NETLIFY) {
    await netlifyStore().delete('uploads/' + path.basename(target));
  } else if (USE_BLOB) {
    if (/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(target) && target.includes(`/${PREFIX}/uploads/`)) await blob.del(target);
  } else {
    const file = path.join(UPLOAD_DIR, path.basename(target));
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  res.json({ ok: true });
}));

app.get('/api/admin/messages', requireAdmin, ah(async (_req, res) => res.json(await readStore('messages.json', []))));
app.patch('/api/admin/messages/:id', requireAdmin, ah(async (req, res) => {
  const all = await readStore('messages.json', []);
  const m = all.find((x) => x.id === req.params.id);
  if (m) { m.read = !!(req.body || {}).read; await writeStore('messages.json', all); }
  res.json({ ok: true });
}));
app.delete('/api/admin/messages/:id', requireAdmin, ah(async (req, res) => {
  await writeStore('messages.json', (await readStore('messages.json', [])).filter((x) => x.id !== req.params.id));
  res.json({ ok: true });
}));

app.post('/api/admin/password', requireAdmin, ah(async (req, res) => {
  const { current, next } = req.body || {};
  const auth = await getAuth();
  if (typeof current !== 'string' || !checkPassword(current, auth)) return res.status(400).json({ error: 'Your current password is incorrect.' });
  if (typeof next !== 'string' || next.length < 10) return res.status(400).json({ error: 'The new password must be at least 10 characters.' });
  if (next === DEFAULT_PASSWORD) return res.status(400).json({ error: 'Please choose a different password.' });
  await writeStore('auth.json', { ...hashPassword(next), isDefault: false });
  res.json({ ok: true });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Something went wrong on the server.' }); });

module.exports = app;
