# EdgeFirst Schemas for Foxglove

[![CI](https://github.com/EdgeFirstAI/foxglove/actions/workflows/ci.yaml/badge.svg)](https://github.com/EdgeFirstAI/foxglove/actions/workflows/ci.yaml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A [Foxglove Studio](https://foxglove.dev) extension that adds native visualization support for [EdgeFirst Perception Schemas](https://github.com/EdgeFirstAI/schemas). It converts EdgeFirst custom message types — object detections, segmentation masks, and radar cubes — into Foxglove's built-in visualization formats so they render directly in Image, 3D, and Raw Image panels without any manual data transformation.

## Features

### Model Output Visualization

Converts `edgefirst_msgs/msg/Model` messages — the primary inference output schema — into multiple visualization formats:

- **2D Image Annotations** — Bounding boxes and segmentation mask contours overlaid on camera frames. Boxes and masks can be independently enabled/disabled via the settings panel.
- **3D Scene Entities** — Wireframe bounding boxes positioned in 3D space using detection distance data, with billboard text labels.
- **Colorized Mask Image** — Instance and semantic segmentation masks rendered as an RGBA image. Instance masks are paired with their bounding boxes; semantic masks use per-class coloring.

The `edgefirst_msgs/msg/ModelInfo` schema provides model metadata (class labels, model name) and is used to identify background classes for filtering.

### Object Detection Visualization (Legacy)

Converts `edgefirst_msgs/msg/Detect` messages into Foxglove annotations for both 2D and 3D panels:

- **2D Image Annotations** — Bounding boxes with labels overlaid on camera frames in Image panels.
- **3D Scene Entities** — When detections include distance data, wireframe bounding boxes are rendered in the 3D panel.

### Segmentation Mask Visualization (Standalone)

Converts `edgefirst_msgs/msg/Mask` messages for two complementary views:

- **Colorized Overlay** — The per-pixel class mask is rendered as an RGBA image where each semantic class maps to a distinct color. Supports Zstandard-compressed masks.
- **Contour Annotations** — Uses OpenCV to extract contours from each class region, rendered as filled polygon annotations overlaid on camera frames.

### Radar Cube Visualization

Converts `edgefirst_msgs/msg/RadarCube` messages into a mono16 grayscale image for visualization in Image panels. The radar cube dimensions are sliced according to configurable global variables, and the magnitude is log-scaled for visual clarity.

## Supported Message Conversions

| EdgeFirst Schema | Foxglove Schema | Panel Type |
|---|---|---|
| `edgefirst_msgs/msg/Model` | `foxglove.ImageAnnotations` | Image (boxes + contours) |
| `edgefirst_msgs/msg/Model` | `foxglove.SceneUpdate` | 3D |
| `edgefirst_msgs/msg/Model` | `foxglove_msgs/msg/RawImage` | Image (mask overlay) |
| `edgefirst_msgs/msg/ModelInfo` | `foxglove.Log` | Log |
| `edgefirst_msgs/msg/Detect` | `foxglove.ImageAnnotations` | Image |
| `edgefirst_msgs/msg/Detect` | `foxglove.SceneUpdate` | 3D |
| `edgefirst_msgs/msg/Mask` | `foxglove_msgs/msg/RawImage` | Image (overlay) |
| `edgefirst_msgs/msg/Mask` | `foxglove_msgs/msg/ImageAnnotations` | Image (contours) |
| `edgefirst_msgs/msg/RadarCube` | `foxglove_msgs/msg/RawImage` | Image |

## Model Settings Panel

The extension includes a custom **EdgeFirst Model Settings** panel that provides native sidebar controls for configuring Model and Detect output visualization. This replaces manual global variable entry with structured UI controls.

### Setup

1. Click the **Add Panel** button (+ icon) in the Foxglove layout toolbar
2. Search for **"EdgeFirst Model Settings"** and click to add it to your layout
3. Click on the panel to select it, then open the **panel settings sidebar** (click the gear/settings icon or press the sidebar toggle) to access the controls

The panel body itself displays a placeholder message — all controls are in the settings sidebar when the panel is selected.

### Settings

**Boxes**

| Setting | Type | Default | Description |
|---|---|---|---|
| Enabled | checkbox | on | Show bounding boxes from Model output on Image panels |
| Colour | toggle | Label | Colour boxes by class label hash (`Label`) or by track UUID (`Track`). Falls back to instance ID when tracking is not enabled. |
| Show Labels | checkbox | on | Display the class label text above each bounding box |
| Show Score | checkbox | off | Display the confidence score for each detection |
| Show Track ID | checkbox | off | Display the track UUID (first 8 characters). Shows instance ID when tracking is not enabled. |

**Masks**

| Setting | Type | Default | Description |
|---|---|---|---|
| Enabled | checkbox | on | Show segmentation mask contours and the RawImage mask visualization |
| Colour | toggle | Class | Colour instance masks by class index (`Class`) or by track UUID (`Track`). Semantic masks always use class colours regardless of this setting. |

Settings are persisted across Foxglove sessions and layout changes.

> **Note:** Settings changes only take effect when new messages are processed. If playback is paused, step one frame forward or tap play/pause to see the updated visualization.

### Radar Variables

Radar cube visualization is configured via Foxglove [global variables](https://docs.foxglove.dev/docs/visualization/variables/) (not the settings panel):

| Variable | Type | Default | Description |
|---|---|---|---|
| `radar_seq` | string | `""` | Selects the radar cube sequence. `"A"` for the first, `"B"` or `""` for the second. |
| `radar_rx` | number | `0` | Selects which RX channel to visualize from the radar cube. |

## Install

### From Release

Download the latest `.foxe` file from the [Releases](https://github.com/EdgeFirstAI/foxglove/releases) page and install it in Foxglove Studio:

1. Open Foxglove Studio
2. Navigate to the Extensions panel
3. Click **Install from file...** and select the downloaded `.foxe` file

### From Source

```sh
npm install
npm run local-install
```

Open Foxglove Studio (or press `Ctrl-R` to refresh if already open). The extension will be active automatically.

## Development

```sh
# Install dependencies
npm install

# Build and install locally
npm run local-install

# Lint
npm run lint

# Package into a .foxe file for distribution
npm run package
```

## License

[Apache-2.0](LICENSE) — Copyright 2024 Au-Zone Technologies
