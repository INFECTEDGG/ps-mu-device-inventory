# Issue #4 – Benutzerverwaltung

## Umsetzung und Zuständigkeiten

Die Umsetzung baut auf `Uemit` (cf28129) auf. Dieser Stand integriert Michas Authentifizierung
und Ümits RBAC. Die Änderungen liegen auf Toms lokalem Branch `Tom`.

- `frontend/src/features/users/UserManagementPage.tsx`: Übersicht mit serverseitiger Suche und
  25 Einträgen pro Seite; Anlegen, Namen bearbeiten und bestätigte Deaktivierung.
- `frontend/src/features/users/userApi.ts`: ausschließlich authentifizierte Aufrufe der Edge Function.
- `supabase/functions/admin-users/`: Eingabevalidierung, sichere Fehlermeldungen und Auth-Admin-Aufrufe.
- `supabase/proposals/20261027090000_user_management.sql`: SQL-Vorschlag zur Teamprüfung,
  bewusst außerhalb automatisch ausgeführter Migrationen.

`App.tsx` bindet die Fachseite innerhalb der vorhandenen Zugriffsprüfung ein. Navigation,
Layout, AuthProvider und Berechtigungsmodell werden weiterverwendet. Der bestehende
App-Test isoliert die neue Fachseite wie bisher die Platzhalterseite; die Fachseite hat eigene Tests.

## Aufrufweg

Browser → Edge Function `admin-users` → geprüfte SQL-Funktionen / Supabase Auth Admin API.

Die Edge Function prüft den Bearer-Token mit `auth.getUser()`. SQL leitet den Aufrufer aus
`auth.uid()` ab und verlangt bei jedem Verwaltungsaufruf eine aktive Inventarsitzung,
ein aktives Konto und die aktuelle DB-Rolle `admin`. Vom Client übermittelte Rollen werden
abgelehnt. Auch direkte RPC-Aufrufe unterliegen denselben Prüfungen.

Ein Service-Role-Schlüssel wird ausschließlich in der Edge-Umgebung verwendet. Er darf
weder ins Frontend noch in `VITE_*`-Variablen oder Commits gelangen. Die Funktion verwendet
für SQL den JWT des Aufrufers, für Auth-Verwaltungsaktionen den Server-Schlüssel.

## Konten anlegen

Tom hat ein initiales, vom Administrator vergebenes Passwort gewählt. Es muss 12–128 Zeichen
lang sein; zusätzlich gelten die Supabase-Passwortregeln. Es erscheint weder in Antworten
noch in Listen, Profildaten, Browser-Speicher oder Anwendungslogs. Beim Schließen des Formulars,
Benutzerwechsel oder fehlgeschlagenen Aufruf wird es aus dem Formularzustand entfernt.

Neue Konten erhalten über Michas vorhandenen, atomaren Auth-INSERT-Trigger die Rolle
`employee`. Es gibt keinen zweiten Profil-INSERT. Scheitert der Trigger, rollt PostgreSQL
Auth-Konto und Profil gemeinsam zurück. Eine Vorprüfung verlangt den aktivierten, benannten
Trigger. Seine Definition muss vor Installation anhand von Michas Migration geprüft werden.

Die Anlage verwendet `email_confirm: true`: Der Administrator bestätigt damit die Zuordnung
der E-Mail-Adresse; es wird keine Bestätigungs-E-Mail verschickt. Dieses Verfahren sowie die
sichere Passwortübergabe vor Produktivsetzung mit dem Team freigeben. Ein erzwungener
Passwortwechsel beim ersten Login gehört noch nicht zu dieser Umsetzung.

Bearbeitet werden nur Vor- und Nachname. E-Mail-Änderungen, Passwort-Reset und Rollenänderungen
werden nicht parallel zu Michas/Ümits Funktionen implementiert.

## Deaktivierung und Teilausfälle

Der SQL-Vorschlag ergänzt `profiles.disabled_at` als dauerhafte Anwendungssperre. Das Feld
ist eine vorgeschlagene Schemaänderung, keine Behauptung über die existierende Datenbank.

1. Ein autorisierter SQL-Aufruf setzt den Zeitstempel und widerruft sämtliche bisherigen
   Inventarsitzungen des Zielbenutzers in einer Transaktion. Das eigene Konto kann nicht
   deaktiviert werden. Benutzer und historische Verweise bleiben erhalten.
2. Eine zusätzliche restriktive RLS-Policy auf allen sechs Anwendungstabellen sperrt auch
   Zugriffe mit noch gültigen JWTs. Sie gewährt selbst keine neuen Tabellenrechte.
