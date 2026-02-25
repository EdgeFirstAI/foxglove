# EdgeFirst Schemas for Foxglove

[![CI](https://github.com/EdgeFirstAI/foxglove/actions/workflows/ci.yaml/badge.svg)](https://github.com/EdgeFirstAI/foxglove/actions/workflows/ci.yaml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A [Foxglove Studio](https://foxglove.dev) extension that adds native visualization support for [EdgeFirst Perception Schemas](https://github.com/EdgeFirstAI/schemas). It converts EdgeFirst custom message types — object detections, segmentation masks, and radar cubes — into Foxglove's built-in visualization formats so they render directly in Image, 3D, and Raw Image panels without any manual data transformation.

## Features

### Object Detection Visualization

Converts `edgefirst_msgs/msg/Detect` messages into Foxglove annotations for both 2D and 3D panels:

- **2D Image Annotations** — Bounding boxes with labels are overlaid on camera frames in Image panels. Boxes are drawn as colored rectangles with configurable label content (class name, confidence score, track ID, or combined).
- **3D Scene Entities** — When detections include distance data, wireframe bounding boxes are rendered in the 3D panel at the detected object's position. Each box includes a billboard text label.

### Segmentation Mask Visualization

Converts `edgefirst_msgs/msg/Mask` messages for two complementary views:

- **Colorized Overlay** — The per-pixel class mask is rendered as an RGBA image where each semantic class maps to a distinct color. Supports Zstandard-compressed masks for efficient bandwidth usage.
- **Contour Annotations** — Uses OpenCV to extract contours from each class region, then renders them as filled polygon annotations that can be overlaid on camera frames in Image panels.

### Radar Cube Visualization

Converts `edgefirst_msgs/msg/RadarCube` messages into a mono16 grayscale image for visualization in Image panels. The radar cube dimensions (range, Doppler, azimuth, elevation, RX channels) are sliced according to configurable global variables, and the magnitude is log-scaled for visual clarity.

## Supported Message Conversions

| EdgeFirst Schema | Foxglove Schema | Panel Type |
|---|---|---|
| `edgefirst_msgs/msg/Detect` | `foxglove.ImageAnnotations` | Image |
| `edgefirst_msgs/msg/Detect` | `foxglove.SceneUpdate` | 3D |
| `edgefirst_msgs/msg/Mask` | `foxglove_msgs/msg/RawImage` | Image (overlay) |
| `edgefirst_msgs/msg/Mask` | `foxglove_msgs/msg/ImageAnnotations` | Image (contours) |
| `edgefirst_msgs/msg/RadarCube` | `foxglove_msgs/msg/RawImage` | Image |

## Global Variables

The extension reads Foxglove [global variables](https://docs.foxglove.dev/docs/visualization/variables/) to control visualization behavior at runtime:

| Variable | Type | Default | Description |
|---|---|---|---|
| `box_label` | string | `"track"` | Controls detection label content. Options: `"label"`, `"score"`, `"label-score"`, or `"track"` (shows track ID with unique color). |
| `radar_seq` | string | `""` | Selects the radar cube sequence. `"A"` for the first sequence, `"B"` or `""` for the second (if available). |
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
