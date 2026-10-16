# Project Log – Device Inventory

In diesem Dokument werden wichtige Entscheidungen, Änderungen und Ergebnisse
aus den Sprint-Terminen dokumentiert.

Ziel ist es, den aktuellen Projektstand für alle Teammitglieder nachvollziehbar
zu halten. Insbesondere Teammitglieder, die bei einem Termin nicht anwesend
waren, können hier relevante Änderungen nachlesen.

---

## 16.10.2026

### Teilnehmer

- Maximilian Stephan
- Louis Sämann (223519)
- Tom Jarolim (222880)
- Manuel Pflaum (219241)
- Ali Ahmad (227308)
- Guilliermo Morishige-Takane (224921)

### Entscheidungen

#### Wechsel des Technologie-Stacks

Der ursprünglich geplante Einsatz von Python mit Flask wird nicht weiterverfolgt.

Das Projekt wird stattdessen mit folgendem Technologie-Stack umgesetzt:

- Frontend: React
- Programmiersprache: TypeScript
- Datenbank: PostgreSQL über Supabase
- Backend: noch festzulegen
- Hosting: Vercel

**Begründung:**

React und TypeScript wurden als gemeinsamer Technologie-Stack für die weitere
Entwicklung ausgewählt. Dadurch soll insbesondere die Entwicklung einer
modernen webbasierten Benutzeroberfläche unterstützt werden.

### Datenbank

Das initiale Datenmodell wurde in Supabase angelegt.

Folgende Tabellen wurden erstellt:

- `roles`
- `profiles`
- `devices`
- `assignments`
- `device_status_history`
- `audit_logs`

Die Foreign-Key-Beziehungen und Constraints werden im nächsten Schritt
konfiguriert.

### Nächste Schritte

- Foreign-Key-Beziehungen konfigurieren
- Constraints der Datenbank definieren
- initiale Rollen anlegen
- Datenmodell testen
- Backend-Technologie festlegen

---

## DD.MM.YYYY

### Teilnehmer

- ...

### Entscheidungen

- ...

### Änderungen

- ...

### Probleme / offene Fragen

- ...

### Nächste Schritte

- ...