/**
 * Core classes for the Digital Logic Simulator: Pin, Wire, Component, and Circuit.
 */

export class Pin {
    /**
     * @param {string} id
     * @param {string} name - label (e.g. "A", "B", "Q")
     * @param {string} type - "input" or "output"
     * @param {Component} component - parent component reference
     */
    constructor(id, name, type, component) {
        this.id = id;
        this.name = name;
        this.type = type;
        this.component = component;
        this.value = 0; // default state is LOW (0)
        this.visualValue = 0; // visual animated state

        // Relative coordinates from component center (for canvas rendering)
        this.relX = 0;
        this.relY = 0;

        // Side assigned for custom chips ("left", "right", "top", "bottom")
        this.side = type === "input" ? "left" : "right";
    }
}

export class Wire {
    /**
     * @param {string} id
     * @param {Pin} fromPin - Source Pin (output type)
     * @param {Pin} toPin - Target Pin (input type)
     * @param {string|null} color - Custom color for this wire (default is null)
     */
    constructor(id, fromPin, toPin, color = null) {
        this.id = id;
        this.fromPin = fromPin;
        this.toPin = toPin;
        this.color = color;
        this.isManuallyRouted = false; // default is false (uses automatic Manhattan)

        // Custom control points or intermediate vertices for Manhattan routing
        this.points = [];
    }

    /**
     * Get the current logic value of the wire (derived from fromPin).
     */
    get value() {
        return this.fromPin ? this.fromPin.value : 0;
    }

    /**
     * Get the visual animated value of the wire (derived from fromPin's visualValue).
     */
    get visualValue() {
        return this.fromPin ? (this.fromPin.visualValue !== undefined ? this.fromPin.visualValue : this.fromPin.value) : 0;
    }
}

export class Component {
    /**
     * @param {string} id
     * @param {string} type
     * @param {number} x
     * @param {number} y
     */
    constructor(id, type, x = 0, y = 0) {
        this.id = id;
        this.type = type;
        this.x = x;
        this.y = y;
        this.width = 60;
        this.height = 40;
        this.rotation = 0; // 0, 90, 180, 270 degrees
        this.flipX = false;
        this.flipY = false;

        /** @type {Pin[]} */
        this.inputs = [];
        /** @type {Pin[]} */
        this.outputs = [];

        this.label = ""; // Optional user-assigned label
    }

    /**
     * Add an input pin.
     */
    addInput(id, name) {
        const pin = new Pin(id, name, "input", this);
        this.inputs.push(pin);
        return pin;
    }

    /**
     * Add an output pin.
     */
    addOutput(id, name) {
        const pin = new Pin(id, name, "output", this);
        this.outputs.push(pin);
        return pin;
    }

    /**
     * Evaluate output values based on input values. Override in subclasses.
     */
    evaluate() {
        // Base component does nothing
    }

    /**
     * Get the absolute rotated position of a given pin, accounting for horizontal/vertical flips.
     */
    getPinAbsolutePosition(pin) {
        const rx = this.flipX ? -pin.relX : pin.relX;
        const ry = this.flipY ? -pin.relY : pin.relY;

        const rad = (this.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        return {
            x: this.x + rx * cos - ry * sin,
            y: this.y + rx * sin + ry * cos
        };
    }

    /**
     * Returns the bounding box of the component. Accounts for rotation dimensions swap!
     */
    boundingBox() {
        const isOrthogonal = (this.rotation === 90 || this.rotation === 270);
        const w = isOrthogonal ? this.height : this.width;
        const h = isOrthogonal ? this.width : this.height;
        return {
            x: this.x - w / 2,
            y: this.y - h / 2,
            width: w,
            height: h
        };
    }

    /**
     * Returns all pins.
     */
    pins() {
        return [...this.inputs, ...this.outputs];
    }

    /**
     * Draw the component.
     */
    draw(ctx, isSelected) {
        ctx.save();

        // Translate to component center and rotate!
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        // Shadow / Glow if selected
        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#00adb5";
            ctx.strokeStyle = "#00adb5";
            ctx.lineWidth = 2;
        } else {
            ctx.strokeStyle = "#4e4e4e";
            ctx.lineWidth = 1.5;
        }

        ctx.fillStyle = "#2a2a2a";
        ctx.beginPath();
        // Draw relative to center (0, 0)
        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 5);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Draw text label
        ctx.fillStyle = "#ffffff";
        ctx.font = "12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.label || this.type, 0, 0);

        ctx.restore();

        // Draw Pins (needs to draw in absolute space using absolute pin helper!)
        this.drawPins(ctx);
    }

    /**
     * Helper to draw pin connection circles on canvas.
     */
    drawPins(ctx) {
        const allPins = this.pins();
        for (const pin of allPins) {
            const pos = this.getPinAbsolutePosition(pin);

            ctx.beginPath();
            ctx.arc(pos.x, pos.y, 4, 0, 2 * Math.PI);
            ctx.fillStyle = pin.value === 1 ? "#39ff14" : "#4e4e4e"; // Glowing green for HIGH state
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1;
            ctx.fill();
            ctx.stroke();
        }
    }
}

export class Circuit {
    constructor() {
        /** @type {Map<string, Component>} */
        this.components = new Map();
        /** @type {Map<string, Wire>} */
        this.wires = new Map();
    }

    addComponent(comp) {
        this.components.set(comp.id, comp);
    }

    removeComponent(id) {
        // Remove connected wires first
        const comp = this.components.get(id);
        if (!comp) return;

        const pinIds = new Set(comp.pins().map(p => p.id));
        for (const [wireId, wire] of this.wires.entries()) {
            if (pinIds.has(wire.fromPin.id) || pinIds.has(wire.toPin.id)) {
                this.wires.delete(wireId);
            }
        }
        this.components.delete(id);
    }

    addWire(wire) {
        this.wires.set(wire.id, wire);
    }

    removeWire(id) {
        this.wires.delete(id);
    }

    clear() {
        this.components.clear();
        this.wires.clear();
    }
}
