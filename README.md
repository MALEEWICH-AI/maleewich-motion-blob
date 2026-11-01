# MALEEWICH // Studio 2.0 — 3D Symbiotic Glass & Bio-Core Engine

Interactive real-time WebGL2 raymarching studio for procedural dual-layer glass metaballs, internal bio-core structures, circular chamber apertures, motion-tracking HUD telemetry, and volcanic basalt terrain.

## Key Features (Studio 2.0)

- **Real-Time Dual-Layer SDF Raymarching (`shader.js`)**
  - Outer refractive glass shell with chromatic dispersion, Fresnel rim lighting, internal reflection, and suspended 3D micro-bubbles.
  - Inner organic bio-core (`Type 0` & `Type 2`) with dynamic hue-matched aperture rims, procedural micro-telemetry stamps, and subsurface bevel shading.
  - Hyperbolic liquid bridge (`sdHyperbolicBridge`) and circular window chambers (`Type 3`).
  - Foreground volcanic basalt rock ridge with procedural moss and background bokeh DOF.
- **Spatial Glass UI 2.0 (`index.html`, `styles.css`, `app.js`)**
  - **Direct Canvas Manipulation**: Drag nodes in 3D space, pan camera (`Middle Mouse` or `Alt + Drag` / background drag), zoom (`Alt/Cmd + Wheel`), scale node radius (`Wheel` over node), and double-click to reset camera.
  - **Blender/Spline-Style Parameter Scrubbing**: Drag horizontally on any parameter label to scrub values (`Shift` for fine precision), double-click any slider to reset to default.
  - **Full Undo / Redo History**: `Cmd/Ctrl + Z` and `Cmd/Ctrl + Shift + Z` across scene edits, node movements, and randomizer generations.
  - **Curated & Procedural Compositions (`presets.js`)**: 5 signature presets plus a multi-archetype procedural composition generator (`R`).
  - **Social Post & Video Export**: `9:16`, `4:5`, `1:1`, and `16:9` aspect ratios, multi-depth typography (`behind`, `inside`, `front`), motion-tracking HUD greebles, PNG snapshot export, and WebM/MP4 video recording with procedural ambient soundscapes (`audio.js`).

## Quick Start

Run a local HTTP server in the project root:

```bash
python3 -m http.server 8090 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8090` in a WebGL2-capable browser.

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Space` | Play / Pause animation loop |
| `R` | Generate random composition |
| `Tab` | Toggle Zen Mode (fullscreen viewport) |
| `G` | Toggle 3D node gizmos |
| `H` | Toggle Motion-Tracking HUD |
| `Backspace` / `Delete` | Delete selected node |
| `Cmd/Ctrl + Z` | Undo (`+ Shift` for Redo) |
