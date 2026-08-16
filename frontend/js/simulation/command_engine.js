import { createComponent, COMPONENT_REGISTRY } from "./components.js";
import { Wire, Bus } from "./core.js";
import { UserModule } from "./modules.js";
import { serializeCircuit, deserializeCircuit } from "./serialization.js";
import { parseBooleanExpression } from "./expr_parser.js";
import { synthesizeExpression } from "./expr_synthesizer.js";
import { expandScript } from "./script_parser.js";

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
        this.inTransaction = false;

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
        if (this.inTransaction) return;
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

        // Handle bus declaration command: bus NAME[START..END]
        if (cmd === "bus") {
            return this._handleBus(parts, trimmed);
        }

        // Handle bus range expansion in other commands (e.g. connect IN[0..3] OUT[0..3])
        if (trimmed.includes("..")) {
            try {
                const expanded = this._expandBusCommand(trimmed);
                let lastRes = { success: true, message: `Successfully executed bus command` };
                for (const singleCmd of expanded) {
                    const res = this.execute(singleCmd);
                    if (!res.success) return res;
                    lastRes = res;
                }
                return lastRes;
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        try {
            switch (cmd) {
                case "add":
                    return this._handleAdd(parts, trimmed);
                case "net":
                    return this._handleNet(parts, trimmed);
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
                case "expr":
                    return this._handleExpr(trimmed);
                default:
                    return { success: false, error: `Unknown command '${parts[0]}'` };
            }
        } catch (e) {
            return { success: false, error: `Execution error: ${e.message}` };
        }
    }

    _handleBus(parts, original) {
        // Syntax: bus NAME[START..END]
        if (parts.length < 2) {
            return { success: false, error: "Syntax: bus NAME[START..END]" };
        }

        const busDecl = parts[1];
        const match = busDecl.match(/^([a-zA-Z][a-zA-Z0-9_]*)\[(\d+)\.\.(\d+)\]$/);
        if (!match) {
            return { success: false, error: `Invalid bus declaration format '${busDecl}', expected NAME[START..END]` };
        }

        const busName = match[1];
        const start = parseInt(match[2], 10);
        const end = parseInt(match[3], 10);

        if (this.circuit.buses.has(busName)) {
            const existing = this.circuit.buses.get(busName);
            if (existing.start === start && existing.end === end) {
                return { success: true, message: `Bus '${busName}' already defined` };
            }
            return { success: false, error: `Bus '${busName}' already exists with a different range` };
        }

        if (this.circuit.components.has(busName)) {
            return { success: false, error: `Cannot declare bus '${busName}': scalar component with name '${busName}' already exists` };
        }

        const bus = new Bus(busName, start, end);
        this.circuit.addBus(bus);

        // Ensure member net signals exist for logical routing
        for (const memberName of bus.members) {
            if (!this.circuit.components.has(memberName)) {
                this._handleNet(["net", memberName], `net ${memberName}`);
            }
        }

        this._saveHistory();
        return { success: true, message: `Successfully declared ${bus.width}-bit bus '${busName}[${start}..${end}]'` };
    }

    _expandBusCommand(commandStr) {
        const rangeRegex = /([a-zA-Z][a-zA-Z0-9_]*)\[(\d+)\.\.(\d+)\]/g;
        const matches = Array.from(commandStr.matchAll(rangeRegex));

        if (matches.length === 0) {
            return [commandStr];
        }

        const firstStart = parseInt(matches[0][2], 10);
        const firstEnd = parseInt(matches[0][3], 10);
        const count = Math.abs(firstEnd - firstStart) + 1;

        if (matches.length >= 2) {
            const len1 = Math.abs(parseInt(matches[0][3], 10) - parseInt(matches[0][2], 10)) + 1;
            const len2 = Math.abs(parseInt(matches[1][3], 10) - parseInt(matches[1][2], 10)) + 1;
            if (len1 !== len2) {
                throw new Error(`Cannot connect ${matches[0][1]} to ${matches[1][1]}: source width = ${len1}, destination width = ${len2}`);
            }
        }

        for (const m of matches) {
            const s = parseInt(m[2], 10);
            const e = parseInt(m[3], 10);
            const len = Math.abs(e - s) + 1;
            if (len !== count) {
                throw new Error(`Bus range mismatch in command '${commandStr}': ranges have different lengths`);
            }
        }

        const expanded = [];
        for (let step = 0; step < count; step++) {
            let currentCmd = commandStr;
            for (const m of matches) {
                const baseName = m[1];
                const start = parseInt(m[2], 10);
                const end = parseInt(m[3], 10);
                const dir = start <= end ? 1 : -1;
                const idx = start + dir * step;
                const targetStr = `${baseName}[${idx}]`;
                currentCmd = currentCmd.replace(m[0], targetStr);
            }
            expanded.push(currentCmd);
        }

        return expanded;
    }

    _handleAdd(parts, original) {
        // Syntax: add TYPE NAME
        if (parts.length < 3) {
            return { success: false, error: "Syntax: add TYPE NAME" };
        }

        // Reconstruct type in case of space-separated types (e.g., "npn transistor")
        // We look for parts from index 1 up to second-to-last as type, last part is NAME
        const name = parts[parts.length - 1];
        const rawTypeStr = parts.slice(1, -1).join(" ").trim();
        const typeCandidate = rawTypeStr.toLowerCase();

        let actualType = this.typeMap[typeCandidate];
        let customDef = null;

        if (!actualType && this.registry) {
            for (const def of this.registry.definitions.values()) {
                if (def.id.toLowerCase() === typeCandidate || def.name.toLowerCase() === typeCandidate) {
                    customDef = def;
                    actualType = "UserModule";
                    break;
                }
            }
        }

        if (!actualType) {
            return { success: false, error: `Unknown component type '${rawTypeStr}'` };
        }

        // Validate NAME identifier (supports multi-dimensional indexing e.g. G[0], G[1][2])
        if (!/^[a-zA-Z][a-zA-Z0-9_]*(\[\d+\])*$/.test(name)) {
            return { success: false, error: "Invalid name identifier (must be alphanumeric starting with a letter)" };
        }

        // Check duplicates
        if (this.circuit.components.has(name)) {
            return { success: false, error: `Component with name '${name}' already exists` };
        }

        // Create component at default position (100, 100) or center
        let comp;
        if (actualType === "UserModule" && customDef) {
            comp = new UserModule(name, customDef, 100, 100);
        } else {
            comp = createComponent(actualType, name, 100, 100);
        }
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
        comp.isExplicitPosition = true;

        // Update pins side math for user modules if applicable
        if (comp.type === "UserModule" && typeof comp.applyPinSideMath === "function") {
            comp.pins().forEach(p => comp.applyPinSideMath(p));
        }

        this._saveHistory();
        return { success: true, message: `Successfully moved component '${name}'` };
    }

    _handleNet(parts, original) {
        // Syntax: net NAME
        if (parts.length < 2) {
            return { success: false, error: "Syntax: net NAME" };
        }

        const name = parts[1];

        // Validate NAME identifier (supports indexing)
        if (!/^[a-zA-Z][a-zA-Z0-9_]*(\[\d+\])*$/.test(name)) {
            return { success: false, error: "Invalid net identifier (must be alphanumeric starting with a letter)" };
        }

        if (this.circuit.components.has(name)) {
            return { success: true, message: `Net '${name}' already exists` };
        }

        // Create Buffer gate representing the net node
        const netComp = createComponent("Buffer", name, 100, 100);
        netComp.label = name;
        this.circuit.addComponent(netComp);

        if (this.engine) {
            this.engine.evaluateAll();
        }
        this._saveHistory();

        return { success: true, message: `Successfully created net '${name}'` };
    }

    _handleConnect(parts, original) {
        // Syntax:
        // connect FROM TO OR connect FROM -> TO
        // Filter out optional arrow tokens if present
        const filteredParts = parts.filter(p => p !== "->" && p !== "=>");
        if (filteredParts.length < 3) {
            return { success: false, error: "Syntax: connect FROM TO (e.g. connect CLK.out G1.A)" };
        }

        const fromRef = filteredParts[1];
        const toRef = filteredParts[2];

        // Parse FROM
        let fromCompName = fromRef;
        let fromPinName = null;
        if (fromRef.includes(".")) {
            const lastIdx = fromRef.lastIndexOf(".");
            fromCompName = fromRef.substring(0, lastIdx);
            fromPinName = fromRef.substring(lastIdx + 1);
        }

        // Parse TO
        let toCompName = toRef;
        let toPinName = null;
        if (toRef.includes(".")) {
            const lastIdx = toRef.lastIndexOf(".");
            toCompName = toRef.substring(0, lastIdx);
            toPinName = toRef.substring(lastIdx + 1);
        }

        // Check if both FROM and TO refer to registered buses
        const fromBus = this.circuit.buses.get(fromCompName);
        const toBus = this.circuit.buses.get(toCompName);

        if (fromBus || toBus) {
            if (fromBus && toBus) {
                if (fromBus.width !== toBus.width) {
                    return {
                        success: false,
                        error: `Cannot connect ${fromBus.name} to ${toBus.name}: source width = ${fromBus.width}, destination width = ${toBus.width}`
                    };
                }
                // Connect bus member bits pairwise based on declared bus indices
                let lastRes = { success: true, message: `Successfully connected bus ${fromBus.name} to ${toBus.name}` };
                for (let i = 0; i < fromBus.width; i++) {
                    const memberFrom = fromBus.members[i];
                    const memberTo = toBus.members[i];
                    const res = this.execute(`connect ${memberFrom} ${memberTo}`);
                    if (!res.success) return res;
                    lastRes = res;
                }
                return lastRes;
            } else {
                const busObj = fromBus || toBus;
                const srcW = fromBus ? fromBus.width : 1;
                const dstW = toBus ? toBus.width : 1;
                return {
                    success: false,
                    error: `Cannot connect ${fromRef} to ${toRef}: source width = ${srcW}, destination width = ${dstW}`
                };
            }
        }

        const fromComp = this.circuit.components.get(fromCompName);
        if (!fromComp) {
            return { success: false, error: `Unknown component or net '${fromCompName}'` };
        }

        const toComp = this.circuit.components.get(toCompName);
        if (!toComp) {
            return { success: false, error: `Unknown component or net '${toCompName}'` };
        }

        if (fromComp === toComp) {
            return { success: false, error: "Cannot connect a component to itself" };
        }

        // Find pins using flexible lookup
        const fromPin = this._findPin(fromComp, fromPinName, "output");
        if (!fromPin) {
            return { success: false, error: `Unknown pin '${fromPinName || "output"}' on component '${fromCompName}'` };
        }

        const toPin = this._findPin(toComp, toPinName, "input");
        if (!toPin) {
            return { success: false, error: `Unknown pin '${toPinName || "input"}' on component '${toCompName}'` };
        }

        // Validate directions: FROM must be output, TO must be input
        if (fromPin.type !== "output") {
            return { success: false, error: `Pin '${fromPin.name}' on component '${fromCompName}' is not an output pin` };
        }
        if (toPin.type !== "input") {
            return { success: false, error: `Pin '${toPin.name}' on component '${toCompName}' is not an input pin` };
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
        const busesOutput = [];
        if (this.circuit.buses) {
            for (const bus of this.circuit.buses.values()) {
                busesOutput.push(`  - ${bus.name} [${bus.start}..${bus.end}] (width: ${bus.width})`);
            }
        }

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
            "Buses:",
            busesOutput.length > 0 ? busesOutput.join("\n") : "  (none)",
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

        // Check if name is a bus
        if (this.circuit.buses.has(name)) {
            const bus = this.circuit.buses.get(name);
            const props = [
                `Bus: ${bus.name}`,
                `Width: ${bus.width}`,
                `Range: ${bus.start}..${bus.end}`,
                `Direction: ${bus.isDescending ? "descending" : "ascending"}`,
                `Bits:`,
                ...bus.members.map(m => `  - ${m}`)
            ];
            const output = props.join("\n");
            return { success: true, data: output, message: output };
        }

        const comp = this.circuit.components.get(name);
        if (!comp) {
            return { success: false, error: `Unknown component or bus '${name}'` };
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

    _handleExpr(trimmed) {
        // Syntax: expr OUTPUT = BOOLEAN_EXPRESSION
        const exprBody = trimmed.replace(/^expr\s+/i, "").trim();
        const eqIdx = exprBody.indexOf("=");
        if (eqIdx === -1) {
            return { success: false, error: "Syntax: expr OUTPUT = BOOLEAN_EXPRESSION" };
        }

        const outputName = exprBody.substring(0, eqIdx).trim();
        const exprStr = exprBody.substring(eqIdx + 1).trim();

        if (!outputName) {
            return { success: false, error: "Syntax: expr OUTPUT = BOOLEAN_EXPRESSION" };
        }

        if (!/^[a-zA-Z][a-zA-Z0-9_]*(\[\d+\])*$/.test(outputName)) {
            return { success: false, error: "Invalid output name identifier (must be alphanumeric starting with a letter)" };
        }

        if (!exprStr) {
            return { success: false, error: "Missing boolean expression after '='" };
        }

        try {
            const astNode = parseBooleanExpression(exprStr);
            synthesizeExpression(this.circuit, outputName, astNode, this.engine);
            if (this.engine) {
                this.engine.evaluateAll();
            }
            this._saveHistory();
            return { success: true, message: `Successfully synthesized expression for '${outputName}'` };
        } catch (e) {
            return { success: false, error: `Invalid expression: ${e.message}` };
        }
    }

    /**
     * Flexible pin lookup supporting exact match, case-insensitive match, and common pin aliases.
     * @param {Component} comp
     * @param {string} pinRef
     * @param {string} [pinType] - "input" or "output"
     */
    _findPin(comp, pinRef, pinType) {
        if (!comp) return null;
        const pins = comp.pins().filter(p => !pinType || p.type === pinType);
        if (pins.length === 0) return null;

        if (!pinRef) {
            return pins[0] || null;
        }

        // 1. Exact match
        let found = pins.find(p => p.name === pinRef);
        if (found) return found;

        // 2. Case-insensitive match
        const lowerRef = pinRef.toLowerCase();
        found = pins.find(p => p.name.toLowerCase() === lowerRef);
        if (found) return found;

        // 3. Common aliases
        if (pinType === "output") {
            if (["out", "output", "q", "y", "clk"].includes(lowerRef)) {
                return pins[0];
            }
        } else if (pinType === "input") {
            if (pins.length === 1 && ["in", "input", "d", "a"].includes(lowerRef)) {
                return pins[0];
            }
            if (["in", "input"].includes(lowerRef)) {
                return pins[0];
            }
        }

        return null;
    }

    /**
     * Execute a .sim script string sequentially as a single transaction.
     * Ignores blank lines and comments starting with #.
     * Stops on the first error and rolls back all changes.
     * @param {string} scriptText
     * @returns {{ success: boolean, message?: string, error?: string, line?: number, linesExecuted?: number }}
     */
    executeScript(scriptText) {
        if (typeof scriptText !== "string") {
            return { success: false, error: "Invalid script content" };
        }

        let expandedList;
        try {
            expandedList = expandScript(scriptText);
        } catch (e) {
            return {
                success: false,
                error: e.message
            };
        }

        const initialSnap = JSON.stringify(serializeCircuit(this.circuit, this.registry));

        this.inTransaction = true;
        let executedCount = 0;

        for (const item of expandedList) {
            const res = this.execute(item.command);
            if (!res.success) {
                // Roll back circuit graph to initial snapshot
                deserializeCircuit(JSON.parse(initialSnap), this.circuit, this.registry);
                if (this.engine) {
                    this.engine.evaluateAll();
                }
                this.inTransaction = false;

                const contextHeader = item.loopContext ? `${item.loopContext}\n` : "";
                const errMsg = `Line ${item.line}:\n${contextHeader}${res.error}`;
                return {
                    success: false,
                    line: item.line,
                    error: errMsg,
                    message: errMsg
                };
            }

            executedCount++;
        }

        this.inTransaction = false;

        // Record history state once for the entire successful transaction
        this._saveHistory();

        return {
            success: true,
            linesExecuted: executedCount,
            message: `Successfully executed script (${executedCount} commands)`
        };
    }

    /**
     * Export current circuit graph to .sim script string format.
     * @returns {string}
     */
    exportScript() {
        const lines = ["# Circuit exported to .sim format"];

        // Export buses
        if (this.circuit.buses) {
            for (const bus of this.circuit.buses.values()) {
                lines.push(`bus ${bus.name}[${bus.start}..${bus.end}]`);
            }
        }

        const reverseTypeMap = {
            "Input": "input",
            "Output": "output",
            "Constant HIGH": "constant high",
            "Constant LOW": "constant low",
            "Clock": "clock",
            "Buffer": "buffer",
            "NOT": "not",
            "AND": "and",
            "OR": "or",
            "XOR": "xor",
            "NAND": "nand",
            "NOR": "nor",
            "XNOR": "xnor",
            "LED": "led",
            "7-Segment Display": "7-segment display",
            "10-Segment Display": "10-segment display",
            "Button": "button",
            "NPN Transistor": "npn",
            "PNP Transistor": "pnp"
        };

        // Deterministically sort components by ID
        const sortedComps = Array.from(this.circuit.components.values())
            .sort((a, b) => a.id.localeCompare(b.id));

        for (const comp of sortedComps) {
            const isNet = (comp.type === "Buffer" && comp.label === comp.id);
            if (isNet) {
                lines.push(`net ${comp.id}`);
                lines.push(`move ${comp.id} to (${comp.x},${comp.y})`);
            } else {
                let typeAlias = reverseTypeMap[comp.type];
                if (!typeAlias) {
                    if (comp.type === "UserModule" && comp.definition) {
                        typeAlias = comp.definition.name;
                    } else {
                        typeAlias = comp.type.toLowerCase();
                    }
                }

                lines.push(`add ${typeAlias} ${comp.id}`);
                lines.push(`move ${comp.id} to (${comp.x},${comp.y})`);

                if (comp.label && comp.label !== comp.id) {
                    lines.push(`set ${comp.id}.label ${comp.label}`);
                }
            }

            // Properties
            if (comp.type === "Clock" && comp.frequencyValue !== undefined) {
                lines.push(`set ${comp.id}.freq ${comp.frequencyValue}${comp.frequencyUnit || "Hz"}`);
            } else if (comp.type === "Button") {
                if (comp.buttonMode) {
                    lines.push(`set ${comp.id}.buttonMode ${comp.buttonMode}`);
                }
                if (comp.holdDuration !== undefined) {
                    lines.push(`set ${comp.id}.holdDuration ${comp.holdDuration}`);
                }
            } else if (comp.type === "LED" && comp.ledColor) {
                lines.push(`set ${comp.id}.ledColor ${comp.ledColor}`);
                if (comp.ledColor === "RGBA" && comp.rgbaValue) {
                    lines.push(`set ${comp.id}.rgbaValue ${comp.rgbaValue}`);
                }
            }

            if (comp.rotation) {
                lines.push(`set ${comp.id}.rotation ${comp.rotation}`);
            }
            if (comp.flipX) {
                lines.push(`set ${comp.id}.flipX true`);
            }
            if (comp.flipY) {
                lines.push(`set ${comp.id}.flipY true`);
            }
        }

        // Deterministically sort wires
        const sortedWires = Array.from(this.circuit.wires.values())
            .filter(w => w.fromPin && w.toPin && w.fromPin.component && w.toPin.component)
            .sort((a, b) => {
                const keyA = `${a.fromPin.component.id}.${a.fromPin.name}->${a.toPin.component.id}.${a.toPin.name}`;
                const keyB = `${b.fromPin.component.id}.${b.fromPin.name}->${b.toPin.component.id}.${b.toPin.name}`;
                return keyA.localeCompare(keyB);
            });

        for (const wire of sortedWires) {
            lines.push(`connect ${wire.fromPin.component.id}.${wire.fromPin.name} ${wire.toPin.component.id}.${wire.toPin.name}`);
        }

        return lines.join("\n");
    }
}
