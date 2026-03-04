# RollArt SaaS — Artistic Roller Skating 2026

Scoring-Plattform fuer Rollkunstlauf nach offiziellen World Skate Regeln 2026.

## Features

- Content Sheet Wertung mit allen offiziellen Elementwerten
- Official Content Sheets (7 Typen) mit PDF-Export
- Training Simulator mit Bonus-System
- KI-Coach (Regelcheck, Optimierung, Trainingstipps)
- Benutzerverwaltung (Registrierung, Login, Profil)

## Lokal starten

```bash
npm install
npm start
# -> http://localhost:3000
```

## Umgebungsvariablen

| Variable | Beschreibung | Default |
|---|---|---|
| `PORT` | Server-Port | `3000` |
| `JWT_SECRET` | Geheimer Schluessel fuer JWT-Tokens | Auto-generiert |

Fuer Produktion: Setze `JWT_SECRET` auf einen sicheren, zufaelligen String!

## Deploy auf Railway (empfohlen)

1. Erstelle ein Repo auf GitHub und pushe den Code
2. Gehe zu [railway.app](https://railway.app) und logge dich mit GitHub ein
3. "New Project" -> "Deploy from GitHub Repo" -> waehle dein Repo
4. Railway erkennt Node.js automatisch und fuehrt `npm start` aus
5. Unter "Variables" setze: `JWT_SECRET=ein-langer-zufaelliger-string`
6. Railway gibt dir eine oeffentliche URL (z.B. `rollart-saas.up.railway.app`)

## Deploy auf Render

1. Pushe den Code zu GitHub
2. Gehe zu [render.com](https://render.com) -> "New Web Service"
3. Verbinde dein GitHub Repo
4. Einstellungen:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Unter "Environment" setze: `JWT_SECRET=ein-langer-zufaelliger-string`

## API Endpoints

| Methode | Endpoint | Beschreibung | Auth |
|---|---|---|---|
| POST | `/api/register` | Konto erstellen | - |
| POST | `/api/login` | Anmelden | - |
| GET | `/api/me` | Profil abrufen | JWT |
| PUT | `/api/me` | Profil aendern | JWT |
| PUT | `/api/me/password` | Passwort aendern | JWT |
| GET | `/api/admin/users` | Alle User (Admin) | JWT+Admin |
