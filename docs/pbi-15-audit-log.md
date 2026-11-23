# PBI-15 – Audit-Log erstellen und anzeigen

**Anforderungen:** FA-20, FA-21 · **Priorität:** Must

> Als Administrator möchte ich relevante Aktionen im Audit-Log einsehen können, damit Änderungen im System nachvollziehbar sind.

## Akzeptanzkriterien und Umsetzung

| Akzeptanzkriterium | Umsetzung |
|---|---|
| Relevante Aktionen werden protokolliert. | Trigger auf `devices`, `assignments`, `profiles` und `inventory_private.role_change_audit` schreiben 15 Aktionen, z. B. Gerät angelegt/geändert, Status geändert, Gerät zugewiesen/zurückgenommen, Benutzer angelegt/deaktiviert, Rolle oder Rollenberechtigungen geändert. Die vollständige Liste steht in [`sql-tables.md`](sql-tables.md#7-audit_logs). |
| Der ausführende Benutzer wird gespeichert. | `audit_logs.user_id` aus `auth.uid()`, ersatzweise `assigned_by`/`returned_by`; ohne ermittelbaren Benutzer als „System“. |
| Die durchgeführte Aktion wird gespeichert. | `action`, `entity_type`, `entity_id`, `entity_title` und `details` (z. B. alter/neuer Wert je Feld). |
| Der Zeitpunkt wird gespeichert. | `created_at` (Pflichtfeld), angezeigt als Datum und Uhrzeit. |
| Nur berechtigte Benutzer können das Audit-Log einsehen. | Lesen nur über die RPC `inventory_audit_log_list`. Erlaubt nur aktiven Administratoren und SuperAdmins mit `audit:view` und aktiver Sitzung; kein direkter Tabellenzugriff aus dem Browser. |

## Rollen und Rechte

| Aktion | SuperAdmin | Admin | Gerätemanager | Mitarbeiter |
|---|---|---|---|---|
| Seite **Audit-Log** und Menüpunkt | Ja (mit `audit:view`) | Ja (mit `audit:view`) | Nein | Nein |
| **Änderungsprotokoll** in den Gerätedetails | Ja (mit `audit:view`) | Ja (mit `audit:view`) | Nein | Nein |
| Audit-Einträge ändern oder löschen | Nein | Nein | Nein | Nein |

Entzieht der SuperAdmin der Rolle Administrator `audit:view`, entfällt der Zugriff sofort. Weist er `audit:view` einer anderen Rolle zu, bleibt der Zugriff trotzdem verweigert: Der Server prüft zusätzlich die Rolle, und das Menü blendet den Eintrag aus.

## Änderungen

**Datenbank**

- `supabase/proposals/20261123_pbi_15_audit_log.sql`:
  - Spalten `user_id` und `entity_id`, Pflichtfelder und Indizes für `audit_logs`
  - Trigger und Manipulationsschutz
  - RPC `inventory_audit_log_list`
- `supabase/checks/pbi-15-audit-log-preflight.sql`: lesende Prüfung vor der Installation
- Die nie gemergten Migrationen `20261024120000_audit_logging.sql` und `20261024130000_audit_log_read_access.sql` entfallen. Das Proposal ersetzt sie und entfernt ihre Objekte, falls sie bereits ausgeführt wurden. Kopien für den Installationstest liegen unter `supabase/tests/fixtures/legacy/`.

**Frontend**

- `frontend/src/features/audit/`:
  - Seite `AuditLogPage.tsx`
  - wiederverwendbare Tabelle `AuditLogEntries.tsx`
  - API und Antwortprüfung `auditLogApi.ts`
  - deutsche Texte `auditLogFormat.ts`
  - Zugriffsregel `auditAccess.ts`
  - `audit.css`
- Menüpunkt **Audit-Log** (`/audit-log`) mit eigenem Symbol. Menü und Seitenzugriff nutzen die gemeinsame Regel `canOpenNavigationEntry` aus `config/navigation.ts`.
- Filter nach Aktion, Objekttyp, Suchbegriff (Objekt, Benutzer, E-Mail, Mitarbeiter, Rolle) und Zeitraum; 25 Einträge pro Seite, neueste zuerst.

## Installation / Freigabe

1. **Noch nicht nach `main` pushen:** `main` wird automatisch auf Vercel veröffentlicht.
2. Backup von `audit_logs`, `devices`, `assignments`, `profiles` sowie der Funktionen und Policies erstellen.
3. `supabase/checks/pbi-15-audit-log-preflight.sql` im Supabase SQL Editor **lesend** ausführen. Zu prüfen:
   - Spalten und Typen von `audit_logs`, insbesondere eine schon vorhandene Benutzerspalte
   - Einträge ohne `action` oder `entity_type`
   - vorhandene Trigger und Policies
4. `supabase/proposals/20261123_pbi_15_audit_log.sql` **vollständig** ausführen. Bei abweichendem Schema bricht der Preflight ohne Änderung ab.
5. Neu anmelden und den Funktionstest durchführen.

## Manueller Funktionstest

1. Als Administrator ein Testgerät anlegen, eine Angabe bearbeiten, den Status auf **Defekt** und zurück auf **Verfügbar** setzen.
2. Gerät einem Mitarbeiter zuweisen und unter **Zuweisungen** zurücknehmen.
3. **Audit-Log** öffnen. Die Einträge „Gerät angelegt“, „Gerätedaten geändert“ (alter → neuer Wert), „Gerätestatus geändert“, „Gerät zugewiesen“ und „Gerät zurückgenommen“ erscheinen mit Benutzer und Zeitpunkt.
4. Filter testen: Aktion „Gerät zugewiesen“, Objekttyp „Gerät“, Suche nach der Inventarnummer, Zeitraum „heute“.
5. In den Gerätedetails erscheint unter **Änderungsprotokoll** nur die Historie dieses Gerätes.
6. Als Gerätemanager und als Mitarbeiter anmelden: kein Menüpunkt, `/audit-log` zeigt „Zugriff verweigert“.
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
cd frontend && npx vitest run src       # u. a. src/features/audit/*.test.ts(x), src/config/navigation.test.ts
```

Geprüft werden:

- alle Aktionen mit Benutzer, Objekt und Zeitpunkt
- Einträge als „System“
- Rollback (NFA-06)
- Manipulationsschutz
- Zugriffsmatrix inklusive Entzug von `audit:view`, Deaktivierung und Sitzungsende
- Filter, Seiten und Eingabeprüfung
- Installation auf einer Datenbank mit den alten Migrationen
- im Frontend: Antwortprüfung, Formatierung, Seite und Menü

## Bekannte Grenzen

- Konten werden über die Edge Function `admin-users` mit dem Service-Key angelegt. Dabei gibt es keine Benutzersitzung, `USER_CREATED` erscheint daher als „System“. Setzt die Edge Function künftig `app_metadata.created_by`, übernimmt der Trigger den anlegenden Administrator automatisch.
- Bei `ROLE_PERMISSIONS_CHANGED` wird der neue Stand der Berechtigungen gespeichert, nicht der vorherige.
- Der Name des ausführenden Benutzers wird beim Lesen aus dem aktuellen Profil ermittelt. Der Mitarbeitername bei Zuweisungen ist dagegen eine Momentaufnahme.
