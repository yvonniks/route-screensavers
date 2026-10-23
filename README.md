# Route Conference Rooms

Screensavers for the conference room TVs, in one app. Opens in **dark mode** with **all controls hidden**.

Included: **Mark Starfield** and **Corner Hunter** (slowed down for big screens: one lap takes 60 s instead of 30 s).

## Showing the controls

Press any key, click, or tap. A small hint ("Press any key or click for controls") shows for a few seconds after load. The panel hides itself after ~4 s of inactivity. Moving the mouse alone does **not** open it, so a bumped mouse won't pop it up on the TV.

| Key | Action |
|---|---|
| `1` `2` … | Pick screensaver |
| `T` | Light / dark |
| `F` | Full screen |
| `↑` `↓` | Speed |
| `Space` | Pause |
| `H` | Hide controls completely (press `H` again to bring them back) |

The first key press only reveals the panel; keys then work as listed.

## Setting up a room (URL presets)

Add parameters to the URL so a TV always starts the way you want:

```
https://<your-host>/?saver=cornerhunter
https://<your-host>/?saver=starfield&speed=0.75
https://<your-host>/?theme=light
```

| Param | Values |
|---|---|
| `saver` | `starfield`, `cornerhunter` |
| `theme` | `dark` (default), `light` |
| `speed` | `0.25` – `4` (1 = normal; applies to the first screensaver loaded) |

On load, order of precedence is: URL parameter, then the last choice made in that browser, then the default (dark, first screensaver). Choices made from the controls are remembered per browser.

## Deploying

It's plain static files with no build step. Put the folder on any static host (GitHub Pages, Netlify, an internal web server) and open the URL on the TV browser in full screen (`F`).

To try it locally:

```bash
python3 -m http.server 5183
# then open http://localhost:5183
```

## Adding a screensaver

1. Create `js/savers/<name>.js` and call `SAVERS.register({...})`. The contract is documented at the top of `js/savers/registry.js`; `starfield.js` and `cornerhunter.js` are working examples.
2. Add one `<script src="js/savers/<name>.js">` line to `index.html`, before `js/app.js`.

The new saver shows up in the picker, gets a number key, and inherits theme, speed, pause, and the `?saver=` URL parameter automatically.

## Layout

```
index.html            page shell
css/app.css           theme + panel styles
js/app.js             controls, theme, speed, switching, URL params
js/savers/            one file per screensaver (+ registry.js)
```

The original `mark-starfield` and `bounce-screensaver` projects are unchanged and remain separate.
