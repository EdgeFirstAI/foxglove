import { ExtensionContext, Time } from "@foxglove/extension";
import {
  ImageAnnotations,
  PointsAnnotation,
  Point2,
  PointsAnnotationType,
  RawImage,
  Color,
  SceneEntity,
  SceneUpdate,
  TextAnnotation,
  LinePrimitive,
  LineType,
  TextPrimitive,
} from "@foxglove/schemas";
import CV from "@techstark/opencv-js";
import zstd from "zstandard-wasm";

import { initModelSettingsPanel } from "./ModelSettingsPanel";

declare global {
  interface Window {
    cv: typeof import("mirada/dist/src/types/opencv/_types");
  }
}

type Header = {
  timestamp: Time;
  frame_id: string;
};

type DetectBoxes2D = {
  header: Header;
  inputTimestamp: Time;
  modelTime: Time;
  outputTime: Time;
  boxes: DetectBox2D[];
};

type DetectBox2D = {
  center_x: number;
  center_y: number;
  width: number;
  height: number;
  label: string;
  score: number;
  distance: number;
  speed: number;
  track: DetectTrack;
};
type DetectTrack = {
  id: string;
  lifetime: number;
  created: Time;
};

type Duration = {
  sec: number;
  nsec: number;
};

type Mask = {
  height: number;
  width: number;
  length: number;
  encoding: string;
  mask: Uint8Array;
  boxed: boolean;
};

type ModelMessage = {
  header: Header;
  input_time: Duration;
  model_time: Duration;
  output_time: Duration;
  decode_time: Duration;
  boxes: DetectBox2D[];
  masks: Mask[];
};

type ModelInfoMessage = {
  header: Header;
  input_shape: Uint32Array;
  input_type: number;
  output_shape: Uint32Array;
  output_type: number;
  labels: string[];
  model_types: string;
  model_format: string;
  model_name: string;
};

type RadarCube = {
  header: Header;
  timestamp: number;
  layout: Uint8Array;
  shape: Uint16Array;
  scales: Float32Array;
  cube: Int16Array;
  is_complex: boolean;
};

const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };
const WHITE_I8: Color = { r: 255, g: 255, b: 255, a: 255 };
const TRANSPARENT: Color = { r: 1, g: 1, b: 1, a: 0 };

const CLASS_COLORS_F: Color[] = [];
// color list from https://sashamaps.net/docs/resources/20-colors/
const CLASS_COLORS_I8: Color[] = [
  { r: 0, g: 0, b: 0, a: 0 },
  { r: 0, g: 255, b: 0, a: 200 },
  { r: 130, g: 130, b: 186, a: 200 },
  { r: 2, g: 48, b: 75, a: 200 },
  { r: 204, g: 195, b: 199, a: 200 },
  { r: 80, g: 80, b: 80, a: 200 },
  { r: 36, g: 79, b: 31, a: 200 },
  { r: 255, g: 244, b: 131, a: 200 },
  { r: 90, g: 82, b: 0, a: 200 },
  { r: 108, g: 159, b: 166, a: 200 },
  { r: 255, g: 142, b: 0, a: 200 },
  { r: 0, g: 69, b: 255, a: 200 },
  { r: 0, g: 0, b: 0, a: 200 },
  { r: 0, g: 128, b: 0, a: 200 },
  { r: 34, g: 139, b: 34, a: 200 },
  { r: 30, g: 105, b: 210, a: 200 },
  { r: 255, g: 255, b: 255, a: 200 },
];
const COLOR_I_TO_F = 1.0 / 255.0;
CLASS_COLORS_I8.forEach((c) => {
  CLASS_COLORS_F.push({
    r: COLOR_I_TO_F * c.r,
    g: COLOR_I_TO_F * c.g,
    b: COLOR_I_TO_F * c.b,
    a: COLOR_I_TO_F * c.a,
  });
});

// Background class detection — mirrors the webui's ModelInfo.isBackground().
// Populated when a ModelInfo message is received; falls back to class 0 when
// no ModelInfo has been seen yet.
const BG_PATTERN = /^(background|bg)$/i;
let bgIndices = new Set<number>();
let bgNumClasses = 0;

function isBackground(classId: number): boolean {
  if (bgNumClasses > 0 && classId >= bgNumClasses) {
    return true;
  }
  return bgIndices.has(classId);
}

