// ============================================================
//  RollArt SaaS — Node.js Backend
//  Express + SQLite + JWT + bcrypt
// ============================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
// WICHTIG: In Produktion JWT_SECRET als Umgebungsvariable setzen!
const JWT_SECRET = process.env.JWT_SECRET || 'rollart-dev-secret-nur-lokal-verwenden';

// ============================================================
//  DATABASE SETUP (JSON file-based for portability, SQLite optional)
// ============================================================
const DB_FILE = path.join(__dirname, 'db.json');
let DB = { users: [], nextId: 1, settings: {
  registrationOpen: true,
  welcomeMessage: 'Willkommen bei RollArt 2026!',
  seasonYear: 2026,
  maintenanceMode: false,
  maxUsersPerVerein: 50,
} };

// Load or init DB
if (fs.existsSync(DB_FILE)) {
  try { DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) { /* start fresh */ }
}
const saveDB = () => {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2)); } catch(e) { console.error('DB save error:', e.message); }
};

// Simple query helpers
const dbFindUser = (email) => DB.users.find(u => u.email === email);
const dbGetUser = (id) => DB.users.find(u => u.id === id);
const dbAddUser = (user) => {
  user.id = DB.nextId++;
  user.created_at = new Date().toISOString();
  user.updated_at = user.created_at;
  DB.users.push(user);
  saveDB();
  return user;
};
const dbUpdateUser = (id, updates) => {
  const user = dbGetUser(id);
  if (!user) return null;
  Object.assign(user, updates, { updated_at: new Date().toISOString() });
  saveDB();
  return user;
};

// ============================================================
//  MIDDLEWARE
// ============================================================
app.use(cors());
app.use(express.json());

// Serve the dashboard HTML
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
const auth = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Nicht authentifiziert' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token ungültig oder abgelaufen' });
  }
};

// ============================================================
//  AUTH ENDPOINTS
// ============================================================

// POST /api/register
app.post('/api/register', (req, res) => {
  const { email, password, name, verein, kategorie } = req.body;

  // Validation
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, Passwort und Name sind Pflichtfelder' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen lang sein' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Ungültige Email-Adresse' });
  }

  // Check if registration is open
  if (DB.settings && DB.settings.registrationOpen === false) {
    return res.status(403).json({ error: 'Registrierung ist derzeit geschlossen' });
  }

  // Check if user exists
  if (dbFindUser(email.toLowerCase())) {
    return res.status(409).json({ error: 'Email ist bereits registriert' });
  }

  // Hash password and create user
  const hash = bcrypt.hashSync(password, 10);
  const newUser = dbAddUser({
    email: email.toLowerCase(), password: hash, name,
    verein: verein || '', kategorie: kategorie || '', role: 'user'
  });

  const token = jwt.sign(
    { id: newUser.id, email: newUser.email, name, role: 'user' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.status(201).json({
    token,
    user: { id: newUser.id, email: newUser.email, name, verein: newUser.verein, kategorie: newUser.kategorie, role: newUser.role }
  });
});

// POST /api/login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email und Passwort sind erforderlich' });
  }

  const user = dbFindUser(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Email oder Passwort falsch' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, verein: user.verein, kategorie: user.kategorie, role: user.role }
  });
});

// GET /api/me — get current user profile
app.get('/api/me', auth, (req, res) => {
  const user = dbGetUser(req.user.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  const { password: _, ...safe } = user;
  res.json({ user: safe });
});

// PUT /api/me — update profile
app.put('/api/me', auth, (req, res) => {
  const { name, verein, kategorie } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (verein !== undefined) updates.verein = verein;
  if (kategorie !== undefined) updates.kategorie = kategorie;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Keine Änderungen angegeben' });
  }

  const user = dbUpdateUser(req.user.id, updates);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  const { password: _, ...safe } = user;
  res.json({ user: safe });
});

