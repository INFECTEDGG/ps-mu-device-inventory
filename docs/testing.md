# Teststrategie – Device Inventory

## 1. Ziel

Gemäß **NFA-13** werden die zentralen Geschäftsprozesse des Device Inventory, insbesondere Gerätezuweisung und Rückgabe, durch automatisierte Tests abgesichert. Die Tests sind reproduzierbar ausführbar und laufen bei jeder Änderung automatisch, damit Fehler frühzeitig erkannt werden.

---

## 2. Überblick

| Bereich | Prüft | Werkzeug | Ort | Befehl |
|---|---|---|---|---|
| Datenbank | Migrationen, Proposals, Trigger, RPCs und Berechtigungen | Node.js Test Runner und [PGlite](https://pglite.dev) | `supabase/tests/` | `cd supabase && npm test` |
| Frontend: Typen und Build | Typprüfung und Produktions-Build | TypeScript und Vite | `frontend/` | `cd frontend && npm run build` |
| Frontend: Sitzung und Anmeldung | Sitzungs-, Login- und Admin-Logik | Node.js Test Runner | `frontend/tests/` | `cd frontend && npm test` |
| Frontend: Komponenten und Module | Seiten, API-Validierung, Formatierung, Zugriffsregeln | Vitest und Testing Library (jsdom) | `frontend/src/**/*.test.ts(x)` | `cd frontend && npx vitest run src` |

PGlite ist eine vollständige PostgreSQL-Instanz, die direkt in Node.js läuft. Für die Datenbanktests sind daher weder Docker noch eine lokale PostgreSQL-Installation oder Zugangsdaten zu Supabase nötig. Jeder Test erhält eine eigene, frisch aufgesetzte Datenbank.

---

## 3. Automatische Ausführung

Der GitHub-Actions-Workflow [`.github/workflows/tests.yml`](../.github/workflows/tests.yml) führt alle Bereiche bei jedem Push und bei jedem Pull Request gegen `main` aus. Das Ergebnis erscheint im Pull Request unter **Checks** sowie im Reiter **Actions** des Repositorys.

Ein Pull Request mit fehlgeschlagenen Tests sollte erst nach der Fehlerbehebung gemergt werden.

---

## 4. Aktuell abgedeckte Anforderungen (Datenbank)

| Anforderung | Geprüftes Verhalten | Testdatei |
|---|---|---|
| **FA-04** | Mitarbeiter dürfen weder zuweisen noch zurücknehmen | `assignments.test.mjs` |
| **FA-07** | Gerätestatus und Statushistorie lassen nur die definierten Werte zu | `assignments.test.mjs` |
| **FA-08** | Nur Geräte mit Status `available` können zugewiesen werden | `assignments.test.mjs` |
| **FA-09** | Gerät, Mitarbeiter, Zeitpunkt und ausführender Benutzer werden gespeichert | `assignments.test.mjs` |
| **FA-10** | Nach der Zuweisung hat das Gerät den Status `assigned` | `assignments.test.mjs` |
| **FA-11**, **FA-12** | Die Rücknahme speichert Zeitpunkt und ausführenden Benutzer und beendet die Zuweisung | `assignments.test.mjs` |
| **FA-13** | Nach der Rücknahme ist das Gerät wieder `available` und erneut zuweisbar | `assignments.test.mjs` |
| **FA-14** | Jede Statusänderung erscheint in der Statushistorie; abgeschlossene Zuweisungen bleiben nach der Rückgabe erhalten | `assignments.test.mjs` |
| **FA-20** | Alle relevanten Aktionen werden mit Benutzer, Aktion, Objekt und Zeitpunkt protokolliert, auch ohne Benutzersitzung („System“) | `auditLog.test.mjs` |
| **FA-21** | Nur aktive Benutzer mit `audit:view` (standardmäßig Administratoren und SuperAdmins) lesen das Audit-Log; Vergabe und Entzug durch den SuperAdmin; Filter, Suche und Seiten | `auditLog.test.mjs` |
| **NFA-05** | Pro Gerät höchstens eine aktive Zuweisung; mehrere Geräte pro Mitarbeiter möglich | `assignments.test.mjs` |
| **NFA-06** | Eine fehlgeschlagene Zuweisung hinterlässt keine Teildaten; bei einem Rollback entfällt auch der Audit-Eintrag | `assignments.test.mjs`, `auditLog.test.mjs` |
| Datenintegrität (Project Log vom 16.10.2026) | Ein Rückgabezeitpunkt liegt nie vor dem Zuweisungszeitpunkt | `assignments.test.mjs` |
| Manipulationsschutz | Audit-Einträge können weder geändert noch gelöscht werden, auch nicht vom Datenbankbesitzer | `auditLog.test.mjs` |
| Installation | Das Audit-Log-Proposal verweigert eine zweite Ausführung und installiert sich auch auf einer Datenbank mit den alten Audit-Migrationen vom 24.10.2026 | `auditLog.test.mjs` |

Die übrigen Testdateien (`authReadPolicies`, `employeeProfiles`, `serverSessionInactivity`, `userManagement`, `hiddenDeactivatedUsers`, `listDisabledUsers`, `superAdminPermissions`) prüfen Anmeldung, Sitzungen, Benutzer- und Rollenverwaltung.

---

## 5. Noch offene Testfälle

- Frontend und Datenbank werden getrennt getestet. Ein End-to-End-Test gegen eine echte Supabase-Instanz (Browser → PostgREST → Datenbank) fehlt noch.
- Die Supabase Edge Function `admin-users` wird nur über ihre Handler-Logik getestet (`frontend/tests/adminUsers.test.mjs`).

---

## 6. Neue Datenbanktests schreiben

Neue Testdateien werden als `supabase/tests/<thema>.test.mjs` angelegt und automatisch gefunden. Tests für Geräte, Zuweisungen und Audit-Log verwenden das gemeinsame Test-Setup `supabase/tests/support/inventoryStack.mjs`. Es baut die Schema-Nachbildung `tests/fixtures/inventory-schema.sql` auf und spielt danach alle Migrationen und Proposals in der Produktionsreihenfolge ein.

| Hilfsfunktion | Zweck |
|---|---|
| `useInventoryStack()` | Baut die Datenbank einmal pro Datei als Vorlage auf und liefert `createDatabase(t)`, das jedem Test eine eigene Kopie gibt |
| `users` | Testbenutzer: `superAdmin`, `admin`, `manager`, `employee`, `employee2` (jeweils mit Profil und aktiver Serversitzung) |
| `asUser(db, user, sql, params)` | Führt SQL wie ein angemeldeter Benutzer über die Supabase-API aus (JWT-Claims inkl. Sitzung, Rolle `authenticated`) |
| `asAnon(db, sql, params)` | Führt SQL ohne Anmeldung aus |
| `asService(db, sql, params)` | Führt SQL wie ein Backend mit Service-Key ohne Benutzersitzung aus |
| `createDevice`, `setStatus`, `assign`, `returnAssignment` | Legen Testdaten über die echten Tabellen und RPCs an |
| `readAudit(db)` | Liest alle Audit-Einträge (als Datenbankbesitzer) |
| `errorCodes` | PostgreSQL-Fehlercodes für erwartete Fehler |

```js
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assign, createDevice, errorCodes, useInventoryStack, users } from './support/inventoryStack.mjs'

const createDatabase = useInventoryStack()

test('NFA-05: pro Gerät höchstens eine aktive Zuweisung', async (t) => {
  const db = await createDatabase(t)
  const deviceId = await createDevice(db)
  await assign(db, deviceId, users.employee)

  await assert.rejects(assign(db, deviceId, users.employee2), { code: errorCodes.checkViolation })
})
```

Erwartete Fehler werden über den PostgreSQL-Fehlercode geprüft und nicht über den Namen eines Constraints, da die Namen in Supabase abweichen können.

---

## 7. Grenzen

Die Datenbanktests laufen gegen `supabase/tests/fixtures/inventory-schema.sql`. Diese Datei bildet das in Supabase angelegte Schema anhand des Project Logs, von `docs/sql-tables.md` und der Preflight-Prüfungen der Proposals nach. Abweichungen zwischen dieser Nachbildung und der echten Datenbank, etwa bei Datentypen, Constraints oder Löschregeln der Fremdschlüssel, erkennen die Tests nicht. Vor der Installation eines Proposals prüfen deshalb die lesenden Abfragen in `supabase/checks/` die echte Datenbank.

Sobald ein Export des echten Schemas vorliegt (Supabase-Dashboard: **Table Editor** → Tabelle → **Definition**, oder `supabase db dump`), sollte er die Nachbildung ersetzen.

Supabase-spezifisches Verhalten wird nur nachgestellt:

- die Rollen `anon`, `authenticated` und `service_role`,
- die Funktionen `auth.jwt()` und `auth.uid()`,
- die Tabellen `auth.users` und `auth.sessions`.

Anmeldung, PostgREST und Edge Functions selbst werden nicht getestet.
