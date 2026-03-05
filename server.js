// ============================================================
//  RollArt SaaS — Node.js Backend
//  Express + SQLite + JWT + bcrypt
// ============================================================
require('dotenv').config();
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
//  DATABASE SETUP — Daten werden in data/ gespeichert
//  WICHTIG: Beim Update NUR server.js + public/ ersetzen,
//  NIEMALS den data/ Ordner löschen!
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('  📁 data/ Ordner erstellt');
}

// Migration: alte db.json aus Hauptordner nach data/ verschieben
const OLD_DB_FILE = path.join(__dirname, 'db.json');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_FILE = path.join(DATA_DIR, 'db_backup.json');

if (fs.existsSync(OLD_DB_FILE)) {
  if (!fs.existsSync(DB_FILE)) {
    // Keine data/db.json vorhanden → alte Datei migrieren
    try {
      fs.copyFileSync(OLD_DB_FILE, DB_FILE);
      console.log('  ✅ Bestehende db.json nach data/ migriert');
    } catch(e) { console.error('Migration error:', e.message); }
  } else {
    // Beide existieren → prüfen welche mehr Daten hat und ggf. mergen
    try {
      const oldData = JSON.parse(fs.readFileSync(OLD_DB_FILE, 'utf8'));
      const newData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      const oldSkaters = (oldData.skaters || []).length;
      const newSkaters = (newData.skaters || []).length;
      const oldUsers = (oldData.users || []).length;
      const newUsers = (newData.users || []).length;
      if (oldSkaters > newSkaters || oldUsers > newUsers) {
        // Alte DB hat mehr Daten → Backup der neuen machen, dann alte übernehmen
        fs.writeFileSync(BACKUP_FILE, JSON.stringify(newData, null, 2));
        fs.copyFileSync(OLD_DB_FILE, DB_FILE);
        console.log(`  ⚠️ Alte db.json hat mehr Daten (${oldUsers} User, ${oldSkaters} Läufer) → übernommen`);
      }
    } catch(e) { /* Fehler beim Merge-Check ignorieren, data/db.json bleibt */ }
  }
}

let DB = { users: [], nextId: 1, skaters: [], trainingLog: [], scoreHistory: [], competitions: [], settings: {
  registrationOpen: true,
  welcomeMessage: 'Willkommen bei RollArt 2026!',
  seasonYear: 2026,
  maintenanceMode: false,
  maxUsersPerVerein: 50,
} };

// Load or init DB
if (fs.existsSync(DB_FILE)) {
  try {
    DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    // Automatisches Backup bei jedem Start
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(DB, null, 2));
    const skaterCount = (DB.skaters || []).length;
    const userCount = (DB.users || []).length;
    console.log(`  💾 Datenbank geladen: ${userCount} Benutzer, ${skaterCount} Läufer`);
    console.log(`  📋 Backup erstellt: data/db_backup.json`);
  } catch(e) {
    console.error('DB load error, versuche Backup...', e.message);
    // Versuche Backup zu laden falls Hauptdatei korrupt
    if (fs.existsSync(BACKUP_FILE)) {
      try {
        DB = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
        console.log('  ⚠️ Backup geladen statt korrupter db.json');
      } catch(e2) { console.error('Auch Backup korrupt, starte neu'); }
    }
  }
} else {
  console.log('  🆕 Neue Datenbank erstellt');
}

const saveDB = () => {
  try {
    // Atomares Schreiben: erst temp-Datei, dann umbenennen
    // So wird die DB nicht korrupt bei Crash/Stromausfall
    const tmpFile = DB_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(DB, null, 2));
    fs.renameSync(tmpFile, DB_FILE);
  } catch(e) { console.error('DB save error:', e.message); }
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
  const { name, kategorie, verein, music, segment, rows, pcs, deductions, extraPoints, officialSheet, judgeCount } = req.body;

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
    judgeCount: judgeCount || 3,
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

  const { name, kategorie, verein, music, segment, rows, pcs, deductions, extraPoints, officialSheet, judgeCount } = req.body;

  if (name !== undefined) skater.name = name;
  if (kategorie !== undefined) skater.kategorie = kategorie;
  if (verein !== undefined) skater.verein = verein;
  if (music !== undefined) skater.music = music;
  if (segment !== undefined) skater.segment = segment;
  if (rows !== undefined) skater.rows = rows;
  if (pcs !== undefined) skater.pcs = pcs;
  if (deductions !== undefined) skater.deductions = deductions;
  if (extraPoints !== undefined) skater.extraPoints = extraPoints;
  if (judgeCount !== undefined) skater.judgeCount = judgeCount;
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
//  KI-COACH — AI Integration
// ============================================================
const KI_API_KEY = process.env.KI_API_KEY || '';

