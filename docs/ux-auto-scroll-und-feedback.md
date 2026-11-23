# Device Inventory – Verbesserungen (UX, Teil 1)

Basis: GitHub main, Commit fa47711.

## Enthalten
- Automatisches Scrollen und Fokus auf neu geöffnete Panels: Geräte-Details, Bearbeiten, Status ändern, Zuweisen; Benutzer anlegen, bearbeiten, Rollen zuweisen, deaktivieren.
- Nach Speichern sichtbare Erfolgsmeldungen bei Geräten, Benutzern, Rollen und Geräterücknahmen.
- Tastatur- und Screenreader-freundliche Überschriften, Bewegungsreduktion.
- Kleine mobile Layoutverbesserungen, besser erkennbarer Tastendruck.
- Neue Tests für Auto-Scroll/Fokus/Feedback.

## Einbau
Im Projekt-Hauptverzeichnis entpacken (nur bei sauberem Git-Status). Danach im frontend prüfen: npm.cmd run check / npm.cmd run build / npm.cmd test / npx.cmd vitest run src.

Keine Datenbankänderung; Änderungen vor Git-Push lokal testen.

## Noch ausstehend
- Issue #12: Historienübersicht
- Issues #13/#14: konsistente Bestätigungen und Fehlermeldungen
- Issue #15: Audit-Logging
- Gerät beim Anlegen mit sicherem Default-Status
- Vollständige Rollentests und weitere mobile Anpassungen
