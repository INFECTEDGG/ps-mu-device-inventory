# Device Inventory – Zuweisungsübersicht und Rücknahme (#10 und #11)

## Zweck

Der bereits vorhandene Navigationspunkt **Zuweisungen** zeigt jetzt aktive und zurückgegebene Gerätezuweisungen, einschließlich Inventarnummer, Mitarbeiter und Datum. Berechtigte Admins, SuperAdmins und Gerätemanager können eine aktive Zuweisung mit Bestätigung zurücknehmen. Für eine neue Zuweisung führt der Button zurück zur Geräteverwaltung, wo das Formular aus Issue #10 bereits existiert.

## Änderungen

- Frontend: `AssignmentManagementPage.tsx`, `assignmentOverviewApi.ts`, `assignments.css`, `assignmentOverviewApi.test.ts`.
- Navigation: `/zuweisungen` erhält die echte Seite anstelle des Platzhalters (`App.tsx`).
- SQL: `inventory_assignments_overview(text, integer)` liefert paginierte Datensätze und getrennte Zähler; `inventory_return_device(uuid)` führt Rücknahme, Statuswechsel und Historie **atomar** durch.
- Rechte: Alle lesenden Benutzer sehen nur ihre eigenen Zuweisungen, sofern sie kein serverseitig geprüftes `assignments:view_all` besitzen. Mitarbeiter können nichts zurücknehmen. Schreibvorgänge sind auf `assignments:manage` sowie Admin-/Gerätemanager-Rollen begrenzt.
- Die Tabelle `assignments` bleibt erhalten; abgeschlossene Datensätze werden **nicht gelöscht**. `returned_at` und `returned_by` dokumentieren die Rücknahme. Der neue Gerätestatus ist `available`.

## Wichtig vor der Installation

1. Die Dateien aus Issue #10 müssen bereits lokal vorliegen; die zugehörigen Supabase-Funktionen wurden zuvor installiert.
2. SQL-Datei `supabase/checks/issue-11-returns-preflight.sql` **schreibgeschützt** ausführen und kontrollieren, insbesondere `assignments.returned_by`.
3. Nach Backup und Review die SQL-Datei `supabase/proposals/20261115_issue_11_return_and_assignment_overview.sql` in Supabase manuell ausführen. Sie prüft vorhandene Funktionen und legt zwei neue RPCs an. Die SQL-Datei läuft in einer Transaktion.
4. Erst dann die Anwendung lokal testen. Die SQL-Datei wirkt sofort auf die gemeinsame Supabase-Datenbank, auch wenn der Frontend-Patch noch nicht nach GitHub gepusht ist.

## Lokaler Test

- Unter `http://localhost:28216/zuweisungen` muss **IT-0003** als aktiv erscheinen, sofern die Zuweisung noch besteht.
- Als Admin/SuperAdmin oder Gerätemanager die Zuweisung zurücknehmen und bestätigen. Danach muss IT-0003 wieder den Status **Verfügbar** haben.
- Unter „Zurückgegeben“ müssen der ursprüngliche Mitarbeiter und die Rückgabezeit zu sehen sein.
- Im SQL Editor prüfen: `assignments.returned_at` und `returned_by` gesetzt; ein neuer Eintrag in `device_status_history` mit `assigned → available` vorhanden.
- Als Mitarbeiter prüfen: nur eigene Datensätze sichtbar; kein Rücknahme-Button. Als Gerätemanager testen: Rücknahme erlaubt.
- Doppeltes Zurücknehmen muss serverseitig fehlschlagen. Kein `git push` vor Tests.

## Automatisierte Tests

Im `frontend`-Verzeichnis:

```powershell
npm.cmd run check
npm.cmd run build
npm.cmd test
npx.cmd vitest run src
```

Die manuelle DB- und Rollenprüfung kann nicht durch die Frontend-Tests ersetzt werden.
