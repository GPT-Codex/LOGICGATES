import { Component } from "./core.js";

// Beautiful Color Themes for different components (skins)
export const SKINS = {
    INPUT_OUTPUT: { bg: "#4a3c1c", border: "#f39c12", text: "#f1c40f" }, // Warm Yellow / Gold
    CONST_HIGH: { bg: "#1a4a1c", border: "#2ecc71", text: "#2ecc71" },    // Vibrant Green
    CONST_LOW: { bg: "#4a1c1c", border: "#e74c3c", text: "#e74c3c" },     // Deep Red
    CLOCK: { bg: "#1c3c4a", border: "#3498db", text: "#3498db" },         // Cool Blue
    NOT: { bg: "#5c2a18", border: "#e67e22", text: "#e67e22" },           // Vivid Orange-Red
    AND_NAND: { bg: "#1b4d3e", border: "#27ae60", text: "#2ecc71" },      // Forest Green
    OR_NOR: { bg: "#1a2c5a", border: "#2980b9", text: "#3498db" },        // Deep Sky Blue
    XOR_XNOR: { bg: "#3e1a5a", border: "#8e44ad", text: "#9b59b6" },      // Purple / Violet
    BUFFER: { bg: "#113f43", border: "#16a085", text: "#1abc9c" }         // Cool Cyan/Teal
};

/**
 * Helper to draw a standard logic gate symbol body (American National Standards / IEEE format-like curves)
 * or beautiful stylized card shapes.
 */
