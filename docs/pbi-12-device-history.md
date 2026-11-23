# PBI-12 – Geräte- und Zuweisungshistorie anzeigen

**Anforderungen:** FA-14 · **Priorität:** Must

> Als Gerätemanager möchte ich die Historie eines Gerätes einsehen können, damit vergangene Zuweisungen und Statusänderungen nachvollziehbar sind.

## Akzeptanzkriterien und Umsetzung

| Akzeptanzkriterium | Umsetzung |
|---|---|
| Vergangene Zuweisungen werden angezeigt. | Gerätedetails → **Gerätehistorie** → **Zuweisungshistorie**: aktive und abgeschlossene Zuweisungen, neueste zuerst |
| Beginn und Ende einer Zuweisung werden angezeigt. | Spalten **Beginn** und **Ende** (aktive Zuweisung: „Aktiv“) sowie **Dauer** |
| Zugewiesene Mitarbeiter werden angezeigt. | Spalte **Mitarbeiter** mit Name und E-Mail, dazu **Ausgegeben von** und **Zurückgenommen von** |
| Relevante Statusänderungen werden nachvollziehbar dargestellt. | **Statusverlauf**: Zeitpunkt, „alter Status → neuer Status“, **Geändert von** (ohne Benutzer „System“) |
| Historische Daten bleiben nach einer Rückgabe erhalten. | Abgeschlossene Zuweisungen bleiben sichtbar. Trigger verhindern das Ändern abgeschlossener Zuweisungen sowie das Löschen von Zuweisungen und Statushistorie, auch für den Datenbankbesitzer. |

## Rollen und Rechte

| Aktion | SuperAdmin | Admin | Gerätemanager | Mitarbeiter |
|---|---|---|---|---|
| Gerätehistorie ansehen | Ja | Ja | Ja | Nein |
| Änderungsprotokoll des Gerätes (Audit-Log) | Ja | Ja | Nein | Nein |
| Historie ändern oder löschen | Nein | Nein | Nein | Nein |

Serverseitig prüft `inventory_device_history`:

- aktives Konto und aktive Sitzung,
- Rolle `device_manager`, `admin` oder `super_admin`,
- die Berechtigungen `devices:view_all` und `assignments:view_all`.

Die Oberfläche spiegelt diese Regel (`deviceHistoryRules.ts`).

## Änderungen

**Datenbank**

- `supabase/proposals/20261123_pbi_12_device_history.sql`:
  - RPC `inventory_device_history(uuid)`
  - Indizes
  - erneuter Entzug direkter Schreibrechte auf `assignments` und `device_status_history`
  - Trigger zum Schutz der Historie
- `supabase/checks/pbi-12-device-history-preflight.sql`: lesende Prüfung vor der Installation

**Frontend**

- `frontend/src/features/devices/`:
  - `DeviceHistoryPanel.tsx`
  - `deviceHistoryApi.ts` (Antwortprüfung)
  - `deviceHistoryRules.ts` (Zugriffsregeln, Dauer, Zähler)
  - `deviceStatusLabels.ts` (gemeinsame Statusbezeichnungen)
  - `devices-history.css`
- `DeviceManagementPage.tsx`: Das Panel erscheint in den Gerätedetails und lädt nach Statuswechsel, Zuweisung und Aktualisieren der Liste neu.

## Installation / Freigabe

1. **Noch nicht nach `main` pushen:** `main` wird automatisch auf Vercel veröffentlicht.
2. Voraussetzung: Die Proposals für Gerätestatus (#8), Zuweisung (#10) sowie Rücknahme und Übersicht (#11) sind installiert. Das Audit-Log (PBI-15) ist keine Voraussetzung.
3. Backup von `assignments`, `device_status_history` und `devices` sowie der Funktionen und Policies erstellen.
4. `supabase/checks/pbi-12-device-history-preflight.sql` **lesend** ausführen. Zu prüfen:
   - Spalten
   - Löschregeln der Fremdschlüssel
   - vorhandene Trigger und Rechte
5. `supabase/proposals/20261123_pbi_12_device_history.sql` **vollständig** ausführen.
6. Neu anmelden und den Funktionstest durchführen.

> **Hinweis:** Ein Gerät mit Zuweisungen oder Statushistorie kann danach nicht mehr gelöscht werden. Es wird stattdessen ausgemustert (`retired`). Die Anwendung selbst löscht keine Geräte.

## Manueller Funktionstest

1. Als Gerätemanager ein Testgerät auf **Wartung** und zurück auf **Verfügbar** setzen.
2. Gerät einem Mitarbeiter zuweisen, unter **Zuweisungen** zurücknehmen und anschließend einem zweiten Mitarbeiter zuweisen.
3. Unter **Geräte** → **Details** prüfen:
   - Die **Zuweisungshistorie** zeigt beide Mitarbeiter: die erste Zuweisung mit Beginn, Ende und Dauer, die zweite als „Aktiv“.
   - Der **Statusverlauf** zeigt alle Wechsel mit Benutzer und Zeitpunkt.
4. Als Administrator zusätzlich das **Änderungsprotokoll** prüfen.
5. Als Mitarbeiter anmelden: In den Details des eigenen Gerätes erscheint keine Gerätehistorie.
6. Im SQL Editor (nur lesen):

```sql
SELECT a.assigned_at, a.returned_at, p.first_name, p.last_name
FROM public.assignments a JOIN public.devices d ON d.id = a.device_id
LEFT JOIN public.profiles p ON p.id = a.employee_id
WHERE d.asset_tag = 'IT-0001' ORDER BY a.assigned_at DESC;
```

7. Schutz prüfen. Diese Anweisung muss mit „Zuweisungen bleiben für die Gerätehistorie erhalten.“ scheitern:

```sql
BEGIN; DELETE FROM public.assignments WHERE true; ROLLBACK;
```

## Automatisierte Tests

```bash
cd supabase && npm test                 # u. a. tests/deviceHistory.test.mjs, tests/assignments.test.mjs
cd frontend && npx vitest run src       # u. a. src/features/devices/deviceHistory*.test.ts, DeviceHistoryPanel.test.tsx
```

Geprüft werden:

- vollständiger Lebenszyklus mit Namen, Zeitpunkten und Reihenfolge
- Erhalt nach der Rückgabe
- Unveränderlichkeit, auch für Superuser und Service-Key
- Zugriffsmatrix
- Fehlercodes
- Obergrenze von 200 Einträgen mit Gesamtzahlen
- im Frontend: Anzeige, Leer- und Fehlerzustände, Berechtigungen, veraltete Antworten bei schnellem Gerätewechsel und Neuladen nach Rückgabe

## Bekannte Grenzen

- Pro Gerät werden je Liste höchstens 200 Einträge angezeigt (neueste zuerst). Ein Hinweis nennt die Gesamtzahl.
- Mitarbeiter sehen keine Historie, auch nicht für ihre eigenen Geräte. Das wäre eine mögliche Erweiterung.
