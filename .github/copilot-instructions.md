# EdgeFirst Foxglove Extension — Project Instructions

## Project Overview

This is a **Foxglove Studio extension** that converts [EdgeFirst Perception Schemas](https://github.com/EdgeFirstAI/schemas) (`edgefirst_msgs`) into Foxglove's built-in visualization types. It enables native rendering of AI inference results — object detections, segmentation masks, radar cubes, and model outputs — in Foxglove's Image, 3D, and Raw Image panels without custom panel code.

- **Language**: TypeScript (strict mode, `noUncheckedIndexedAccess` enabled)
- **Build system**: `foxglove-extension build` (webpack-based, single `dist/extension.js` output)
- **Lint**: ESLint 9 flat config with `@foxglove/eslint-plugin` + `typescript-eslint` + Prettier
- **License**: Apache-2.0
- **Package format**: `.foxe` archive (produced by `npm run package`)

## Repository Structure

```
src/index.ts          — All extension logic: types, converters, and activate()
package.json          — Extension metadata, scripts, dependencies
tsconfig.json         — Extends create-foxglove-extension base config
eslint.config.cjs     — ESLint 9 flat config
dist/extension.js     — Build output (not committed)
*.foxe                — Packaged extension (not committed)
```

The entire extension lives in a single `src/index.ts` file. This is intentional — Foxglove extensions are bundled into one file anyway, and the converters share types, colors, and utility functions.

## EdgeFirst Schemas (github.com/EdgeFirstAI/schemas)

Schema definitions live in the sibling `../schemas/` repository. All schemas use the `edgefirst_msgs/msg/` namespace and follow ROS 2 `.msg` format.

### Core Schemas

| Schema | Purpose | Key Fields |
|---|---|---|
| **Box** | Bounding box with metadata | `center_x`, `center_y`, `width`, `height` (all normalized 0-1), `label`, `score`, `distance`, `speed`, `track` |
| **Track** | Object tracking info | `id` (UUID string), `lifetime` (frame count), `created` (timestamp) |
| **Mask** | Segmentation mask | `height`, `width`, `length`, `encoding` ("" or "zstd"), `mask` (uint8[]), `boxed` (bool) |
| **Detect** | Legacy detection message | `header`, timing as `Time` fields, `boxes[]` only. Being superseded by Model. |
| **Model** | Unified inference output | `header`, timing as `Duration` fields, `boxes[]`, `masks[]`. The primary output schema. |
| **ModelInfo** | Model metadata | `labels[]`, `model_name`, `model_format`, `model_types`, input/output shape and type |
| **RadarCube** | Radar FFT data | `layout[]` (dimension labels), `shape[]`, `scales[]`, `cube` (int16[]), `is_complex` |
| **RadarInfo** | Radar configuration | `center_frequency`, `frequency_sweep`, `range_toggle`, `detection_sensitivity`, `cube` |

### Important Schema Concepts

**Normalized coordinates**: Box `center_x`, `center_y`, `width`, `height` are all in [0, 1] range relative to the image frame. Converters scale these to pixel coordinates (currently hardcoded to 1920x1080).

**Mask.boxed flag**: Determines segmentation mode:
- `boxed=true` — **Instance segmentation**: mask is cropped to its paired bounding box region. Instance masks are aligned 1:1 with the `boxes[]` array by index.
- `boxed=false` — **Semantic segmentation**: full-frame mask where each pixel has per-class confidence values. The number of classes is inferred from `mask.length / height / width`.
- **Panoptic**: Instance masks first (matching boxes by index), followed by semantic mask(s).

**Background class detection**: Background classes are identified by matching ModelInfo labels against `/^(background|bg)$/i`. Without ModelInfo data, all classes are treated as foreground (no hardcoded class-0 assumption). Classes beyond `numClasses` are also treated as background.

**Mask encoding**: Masks may be uncompressed (`encoding=""`) or Zstandard-compressed (`encoding="zstd"`). Always check encoding and decompress before processing.

**Detect vs Model**: `Detect` is the legacy schema using `Time` fields for timestamps. `Model` is the current schema using `Duration` fields for performance measurements and includes both `boxes[]` and `masks[]`. Both should be supported.

## Foxglove Extension Development

### Extension API

The Foxglove extension API (`@foxglove/extension`) provides three registration methods in `ExtensionContext`:

1. **`registerMessageConverter()`** — Converts custom schemas to Foxglove-native schemas. This is the primary mechanism used in this extension.
2. **`registerTopicAliases()`** — Creates topic aliases and reads global variables. Used here as a side-effect mechanism to read user configuration into module-level state.
3. **`registerPanel()`** — Registers custom React panels with settings UI via `updatePanelSettingsEditor()`.

### Message Converter Patterns

Converters are stateless transforms: `(inputMessage) => outputMessage`. They have **no settings API** and **no access to global variables** directly. Configuration must flow through module-level state updated by `registerTopicAliases`.

```typescript
extensionContext.registerMessageConverter({
  type: "schema",
  fromSchemaName: "edgefirst_msgs/msg/SomeSchema",
  toSchemaName: "foxglove.ImageAnnotations",   // or foxglove_msgs/msg/RawImage, foxglove.SceneUpdate, etc.
  converter: (inputMessage: SomeType): ImageAnnotations => {
    // Transform and return
  },
});
```

**Key constraint**: You cannot register two converters from the same source schema to the same target schema. Foxglove deduplicates by source+target pair, and only the last registered one takes effect.

**Target schema names matter**: `foxglove.ImageAnnotations` and `foxglove_msgs/msg/ImageAnnotations` are treated as the same type for a given source topic. You cannot use both to get two separate overlay entries from one topic.

### Global Variable Pattern

Since converters are stateless, this extension uses a side-effect pattern to pass configuration:

1. Define module-level state variables (e.g., `let model_overlay = "both"`)
2. Read them in `registerTopicAliases` callback from `globalVariables`
3. Converters reference the module-level state directly

```typescript
const MY_VAR = "my_variable";
let myValue = "default";

extensionContext.registerTopicAliases((args) => {
  const v = args.globalVariables[MY_VAR];
  myValue = typeof v === "string" ? v : "default";
  return [];  // No aliases, just reading variables
});
```

### Side-Effect Converter Pattern

For schemas like ModelInfo where we need to capture data for use by other converters, register a converter that updates module-level state as a side effect while producing valid output (e.g., `foxglove.Log`).

### EdgeFirst Model Settings Panel

The extension registers a custom panel (`"EdgeFirst Model Settings"`) that provides native sidebar controls for configuring Model and Detect output visualization. The panel uses `updatePanelSettingsEditor()` to render controls in the Foxglove settings sidebar and `context.setVariable()` to write global variables that converters read via `registerTopicAliases`.

**Panel file**: `src/ModelSettingsPanel.tsx`

Settings tree:
- **Boxes**: Enabled (boolean), Colour (toggle: label/track), Show Labels (boolean), Show Score (boolean), Show Track ID (boolean)
- **Masks**: Enabled (boolean), Colour (toggle: class/track)

State is persisted via `context.saveState()` / `context.initialState`.

### Current Global Variables

| Variable | Type | Default | Set By | Used By |
|---|---|---|---|---|
| `model_boxes` | boolean | `true` | Model Settings panel | Model, Detect ImageAnnotations |
| `model_boxes_color` | string | `"label"` | Model Settings panel | Model, Detect box rendering |
| `model_labels` | boolean | `true` | Model Settings panel | Model, Detect box rendering |
| `model_score` | boolean | `false` | Model Settings panel | Model, Detect box rendering |
| `model_track_id` | boolean | `false` | Model Settings panel | Model, Detect box rendering |
| `model_masks` | boolean | `true` | Model Settings panel | Model ImageAnnotations, RawImage |
| `model_masks_color` | string | `"class"` | Model Settings panel | Model mask rendering |
| `radar_seq` | string | `""` | User (raw variable) | RadarCube converter |
| `radar_rx` | number | `0` | User (raw variable) | RadarCube converter |

### Current Message Conversions

| Source Schema | Target Schema | Output |
|---|---|---|
| `edgefirst_msgs/msg/Detect` | `foxglove.ImageAnnotations` | 2D bounding box overlay |
| `edgefirst_msgs/msg/Detect` | `foxglove.SceneUpdate` | 3D wireframe boxes |
| `edgefirst_msgs/msg/Mask` | `foxglove_msgs/msg/RawImage` | Colorized mask image |
| `edgefirst_msgs/msg/Mask` | `foxglove_msgs/msg/ImageAnnotations` | Contour polygon overlay |
| `edgefirst_msgs/msg/Model` | `foxglove.ImageAnnotations` | Boxes and/or mask contours (controlled by `model_boxes`/`model_masks`) |
| `edgefirst_msgs/msg/Model` | `foxglove.SceneUpdate` | 3D wireframe boxes |
| `edgefirst_msgs/msg/Model` | `foxglove_msgs/msg/RawImage` | Colorized mask image (instance + semantic) |
| `edgefirst_msgs/msg/ModelInfo` | `foxglove.Log` | Model info log entry + background class state |
| `edgefirst_msgs/msg/RadarCube` | `foxglove_msgs/msg/RawImage` | Log-scaled radar heatmap |

### Panel Settings API

Custom panels can use `updatePanelSettingsEditor()` with a `SettingsTree` to render native Foxglove sidebar controls — dropdowns (`select`), toggles, checkboxes (`boolean`), number inputs, color pickers, etc. — without custom HTML/CSS. Panels can call `context.setVariable()` to write global variables that converters read via `registerTopicAliases`. Use `context.saveState()` / `context.initialState` for persistence across sessions. The "EdgeFirst Model Settings" panel is the reference implementation of this pattern.

## Development Conventions

### TypeScript Types

- Define TypeScript types matching each EdgeFirst `.msg` schema. Use Foxglove's `Time` type for `builtin_interfaces/Time` fields and a local `Duration` type for `builtin_interfaces/Duration`.
- Use `Uint8Array`, `Uint16Array`, `Float32Array`, `Int16Array` for typed array fields.
- All array element access must use optional chaining or `.at()` due to `noUncheckedIndexedAccess`.

### Color Handling

- `CLASS_COLORS_I8` — 0-255 range colors for RawImage pixel rendering
- `CLASS_COLORS_F` — 0.0-1.0 range colors for Foxglove annotation rendering
- Box/track colors are derived from `str_to_color()` (label hash) or `uuid_to_color()` (track ID)
- The `box_to_color_label()` function returns `[Color, string]` based on `model_boxes_color`, `model_labels`, `model_score`, and `model_track_id` variables

### OpenCV (opencv-js)

Used for contour extraction from segmentation masks via `CV.findContours()`. Always clean up OpenCV objects (`img.delete()`, `contours.delete()`, `hierarchy.delete()`) to avoid memory leaks.

### Zstandard (zstandard-wasm)

Loaded asynchronously at extension startup. Always check `zstd_loaded` before attempting decompression. Gracefully return empty/default output if zstd is not ready.

### Coordinate System

- Bounding box coordinates are normalized [0, 1]
- Image panel rendering currently assumes **1920x1080** output dimensions
- 3D SceneUpdate uses the box's `distance` field for the z-axis position
- Contour points from OpenCV are mapped from mask pixel coordinates to output pixel coordinates

## Build and Test

```sh
npm install              # Install dependencies
npm run build            # Development build
npm run lint             # Lint with auto-fixable suggestions
npm run lint:fix         # Lint and auto-fix
npm run package          # Production build + .foxe archive
npm run local-install    # Install into local Foxglove Studio
```

After `npm run local-install`, press `Ctrl-R` in Foxglove Studio to reload the extension.

## Adding a New Schema Converter

1. Read the `.msg` definition from `../schemas/edgefirst_msgs/msg/`
2. Define a TypeScript type matching the schema fields
3. Write a `registerXxxConverter()` function using `registerMessageConverter()`
4. Choose an appropriate Foxglove target schema:
   - `foxglove.ImageAnnotations` — 2D overlays on Image panels
   - `foxglove.SceneUpdate` — 3D entities in 3D panels
   - `foxglove_msgs/msg/RawImage` — Rendered images
   - `foxglove.Log` — Log panel entries
5. Call the register function from `activate()`
6. If the converter needs configuration, add a global variable and read it in `registerGlobalVariableGetter()`
