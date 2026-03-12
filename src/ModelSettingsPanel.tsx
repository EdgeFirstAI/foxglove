import { PanelExtensionContext } from "@foxglove/extension";
import React, { useEffect, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";

type PanelState = {
  boxes: boolean;
  boxesColor: string;
  labels: boolean;
  score: boolean;
  trackId: boolean;
  masks: boolean;
  masksColor: string;
};

const DEFAULT_STATE: PanelState = {
  boxes: true,
  boxesColor: "label",
  labels: true,
  score: false,
  trackId: false,
  masks: true,
  masksColor: "class",
};

function ModelSettingsPanel({ context }: { context: PanelExtensionContext }): React.JSX.Element {
  const [state, setState] = useState<PanelState>(() => ({
    ...DEFAULT_STATE,
    ...(context.initialState as Partial<PanelState> | undefined),
  }));

  // Sync state to global variables whenever it changes
  useEffect(() => {
    context.setVariable("model_boxes", state.boxes);
    context.setVariable("model_boxes_color", state.boxesColor);
    context.setVariable("model_labels", state.labels);
    context.setVariable("model_score", state.score);
    context.setVariable("model_track_id", state.trackId);
    context.setVariable("model_masks", state.masks);
    context.setVariable("model_masks_color", state.masksColor);
    context.saveState(state);
  }, [context, state]);

  // Build settings tree
  useLayoutEffect(() => {
    context.updatePanelSettingsEditor({
      actionHandler: (action) => {
        if (action.action === "update") {
          const path = action.payload.path;
          const value = action.payload.value;
          if (path[0] === "boxes") {
            setState((prev) => {
              switch (path[1]) {
                case "enabled":
                  return { ...prev, boxes: value as boolean };
                case "color":
                  return { ...prev, boxesColor: value as string };
                case "labels":
                  return { ...prev, labels: value as boolean };
                case "score":
                  return { ...prev, score: value as boolean };
                case "trackId":
                  return { ...prev, trackId: value as boolean };
                case undefined:
                default:
                  return prev;
              }
            });
          } else if (path[0] === "masks") {
            setState((prev) => {
              switch (path[1]) {
                case "enabled":
                  return { ...prev, masks: value as boolean };
                case "color":
                  return { ...prev, masksColor: value as string };
                case undefined:
                default:
                  return prev;
              }
            });
          }
        }
      },
      nodes: {
        boxes: {
          label: "Boxes",
          fields: {
            enabled: {
              input: "boolean",
              label: "Enabled",
              value: state.boxes,
              help: "Show bounding boxes from the Model output on Image panels.",
            },
            color: {
              input: "toggle",
              label: "Colour",
              value: state.boxesColor,
              options: [
                { label: "Label", value: "label" },
                { label: "Track", value: "track" },
              ],
              help: "Colour boxes by class label hash or by track ID. 'Label' assigns a deterministic colour based on the class name. 'Track' uses the track UUID for colour; falls back to instance ID when tracking is not enabled.",
            },
            labels: {
              input: "boolean",
              label: "Show Labels",
              value: state.labels,
              help: "Display the class label text above each bounding box.",
            },
            score: {
              input: "boolean",
              label: "Show Score",
              value: state.score,
              help: "Display the confidence score for each detection.",
            },
            trackId: {
              input: "boolean",
              label: "Show Track ID",
              value: state.trackId,
              help: "Display the track UUID (first 8 characters) for each detection. Shows instance ID when tracking is not enabled.",
            },
          },
        },
        masks: {
          label: "Masks",
          fields: {
            enabled: {
              input: "boolean",
              label: "Enabled",
              value: state.masks,
              help: "Show segmentation mask contours from the Model output on Image panels. Also controls the Model RawImage mask visualization.",
            },
            color: {
              input: "toggle",
              label: "Colour",
              value: state.masksColor,
              options: [
                { label: "Class", value: "class" },
                { label: "Track", value: "track" },
              ],
              help: "Colour instance masks by class index or by track ID. Semantic segmentation masks are always coloured by class index regardless of this setting. When set to 'Track', uses the track UUID for colour; falls back to instance ID when tracking is not enabled.",
            },
          },
        },
      },
    });
  }, [context, state]);

  return (
    <div style={{ padding: "1rem" }}>
      <p>Configure Model output visualization settings in the sidebar.</p>
    </div>
  );
}

export function initModelSettingsPanel(context: PanelExtensionContext): void {
  const root = createRoot(context.panelElement);
  root.render(<ModelSettingsPanel context={context} />);
}