const KI_SYSTEM_PROMPT = `Du bist der RollArt KI-Coach für Artistic Roller Skating (Rollkunstlauf) nach den offiziellen World Skate 2026 Regeln.
Du analysierst Programm-Zusammensetzungen und gibst präzise Regelprüfungen, Optimierungsvorschläge und Trainingsempfehlungen.
Deine Antworten basieren AUSSCHLIESSLICH auf den folgenden offiziellen Regeln. Erfinde KEINE Regeln dazu.

ALTERSKATEGORIEN (Saison 2026):
Tots: 8-9 Jahre | Minis: 10-11 Jahre | Espoirs: 12-13 Jahre | Cadets: 14-15 Jahre | Youth/Jeunesse: 16 Jahre | Junior: 17-18 Jahre | Senior: 19+

=== EINZELLAUF — SHORT PROGRAM (SP) ===

JUNIOR/SENIOR SP (2:45 ±5s):
- 1 Axel (einfach, doppel oder dreifach)
- 1 Kombination aus 2-3 Sprüngen inkl. Connecting Jump (max 2 Dreifach in der Kombi)
- 1 Solo-Sprung (einfach/doppel/dreifach, KEIN Axel)
- 1 Positions-Spin (Solo-Spin)
- 1 Kombinations-Spin (MUSS Sitz-Position enthalten, max 4 Positionen)
- 1 Schrittfolge (Footwork Sequence, max 40 Sekunden)

YOUTH SP (2:30 ±5s):
- Gleiche Elemente wie Junior/Senior SP
- Schrittfolge max Level 4, max 40 Sekunden

CADET SP (2:30 ±5s):
- Gleiche Elemente wie Junior/Senior SP
- Schrittfolge max Level 3, max 30 Sekunden

ESPOIR SP (2:00 ±5s):
- 1 Axel (NUR einfach!)
- 1 Kombination aus 2-3 Sprüngen (KEINE Doppel-Axel, KEINE Dreifach in der Kombi)
- 1 Solo-Sprung (einfach oder doppel, KEIN Axel)
- 1 Kombinations-Spin (max 2 Positionen: Sitz + Kamel)
- 1 Positions-Spin (MUSS Kamel sein)
- 1 Schrittfolge (max Level 3, max 30 Sekunden)

HINWEIS SP: In der Kombination darf ein Connecting Jump enthalten sein. Der gleiche Sprungtyp darf nicht zweimal im SP vorkommen.

=== EINZELLAUF — FREE PROGRAM / KÜR (FP) ===

SENIOR/JUNIOR KÜR (4:00 ±10s):
- Max 8 Sprünge (ohne Connecting Jumps)
- Max 3 Kombinationen (max 5 Sprünge pro Kombi, max 3 Doppel/Axel pro Kombi)
- Axel ist PFLICHT (muss im Programm vorkommen)
- 2 Spin-Elemente: eines MUSS Kombinations-Spin sein (muss Sitz enthalten, max 4 Positionen)
- 1 Choreo-Sequenz (max Level 1, max 30 Sekunden)
- Broken-Spin erlaubt
- Doppel-Axel zählt als Dreifach-Sprung!

YOUTH KÜR (4:00 ±10s):
- Gleiche Regeln wie Senior/Junior Kür
- Max 3 Kombinationen (max 5 Sprünge pro Kombi)

CADET KÜR (3:30 ±10s):
- Max 8 Sprünge (ohne Connecting Jumps)
- Max 2 Kombinationen (max 5 Sprünge pro Kombi)
- Axel ist PFLICHT
- 2 Spin-Elemente: eines MUSS Kombinations-Spin sein (muss Sitz enthalten, max 4 Positionen)
- 1 Choreo-Sequenz (max Level 1, max 30 Sekunden)
- Broken-Spin NICHT erlaubt!

ESPOIR KÜR (3:15 ±10s):
- Max 8 Sprünge (KEINE Doppel-Axel, KEINE Dreifach!)
- Max 2 Kombinationen (max 5 Sprünge pro Kombi, max 3 Doppel/Axel pro Kombi)
- Axel ist PFLICHT (einfacher Axel)
- 2 Spin-Elemente: eines MUSS Kombinations-Spin sein (muss Sitz enthalten, max 4 Positionen)
- 1 Choreo-Sequenz (max Level 1, max 30 Sekunden)
- Broken-Spin NICHT erlaubt!

MINIS KÜR (2:45 ±10s):
- Max 12 Sprünge, max 1 Rotation (AUSNAHME: Doppel-Toeloop und Doppel-Salchow sind erlaubt)
- Max 2 Kombinationen (max 5 Sprünge pro Kombi)
- Axel ist PFLICHT, mindestens 1 Toeloop ist PFLICHT
- 2 Spin-Elemente: eines MUSS Kombinations-Spin sein (muss Sitz enthalten, max 4 Positionen)
  WICHTIG: Es gibt KEINE Pflicht für einen bestimmten Solo-Spin! Das zweite Spin-Element ist frei wählbar (Solo oder Combo).
- Broken-Spin, Ankle-Spin, Heel-Spin, Inverted Spin: NICHT erlaubt!
- 1 Schrittfolge (Footwork Sequence, max Level 2, max 30 Sekunden)
- KEINE Choreo-Sequenz

TOTS KÜR (2:30 ±10s):
- Max 12 Sprünge, max 1 Rotation inkl. Waltz Jump
- Max 2 Kombinationen (max 4 Sprünge pro Kombi)
- Toeloop UND Salchow sind PFLICHT
- 2 Spin-Elemente: eines MUSS Kombinations-Spin sein (max 4 Positionen, NUR Aufrecht + Sitz, KEIN Biellmann)
- Broken-Spin, Ankle-Spin, Heel-Spin, Inverted Spin: NICHT erlaubt!
- 1 Schrittfolge (max Level 1, max 30 Sekunden)
- KEINE Choreo-Sequenz

ALLGEMEINE SPRUNGREGELN (KÜR):
- Max 2 gleiche Sprünge gleicher Rotation im Programm
- Gleicher Sprung darf max 2x vorkommen, davon mind. 1x in Kombination
- Connecting Jump: gilt NICHT als Sprung, ist aber Teil der Kombination
- Halber Sprung (<<) = Sprung wird um 1 Rotation herabgestuft

=== PAARLAUF — PAIRS ===

PAIRS TOTS KÜR (2:00 ±10s):
- 1 SBS-Sprung (max 1 Rotation)
- 1 SBS-Kombination (max 3 Sprünge, max 1 Rotation)
- 1 SBS-Spin (1 Pos. oder Combo max 2 Pos., nur Aufrecht)
- 1 Contact Spin (1 Position, nur Aufrecht)
- 1 Schrittfolge (max Lv1, max 30s)
- KEINE Hebungen, KEINE Wurfsprünge, KEIN Twist, KEINE Death Spiral

PAIRS MINIS KÜR (2:30 ±10s):
- Max 2 SBS-Sprünge (NICHT in Kombination, max Axel/Doppel-TL/Doppel-S)
- 1 SBS-Spin (max 2 Positionen, Aufrecht + Sitz)
- Max 2 Wurfsprünge (einfach oder Axel)
- 1 Contact Spin (1 Position, Aufrecht/Sitz/Hazel)
- 1 Spiral (Kamel BO)
- 1 Schrittfolge (max Lv2, max 30s)
- KEINE Hebungen, KEIN Twist, KEINE Death Spiral

PAIRS ESPOIR SP (2:15 ±5s):
- 1 Positions-Hebung (Axel, max Lv2)
- 1 SBS-Sprung (Axel)
- 1 SBS-Spin (Sitz BI)
- 1 Wurfsprung (einfach, kein Axel)
- 1 Contact Spin (Sitz Face-to-Face)
- 1 Spiral (Kamel BO)
- 1 Schrittfolge (max Lv3, max 30s)

PAIRS ESPOIR KÜR (3:00 ±10s):
- 2 Hebungen (1 Combo + 1 Solo, max Lv2, kein Overhead/Low Militano)
- Max 2 SBS-Sprünge (max 2 Rotation, kein Doppel-Loop/2A/Dreifach)
- 1 SBS-Combo-Spin (max 2 Positionen)
- Max 2 Wurfsprünge (Axel/Doppel-TL/Doppel-S)
- 1 Combo Contact Spin (max 2 Positionen)
- 1 Spiral (Kamel BO)
- 1 Choreo-Sequenz (max 30s)

PAIRS CADET SP (2:30 ±5s):
- 1 Positions-Hebung (Axel/Lasso, max Lv3, kein Overhead)
- 1 SBS-Sprung (Axel)
- 1 SBS-Spin (Kamel BI)
- 1 Wurfsprung (einfach/Axel/Doppel-TL/Doppel-S)
- 1 Contact Spin (Combo max 2 Pos., muss Sitz enthalten)
- 1 Spiral (Kamel BO)
- 1 Schrittfolge (max Lv3, max 30s)

PAIRS CADET KÜR (3:45 ±10s):
- Max 3 Hebungen (max Lv3, kein Overhead/Low Militano)
- Max 2 SBS-Sprünge (max 2 Rotation, kein Doppel-Loop/2A/Dreifach)
- 1 SBS-Combo-Spin (max 2 Positionen)
- Max 2 Wurfsprünge (max Doppel, kein Dreifach)
- 1 Combo Contact Spin (max 2 Positionen)
- 1 Spiral (Kamel BO)
- 1 Choreo-Sequenz (max 30s)

PAIRS YOUTH SP (2:30 ±5s):
- 1 Combo-Hebung (max 2 Pos., kein Overhead)
- 1 SBS-Sprung (Axel oder Doppel)
- 1 SBS-Combo-Spin (max 2 Pos., muss Sitz enthalten)
- 1 Wurfsprung (max Doppel, kein Dreifach)
- 1 Combo Contact Spin (max 2 Pos., muss Sitz enthalten)
- 1 Death Spiral (Outside, kein Pivot)
- 1 Schrittfolge (max Lv4, max 40s)

PAIRS YOUTH KÜR (4:00 ±10s):
- Max 3 Hebungen (max Lv4, kein Overhead/Low Militano)
- Max 2 SBS-Sprünge (Axel Pflicht, max 2 Rotation, kein 2A/Dreifach)
- 1 SBS-Combo-Spin (max 3 Positionen)
- Max 2 Wurfsprünge (max Doppel)
- 1 Twist (max Doppel)
- 1 Combo Contact Spin (max 2 Positionen)
- 1 Death Spiral (Inside)
- 1 Choreo-Sequenz (max 30s)

PAIRS JUNIOR SP (3:00 ±5s):
- 1 Positions-Hebung + 1 Combo-Hebung (kein Overhead)
- 1 SBS-Sprung (Doppel oder Dreifach, kein Axel)
- 1 Wurfsprung (Doppel oder Dreifach)
- 1 SBS-Combo-Spin (max 3 Pos., muss Sitz)
- 1 Combo Contact Spin (max 3 Pos., muss Sitz)
- 1 Death Spiral (Outside, kein Pivot)
- 1 Schrittfolge (max 40s)

PAIRS JUNIOR KÜR (4:30 ±10s):
- Max 3 Hebungen (Positionen/Combo, kein Overhead/Low Militano)
- Max 2 SBS-Sprünge (Axel Pflicht)
- 1 SBS-Combo-Spin (max 4 Positionen)
- Max 2 Wurfsprünge (max Dreifach)
- 1 Twist
- 1 Combo Contact Spin (max 3 Positionen)
- 1 Death Spiral (Inside)
- 1 Choreo-Sequenz (max 30s)

PAIRS SENIOR SP (3:00 ±5s):
- 1 Positions-Hebung + 1 Combo-Hebung
- 1 SBS-Sprung (Doppel oder Dreifach, kein Axel)
- 1 Wurfsprung (Doppel oder Dreifach)
- 1 SBS-Combo-Spin (muss Sitz enthalten)
- 1 Combo Contact Spin (muss Sitz enthalten)
- 1 Death Spiral (Outside, kein Pivot)
- 1 Schrittfolge (max 40s)

PAIRS SENIOR KÜR (4:30 ±10s):
- Max 3 Hebungen (max 2 gleichen Typs)
- Max 2 SBS-Sprünge (Axel Pflicht)
- 1 SBS-Combo-Spin (max 4 Positionen)
- Max 2 Wurfsprünge
- 1 Twist
- 1 Combo Contact Spin
- 1 Death Spiral (Inside)
- 1 Choreo-Sequenz (max 30s)

=== BEWERTUNGSSYSTEM ===

QOE (Quality of Element): -3 bis +3, Trimmed Mean bei mehr als 3 Judges
Rotation: N = volle Rotation | < = under-rotated (-30% vom Base Value) | << = half-rotated (-50%) | <<< = Downgrade (zählt als niedrigere Rotation)

PCS (Program Component Score): 5 Komponenten je 0-10 Punkte:
1. Skating Skills 2. Transitions 3. Performance 4. Composition 5. Interpretation
PCS-Faktor variiert je nach Kategorie und Segment.

ABZÜGE:
- Sturz: -0.5 (Espoir-Senior) / -0.3 (Tots/Minis) pro Sturz
- Zeitüberschreitung: -0.5 pro angefangene 5 Sekunden
- Fehlende Elemente: -0.5 pro fehlendes Pflichtelement
- Verbotene Elemente: Basewert wird auf 0 gesetzt

=== BONUSSYSTEM ===

ZEITBONUS: +10% auf Base Value für Sprünge nach der halben Programmlänge (ab Cadet)

KOMBINATIONSBONUS:
- Minis: +10% Axel+Doppel-Toeloop Kombi (ohne Connecting), +10% Doppel+Doppel Kombi
- Espoir/Cadet KÜR: +10% Doppel+Doppel Kombi
- Youth/Junior/Senior KÜR: +10% Doppel+Doppel, +20% Doppel+Dreifach, +30% Dreifach+Dreifach

SPIN-POSITIONSBONUS:
- Biellmann: +80% | Sideways Lean: +60% | Split/Y-Position/Twist: +40-50% | Heel/Layback: +20-30%

=== SPIN-REGELN DETAILS ===
- Kombinations-Spin: Wechsel zwischen verschiedenen Positionen
- Positions-Spin: Spin in einer Position
- "Muss Sitz enthalten" = mindestens eine Sitz-Position im Spin erforderlich
- Broken-Spin: Spin mit Unterbrechung (nur ab Cadet-Kür und höher erlaubt)
- Ankle-Spin/Heel-Spin/Inverted: nur ab Espoir und höher erlaubt

=== HEBUNGEN (PAIRS) ===
- Positions-Hebung: Partner in EINER Position gehoben
- Kombinations-Hebung: Partner wechselt Positionen während der Hebung
- Overhead: Partner über Kopfhöhe (erst ab Youth erlaubt, je nach Kategorie)
- Twist: Partner wird hochgeworfen und dreht sich
- Wurfsprung: Partner wird geworfen und landet allein

=== VERHALTEN ===
Antworte IMMER auf Deutsch. Sei präzise und gib konkrete Verbesserungsvorschläge mit geschätzten Punktegewinnen.
Verwende kurze, klare Sätze. Strukturiere deine Antwort mit Emojis als Aufzählungszeichen.
Wenn du dir bei einer Regel unsicher bist, sage das ehrlich statt zu raten.
Beziehe dich immer auf die korrekte Kategorie des Läufers/der Läuferin.`;

