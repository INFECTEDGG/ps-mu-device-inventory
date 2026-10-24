# Teststrategie – Device Inventory

## 1. Ziel

Gemäß **NFA-13** werden die zentralen Geschäftsprozesse des Device Inventory, insbesondere Gerätezuweisung und Rückgabe, durch automatisierte Tests abgesichert. Die Tests sind reproduzierbar ausführbar und laufen bei jeder Änderung automatisch, damit Fehler frühzeitig erkannt werden.

---

## 2. Überblick

| Bereich | Prüft | Werkzeug | Ort | Befehl |
|---|---|---|---|---|
| Datenbank | Constraints, Trigger und Berechtigungen | Node.js Test Runner und [PGlite](https://pglite.dev) | `supabase/tests/` | `cd supabase && npm test` |
| Frontend | Typprüfung und Produktions-Build | TypeScript und Vite | `frontend/` | `cd frontend && npm run build` |

PGlite ist eine vollständige PostgreSQL-Instanz, die direkt in Node.js läuft. Für die Datenbanktests sind daher weder Docker noch eine lokale PostgreSQL-Installation oder Zugangsdaten zu Supabase nötig. Jeder Test erhält eine eigene, frisch aufgesetzte Datenbank.

---

## 3. Automatische Ausführung

Der GitHub-Actions-Workflow [`.github/workflows/tests.yml`](../.github/workflows/tests.yml) führt beide Bereiche bei jedem Push und bei jedem Pull Request gegen `main` aus. Das Ergebnis erscheint im Pull Request unter **Checks** sowie im Reiter **Actions** des Repositorys.

Ein Pull Request mit fehlgeschlagenen Tests sollte erst nach der Fehlerbehebung gemergt werden.

---

## 4. Aktuell abgedeckte Anforderungen

| Anforderung | Geprüftes Verhalten | Testdatei |
|---|---|---|
| **NFA-05** | Ein Gerät hat höchstens eine aktive Zuweisung; nach der Rückgabe ist eine neue Zuweisung möglich | `assignments.test.mjs` |
| Datenintegrität (Project Log vom 16.10.2026) | Ein Rückgabezeitpunkt darf nicht vor dem Zuweisungszeitpunkt liegen | `assignments.test.mjs` |
| **FA-14** | Abgeschlossene Zuweisungen bleiben nach der Rückgabe erhalten | `assignments.test.mjs` |
| **FA-07** | Gerätestatus und Statushistorie lassen nur die definierten Statuswerte zu | `assignments.test.mjs` |
| **FA-20** | Relevante Änderungen werden mit Benutzer, Aktion und Zeitpunkt protokolliert | `audit-logging.test.mjs` |
| **FA-21** | Nur Administratoren können das Audit-Log lesen | `audit-logging.test.mjs` |
| **NFA-06** | Bei einem Rollback wird auch der Audit-Eintrag verworfen | `audit-logging.test.mjs` |

---

## 5. Noch offene Testfälle

Zuweisung und Rückgabe (Issues #10 und #11) sind noch nicht implementiert. Die folgenden Testfälle werden zusammen mit der jeweiligen Umsetzung ergänzt:

- Nur Geräte mit Status `available` können zugewiesen werden (FA-08).
- Gerät, Mitarbeiter, Zeitpunkt und durchführender Benutzer werden gespeichert (FA-09).
- Nach der Zuweisung hat das Gerät den Status `assigned` (FA-10).
- Die Rückgabe speichert den Rückgabezeitpunkt und beendet die aktive Zuweisung (FA-11, FA-12).
- Nach der Rückgabe ist das Gerät wieder `available`, sofern kein Defekt oder Wartungsfall vorliegt (FA-13).
- Jede Statusänderung erscheint in der Statushistorie (FA-14).
- Alle Änderungen eines Vorgangs werden vollständig oder gar nicht gespeichert (NFA-06).
- Nur Gerätemanager und Administratoren dürfen zuweisen und zurücknehmen (FA-04).

Wird die Logik in der Datenbank umgesetzt (Funktionen oder Trigger), gehören die Tests nach `supabase/tests/`. Für ein separates Backend wird das Test-Setup zusammen mit der Wahl der Backend-Technologie festgelegt und in diesen Workflow aufgenommen.

---

## 6. Neue Datenbanktests schreiben

Neue Testdateien werden als `supabase/tests/<thema>.test.mjs` angelegt und automatisch gefunden. Gemeinsame Hilfsfunktionen liegen in `supabase/tests/helpers.mjs`:

| Hilfsfunktion | Zweck |
|---|---|
| `useTestDatabase()` | Baut Schema, Migrationen und Testbenutzer einmal pro Datei auf und liefert `createDatabase(t)`, das jedem Test eine eigene Kopie gibt |
| `asUser(db, user, sql, params)` | Führt SQL wie ein angemeldeter Benutzer über die Supabase-API aus |
| `asAnon(db, sql, params)` | Führt SQL ohne Anmeldung aus |
| `asService(db, sql, params)` | Führt SQL wie ein Backend mit Service-Key aus |
| `users` | Testbenutzer mit den Rollen `admin`, `device_manager` und `employee` |
| `createDevice`, `assignDevice`, `returnDevice` | Legen Testdaten an |
| `errorCodes` | PostgreSQL-Fehlercodes für erwartete Fehler |

```js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assignDevice, createDevice, errorCodes, useTestDatabase, users } from './helpers.mjs'

const createDatabase = useTestDatabase()

test('erlaubt pro Gerät nur eine aktive Zuweisung (NFA-05)', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await assignDevice(db, deviceId)

  await assert.rejects(assignDevice(db, deviceId, users.admin), { code: errorCodes.uniqueViolation })
})
```

Erwartete Fehler werden über den PostgreSQL-Fehlercode geprüft und nicht über den Namen eines Constraints, da die Namen in Supabase abweichen können.

---

## 7. Grenzen

Die Datenbanktests laufen gegen `supabase/tests/fixtures/base-schema.sql`. Diese Datei bildet das in Supabase angelegte Schema anhand der in Issue #21 dokumentierten Spalten nach. Abweichungen zwischen dieser Nachbildung und der echten Datenbank, etwa bei Datentypen oder Constraints, erkennen die Tests nicht.

Sobald ein Export des echten Schemas vorliegt (Supabase-Dashboard: **Table Editor** → Tabelle → **Definition**, oder `supabase db dump`), sollte er die Nachbildung ersetzen.

Supabase-spezifisches Verhalten wird nur nachgestellt: die Rollen `anon`, `authenticated` und `service_role` sowie die Funktion `auth.uid()`. Anmeldung und Supabase-API selbst werden nicht getestet.
