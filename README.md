# ⏱ TimeTracker

Lokale Zeiterfassung für Projekte und Kostenstellen — gesteuert per **Elgato Stream Deck**, ausgewertet im **Web-Dashboard**.

---

## Funktionsübersicht

| Bereich | Feature |
|---|---|
| **Stream Deck** | Arbeitstimer starten/stoppen per Knopfdruck |
| **Stream Deck** | Aktives Projekt wechseln (automatischer Split des laufenden Eintrags) |
| **Stream Deck** | Tagesarbeitszeit live auf dem Button anzeigen |
| **Dashboard** | Live-Status: aktuelles Projekt, laufender Timer, heutige Gesamtzeit |
| **Dashboard** | Schnellauswahl des aktiven Projekts per Klick |
| **Dashboard** | Statistiken: Stunden nach Projekt, Tätigkeitstyp, Tagesverlauf |
| **Dashboard** | Zeitraum-Auswahl: diese/letzte Woche, dieser/letzter Monat, benutzerdefiniert |
| **Dashboard** | Einträge: manuell anlegen, bearbeiten, löschen |
| **Dashboard** | Projektverwaltung: Name, Kostenstelle, Tätigkeitstyp (Freitext) |
| **Export** | Excel (.xlsx) mit 3 Reitern: Zusammenfassung, Tagesverlauf, Roheinträge |
| **Export** | CSV-Export für den gewählten Zeitraum |
| **Sync** | Vollständige Echtzeit-Synchronisation zwischen Dashboard und Stream Deck via SSE |

---

## Architektur

```
┌─────────────────┐     HTTP/SSE      ┌──────────────────────┐
│  Stream Deck    │ ◄────────────────► │  Node.js Backend     │
│  Plugin (JS)    │                   │  localhost:3847       │
└─────────────────┘                   │                      │
                                      │  backend/data/db.json │
┌─────────────────┐     HTTP/SSE      │  (alle Daten)        │
│  Web Dashboard  │ ◄────────────────► │                      │
│  Browser        │                   └──────────────────────┘
└─────────────────┘
```

- **Backend**: Express.js, läuft lokal, persistiert alles in einer JSON-Datei
- **Stream Deck Plugin**: kommuniziert per HTTP mit dem Backend, empfängt Push-Updates via SSE
- **Dashboard**: Single-Page-App, direkt vom Backend ausgeliefert

---

## Installation

### Voraussetzungen