app.post('/api/ki-coach', auth, async (req, res) => {
  if (!KI_API_KEY) {
    return res.status(503).json({ error: 'KI-Coach nicht konfiguriert. Bitte KI_API_KEY in der .env Datei setzen.' });
  }

  const { message, context } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Nachricht fehlt' });
  }

  // Build context string from skating data
  let contextStr = '';
  if (context) {
    contextStr = `\n\nAKTUELLES PROGRAMM:\nKategorie: ${context.kategorie || 'unbekannt'}\nSegment: ${context.segment || 'unbekannt'}\n`;
    if (context.rows && context.rows.length > 0) {
      contextStr += 'Elemente:\n';
      context.rows.forEach((r, i) => {
        if (r.typeCode) {
          const rotation = r.rotation && r.rotation !== 'normal' ? ` [${r.rotation}]` : '';
          const nv = r.nv ? ' [NV]' : '';
          const dg = r.dg ? ' [DG]' : '';
          const bonuses = (r.bonuses || []).length > 0 ? ` Boni: ${r.bonuses.join(', ')}` : '';
          if (r.typeCode === 'CoJ') {
            const subs = (r.comboEls || []).filter(s => s.code).map(s => s.code).join('+');
            contextStr += `  ${i + 1}. ${r.typeCode}: ${subs || 'leer'}${rotation}${nv}${dg}${bonuses}\n`;
          } else {
            contextStr += `  ${i + 1}. ${r.typeCode}: ${r.elCode || 'leer'}${rotation}${nv}${dg}${bonuses}\n`;
          }
        }
      });
    }
    if (context.scores) {
      contextStr += `\nPunkte: TES=${context.scores.tes || 0}, PCS=${context.scores.pcs || 0}, Abzüge=${context.scores.deductions || 0}, Gesamt=${context.scores.total || 0}\n`;
    }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KI_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        system: KI_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: contextStr + '\n\nFrage des Trainers/Läufers: ' + message }
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('KI API error:', response.status, errText);
      return res.status(502).json({ error: `KI-Coach Fehler (${response.status})` });
    }

    const data = await response.json();
    const reply = data.content?.[0]?.text || 'Keine Antwort erhalten.';
    res.json({ reply });
  } catch (err) {
    console.error('KI-Coach error:', err);
    res.status(500).json({ error: 'Fehler bei der KI-Analyse: ' + err.message });
  }
});

