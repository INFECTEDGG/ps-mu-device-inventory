# Issue #8 – Gerätestatus verwalten / Sicherheitskorrektur Issue #7

## Enthalten
- `DeviceManagementPage.tsx`: Status ändern für Gerätemanager, Admin und SuperAdmin; Stammdaten bearbeiten nur für Admin/SuperAdmin. Geräte anlegen bleibt für Benutzer mit `devices:manage` verfügbar.
- `deviceApi.ts`: Statuswechsel ausschließlich über Supabase RPC `inventory_device_set_status`; Fehler werden verständlich ausgegeben. Geräte ohne Status erscheinen als „Nicht gesetzt“.
- `devices-issue7.css`: Darstellung der Statusbearbeitung.
- `supabase/proposals/20261115_device_status_and_admin_only_edits.sql`: **manuell zu prüfender** SQL-Vorschlag für RLS, Spaltenrechte und atomare Status-Historisierung. **Kein automatisches Deployment.**

## Rollenmatrix
| Aktion | SuperAdmin | Admin | Gerätemanager | Mitarbeiter |
|---|---|---|---|---|
| Geräte anlegen (`devices:manage`) | Ja | Ja | Ja | Nein |
| Stammdaten bearbeiten | Ja | Ja | Nein | Nein |
| Status verfügbar/defekt/Wartung | Ja | Ja | Ja | Nein |
| Ausmustern | Ja | Ja | Nein | Nein |
| Status „Zugewiesen“ setzen | Nur über Gerätezuweisung (Issue #10) | | | |
| Rückgabe | Eigene Zuweisungs-/Rückgabefunktion (Issue #11) | | | |

Die vorhandene **dynamische** Berechtigung `devices:manage` wird zusätzlich geprüft. Ohne dieses Recht darf auch ein Admin nicht schreiben.

## Datenbank-Schutz
Die vorige `devices_update_managed`-Policy gestattet Geräte-Updates auch für Gerätemanager. Der SQL-Vorschlag ersetzt sie durch eine admin-only UPDATE-Policy und beschränkt direkte UPDATE-Rechte auf Stammdatenfelder ohne `status`. Der Statuswechsel erfolgt über eine `SECURITY DEFINER`-Funktion, die Identität, Kontoaktivierung, Sitzung, Rolle und Berechtigung aus der Datenbank verifiziert.

Die Funktion schützt aktive Zuweisungen, verbietet das manuelle Setzen auf `assigned` und schreibt Status und Historie atomar. Eine Ausmusterung ist nur für Administratoren möglich; `retired` ist endgültig. Geräte mit Status `assigned` bleiben bis zur Rückgabe gesperrt. Die nächste Aufgabe „Gerät zuweisen“ muss den Gerätestatus in derselben DB-Transaktion setzen und die Gerätesperre in derselben Reihenfolge halten.

## Vor der SQL-Installation
- Führe zuerst die **schreibgeschützte** `supabase/checks/device-status-preflight.sql` aus; prüfe insbesondere `NULL`-Statuswerte und die Nullbarkeit von `old_status`. Danach Backup und Schemaabgleich (insbesondere `devices.status`, `device_status_history` und Constraints).
- In Supabase SQL Editor **komplette** Datei als ein Skript ausführen. Die Preflight-Prüfungen brechen bei abweichendem Schema oder Policies ab.
- Falls `device_status_history.old_status` als NOT NULL definiert wurde, können Altgeräte mit `NULL`-Status nicht ohne vorherige geprüfte Datenbereinigung historisiert werden. Keine Werte erfinden!
- SQL ist absichtlich unter `supabase/proposals/` statt unter `migrations/`, damit es nicht automatisch in Production ausgeführt wird.
- Nicht `service_role` in Browservariablen speichern, RLS nicht deaktivieren.

## Lokaler Test vor Push nach `main`
1. `npm.cmd run check` und `npm.cmd run build` aus dem Ordner `frontend`.
2. Admin: Gerät bearbeiten; Status wechseln; verifizieren, dass ein Eintrag in `device_status_history` entsteht.
3. Gerätemanager: „Bearbeiten“ fehlt; „Status ändern“ erlaubt; Ausmustern fehlt.
4. Mitarbeiter: weder „Bearbeiten“ noch „Status ändern“; direkte PostgREST-UPDATE-Versuche müssen serverseitig abgewiesen werden.
5. Gerät mit aktiver Zuweisung: Statuswechsel muss blockiert sein.
6. F5 nach Statuswechsel: neuer Status muss in Liste/Details bleiben.
7. Erst danach nach `main` committen und pushen, sonst aktualisiert sich eure Vercel-Produktionsseite.

## Integration
Dieser Patch setzt **den bereits lokal installierten Issue-#7-Patch** voraus. Er ersetzt nur dessen drei Dateien und fügt Dokumentation/SQL hinzu. Die ursprüngliche `devices.css` und das bestehende Formular „Gerät anlegen“ bleiben unverändert.
