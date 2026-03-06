#!/bin/bash
# ============================================================
#  RollArt SaaS — Sicheres Update-Script
#
#  Dieses Script macht ein Backup BEVOR es das Update zieht.
#  Nutze immer dieses Script statt "git pull"!
#
#  Verwendung:  bash update.sh
# ============================================================

set -e  # Bei Fehler abbrechen

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   RollArt 2026 — Sicheres Update        ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Pfade
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$SCRIPT_DIR/data"
DB_FILE="$DATA_DIR/db.json"
BACKUP_DIR="$DATA_DIR/backups"

# 1. Prüfen ob data/ existiert
if [ ! -d "$DATA_DIR" ]; then
  echo "⚠️  Kein data/ Ordner gefunden — wird erstellt."
  mkdir -p "$DATA_DIR"
fi

# 2. Backup erstellen BEVOR irgendwas passiert
if [ -f "$DB_FILE" ]; then
  mkdir -p "$BACKUP_DIR"
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  BACKUP_FILE="$BACKUP_DIR/db_backup_${TIMESTAMP}.json"
  cp "$DB_FILE" "$BACKUP_FILE"

  # Zähle Daten im Backup
  USERS=$(python3 -c "import json;d=json.load(open('$DB_FILE'));print(len(d.get('users',[])))" 2>/dev/null || echo "?")
  SKATERS=$(python3 -c "import json;d=json.load(open('$DB_FILE'));print(len(d.get('skaters',[])))" 2>/dev/null || echo "?")
  TRAINING=$(python3 -c "import json;d=json.load(open('$DB_FILE'));print(len(d.get('trainingLog',[])))" 2>/dev/null || echo "?")
  SCORES=$(python3 -c "import json;d=json.load(open('$DB_FILE'));print(len(d.get('scoreHistory',[])))" 2>/dev/null || echo "?")

  echo "✅ Backup erstellt: $BACKUP_FILE"
  echo "   📊 $USERS Benutzer, $SKATERS Läufer, $TRAINING Trainings, $SCORES Scores"

  # Alte Backups aufräumen (nur die letzten 10 behalten)
  ls -t "$BACKUP_DIR"/db_backup_*.json 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null
  BACKUP_COUNT=$(ls "$BACKUP_DIR"/db_backup_*.json 2>/dev/null | wc -l)
  echo "   📁 $BACKUP_COUNT Backups vorhanden"
else
  echo "ℹ️  Keine bestehende Datenbank gefunden (Erstinstallation)"
fi

echo ""

# 3. Git Pull durchführen
echo "📥 Lade Update von GitHub..."
cd "$SCRIPT_DIR"
git pull origin main

echo ""

# 4. Prüfen ob data/db.json noch da ist
if [ -f "$DB_FILE" ]; then
  echo "✅ Datenbank ist noch vorhanden!"
else
  echo "⚠️  Datenbank fehlt nach Update!"
  # Versuche aus Backup wiederherzustellen
  LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/db_backup_*.json 2>/dev/null | head -1)
  if [ -n "$LATEST_BACKUP" ]; then
    cp "$LATEST_BACKUP" "$DB_FILE"
    echo "✅ Datenbank aus Backup wiederhergestellt: $LATEST_BACKUP"
  else
    echo "❌ Kein Backup vorhanden — Server startet mit leerer Datenbank."
  fi
fi

echo ""

# 5. npm install falls nötig
if [ ! -d "node_modules" ]; then
  echo "📦 Installiere Abhängigkeiten..."
  npm install
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✅ Update abgeschlossen!              ║"
echo "║                                          ║"
echo "║   Server starten mit: npm start          ║"
echo "╚══════════════════════════════════════════╝"
echo ""
