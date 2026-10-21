# Sanduhr

Sanduhr als Progressive Web App (PWA) für das Android-Handy.

- Zeit in Minuten und Sekunden einstellen (1 Sekunde bis 30:00), dazu Schnellwahl
- Realistisch gezeichnete Sanduhr: Glas, Holzrahmen, Sandtrichter, Schüttkegel, rieselnder Strahl aus einzelnen Körnern
- Vor dem Start liegt der gesamte Sand unten. **Start** dreht die Sanduhr um, erst wenn der Sand zur Ruhe kommt, läuft die Zeit
- Der Sand verhält sich wie echter Sand: Der Durchfluss ist konstant. Im oberen Kolben bildet sich eine Mulde im Böschungswinkel, sie vertieft sich, bis Sand vom Rand zufällig nach einer Seite nachrutscht, die Mulde läuft zusammen und baut sich neu auf. Auf dem Kegel unten laufen kleine Lawinen die Flanken hinab, der Strahl klumpt und reißt kurz ab, und beim Kippen folgt die Oberfläche der Schwerkraft verzögert
- **Pause**: Die Sanduhr legt sich auf die Seite, der Sand liegt waagerecht, die Zeit steht. Mit **Weiter** richtet sie sich wieder auf (auch durch Antippen der Sanduhr)
- **Signal** bei Ablauf: Glockenton (per Web Audio erzeugt) und Vibration
- **Bildschirm bleibt an**, ohne Dimmen, solange die App läuft oder pausiert (Screen Wake Lock)
- **Menü** (oben rechts): 20 Hintergrundfarben zur Auswahl; Schrift und Bedienelemente passen sich automatisch an, die Wahl wird gespeichert
- Installierbar und offline nutzbar

Keine Abhängigkeiten, kein Build-Schritt: reines HTML, CSS und JavaScript.

## Lokal ausprobieren

```
npm run serve        # oder: node tools/serve.mjs   →  http://localhost:8080/
npm test             # Timer- und Geometrie-Tests (node --test)
npm run icons        # Icons neu erzeugen (icons/*.png)
```

`localhost` zählt als sicherer Kontext, dort funktionieren Service Worker und Wake Lock bereits.
Für das Handy braucht die App HTTPS, siehe unten.

`tools/preview.html?p=0.4&paused=1&flow=0` zeigt die Sanduhr in einem festen Zustand
(`p` = Fortschritt 0…1, `paused=1` liegend, `flow=0` ohne Rieselstrahl).

## Auf das Handy bringen (GitHub Pages)

1. Repository auf GitHub anlegen und diesen Ordner pushen.
2. Im Repository: *Settings → Pages → Build and deployment → Deploy from a branch*, Branch `main`, Ordner `/ (root)`.
3. Auf dem Handy in Chrome `https://<benutzer>.github.io/<repo>/` öffnen.
4. Menü (⋮) → *App installieren* bzw. *Zum Startbildschirm hinzufügen*.

Alle Pfade in der App sind relativ, sie funktioniert daher unter jedem Unterpfad.

### Updates

Der Service Worker (`sw.js`) antwortet aus dem Cache und lädt im Hintergrund nach. Eine Änderung
ist deshalb nach dem zweiten Start sichtbar. Werden Dateien hinzugefügt oder entfernt, die Liste
`ASSETS` und die Versionsnummer `CACHE` in `sw.js` anpassen.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `index.html`, `css/style.css` | Oberfläche |
| `js/app.js` | Zustände (Ruhe, läuft, Pause, abgelaufen), Eingabe, Ablaufschleife |
| `js/timer.js` | Timer-Logik auf Zeitstempel-Basis, Eingabeprüfung |
| `js/geometry.js` | Glasprofil und Sandverteilung (Schwerkraft, Trichter, Schüttkegel) |
| `js/hourglass.js` | Canvas-Zeichnung, Hinlegen/Aufrichten |
| `js/audio.js` | Alarmton und Vibration |
| `js/wakelock.js` | Bildschirm wachhalten, nach Rückkehr in die App neu anfordern |
| `js/theme.js` | Die 20 Hintergrundfarben und die davon abgeleiteten Farben |
| `sw.js`, `manifest.webmanifest` | PWA |

## Grenzen

- Der Bildschirm bleibt nur an, solange die App im Vordergrund ist. Wechselt man in eine andere App
  oder sperrt das Handy von Hand, gibt Android den Wake Lock frei, und der Alarm kann unterdrückt werden.
- Im Energiesparmodus kann Android den Wake Lock ablehnen. Die App zeigt dann einen Hinweis.
- Setzt man mitten im Lauf zurück, läuft der Restsand zügig durch, bis alles unten liegt.
- Der Alarm klingt höchstens 60 Sekunden und wird mit *Nochmal*, *Fertig* oder Antippen der Sanduhr beendet.
