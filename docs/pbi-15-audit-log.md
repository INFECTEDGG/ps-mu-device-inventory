# PBI-15 – Audit-Log erstellen und anzeigen

**Anforderungen:** FA-20, FA-21 · **Priorität:** Must

> Als Administrator möchte ich relevante Aktionen im Audit-Log einsehen können, damit Änderungen im System nachvollziehbar sind.

## Akzeptanzkriterien und Umsetzung

| Akzeptanzkriterium | Umsetzung |
|---|---|
| Relevante Aktionen werden protokolliert. | Trigger auf `devices`, `assignments`, `profiles` und `inventory_private.role_change_audit` schreiben 15 Aktionen, z. B. Gerät angelegt/geändert, Status geändert, Gerät zugewiesen/zurückgenommen, Benutzer angelegt/deaktiviert, Rolle oder Rollenberechtigungen geändert (vollständige Liste unter [Protokollierte Aktionen](#protokollierte-aktionen)). |
| Der ausführende Benutzer wird gespeichert. | `audit_logs.user_id` aus `auth.uid()`, ersatzweise fachliche Rückfallwerte (z. B. `assigned_by`/`returned_by`); ohne ermittelbaren Benutzer als „System“. Ausnahme: `USER_CREATED` über die Edge Function erscheint als „System“ (siehe [Bekannte Grenzen](#bekannte-grenzen)). |
| Die durchgeführte Aktion wird gespeichert. | `action`, `entity_type`, `entity_id`, `entity_title` und `details` (z. B. alter/neuer Wert je Feld). |
| Der Zeitpunkt wird gespeichert. | `created_at` (Pflichtfeld), angezeigt als Datum und Uhrzeit. |
| Nur berechtigte Benutzer können das Audit-Log einsehen. | Lesen nur über die RPC `inventory_audit_log_list` mit aktivem Konto, aktiver Sitzung und der Berechtigung `audit:view`; kein direkter Tabellenzugriff aus dem Browser. |

## Rollen und Rechte

Maßgeblich ist die Berechtigung `audit:view` aus der Rollenverwaltung des SuperAdmins – dieselbe Regel, die Menü (`Sidebar`) und Seitenzugriff (`App`) bereits für alle Seiten verwenden.

| Aktion | SuperAdmin | Admin | Gerätemanager | Mitarbeiter |
|---|---|---|---|---|
| Seite **Audit-Log** und Menüpunkt | Ja (Standard) | Ja (Standard) | nur wenn der SuperAdmin `audit:view` zuweist | nur wenn der SuperAdmin `audit:view` zuweist |
| Audit-Einträge ändern oder löschen | Nein | Nein | Nein | Nein |

`audit:view` gehört laut `frontend/src/config/permissions.ts` zu den Rechten, die der SuperAdmin über die Oberfläche vergeben darf (`editablePermissions`). Vergibt oder entzieht er es, gilt das in der Datenbank sofort und in Menü und Seite nach der nächsten Anmeldung. Jede solche Änderung erscheint selbst im Audit-Log (`ROLE_PERMISSIONS_CHANGED`).

> **Achtung beim Vergeben:** Das Audit-Log zeigt alle Einträge ohne weitere Einschränkung, darunter Namen und E-Mail-Adressen aller Benutzer, Rollenwechsel und Deaktivierungen (auch von Administratoren), alle Zuweisungen mit Mitarbeiternamen und die Berechtigungen der Rollen. Diese Daten sind sonst Administratoren vorbehalten. `audit:view` sollte deshalb nur Rollen gegeben werden, die diese Daten sehen dürfen.

Menü und Seite folgen der Berechtigungsmatrix aus der Datenbank nur, wenn in Vercel bzw. `frontend/.env.local` `VITE_DYNAMIC_ROLE_PERMISSIONS=true` gesetzt ist. Andernfalls verwendet das Frontend die festen Standardrechte; die Datenbank bleibt in jedem Fall maßgeblich.

## Änderungen

**Datenbank**

- `supabase/proposals/20261123_pbi_15_audit_log.sql`:
  - Spalten `user_id` und `entity_id`, Pflichtfelder und Indizes für `audit_logs`
  - Trigger und Manipulationsschutz
  - RPC `inventory_audit_log_list`
- `supabase/checks/pbi-15-audit-log-preflight.sql`: lesende Prüfung vor der Installation
- Die nie gemergten Migrationen `20261024120000_audit_logging.sql` und `20261024130000_audit_log_read_access.sql` entfallen. Das Proposal ersetzt sie und entfernt ihre Objekte, falls sie bereits ausgeführt wurden. Kopien für den Installationstest liegen unter `supabase/tests/fixtures/legacy/`.
- Das Proposal ändert keine bestehenden Funktionen anderer Teammitglieder. Es ergänzt nur Trigger auf den genannten Tabellen.
- Tests: `supabase/tests/auditLog.test.mjs` mit dem gemeinsamen Test-Setup `supabase/tests/support/inventoryStack.mjs` und der Schema-Nachbildung `supabase/tests/fixtures/inventory-schema.sql`.

**Frontend** (neu, alles unter `frontend/src/features/audit/`)

- Seite `AuditLogPage.tsx`
- wiederverwendbare Tabelle `AuditLogEntries.tsx`
- API und Antwortprüfung `auditLogApi.ts`
- deutsche Texte `auditLogFormat.ts` und `deviceStatusLabels.ts`
- Zugriffsregel `auditAccess.ts`
- `audit.css`
- Filter nach Aktion, Objekttyp, Suchbegriff (Objekt, Benutzer, E-Mail, Mitarbeiter, Rolle) und Zeitraum; 25 Einträge pro Seite, neueste zuerst.

**Einbindung in bestehende Dateien anderer Teammitglieder – nur Ergänzungen, keine geänderten oder entfernten Zeilen**

| Datei | Ergänzung |
|---|---|
| `frontend/src/config/navigation.ts` | Menüpunkt **Audit-Log** (`/audit-log`, Symbol `layout`, Berechtigung `audit:view`) vor **Einstellungen** (7 Zeilen) |
| `frontend/src/App.tsx` | Import von `AuditLogPage` und Route `/audit-log` (3 Zeilen) |

Alle übrigen Dateien anderer Teammitglieder entsprechen dem Stand von `main`.

**Zusätzlich im Branch (frühere eigene Arbeit, Grundlage für PBI-16 / NFA-13)**

- `.github/workflows/tests.yml`: GitHub Actions führt Datenbank- und Frontend-Tests bei jedem Push und Pull Request aus. Auf `main` gibt es bisher keinen Test-Workflow.
- `supabase/tests/assignments.test.mjs`: Tests für Zuweisung und Rücknahme (FA-04 bis FA-14, NFA-05, NFA-06)
- `docs/testing.md` und `supabase/README.md`: Teststrategie und Ablauf für Proposals

## Datenbank: Tabelle `audit_logs`

Diese Beschreibung gilt nach der Installation des Proposals. `docs/sql-tables.md` (Teamdokument) beschreibt die Tabelle noch im ursprünglichen Stand.

### Attribute

| Attribut | Beschreibung |
|---|---|
| `id` | Eindeutige UUID des Audit-Eintrags |
| `user_id` | Ausführender Benutzer (`profiles.id`); leer, wenn kein Benutzer ermittelt werden kann („System“) |
| `action` | Art der durchgeführten Aktion (Pflichtfeld) |
| `entity_type` | Art des betroffenen Objekts: `device`, `user` oder `role` (Pflichtfeld) |
| `entity_id` | UUID des betroffenen Objekts (bei Rollen leer) |
| `entity_title` | Lesbare Bezeichnung zum Zeitpunkt der Aktion, z. B. Inventarnummer, Name oder Rollenname |
| `details` | Zusätzliche Informationen als `jsonb` |
| `created_at` | Zeitpunkt der Aktion (Pflichtfeld) |

### Protokollierte Aktionen

| Aktion | Anzeige | Auslöser | `entity_type` | Inhalt von `details` |
|---|---|---|---|---|
| `DEVICE_CREATED` | Gerät angelegt | Gerät angelegt | `device` | Gerätedaten |
| `DEVICE_UPDATED` | Gerätedaten geändert | Stammdaten geändert (ohne Status) | `device` | `changes` mit altem und neuem Wert je Feld |
| `DEVICE_STATUS_CHANGED` | Gerätestatus geändert | Status geändert (auch durch Zuweisung/Rücknahme) | `device` | `old_status`, `new_status` |
| `DEVICE_DELETED` | Gerät gelöscht | Gerät gelöscht | `device` | Gerätedaten |
| `DEVICE_ASSIGNED` | Gerät zugewiesen | Zuweisung angelegt | `device` | `assignment_id`, `employee_id`, `employee_name`, `assigned_at` |
| `DEVICE_RETURNED` | Gerät zurückgenommen | Rückgabezeitpunkt gesetzt | `device` | `assignment_id`, `employee_id`, `employee_name`, `assigned_at`, `returned_at` |
| `ASSIGNMENT_UPDATED` | Zuweisung korrigiert | sonstige Änderung einer Zuweisung | `device` | `assignment_id`, `changes` |
| `ASSIGNMENT_DELETED` | Zuweisung gelöscht | Zuweisung gelöscht | `device` | Zuweisungsdaten |
| `USER_CREATED` | Benutzer angelegt | Profil angelegt | `user` | `first_name`, `last_name`, `role`, `email` |
| `USER_UPDATED` | Benutzerdaten geändert | Profildaten geändert | `user` | `changes` mit altem und neuem Wert je Feld |
| `USER_ROLE_CHANGED` | Benutzerrolle geändert | Rolle geändert | `user` | `old_role`, `new_role` |
| `USER_DISABLED` | Benutzer deaktiviert | `disabled_at` gesetzt | `user` | `disabled_at` |
| `USER_ENABLED` | Benutzer reaktiviert | `disabled_at` entfernt | `user` | – |
| `USER_DELETED` | Benutzer gelöscht | Profil gelöscht | `user` | Profildaten |
| `ROLE_PERMISSIONS_CHANGED` | Rollenberechtigungen geändert | SuperAdmin ändert Rechte einer Rolle | `role` | `role`, `permissions` (neuer, sortierter Stand) |

Zuweisungen und Rückgaben werden beim betroffenen Gerät protokolliert (`entity_type = 'device'`, `entity_id` = Geräte-ID). Dadurch lassen sich alle Einträge eines Gerätes gemeinsam abrufen (Filter `target_entity_id` der RPC). Der Mitarbeitername wird als Momentaufnahme gespeichert. Aktualisierungen ohne fachliche Änderung, z. B. nur `updated_at`, erzeugen keinen Eintrag. Neue Spalten in `devices`, `assignments` oder `profiles` erscheinen automatisch in `changes`.

### Ausführender Benutzer und Transaktion

Die Einträge entstehen durch Datenbank-Trigger. Damit wird jede Änderung protokolliert, egal auf welchem Weg sie in die Datenbank gelangt: Browser, RPC oder Supabase-Dashboard. Der Audit-Eintrag ist Teil derselben Transaktion: Wird die Änderung zurückgerollt, entfällt auch der Eintrag (**NFA-06**).

Der ausführende Benutzer wird über `auth.uid()` aus der Supabase-Sitzung ermittelt. Ohne Benutzersitzung werden fachliche Rückfallwerte verwendet:

- beim Anlegen eines Gerätes `devices.created_by`, falls die Spalte vorhanden ist,
- bei Zuweisungen `assigned_by`,
- bei Rückgaben `returned_by`,
- bei Rollenberechtigungen `role_change_audit.actor_id`,
- bei neuen Konten `app_metadata.created_by`, falls die Edge Function diesen Wert setzt.

Es werden nur IDs mit vorhandenem Profil übernommen, damit der Fremdschlüssel nie die eigentliche Änderung abbricht. Lässt sich kein Benutzer ermitteln, etwa bei Änderungen im Supabase-Dashboard, wird der Eintrag trotzdem geschrieben, mit leerem `user_id` („System“). Die Funktionen liegen im nicht über die API erreichbaren Schema `inventory_private`.

### Manipulationsschutz

- Browser-Rollen (`anon`, `authenticated`) haben keinerlei direkte Rechte auf `audit_logs`. Der Service-Key kann nur lesen.
- Ein Trigger verhindert `UPDATE`, `DELETE` und `TRUNCATE`, auch für den Datenbankbesitzer. Einzige Ausnahme ist `ON DELETE SET NULL` von `user_id`, wenn das Profil des ausführenden Benutzers gelöscht wird.

### Lesen über die RPC

`public.inventory_audit_log_list(target_page, target_action, target_entity_type, target_entity_id, search_text, created_from, created_to)` prüft bei jedem Aufruf:

- angemeldeter Benutzer mit aktivem (nicht deaktiviertem) Konto,
- aktive Serversitzung,
- Berechtigung `audit:view` laut aktueller Rollenmatrix.

Wird die Berechtigung entzogen, das Konto deaktiviert oder die Sitzung beendet, entfällt der Zugriff. Die RPC filtert nach Aktion, Objekttyp, Objekt, Zeitraum und Suchbegriff und liefert Seiten zu je 25 Einträgen (neueste zuerst) mit Gesamtzahl.

```json
{
  "user_id": "…",
  "action": "DEVICE_ASSIGNED",
  "entity_type": "device",
  "entity_id": "…",
  "entity_title": "IT-0003",
  "details": {
    "assignment_id": "…",
    "employee_id": "…",
    "employee_name": "Erika Muster",
    "assigned_at": "2026-11-23T12:00:00+00:00"
  },
  "created_at": "2026-11-23T12:00:00+00:00"
}
```

## Installation / Freigabe

1. **Noch nicht nach `main` pushen:** `main` wird automatisch auf Vercel veröffentlicht.
2. Backup von `audit_logs`, `devices`, `assignments`, `profiles` sowie der Funktionen und Policies erstellen.
3. `supabase/checks/pbi-15-audit-log-preflight.sql` im Supabase SQL Editor **lesend** ausführen. Zu prüfen:
   - Spalten und Typen von `audit_logs`, insbesondere eine schon vorhandene Benutzerspalte
   - Einträge ohne `action` oder `entity_type`
   - vorhandene Trigger und Policies
4. `supabase/proposals/20261123_pbi_15_audit_log.sql` **vollständig** ausführen. Bei abweichendem Schema bricht der Preflight ohne Änderung ab.
5. Neu anmelden und den Funktionstest durchführen.
6. Erst danach nach `main` mergen, damit Vercel keine Audit-Log-Seite ohne zugehörige Datenbankfunktion veröffentlicht.

## Manueller Funktionstest

1. Als Administrator ein Testgerät anlegen, eine Angabe bearbeiten, den Status auf **Defekt** und zurück auf **Verfügbar** setzen.
2. Gerät einem Mitarbeiter zuweisen und unter **Zuweisungen** zurücknehmen.
3. **Audit-Log** öffnen. Die Einträge „Gerät angelegt“, „Gerätedaten geändert“ (alter → neuer Wert), „Gerätestatus geändert“, „Gerät zugewiesen“ und „Gerät zurückgenommen“ erscheinen mit Benutzer und Zeitpunkt.
4. Filter testen: Aktion „Gerät zugewiesen“, Objekttyp „Gerät“, Suche nach der Inventarnummer, Zeitraum „heute“.
5. Als Gerätemanager und als Mitarbeiter anmelden: kein Menüpunkt, `/audit-log` zeigt „Zugriff verweigert“.
6. Optional (nur mit `VITE_DYNAMIC_ROLE_PERMISSIONS=true`): Als SuperAdmin unter **Rollen & Berechtigungen** dem Gerätemanager „Audit-Logs ansehen“ geben. Nach erneuter Anmeldung sieht der Gerätemanager das Audit-Log, darin auch den Eintrag „Rollenberechtigungen geändert“. Danach die Berechtigung unbedingt wieder entziehen (siehe Hinweis unter [Rollen und Rechte](#rollen-und-rechte)).
7. Im SQL Editor (nur lesen):

```sql
SELECT l.created_at, l.action, l.entity_title, p.first_name, p.last_name, l.details
FROM public.audit_logs l LEFT JOIN public.profiles p ON p.id = l.user_id
ORDER BY l.created_at DESC LIMIT 20;
```

8. Manipulationsschutz prüfen. Diese Anweisung muss mit „Audit-Einträge sind unveränderlich.“ scheitern:

```sql
BEGIN; DELETE FROM public.audit_logs WHERE true; ROLLBACK;
```

## Automatisierte Tests

```bash
cd supabase && npm test                 # u. a. tests/auditLog.test.mjs
cd frontend && npx vitest run src       # u. a. src/features/audit/*.test.ts(x)
```

Erwartet: alle Tests grün bis auf die 7 bekannten Fehlschläge in Testdateien anderer Teammitglieder (`hiddenDeactivatedUsers`, `listDisabledUsers`, `superAdminPermissions`), siehe [`testing.md`](testing.md#5-noch-offene-testfälle). Sie bestehen unabhängig von PBI-15 auch auf `main`.

Geprüft werden:

- alle Aktionen mit Benutzer, Objekt und Zeitpunkt
- Einträge als „System“
- Rollback (NFA-06)
- Manipulationsschutz
- Zugriff: Standardrollen, Vergabe und Entzug von `audit:view` durch den SuperAdmin, Deaktivierung und Sitzungsende
- Filter, Seiten und Eingabeprüfung
- Installation auf einer Datenbank mit den alten Migrationen
- im Frontend: Antwortprüfung, Formatierung, Seite, Menüpunkt und Route (`auditLogRoute.test.tsx`)

## Bekannte Grenzen

- Konten werden über die Edge Function `admin-users` mit dem Service-Key angelegt. Dabei gibt es keine Benutzersitzung, `USER_CREATED` erscheint daher als „System“. Setzt die Edge Function künftig `app_metadata.created_by`, übernimmt der Trigger den anlegenden Administrator automatisch.
- Bei `ROLE_PERMISSIONS_CHANGED` wird der neue Stand der Berechtigungen gespeichert, nicht der vorherige.
- Der Name des ausführenden Benutzers wird beim Lesen aus dem aktuellen Profil ermittelt. Der Mitarbeitername bei Zuweisungen ist dagegen eine Momentaufnahme.
