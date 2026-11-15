# Dashboard und Einstellungen – Device Inventory

## Dashboard
- Supabase-Abfragen für Gerätekennzahlen unter den bestehenden RLS-Policies
- Status: verfügbar, zugewiesen, defekt, Wartung und nicht gesetzt
- Zuweisungsübersicht und Schnellzugriffe unter den Berechtigungen der Sitzung
- Aktuelle Daten nach Aktualisieren; Fehler- und Ladeanzeige

## Einstellungen
- Eigenes Benutzerprofil anzeigen (keine unautorisierte Rollenänderung)
- Passwort über Supabase Auth ändern (Mindestlänge 12 Zeichen)
- Helles/dunkles Design sowie automatische Übernahme der Systemfarbe
- Akzentfarben Blau, Grün, Türkis, Lila, Orange
- Kompakte Tabellen und reduzierte Animationen
- Einstellungen pro Browser via localStorage; kein Datenbankeingriff

## Testhinweise
1. `npm.cmd run check`, `npm.cmd run build`, `npm.cmd test`, `npx.cmd vitest run src` im `frontend`-Ordner
2. Anmeldung als Admin und Mitarbeiter: Dashboard-Zahlen und Seitenzugriffe überprüfen
3. Design wechseln, neu laden, Auswahl muss erhalten bleiben
4. Systemmodus prüfen: Windows-Modus wechseln; Ansicht muss sich anpassen
5. Dashboard, Benutzerliste, Geräte und Zuweisungen im Dark Mode auf lesbare Farben prüfen
6. Passwortwechsel mit separatem Testkonto prüfen, nicht mit einem produktiven SuperAdmin

Der Patch erwartet, dass der vorherige UX-AutoScroll-Patch bereits übernommen wurde.