const CHARCODE_MINUS = "-".charCodeAt(0);
const CHARCODE_DOT = ".".charCodeAt(0);
const CHARCODE_a = "a".charCodeAt(0);
const CHARCODE_A = "A".charCodeAt(0);
const CHARCODE_0 = "0".charCodeAt(0);
function uuid_to_color(id: string): Color {
  let hexcode = 0;
  let bytes = 0;
  for (const char of id) {
    const c = char.charCodeAt(0);
    if (c === CHARCODE_MINUS || c === CHARCODE_DOT) {
      continue;
    }
    let val = 0;
    if (c >= CHARCODE_a) {
      val = c - CHARCODE_a + 10;
    } else if (c >= CHARCODE_A) {
      val = c - CHARCODE_A + 10;
    } else if (c >= CHARCODE_0) {
      val = c - CHARCODE_0;
    }
    hexcode = (hexcode << 4) + val;

    // printf("c: %c val: %i hexcode: %x\n", c, val, hexcode);
    bytes++;
    if (bytes >= 8) {
      break;
    }
  }

  return {
    r: ((hexcode >> 24) & 0xff) / 255.0,
    g: ((hexcode >> 16) & 0xff) / 255.0,
    b: ((hexcode >> 8) & 0xff) / 255.0,
    a: 1.0,
  };
}

const RADAR_SEQ_VAR = "radar_seq";
const RADAR_RX_VAR = "radar_rx";

let radarcube_sequence = "";
let radarcube_rx = 0;

// Model settings — written by ModelSettingsPanel, read by converters
let model_boxes = true;
let model_boxes_color = "label";
let model_labels = true;
let model_score = false;
let model_track_id = false;
let model_masks = true;
let model_masks_color = "class";

function registerGlobalVariableGetter(extensionContext: ExtensionContext): void {
  extensionContext.registerTopicAliases((args) => {
    const { globalVariables } = args;
    const seqVar = globalVariables[RADAR_SEQ_VAR];
    radarcube_sequence = typeof seqVar === "string" ? seqVar : "";
    const rx = Number(globalVariables[RADAR_RX_VAR] ?? 0);
    if (isFinite(rx)) {
      radarcube_rx = rx;
    } else {
      radarcube_rx = -1;
    }

    // Model settings from panel
    const mb = globalVariables["model_boxes"];
    model_boxes = typeof mb === "boolean" ? mb : true;
    const mbc = globalVariables["model_boxes_color"];
    model_boxes_color = typeof mbc === "string" ? mbc : "label";
    const ml = globalVariables["model_labels"];
    model_labels = typeof ml === "boolean" ? ml : true;
    const ms = globalVariables["model_score"];
    model_score = typeof ms === "boolean" ? ms : false;
    const mti = globalVariables["model_track_id"];
    model_track_id = typeof mti === "boolean" ? mti : false;
    const mm = globalVariables["model_masks"];
    model_masks = typeof mm === "boolean" ? mm : true;
    const mmc = globalVariables["model_masks_color"];
    model_masks_color = typeof mmc === "string" ? mmc : "class";

    return [];
  });
}

const cyrb53 = (str: string, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};
function str_to_color(str: string): Color {
  const hash = cyrb53(str);

  return {
    r: (hash & 0xff) / 0xff,
    g: (hash & 0xff00) / 0xff00,
    b: (hash & 0xff0000) / 0xff00000,
    a: 1,
  };
}

function box_to_color_label(box: DetectBox2D): [Color, string] {
  // Colour: track ID when available and selected, otherwise label hash
  const box_color =
    model_boxes_color === "track" && box.track.id.length > 0
      ? uuid_to_color(box.track.id)
      : str_to_color(box.label);

  // Compose label from enabled elements
  const parts: string[] = [];
  if (model_labels) {
    parts.push(box.label);
  }
  if (model_score) {
    parts.push(box.score.toFixed(2));
  }
  if (model_track_id && box.track.id.length > 0) {
    parts.push(box.track.id.substring(0, 8));
  }

  return [box_color, parts.join("\n")];
}

