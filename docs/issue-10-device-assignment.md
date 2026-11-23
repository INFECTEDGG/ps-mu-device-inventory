# Issue #10 – Gerät einem Mitarbeiter zuweisen

## Umfang

Erweiterung der bestehenden Geräteverwaltung. Es gibt **keine neue Gerätetabelle**.
Der Vorgang nutzt `public.devices`, `public.assignments`, `public.profiles`,
`public.roles` und `public.device_status_history`.

- Button **Zuweisen** nur für Geräte mit Status `available`.
- Nur Admin, SuperAdmin und Gerätemanager mit `assignments:manage` dürfen zuweisen.
- Mitarbeiterauswahl enthält ausschließlich aktive Konten mit Rolle `employee`.
- Der Server prüft Session, Rolle und dynamische Berechtigung erneut.
- Transaktion: Gerätezeile sperren, Zuordnung anlegen, Status `assigned` setzen,
  Statushistorie schreiben. Bei einem Fehler erfolgt ein vollständiger Rollback.
- Eindeutiger partieller Index verhindert zwei aktive Zuweisungen desselben Geräts.
- Der Browser schreibt nicht direkt in `assignments` oder `devices.status`.
- Mitarbeiter dürfen nur Geräte eigener aktiver Zuweisungen sehen.

## Installation / Freigabe

1. **Noch nicht pushen:** `main` wird automatisch auf Vercel veröffentlicht.
2. Dateien aus diesem Patch im Projektstamm entpacken; vorhandene lokale
   Änderungen zuvor mit `git status -sb` prüfen.
3. In `frontend` mit `npm.cmd run check`, `npm.cmd run build`,
   `npm.cmd test`, `npx.cmd vitest run src` testen.
4. Vor produktiver Datenbankänderung Backup der Geräte und der DB-Struktur/
   RLS-Policies erstellen und im Team abstimmen. Die CSV der Geräte allein
   sichert keine Datenbankfunktionen oder Policies.
5. `supabase/checks/issue-10-assignment-preflight.sql` im Supabase SQL Editor
   *lesend* ausführen; Tabellen und bestehende Policies prüfen.
6. Erst danach `supabase/proposals/20261115_issue_10_assign_device.sql`
   **vollständig** als Transaktion im SQL Editor ausführen.
   Die Datei ist kein Auto-Migrationsskript; sie wird nicht durch einen Git-Push installiert.
7. Erneut anmelden, lokalen Entwicklungsserver starten und testen.
8. Erst nach erfolgreichem Test committen und `main` pushen.

## Manueller Funktionstest

1. Admin/SuperAdmin anmelden, ein **Testgerät** in den Status **Verfügbar** setzen.
   (`NULL`, `defective`, `maintenance`, `retired` und `assigned` sind nicht zuweisbar.)
2. **Zuweisen** klicken, einen aktiven Mitarbeiter auswählen, bestätigen.
3. Gerät zeigt nach Neuladen **Zugewiesen**. Die Mitarbeiterfilter-Auswahl
   enthält jetzt den zugewiesenen Mitarbeiter.
4. Supabase SQL Editor (nur lesen):

```sql
SELECT d.asset_tag, d.status, a.employee_id, a.assigned_by, a.assigned_at,
       a.returned_at
FROM public.assignments a JOIN public.devices d ON d.id=a.device_id
WHERE d.asset_tag='IT-0001' ORDER BY a.assigned_at DESC;
```

```sql
SELECT d.asset_tag, h.old_status, h.new_status, h.changed_by, h.changed_at
FROM public.device_status_history h JOIN public.devices d ON d.id=h.device_id
WHERE d.asset_tag='IT-0001' ORDER BY h.changed_at DESC;
```

5. Prüfen, dass erneutes Zuweisen desselben Geräts nicht möglich ist.
6. Gerätemanager anmelden: Zuweisung möglich, Stammdaten bearbeiten nicht.
7. Mitarbeiter anmelden: eigene Geräte sichtbar; keine Zuweisungsaktion.
8. Deaktiviertes Mitarbeiterkonto erscheint nicht in der Auswahl.

> **Hinweis:** Rücknahme ist bewusst **nicht** Teil dieses Issues, sondern
> Aufgabe 9 / GitHub-Issue #11. Bestehende aktive Zuweisungen nicht manuell
> in Supabase löschen: Das würde Status und Historie inkonsistent machen.
