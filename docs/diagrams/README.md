# Diagrams

[Squinch](https://github.com/jquatier/squinch) models, one folder per diagram. Each folder holds
the source plus exactly two build artifacts — no per-view, per-theme SVG pile:

```
architecture/   architecture.squinch    the model: components and the src/ module map
                architecture.svg        landscape view, adaptive (both palettes in one file)
                architecture.html       interactive: all views, zoom, theme switch

data-flow/      data-flow.squinch       the model: one decision tick as data, 15 numbered hops
                data-flow.svg           tick view, adaptive
                data-flow.html          interactive: all views, flow step-through
                data-flow-payloads.html the diagram beside the real JSON at every hop
```

The `.svg` files are what the markdown embeds (`--adaptive` bundles light and dark behind
`prefers-color-scheme`, so one file follows the reader). The `.html` files are the ones to actually
open — self-contained, no server needed.

## Rebuilding after editing a model

```bash
npx squinch check   <dir>/<name>.squinch
npx squinch render  <dir>/<name>.squinch --view <primary> --adaptive -o <dir>/<name>.svg
npx squinch render  <dir>/<name>.squinch -o <dir>/<name>.html
```

Primary views: `landscape` for architecture, `tick` for data-flow. Don't use `--sync` here — it
writes the light/dark pair for every view, which is what this layout deliberately avoids.