function drawStyledGate(ctx, bbox, type, skin, isSelected, flipX = false, flipY = false) {
    ctx.save();
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    if (isSelected) {
        ctx.shadowBlur = 12;
        ctx.shadowColor = skin.border;
        ctx.strokeStyle = skin.border;
        ctx.lineWidth = 2.5;
    } else {
        ctx.strokeStyle = skin.border;
        ctx.lineWidth = 1.8;
    }

    ctx.fillStyle = skin.bg;

    const x = bbox.x;
    const y = bbox.y;
    const w = bbox.width;
    const h = bbox.height;

    ctx.beginPath();
    if (type === "AND" || type === "NAND") {
        ctx.moveTo(x, y);
        ctx.lineTo(x + w * 0.5, y);
        ctx.arc(x + w * 0.5, y + h * 0.5, h * 0.5, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(x, y + h);
        ctx.closePath();
    } else if (type === "OR" || type === "NOR") {
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + w * 0.2, y + h * 0.5, x, y + h);
        ctx.quadraticCurveTo(x + w * 0.6, y + h, x + w, y + h * 0.5);
        ctx.quadraticCurveTo(x + w * 0.6, y, x, y);
        ctx.closePath();
    } else if (type === "XOR" || type === "XNOR") {
        ctx.moveTo(x + 5, y);
        ctx.quadraticCurveTo(x + w * 0.2 + 5, y + h * 0.5, x + 5, y + h);
        ctx.lineTo(x, y + h);
        ctx.quadraticCurveTo(x + w * 0.2, y + h * 0.5, x, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x + 5, y);
        ctx.quadraticCurveTo(x + w * 0.2 + 5, y + h * 0.5, x + 5, y + h);
        ctx.quadraticCurveTo(x + w * 0.6, y + h, x + w, y + h * 0.5);
        ctx.quadraticCurveTo(x + w * 0.6, y, x + 5, y);
        ctx.closePath();
    } else {
        ctx.roundRect(x, y, w, h, 6);
    }

    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

export class InputGate extends Component {
    constructor(id, x, y) {
        super(id, "Input", x, y);
        this.width = 50;
        this.height = 30;
        this.stateValue = 0; // Starts at LOW

        const outPin = this.addOutput(`${id}_out`, "Q");
        outPin.relX = 25;
        outPin.relY = 0;
    }

    evaluate() {
        this.outputs[0].value = this.stateValue;
    }

    toggle() {
        this.stateValue = this.stateValue === 1 ? 0 : 1;
        this.evaluate();
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.INPUT_OUTPUT;
        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = skin.border;
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 1.5;
        }

        ctx.fillStyle = this.stateValue === 1 ? "#d4ac0d" : skin.bg;
        ctx.beginPath();
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = this.stateValue === 1 ? "#000000" : "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.label || `In: ${this.stateValue}`, 0, 0);
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class OutputGate extends Component {
    constructor(id, x, y) {
        super(id, "Output", x, y);
        this.width = 50;
        this.height = 30;

        const inPin = this.addInput(`${id}_in`, "D");
        inPin.relX = -25;
        inPin.relY = 0;
    }

    evaluate() {
        // Displays input value
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.INPUT_OUTPUT;
        const val = this.inputs[0].value;

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = skin.border;
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 1.5;
        }

        ctx.fillStyle = val === 1 ? "#2ecc71" : "#2a2a2a"; // Glow bright green if active HIGH
        ctx.beginPath();
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = val === 1 ? "#000000" : "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.label || `Out: ${val}`, 0, 0);
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class ConstantHIGHGate extends Component {
    constructor(id, x, y) {
        super(id, "Constant HIGH", x, y);
        this.width = 40;
        this.height = 30;

        const outPin = this.addOutput(`${id}_out`, "1");
        outPin.relX = 20;
        outPin.relY = 0;
        outPin.value = 1;
    }

    evaluate() {
        this.outputs[0].value = 1;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.CONST_HIGH;
        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = skin.border;
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 1.5;
        }
        ctx.fillStyle = skin.bg;
        ctx.beginPath();
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = skin.text;
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("HIGH", 0, 0);
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class ConstantLOWGate extends Component {
    constructor(id, x, y) {
        super(id, "Constant LOW", x, y);
        this.width = 40;
        this.height = 30;

        const outPin = this.addOutput(`${id}_out`, "0");
        outPin.relX = 20;
        outPin.relY = 0;
        outPin.value = 0;
    }

    evaluate() {
        this.outputs[0].value = 0;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.CONST_LOW;
        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = skin.border;
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 1.5;
        }
        ctx.fillStyle = skin.bg;
        ctx.beginPath();
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = skin.text;
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("LOW", 0, 0);
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class ClockGate extends Component {
    constructor(id, x, y) {
        super(id, "Clock", x, y);
        this.width = 50;
        this.height = 30;
        this.stateValue = 0;
        this.frequencyValue = 1; // default 1 Hz
        this.frequencyUnit = "Hz"; // default Hz
        this.frequency = 1; // calculated Hz

        const outPin = this.addOutput(`${id}_out`, "CLK");
        outPin.relX = 25;
        outPin.relY = 0;

        this.updateFrequency();
    }

    updateFrequency() {
        let mult = 1;
        if (this.frequencyUnit === "kHz") mult = 1e3;
        else if (this.frequencyUnit === "MHz") mult = 1e6;
        else if (this.frequencyUnit === "GHz") mult = 1e9;

        let hz = this.frequencyValue * mult;
        if (hz > 10e9) {
            hz = 10e9;
            this.frequencyValue = 10;
            this.frequencyUnit = "GHz";
        }
        this.frequency = hz;
    }

    evaluate() {
        this.outputs[0].value = this.stateValue;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.CLOCK;
        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = skin.border;
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 1.5;
        }
        ctx.fillStyle = skin.bg;
        ctx.beginPath();
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();

        ctx.strokeStyle = skin.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-12, 4);
        ctx.lineTo(-6, 4);
        ctx.lineTo(-6, -4);
        ctx.lineTo(0, -4);
        ctx.lineTo(0, 4);
        ctx.lineTo(6, 4);
        ctx.lineTo(6, -4);
        ctx.lineTo(12, -4);
        ctx.stroke();
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class BufferGate extends Component {
    constructor(id, x, y) {
        super(id, "Buffer", x, y);
        this.width = 50;
        this.height = 40;

        const inPin = this.addInput(`${id}_in`, "A");
        inPin.relX = -25;
        inPin.relY = 0;

        const outPin = this.addOutput(`${id}_out`, "Y");
        outPin.relX = 25;
        outPin.relY = 0;
    }

    evaluate() {
        this.outputs[0].value = this.inputs[0].value;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.BUFFER;
        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = skin.border;
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 1.5;
        }
        ctx.fillStyle = skin.bg;

        ctx.beginPath();
        ctx.moveTo(-this.width / 2, -this.height / 2);
        ctx.lineTo(this.width / 2, 0);
        ctx.lineTo(-this.width / 2, this.height / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("BUF", -5, 0);
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class NOTGate extends Component {
    constructor(id, x, y) {
        super(id, "NOT", x, y);
        this.width = 55;
        this.height = 40;

        const inPin = this.addInput(`${id}_in`, "A");
        inPin.relX = -27.5;
        inPin.relY = 0;

        const outPin = this.addOutput(`${id}_out`, "Y");
        outPin.relX = 27.5;
        outPin.relY = 0;
    }

    evaluate() {
        this.outputs[0].value = this.inputs[0].value === 1 ? 0 : 1;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.NOT;
        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = skin.border;
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = skin.border;
            ctx.lineWidth = 1.5;
        }
        ctx.fillStyle = skin.bg;

        ctx.beginPath();
        ctx.moveTo(-this.width / 2, -this.height / 2);
        ctx.lineTo(this.width / 2 - 8, 0);
        ctx.lineTo(-this.width / 2, this.height / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(this.width / 2 - 4, 0, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("NOT", -6, 0);
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class ANDGate extends Component {
    constructor(id, x, y) {
        super(id, "AND", x, y);
        this.width = 60;
        this.height = 40;

        const inA = this.addInput(`${id}_inA`, "A");
        inA.relX = -30;
        inA.relY = -10;

        const inB = this.addInput(`${id}_inB`, "B");
        inB.relX = -30;
        inB.relY = 10;

        const outPin = this.addOutput(`${id}_out`, "Y");
        outPin.relX = 30;
        outPin.relY = 0;
    }

    evaluate() {
        this.outputs[0].value = (this.inputs[0].value === 1 && this.inputs[1].value === 1) ? 1 : 0;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.AND_NAND;
        const bbox = { x: -this.width / 2, y: -this.height / 2, width: this.width, height: this.height };
        drawStyledGate(ctx, bbox, "AND", skin, isSelected, this.flipX, this.flipY);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("AND", -5, 0);
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class ORGate extends Component {
    constructor(id, x, y) {
        super(id, "OR", x, y);
        this.width = 60;
        this.height = 40;

        const inA = this.addInput(`${id}_inA`, "A");
        inA.relX = -30;
        inA.relY = -10;

        const inB = this.addInput(`${id}_inB`, "B");
        inB.relX = -30;
        inB.relY = 10;

        const outPin = this.addOutput(`${id}_out`, "Y");
        outPin.relX = 30;
        outPin.relY = 0;
    }

    evaluate() {
        this.outputs[0].value = (this.inputs[0].value === 1 || this.inputs[1].value === 1) ? 1 : 0;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.OR_NOR;
        const bbox = { x: -this.width / 2, y: -this.height / 2, width: this.width, height: this.height };
        drawStyledGate(ctx, bbox, "OR", skin, isSelected, this.flipX, this.flipY);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("OR", 0, 0);
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class XORGate extends Component {
    constructor(id, x, y) {
        super(id, "XOR", x, y);
        this.width = 65;
        this.height = 40;

        const inA = this.addInput(`${id}_inA`, "A");
        inA.relX = -32.5;
        inA.relY = -10;

        const inB = this.addInput(`${id}_inB`, "B");
        inB.relX = -32.5;
        inB.relY = 10;

        const outPin = this.addOutput(`${id}_out`, "Y");
        outPin.relX = 32.5;
        outPin.relY = 0;
    }

    evaluate() {
        this.outputs[0].value = (this.inputs[0].value !== this.inputs[1].value) ? 1 : 0;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.XOR_XNOR;
        const bbox = { x: -this.width / 2, y: -this.height / 2, width: this.width, height: this.height };
        drawStyledGate(ctx, bbox, "XOR", skin, isSelected, this.flipX, this.flipY);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("XOR", 3, 0);
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class NANDGate extends Component {
    constructor(id, x, y) {
        super(id, "NAND", x, y);
        this.width = 65;
        this.height = 40;

        const inA = this.addInput(`${id}_inA`, "A");
        inA.relX = -32.5;
        inA.relY = -10;

        const inB = this.addInput(`${id}_inB`, "B");
        inB.relX = -32.5;
        inB.relY = 10;

        const outPin = this.addOutput(`${id}_out`, "Y");
        outPin.relX = 32.5;
        outPin.relY = 0;
    }

    evaluate() {
        this.outputs[0].value = (this.inputs[0].value === 1 && this.inputs[1].value === 1) ? 0 : 1;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.AND_NAND;
        const bbox = { x: -this.width / 2, y: -this.height / 2, width: this.width - 6, height: this.height };
        drawStyledGate(ctx, bbox, "AND", skin, isSelected, this.flipX, this.flipY);

        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.strokeStyle = skin.border;
        ctx.lineWidth = 1.5;
        ctx.fillStyle = skin.bg;
        ctx.beginPath();
        ctx.arc(bbox.x + bbox.width + 3, 0, 3.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("NAND", -7, 0);
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class NORGate extends Component {
    constructor(id, x, y) {
        super(id, "NOR", x, y);
        this.width = 65;
        this.height = 40;

        const inA = this.addInput(`${id}_inA`, "A");
        inA.relX = -32.5;
        inA.relY = -10;

        const inB = this.addInput(`${id}_inB`, "B");
        inB.relX = -32.5;
        inB.relY = 10;

        const outPin = this.addOutput(`${id}_out`, "Y");
        outPin.relX = 32.5;
        outPin.relY = 0;
    }

    evaluate() {
        this.outputs[0].value = (this.inputs[0].value === 1 || this.inputs[1].value === 1) ? 0 : 1;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.OR_NOR;
        const bbox = { x: -this.width / 2, y: -this.height / 2, width: this.width - 6, height: this.height };
        drawStyledGate(ctx, bbox, "OR", skin, isSelected, this.flipX, this.flipY);

        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.strokeStyle = skin.border;
        ctx.lineWidth = 1.5;
        ctx.fillStyle = skin.bg;
        ctx.beginPath();
        ctx.arc(bbox.x + bbox.width + 3, 0, 3.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("NOR", -2, 0);
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class XNORGate extends Component {
    constructor(id, x, y) {
        super(id, "XNOR", x, y);
        this.width = 70;
        this.height = 40;

        const inA = this.addInput(`${id}_inA`, "A");
        inA.relX = -35;
        inA.relY = -10;

        const inB = this.addInput(`${id}_inB`, "B");
        inB.relX = -35;
        inB.relY = 10;

        const outPin = this.addOutput(`${id}_out`, "Y");
        outPin.relX = 35;
        outPin.relY = 0;
    }

    evaluate() {
        this.outputs[0].value = (this.inputs[0].value === this.inputs[1].value) ? 1 : 0;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const skin = SKINS.XOR_XNOR;
        const bbox = { x: -this.width / 2, y: -this.height / 2, width: this.width - 6, height: this.height };
        drawStyledGate(ctx, bbox, "XOR", skin, isSelected, this.flipX, this.flipY);

        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.strokeStyle = skin.border;
        ctx.lineWidth = 1.5;
        ctx.fillStyle = skin.bg;
        ctx.beginPath();
        ctx.arc(bbox.x + bbox.width + 3, 0, 3.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("XNOR", 1, 0);
        ctx.restore();

        this.drawPins(ctx);
    }
}

// --- NEW COMPONENT ADDITIONS ---

export class LEDGate extends Component {
    constructor(id, x, y) {
        super(id, "LED", x, y);
        this.width = 30;
        this.height = 30;
        this.ledColor = "Red"; // "Red", "Green", "Blue", "RGBA"
        this.rgbaValue = "rgba(255, 242, 0, 0.8)"; // Custom color if ledColor is RGBA

        const inPin = this.addInput(`${id}_in`, "In");
        inPin.relX = -15;
        inPin.relY = 0;
    }

    evaluate() {
        // Simple display element
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const isHigh = this.inputs[0].value === 1;

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#00adb5";
            ctx.strokeStyle = "#00adb5";
        } else {
            ctx.strokeStyle = "#4e4e4e";
        }

        ctx.fillStyle = "#222222";
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        let bulbColor = "#333333";
        if (isHigh) {
            if (this.ledColor === "Red") bulbColor = "#ff3838";
            else if (this.ledColor === "Green") bulbColor = "#2ecc71";
            else if (this.ledColor === "Blue") bulbColor = "#3498db";
            else bulbColor = this.rgbaValue; // Custom RGBA

            ctx.shadowBlur = 15;
            ctx.shadowColor = bulbColor;
        }

        ctx.fillStyle = bulbColor;
        ctx.beginPath();
        ctx.arc(0, 0, 9, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class FourDigitSevenSegmentGate extends Component {
    constructor(id, x, y) {
        super(id, "4-Digit 7-Segment Display", x, y);
        this.width = 180;
        this.height = 90;

        // 8 segment lines: a, b, c, d, e, f, g, dp
        // 4 digit select lines: DIG1, DIG2, DIG3, DIG4
        const segmentPins = ["a", "b", "c", "d", "e", "f", "g", "dp"];
        const digitPins = ["DIG1", "DIG2", "DIG3", "DIG4"];

        const allPinNames = [...segmentPins, ...digitPins];
        const pinCount = allPinNames.length;
        const spacing = 12;
        const startX = -((pinCount - 1) * spacing) / 2; // -66

        allPinNames.forEach((name, idx) => {
            const pin = this.addInput(`${id}_in_${name.toUpperCase()}`, name);
            pin.relX = startX + idx * spacing;
            pin.relY = 45;
        });
    }

    evaluate() {
        // Render only
    }

    draw(ctx, isSelected, options = {}) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        // Display Card background
        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#00adb5";
            ctx.strokeStyle = "#00adb5";
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = "#4e4e4e";
            ctx.lineWidth = 1.5;
        }
        ctx.fillStyle = "#111111";
        ctx.beginPath();
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();

        // Standard LED segment helper
        const drawSegment = (isActive, x1, y1, x2, y2) => {
            ctx.strokeStyle = isActive ? "#ff3838" : "#221111";
            ctx.lineWidth = 3;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        };

        // Inputs: 0..7 are segments a-g, dp. 8..11 are DIG1..DIG4.
        const segActive = this.inputs.slice(0, 8).map(p => p.value === 1);
        const digActive = this.inputs.slice(8, 12).map(p => p.value === 1);

        // Render 4 digits side by side (left to right: DIG1, DIG2, DIG3, DIG4)
        const digitOffsets = [-60, -20, 20, 60];

        digitOffsets.forEach((ox, dIdx) => {
            const isDigitOn = digActive[dIdx];
            const active = isDigitOn ? segActive : new Array(8).fill(false);

            drawSegment(active[0], ox - 8, -28, ox + 8, -28); // a
            drawSegment(active[1], ox + 8, -28, ox + 8, -5);   // b
            drawSegment(active[2], ox + 8, -1, ox + 8, 22);    // c
            drawSegment(active[3], ox - 8, 22, ox + 8, 22);   // d
            drawSegment(active[4], ox - 8, -1, ox - 8, 22);  // e
            drawSegment(active[5], ox - 8, -28, ox - 8, -5); // f
            drawSegment(active[6], ox - 8, -3, ox + 8, -3);   // g

            // DP
            ctx.fillStyle = active[7] ? "#ff3838" : "#221111";
            ctx.beginPath();
            ctx.arc(ox + 13, 22, 2, 0, 2 * Math.PI);
            ctx.fill();
        });

        // Draw pin labels above bottom pins if not suppressed by composite display
        if (!options.hidePinLabels) {
            ctx.fillStyle = "#888888";
            ctx.font = "bold 7px monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            this.inputs.forEach((pin) => {
                const rx = this.flipX ? -pin.relX : pin.relX;
                const ry = this.flipY ? -pin.relY : pin.relY;
                ctx.fillText(pin.name, rx, ry - 4);
            });
        }

        ctx.restore();

        this.drawPins(ctx);
    }
}

export class SevenSegmentGate extends Component {
    constructor(id, x, y) {
        super(id, "7-Segment Display", x, y);
        this.width = 100;
        this.height = 90;

        // 8 inputs: a, b, c, d, e, f, g, dp
        const pinNames = ["a", "b", "c", "d", "e", "f", "g", "dp"];
        const pinCount = pinNames.length;
        const spacing = 10;
        const startX = -((pinCount - 1) * spacing) / 2; // -35

        pinNames.forEach((name, idx) => {
            const pin = this.addInput(`${id}_in_${name.toUpperCase()}`, name);
            pin.relX = startX + idx * spacing;
            pin.relY = 45;
        });
    }

    evaluate() {
        // Render only
    }

    draw(ctx, isSelected, options = {}) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        // Display Card background
        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#00adb5";
            ctx.strokeStyle = "#00adb5";
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = "#4e4e4e";
            ctx.lineWidth = 1.5;
        }
        ctx.fillStyle = "#111111";
        ctx.beginPath();
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();

        // Standard LED segment color selection helper
        const drawSegment = (isActive, x1, y1, x2, y2) => {
            ctx.strokeStyle = isActive ? "#ff3838" : "#221111";
            ctx.lineWidth = 3.5;
            ctx.lineCap = "round";
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        };

        // 7 Segments drawing (a-g)
        // input indexes: 0:a, 1:b, 2:c, 3:d, 4:e, 5:f, 6:g, 7:dp
        const active = this.inputs.map(p => p.value === 1);

        drawSegment(active[0], -10, -28, 10, -28); // a
        drawSegment(active[1], 10, -28, 10, -5);   // b
        drawSegment(active[2], 10, -1, 10, 22);    // c
        drawSegment(active[3], -10, 22, 10, 22);   // d
        drawSegment(active[4], -10, -1, -10, 22);  // e
        drawSegment(active[5], -10, -28, -10, -5); // f
        drawSegment(active[6], -10, -3, 10, -3);   // g

        // DP (Decimal point)
        ctx.fillStyle = active[7] ? "#ff3838" : "#221111";
        ctx.beginPath();
        ctx.arc(16, 22, 2.5, 0, 2 * Math.PI);
        ctx.fill();

        // Draw pin labels above bottom pins if not suppressed by composite display
        if (!options.hidePinLabels) {
            ctx.fillStyle = "#888888";
            ctx.font = "bold 8px monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            this.inputs.forEach((pin) => {
                const rx = this.flipX ? -pin.relX : pin.relX;
                const ry = this.flipY ? -pin.relY : pin.relY;
                ctx.fillText(pin.name, rx, ry - 5);
            });
        }

        ctx.restore();

        this.drawPins(ctx);
    }
}

export class TenSegmentGate extends Component {
    constructor(id, x, y) {
        super(id, "10-Segment Display", x, y);
        this.width = 110;
        this.height = 40;

        for (let i = 1; i <= 10; i++) {
            const pin = this.addInput(`${id}_in_${i}`, `In${i}`);
            pin.relX = -45 + (i - 1) * 10;
            pin.relY = 20;
        }
    }

    evaluate() {
        // Render only
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#00adb5";
            ctx.strokeStyle = "#00adb5";
        } else {
            ctx.strokeStyle = "#4e4e4e";
        }
        ctx.fillStyle = "#111111";
        ctx.beginPath();
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();

        // Draw 10 horizontal display indicators
        for (let i = 0; i < 10; i++) {
            const isActive = this.inputs[i].value === 1;

            // Nice color assignment
            let col = "#221111"; // Dim
            if (isActive) {
                if (i < 5) col = "#2ecc71"; // Green
                else if (i < 8) col = "#f1c40f"; // Yellow
                else col = "#e74c3c"; // Red
            } else {
                if (i < 5) col = "#153321"; // Dark Green
                else if (i < 8) col = "#3a3311"; // Dark Yellow
                else col = "#3a1111"; // Dark Red
            }

            ctx.fillStyle = col;
            ctx.fillRect(-48 + i * 10, -10, 7, 20);
        }

        ctx.restore();

        this.drawPins(ctx);
    }
}

export class ButtonGate extends Component {
    constructor(id, x, y) {
        super(id, "Button", x, y);
        this.width = 50;
        this.height = 30;

        // Pins
        const inPin = this.addInput(`${id}_in`, "In"); // Power Input
        inPin.relX = -25;
        inPin.relY = 0;

        const outPin = this.addOutput(`${id}_out`, "Out"); // Signal Output
        outPin.relX = 25;
        outPin.relY = 0;

        // Custom states
        this.buttonMode = "press"; // "press" (Toggle) or "hold" (Momentary)
        this.holdDuration = 1000; // in milliseconds
        this.holdUnit = "ms"; // "ms" or "s"
        this.toggleState = false; // Toggle state (retained in Toggle mode)
        this.isPressed = false; // Is currently physically pressed down (either in hold mode or temporarily during mouse action)
    }

    evaluate() {
        // Electrical Behavior: Output reflects the input only when the button is in its active state (either toggled ON or momentarily pressed).
        const hasPower = this.inputs[0].value === 1;
        const isActiveState = (this.buttonMode === "press" && this.toggleState) || (this.buttonMode === "hold" && this.isPressed);

        this.outputs[0].value = (hasPower && isActiveState) ? 1 : 0;
    }

    triggerClick(engine) {
        if (this.buttonMode === "press") {
            // Press (Toggle) Mode
            this.toggleState = !this.toggleState;
            this.isPressed = true;
            this.evaluate();
            engine.propagatePin(this.outputs[0]);
            engine.propagate();
        } else {
            // Hold (Momentary) Mode
            this.isPressed = true;
            this.evaluate();
            engine.propagatePin(this.outputs[0]);
            engine.propagate();
        }
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        const isActive = (this.buttonMode === "press" && this.toggleState) || (this.buttonMode === "hold" && this.isPressed);
        const isPressedVisual = this.isPressed; // visual feedback of pressing

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#00adb5";
            ctx.strokeStyle = "#00adb5";
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = "#4e4e4e";
            ctx.lineWidth = 1.5;
        }

        // 1. Draw outer button casing (black/dark base with metallic highlight)
        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.fillStyle = "#1e1e1e";
        ctx.beginPath();
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();

        // 2. Draw actual inner push plunger
        let plungerCol = "#333333"; // OFF state
        if (isActive) {
            plungerCol = isPressedVisual ? "#00e676" : "#2ecc71"; // ON active states (Pressed glows brighter green)
        } else if (isPressedVisual) {
            plungerCol = "#e74c3c"; // Pressed but no power: glows red
        }

        ctx.fillStyle = plungerCol;
        ctx.beginPath();
        // Shift slightly in position if visually pressed to simulate depth!
        const shiftY = isPressedVisual ? 1 : 0;
        ctx.roundRect(-this.width / 2 + 6, -this.height / 2 + 6 + shiftY, this.width - 12, this.height - 12, 4);
        ctx.fill();
        ctx.restore();

        // 3. Draw text label centered
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.label || "BTN", 0, 0);

        ctx.restore();

        this.drawPins(ctx);
    }
}

export class NPNTransistorGate extends Component {
    constructor(id, x, y) {
        super(id, "NPN Transistor", x, y);
        this.width = 60;
        this.height = 50;

        const inC = this.addInput(`${id}_inC`, "C"); // Collector (input)
        inC.relX = -30;
        inC.relY = -15;

        const inB = this.addInput(`${id}_inB`, "B"); // Base (control)
        inB.relX = -30;
        inB.relY = 0;

        const outE = this.addOutput(`${id}_outE`, "E"); // Emitter (output)
        outE.relX = 30;
        outE.relY = 15;
    }

    evaluate() {
        const collVal = this.inputs[0].value;
        const baseVal = this.inputs[1].value;
        // Digital switch abstraction for NPN:
        // Base controls conduction between Collector and Emitter.
        // Base = 1 (HIGH) -> C-E path ON (Emitter = Collector)
        // Base = 0 (LOW)  -> C-E path OFF (Emitter = 0)
        this.outputs[0].value = (baseVal === 1) ? collVal : 0;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#00adb5";
            ctx.strokeStyle = "#00adb5";
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = "#4e4e4e";
            ctx.lineWidth = 1.5;
        }

        ctx.fillStyle = "#1e1e1e";
        ctx.beginPath();
        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Draw schematic representation of NPN transistor inside
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;

        // Vertical Base plate line
        ctx.beginPath();
        ctx.moveTo(-10, -14);
        ctx.lineTo(-10, 14);
        ctx.stroke();

        // Base connection line (from -30 to -10)
        ctx.beginPath();
        ctx.moveTo(-30, 0);
        ctx.lineTo(-10, 0);
        ctx.stroke();

        // Collector line (from -30, -15 to -10, -8)
        ctx.beginPath();
        ctx.moveTo(-30, -15);
        ctx.lineTo(-10, -8);
        ctx.stroke();

        // Emitter line (from -10, 8 to 30, 15)
        ctx.beginPath();
        ctx.moveTo(-10, 8);
        ctx.lineTo(30, 15);
        ctx.stroke();

        // NPN Arrow on emitter pointing away from base (towards E terminal)
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(10, 11.5);
        ctx.lineTo(18, 13);
        ctx.lineTo(13, 7.5);
        ctx.closePath();
        ctx.fill();

        // Header label
        ctx.fillStyle = "#00adb5";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("NPN", 5, -14);

        // Terminal labels B, C, E
        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "left";
        ctx.fillText("C", -22, -15);
        ctx.fillText("B", -22, 0);

        ctx.textAlign = "right";
        ctx.fillText("E", 22, 15);

        ctx.restore();

        this.drawPins(ctx);
    }
}

export class PNPTransistorGate extends Component {
    constructor(id, x, y) {
        super(id, "PNP Transistor", x, y);
        this.width = 60;
        this.height = 50;

        const inC = this.addInput(`${id}_inC`, "C"); // Collector (input)
        inC.relX = -30;
        inC.relY = -15;

        const inB = this.addInput(`${id}_inB`, "B"); // Base (control)
        inB.relX = -30;
        inB.relY = 0;

        const outE = this.addOutput(`${id}_outE`, "E"); // Emitter (output)
        outE.relX = 30;
        outE.relY = 15;
    }

    evaluate() {
        const collVal = this.inputs[0].value;
        const baseVal = this.inputs[1].value;
        // Complementary digital switch abstraction for PNP:
        // Base controls conduction between Collector and Emitter.
        // Base = 0 (LOW)  -> C-E path ON (Emitter = Collector)
        // Base = 1 (HIGH) -> C-E path OFF (Emitter = 0)
        this.outputs[0].value = (baseVal === 0) ? collVal : 0;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#00adb5";
            ctx.strokeStyle = "#00adb5";
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = "#4e4e4e";
            ctx.lineWidth = 1.5;
        }

        ctx.fillStyle = "#1e1e1e";
        ctx.beginPath();
        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Draw schematic representation of PNP transistor inside
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;

        // Vertical Base plate line
        ctx.beginPath();
        ctx.moveTo(-10, -14);
        ctx.lineTo(-10, 14);
        ctx.stroke();

        // Base connection line
        ctx.beginPath();
        ctx.moveTo(-30, 0);
        ctx.lineTo(-10, 0);
        ctx.stroke();

        // Collector line
        ctx.beginPath();
        ctx.moveTo(-30, -15);
        ctx.lineTo(-10, -8);
        ctx.stroke();

        // Emitter line
        ctx.beginPath();
        ctx.moveTo(-10, 8);
        ctx.lineTo(30, 15);
        ctx.stroke();

        // PNP Arrow on emitter pointing towards Base (from E terminal towards base)
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(-2, 9.5);
        ctx.lineTo(-8, 7);
        ctx.lineTo(-4, 13);
        ctx.closePath();
        ctx.fill();

        // Header label
        ctx.fillStyle = "#00adb5";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("PNP", 5, -14);

        // Terminal labels B, C, E
        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "left";
        ctx.fillText("C", -22, -15);
        ctx.fillText("B", -22, 0);

        ctx.textAlign = "right";
        ctx.fillText("E", 22, 15);

        ctx.restore();

        this.drawPins(ctx);
    }
}

/**
 * Mapping of component types to their constructor classes.
 */
export class DFFGate extends Component {
    constructor(id, x, y) {
        super(id, "DFF", x, y);
        this.width = 60;
        this.height = 50;

        // Inputs: D, CLK
        const inD = this.addInput(`${id}_inD`, "D");
        inD.relX = -30;
        inD.relY = -12;

        const inCLK = this.addInput(`${id}_inCLK`, "CLK");
        inCLK.relX = -30;
        inCLK.relY = 12;

        // Outputs: Q, /Q
        const outQ = this.addOutput(`${id}_outQ`, "Q");
        outQ.relX = 30;
        outQ.relY = -12;

        const outQBar = this.addOutput(`${id}_outQBar`, "/Q");
        outQBar.relX = 30;
        outQBar.relY = 12;

        // Internal sequential state
        this.storedState = 0; // Q initial state = 0
        this.prevClk = 0;

        // Evaluate initial outputs
        this.outputs[0].value = 0; // Q
        this.outputs[1].value = 1; // /Q
    }

    evaluate() {
        const currentD = this.inputs[0].value === 1 ? 1 : 0;
        const currentClk = this.inputs[1].value === 1 ? 1 : 0;

        // Positive edge trigger detection: 0 -> 1 on CLK
        if (this.prevClk === 0 && currentClk === 1) {
            this.storedState = currentD;
        }
        this.prevClk = currentClk;

        this.outputs[0].value = this.storedState;
        this.outputs[1].value = this.storedState === 1 ? 0 : 1;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#3498db";
            ctx.strokeStyle = "#3498db";
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = "#4e4e4e";
            ctx.lineWidth = 1.5;
        }

        ctx.fillStyle = "#1e293b";
        ctx.beginPath();
        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();

        // Clock pin triangle symbol on CLK input
        ctx.strokeStyle = "#3498db";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-this.width / 2, 6);
        ctx.lineTo(-this.width / 2 + 8, 12);
        ctx.lineTo(-this.width / 2, 18);
        ctx.stroke();
        ctx.restore();

        // Pin labels inside box
        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("D", -this.width / 2 + 6, -12);
        ctx.fillText("CLK", -this.width / 2 + 10, 12);

        ctx.textAlign = "right";
        ctx.fillText("Q", this.width / 2 - 6, -12);
        ctx.fillText("/Q", this.width / 2 - 6, 12);

        // Center Component Title
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(this.label || "DFF", 0, 0);

        ctx.restore();

        this.drawPins(ctx);
    }
}

/**
 * Mapping of component types to their constructor classes.
 */
export class CounterGate extends Component {
    constructor(id, x, y, widthBits = 4) {
        super(id, "Counter", x, y);
        this.widthBits = Math.max(1, Math.min(64, widthBits));
        this.count = 0;
        this.prevClk = 0;

        this.rebuildCounterPins();
    }

    rebuildCounterPins() {
        this.inputs = [];
        this.outputs = [];

        const totalPinRows = Math.max(this.widthBits, 2);
        this.width = 100;
        this.height = Math.max(60, totalPinRows * 20 + 30);

        // Inputs: CLK, EN
        const clkPin = this.addInput(`${this.id}_in_CLK`, "CLK");
        clkPin.relX = -this.width / 2;
        clkPin.relY = -this.height / 2 + 20;

        const enPin = this.addInput(`${this.id}_in_EN`, "EN");
        enPin.relX = -this.width / 2;
        enPin.relY = -this.height / 2 + 40;
        enPin.value = 1; // Default EN HIGH when disconnected

        // Outputs: Q[0..N-1]
        for (let i = 0; i < this.widthBits; i++) {
            const pinName = this.widthBits === 1 ? "Q" : `Q[${i}]`;
            const pin = this.addOutput(`${this.id}_out_Q${i}`, pinName);
            pin.relX = this.width / 2;
            pin.relY = -this.height / 2 + 20 + i * 20;
            pin.value = (this.count >> i) & 1;
        }
    }

    setWidth(newWidth) {
        const w = Math.max(1, Math.min(64, parseInt(newWidth) || 4));
        if (w !== this.widthBits) {
            this.widthBits = w;
            const maxVal = Math.pow(2, this.widthBits);
            this.count = this.count % maxVal;
            this.rebuildCounterPins();
            this.evaluate();
        }
    }

    evaluate() {
        const clkPin = this.inputs[0];
        const enPin = this.inputs[1];

        const currentClk = clkPin ? (clkPin.value === 1 ? 1 : 0) : 0;
        // EN defaults to HIGH (1) if un-driven / not connected
        const enVal = enPin ? (enPin.value !== undefined ? enPin.value : 1) : 1;

        // Rising clock edge (0 -> 1)
        if (this.prevClk === 0 && currentClk === 1) {
            if (enVal === 1) {
                const maxCount = Math.pow(2, this.widthBits);
                this.count = (this.count + 1) % maxCount;
            }
        }
        this.prevClk = currentClk;

        for (let i = 0; i < this.widthBits; i++) {
            if (this.outputs[i]) {
                this.outputs[i].value = (this.count >> i) & 1;
            }
        }
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#3498db";
            ctx.strokeStyle = "#3498db";
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = "#4e4e4e";
            ctx.lineWidth = 1.5;
        }

        ctx.fillStyle = "#1e293b";
        ctx.beginPath();
        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();

        // Clock pin triangle symbol on CLK (-width/2, -height/2 + 20)
        const clkY = -this.height / 2 + 20;
        ctx.strokeStyle = "#3498db";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-this.width / 2, clkY - 5);
        ctx.lineTo(-this.width / 2 + 8, clkY);
        ctx.lineTo(-this.width / 2, clkY + 5);
        ctx.stroke();
        ctx.restore();

        // Title
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.label || `COUNT(${this.widthBits})`, 0, 0);

        // Draw pin labels inside box
        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 9px monospace";
        ctx.textBaseline = "middle";

        this.inputs.forEach(pin => {
            const rx = this.flipX ? -pin.relX : pin.relX;
            const ry = this.flipY ? -pin.relY : pin.relY;
            ctx.textAlign = "left";
            ctx.fillText(pin.name, rx + 10, ry);
        });

        this.outputs.forEach(pin => {
            const rx = this.flipX ? -pin.relX : pin.relX;
            const ry = this.flipY ? -pin.relY : pin.relY;
            ctx.textAlign = "right";
            ctx.fillText(pin.name, rx - 6, ry);
        });

        ctx.restore();

        this.drawPins(ctx);
    }
}

export class RegisterGate extends Component {
    constructor(id, x, y, widthBits = 8) {
        super(id, "Register", x, y);
        this.widthBits = Math.max(1, Math.min(256, widthBits));
        this.storedState = new Array(this.widthBits).fill(0);
        this.prevClk = 0;

        this.rebuildRegisterPins();
    }

    rebuildRegisterPins() {
        this.inputs = [];
        this.outputs = [];

        const totalPinRows = Math.max(this.widthBits, 2);
        this.width = 100;
        this.height = Math.max(60, totalPinRows * 20 + 30);

        // Inputs: D[0..N-1], CLK
        for (let i = 0; i < this.widthBits; i++) {
            const pinName = this.widthBits === 1 ? "D" : `D[${i}]`;
            const pin = this.addInput(`${this.id}_in_D${i}`, pinName);
            pin.relX = -this.width / 2;
            pin.relY = -this.height / 2 + 20 + i * 20;
        }

        const clkPin = this.addInput(`${this.id}_in_CLK`, "CLK");
        clkPin.relX = -this.width / 2;
        clkPin.relY = this.height / 2 - 15;

        // Outputs: Q[0..N-1]
        for (let i = 0; i < this.widthBits; i++) {
            const pinName = this.widthBits === 1 ? "Q" : `Q[${i}]`;
            const pin = this.addOutput(`${this.id}_out_Q${i}`, pinName);
            pin.relX = this.width / 2;
            pin.relY = -this.height / 2 + 20 + i * 20;
            pin.value = this.storedState[i] || 0;
        }
    }

    setWidth(newWidth) {
        const w = Math.max(1, Math.min(256, parseInt(newWidth) || 8));
        if (w !== this.widthBits) {
            this.widthBits = w;
            const oldState = this.storedState || [];
            this.storedState = new Array(this.widthBits).fill(0);
            for (let i = 0; i < Math.min(oldState.length, this.widthBits); i++) {
                this.storedState[i] = oldState[i];
            }
            this.rebuildRegisterPins();
            this.evaluate();
        }
    }

    evaluate() {
        // CLK is the last input pin
        const clkPin = this.inputs[this.inputs.length - 1];
        const currentClk = clkPin ? (clkPin.value === 1 ? 1 : 0) : 0;

        // Rising clock edge (0 -> 1)
        if (this.prevClk === 0 && currentClk === 1) {
            for (let i = 0; i < this.widthBits; i++) {
                this.storedState[i] = this.inputs[i].value === 1 ? 1 : 0;
            }
        }
        this.prevClk = currentClk;

        for (let i = 0; i < this.widthBits; i++) {
            if (this.outputs[i]) {
                this.outputs[i].value = this.storedState[i] || 0;
            }
        }
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#3498db";
            ctx.strokeStyle = "#3498db";
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = "#4e4e4e";
            ctx.lineWidth = 1.5;
        }

        ctx.fillStyle = "#1e293b";
        ctx.beginPath();
        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();

        // Clock pin triangle symbol on CLK
        const clkY = this.height / 2 - 15;
        ctx.strokeStyle = "#3498db";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-this.width / 2, clkY - 5);
        ctx.lineTo(-this.width / 2 + 8, clkY);
        ctx.lineTo(-this.width / 2, clkY + 5);
        ctx.stroke();
        ctx.restore();

        // Title
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.label || `REG(${this.widthBits})`, 0, 0);

        // Draw pin labels inside box
        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 9px monospace";
        ctx.textBaseline = "middle";

        this.inputs.forEach(pin => {
            const rx = this.flipX ? -pin.relX : pin.relX;
            const ry = this.flipY ? -pin.relY : pin.relY;
            ctx.textAlign = "left";
            ctx.fillText(pin.name, rx + 10, ry);
        });

        this.outputs.forEach(pin => {
            const rx = this.flipX ? -pin.relX : pin.relX;
            const ry = this.flipY ? -pin.relY : pin.relY;
            ctx.textAlign = "right";
            ctx.fillText(pin.name, rx - 6, ry);
        });

        ctx.restore();

        this.drawPins(ctx);
    }
}

export class ComparatorGate extends Component {
    constructor(id, x, y, widthBits = 4) {
        super(id, "Comparator", x, y);
        this.widthBits = Math.max(1, Math.min(16, widthBits));
        this.rebuildComparatorPins();
    }

    rebuildComparatorPins() {
        this.inputs = [];
        this.outputs = [];

        const totalRows = Math.max(this.widthBits * 2, 3);
        this.width = 110;
        this.height = Math.max(60, totalRows * 18 + 20);

        // Inputs: A[0..N-1] and B[0..N-1]
        for (let i = 0; i < this.widthBits; i++) {
            const pinName = this.widthBits === 1 ? "A" : `A[${i}]`;
            const pin = this.addInput(`${this.id}_in_A${i}`, pinName);
            pin.relX = -this.width / 2;
            pin.relY = -this.height / 2 + 18 + i * 18;
        }

        for (let i = 0; i < this.widthBits; i++) {
            const pinName = this.widthBits === 1 ? "B" : `B[${i}]`;
            const pin = this.addInput(`${this.id}_in_B${i}`, pinName);
            pin.relX = -this.width / 2;
            pin.relY = -this.height / 2 + 18 + (this.widthBits + i) * 18;
        }

        // Outputs: EQ, GT, LT
        const eqPin = this.addOutput(`${this.id}_out_EQ`, "EQ");
        eqPin.relX = this.width / 2;
        eqPin.relY = -18;
        eqPin.value = 1; // Default A=0, B=0 -> EQ=1

        const gtPin = this.addOutput(`${this.id}_out_GT`, "GT");
        gtPin.relX = this.width / 2;
        gtPin.relY = 0;
        gtPin.value = 0;

        const ltPin = this.addOutput(`${this.id}_out_LT`, "LT");
        ltPin.relX = this.width / 2;
        ltPin.relY = 18;
        ltPin.value = 0;
    }

    setWidth(newWidth) {
        const w = Math.max(1, Math.min(16, parseInt(newWidth) || 4));
        if (w !== this.widthBits) {
            this.widthBits = w;
            this.rebuildComparatorPins();
            this.evaluate();
        }
    }

    evaluate() {
        // Compare bits from MSB (widthBits - 1) down to LSB (0)
        let result = "EQ"; // "EQ", "GT", or "LT"

        for (let i = this.widthBits - 1; i >= 0; i--) {
            const aVal = this.inputs[i] ? (this.inputs[i].value === 1 ? 1 : 0) : 0;
            const bVal = this.inputs[this.widthBits + i] ? (this.inputs[this.widthBits + i].value === 1 ? 1 : 0) : 0;

            if (aVal > bVal) {
                result = "GT";
                break;
            } else if (aVal < bVal) {
                result = "LT";
                break;
            }
        }

        if (this.outputs[0]) this.outputs[0].value = (result === "EQ") ? 1 : 0;
        if (this.outputs[1]) this.outputs[1].value = (result === "GT") ? 1 : 0;
        if (this.outputs[2]) this.outputs[2].value = (result === "LT") ? 1 : 0;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#00adb5";
            ctx.strokeStyle = "#00adb5";
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = "#4e4e4e";
            ctx.lineWidth = 1.5;
        }

        ctx.fillStyle = "#1e293b";
        ctx.beginPath();
        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Title
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.label || `CMP(${this.widthBits})`, 0, 0);

        // Draw pin labels inside box
        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 9px monospace";
        ctx.textBaseline = "middle";

        this.inputs.forEach(pin => {
            const rx = this.flipX ? -pin.relX : pin.relX;
            const ry = this.flipY ? -pin.relY : pin.relY;
            ctx.textAlign = "left";
            ctx.fillText(pin.name, rx + 8, ry);
        });

        this.outputs.forEach(pin => {
            const rx = this.flipX ? -pin.relX : pin.relX;
            const ry = this.flipY ? -pin.relY : pin.relY;
            ctx.textAlign = "right";
            ctx.fillText(pin.name, rx - 6, ry);
        });

        ctx.restore();

        this.drawPins(ctx);
    }
}

export class PriorityEncoderGate extends Component {
    constructor(id, x, y, numInputs = 4) {
        super(id, "Priority Encoder", x, y);
        this.numInputs = Math.max(2, Math.min(16, numInputs));
        this.rebuildEncoderPins();
    }

    rebuildEncoderPins() {
        this.inputs = [];
        this.outputs = [];

        const numSelectBits = Math.ceil(Math.log2(this.numInputs));
        const totalRows = Math.max(this.numInputs, numSelectBits + 1);
        this.width = 110;
        this.height = Math.max(60, totalRows * 20 + 20);

        // Inputs: I0..I{N-1} (or I[0..N-1])
        for (let i = 0; i < this.numInputs; i++) {
            const pinName = this.numInputs === 4 ? `I${i}` : `I[${i}]`;
            const pin = this.addInput(`${this.id}_in_I${i}`, pinName);
            pin.relX = -this.width / 2;
            pin.relY = -this.height / 2 + 20 + i * 20;
        }

        // Outputs: A, B (or Y[0..M-1])
        for (let j = 0; j < numSelectBits; j++) {
            const pinName = numSelectBits === 2 ? (j === 0 ? "A" : "B") : `Y[${j}]`;
            const pin = this.addOutput(`${this.id}_out_Y${j}`, pinName);
            pin.relX = this.width / 2;
            pin.relY = -this.height / 2 + 20 + j * 20;
            pin.value = 0;
        }

        // Output: VALID
        const validPin = this.addOutput(`${this.id}_out_VALID`, "VALID");
        validPin.relX = this.width / 2;
        validPin.relY = this.height / 2 - 15;
        validPin.value = 0;
    }

    setWidth(newWidth) {
        const w = Math.max(2, Math.min(16, parseInt(newWidth) || 4));
        if (w !== this.numInputs) {
            this.numInputs = w;
            this.rebuildEncoderPins();
            this.evaluate();
        }
    }

    evaluate() {
        const numSelectBits = Math.ceil(Math.log2(this.numInputs));
        let highestActive = -1;

        // Scan from highest input index down to 0
        for (let i = this.numInputs - 1; i >= 0; i--) {
            if (this.inputs[i] && this.inputs[i].value === 1) {
                highestActive = i;
                break;
            }
        }

        const validPin = this.outputs[numSelectBits]; // Last output pin

        if (highestActive === -1) {
            for (let j = 0; j < numSelectBits; j++) {
                if (this.outputs[j]) this.outputs[j].value = 0;
            }
            if (validPin) validPin.value = 0;
        } else {
            for (let j = 0; j < numSelectBits; j++) {
                if (this.outputs[j]) {
                    this.outputs[j].value = (highestActive >> j) & 1;
                }
            }
            if (validPin) validPin.value = 1;
        }
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#00adb5";
            ctx.strokeStyle = "#00adb5";
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = "#4e4e4e";
            ctx.lineWidth = 1.5;
        }

        ctx.fillStyle = "#1e293b";
        ctx.beginPath();
        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Title
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.label || `PRI_ENC(${this.numInputs})`, 0, 0);

        // Draw pin labels inside box
        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 9px monospace";
        ctx.textBaseline = "middle";

        this.inputs.forEach(pin => {
            const rx = this.flipX ? -pin.relX : pin.relX;
            const ry = this.flipY ? -pin.relY : pin.relY;
            ctx.textAlign = "left";
            ctx.fillText(pin.name, rx + 8, ry);
        });

        this.outputs.forEach(pin => {
            const rx = this.flipX ? -pin.relX : pin.relX;
            const ry = this.flipY ? -pin.relY : pin.relY;
            ctx.textAlign = "right";
            ctx.fillText(pin.name, rx - 6, ry);
        });

        ctx.restore();

        this.drawPins(ctx);
    }
}

