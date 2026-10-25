# Device Inventory Frontend

Dieses Verzeichnis enthält das im Rahmen von Issue #17 erstellte React-/TypeScript-Grundgerüst. Es stellt ausschließlich Layout, Navigation und Platzhalterseiten bereit; Fachlogik, API-Zugriffe und Mock-Daten sind bewusst nicht enthalten.

## Lokal starten

Voraussetzung ist Node.js 22 oder neuer.

```bash
cd frontend
npm install
npm run dev
```

Vite startet die Anwendung unter `http://localhost:28216`. Für einen Produktions-Build stehen folgende Befehle zur Verfügung:

```bash
npm run check
npm run build
npm run preview
```

## Supabase konfigurieren

Erstelle lokal die Datei `frontend/.env.local` mit den Werten des Supabase-Projekts:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

`VITE_SUPABASE_URL` enthält die Projekt-URL, `VITE_SUPABASE_PUBLISHABLE_KEY` den Publishable Key. Umgebungsdateien werden nicht versioniert. Für ein Deployment müssen dieselben Variablen direkt in der jeweiligen Hosting-Umgebung hinterlegt werden.

## Aufbau

- `src/components/layout/AppLayout.tsx`: gemeinsamer App-Rahmen und mobile Navigation
- `src/components/layout/Sidebar.tsx`: Hauptnavigation für Desktop und mobile Drawer-Ansicht
- `src/components/layout/Header.tsx`: einheitliche Topbar
- `src/components/navigation/NavigationItem.tsx`: wiederverwendbarer Navigationslink
- `src/components/ui/PageContainer.tsx`: Inhaltsbreite und Seitenabstände
- `src/components/ui/PageHeader.tsx`: konsistente Seitenüberschrift
- `src/components/ui/PlaceholderPanel.tsx`: klar gekennzeichneter Platzhalter ohne Fachfunktion
- `src/config/navigation.ts`: zentrale Definition von Routen und Navigationspunkten
- `src/lib/supabase.ts`: zentral konfigurierter Supabase-Client für spätere Fachmodule
- `src/styles/index.css`: Design-Tokens, Layout und responsive Breakpoints

Die Sidebar ist auf Desktop-Breiten dauerhaft sichtbar. Bis einschließlich `64rem` wird sie als tastaturbedienbarer Drawer mit Fokusführung, Fokusbegrenzung und Schließen über `Escape` dargestellt. Für kleine Smartphones werden Topbar, Abstände und Inhaltsflächen weiter verdichtet. Touch-Ziele sind mindestens 44 Pixel groß, Fokuszustände bleiben sichtbar und Animationen berücksichtigen `prefers-reduced-motion`.

## Spätere Fachansichten einbinden

Neue Bereiche werden zentral in `src/config/navigation.ts` registriert. In `src/App.tsx` kann anschließend die jeweilige `PlaceholderPage` durch eine Fachansicht ersetzt werden. Diese sollte weiterhin innerhalb von `AppLayout` und `PageContainer` gerendert werden, damit Navigation, Abstände und responsives Verhalten erhalten bleiben.
