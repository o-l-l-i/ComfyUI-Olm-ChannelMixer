export class ChannelSliderWidget {
  constructor(node, name, value, callback, options = {}) {
    this.node = node;
    this.name = name;
    this.value = value;
    this.callback = callback;

    this.options = {
      min: -2.0,
      max: 2.0,
      label: name,
      color: "#4A4A4A",
      ...options,
    };

    this.dragging = false;
    this.x = 0;
    this.y = 0;
    this.width = 250;
    this.height = 30;
  }

  draw(ctx) {
    const sliderHeight = 12;
    const knobRadius = 8;
    const x = 0;
    const y = this.height / 2;

    ctx.font = "12px Arial";
    ctx.fillStyle = "#ddd";
    ctx.textAlign = "left";
    ctx.fillText(this.options.label, x, y - 10);

    const gradient = ctx.createLinearGradient(x, y, x + this.width, y);
    gradient.addColorStop(0, "#111");
    gradient.addColorStop(0.5, this.options.color);
    gradient.addColorStop(1, "#fff");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.roundRect(x, y, this.width, sliderHeight, 4);
    ctx.fill();

    const normalizedValue =
      (this.value - this.options.min) / (this.options.max - this.options.min);
    const fillWidth = normalizedValue * this.width;

    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    ctx.beginPath();
    ctx.roundRect(x, y, fillWidth, sliderHeight, 4);
    ctx.fill();

    const knobX = fillWidth;
    ctx.beginPath();
    ctx.arc(knobX, y + sliderHeight / 2, knobRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = "12px Arial";
    ctx.fillStyle = "#ddd";
    ctx.textAlign = "right";
    ctx.fillText(`${(this.value * 100).toFixed(0)}%`, this.width, y - 10);
  }

  onMouseDown(event, localPos) {
    const { x, y } = this.getLocalMouse(localPos);
    if (x >= 0 && x <= this.width && y >= 0 && y <= this.height) {
      this.dragging = true;
      this.updateValue(x);
      this.node.setDirtyCanvas(true, true);
      return true;
    }
    return false;
  }

  onMouseMove(event, localPos) {
    if (!this.dragging) return false;
    if (event.buttons !== 1) {
      this.onMouseUp();
      return false;
    }
    const { x } = this.getLocalMouse(localPos);
    this.updateValue(x);
    this.node.setDirtyCanvas(true, true);
    return true;
  }

  onMouseUp() {
    if (this.dragging) {
      this.dragging = false;
      this.node.setDirtyCanvas(true, true);
      return true;
    }
    return false;
  }

  getLocalMouse(localPos) {
    return {
      x: localPos[0] - this.x,
      y: localPos[1] - this.y,
    };
  }

  updateValue(x) {
    const clampedX = Math.max(0, Math.min(x, this.width));
    const normalized = clampedX / this.width;
    this.value =
      normalized * (this.options.max - this.options.min) + this.options.min;
    this.value = Math.max(
      this.options.min,
      Math.min(this.value, this.options.max)
    );

    if (this.callback) {
      this.callback(this.value);
    }
  }

  setValue(newValue, silent = false) {
    this.value = Math.max(
      this.options.min,
      Math.min(newValue, this.options.max)
    );
    if (!silent && this.callback) {
      this.callback(this.value);
    }
    this.node.setDirtyCanvas(true, true);
  }
}