- [Node.js](https://nodejs.org) (LTS, Version 18+)
- [Elgato Stream Deck Software](https://www.elgato.com/downloads) (Version 6.0+, getestet mit 7.x)

### 1. Backend starten

```bash
cd backend
npm install
node server.js
```

Oder unter Windows per Doppelklick auf **`START_SERVER.bat`** — installiert Abhängigkeiten beim ersten Start automatisch.

Das Backend läuft auf **http://localhost:3847**.  
**Das Fenster muss offen bleiben** solange getrackt wird.

> **Tipp Autostart:** `START_SERVER.bat` als Verknüpfung in den Windows-Autostart-Ordner legen:  
> `Win + R` → `shell:startup`

### 2. Dashboard öffnen

Browser → **http://localhost:3847**

### 3. Stream Deck Plugin installieren

Den Ordner `streamdeck-plugin/de.timetracker.plugin.sdPlugin` kopieren nach:

```
%appdata%\Elgato\StreamDeck\Plugins\de.timetracker.plugin.sdPlugin
```

Stream Deck Software neu starten. Das Plugin erscheint dann unter **„TimeTracker"** in der Aktionsliste.

> ⚠️ Der Ordnername muss exakt `de.timetracker.plugin.sdPlugin` heißen — Stream Deck prüft, dass Ordnername und UUID übereinstimmen.

---

## Stream Deck Buttons konfigurieren

### Verfügbare Aktionen

| Aktion | Funktion |
|---|---|
| **Arbeitstimer** | Ein Klick startet/stoppt die Zeiterfassung. Zeigt ▶ Start / ⏹ Stop. |
| **Projekt** | Aktiviert ein Projekt. Nur eines kann gleichzeitig aktiv sein. Klick auf aktives Projekt deaktiviert es. Bei laufendem Timer: automatischer Split. |
| **Tageszeit** | Zeigt die summierten Arbeitsstunden des Tages live an (HH:MM). Nur Anzeige, kein Klick-Effekt. |

### Projekt-Button einrichten

1. Aktion „Projekt" auf einen Button ziehen
2. Im **Property Inspector** (rechte Seite in der Stream Deck Software):
   - Projekt aus Dropdown wählen (Projekte vorher im Dashboard unter ⚙️ anlegen)
   - Button-Beschriftung wird automatisch befüllt, kann angepasst werden

### Empfohlene Belegung

```
┌─────────────┬─────────────┬─────────────┐
│  Projekt A  │  Projekt B  │  Projekt C  │
├─────────────┼─────────────┼─────────────┤
│  Kostenstelle│            │  Tageszeit  │
│  / Meeting  │             │  ⏱ HH:MM   │
├─────────────┼─────────────┼─────────────┤
│             │             │  ▶ Start /  │
│             │             │  ⏹ Stop    │
└─────────────┴─────────────┴─────────────┘
```

---

## Dashboard

### Seiten

**📊 Dashboard**
- Live-Status des laufenden Timers mit Projektzuordnung
- Schnellauswahl des aktiven Projekts
- Statistiken und Charts für den gewählten Zeitraum
- Zeitraum-Auswahl: Schnellauswahl + benutzerdefinierter Von/Bis-Bereich

**📋 Einträge**
- Alle Zeitbuchungen tabellarisch
- Notizen direkt inline editieren
- Einträge bearbeiten (✏️) oder löschen (🗑)
- Manuell Einträge erfassen
- Excel- und CSV-Export

**⚙️ Konfiguration**
- Projekte anlegen, bearbeiten, löschen
- Felder: Name, Kostenstelle, Tätigkeitstyp (alle Freitext)
- Gespeicherte Projekte erscheinen sofort im Stream Deck Property Inspector

---

## Datenhaltung

Alle Daten werden in einer einzigen JSON-Datei gespeichert:

```
backend/data/db.json
```

**Migration zwischen Versionen:** `db.json` einfach in den `backend/data/`-Ordner der neuen Version kopieren — alle Projekte und Zeiteinträge bleiben erhalten.

**Empfehlung:** `backend/data/` in OneDrive/SharePoint ablegen oder regelmäßig sichern.

---

## Excel-Export

Der Export erzeugt eine `.xlsx`-Datei mit drei Reitern:

| Reiter | Inhalt |
|---|---|
| **Zusammenfassung** | Stunden pro Projekt summiert — fertig zum Übertragen in die Zeiterfassung |
| **Tagesverlauf** | Matrix: Datum × Projekt, Stunden pro Tag und Projekt |
| **Roheintraege** | Alle Einzelbuchungen mit Start, Ende, Dauer, Projekt, Kostenstelle, Tätigkeit |

Der Export berücksichtigt den im Dashboard gewählten Zeitraum.

---

## Projektstruktur

```
timetracker/
├── START_SERVER.bat                          # Windows-Schnellstart
├── backend/
│   ├── package.json
│   ├── server.js                             # Express Backend
│   └── data/
│       └── db.json                           # Datenpersistenz (wird angelegt)
├── streamdeck-plugin/
│   └── de.timetracker.plugin.sdPlugin/
│       ├── manifest.json                     # Plugin-Metadaten
│       ├── plugin.html                       # Einstiegspunkt
│       ├── app.js                            # Plugin-Logik
│       ├── images/                           # Button-Icons
│       └── property_inspector/
│           └── inspector.html                # Button-Konfiguration UI
└── web/
    └── dashboard.html                        # Single-Page-App Dashboard
```

---

## Entwicklung

```bash
# Backend mit Auto-Reload
cd backend && npx nodemon server.js
```

Änderungen an `web/dashboard.html` sind nach Browser-Reload sofort sichtbar.  
Änderungen am Stream Deck Plugin erfordern einen Neustart der Stream Deck Software.

---

## Lizenz

MIT
