# Falling Sand

A browser simulation that converts images into sand, water, stone, embers, and smoke on a 168×168 grid. Images stay in the browser.

[Open demo](https://dicnunz.github.io/demos/pixelmelt/)

![Material canvas with playback and brush controls](./docs/pixelmelt-workspace.jpg)

## Run

```sh
npm install
npm run dev
```

Open the Vite URL printed in the terminal. `npm run check` runs lint, tests, and the production build.

## Use

The included Strata scene opens paused. Press Play, or Step to advance one tick. Upload an image up to 20 MB; simple backgrounds and clear silhouettes survive the small grid best.

Melt, Flood, and Burn rebuild from the source material map. Push moves loose material, Spark adds embers and smoke, and Erase removes cells. Draw with a mouse or touch.

| Key | Action |
| --- | --- |
| Space | Play / pause |
| 1, 2, 3 | Push, Spark, Erase |
| [ and ] | Brush radius |
| . | Step while paused |

Shortcuts do not intercept text fields or sliders.

## Save and export

Save scene downloads a `.pixelmelt` file containing the current material and charge maps, tick, seed, source material map, preset, and brush settings. It includes brush events queued before saving. Open scene restores it paused, with exact continuation within this engine version. Reset and preset changes still use the saved source map; the original image is unnecessary.

Imports validate the version, grid, maps, and settings before replacing the current scene. Invalid files leave the previous scene available. Scene files are limited to 1 MB and contain a material representation of the source image. There is no automatic persistence; save before closing or refreshing.

Record 8s clip exports the canvas as WebM through `captureStream()` and `MediaRecorder`. Recording requires browser support for those APIs; use Chrome, Edge, or Firefox.

## Implementation

React and TypeScript, built with Vite. A Web Worker steps the cellular rules in [`src/sim`](./src/sim); Canvas renders without image smoothing. The [scene-file module](./src/lib/scene-file.ts) defines the versioned format. Tests cover deterministic stepping, scene roundtrips and continuation, invalid imports, concurrent loads, and worker failures.

This is an AI-assisted personal experiment with cellular rules. Its examples and tests do not establish physical accuracy or production use. The interface is designed for desktop use.

## Deploy

```sh
npm run build
```

Serve `dist/` on a static host. For a subdirectory, use `npm run build -- --base=/your/path/`. No environment variables are required.

## License

[MIT](./LICENSE)