// ============================================================
//  TRAINING LOG (Tagebuch)
// ============================================================
app.get('/api/training', auth, (req, res) => {
  if (!DB.trainingLog) DB.trainingLog = [];
  const logs = DB.trainingLog.filter(l => l.userId === req.user.id);
  res.json({ logs: logs.sort((a,b) => b.date.localeCompare(a.date)) });
});

app.post('/api/training', auth, (req, res) => {
  if (!DB.trainingLog) DB.trainingLog = [];
  const { date, duration, notes, elements, goals, skaterId, skaterName } = req.body;
  const entry = {
    id: Date.now(),
    userId: req.user.id,
    date: date || new Date().toISOString().slice(0,10),
    duration: duration || 0,
    notes: notes || '',
    elements: elements || [],
    goals: goals || '',
    skaterId: skaterId || null,
    skaterName: skaterName || '',
    createdAt: new Date().toISOString(),
  };
  DB.trainingLog.push(entry);
  saveDB();
  res.status(201).json({ entry });
});

app.put('/api/training/:id', auth, (req, res) => {
  if (!DB.trainingLog) DB.trainingLog = [];
  const id = parseInt(req.params.id);
  const entry = DB.trainingLog.find(l => l.id === id && l.userId === req.user.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  const { date, duration, notes, elements, goals, skaterId, skaterName } = req.body;
  if (date !== undefined) entry.date = date;
  if (duration !== undefined) entry.duration = duration;
  if (notes !== undefined) entry.notes = notes;
  if (elements !== undefined) entry.elements = elements;
  if (goals !== undefined) entry.goals = goals;
  if (skaterId !== undefined) entry.skaterId = skaterId;
  if (skaterName !== undefined) entry.skaterName = skaterName;
  saveDB();
  res.json({ entry });
});

app.delete('/api/training/:id', auth, (req, res) => {
  if (!DB.trainingLog) DB.trainingLog = [];
  const id = parseInt(req.params.id);
  const idx = DB.trainingLog.findIndex(l => l.id === id && l.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  DB.trainingLog.splice(idx, 1);
  saveDB();
  res.json({ message: 'Deleted' });
});

// ============================================================
//  SCORE HISTORY (Verlauf)
// ============================================================
app.get('/api/score-history', auth, (req, res) => {
  if (!DB.scoreHistory) DB.scoreHistory = [];
  const history = DB.scoreHistory.filter(h => h.userId === req.user.id);
  res.json({ history: history.sort((a,b) => a.date.localeCompare(b.date)) });
});

app.post('/api/score-history', auth, (req, res) => {
  if (!DB.scoreHistory) DB.scoreHistory = [];
  const { skaterId, skaterName, kategorie, segment, tes, pcs, deductions, extraPoints, total, date, label } = req.body;
  const entry = {
    id: Date.now(),
    userId: req.user.id,
    skaterId: skaterId || null,
    skaterName: skaterName || '',
    kategorie: kategorie || '',
    segment: segment || '',
    tes: tes || 0,
    pcs: pcs || 0,
    deductions: deductions || 0,
    extraPoints: extraPoints || 0,
    total: total || 0,
    date: date || new Date().toISOString().slice(0,10),
    label: label || '',
    createdAt: new Date().toISOString(),
  };
  DB.scoreHistory.push(entry);
  saveDB();
  res.status(201).json({ entry });
});

app.delete('/api/score-history/:id', auth, (req, res) => {
  if (!DB.scoreHistory) DB.scoreHistory = [];
  const id = parseInt(req.params.id);
  const idx = DB.scoreHistory.findIndex(h => h.id === id && h.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  DB.scoreHistory.splice(idx, 1);
  saveDB();
  res.json({ message: 'Deleted' });
});

// ============================================================
//  COMPETITIONS (Kalender)
// ============================================================
app.get('/api/competitions', auth, (req, res) => {
  if (!DB.competitions) DB.competitions = [];
  const comps = DB.competitions.filter(c => c.userId === req.user.id);
  res.json({ competitions: comps.sort((a,b) => a.date.localeCompare(b.date)) });
});

app.post('/api/competitions', auth, (req, res) => {
  if (!DB.competitions) DB.competitions = [];
  const { name, date, location, kategorie, notes, checklist } = req.body;
  const entry = {
    id: Date.now(),
    userId: req.user.id,
    name: name || '',
    date: date || '',
    location: location || '',
    kategorie: kategorie || '',
    notes: notes || '',
    checklist: checklist || [
      {item:'Content Sheet erstellt',done:false},
      {item:'Musik abgegeben',done:false},
      {item:'Kostüm fertig',done:false},
      {item:'Anmeldung bestätigt',done:false},
      {item:'Programm durchgelaufen',done:false},
    ],
    createdAt: new Date().toISOString(),
  };
  DB.competitions.push(entry);
  saveDB();
  res.status(201).json({ entry });
});

app.put('/api/competitions/:id', auth, (req, res) => {
  if (!DB.competitions) DB.competitions = [];
  const id = parseInt(req.params.id);
  const entry = DB.competitions.find(c => c.id === id && c.userId === req.user.id);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  const { name, date, location, kategorie, notes, checklist } = req.body;
  if (name !== undefined) entry.name = name;
  if (date !== undefined) entry.date = date;
  if (location !== undefined) entry.location = location;
  if (kategorie !== undefined) entry.kategorie = kategorie;
  if (notes !== undefined) entry.notes = notes;
  if (checklist !== undefined) entry.checklist = checklist;
  saveDB();
  res.json({ entry });
});

app.delete('/api/competitions/:id', auth, (req, res) => {
  if (!DB.competitions) DB.competitions = [];
  const id = parseInt(req.params.id);
  const idx = DB.competitions.findIndex(c => c.id === id && c.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  DB.competitions.splice(idx, 1);
  saveDB();
  res.json({ message: 'Deleted' });
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