export class DecoderGate extends Component {
    constructor(id, x, y, widthBits = 2) {
        super(id, "Decoder", x, y);
        this.widthBits = Math.max(1, Math.min(4, widthBits));
        this.rebuildDecoderPins();
    }

    rebuildDecoderPins() {
        this.inputs = [];
        this.outputs = [];

        const outputCount = Math.pow(2, this.widthBits);
        const totalRows = Math.max(outputCount, this.widthBits + 1);
        this.width = 100;
        this.height = Math.max(60, totalRows * 20 + 20);

        // Address Inputs: A[0..N-1] (or A, B if widthBits == 2)
        for (let i = 0; i < this.widthBits; i++) {
            const pinName = this.widthBits === 2 ? (i === 0 ? "A" : "B") : `A[${i}]`;
            const pin = this.addInput(`${this.id}_in_A${i}`, pinName);
            pin.relX = -this.width / 2;
            pin.relY = -this.height / 2 + 20 + i * 20;
        }

        // Enable Input: EN
        const enPin = this.addInput(`${this.id}_in_EN`, "EN");
        enPin.relX = -this.width / 2;
        enPin.relY = this.height / 2 - 15;
        enPin.value = 1; // Default EN HIGH when un-driven

        // Outputs: Y0..Y{M-1} (or Y[0..M-1])
        for (let j = 0; j < outputCount; j++) {
            const pinName = this.widthBits === 2 ? `Y${j}` : `Y[${j}]`;
            const pin = this.addOutput(`${this.id}_out_Y${j}`, pinName);
            pin.relX = this.width / 2;
            pin.relY = -this.height / 2 + 20 + j * 20;
            pin.value = 0;
        }
    }

