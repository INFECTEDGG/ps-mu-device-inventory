# Issue #9 – Geräte suchen und filtern (Aufgabe 7)

## Zweck

Erweiterung der bereits entwickelten Geräteübersicht aus Issue #7 und der Statusverwaltung aus Issue #8. Keine neuen Tabellen und keine Fremdskripte.

## Umfang

- Freitextsuche über Inventarnummer (`asset_tag`), Seriennummer, Gerätetyp, Hersteller (`manufacture`), Modell und Gerätename.
- Filter auf Gerätetyp (Teiltreffer), Status (alle fünf bekannten Werte **und** nicht gesetzt) und aktiv zugewiesenen Mitarbeiter.
- Mehrere Filter werden verknüpft (UND). Die Freitextsuche durchsucht ihre einzelnen Felder mit ODER.
- Filtersuche läuft in Supabase **vor** der Seitennummerierung. Treffermenge stammt aus `count: 'exact'` und ist nicht auf die aktuelle Seite begrenzt.
- Benutzer ohne `devices:view_all` können weiterhin nur ihre aktiv zugewiesenen Geräte sehen und nicht nach anderen Mitarbeitern filtern.
- Eine neue Suche setzt die Seite auf Seite 1 zurück; „Zurücksetzen“ entfernt alle Filter.

## Umsetzung

1. Aus `device_issue8_patch` werden die Dateien `deviceApi.ts`, `DeviceManagementPage.tsx` erweitert. Neues Filter-CSS liegt in `devices-issue9.css`; das vorhandene CSS bleibt erhalten. `DeviceManagementPage.tsx` nutzt neu die separate `DeviceFiltersPanel.tsx`.
2. `deviceFilters.ts` enthält die Filtertypen und die sichere Konstruktion der PostgREST-OR-Abfrage. Keine freie SQL-Interpolation.
3. Die Mitarbeiterauswahl zeigt **nur Personen mit aktiver Zuweisung**. Ist das Profile-RLS eingeschränkt, wird stattdessen eine gekürzte UUID dargestellt. Bei einem Fehler beim Lesen von `assignments` bleibt die Gerätesuche verwendbar, und der Mitarbeiterfilter zeigt einen Hinweis.
4. Alle Leseoperationen unterliegen weiterhin den Supabase-RLS-Policies. **Die UI allein ist keine Zugriffskontrolle.**

## Datenbank-Voraussetzungen

- `public.devices`: `asset_tag`, `serial_number`, `device_type`, `manufacture`, `model`, `name`, `status`, `created_at`, `id`.
- `public.assignments`: `device_id`, `employee_id`, `returned_at`.
- Für das Filtern nach Mitarbeitern müssen berechtigte Benutzer über die bestehenden RLS-Policies aktive Zuweisungen lesen dürfen. Die beigefügte schreibgeschützte Prüfung `supabase/checks/device-filters-preflight.sql` zeigt die bestehenden Policies.
- Falls die Leserechte auf `assignments` noch fehlen, **nicht** RLS deaktivieren oder eine pauschale Freigabe erstellen. Erst mit dem Team eine rollenbasierte SELECT-Policy prüfen und abstimmen.

## Akzeptanztests (lokal vor einem Push nach `main`)

1. Als Admin nach `IT-0003` suchen: genau dieses Gerät muss erscheinen.
2. Status „Defekt“ auswählen: `IT-0003` muss angezeigt werden; andere Status werden ausgeschlossen.
3. `Nicht gesetzt` auswählen: nur Geräte mit `status IS NULL` erscheinen.
4. Gerätetyp als Teilbegriff eingeben: nur passende Geräte erscheinen.
5. Zwei Filter kombinieren: Schnittmenge wird korrekt berechnet. „Zurücksetzen“ zeigt wieder den gesamten berechtigten Bestand.
6. Mitarbeiterfilter: Ohne aktive Zuweisung ist die Liste erwartungsgemäß leer. Nach Umsetzung der Gerätezuweisung (Issue #10) muss die Filterung mit aktiven Zuweisungen getestet werden.
7. Mitarbeiterkonto: nur eigene Geräte; kein Filter für fremde Mitarbeiter.
8. Mehr als zehn Geräte: Pagination soll nur Treffer der aktuellen Suche zählen und anzeigen.
9. `npm.cmd run check`, `npm.cmd run build`, `npx.cmd vitest run src/features/devices/deviceFilters.test.ts` müssen erfolgreich sein.

## Veröffentlichung

Änderungen sind für den lokalen `main`-Arbeitsstand vorgesehen. **Nicht sofort pushen**, weil Vercel `main` automatisch als produktive Anwendung deployed. Erst erfolgreiche lokale und rollenbasierte Tests, anschließend abgestimmter Push.
