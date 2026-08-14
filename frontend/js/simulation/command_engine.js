import { createComponent, COMPONENT_REGISTRY } from "./components.js";
import { Wire } from "./core.js";
import { serializeCircuit, deserializeCircuit } from "./serialization.js";

/**
 * Parses and executes circuit graph commands.
 */
export class CommandEngine {
    /**
     * @param {Circuit} circuit
     * @param {ModuleRegistry} registry
     * @param {HistoryManager} historyManager
     * @param {SimulationEngine} engine
     */
    constructor(circuit, registry, historyManager, engine) {
        this.circuit = circuit;
        this.registry = registry;
        this.historyManager = historyManager;
        this.engine = engine;

        // Build case-insensitive component type map
        this.typeMap = {};
        for (const k of Object.keys(COMPONENT_REGISTRY)) {
            this.typeMap[k.toLowerCase()] = k;
        }
        // Common short aliases
        this.typeMap["clock"] = "Clock";
        this.typeMap["and"] = "AND";
        this.typeMap["or"] = "OR";
        this.typeMap["not"] = "NOT";
        this.typeMap["xor"] = "XOR";
        this.typeMap["nand"] = "NAND";
        this.typeMap["nor"] = "NOR";
        this.typeMap["xnor"] = "XNOR";
        this.typeMap["buffer"] = "Buffer";
        this.typeMap["button"] = "Button";
        this.typeMap["input"] = "Input";
        this.typeMap["output"] = "Output";
        this.typeMap["npn"] = "NPN Transistor";
        this.typeMap["pnp"] = "PNP Transistor";
        this.typeMap["led"] = "LED";
    }

    /**
     * Helper to save a history state after mutation.
     */
    _saveHistory() {
        if (this.historyManager) {
            const snap = JSON.stringify(serializeCircuit(this.circuit, this.registry));
            this.historyManager.pushState(snap);
        }
    }

    /**
     * Parse and execute a command string.
     * @param {string} commandStr
     * @returns {{ success: boolean, message?: string, error?: string, data?: any }}
     */
    execute(commandStr) {
        if (!commandStr) {
            return { success: false, error: "Empty command" };
        }

        const trimmed = commandStr.trim();
        const parts = trimmed.split(/\s+/);
        if (parts.length === 0 || parts[0] === "") {
            return { success: false, error: "Empty command" };
        }

        const cmd = parts[0].toLowerCase();

        try {
            switch (cmd) {
                case "add":
                    return this._handleAdd(parts, trimmed);
                case "move":
                    return this._handleMove(parts, trimmed);
                case "connect":
                    return this._handleConnect(parts, trimmed);
                case "set":
                    return this._handleSet(parts, trimmed);
                case "remove":
                    return this._handleRemove(parts, trimmed);
                case "list":
                    return this._handleList();
                case "show":
                    return this._handleShow(parts, trimmed);
                case "undo":
                    return this._handleUndo();
                case "redo":
                    return this._handleRedo();
                default:
                    return { success: false, error: `Unknown command '${parts[0]}'` };
            }
        } catch (e) {
            return { success: false, error: `Execution error: ${e.message}` };
        }
    }

    _handleAdd(parts, original) {
        // Syntax: add TYPE NAME
        if (parts.length < 3) {
            return { success: false, error: "Syntax: add TYPE NAME" };
        }

        // Reconstruct type in case of space-separated types (e.g., "npn transistor")
        // We look for parts from index 1 up to second-to-last as type, last part is NAME
        const name = parts[parts.length - 1];
        const typeCandidate = parts.slice(1, -1).join(" ").toLowerCase().trim();

        const actualType = this.typeMap[typeCandidate];
        if (!actualType) {
            return { success: false, error: `Unknown component type '${parts.slice(1, -1).join(" ")}'` };
        }

        // Validate NAME identifier
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) {
            return { success: false, error: "Invalid name identifier (must be alphanumeric starting with a letter)" };
        }

        // Check duplicates
        if (this.circuit.components.has(name)) {
            return { success: false, error: `Component with name '${name}' already exists` };
        }

        // Create component at default position (100, 100) or center
        const comp = createComponent(actualType, name, 100, 100);
        this.circuit.addComponent(comp);