    setWidth(newWidth) {
        const w = Math.max(1, Math.min(4, parseInt(newWidth) || 2));
        if (w !== this.widthBits) {
            this.widthBits = w;
            this.rebuildDecoderPins();
            this.evaluate();
        }
    }

    evaluate() {
        // Last input is EN
        const enPin = this.inputs[this.inputs.length - 1];
        const enVal = enPin ? (enPin.value !== undefined ? enPin.value : 1) : 1;

        const outputCount = Math.pow(2, this.widthBits);

        if (enVal === 0) {
            for (let j = 0; j < outputCount; j++) {
                if (this.outputs[j]) this.outputs[j].value = 0;
            }
            return;
        }

        // Calculate address value from inputs 0..widthBits-1
        let addr = 0;
        for (let i = 0; i < this.widthBits; i++) {
            if (this.inputs[i] && this.inputs[i].value === 1) {
                addr |= (1 << i);
            }
        }

        for (let j = 0; j < outputCount; j++) {
            if (this.outputs[j]) {
                this.outputs[j].value = (j === addr) ? 1 : 0;
            }
        }
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#00adb5";
            ctx.strokeStyle = "#00adb5";
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = "#4e4e4e";
            ctx.lineWidth = 1.5;
        }

        ctx.fillStyle = "#1e293b";
        ctx.beginPath();
        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 6);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Title
        ctx.fillStyle = "#f8fafc";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.label || `DEC(${this.widthBits}:${Math.pow(2, this.widthBits)})`, 0, 0);

        // Draw pin labels inside box
        ctx.fillStyle = "#94a3b8";
        ctx.font = "bold 9px monospace";
        ctx.textBaseline = "middle";

        this.inputs.forEach(pin => {
            const rx = this.flipX ? -pin.relX : pin.relX;
            const ry = this.flipY ? -pin.relY : pin.relY;
            ctx.textAlign = "left";
            ctx.fillText(pin.name, rx + 8, ry);
        });

        this.outputs.forEach(pin => {
            const rx = this.flipX ? -pin.relX : pin.relX;
            const ry = this.flipY ? -pin.relY : pin.relY;
            ctx.textAlign = "right";
            ctx.fillText(pin.name, rx - 6, ry);
        });

        ctx.restore();

        this.drawPins(ctx);
    }
}