function registerDetectConverter(extensionContext: ExtensionContext): void {
  extensionContext.registerMessageConverter({
    type: "schema",
    fromSchemaName: "edgefirst_msgs/msg/Detect",
    toSchemaName: "foxglove.ImageAnnotations",
    converter: (inputMessage: DetectBoxes2D): ImageAnnotations => {
      const points: PointsAnnotation[] = [];
      const texts: TextAnnotation[] = [];
      inputMessage.boxes.forEach((box: DetectBox2D) => {
        // The video is assumed to be 1920x1080 dimensions for this converter
        const x = box.center_x * 1920;
        const y = box.center_y * 1080;
        const width = box.width * 1920;
        const height = box.height * 1080;
        const [box_color, label] = box_to_color_label(box);
        const new_point: PointsAnnotation = {
          timestamp: inputMessage.inputTimestamp,
          type: PointsAnnotationType.LINE_LOOP,
          points: [
            { x: x - width / 2, y: y - height / 2 },
            { x: x - width / 2, y: y + height / 2 },
            { x: x + width / 2, y: y + height / 2 },
            { x: x + width / 2, y: y - height / 2 },
          ],

          outline_color: box_color,
          outline_colors: [box_color, box_color, box_color, box_color],
          fill_color: TRANSPARENT,
          thickness: 9,
        };
        const new_text: TextAnnotation = {
          timestamp: inputMessage.inputTimestamp,
          position: { x: x - width / 2, y: y - height / 2 + 6 },
          text: label,
          font_size: 48,
          text_color: box_color,
          background_color: TRANSPARENT,
        };
        points.push(new_point);
        texts.push(new_text);
      });
      const new_annot: ImageAnnotations = {
        circles: [],
        points,
        texts,
      };
      return new_annot;
    },
  });
  extensionContext.registerMessageConverter({
    type: "schema",
    fromSchemaName: "edgefirst_msgs/msg/Detect",
    toSchemaName: "foxglove.SceneUpdate",
    converter: (inputMessage: DetectBoxes2D): SceneUpdate => {
      const texts: TextPrimitive[] = [];
      const lines: LinePrimitive[] = [];
      inputMessage.boxes.forEach((b: DetectBox2D) => {
        if (b.distance === 0) {
          return;
        }
        const x = b.center_x;
        const y = b.center_y;
        const z = b.distance;

        const width = b.width;
        const height = b.height;
        const [box_color, label] = box_to_color_label(b);
        const line: LinePrimitive = {
          type: LineType.LINE_LIST,
          pose: {
            position: {
              x,
              y,
              z,
            },
            orientation: {
              x: 0,
              y: 0,
              z: 0,
              w: 1,
            },
          },
          thickness: 2,
          scale_invariant: true,
          points: [
            { x: -width / 2, y: -height / 2, z: -width / 2 },
            { x: -width / 2, y: height / 2, z: -width / 2 },
            { x: -width / 2, y: height / 2, z: width / 2 },
            { x: -width / 2, y: -height / 2, z: width / 2 },
            { x: width / 2, y: -height / 2, z: -width / 2 },
            { x: width / 2, y: height / 2, z: -width / 2 },
            { x: width / 2, y: height / 2, z: width / 2 },
            { x: width / 2, y: -height / 2, z: width / 2 },
          ],
          color: box_color,
          colors: [],
          indices: [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7],
        };
        lines.push(line);

        const t: TextPrimitive = {
          pose: {
            position: {
              x,
              y: y - height / 2 - 0.2,
              z,
            },
            orientation: {
              x: 0,
              y: 0,
              z: 0,
              w: 1,
            },
          },
          billboard: true,
          font_size: 12,
          scale_invariant: true,
          color: box_color,
          text: label,
        };
        texts.push(t);
      });

      const new_annot: SceneEntity = {
        timestamp: inputMessage.inputTimestamp,
        frame_id: inputMessage.header.frame_id,
        id: inputMessage.header.frame_id,
        lifetime: {
          sec: 0,
          nsec: 0,
        },
        frame_locked: false,
        metadata: [],
        arrows: [],
        cubes: [],
        spheres: [],
        cylinders: [],
        lines,
        triangles: [],
        texts,
        models: [],
      };
      const update: SceneUpdate = {
        deletions: [],
        entities: [new_annot],
      };
      return update;
    },
  });
}

let zstd_loaded = false;
zstd
  .loadWASM()
  .then(() => {
    zstd_loaded = true;
  })
  .catch(() => {
    console.log("Could not load zstd");
  });
