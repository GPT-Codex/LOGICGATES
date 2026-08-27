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

export class SevenSegmentGate extends Component {
    constructor(id, x, y) {
        super(id, "7-Segment Display", x, y);
        this.width = 60;
        this.height = 80;

        // 8 inputs: A-G, DP
        const pins = ["A", "B", "C", "D", "E", "F", "G", "DP"];
        pins.forEach((name, idx) => {
            const pin = this.addInput(`${id}_in_${name}`, name);
            // Arrange along bottom
            pin.relX = -21 + idx * 6;
            pin.relY = 40;
        });
    }

    evaluate() {
        // Render only
    }

    draw(ctx, isSelected) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

        // Display Card background
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

        // 7 Segments drawing (A-G)
        // input indexes: 0:A, 1:B, 2:C, 3:D, 4:E, 5:F, 6:G, 7:DP
        const active = this.inputs.map(p => p.value === 1);

        drawSegment(active[0], -10, -25, 10, -25); // A
        drawSegment(active[1], 10, -25, 10, -2);   // B
        drawSegment(active[2], 10, 2, 10, 25);     // C
        drawSegment(active[3], -10, 25, 10, 25);   // D
        drawSegment(active[4], -10, 2, -10, 25);   // E
        drawSegment(active[5], -10, -25, -10, -2); // F
        drawSegment(active[6], -10, 0, 10, 0);     // G

        // DP (Decimal point)
        ctx.fillStyle = active[7] ? "#ff3838" : "#221111";
        ctx.beginPath();
        ctx.arc(15, 25, 2.5, 0, 2 * Math.PI);
        ctx.fill();

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
        this.width = 50;
        this.height = 40;

        const inC = this.addInput(`${id}_inC`, "C"); // Collector
        inC.relX = -25;
        inC.relY = -10;

        const inB = this.addInput(`${id}_inB`, "B"); // Base
        inB.relX = -25;
        inB.relY = 10;

        const outE = this.addOutput(`${id}_outE`, "E"); // Emitter
        outE.relX = 25;
        outE.relY = 0;
    }

    evaluate() {
        const baseVal = this.inputs[1].value;
        const collVal = this.inputs[0].value;
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
        ctx.beginPath();
        // Base plate
        ctx.moveTo(-10, -10);
        ctx.lineTo(-10, 10);
        ctx.stroke();

        // Base connection line
        ctx.beginPath();
        ctx.moveTo(-15, 0);
        ctx.lineTo(-10, 0);
        ctx.stroke();

        // Collector line
        ctx.beginPath();
        ctx.moveTo(-10, -5);
        ctx.lineTo(8, -12);
        ctx.stroke();

        // Emitter line with arrow
        ctx.beginPath();
        ctx.moveTo(-10, 5);
        ctx.lineTo(8, 12);
        ctx.stroke();

        // NPN Arrow on emitter pointing away from base
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(3, 10);
        ctx.lineTo(8, 12);
        ctx.lineTo(4, 7);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("NPN", 0, -12);
        ctx.restore();

        this.drawPins(ctx);
    }
}

export class PNPTransistorGate extends Component {
    constructor(id, x, y) {
        super(id, "PNP Transistor", x, y);
        this.width = 50;
        this.height = 40;

        const inC = this.addInput(`${id}_inC`, "C"); // Collector
        inC.relX = -25;
        inC.relY = -10;

        const inB = this.addInput(`${id}_inB`, "B"); // Base
        inB.relX = -25;
        inB.relY = 10;

        const outE = this.addOutput(`${id}_outE`, "E"); // Emitter
        outE.relX = 25;
        outE.relY = 0;
    }

    evaluate() {
        const baseVal = this.inputs[1].value;
        const collVal = this.inputs[0].value;
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
        ctx.beginPath();
        // Base plate
        ctx.moveTo(-10, -10);
        ctx.lineTo(-10, 10);
        ctx.stroke();

        // Base connection line
        ctx.beginPath();
        ctx.moveTo(-15, 0);
        ctx.lineTo(-10, 0);
        ctx.stroke();

        // Collector line
        ctx.beginPath();
        ctx.moveTo(-10, -5);
        ctx.lineTo(8, -12);
        ctx.stroke();

        // Emitter line with arrow
        ctx.beginPath();
        ctx.moveTo(-10, 5);
        ctx.lineTo(8, 12);
        ctx.stroke();

        // PNP Arrow on emitter pointing towards base
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(-4, 7);
        ctx.lineTo(-9, 5);
        ctx.lineTo(-5, 11);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("PNP", 0, -12);
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
    "2:1 Multiplexer": MUXGate
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
