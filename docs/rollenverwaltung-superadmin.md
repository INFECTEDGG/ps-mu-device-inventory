# SuperAdmin und Rollenvergabe – Erweiterung von Issue #5

Diese Erweiterung arbeitet mit **vier** Rollen: `super_admin`, `admin`, `device_manager`, `employee`.

- **Admin** darf nur zwischen `employee` und `device_manager` zuweisen. Bestehende Admin-/SuperAdmin-Konten sind für normale Admins geschützt.
- **SuperAdmin** darf außerdem `admin` ernennen/entziehen und die *operativen* Berechtigungen der Rollen `admin`, `device_manager` und `employee` ändern.
- `super_admin` kann **nicht** über Web-UI oder Edge Function vergeben werden. Kein Benutzer wird durch die Migration automatisch SuperAdmin.
- Niemand kann die eigene Rolle über die Anwendung ändern. Bei Rollenänderungen werden die Ziel-Sitzungen widerrufen.
- Die bisherigen Anlegen-, Namensbearbeiten- und Deaktivierungsfunktionen bleiben erhalten. Normale Admins dürfen Admin-/SuperAdmin-Konten nicht deaktivieren.

## Vorbereitung und Deployment

1. Arbeitskopie sichern, Backendänderungen/Tests prüfen, Datenbank-Backup anfertigen. Die SQL-Vorlage ist **nicht** automatisch ausführbar und ändert eine Produktionsdatenbank.
2. In Supabase SQL Editor **einmalig und vollständig** ausführen: `supabase/proposals/20261028102000_superadmin_role_permissions.sql` – **nur nachdem** `20261027090000_user_management.sql` bereits installiert ist.
3. Für die **einmalige erste SuperAdmin-Zuordnung** einen bestehenden, vom Team benannten Administrator über den SQL Editor gezielt zuweisen. Dabei vorher die UUID des gewünschten Admin-Kontos verifizieren. Beispiel mit Sicherheitsprüfungen (UUID absichtlich nicht vorausgefüllt):

```sql
begin;
do $$
declare target_id uuid := 'UUID_DES_GEPRUEFTEN_ADMIN_KONTOS'::uuid;
begin
  if exists (select 1 from public.profiles p join public.roles r on r.id=p.role_id where r.name='super_admin') then
    raise exception 'A SuperAdmin already exists – stop and review';
  end if;
  if not exists (select 1 from public.profiles p join public.roles r on r.id=p.role_id
    where p.id=target_id and r.name='admin' and p.disabled_at is null) then
    raise exception 'Selected account is not an active administrator';
  end if;
  update public.profiles set role_id=(select id from public.roles where name='super_admin'),updated_at=now() where id=target_id;
  update inventory_private.sessions set revoked_at=coalesce(revoked_at,now()) where user_id=target_id;
end $$;
commit;
```

4. Supabase Edge Function aus dem Projekt neu deployen:

```powershell
# Terminal im Projekt-Hauptverzeichnis (nicht in frontend)
npx.cmd --yes supabase@latest functions deploy admin-users --project-ref <PROJECT_REF>
```

5. In `frontend/.env.local` (nicht committen) nach SQL + Deployment `VITE_DYNAMIC_ROLE_PERMISSIONS=true` hinzufügen; **`VITE_SERVER_SESSION_GUARD=true` beibehalten**. Vite neu starten und eine *neue* Admin-/SuperAdmin-Sitzung erstellen.
6. Getrennte Tests mit Admin, SuperAdmin, Mitarbeiter und Manager ausführen. SQL-Installation oder Secret/Deploy ändern **nicht** GitHub-`main`.

## Sicherheitsgrenzen

- Die Frontend-Navigation nutzt bei aktiviertem Feature Flag die serverseitige `inventory_my_permissions()`-Antwort und verweigert bei Fehlern Zugriff. Ohne aktiviertes Feature Flag gelten weiterhin die festgelegten Standardberechtigungen.
- Kritische Rechte (`users:manage`, `roles:assign_basic`, `roles:assign_admin`, `roles:manage`, `permissions:manage`) sind **nicht editierbar**. Die Backend-RPCs prüfen Rollen/Sitzung/Benutzersperre bei jedem Aufruf unabhängig vom Frontend.
- Rollen-/Rechteänderungen werden in `inventory_private.role_change_audit` protokolliert.
- **Noch nicht enthalten** sind Datenbank-Policies für vollständige Geräte- und Zuweisungsoperationen. Für diese Tabellen müssen spätere Module die dynamischen Berechtigungen ebenfalls serverseitig in RLS/RPC-Prüfungen durchsetzen. Die UI-Anzeige allein ist kein Datenbankschutz.
- Falls das Deployment/SQL fehlschlägt: keine Schema-Teile blind nachinstallieren, keine bestehende Migration erneut ausführen, sondern Ursache und vorhandene Datenbankobjekte prüfen.