function registerMaskConverter(extensionContext: ExtensionContext): void {
  extensionContext.registerMessageConverter({
    type: "schema",
    fromSchemaName: "edgefirst_msgs/msg/Mask",
    toSchemaName: "foxglove_msgs/msg/RawImage",
    converter: (inputMessage: Mask): RawImage => {
      const data = new Uint8Array(inputMessage.height * inputMessage.width * 4);
      const rawImage: RawImage = {
        timestamp: { sec: 0, nsec: 0 },
        frame_id: "",
        width: inputMessage.width,
        height: inputMessage.height,
        encoding: "rgba8",
        step: 4 * inputMessage.width,
        data,
      };

      let mask = inputMessage.mask;
      if (inputMessage.encoding === "zstd") {
        if (zstd_loaded) {
          mask = zstd.decompress(inputMessage.mask);
        } else {
          return rawImage;
        }
      }
      const classes: number = Math.round(mask.length / inputMessage.height / inputMessage.width);
      for (let i = 0; i < inputMessage.height * inputMessage.width; i++) {
        let max_ind = 0;
        let max_val = 0;
        for (let j = 0; j < classes; j++) {
          const val = mask.at(i * classes + j) ?? 0;
          if (val > max_val) {
            max_ind = j;
            max_val = val;
          }
        }
        if (isBackground(max_ind)) {
          continue;
        }
        const color = CLASS_COLORS_I8[max_ind] ?? WHITE_I8;
        data[i * 4 + 0] = (color.r * max_val) / 255.0;
        data[i * 4 + 1] = (color.g * max_val) / 255.0;
        data[i * 4 + 2] = (color.b * max_val) / 255.0;
        data[i * 4 + 3] = color.a;
      }

      return rawImage;
    },
  });

  extensionContext.registerMessageConverter({
    type: "schema",
    fromSchemaName: "edgefirst_msgs/msg/Mask",
    toSchemaName: "foxglove_msgs/msg/ImageAnnotations",
    converter: (inputMessage: Mask): ImageAnnotations => {
      const new_annot: ImageAnnotations = {
        circles: [],
        points: [],
        texts: [],
      };

      let mask = inputMessage.mask;
      if (inputMessage.encoding === "zstd") {
        if (zstd_loaded) {
          mask = zstd.decompress(inputMessage.mask);
        } else {
          return new_annot;
        }
      }
      const classes: number = Math.round(mask.length / inputMessage.height / inputMessage.width);
      const data = [];
      for (let i = 0; i < classes; i++) {
        data.push(new Uint8Array(inputMessage.height * inputMessage.width));
      }
      for (let i = 0; i < inputMessage.height * inputMessage.width; i++) {
        let max_ind = 0;
        let max_val = 0;
        for (let j = 0; j < classes; j++) {
          const val = mask.at(i * classes + j) ?? 0;
          if (val > max_val) {
            max_ind = j;
            max_val = val;
          }
        }
        const array = data.at(max_ind);
        if (array) {
          array[i] = 255;
        }
      }
      for (let i = 0; i < classes; i++) {
        if (isBackground(i)) {
          continue;
        }
        const d = data.at(i);
        if (!d) {
          break;
        }
        const img = CV.matFromArray(inputMessage.height, inputMessage.width, CV.CV_8UC1, d);
        const contours = new CV.MatVector();
        const hierarchy = new CV.Mat();
        CV.findContours(
          img,
          contours,
          hierarchy,
          CV.RETR_CCOMP as number,
          CV.CHAIN_APPROX_SIMPLE as number,
        );

        for (let j = 0; j < contours.size(); j++) {
          const tmp = contours.get(j);
          const points_cnt = tmp.data32S;
          const points_annot = [];
          // The video is assumed to be 1920x1080 dimensions for this converter
          for (let k = 0; k < points_cnt.length / 2; k++) {
            const p: Point2 = {
              x: (((points_cnt[k * 2] ?? 0) + 0.5) / inputMessage.width) * 1920,
              y: (((points_cnt[k * 2 + 1] ?? 0) + 0.5) / inputMessage.height) * 1080,
            };
            points_annot.push(p);
          }

          // CV.contor

          const p: PointsAnnotation = {
            timestamp: { sec: 0, nsec: 0 },
            type: PointsAnnotationType.LINE_LOOP,
            points: points_annot,
            outline_color: CLASS_COLORS_F[i] ?? WHITE,
            outline_colors: [],
            fill_color: CLASS_COLORS_F[i] ?? WHITE,
            thickness: 3,
          };
          new_annot.points.push(p);
          tmp.delete();
        }
        contours.delete();
        hierarchy.delete();
        img.delete();
      }
      // CV.findContours()

      // ensure all annotation messages have a timestamp
      const p: PointsAnnotation = {
        timestamp: { sec: 0, nsec: 0 },
        type: PointsAnnotationType.LINE_LOOP,
        points: [{ x: 0, y: 0 }],
        outline_color: TRANSPARENT,
        outline_colors: [],
        fill_color: TRANSPARENT,
        thickness: 5,
      };
      new_annot.points.push(p);
      return new_annot;
    },
  });
}
const REVERSE_HEIGHT = true;

