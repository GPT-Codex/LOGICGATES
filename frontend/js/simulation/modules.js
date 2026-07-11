import { Component, Circuit, Pin, Wire } from "./core.js";
import { createComponent } from "./components.js";
import { SimulationEngine } from "./simulation_engine.js";

/**
 * Definition of a reusable user-defined subcircuit.
 */
export class ModuleDefinition {
    /**
     * @param {string} id - unique identifier (e.g. 'half_adder')
     * @param {string} name - friendly name (e.g. 'Half Adder')
     * @param {string} description
     * @param {string} category
     * @param {string[]} inputs - external input labels
     * @param {string[]} outputs - external output labels
     * @param {any[]} components - serialized inner components
     * @param {any[]} wires - serialized inner wires
     */
    constructor(id, name, description, category, inputs, outputs, components, wires) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.category = category || "Custom";
        this.inputs = inputs;   // array of strings
        this.outputs = outputs; // array of strings
        this.components = components; // serialized data
        this.wires = wires;           // serialized data
    }
}

/**
 * A Component representing an instance of a Custom Module.
 */
export class UserModule extends Component {
    /**
     * @param {string} id
     * @param {ModuleDefinition} definition
     * @param {number} x
     * @param {number} y
     */
    constructor(id, definition, x = 0, y = 0) {
        super(id, definition.name, x, y);
        this.definition = definition;
        this.type = "UserModule";

        // Calculate dynamic dimensions based on pin count
        const pinCount = Math.max(definition.inputs.length, definition.outputs.length);
        this.width = 100;
        this.height = Math.max(60, pinCount * 22 + 20);

        // Add external pins
        this.inputs = [];
        definition.inputs.forEach((name, idx) => {
            const pin = this.addInput(`${id}_in_${name}`, name);
            pin.side = "left";
            pin.offset = -this.height / 2 + 20 + idx * 22;
            this.applyPinSideMath(pin);
        });

        this.outputs = [];
        definition.outputs.forEach((name, idx) => {
            const pin = this.addOutput(`${id}_out_${name}`, name);
            pin.side = "right";
            pin.offset = -this.height / 2 + 20 + idx * 22;
            this.applyPinSideMath(pin);
        });

        // Instantiate internal subcircuit and engine
        this.innerCircuit = new Circuit();
        this.innerEngine = new SimulationEngine(this.innerCircuit);

        this.buildInnerCircuit();
    }

    /**
     * Set relative pin coordinates based on assigned side and offset slider values.
     */
    applyPinSideMath(pin) {
        const side = pin.side || "left";
        const offset = pin.offset || 0;

        if (side === "left") {
            pin.relX = -this.width / 2;
            pin.relY = offset;
        } else if (side === "right") {
            pin.relX = this.width / 2;
            pin.relY = offset;
        } else if (side === "top") {
            pin.relX = offset;
            pin.relY = -this.height / 2;
        } else if (side === "bottom") {
            pin.relX = offset;
            pin.relY = this.height / 2;
        }
    }

    /**
     * Update a pin side and offset dynamically.
     */
    repositionPin(pinId, side, offset) {
        const pin = this.pins().find(p => p.id === pinId);
        if (pin) {
            pin.side = side;
            pin.offset = offset;
            this.applyPinSideMath(pin);
        }
    }

    /**
     * Rebuild internal circuit cloning the components and wires from the ModuleDefinition.
     */
    buildInnerCircuit() {
        this.innerCircuit.clear();

        // Map to keep track of internal pin IDs
        const pinMap = new Map();

        // 1. Instantiate internal components
        const internalInputsMap = new Map();  // Label -> InputGate
        const internalOutputsMap = new Map(); // Label -> OutputGate

        for (const compData of this.definition.components) {
            let comp;
            if (compData.type === "UserModule" && compData.definition) {
                // Nested user module!
                comp = new UserModule(compData.id, compData.definition, compData.x, compData.y);
            } else {
                comp = createComponent(compData.type, compData.id, compData.x, compData.y);
            }
            comp.label = compData.label || "";
            this.innerCircuit.addComponent(comp);

            // Populate pin mapping
            comp.pins().forEach(p => {
                // Simple map: original internal pin ID -> cloned pin instance
                pinMap.set(p.id, p);
            });

            // Store references to input/output gates mapping external pins
            if (comp.type === "Input") {
                internalInputsMap.set(comp.label || comp.id, comp);
            } else if (comp.type === "Output") {
                internalOutputsMap.set(comp.label || comp.id, comp);
            }
        }

        // 2. Instantiate internal wires
        for (const wireData of this.definition.wires) {
            const fromPin = pinMap.get(wireData.fromPin);
            const toPin = pinMap.get(wireData.toPin);
            if (fromPin && toPin) {
                const wireObj = new Wire(wireData.id, fromPin, toPin, wireData.color || null);
                this.innerCircuit.addWire(wireObj);
            }
        }

        // Store maps for syncing external values
        this.internalInputsMap = internalInputsMap;
        this.internalOutputsMap = internalOutputsMap;

        this.innerEngine.evaluateAll();
    }

