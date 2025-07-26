import { app } from "../../scripts/app.js";

import { ChannelSliderWidget } from "./channelslider_widget.js";

function removeInputs(node, filter) {
  if (
    !node ||
    node.type !== "OlmChannelMixer" ||
    node.id === -1 ||
    !Array.isArray(node.inputs)
  )
    return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    const input = node.inputs[i];
    if (filter(input)) {
      node.removeInput(i);
    }
  }
}

function hideWidget(widget, extraYOffset = -4) {
  if (widget) {
    widget.hidden = true;
    widget.computeSize = () => [0, extraYOffset];
  }
}

function hideDefaultWidgets(node, filter) {
  for (let i = node.widgets.length - 1; i >= 0; i--) {
    const widget = node.widgets[i];
    if (filter(widget)) {
      widget.hidden = true;
    }
  }
}

function initNodeProperties(node) {
  node.properties = node.properties || {};
  if (!node.properties.mixer_values) {
    node.properties.mixer_values = JSON.parse(
      JSON.stringify(DEFAULT_MIXER_VALUES)
    );
  }
  if (!node.properties.selected_channel) {
    node.properties.selected_channel = "Red";
  }
}

function updateHiddenWidget(node, outputChannel, inputChannel, value) {
  const widgetName = `${inputChannel.toLowerCase()}_in_${outputChannel.toLowerCase()}`;
  const widget = node.widgets.find((w) => w.name === widgetName);
  if (widget) {
    widget.value = value;
  }
}

function updateMixerProperty(node, outputChannel, inputChannel, value) {
  const c = inputChannel.charAt(0).toLowerCase();
  node.properties.mixer_values[outputChannel][c] = value;
  updateHiddenWidget(node, outputChannel, inputChannel, value);
}