function registerRadarCubeConverter(extensionContext: ExtensionContext): void {
  extensionContext.registerMessageConverter({
    type: "schema",
    fromSchemaName: "edgefirst_msgs/msg/RadarCube",
    toSchemaName: "foxglove_msgs/msg/RawImage",
    converter: (inputMessage: RadarCube): RawImage => {
      const height = inputMessage.shape[1] ?? 1;
      const width = inputMessage.shape[3] ?? 1;
      const stride = (inputMessage.shape[2] ?? 1) * width;
      const data = new Uint8Array(width * height * 2);

      const rawImage: RawImage = {
        timestamp: inputMessage.header.timestamp,
        frame_id: inputMessage.header.frame_id,
        width,
        height,
        encoding: "mono16",
        step: 2 * width,
        data,
      };
      let offset = 0;
      if (radarcube_sequence === "A") {
        offset = 0;
      } else if (radarcube_sequence === "B" || radarcube_sequence === "") {
        offset = (inputMessage.shape[0] ?? 1) > 1 ? height * stride : 0;
      } else {
        return rawImage;
      }

      if (radarcube_rx < 0) {
        return rawImage;
      }
      if (radarcube_rx >= (inputMessage.shape[2] ?? 1)) {
        return rawImage;
      }

      offset += width * radarcube_rx;

      const factor = 65535 / 2500;
      for (let i = 0; i < width * height; i++) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const curr_height = REVERSE_HEIGHT ? height - Math.floor(i / width) : Math.floor(i / width);
        const cube_index = offset + curr_height * stride + (i % width);
        let val = Math.log2(Math.abs(inputMessage.cube[cube_index] ?? 0) + 1) * factor;
        val = Math.min(val, 65535);
        data[i * 2 + 0] = val >> 8;
        data[i * 2 + 1] = val % 256;
      }

      return rawImage;
    },
  });
}

function registerModelInfoConverter(extensionContext: ExtensionContext): void {
  extensionContext.registerMessageConverter({
    type: "schema",
    fromSchemaName: "edgefirst_msgs/msg/ModelInfo",
    toSchemaName: "foxglove.Log",
    converter: (inputMessage: ModelInfoMessage) => {
      // Update module-level background class state from model labels
      const indices = new Set<number>();
      for (let i = 0; i < inputMessage.labels.length; i++) {
        if (BG_PATTERN.test(inputMessage.labels[i]!.trim())) {
          indices.add(i);
        }
      }
      bgIndices = indices;
      bgNumClasses = inputMessage.labels.length;

      return {
        timestamp: inputMessage.header.timestamp,
        level: 1, // INFO
        message: `${inputMessage.model_name} [${inputMessage.model_format}]: ${inputMessage.labels.join(", ")}`,
        name: "edgefirst.model_info",
        file: "",
        line: 0,
      };
    },
  });
}