        if (this.engine) {
            this.engine.evaluateAll();
        }
        this._saveHistory();

        return { success: true, message: `Successfully added ${actualType} component '${name}'` };
    }

    _handleMove(parts, original) {
        // Syntax:
        // move NAME to (x,y)
        // move NAME by (dx,dy)
        if (parts.length < 4) {
            return { success: false, error: "Syntax: move NAME to (x,y) OR move NAME by (dx,dy)" };
        }

        const name = parts[1];
        const comp = this.circuit.components.get(name);
        if (!comp) {
            return { success: false, error: `Unknown component '${name}'` };
        }

        const relation = parts[2].toLowerCase();
        if (relation !== "to" && relation !== "by") {
            return { success: false, error: "Syntax: move NAME to (x,y) OR move NAME by (dx,dy)" };
        }

        // Join remaining parts to parse coords
        const coordPart = parts.slice(3).join("");
        const match = coordPart.match(/^\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)\s*$/);
        if (!match) {
            return { success: false, error: "Invalid coordinate format, expected (x,y)" };
        }

        const val1 = parseInt(match[1], 10);
        const val2 = parseInt(match[2], 10);

        if (relation === "to") {
            comp.x = val1;
            comp.y = val2;
        } else {
            comp.x += val1;
            comp.y += val2;
        }

        // Update pins side math for user modules if applicable
        if (comp.type === "UserModule" && typeof comp.applyPinSideMath === "function") {
            comp.pins().forEach(p => comp.applyPinSideMath(p));
        }

        this._saveHistory();
        return { success: true, message: `Successfully moved component '${name}'` };
    }

    _handleConnect(parts, original) {
        // Syntax: connect FROM TO
        // connect CLK.out G1.A
        if (parts.length < 3) {
            return { success: false, error: "Syntax: connect FROM TO (e.g. connect CLK.out G1.A)" };
        }

        const fromRef = parts[1];
        const toRef = parts[2];

        const fromParts = fromRef.split(".");
        const toParts = toRef.split(".");

        if (fromParts.length < 2 || toParts.length < 2) {
            return { success: false, error: "Invalid pin references, expected format COMPONENT.PIN" };
        }

        const fromCompName = fromParts[0];
        const fromPinName = fromParts[1];

        const toCompName = toParts[0];
        const toPinName = toParts[1];

        const fromComp = this.circuit.components.get(fromCompName);
        if (!fromComp) {
            return { success: false, error: `Unknown component '${fromCompName}'` };
        }

        const toComp = this.circuit.components.get(toCompName);
        if (!toComp) {
            return { success: false, error: `Unknown component '${toCompName}'` };
        }

        if (fromComp === toComp) {
            return { success: false, error: "Cannot connect a component to itself" };
        }

        // Find pins
        const fromPin = fromComp.pins().find(p => p.name === fromPinName);
        if (!fromPin) {
            return { success: false, error: `Unknown pin '${fromPinName}' on component '${fromCompName}'` };
        }

        const toPin = toComp.pins().find(p => p.name === toPinName);
        if (!toPin) {
            return { success: false, error: `Unknown pin '${toPinName}' on component '${toCompName}'` };
        }

        // Validate directions: FROM must be output, TO must be input
        if (fromPin.type !== "output") {
            return { success: false, error: `Pin '${fromPinName}' on component '${fromCompName}' is not an output pin` };
        }
        if (toPin.type !== "input") {
            return { success: false, error: `Pin '${toPinName}' on component '${toCompName}' is not an input pin` };
        }

        // Remove existing wire to target input pin if it exists
        for (const wire of this.circuit.wires.values()) {
            if (wire.toPin === toPin) {
                this.circuit.removeWire(wire.id);
            }
        }

        const wireId = `wire_${Math.random().toString(36).substring(2, 9)}`;
        const newWire = new Wire(wireId, fromPin, toPin);
        this.circuit.addWire(newWire);

        if (this.engine) {
            this.engine.evaluateAll();
        }
        this._saveHistory();

        return { success: true, message: `Successfully connected ${fromRef} to ${toRef}` };
    }

    _handleSet(parts, original) {
        // Syntax: set NAME.property value
        // set CLK.freq 1MHz
        if (parts.length < 3) {
            return { success: false, error: "Syntax: set NAME.property value" };
        }

        const ref = parts[1];
        const valStr = parts.slice(2).join(" "); // Value might contain spaces

        const refParts = ref.split(".");
        if (refParts.length < 2) {
            return { success: false, error: "Invalid reference, expected format NAME.property" };
        }

        const name = refParts[0];
        const prop = refParts[1].toLowerCase();

        const comp = this.circuit.components.get(name);
        if (!comp) {
            return { success: false, error: `Unknown component '${name}'` };
        }

        switch (prop) {
            case "label":
                comp.label = valStr.trim();
                break;

            case "freq":
                if (comp.type !== "Clock") {
                    return { success: false, error: `Component '${name}' of type '${comp.type}' does not support property 'freq'` };
                }
                // Parse frequency: e.g. "1MHz", "50Hz", "10kHz"
                const freqMatch = valStr.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/);
                if (!freqMatch) {
                    return { success: false, error: "Invalid frequency format, expected e.g. 10kHz or 100" };
                }
                const numVal = parseFloat(freqMatch[1]);
                if (isNaN(numVal) || numVal <= 0) {
                    return { success: false, error: "Frequency must be a positive number" };
                }
                const unit = freqMatch[2] || "Hz";
                if (!["Hz", "kHz", "MHz", "GHz"].includes(unit)) {
                    return { success: false, error: "Invalid frequency unit, expected Hz, kHz, MHz, or GHz" };
                }
                comp.frequencyValue = numVal;
                comp.frequencyUnit = unit;
                comp.updateFrequency();
                break;

            case "buttonmode":
                if (comp.type !== "Button") {
                    return { success: false, error: `Component '${name}' of type '${comp.type}' does not support property 'buttonMode'` };
                }
                const mode = valStr.trim().toLowerCase();
                if (mode !== "press" && mode !== "hold") {
                    return { success: false, error: "buttonMode must be either 'press' or 'hold'" };
                }
                comp.buttonMode = mode;
                break;

            case "holdduration":
                if (comp.type !== "Button") {
                    return { success: false, error: `Component '${name}' of type '${comp.type}' does not support property 'holdDuration'` };
                }
                const dur = parseFloat(valStr.trim());
                if (isNaN(dur) || dur <= 0) {
                    return { success: false, error: "holdDuration must be a positive number" };
                }
                comp.holdDuration = dur;
                break;

            case "ledcolor":
                if (comp.type !== "LED") {
                    return { success: false, error: `Component '${name}' of type '${comp.type}' does not support property 'ledColor'` };
                }
                const color = valStr.trim();
                if (!["Red", "Green", "Blue", "RGBA"].includes(color)) {
                    return { success: false, error: "ledColor must be Red, Green, Blue, or RGBA" };
                }
                comp.ledColor = color;
                break;

            case "rgbavalue":
                if (comp.type !== "LED") {
                    return { success: false, error: `Component '${name}' of type '${comp.type}' does not support property 'rgbaValue'` };
                }
                comp.rgbaValue = valStr.trim();
                break;

            case "rotation":
                const rot = parseInt(valStr.trim(), 10);
                if (![0, 90, 180, 270].includes(rot)) {
                    return { success: false, error: "rotation must be 0, 90, 180, or 270" };
                }
                comp.rotation = rot;
                break;

            case "flipx":
                const fx = valStr.trim().toLowerCase();
                comp.flipX = (fx === "true" || fx === "1");
                break;

            case "flipy":
                const fy = valStr.trim().toLowerCase();
                comp.flipY = (fy === "true" || fy === "1");
                break;

            default:
                return { success: false, error: `Unknown or unsupported property '${refParts[1]}' on component '${name}'` };
        }

        if (this.engine) {
            this.engine.evaluateAll();
        }
        this._saveHistory();

        return { success: true, message: `Successfully set ${ref} to '${valStr}'` };
    }

    _handleRemove(parts, original) {
        // Syntax: remove NAME
        if (parts.length < 2) {
            return { success: false, error: "Syntax: remove NAME" };
        }

        const name = parts[1];
        if (!this.circuit.components.has(name)) {
            return { success: false, error: `Unknown component '${name}'` };
        }

        this.circuit.removeComponent(name);

        if (this.engine) {
            this.engine.evaluateAll();
        }
        this._saveHistory();

        return { success: true, message: `Successfully removed component '${name}'` };
    }

    _handleList() {
        const comps = [];
        for (const comp of this.circuit.components.values()) {
            let details = "";
            if (comp.type === "Clock") {
                details = ` [freq: ${comp.frequencyValue}${comp.frequencyUnit}]`;
            } else if (comp.type === "Button") {
                details = ` [mode: ${comp.buttonMode}]`;
            } else if (comp.type === "LED") {
                details = ` [color: ${comp.ledColor}]`;
            }
            comps.push(`  - ${comp.id} (${comp.type}) at (${comp.x}, ${comp.y})${details}`);
        }

        const wires = [];
        for (const wire of this.circuit.wires.values()) {
            wires.push(`  - ${wire.fromPin.component.id}.${wire.fromPin.name} -> ${wire.toPin.component.id}.${wire.toPin.name}`);
        }

        const output = [
            "Components:",
            comps.length > 0 ? comps.join("\n") : "  (none)",
            "Wires:",
            wires.length > 0 ? wires.join("\n") : "  (none)"
        ].join("\n");

        return { success: true, data: output, message: output };
    }

    _handleShow(parts, original) {
        // Syntax: show NAME
        if (parts.length < 2) {
            return { success: false, error: "Syntax: show NAME" };
        }

        const name = parts[1];
        const comp = this.circuit.components.get(name);
        if (!comp) {
            return { success: false, error: `Unknown component '${name}'` };
        }

        const props = [
            `Component: ${comp.id} (${comp.type})`,
            `Position: (${comp.x}, ${comp.y})`,
            `Label: ${comp.label || "(none)"}`,
            `Rotation: ${comp.rotation || 0}°`,
            `Flipped: H=${comp.flipX ? "yes" : "no"}, V=${comp.flipY ? "yes" : "no"}`
        ];

        if (comp.type === "Clock") {
            props.push(`Properties:\n  - freq: ${comp.frequencyValue}${comp.frequencyUnit}`);
        } else if (comp.type === "Button") {
            props.push(`Properties:\n  - buttonMode: ${comp.buttonMode}\n  - holdDuration: ${comp.holdDuration}`);
        } else if (comp.type === "LED") {
            props.push(`Properties:\n  - ledColor: ${comp.ledColor}\n  - rgbaValue: ${comp.rgbaValue}`);
        }

        const pins = [];
        for (const pin of comp.pins()) {
            pins.push(`  - ${pin.name} (${pin.type}): value=${pin.value}`);
        }
        props.push(`Pins:\n${pins.join("\n")}`);

        const output = props.join("\n");
        return { success: true, data: output, message: output };
    }

    _handleUndo() {
        if (!this.historyManager) {
            return { success: false, error: "History Manager not configured" };
        }
        const currentState = JSON.stringify(serializeCircuit(this.circuit, this.registry));
        let prev = this.historyManager.undo(currentState);
        
        // If the popped state is the same as current state, undo again to get the actual previous state
        if (prev === currentState) {
            prev = this.historyManager.undo(currentState);
        }

        if (prev) {
            deserializeCircuit(JSON.parse(prev), this.circuit, this.registry);
            if (this.engine) {
                this.engine.evaluateAll();
            }
            return { success: true, message: "Undo executed successfully" };
        }
        return { success: false, error: "No state to undo" };
    }

    _handleRedo() {
        if (!this.historyManager) {
            return { success: false, error: "History Manager not configured" };
        }
        const currentState = JSON.stringify(serializeCircuit(this.circuit, this.registry));
        const next = this.historyManager.redo(currentState);
        if (next) {
            deserializeCircuit(JSON.parse(next), this.circuit, this.registry);
            if (this.engine) {
                this.engine.evaluateAll();
            }
            return { success: true, message: "Redo executed successfully" };
        }
        return { success: false, error: "No state to redo" };
    }
}