// PUT /api/me/password — change password
app.put('/api/me/password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Aktuelles und neues Passwort erforderlich' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Neues Passwort muss mindestens 6 Zeichen lang sein' });
  }

  const user = dbGetUser(req.user.id);
  if (!user || !bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  dbUpdateUser(req.user.id, { password: hash });

  res.json({ message: 'Passwort erfolgreich geändert' });
});

// ============================================================
//  ADMIN ENDPOINTS
// ============================================================
const adminAuth = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Kein Admin-Zugriff' });
  next();
};

// GET /api/admin/stats — Dashboard statistics
app.get('/api/admin/stats', auth, adminAuth, (req, res) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const week = new Date(now - 7 * 86400000).toISOString();
  const month = new Date(now - 30 * 86400000).toISOString();

  const total = DB.users.length;
  const todayCount = DB.users.filter(u => u.created_at && u.created_at.startsWith(today)).length;
  const weekCount = DB.users.filter(u => u.created_at && u.created_at >= week).length;
  const monthCount = DB.users.filter(u => u.created_at && u.created_at >= month).length;
  const admins = DB.users.filter(u => u.role === 'admin').length;

  // Registrations per day (last 14 days)
  const daily = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86400000).toISOString().split('T')[0];
    daily.push({ date: d, count: DB.users.filter(u => u.created_at && u.created_at.startsWith(d)).length });
  }

  // Top Vereine
  const vereinMap = {};
  DB.users.forEach(u => { if (u.verein) vereinMap[u.verein] = (vereinMap[u.verein] || 0) + 1; });
  const topVereine = Object.entries(vereinMap).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Top Kategorien
  const katMap = {};
  DB.users.forEach(u => { if (u.kategorie) katMap[u.kategorie] = (katMap[u.kategorie] || 0) + 1; });
  const topKategorien = Object.entries(katMap).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  res.json({ total, todayCount, weekCount, monthCount, admins, daily, topVereine, topKategorien });
});

// GET /api/admin/users — List all users
app.get('/api/admin/users', auth, adminAuth, (req, res) => {
  const users = DB.users.map(({ password: _, ...u }) => u).sort((a, b) => b.id - a.id);
  res.json({ users, total: users.length });
});

// PUT /api/admin/users/:id — Update user (role, name, verein, etc.)
app.put('/api/admin/users/:id', auth, adminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const { name, verein, kategorie, role } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (verein !== undefined) updates.verein = verein;
  if (kategorie !== undefined) updates.kategorie = kategorie;
  if (role !== undefined && ['user', 'admin'].includes(role)) updates.role = role;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Keine Aenderungen' });
  }

  const user = dbUpdateUser(id, updates);
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  const { password: _, ...safe } = user;
  res.json({ user: safe });
});

// DELETE /api/admin/users/:id — Delete user
app.delete('/api/admin/users/:id', auth, adminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Du kannst dich nicht selbst loeschen' });
  const idx = DB.users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: 'User nicht gefunden' });
  DB.users.splice(idx, 1);
  saveDB();
  res.json({ message: 'User geloescht' });
});

// POST /api/admin/users/:id/reset-password — Reset user password
app.post('/api/admin/users/:id/reset-password', auth, adminAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  const user = dbUpdateUser(id, { password: hash });
  if (!user) return res.status(404).json({ error: 'User nicht gefunden' });
  res.json({ message: 'Passwort zurueckgesetzt' });
});

// GET /api/admin/settings — Get app settings
app.get('/api/admin/settings', auth, adminAuth, (req, res) => {
  res.json({ settings: DB.settings || {} });
});

// PUT /api/admin/settings — Update app settings
app.put('/api/admin/settings', auth, adminAuth, (req, res) => {
  const allowed = ['registrationOpen', 'welcomeMessage', 'seasonYear', 'maintenanceMode', 'maxUsersPerVerein'];
  const updates = {};
  allowed.forEach(key => { if (req.body[key] !== undefined) updates[key] = req.body[key]; });
  if (!DB.settings) DB.settings = {};
  Object.assign(DB.settings, updates);
  saveDB();
  res.json({ settings: DB.settings });
});