function createPreviewUpdateFunction(node) {
  let debounceTimer = null;
  return () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const mixer = node.properties.mixer_values;
      const matrix = [
        [mixer.Red.r, mixer.Red.g, mixer.Red.b],
        [mixer.Green.r, mixer.Green.g, mixer.Green.b],
        [mixer.Blue.r, mixer.Blue.g, mixer.Blue.b],
      ];
      const payload = {
        matrix: matrix,
      };
      fetch(
        `/olm/api/channelmixer/update?key=${encodeURIComponent(
          node.previewCacheKey
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
        .then((res) => res.json())
        .then((data) => {
          if (data.status === "success" && data.updatedimage) {
            const img = new Image();
            img.onload = () => {
              node._previewImage = img;
              node.setDirtyCanvas(true, true);
            };
            img.src = data.updatedimage;
          }
        })
        .catch((err) => {
          console.warn("Preview update failed", err);
        });
    }, 100);
  };
}

function createChannelSlider(node, inputChannel, color, onChange) {
  const channelKey = inputChannel.charAt(0).toLowerCase();
  const label = inputChannel;
  return new ChannelSliderWidget(
    node,
    `slider_${channelKey}`,
    0,
    (value) => {
      const outputChannel = node.properties.selected_channel;
      onChange(outputChannel, inputChannel, value);
      node.requestPreviewUpdate();
    },
    {
      label,
      color,
    }
  );
}

const DEFAULT_MIXER_VALUES = {
  Red: { r: 1.0, g: 0.0, b: 0.0 },
  Green: { r: 0.0, g: 1.0, b: 0.0 },
  Blue: { r: 0.0, g: 0.0, b: 1.0 },
};

app.registerExtension({
  name: "olm.color.channelmixer",

  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name !== "OlmChannelMixer") return;

    nodeType.prototype.getWidget = function (name) {
      return this.widgets.find((w) => w.name === name);
    };

    nodeType.prototype.getWidgetValue = function (name, fallback = null) {
      return this.widgets.find((w) => w.name === name)?.value || fallback;
    };

    nodeType.prototype.setWidgetValue = function (widgetName, val) {
      const widget = this.getWidget(widgetName);
      if (widget && val !== null && val !== undefined) {
        widget.value = val;
      }
    };

    nodeType.prototype.getWidgetValSafe = function (name) {
      const widget = this.getWidget(name);
      return widget ? widget.value : null;
    };

    this.resizable = true;
    this.properties = this.properties || {};

    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    const originalOnDrawForeground = nodeType.prototype.onDrawForeground;
    const originalOnConfigure = nodeType.prototype.onConfigure;
    const originalOnMouseDown = nodeType.prototype.onMouseDown;
    const originalOnMouseMove = nodeType.prototype.onMouseMove;
    const originalOnMouseUp = nodeType.prototype.onMouseUp;
    const originalOnMouseLeave = nodeType.prototype.onMouseLeave;
    const onExecutedOriginal = nodeType.prototype.onExecuted;

    nodeType.prototype.onNodeCreated = function () {
      originalOnNodeCreated?.call(this);

      const node = this;

      hideWidget(node.getWidget("version"), -60);

      hideDefaultWidgets(
        node,
        (w) => w.type === "number" || w.type === "slider"
      );

      initNodeProperties(node);

      node.requestPreviewUpdate = createPreviewUpdateFunction(node);
      node.custom_widgets = [];

      node.addWidget(
        "combo",
        "Output Channel",
        node.properties.selected_channel,
        (value) => {
          node.properties.selected_channel = value;
          node.updateSlidersUI();
        },
        { values: ["Red", "Green", "Blue"] }
      );

      const updateMixer = (output, input, val) =>
        updateMixerProperty(node, output, input, val);

      node.sliderR = createChannelSlider(node, "Red", "#ff0000", updateMixer);
      node.sliderG = createChannelSlider(node, "Green", "#00ff00", updateMixer);
      node.sliderB = createChannelSlider(node, "Blue", "#0000ff", updateMixer);
      node.custom_widgets.push(node.sliderR, node.sliderG, node.sliderB);

      node.addWidget("button", "Reset", "reset", () => {
        if (confirm("Reset all channel mixer values?")) {
          node.properties.mixer_values = JSON.parse(
            JSON.stringify(DEFAULT_MIXER_VALUES)
          );
          for (const outCh of ["Red", "Green", "Blue"]) {
            for (const inCh of ["Red", "Green", "Blue"]) {
              const c = inCh.charAt(0).toLowerCase();
              updateHiddenWidget(
                node,
                outCh,
                inCh,
                node.properties.mixer_values[outCh][c]
              );
            }
          }
          node.updateSlidersUI();
          node.requestPreviewUpdate();
        }
      });

      node.updateSlidersUI = () => {
        const selected = node.properties.selected_channel;
        const values = node.properties.mixer_values[selected];
        node.sliderR.setValue(values.r, true);
        node.sliderG.setValue(values.g, true);
        node.sliderB.setValue(values.b, true);
        node.setDirtyCanvas(true, true);
      };

      node.updateSlidersUI();
    };

    nodeType.prototype.computeSize = function (out) {
      let size = LiteGraph.LGraphNode.prototype.computeSize.call(this, out);
      const minWidth = 300;
      const minHeight = 580;
      size[0] = Math.max(minWidth, size[0]);
      size[1] = Math.max(minHeight, size[1]);
      return size;
    };

    nodeType.prototype.drawPreviewImage = function (ctx, previewY) {
      const availableHeight = this.size[1] - 260;
      const previewSize = Math.min(this.size[0] * 0.95, availableHeight);
      const previewCenterX = this.size[0] / 2.0;
      const y = previewY;
      if (this._previewImage && this._previewImage.complete) {
        const img = this._previewImage;
        const aspect = img.width / img.height;
        let drawWidth, drawHeight;
        if (aspect >= 1) {
          drawWidth = previewSize;
          drawHeight = previewSize / aspect;
        } else {
          drawHeight = previewSize;
          drawWidth = previewSize * aspect;
        }
        const drawX = previewCenterX - drawWidth / 2;
        const drawY = y + (previewSize - drawHeight) / 2;
        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
        ctx.strokeStyle = "#888";
        ctx.lineWidth = 1;
        ctx.strokeRect(drawX, drawY, drawWidth, drawHeight);
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = "#AAA";
        ctx.font = "12px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          "Run the graph once to generate preview.",
          previewCenterX,
          y + previewSize / 2 - 10
        );
        ctx.fillText(
          "Note: requires output connection to function.",
          previewCenterX,
          y + previewSize / 2 + 10
        );
        ctx.restore();
      }
    };

    nodeType.prototype.onDrawForeground = function (ctx) {
      originalOnDrawForeground?.call(this, ctx);
      if (this.flags.collapsed) return;
      ctx.save();
      const widgetHeight = this.widgets
        .filter((w) => !w.hidden && typeof w.computeSize === "function")
        .reduce((acc, w) => acc + w.computeSize([this.size[0]])[1], 0);
      const startY = widgetHeight + 50;
      const sliderSpacing = 40;
      [this.sliderR, this.sliderG, this.sliderB].forEach((slider, i) => {
        slider.width = this.size[0] * 0.85;
        slider.x = this.size[0] / 2.0 - slider.width / 2.0;
        slider.y = startY + i * sliderSpacing;
        ctx.save();
        ctx.translate(slider.x, slider.y);
        slider.draw(ctx);
        ctx.restore();
      });
      const previewY = startY + 3 * sliderSpacing + 75;
      this.drawPreviewImage(ctx, previewY);
      ctx.restore();
    };

    nodeType.prototype.onMouseDown = function (event, localPos, graphCanvas) {
      if (originalOnMouseDown?.call(this, event, localPos, graphCanvas))
        return true;
      if (this.custom_widgets) {
        for (const w of this.custom_widgets) {
          if (
            typeof w.onMouseDown === "function" &&
            w.onMouseDown(event, localPos)
          )
            return true;
        }
      }
      return false;
    };

    nodeType.prototype.onMouseMove = function (event, localPos, graphCanvas) {
      if (originalOnMouseMove?.call(this, event, localPos, graphCanvas))
        return true;
      if (this.custom_widgets) {
        for (const w of this.custom_widgets) {
          if (
            typeof w.onMouseMove === "function" &&
            w.onMouseMove(event, localPos)
          )
            return true;
        }
      }
      return false;
    };

    nodeType.prototype.onMouseUp = function (event, localPos, graphCanvas) {
      if (originalOnMouseUp?.call(this, event, localPos, graphCanvas))
        return true;
      if (this.custom_widgets) {
        for (const w of this.custom_widgets) {
          if (typeof w.onMouseUp === "function" && w.onMouseUp(event, localPos))
            return true;
        }
      }
      return false;
    };

    nodeType.prototype.onMouseLeave = function (event, localPos, graphCanvas) {
      if (originalOnMouseLeave?.call(this, event, localPos, graphCanvas))
        return true;
      if (this.custom_widgets) {
        for (const w of this.custom_widgets) {
          if (
            typeof w.onMouseUp === "function" &&
            w.onMouseUp &&
            w.onMouseUp(event, localPos)
          ) {
            return true;
          }
        }
      }
      return false;
    };

    nodeType.prototype.onConfigure = function (info) {
      originalOnConfigure?.call(this, info);
      if (this.properties.mixer_values) {
        queueMicrotask(() => {
          if (this.updateSlidersUI) {
            this.updateSlidersUI();
          }
        });
      }
      if (this.widgets) {
        for (const outCh of ["Red", "Green", "Blue"]) {
          for (const inCh of ["Red", "Green", "Blue"]) {
            const key = `${inCh.toLowerCase()}_in_${outCh.toLowerCase()}`;
            const widget = this.widgets.find((w) => w.name === key);
            if (widget) {
              const c = inCh.charAt(0).toLowerCase();
              this.properties.mixer_values[outCh][c] = widget.value;
            }
          }
        }
      }
      removeInputs(
        this,
        (input) =>
          input.type === "FLOAT" ||
          input.type === "STRING" ||
          input.type === "BOOLEAN"
      );
      this.forceUpdate();
    };

    nodeType.prototype.onAdded = function () {
      removeInputs(
        this,
        (input) =>
          input.type === "FLOAT" ||
          input.type === "STRING" ||
          input.type === "BOOLEAN"
      );
    };

    nodeType.prototype.forceUpdate = function () {
      const version_widget = this.getWidget("version");
      if (version_widget) {
        version_widget.value = Date.now();
      }
    };

    nodeType.prototype.onExecuted = function (message) {
      onExecutedOriginal?.apply(this, arguments);
      let key = message?.cache_key;
      if (Array.isArray(key)) key = key.join("");
      if (typeof key === "string") {
        this.previewCacheKey = key;
        this.requestPreviewUpdate();
      } else {
        console.warn(
          `[OlmChannelMixer] Node ${this.id}: Invalid cache key in onExecuted:`,
          key
        );
      }
    };
  },
});
