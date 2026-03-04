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
let DB = { users: [], nextId: 1 };

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
//  ADMIN ENDPOINTS (optional)
// ============================================================
app.get('/api/admin/users', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Kein Zugriff' });
  const users = DB.users.map(({ password: _, ...u }) => u).sort((a, b) => b.id - a.id);
  res.json({ users, total: users.length });
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