3. Die Edge Function setzt per Supabase Auth Admin API einen Ban von 100 Jahren. Dadurch
   werden neue Passwortanmeldungen blockiert. Die Anwendungssperre hat kein Ablaufdatum.

Schlägt Schritt 3 fehl, bleibt der Anwendungszugriff gesperrt. Die Übersicht zeigt
„Anmeldesperre ausstehend“ und bietet „Sperre abschließen“. Der Aufruf ist wiederholbar.
Bis zum erfolgreichen Auth-Ban ist ein Auth-Login technisch eventuell noch möglich;
geschützte Anwendungszugriffe sind bereits gesperrt. Der Fehler wird nicht als vollständig
erfolgreiche Deaktivierung angezeigt. Dieser Zustand muss vor Abnahme aufgelöst werden.

Künftige Backend-Routen, Storage und privilegierte RPCs müssen die gleiche aktive-Konto-
und Sitzungsprüfung verwenden. RLS schützt keine Serveraufrufe, die mit service_role
ungeprüft darauf zugreifen. Eine Reaktivierung ist nicht Teil dieses Issues.

## Installation – erst nach Teamfreigabe

Es wurde nichts auf Production installiert oder deployed. Der tatsächliche DB-Stand wurde
ohne Supabase-Zugriff nicht verifiziert.

1. Mit Micha/Ümit Schema, vorhandene Policies/Trigger und die Definitionen der
   Auth-Profil- und Sitzungskomponenten prüfen. Vorhandene Daten sichern.
2. Michas Profil-Trigger und serverseitige Sitzungsmigration zuerst in einer Testumgebung
   installieren. Die bereits als installiert dokumentierten Lese-Policies nicht blind wiederholen.
3. Den neuen SQL-Vorschlag prüfen und in der Testumgebung installieren. Er entzieht normale
   INSERT-/UPDATE-/DELETE-Rechte auf `profiles`; mit geplanten Self-Service-Funktionen abstimmen.
   Weitere bestehende RPCs und Policies auf Umgehungsmöglichkeiten prüfen.
4. Edge Function `admin-users` bereitstellen. Standard-JWT-Prüfung nicht abschalten.
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` und `SUPABASE_SERVICE_ROLE_KEY` nur serverseitig
   bereitstellen. `ADMIN_ALLOWED_ORIGINS` enthält eine kommagetrennte Liste konkreter Frontend-
   Origins, z. B. `http://localhost:5173,https://eure-app.vercel.app`, ohne abschließenden Slash.
5. Frontend mit öffentlicher Supabase-Konfiguration und `VITE_SERVER_SESSION_GUARD=true`
   bauen. Bestehende Auth-Sessions müssen sich für die Inventarsitzung gegebenenfalls neu anmelden.
6. Echte Admin-/Mitarbeiter-/Gerätemanager-Konten testen: Erstellung plus Login mit initialem
   Passwort, Bearbeiten, Deaktivierung bei bestehender Sitzung, erneuter Login, direkte RPCs,
   doppelte E-Mail, fehlender Trigger und Auth-Teilausfälle.
7. Erst danach gemeinsam die Production-Installation freigeben.

## Lokale Prüfungen

```sh
cd frontend
npm install
npm run check
npm run build
npm test
npx vitest run src
cd ../supabase
npm install
npm test
```

Die Tests verwenden Mocks und lokales PostgreSQL über PGlite. Sie belegen weder die
Produktivkonfiguration noch das Verhalten eines echten Supabase Auth-Dienstes.
Der aktuelle SQL-Vorschlag und die Edge Function sind vor ihrer Freigabe als vorbereitete
Serverintegration zu betrachten. Issue #4 ist erst nach erfolgreicher Integration und
Ende-zu-Ende-Abnahme vollständig erledigt.

Prüfstand 27.10.2026: Frontend-TypeScript und Produktionsbuild erfolgreich;
Edge-Function-Typecheck mit Deno erfolgreich. 84 Node-Tests im Frontend einschließlich
der Serverhandler-Tests, 30 Vitest-Tests und 53 lokale SQL-Tests erfolgreich (167 insgesamt).
Die Prüfungen umfassen auch die vorhandenen Tests von Micha und Ümit.

## Für die Präsentation

Die Seite sammelt und validiert Eingaben. Der API-Adapter überträgt sie mit der bestehenden
Sitzung. Der Server prüft die Rechte unabhängig von der Oberfläche. PostgreSQL verwaltet
Profile und verhindert unerlaubten Datenzugriff; Supabase Auth verwaltet Passwörter und
Anmeldesperren. Die Aufteilung verhindert, dass privilegierte Schlüssel im Browser landen.

Referenzen: [Supabase createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
[Supabase updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).