function registerModelConverter(extensionContext: ExtensionContext): void {
  // Model → 2D ImageAnnotations (boxes and/or mask contours overlaid on image panels)
  // Controlled by the "model_overlay" global variable: "boxes", "masks", or "both" (default).
  extensionContext.registerMessageConverter({
    type: "schema",
    fromSchemaName: "edgefirst_msgs/msg/Model",
    toSchemaName: "foxglove.ImageAnnotations",
    converter: (inputMessage: ModelMessage): ImageAnnotations => {
      const showBoxes = model_boxes;
      const showMasks = model_masks;
      const points: PointsAnnotation[] = [];
      const texts: TextAnnotation[] = [];

      // Bounding boxes
      if (showBoxes) {
        inputMessage.boxes.forEach((box: DetectBox2D) => {
          const x = box.center_x * 1920;
          const y = box.center_y * 1080;
          const width = box.width * 1920;
          const height = box.height * 1080;
          const [box_color, label] = box_to_color_label(box);
          points.push({
            timestamp: inputMessage.header.timestamp,
            type: PointsAnnotationType.LINE_LOOP,
            points: [
              { x: x - width / 2, y: y - height / 2 },
              { x: x - width / 2, y: y + height / 2 },
              { x: x + width / 2, y: y + height / 2 },
              { x: x + width / 2, y: y - height / 2 },
            ],
            outline_color: box_color,
            outline_colors: [box_color, box_color, box_color, box_color],
            fill_color: TRANSPARENT,
            thickness: 9,
          });
          texts.push({
            timestamp: inputMessage.header.timestamp,
            position: { x: x - width / 2, y: y - height / 2 + 6 },
            text: label,
            font_size: 48,
            text_color: box_color,
            background_color: TRANSPARENT,
          });
        });
      }

      // Mask contours
      if (showMasks) {
        // Semantic masks (boxed=false): argmax across classes, contour per class
        for (const maskEntry of inputMessage.masks) {
          if (maskEntry.boxed) {
            continue;
          }
          let maskData = maskEntry.mask;
          if (maskEntry.encoding === "zstd") {
            if (zstd_loaded) {
              maskData = zstd.decompress(maskEntry.mask);
            } else {
              continue;
            }
          }
          const classes = Math.round(maskData.length / maskEntry.height / maskEntry.width);
          const classBuffers = [];
          for (let i = 0; i < classes; i++) {
            classBuffers.push(new Uint8Array(maskEntry.height * maskEntry.width));
          }
          for (let i = 0; i < maskEntry.height * maskEntry.width; i++) {
            let max_ind = 0;
            let max_val = 0;
            for (let j = 0; j < classes; j++) {
              const val = maskData.at(i * classes + j) ?? 0;
              if (val > max_val) {
                max_ind = j;
                max_val = val;
              }
            }
            const buf = classBuffers.at(max_ind);
            if (buf) {
              buf[i] = 255;
            }
          }
          for (let i = 0; i < classes; i++) {
            if (isBackground(i)) {
              continue;
            }
            const d = classBuffers.at(i);
            if (!d) {
              break;
            }
            const img = CV.matFromArray(maskEntry.height, maskEntry.width, CV.CV_8UC1, d);
            const contours = new CV.MatVector();
            const hierarchy = new CV.Mat();
            CV.findContours(
              img,
              contours,
              hierarchy,
              CV.RETR_CCOMP as number,
              CV.CHAIN_APPROX_SIMPLE as number,
            );
            for (let j = 0; j < contours.size(); j++) {
              const tmp = contours.get(j);
              const pts = tmp.data32S;
              const points_annot = [];
              for (let k = 0; k < pts.length / 2; k++) {
                points_annot.push({
                  x: (((pts[k * 2] ?? 0) + 0.5) / maskEntry.width) * 1920,
                  y: (((pts[k * 2 + 1] ?? 0) + 0.5) / maskEntry.height) * 1080,
                });
              }
              points.push({
                timestamp: inputMessage.header.timestamp,
                type: PointsAnnotationType.LINE_LOOP,
                points: points_annot,
                outline_color: CLASS_COLORS_F[i] ?? WHITE,
                outline_colors: [],
                fill_color: CLASS_COLORS_F[i] ?? WHITE,
                thickness: 3,
              });
              tmp.delete();
            }
            contours.delete();
            hierarchy.delete();
            img.delete();
          }
        }

        // Instance masks (boxed=true): threshold, contour, position within box
        for (let i = 0; i < inputMessage.masks.length; i++) {
          const maskEntry = inputMessage.masks[i]!;
          if (!maskEntry.boxed) {
            continue;
          }
          const box = inputMessage.boxes[i];
          if (!box) {
            continue;
          }
          let maskData = maskEntry.mask;
          if (maskEntry.encoding === "zstd") {
            if (zstd_loaded) {
              maskData = zstd.decompress(maskEntry.mask);
            } else {
              continue;
            }
          }

          const binary = new Uint8Array(maskEntry.height * maskEntry.width);
          for (let p = 0; p < binary.length; p++) {
            binary[p] = (maskData[p] ?? 0) > 127 ? 255 : 0;
          }

          const img = CV.matFromArray(maskEntry.height, maskEntry.width, CV.CV_8UC1, binary);
          const contours = new CV.MatVector();
          const hierarchy = new CV.Mat();
          CV.findContours(
            img,
            contours,
            hierarchy,
            CV.RETR_CCOMP as number,
            CV.CHAIN_APPROX_SIMPLE as number,
          );

          const instance_color =
            model_masks_color === "track"
              ? box_to_color_label(box)[0]
              : (CLASS_COLORS_F[i] ?? WHITE);
          const boxLeft = (box.center_x - box.width / 2) * 1920;
          const boxTop = (box.center_y - box.height / 2) * 1080;
          const boxW = box.width * 1920;
          const boxH = box.height * 1080;

          for (let j = 0; j < contours.size(); j++) {
            const tmp = contours.get(j);
            const pts = tmp.data32S;
            const points_annot = [];
            for (let k = 0; k < pts.length / 2; k++) {
              points_annot.push({
                x: boxLeft + (((pts[k * 2] ?? 0) + 0.5) / maskEntry.width) * boxW,
                y: boxTop + (((pts[k * 2 + 1] ?? 0) + 0.5) / maskEntry.height) * boxH,
              });
            }
            points.push({
              timestamp: inputMessage.header.timestamp,
              type: PointsAnnotationType.LINE_LOOP,
              points: points_annot,
              outline_color: instance_color,
              outline_colors: [],
              fill_color: instance_color,
              thickness: 3,
            });
            tmp.delete();
          }
          contours.delete();
          hierarchy.delete();
          img.delete();
        }
      }

      // Ensure annotation always has a timestamp entry
      points.push({
        timestamp: inputMessage.header.timestamp,
        type: PointsAnnotationType.LINE_LOOP,
        points: [{ x: 0, y: 0 }],
        outline_color: TRANSPARENT,
        outline_colors: [],
        fill_color: TRANSPARENT,
        thickness: 5,
      });

      return { circles: [], points, texts };
    },
  });

  // Model → 3D SceneUpdate (bounding boxes in 3D space when distance is available)
  extensionContext.registerMessageConverter({
    type: "schema",
    fromSchemaName: "edgefirst_msgs/msg/Model",
    toSchemaName: "foxglove.SceneUpdate",
    converter: (inputMessage: ModelMessage): SceneUpdate => {
      const texts: TextPrimitive[] = [];
      const lines: LinePrimitive[] = [];
      inputMessage.boxes.forEach((b: DetectBox2D) => {
        if (b.distance === 0) {
          return;
        }
        const x = b.center_x;
        const y = b.center_y;
        const z = b.distance;
        const width = b.width;
        const height = b.height;
        const [box_color, label] = box_to_color_label(b);
        const line: LinePrimitive = {
          type: LineType.LINE_LIST,
          pose: {
            position: { x, y, z },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          },
          thickness: 2,
          scale_invariant: true,
          points: [
            { x: -width / 2, y: -height / 2, z: -width / 2 },
            { x: -width / 2, y: height / 2, z: -width / 2 },
            { x: -width / 2, y: height / 2, z: width / 2 },
            { x: -width / 2, y: -height / 2, z: width / 2 },
            { x: width / 2, y: -height / 2, z: -width / 2 },
            { x: width / 2, y: height / 2, z: -width / 2 },
            { x: width / 2, y: height / 2, z: width / 2 },
            { x: width / 2, y: -height / 2, z: width / 2 },
          ],
          color: box_color,
          colors: [],
          indices: [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7],
        };
        lines.push(line);
        const t: TextPrimitive = {
          pose: {
            position: { x, y: y - height / 2 - 0.2, z },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          },
          billboard: true,
          font_size: 12,
          scale_invariant: true,
          color: box_color,
          text: label,
        };
        texts.push(t);
      });

      const new_annot: SceneEntity = {
        timestamp: inputMessage.header.timestamp,
        frame_id: inputMessage.header.frame_id,
        id: inputMessage.header.frame_id,
        lifetime: { sec: 0, nsec: 0 },
        frame_locked: false,
        metadata: [],
        arrows: [],
        cubes: [],
        spheres: [],
        cylinders: [],
        lines,
        triangles: [],
        texts,
        models: [],
      };
      return { deletions: [], entities: [new_annot] };
    },
  });

  // Model → RawImage (segmentation mask visualization)
  // Handles three modes based on the boxed flag:
  //   - Instance segmentation (boxed=true): masks are cropped to bounding boxes,
  //     paired 1:1 with boxes, colored by track/label.
  //   - Semantic segmentation (boxed=false): full-frame class masks colored by class index.
  //   - Panoptic (mixed): instance masks first (aligned with boxes), then semantic masks.
  extensionContext.registerMessageConverter({
    type: "schema",
    fromSchemaName: "edgefirst_msgs/msg/Model",
    toSchemaName: "foxglove_msgs/msg/RawImage",
    converter: (inputMessage: ModelMessage): RawImage => {
      if (!model_masks || inputMessage.masks.length === 0) {
        return {
          timestamp: inputMessage.header.timestamp,
          frame_id: inputMessage.header.frame_id,
          width: 0,
          height: 0,
          encoding: "rgba8",
          step: 0,
          data: new Uint8Array(0),
        };
      }

      // Determine output dimensions from the first semantic mask if present,
      // otherwise use 1920x1080 as the assumed frame size for instance masks.
      const semanticMask = inputMessage.masks.find((m) => !m.boxed);
      const outWidth = semanticMask ? semanticMask.width : 1920;
      const outHeight = semanticMask ? semanticMask.height : 1080;
      const data = new Uint8Array(outWidth * outHeight * 4);
      const rawImage: RawImage = {
        timestamp: inputMessage.header.timestamp,
        frame_id: inputMessage.header.frame_id,
        width: outWidth,
        height: outHeight,
        encoding: "rgba8",
        step: 4 * outWidth,
        data,
      };

      // Render semantic masks first (full-frame, class-colored) so instance
      // masks can paint on top.
      for (const maskEntry of inputMessage.masks) {
        if (maskEntry.boxed) {
          continue;
        }
        let maskData = maskEntry.mask;
        if (maskEntry.encoding === "zstd") {
          if (zstd_loaded) {
            maskData = zstd.decompress(maskEntry.mask);
          } else {
            continue;
          }
        }
        const classes = Math.round(maskData.length / maskEntry.height / maskEntry.width);
        for (let y = 0; y < maskEntry.height; y++) {
          for (let x = 0; x < maskEntry.width; x++) {
            const srcIdx = y * maskEntry.width + x;
            let max_ind = 0;
            let max_val = 0;
            for (let j = 0; j < classes; j++) {
              const val = maskData.at(srcIdx * classes + j) ?? 0;
              if (val > max_val) {
                max_ind = j;
                max_val = val;
              }
            }
            if (isBackground(max_ind)) {
              continue;
            }
            // Map mask coordinates to output coordinates
            const outX = Math.round((x / maskEntry.width) * outWidth);
            const outY = Math.round((y / maskEntry.height) * outHeight);
            if (outX >= outWidth || outY >= outHeight) {
              continue;
            }
            const dstIdx = (outY * outWidth + outX) * 4;
            const color = CLASS_COLORS_I8[max_ind] ?? WHITE_I8;
            data[dstIdx + 0] = (color.r * max_val) / 255.0;
            data[dstIdx + 1] = (color.g * max_val) / 255.0;
            data[dstIdx + 2] = (color.b * max_val) / 255.0;
            data[dstIdx + 3] = color.a;
          }
        }
      }

      // Render instance masks (boxed=true), positioned within their
      // corresponding bounding box region and colored by track/label.
      for (let i = 0; i < inputMessage.masks.length; i++) {
        const maskEntry = inputMessage.masks[i]!;
        if (!maskEntry.boxed) {
          continue;
        }
        const box = inputMessage.boxes[i];
        if (!box) {
          continue;
        }
        let maskData = maskEntry.mask;
        if (maskEntry.encoding === "zstd") {
          if (zstd_loaded) {
            maskData = zstd.decompress(maskEntry.mask);
          } else {
            continue;
          }
        }
        const inst_color =
          model_masks_color === "track" ? box_to_color_label(box)[0] : (CLASS_COLORS_F[i] ?? WHITE);
        const color_r = Math.round(inst_color.r * 255);
        const color_g = Math.round(inst_color.g * 255);
        const color_b = Math.round(inst_color.b * 255);

        // Box defines the region in normalized [0,1] coordinates
        const boxLeft = (box.center_x - box.width / 2) * outWidth;
        const boxTop = (box.center_y - box.height / 2) * outHeight;
        const boxW = box.width * outWidth;
        const boxH = box.height * outHeight;

        for (let my = 0; my < maskEntry.height; my++) {
          for (let mx = 0; mx < maskEntry.width; mx++) {
            const srcIdx = my * maskEntry.width + mx;
            const confidence = maskData[srcIdx] ?? 0;
            if (confidence === 0) {
              continue;
            }
            // Map mask pixel into the bounding box region on the output image
            const outX = Math.round(boxLeft + (mx / maskEntry.width) * boxW);
            const outY = Math.round(boxTop + (my / maskEntry.height) * boxH);
            if (outX < 0 || outX >= outWidth || outY < 0 || outY >= outHeight) {
              continue;
            }
            const dstIdx = (outY * outWidth + outX) * 4;
            const alpha = (confidence / 255.0) * 200; // match CLASS_COLORS_I8 alpha style
            data[dstIdx + 0] = color_r;
            data[dstIdx + 1] = color_g;
            data[dstIdx + 2] = color_b;
            data[dstIdx + 3] = alpha;
          }
        }
      }

      return rawImage;
    },
  });
}

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({
    name: "EdgeFirst Model Settings",
    initPanel: initModelSettingsPanel,
  });
  registerGlobalVariableGetter(extensionContext);
  registerModelInfoConverter(extensionContext);
  registerDetectConverter(extensionContext);
  registerMaskConverter(extensionContext);
  registerRadarCubeConverter(extensionContext);
  registerModelConverter(extensionContext);
}
