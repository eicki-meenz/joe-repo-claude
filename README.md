# Dranbleiben

Offline-Habit-Tracker fürs iPhone, gebaut als PWA (Web-App für den Home-Bildschirm). Der Code liegt in `docs/`.

## Installieren
1. Einmalig auf GitHub: **Settings → Pages → Source: Deploy from a branch**, dann den Branch wählen und als Ordner **`/docs`** einstellen.
2. Auf dem iPhone die Pages-URL in **Safari** öffnen: `https://eicki-meenz.github.io/joe-repo-claude/`
3. **Teilen → Zum Home-Bildschirm**. Danach läuft die App offline.

## Funktionen
- Rhythmen: täglich, feste Wochentage, alle X–Y Tage, X× pro Woche/Monat/Quartal, ohne Rhythmus („zuletzt am …“)
- Farbskala Grün → Rot je nach Fälligkeit, „zuletzt“-Anzeige, Serien, Heatmap
- Grün-Quote (30 Tage) und Comebacks, damit ein verpasster Tag nicht alles auf null setzt
- Nachtragen und Notizen pro Eintrag
- Pause-/Reisetage, frei wählbarer Tagesbeginn (Standard 4 Uhr), feste Heimat-Zeitzone für Reisen
- Backup als JSON über das Teilen-Menü → In Dateien sichern → iCloud Drive

Die Daten liegen nur lokal auf dem Gerät (localStorage).
