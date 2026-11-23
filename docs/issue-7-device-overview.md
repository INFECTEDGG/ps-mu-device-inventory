# Issue #7 – Gerätedaten anzeigen und bearbeiten

## Ziel
Erweitert das bereits vorhandene Formular "Gerät anlegen" auf der Seite `/geraete` um
Geräteübersicht (10 pro Seite), Detailanzeige und Bearbeitung von Stammdaten.

## Technische Umsetzung
- `frontend/src/features/devices/DeviceManagementPage.tsx` – React-Komponente, Anzeige und Formular
- `frontend/src/features/devices/deviceApi.ts` – Lesen und Schreiben über Supabase
- `frontend/src/features/devices/devices-issue7.css` – Zusätzliche Styles
- Bestehende `devices.css` bleibt unverändert.
- Keine zusätzlichen NPM-Pakete, keine Datenbanktabellen oder SQL-Migrationen.
- Gerätestatus wird nur angezeigt, nicht geändert (Issue #8).

## Berechtigungen
- Lesen: `devices:view_own`, `devices:view_all`, `devices:manage`
- Bearbeiten und Anlegen: `devices:manage`
- Mitarbeiter: Die Geräte-IDs werden über aktive Einträge in `assignments`
  (`employee_id = auth.uid()` und `returned_at IS NULL`) ermittelt.
- Supabase RLS muss serverseitig nach Rollen, Kontostatus und Sitzung
  absichern. Eine Frontend-Rechteprüfung ist kein Ersatz für RLS.

## Vor der Übernahme
1. Aktuellen `main` aktualisieren und `git status -sb` prüfen.
2. Alte DeviceManagementPage.tsx und deviceApi.ts mit der Patch-Version ersetzen.
3. Neue devices-issue7.css und diese Dokumentation hinzufügen.
4. Im `frontend`-Ordner `npm.cmd run check`, `npm.cmd run build`,
   `npx.cmd vitest run src`, `npm.cmd test` starten.
5. Im Browser als Admin und Employee testen, insbesondere RLS-Fehler.
6. Direkte Supabase-API-Aufrufe als Employee dürfen keine fremden
   Geräte/Stammdaten zurückliefern und dürfen keine UPDATE-Rechte haben.
7. Erst nach erfolgreichem Test auf `main` committen und pushen.

## Achtung – Datenbankschema
Die bestehende Implementierung schreibt `manufacture` (nicht `manufacturer`).
Dieser Patch übernimmt den vorhandenen Spaltennamen. Das tatsächliche
Supabase-Schema sollte vor Produktiveinsatz auf Konsistenz geprüft werden.
Eine Änderung von `public.devices` ist NICHT Teil dieses Patches.