export class MUXGate extends Component {
    constructor(id, x, y) {
        super(id, "MUX", x, y);
        this.width = 60;
        this.height = 50;

        // Inputs: A (0), B (1), SEL (2)
        const inA = this.addInput(`${id}_inA`, "A");
        inA.relX = -30;
        inA.relY = -12;

        const inB = this.addInput(`${id}_inB`, "B");
        inB.relX = -30;
        inB.relY = 12;

        const inSEL = this.addInput(`${id}_inSEL`, "SEL");
        inSEL.relX = 0;
        inSEL.relY = 25;

        // Output: Y
        const outY = this.addOutput(`${id}_outY`, "Y");
        outY.relX = 30;
        outY.relY = 0;
    }

    evaluate() {
        const aVal = this.inputs[0].value === 1 ? 1 : 0;
        const bVal = this.inputs[1].value === 1 ? 1 : 0;
        const selVal = this.inputs[2].value === 1 ? 1 : 0;

        this.outputs[0].value = selVal === 1 ? bVal : aVal;
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        if (isSelected) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = "#f39c12";
            ctx.strokeStyle = "#f39c12";
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = "#e67e22";
            ctx.lineWidth = 1.5;
        }

        ctx.fillStyle = "#3d2214";

        // Draw classic trapezoidal MUX shape (wide left, narrow right)
        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.beginPath();
        const hw = this.width / 2;
        const hLeft = this.height / 2;
        const hRight = this.height / 2 - 10;

