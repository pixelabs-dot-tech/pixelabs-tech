# pixelabs.tech

Source for the pixelabs.tech portfolio. The `main` branch holds only the built files that GitHub Pages serves; this `source` branch holds what they are built from.

## Build

    pip install qrcode pillow
    git clone https://github.com/pixelabs-dot-tech/jeetaklb-site /tmp/jeetaklb-site
    python3 build.py /tmp/jeetaklb-site/index.html

The Jeetak logo, scooter, food drawings and village list are read from the jeetaklb-site page, so they always match the live Jeetak site.

Outputs:
- `out/site/index.html` and `out/site/og-image.png`: copy both to the `main` branch to publish.
- `out/pixelabs.html`: the same page without the document wrapper, for previews.

## Edit

- `src/page.html`: all text and sections. Counts in "So far" use `data-count`.
- `src/style.css`: colours, type and layout (tokens at the top).
- `src/main.js`: the hero pixels, project animations, Jeetak ride and order tracker, contact form.
- `build.py`: phone, email and font settings at the top.
