# Benutzerverwaltung – Aktive und deaktivierte Konten

## Verhalten

- Startansicht: **Aktive Benutzer** (`profiles.disabled_at IS NULL`).
- Umschalter **Deaktivierte Benutzer**: `profiles.disabled_at IS NOT NULL`.
- Dort bleiben auch Konten sichtbar, deren externe Auth-Sperre noch nicht abgeschlossen ist. Der vorhandene Button **Sperre abschließen** bleibt erreichbar.
- Suchtext, Anzahl und Pagination werden in der Datenbank für die gewählte Ansicht berechnet; Wechsel setzt die Seite auf 1 zurück.
- Konten werden weder gelöscht noch reaktiviert. Reaktivierung ist derzeit **nicht** implementiert.
- Zugriff unverändert nur über die bestehenden Admin-/SuperAdmin-Prüfungen (JWT, Sitzung, Rolle).

## Installation (nach bestehender Deaktivierungs-Ausblendmigration)

1. Im Projektbranch `Uemit` den Patch entpacken.
2. Tests lokal: in `frontend`: `npm.cmd run check`, `npm.cmd run build`, `npx.cmd vitest run src`, `npm.cmd test`; in `supabase`: `npm.cmd test`.
3. Vor SQL-Änderungen am gemeinsamen Produktionsprojekt ein Backup prüfen. Anschließend gesamte SQL-Datei `supabase/proposals/20261028131000_list_disabled_user_accounts.sql` über SQL Editor ausführen. Die bisherige Listenfunktion mit zwei Parametern bleibt erhalten.
4. Edge Function `admin-users` **neu deployen**, da `handler.ts` eine zusätzliche `list_status`-Angabe an die neue SQL-Funktion übermittelt.
5. Frontend neu laden, mit Admin oder SuperAdmin anmelden, beide Ansichten inklusive Suche und Pagination testen.

### Prüf-Abfragen (schreibgeschützt)

```sql
SELECT to_regprocedure('public.inventory_admin_list_users(integer,text,text)') IS NOT NULL
  AS statusfilter_funktion_vorhanden;
```

### Wichtig

Die neue Oberfläche benötigt **sowohl** die SQL-Erweiterung **als auch** die aktualisierte Edge Function. Nur eines von beiden reicht nicht. Reaktivierung und automatisches Löschen sind nicht Teil dieser Änderung.