    /**
     * Run evaluation of custom module: copy external inputs -> run internal engine -> copy internal outputs -> external outputs
     */
    evaluate() {
        // 1. Copy external inputs to internal InputGates
        this.inputs.forEach(extPin => {
            const innerGate = this.internalInputsMap.get(extPin.name);
            if (innerGate) {
                innerGate.stateValue = extPin.value;
                innerGate.evaluate();
            }
        });

        // 2. Propagate internal circuit signals
        this.innerEngine.evaluateAll();

        // 3. Copy internal OutputGates values back to external outputs
        this.outputs.forEach(extPin => {
            const innerGate = this.internalOutputsMap.get(extPin.name);
            if (innerGate) {
                extPin.value = innerGate.inputs[0].value;
            }
        });
    }

    /**
     * Drawing the custom user module on canvas with pin labels inside.
     */
    draw(ctx, isSelected) {
        const bbox = this.boundingBox();

        ctx.save();
        const borderCol = "#8e44ad";
        const bgCol = "#2b1b3d";

        if (isSelected) {
            ctx.shadowBlur = 12;
            ctx.shadowColor = borderCol;
            ctx.strokeStyle = borderCol;
            ctx.lineWidth = 2.5;
        } else {
            ctx.strokeStyle = borderCol;
            ctx.lineWidth = 1.8;
        }

        ctx.fillStyle = bgCol;
        ctx.beginPath();
        ctx.roundRect(bbox.x, bbox.y, bbox.width, bbox.height, 8);
        ctx.fill();
        ctx.stroke();

        // Draw outer pins
        this.drawPins(ctx);

        // Draw pin text labels inside the module block based on assigned sides!
        ctx.fillStyle = "#a29bfe";
        ctx.font = "9px sans-serif";
        ctx.textBaseline = "middle";

        this.pins().forEach(pin => {
            const pos = this.getPinAbsolutePosition(pin);
            const side = pin.side || "left";

            // Map pin screen coordinate relative to component center
            const rx = pin.relX;
            const ry = pin.relY;

            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate((this.rotation * Math.PI) / 180);

            if (side === "left") {
                ctx.textAlign = "left";
                ctx.fillText(pin.name, rx + 8, ry);
            } else if (side === "right") {
                ctx.textAlign = "right";
                ctx.fillText(pin.name, rx - 8, ry);
            } else if (side === "top") {
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText(pin.name, rx, ry + 8);
            } else if (side === "bottom") {
                ctx.textAlign = "center";
                ctx.textBaseline = "bottom";
                ctx.fillText(pin.name, rx, ry - 8);
            }
            ctx.restore();
        });

        // Center label (friendly name)
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(this.label || this.definition.name, 0, 0);
        ctx.restore();

        ctx.restore();
    }
}

/**
 * Handles the registry, rename, delete, and edit operations for Custom Module Definitions.
 */
export class ModuleRegistry {
    constructor() {
        /** @type {Map<string, ModuleDefinition>} */
        this.definitions = new Map();
    }

    register(def) {
        this.definitions.set(def.id, def);
    }

    get(id) {
        return this.definitions.get(id);
    }

    delete(id) {
        this.definitions.delete(id);
    }

    /**
     * Rename a module definition and update all of its active instances.
     */
    rename(id, newName) {
        const def = this.definitions.get(id);
        if (def) {
            def.name = newName;
            return true;
        }
        return false;
    }
}
