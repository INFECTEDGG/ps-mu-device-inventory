# Device Inventory Datenbank

Dieses Verzeichnis enthält die SQL-Skripte für die Supabase-Datenbank sowie automatisierte Tests, die diese Skripte gegen eine lokale PostgreSQL-Instanz prüfen.

## Aufbau

- `migrations/`: frühe SQL-Migrationen, nach Zeitstempel sortiert (Konvention der Supabase CLI)
- `proposals/`: SQL-Vorschläge für die gemeinsame Produktionsdatenbank. Sie werden **nicht automatisch** ausgeführt, sondern nach Review und Backup manuell im Supabase SQL Editor eingespielt.
- `checks/`: rein **lesende** Prüfabfragen (Preflight), die vor dem zugehörigen Proposal ausgeführt werden
- `functions/`: Supabase Edge Functions (z. B. `admin-users`)
- `tests/`: Tests mit [PGlite](https://pglite.dev), einer in Node.js laufenden PostgreSQL-Instanz; Docker oder eine lokale PostgreSQL-Installation sind nicht nötig
- `tests/support/inventoryStack.mjs`: gemeinsames Test-Setup für Geräte, Zuweisungen, Historie und Audit-Log
- `tests/fixtures/inventory-schema.sql`: Nachbildung des in Supabase angelegten Schemas als Testgrundlage

## Proposal einspielen

1. Backup der betroffenen Tabellen sowie der Funktionen und Policies erstellen.
2. Die zugehörige Prüfdatei aus `checks/` im SQL Editor ausführen und das Ergebnis kontrollieren. Diese Abfragen ändern nichts.
3. Das Proposal **vollständig** als ein Skript ausführen. Jedes Proposal läuft in einer Transaktion und prüft zuerst seine Voraussetzungen (`DO $preflight$`). Bei einer Abweichung bricht es mit einer deutschen Fehlermeldung ab, ohne etwas zu ändern.
4. Danach neu anmelden und die Anwendung testen. Erst dann nach `main` mergen, denn `main` wird automatisch auf Vercel veröffentlicht.

### Aktuelle Proposals (Sprint 5)

| Reihenfolge | Prüfdatei | Proposal | Inhalt |
|---|---|---|---|
| 1 | – | `20261123_fix_admin_assign_role_guard.sql` | Sicherheitskorrektur der Rollenzuweisung (Schutz von SuperAdmin und Administratoren) |
| 2 | `pbi-15-audit-log-preflight.sql` | `20261123_pbi_15_audit_log.sql` | Audit-Log (PBI-15, FA-20/FA-21), ersetzt die alten Migrationen vom 24.10.2026 |
| 3 | `pbi-12-device-history-preflight.sql` | `20261123_pbi_12_device_history.sql` | Geräte- und Zuweisungshistorie (PBI-12, FA-14) |

Die drei Proposals sind voneinander unabhängig; die Reihenfolge ist eine Empfehlung. Voraussetzung sind die bereits installierten Proposals für Benutzerverwaltung, SuperAdmin-Berechtigungen, Gerätestatus sowie Zuweisung und Rücknahme (Issues #8, #10, #11). Details stehen in [`docs/pbi-15-audit-log.md`](../docs/pbi-15-audit-log.md) und [`docs/pbi-12-device-history.md`](../docs/pbi-12-device-history.md).

## Tests ausführen

Voraussetzung ist Node.js 22 oder neuer.

```bash
cd supabase
npm install
npm test
```

Die Tests laufen zusätzlich bei jedem Push und Pull Request über GitHub Actions. Teststrategie und Hinweise zum Schreiben neuer Tests stehen in [`docs/testing.md`](../docs/testing.md).

## Audit-Logging und Historie

Aufbau der Tabelle `audit_logs`, protokollierte Aktionen, Manipulationsschutz und Berechtigungen sind in [`docs/sql-tables.md`](../docs/sql-tables.md#7-audit_logs) beschrieben, der Schutz der Gerätehistorie in den Abschnitten zu `assignments` und `device_status_history`.
