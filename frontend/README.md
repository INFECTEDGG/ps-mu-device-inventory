# Device Inventory Frontend

React- und TypeScript-Frontend mit Supabase Auth. Die Anmeldung ist umgesetzt;
die Fachseiten für Geräte, Zuweisungen und Benutzerverwaltung sind noch Platzhalter.

## Starten

Voraussetzung ist Node.js 22 oder neuer. Für die Tests wird Node.js 24 verwendet.
`frontend/.env.example` nach `frontend/.env.local` kopieren und die Supabase-URL
sowie den öffentlichen Publishable Key eintragen. Die lokale Datei bleibt außerhalb
von Git. Secret- und Service-Role-Keys gehören nicht ins Frontend.

```bash
cd frontend
npm ci
npm run dev
```

Die Anwendung startet unter `http://localhost:28216`.
Für ein Deployment müssen die Supabase-Variablen auch in der Hosting-Umgebung
hinterlegt werden.

```bash
npm test        # Tests
npm run check   # TypeScript prüfen
npm run build   # Produktionsbuild erstellen
npm run preview # Build lokal ansehen
```

## Anmeldung und Rolle

`AuthProvider` ist in `src/main.tsx` eingebunden. Über `useAuthSession()` können
andere Komponenten auf Benutzer und Sitzung zugreifen:

```tsx
const { user, userId, session, role, isLoading, isRoleLoading } = useAuthSession()
```

`userId` entspricht der UUID aus `auth.users` und `profiles.id`. Die Rolle wird
über `profiles.role_id` und `roles.name` geladen. Fehlt das Profil oder kann die
Rolle nicht gelesen werden, bleibt der Zugriff gesperrt. Über „Erneut prüfen“
(`reloadProfile()`) lässt sich die Abfrage wiederholen.

An- und Abmeldung laufen über `authOperations` in einer gemeinsamen Warteschlange.
Web Locks stimmen die Reihenfolge auch zwischen Tabs ab. Ohne diese Browserfunktion
gilt die Warteschlange nur im jeweiligen Tab. Eine verspätete automatische Abmeldung
prüft die Sitzungs-ID, damit sie eine inzwischen neue Anmeldung nicht beendet.

Das Berechtigungsmodell stammt aus Ümits Branch `Uemit`, Stand `e06907a`.
Sidebar und Seiten prüfen die dort festgelegten Berechtigungen. Bei der Zusammenführung
mit der Rollenverwaltung muss die gemeinsame Schnittstelle erhalten bleiben.

Neue Konten soll ein Administrator über das Backend anlegen. Das Registrierungsformular
ist nicht Teil dieser Anwendung. Die automatische Anlage eines Mitarbeiterprofils
ist vorbereitet, aber noch nicht eingerichtet. Die Zuständigkeit wird mit der
Benutzerverwaltung abgestimmt.

## Ablauf nach 30 Minuten

Im bisherigen Modus meldet die Anwendung nach 30 Minuten ohne Eingabe ab.
Tastatur, Maus, Touch und Scrollen zählen als Aktivität; Token-Erneuerung,
Fokuswechsel und Hintergrundabfragen zählen nicht. Der Zeitpunkt wird pro Sitzung
zwischen Tabs und beim Neuladen über Local Storage geteilt. Ist dieser Speicher
gesperrt, funktioniert die lokale Frist nur im geöffneten Tab.

Für direkte API-Zugriffe reicht diese Browserprüfung nicht. Dafür sind eine
SQL-Migration und die Serveranbindung vorbereitet. Sie sind noch nicht aktiviert:
`VITE_SERVER_SESSION_GUARD` bleibt vorerst `false`.

Nach der gemeinsamen Aktivierung gilt:

- Der Server bestätigt die Sitzung, bevor das Frontend die Rolle lädt.
- Eingaben melden Aktivität höchstens alle 30 Sekunden. Maßgeblich ist die letzte
  vom Server bestätigte Aktivität; die Frist kann deshalb etwas früher enden als
  30 Minuten nach der letzten lokalen Eingabe.
- Statusabfragen und Token-Erneuerungen verlängern die Frist nicht.
- Abgelaufene oder widerrufene Sitzungen brauchen eine neue Anmeldung.
- Bei einem Prüfungsfehler sperrt die Oberfläche den Zugriff bis zur erneuten Prüfung.
- RPC-Aufrufe verwenden den Token der geprüften Sitzung. Ein anderer Tab kann sie
  nicht nachträglich auf eine neue Sitzung umleiten.
- Die Abmeldung widerruft zuerst die Serversitzung und meldet dann bei Supabase ab.
  Ohne Netzwerk kann eine sofortige serverseitige Abmeldung nicht bestätigt werden.

SQL-Installation und Frontend-Update müssen zusammen erfolgen, auch auf Vercel.
Nach dem Setzen von `VITE_SERVER_SESSION_GUARD=true` ist ein neuer Build nötig.
Bestehende Benutzer müssen sich einmal neu anmelden. Der Datenbankfilter gilt
anschließend auch dann, wenn ein Client den Frontend-Schalter ausschaltet.

Privilegierte Backend-Aufrufe müssen die Sitzung mit dem JWT des Aufrufers prüfen.
Welche Geräte oder Benutzer jemand bearbeiten darf, regeln weiterhin die fachlichen
RLS-Policies und Backend-Berechtigungen.

## Manuell testen

1. Ohne Anmeldung `/geraete` aufrufen: Das Loginformular erscheint.
2. Mit einem Konto samt Profil anmelden: Die Rolle wird geladen.
3. Als `employee` `/benutzerverwaltung` aufrufen: Zugriff verweigert.
4. Als `admin` ist die Benutzerverwaltung erreichbar; sie zeigt noch einen Platzhalter.
5. Bei einem Konto ohne Profil erscheint ein Hinweis mit „Erneut prüfen“ und „Abmelden“.
6. Seite neu laden, danach abmelden: Die Sitzung bleibt beim Neuladen erhalten;
   nach der Abmeldung sind die Seiten gesperrt.
7. 30 Minuten ohne Eingabe warten: Die Anwendung meldet ab.

Die automatisierten Tests prüfen die Zeitgrenze mit einer simulierten Uhr.
Ein gemeinsamer Test auf dem bereitgestellten Frontend steht nach der Aktivierung
noch aus. Die eigentliche Kontoanlage gehört zur Benutzerverwaltung.

## Aufbau

- `src/components/layout/`: Rahmen, Header und Sidebar
- `src/components/navigation/`: Navigationseinträge
- `src/components/ui/`: gemeinsame Oberflächenelemente
- `src/config/navigation.ts`: Routen und benötigte Berechtigungen
- `src/auth/` und `src/lib/`: Auth-Zustand und Sitzungsverwaltung
- `src/services/`: Rollenabfrage und Serveranbindung
- `src/styles/index.css`: Farben, Layout und responsive Ansichten

Die Sidebar bleibt am Desktop sichtbar und wird bis einschließlich `64rem`
zu einer aufklappbaren Navigation. Neue Fachseiten ersetzen die jeweilige
`PlaceholderPage` in `src/App.tsx` und verwenden weiterhin `AppLayout`.
