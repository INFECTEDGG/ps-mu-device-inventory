# Device Inventory Datenbank

Dieses Verzeichnis enthält die SQL-Migrationen für die Supabase-Datenbank sowie automatisierte Tests, die die Migrationen gegen eine lokale PostgreSQL-Instanz prüfen.

## Aufbau

- `migrations/`: SQL-Migrationen, nach Zeitstempel sortiert (Konvention der Supabase CLI)
- `tests/`: Tests mit [PGlite](https://pglite.dev), einer in Node.js laufenden PostgreSQL-Instanz; Docker oder eine lokale PostgreSQL-Installation sind nicht nötig
- `tests/helpers.mjs`: gemeinsame Hilfsfunktionen für Testdatenbank, Benutzersitzungen und Testdaten
- `tests/fixtures/base-schema.sql`: Nachbildung des in Supabase angelegten Schemas (Issue #21) als Testgrundlage

## Migration einspielen

Im Supabase-Dashboard unter **SQL Editor** den Inhalt der jeweiligen Migrationsdatei ausführen. Mit der Supabase CLI ist alternativ `supabase db push` möglich.

Die Migrationen können erneut ausgeführt werden, ohne Daten oder Trigger zu duplizieren.

## Tests ausführen

Voraussetzung ist eine aktuelle Node.js-Version.

```bash
cd supabase
npm install
npm test
```

Die Tests laufen zusätzlich bei jedem Push und Pull Request über GitHub Actions. Teststrategie und Hinweise zum Schreiben neuer Tests stehen in [`docs/testing.md`](../docs/testing.md).

## Audit-Logging

Aufbau der Tabelle `audit_logs`, protokollierte Aktionen und Berechtigungen sind in [`docs/sql-tables.md`](../docs/sql-tables.md#7-audit_logs) beschrieben.