        ctx.moveTo(-hw, -hLeft);
        ctx.lineTo(hw, -hRight);
        ctx.lineTo(hw, hRight);
        ctx.lineTo(-hw, hLeft);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Pin labels
        ctx.fillStyle = "#f39c12";
        ctx.font = "bold 10px monospace";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("A", -this.width / 2 + 6, -12);
        ctx.fillText("B", -this.width / 2 + 6, 12);

        ctx.textAlign = "center";
        ctx.fillText("S", 0, this.height / 2 - 8);

        ctx.textAlign = "right";
        ctx.fillText("Y", this.width / 2 - 6, 0);

        // Center Title
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(this.label || "MUX", 2, 0);

        ctx.restore();

        this.drawPins(ctx);
    }
}

export const COMPONENT_REGISTRY = {
    "Input": InputGate,
    "Output": OutputGate,
    "Constant HIGH": ConstantHIGHGate,
    "Constant LOW": ConstantLOWGate,
    "Clock": ClockGate,
    "Buffer": BufferGate,
    "NOT": NOTGate,
    "AND": ANDGate,
    "OR": ORGate,
    "XOR": XORGate,
    "NAND": NANDGate,
    "NOR": NORGate,
    "XNOR": XNORGate,
    "LED": LEDGate,
    "7-Segment Display": SevenSegmentGate,
    "4-Digit 7-Segment Display": FourDigitSevenSegmentGate,
    "10-Segment Display": TenSegmentGate,
    "Button": ButtonGate,
    "NPN Transistor": NPNTransistorGate,
    "PNP Transistor": PNPTransistorGate,
    "DFF": DFFGate,
    "dff": DFFGate,
    "Register": RegisterGate,
    "REGISTER": RegisterGate,
    "register": RegisterGate,
    "Counter": CounterGate,
    "COUNTER": CounterGate,
    "counter": CounterGate,
    "MUX": MUXGate,
    "mux": MUXGate,
    "2:1 MUX": MUXGate,
    "2:1 Multiplexer": MUXGate,
    "Decoder": DecoderGate,
    "DECODER": DecoderGate,
    "decoder": DecoderGate,
    "2-to-4 Decoder": DecoderGate,
    "Priority Encoder": PriorityEncoderGate,
    "PRIORITY_ENCODER": PriorityEncoderGate,
    "priority_encoder": PriorityEncoderGate,
    "priority encoder": PriorityEncoderGate,
    "4-to-2 Priority Encoder": PriorityEncoderGate,
    "Comparator": ComparatorGate,
    "COMPARATOR": ComparatorGate,
    "comparator": ComparatorGate,
    "Digital Comparator": ComparatorGate
};

/**
 * Create a new component instance by type.
 */
export function createComponent(type, id, x, y) {
    const Cls = COMPONENT_REGISTRY[type];
    if (Cls) {
        return new Cls(id, x, y);
    }
    throw new Error(`Unknown component type: ${type}`);
}
