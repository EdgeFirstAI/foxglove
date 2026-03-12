# EdgeFirst Schemas for Foxglove Studio - Changelog

## 2.0.1

- Fixed security vulnerabilities in ajv, bn.js, minimatch, and serialize-javascript dependencies
- Remaining low-severity advisories (elliptic, webpack) have no upstream fix available

## 2.0.0

### Breaking Changes

- Removed `model_overlay` and `box_label` global variables — replaced by the Model Settings panel

### Added

- Model output visualization: `edgefirst_msgs/msg/Model` support with bounding boxes, mask contours, and colorized mask image converters
- ModelInfo converter: reads `edgefirst_msgs/msg/ModelInfo` for class labels and background class detection
- EdgeFirst Model Settings panel with native sidebar controls for boxes (enabled, colour, labels, score, track ID) and masks (enabled, colour)
- Instance, semantic, and panoptic segmentation support with per-mode coloring
- Background class filtering via ModelInfo labels (matches `background` or `bg`, case-insensitive)
- Project documentation in `.github/copilot-instructions.md`

### Changed

- Box label composition now supports independent toggles for class name, score, and track ID (stacked vertically)
- Box and mask colouring can be set to label/class hash or track UUID independently
- Updated README with Model output documentation and panel setup instructions

## 1.2.0

- Changed license from AGPL-3.0 to Apache-2.0
- Updated @foxglove/extension from 2.26.0 to 2.45.0
- Updated @foxglove/schemas from 1.7.0 to 1.9.0
- Updated @foxglove/eslint-plugin from 2.0.0 to 2.1.0 (ESLint 9 flat config support)
- Updated eslint from 9.26.0 to 9.39.2
- Added typescript-eslint 8.54.0
- Migrated from .eslintrc.yaml to eslint.config.cjs (ESLint 9 flat config)
- Updated message converters to use new type: "schema" API
- Fixed various security vulnerabilities in dependencies

## 1.1.5

- Adjusted 3D bbox to render using optical frame of reference

## 1.1.4

- Previous release

## 0.0.0

- Alpha testing
