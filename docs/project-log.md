# Project Log – Device Inventory

In diesem Dokument werden wichtige Entscheidungen, Änderungen und Ergebnisse
aus den Sprint-Terminen dokumentiert.

Ziel ist es, den aktuellen Projektstand für alle Teammitglieder nachvollziehbar
zu halten. Insbesondere Teammitglieder, die bei einem Termin nicht anwesend
waren, können hier relevante Änderungen nachlesen.

---

## 16.10.2026

### Teilnehmer

- Maximilian Stephan (223702)
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

Das initiale Datenmodell wurde in Supabase umgesetzt.

Folgende zentrale Tabellen wurden erstellt:

- `roles`
- `profiles`
- `devices`
- `assignments`
- `device_status_history`
- `audit_logs`

Die notwendigen Foreign-Key-Beziehungen zwischen den Tabellen wurden
eingerichtet.

Unter anderem bestehen folgende Beziehungen:

- `profiles` ist mit `auth.users` von Supabase Auth verknüpft.
- `profiles` ist über `role_id` mit `roles` verknüpft.
- `assignments` ist mit `devices` und `profiles` verknüpft.
- `device_status_history` ist mit `devices` und `profiles` verknüpft.
- `audit_logs` ist mit `profiles` verknüpft.

Zusätzlich wurden Constraints zur Sicherstellung der Datenintegrität
eingerichtet:

- Pro Gerät kann nur eine aktive Zuweisung existieren.
- Ein Rückgabedatum darf nicht vor dem Zuweisungsdatum liegen.
- Gerätestatus sind auf die definierten Statuswerte beschränkt.
- Die Statushistorie verwendet dieselben definierten Statuswerte.

Folgende initiale Rollen wurden angelegt:

- `admin`
- `device_manager`
- `employee`

Damit ist die grundlegende Datenbankstruktur für den aktuellen
Projektumfang fertiggestellt.

### Aktueller Stand

Die Anforderungen und das grundlegende Datenmodell wurden definiert.

Die PostgreSQL-Datenbank wurde über Supabase eingerichtet und die zentralen
Tabellen, Beziehungen, Constraints und Rollen wurden angelegt.

Die eigentliche Webanwendung wurde noch nicht implementiert. Aktuell existiert
noch keine Benutzeroberfläche und die Backend-Technologie wurde noch nicht
abschließend festgelegt.

Sprint 1 wurde vollständig abgeschlossen.

### Nächste Schritte

- Backend-Technologie festlegen
- React-/TypeScript-Projekt aufsetzen
- grundlegende Projektstruktur für Frontend und Backend erstellen
- Verbindung zwischen Anwendung und Supabase herstellen
- ersten End-to-End-Datenzugriff implementieren
- Datenmodell mit Testdaten testen
- Authentifizierung und Rollenmodell in die Anwendung integrieren

### Probleme / offene Fragen

- Welche Technologie wird für das Backend verwendet?
- Wie wird die Anwendung zwischen Frontend, Backend und Supabase aufgeteilt?
- Wie wird das Deployment der einzelnen Anwendungskomponenten umgesetzt?

---

## 23.10.2026

### Teilnehmer

- Maximilian Stephan (223702)
- Manuel Pflaum (219241)
- Guilliermo Morishige-Takane (224921)


### Entscheidungen

- Audit Log einheitlich in Device Page und einen generellen Audit Log für global.

### Änderungen / Fortschritt

- Offizieller Start von Sprint 2 (Benutzer & Authentifizierung	Login/Logout, Benutzerverwaltung, Rollen und Berechtigungen)
- Datenbank auf Supabase wurde in https://github.com/INFECTEDGG/ps-mu-device-inventory/issues/21 erstellt.
- Erster Frontend Entwurf wurde erstellt und läuft produktiv unter [PS-MU-Device-Inventory](https://ps-mu-device-inventory.vercel.app)


### Probleme / offene Fragen

- An der Präsentation ist jeder für seinen hochgeladenen Code verantwortlich und soll diesen erklären können.

### Nächste Schritte

- Sprint 2 abschließen

---

## DD.MM.YYYY

### Teilnehmer

- ...

### Entscheidungen

- ...

### Änderungen / Fortschritt

- ...

### Probleme / offene Fragen

- ...

### Nächste Schritte

- ...