// GET /api/settings/public — Public settings (no auth needed)
app.get('/api/settings/public', (req, res) => {
  const s = DB.settings || {};
  res.json({
    registrationOpen: s.registrationOpen !== false,
    welcomeMessage: s.welcomeMessage || '',
    seasonYear: s.seasonYear || 2026,
    maintenanceMode: s.maintenanceMode || false,
  });
});

// ============================================================
//  SKATER PROFILE ENDPOINTS
// ============================================================

// Initialize skaters array if not present
if (!DB.skaters) {
  DB.skaters = [];
  saveDB();
}

// GET /api/skaters — List all skaters for current user
app.get('/api/skaters', auth, (req, res) => {
  const userSkaters = DB.skaters.filter(s => s.userId === req.user.id);
  res.json({ skaters: userSkaters });
});

// POST /api/skaters — Save new skater profile
app.post('/api/skaters', auth, (req, res) => {
  const { name, kategorie, verein, music, segment, rows, pcs, deductions, extraPoints, officialSheet } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Skater name is required' });
  }

  const skater = {
    id: Date.now(),
    userId: req.user.id,
    name,
    kategorie: kategorie || '',
    verein: verein || '',
    music: music || '',
    segment: segment || 'senior_fp',
    rows: rows || [],
    pcs: pcs || {},
    deductions: deductions || 0,
    extraPoints: extraPoints || 0,
    officialSheet: officialSheet || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  DB.skaters.push(skater);
  saveDB();
  res.status(201).json({ skater });
});

// PUT /api/skaters/:id — Update skater profile
app.put('/api/skaters/:id', auth, (req, res) => {
  const skaterId = parseInt(req.params.id);
  const skater = DB.skaters.find(s => s.id === skaterId && s.userId === req.user.id);

  if (!skater) {
    return res.status(404).json({ error: 'Skater not found' });
  }

  const { name, kategorie, verein, music, segment, rows, pcs, deductions, extraPoints, officialSheet } = req.body;

  if (name !== undefined) skater.name = name;
  if (kategorie !== undefined) skater.kategorie = kategorie;
  if (verein !== undefined) skater.verein = verein;
  if (music !== undefined) skater.music = music;
  if (segment !== undefined) skater.segment = segment;
  if (rows !== undefined) skater.rows = rows;
  if (pcs !== undefined) skater.pcs = pcs;
  if (deductions !== undefined) skater.deductions = deductions;
  if (extraPoints !== undefined) skater.extraPoints = extraPoints;
  if (officialSheet !== undefined) skater.officialSheet = officialSheet;

  skater.updatedAt = new Date().toISOString();
  saveDB();
  res.json({ skater });
});

// DELETE /api/skaters/:id — Delete skater profile
app.delete('/api/skaters/:id', auth, (req, res) => {
  const skaterId = parseInt(req.params.id);
  const idx = DB.skaters.findIndex(s => s.id === skaterId && s.userId === req.user.id);

  if (idx === -1) {
    return res.status(404).json({ error: 'Skater not found' });
  }

  DB.skaters.splice(idx, 1);
  saveDB();
  res.json({ message: 'Skater deleted' });
});

// ============================================================
//  SERVE FRONTEND
// ============================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback for SPA
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ============================================================
//  AUTO-CREATE ADMIN (if no admin exists)
// ============================================================
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@rollart.de';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
if (!DB.users.some(u => u.role === 'admin')) {
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  dbAddUser({ email: ADMIN_EMAIL, password: hash, name: 'Administrator', verein: '', kategorie: '', role: 'admin' });
  console.log(`  Admin-Account erstellt: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log('  WICHTIG: Passwort nach erstem Login aendern!');
}

// ============================================================
//  START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   RollArt SaaS Server gestartet!        ║
  ║   http://localhost:${PORT}                  ║
  ╚══════════════════════════════════════════╝
  `);
});
