# Lucide icon license

The SVG icons in this directory are adapted from `lucide-react@1.25.0`.

The current HUD controls are exported from the same installed package as Electron
with `node scripts/export-hud-icons.mjs`. They use a 24×24 canvas, stroke width 2,
and white strokes for Unity tinting. A fully transparent canvas rectangle prevents
Unity VectorImage import from independently cropping and enlarging each glyph.
Do not hand-redraw these controls or copy them from a second icon library.

Copyright © 2026 Lucide Icons and Contributors.

Licensed under the ISC License. Icons derived from Feather are additionally available under the MIT License. The complete upstream license is available in the repository dependency at `node_modules/lucide-react/LICENSE` and at <https://lucide.dev/license>.
