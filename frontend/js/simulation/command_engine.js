import { createComponent, COMPONENT_REGISTRY } from "./components.js";
import { Circuit, Wire, Bus } from "./core.js";
import { UserModule, ModuleDefinition, detachModuleInstance } from "./modules.js";
import { serializeCircuit, deserializeCircuit } from "./serialization.js";
import { parseBooleanExpression } from "./expr_parser.js";
import { synthesizeExpression } from "./expr_synthesizer.js";
import { expandScript, compileModuleDefinition, buildScriptModuleDependencyGraph, parseAndValidateModuleArgs, processScriptImports, defaultFileResolver, normalizePath } from "./script_parser.js";
import { SimulationEngine } from "./simulation_engine.js";
import { findDefinitionByNameAndType } from "./serialization.js";

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

        // Handle special internal module definition token
        if (cmd === "__module_def__" && parts.length >= 2) {
            return { success: true, message: `Module ${parts[1]} definition block` };
        }

        // Handle show module command: show module ModuleName
        if (cmd === "show" && parts.length >= 3 && parts[1].toLowerCase() === "module") {
            return this._handleShowModule(parts[2]);
        }

        // Handle show library command: show library "PATH"
        if (cmd === "show" && parts.length >= 3 && parts[1].toLowerCase() === "library") {
            return this._handleShowLibrary(parts.slice(2).join(" ").trim());
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
                case "trace":
                    return this._handleTrace(parts.slice(1).join(" "));
                case "expand":
                    return this._handleExpand(parts[1]);
                case "detach":
                    return this._handleDetach(parts[1]);
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
        let rawTypeStr = parts.slice(1, -1).join(" ").trim();

        // Check for parameterized instantiation: TYPE(ARGS)
        let paramArgsStr = null;
        const argMatch = rawTypeStr.match(/^([a-zA-Z0-9_\s]+)\(([^)]*)\)$/);
        if (argMatch) {
            rawTypeStr = argMatch[1].trim();
            paramArgsStr = argMatch[2].trim();
        }

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

        // If UserModule with parameters, handle specialization
        if (actualType === "UserModule" && customDef) {
            if (customDef.params && customDef.params.length > 0) {
                try {
                    const paramScope = parseAndValidateModuleArgs(
                        customDef.params,
                        paramArgsStr,
                        customDef.name,
                        name
                    );

                    // Build deterministic key for specialized definition
                    const specKey = customDef.params.map(p => `${p}=${paramScope[p]}`).join(",");
                    let specDef = customDef.specializations.get(specKey);

                    if (!specDef) {
                        const specName = `${customDef.name}_${specKey.replace(/[^a-zA-Z0-9_]/g, "_")}`;

                        specDef = compileModuleDefinition(
                            customDef.name,
                            customDef.rawBodyText || "",
                            customDef.startLine || 1,
                            this.registry,
                            CommandEngine,
                            SimulationEngine,
                            paramScope,
                            customDef.params
                        );

                        customDef.specializations.set(specKey, specDef);
                        if (this.registry) {
                            this.registry.register(specDef);
                        }
                    }

                    customDef = specDef;
                } catch (e) {
                    return { success: false, error: e.message };
                }
            } else if (paramArgsStr) {
                return { success: false, error: `Module '${customDef.name}' does not accept parameters.` };
            }
        }

        // Create component at default position (100, 100) or center
        let comp;
        if (actualType === "UserModule" && customDef) {
            comp = new UserModule(name, customDef, 100, 100, this.registry);
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

    _resolveHierarchicalRef(ref, pinType) {
        if (!ref) return null;

        // Check top-level component directly first
        if (this.circuit.components.has(ref)) {
            const comp = this.circuit.components.get(ref);
            const pin = this._findPin(comp, null, pinType);
            return { comp, pin, circuit: this.circuit };
        }

        const parts = ref.split(".");
        if (parts.length === 1) {
            const comp = this.circuit.components.get(parts[0]);
            if (!comp) return null;
            const pin = this._findPin(comp, null, pinType);
            return { comp, pin, circuit: this.circuit };
        }

        // Try single level component.pin
        if (parts.length === 2) {
            const compName = parts[0];
            const pinName = parts[1];
            const comp = this.circuit.components.get(compName);
            if (comp) {
                const pin = this._findPin(comp, pinName, pinType);
                if (pin) return { comp, pin, circuit: this.circuit };
            }
        }

        // Multi-level traversal (e.g. RIPPLE.FA0.Cout)
        let currCircuit = this.circuit;
        let currComp = null;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            currComp = currCircuit.components.get(part);
            if (!currComp) return null;

            if (i < parts.length - 2) {
                if (currComp.type === "UserModule" && currComp.innerCircuit) {
                    currCircuit = currComp.innerCircuit;
                } else {
                    return null;
                }
            }
        }

        if (currComp) {
            const targetPinName = parts[parts.length - 1];
            const pin = this._findPin(currComp, targetPinName, pinType);
            if (pin) return { comp: currComp, pin, circuit: currCircuit };
        }

        return null;
    }

    _handleConnect(parts, original) {
        // Syntax:
        // connect FROM TO OR connect FROM -> TO
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

        // Resolve vector pin references (buses or vector ports on components)
        const fromVector = this._getVectorPinRefs(fromCompName, fromPinName, "output");
        const toVector = this._getVectorPinRefs(toCompName, toPinName, "input");

        if (fromVector || toVector) {
            const srcList = fromVector || [fromRef];
            const dstList = toVector || [toRef];

            if (srcList.length !== dstList.length) {
                return {
                    success: false,
                    error: `Cannot connect ${fromRef} to ${toRef}: source width = ${srcList.length}, destination width = ${dstList.length}`
                };
            }

            let lastRes = { success: true, message: `Successfully connected ${fromRef} to ${toRef}` };
            for (let i = 0; i < srcList.length; i++) {
                const res = this.execute(`connect ${srcList[i]} ${dstList[i]}`);
                if (!res.success) return res;
                lastRes = res;
            }
            return lastRes;
        }

        const resolvedFrom = this._resolveHierarchicalRef(fromRef, "output");
        if (!resolvedFrom || !resolvedFrom.pin) {
            return { success: false, error: `Unknown component, net, or output pin '${fromRef}'` };
        }

        const resolvedTo = this._resolveHierarchicalRef(toRef, "input");
        if (!resolvedTo || !resolvedTo.pin) {
            return { success: false, error: `Unknown component, net, or input pin '${toRef}'` };
        }

        const fromComp = resolvedFrom.comp;
        const fromPin = resolvedFrom.pin;
        const toComp = resolvedTo.comp;
        const toPin = resolvedTo.pin;
        const targetCircuit = resolvedTo.circuit || this.circuit;

        if (fromComp === toComp) {
            return { success: false, error: "Cannot connect a component to itself" };
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

    _handleShowModule(moduleName) {
        if (!this.registry) {
            return { success: false, error: "ModuleRegistry not available" };
        }

        let foundDef = null;
        for (const def of this.registry.definitions.values()) {
            if (def.id.toLowerCase() === moduleName.toLowerCase() || def.name.toLowerCase() === moduleName.toLowerCase()) {
                foundDef = def;
                break;
            }
        }

        if (!foundDef) {
            return { success: false, error: `Unknown module '${moduleName}'` };
        }

        const formatPortList = (portList) => {
            const grouped = [];
            const processed = new Set();

            for (const p of portList) {
                if (processed.has(p)) continue;
                const match = p.match(/^([a-zA-Z][a-zA-Z0-9_]*)\[(\d+)\]$/);
                if (match) {
                    const base = match[1];
                    const indices = [];
                    for (const other of portList) {
                        const m = other.match(/^([a-zA-Z][a-zA-Z0-9_]*)\[(\d+)\]$/);
                        if (m && m[1] === base) {
                            indices.push(parseInt(m[2], 10));
                            processed.add(other);
                        }
                    }
                    if (indices.length > 1) {
                        const minIdx = Math.min(...indices);
                        const maxIdx = Math.max(...indices);
                        grouped.push(`${base}[${minIdx}..${maxIdx}]`);
                    } else {
                        grouped.push(p);
                        processed.add(p);
                    }
                } else {
                    grouped.push(p);
                    processed.add(p);
                }
            }
            return grouped;
        };

        const inputsFormatted = formatPortList(foundDef.inputs);
        const outputsFormatted = formatPortList(foundDef.outputs);

        const instances = [];
        for (const comp of foundDef.components) {
            if (comp.type === "UserModule") {
                const typeName = comp.definition ? comp.definition.name : (comp.definitionId || comp.type);
                instances.push(`  ${comp.id} : ${typeName}`);
            } else if (comp.type !== "Input" && comp.type !== "Output") {
                instances.push(`  ${comp.id} : ${comp.type}`);
            }
        }

        const deps = foundDef.dependencies && foundDef.dependencies.length > 0
            ? foundDef.dependencies.map(d => `  ${d}`)
            : ["  (none)"];

        const lines = [
            `Module: ${foundDef.name}`,
            ...(foundDef.params && foundDef.params.length > 0 ? [`Parameters: ${foundDef.params.join(", ")}`] : []),
            "",
            "Inputs:",
            ...(inputsFormatted.length > 0 ? inputsFormatted.map(i => `  ${i}`) : ["  (none)"]),
            "",
            "Outputs:",
            ...(outputsFormatted.length > 0 ? outputsFormatted.map(o => `  ${o}`) : ["  (none)"]),
            "",
            "Instances:",
            ...(instances.length > 0 ? instances : ["  (none)"]),
            "",
            "Dependencies:",
            ...deps
        ];

        const output = lines.join("\n");
        return { success: true, data: output, message: output };
    }

    async _handleShowLibrary(rawPath) {
        if (!rawPath) {
            return { success: false, error: "Syntax: show library \"PATH\"" };
        }
        const normPath = normalizePath(rawPath.replace(/^['"]|['"]$/g, ""));

        let meta = this.lastLibraryMetadata ? this.lastLibraryMetadata.get(normPath) : null;

        if (!meta) {
            try {
                const content = defaultFileResolver(normPath);
                if (content.INFO == "ERROR") {
                    return { success: false, error: content.DATA };
                }
                const importedRes = processScriptImports(content.DATA, normPath);
                if (importedRes.success === false) {
                    return { success: false, error: importedRes.error };
                }
                meta = importedRes.libraryMetadata.get(normPath) || {
                    filePath: normPath,
                    imports: Array.from(importedRes.importGraph.adj.get(normPath) || []),
                    constants: Object.keys(importedRes.resolvedConstants),
                    modules: importedRes.importedModuleDefs.map(m => m.name)
                };
            } catch (e) {
                return { success: false, error: `Could not inspect library '${normPath}': ${e.message}` };
            }
        }

        const lines = [
            `Library: ${meta.filePath || normPath}`,
            "",
            "Imported Dependencies:",
            ...(meta.imports && meta.imports.length > 0 ? meta.imports.map(i => `  - ${i}`) : ["  (none)"]),
            "",
            "Constants:",
            ...(meta.constants && meta.constants.length > 0 ? meta.constants.map(c => `  - ${c}`) : ["  (none)"]),
            "",
            "Module Definitions:",
            ...(meta.modules && meta.modules.length > 0 ? meta.modules.map(m => `  - ${m}`) : ["  (none)"])
        ];

        const output = lines.join("\n");
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

        const res = this._resolveHierarchicalRef(name, null);
        const comp = res ? res.comp : this.circuit.components.get(name);

        if (!comp) {
            return { success: false, error: `Unknown component or bus '${name}'` };
        }

        if (comp.type === "UserModule") {
            const defName = comp.definition ? comp.definition.name : "UserModule";
            const props = [
                `Instance: ${comp.id}`,
                `Type: ${defName}`,
                ...(comp.paramValues && Object.keys(comp.paramValues).length > 0
                    ? [`Parameters: ${Object.entries(comp.paramValues).map(([k, v]) => `${k} = ${v}`).join(", ")}`]
                    : []),
                `Position: (${comp.x}, ${comp.y})`,
                `Flip: H=${comp.flipX ? "yes" : "no"}, V=${comp.flipY ? "yes" : "no"}`,
                "",
                "Inputs:"
            ];

            comp.inputs.forEach(p => {
                props.push(`  ${p.name} = ${p.value}`);
            });

            props.push("", "Outputs:");
            comp.outputs.forEach(p => {
                props.push(`  ${p.name} = ${p.value}`);
            });

            props.push("", "Connections:");
            const parentCircuit = res.circuit || this.circuit;
            let connCount = 0;

            for (const wire of parentCircuit.wires.values()) {
                if (wire.toPin && wire.toPin.component === comp) {
                    const srcComp = wire.fromPin.component;
                    props.push(`  ${wire.toPin.name}: ${srcComp.id}.${wire.fromPin.name}`);
                    connCount++;
                } else if (wire.fromPin && wire.fromPin.component === comp) {
                    const dstComp = wire.toPin.component;
                    props.push(`  ${wire.fromPin.name} -> ${dstComp.id}.${wire.toPin.name}`);
                    connCount++;
                }
            }
            if (connCount === 0) {
                props.push("  (none)");
            }

            const output = props.join("\n");
            return { success: true, data: output, message: output };
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

    _handleTrace(pinRef) {
        if (!pinRef) {
            return { success: false, error: "Syntax: trace PIN_REFERENCE (e.g. trace FA0.Cout)" };
        }

        const res = this._resolveHierarchicalRef(pinRef, null);
        if (!res || !res.pin) {
            return { success: false, error: `Unknown pin reference '${pinRef}'` };
        }

        const path = [pinRef];
        const visitedWires = new Set();

        let currPin = res.pin;
        let currComp = res.comp;
        let currCircuit = res.circuit || this.circuit;

        let depth = 0;
        while (currPin && depth < 20) {
            depth++;
            if (currPin.type === "output") {
                const wire = Array.from(currCircuit.wires.values()).find(w => w.fromPin === currPin && !visitedWires.has(w.id));
                if (wire) {
                    visitedWires.add(wire.id);
                    const nextPin = wire.toPin;
                    const nextComp = nextPin.component;
                    const nextRef = `${nextComp.id}.${nextPin.name}`;
                    path.push(nextRef);

                    if (nextComp.type === "Output" && currComp.type === "UserModule") {
                        const extOutputPin = currComp.outputs.find(p => p.name === (nextComp.label || nextComp.id));
                        if (extOutputPin) {
                            path.push(`${currComp.id}.${extOutputPin.name}`);
                            currPin = extOutputPin;
                            currComp = currComp;
                            currCircuit = this.circuit;
                            continue;
                        }
                    } else if (nextComp.type === "UserModule") {
                        const innerInputGate = nextComp.internalInputsMap ? nextComp.internalInputsMap.get(nextPin.name) : null;
                        if (innerInputGate) {
                            currPin = innerInputGate.outputs[0];
                            currComp = innerInputGate;
                            currCircuit = nextComp.innerCircuit;
                            continue;
                        }
                    }
                    currPin = nextPin;
                    currComp = nextComp;
                } else {
                    break;
                }
            } else if (currPin.type === "input") {
                const wire = Array.from(currCircuit.wires.values()).find(w => w.toPin === currPin && !visitedWires.has(w.id));
                if (wire) {
                    visitedWires.add(wire.id);
                    const nextPin = wire.fromPin;
                    const nextComp = nextPin.component;
                    const nextRef = `${nextComp.id}.${nextPin.name}`;
                    path.unshift(nextRef);
                    currPin = nextPin;
                    currComp = nextComp;
                } else {
                    break;
                }
            }
        }

        const formatted = path.join("\n↓\n");
        return { success: true, data: formatted, message: formatted };
    }

    _handleExpand(target) {
        if (!target) {
            return { success: false, error: "Syntax: expand MODULE_NAME_OR_INSTANCE" };
        }

        let foundDef = null;
        if (this.registry) {
            for (const def of this.registry.definitions.values()) {
                if (def.name.toLowerCase() === target.toLowerCase() || def.id.toLowerCase() === target.toLowerCase()) {
                    foundDef = def;
                    break;
                }
            }
        }

        const instanceComp = this.circuit.components.get(target);
        if (instanceComp && instanceComp.type === "UserModule") {
            foundDef = instanceComp.definition;
        }

        if (!foundDef) {
            return { success: false, error: `Unknown module or instance '${target}'` };
        }

        const lines = [foundDef.name];

        const subComps = foundDef.components.filter(c => c.type !== "Input" && c.type !== "Output");
        subComps.forEach((comp, idx) => {
            const isLast = idx === subComps.length - 1;
            const prefix = isLast ? "└── " : "├── ";
            let typeName = comp.type;
            if (comp.type === "UserModule" && comp.definition) {
                typeName = comp.definition.name;
            } else if (comp.definitionId) {
                const childDef = this.registry ? this.registry.get(comp.definitionId) : null;
                if (childDef) typeName = childDef.name;
            }
            lines.push(`${prefix}${comp.id} : ${typeName}`);
        });

        if (foundDef.wires && foundDef.wires.length > 0) {
            lines.push("", "Connections:");
            foundDef.wires.forEach(w => {
                lines.push(`  ${w.fromPin} -> ${w.toPin}`);
            });
        }

        const output = lines.join("\n");
        return { success: true, data: output, message: output };
    }

    _handleDetach(instanceName) {
        if (!instanceName) {
            return { success: false, error: "Syntax: detach INSTANCE_NAME" };
        }

        const comp = this.circuit.components.get(instanceName);
        if (!comp) {
            return { success: false, error: `Unknown component '${instanceName}'` };
        }

        if (comp.type !== "UserModule") {
            return { success: false, error: `Component '${instanceName}' is not a custom module instance` };
        }

        try {
            detachModuleInstance(this.circuit, comp, this.registry);
            if (this.engine) {
                this.engine.evaluateAll();
            }
            this._saveHistory();
            return { success: true, message: `Successfully detached module instance '${instanceName}'` };
        } catch (e) {
            return { success: false, error: `Detach failed: ${e.message}` };
        }
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
     * Resolve vector pin references (e.g., bus 'A' or module vector port 'A' -> ['FA.A[0]', 'FA.A[1]', ...])
     * @param {string} compName
     * @param {string|null} pinName
     * @param {string} pinType - "input" or "output"
     * @returns {string[]|null} Array of full pin reference strings, or null if scalar/not found.
     */
    _getVectorPinRefs(compName, pinName, pinType) {
        // 1. Check if compName is a registered bus
        if (this.circuit && this.circuit.buses && this.circuit.buses.has(compName)) {
            const bus = this.circuit.buses.get(compName);
            return bus.members;
        }

        // 2. Check if compName is a component on the circuit
        if (this.circuit && this.circuit.components && this.circuit.components.has(compName)) {
            const comp = this.circuit.components.get(compName);

            // If pinName is specified (e.g. MOD.A), look for matching indexed pins
            if (pinName) {
                const prefix = `${pinName}[`;
                const matchingPins = comp.pins().filter(p => p.type === pinType && p.name.startsWith(prefix));
                if (matchingPins.length > 0) {
                    // Sort deterministically by index
                    matchingPins.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                    return matchingPins.map(p => `${compName}.${p.name}`);
                }
            } else if (comp.type === "UserModule") {
                // If no pinName specified, collect all pins of pinType on the module
                const matchingPins = comp.pins().filter(p => p.type === pinType);
                if (matchingPins.length > 1) {
                    matchingPins.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                    return matchingPins.map(p => `${compName}.${p.name}`);
                }
            }
        }

        return null;
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
    async executeScript(scriptText, options = {}) {
        if (typeof scriptText !== "string") {
            return { success: false, error: "Invalid script content" };
        }

        const initialSnap = JSON.stringify(serializeCircuit(this.circuit, this.registry));
        const initialRegistryKeys = new Set(this.registry ? Array.from(this.registry.definitions.keys()) : []);

        let importedRes;
        
        try {
            importedRes = await processScriptImports(scriptText, options.filePath || "main.sim", options);
            console.log(importedRes);
            if (importedRes.success === false) {
                return { success: false, error: importedRes.error };
            }
        } catch (e) {
            return { success: false, error: e.message };
        }

        this.lastLibraryMetadata = importedRes.libraryMetadata;

        let expandedList;
        try {
            expandedList = expandScript(scriptText, importedRes.resolvedConstants);
        } catch (e) {
            return {
                success: false,
                error: e.message
            };
        }

        this.inTransaction = true;
        let executedCount = 0;

        // Combine imported module definitions with top-level script module definitions
        const allModuleDefs = [
            ...importedRes.importedModuleDefs,
            ...expandedList.filter(item => item.moduleDef).map(item => item.moduleDef)
        ];

        if (allModuleDefs.length > 0) {
            const graph = buildScriptModuleDependencyGraph(allModuleDefs, this.registry);
            const cycle = graph.detectCycle();
            if (cycle) {
                deserializeCircuit(JSON.parse(initialSnap), this.circuit, this.registry);
                if (this.registry) {
                    for (const key of Array.from(this.registry.definitions.keys())) {
                        if (!initialRegistryKeys.has(key)) this.registry.delete(key);
                    }
                }
                if (this.engine) this.engine.evaluateAll();
                this.inTransaction = false;

                const primaryModule = cycle[0];
                const cycleStr = cycle.join(" → ");
                let errMsg = `Cannot compile module ${primaryModule}.\nCircular module dependency: ${cycleStr}`;
                if (cycle.length === 2 && cycle[0] === cycle[1]) {
                    errMsg += ` (cannot instantiate module '${primaryModule}' recursively)`;
                } else {
                    errMsg += ` (Recursive module dependency detected)`;
                }
                return {
                    success: false,
                    error: errMsg,
                    message: errMsg
                };
            }

            let topoOrder;
            try {
                topoOrder = graph.getCompilationOrder();
            } catch (e) {
                deserializeCircuit(JSON.parse(initialSnap), this.circuit, this.registry);
                if (this.registry) {
                    for (const key of Array.from(this.registry.definitions.keys())) {
                        if (!initialRegistryKeys.has(key)) this.registry.delete(key);
                    }
                }
                if (this.engine) this.engine.evaluateAll();
                this.inTransaction = false;
                return { success: false, error: e.message };
            }

            const moduleMap = new Map();
            for (const mDef of allModuleDefs) {
                moduleMap.set(mDef.name.toLowerCase(), mDef);
            }

            const orderedDefs = topoOrder
                .map(name => moduleMap.get(name.toLowerCase()))
                .filter(Boolean);

            for (const mDef of orderedDefs) {
                try {
                    if (mDef.params && mDef.params.length > 0) {
                        const modId = `mod_${mDef.name.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;
                        const templateDef = new ModuleDefinition(
                            modId,
                            mDef.name,
                            `Parameterized script-defined module ${mDef.name}`,
                            "Custom",
                            [], [], [], [],
                            "Module", "Custom", [],
                            mDef.params, null
                        );
                        templateDef.rawBodyText = mDef.rawBodyText;
                        templateDef.startLine = mDef.startLine;

                        if (this.registry) {
                            const existingDef = findDefinitionByNameAndType(this.registry, templateDef.name, templateDef.type || "Custom");
                            if (existingDef) {
                                existingDef.params = mDef.params;
                                existingDef.rawBodyText = mDef.rawBodyText;
                                existingDef.startLine = mDef.startLine;
                            } else {
                                this.registry.register(templateDef);
                            }
                        }
                    } else {
                        const compiledDef = compileModuleDefinition(
                            mDef.name,
                            mDef.rawBodyText,
                            mDef.startLine,
                            this.registry,
                            CommandEngine,
                            SimulationEngine,
                            importedRes.resolvedConstants
                        );

                        if (this.registry) {
                            const existingDef = findDefinitionByNameAndType(this.registry, compiledDef.name, compiledDef.type || "Custom");
                            if (existingDef) {
                                existingDef.inputs = compiledDef.inputs;
                                existingDef.outputs = compiledDef.outputs;
                                existingDef.components = compiledDef.components;
                                existingDef.wires = compiledDef.wires;
                                existingDef.dependencies = compiledDef.dependencies;
                            } else {
                                this.registry.register(compiledDef);
                            }
                        }
                    }
                    executedCount++;
                } catch (e) {
                    deserializeCircuit(JSON.parse(initialSnap), this.circuit, this.registry);
                    if (this.registry) {
                        for (const key of Array.from(this.registry.definitions.keys())) {
                            if (!initialRegistryKeys.has(key)) this.registry.delete(key);
                        }
                    }
                    if (this.engine) this.engine.evaluateAll();
                    this.inTransaction = false;

                    const srcHeader = mDef.sourceFile ? `Error compiling ${mDef.sourceFile}\n` : "";
                    return {
                        success: false,
                        line: mDef.startLine,
                        error: `${srcHeader}${e.message}`,
                        message: `${srcHeader}${e.message}`
                    };
                }
            }
        }

        // 5. Execute non-module top-level commands
        for (const item of expandedList) {
            if (item.moduleDef) continue; // Already compiled above

            const res = this.execute(item.command);
            if (!res.success) {
                deserializeCircuit(JSON.parse(initialSnap), this.circuit, this.registry);
                if (this.registry) {
                    for (const key of Array.from(this.registry.definitions.keys())) {
                        if (!initialRegistryKeys.has(key)) this.registry.delete(key);
                    }
                }
                if (this.engine) this.engine.evaluateAll();
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
     * Export a ModuleDefinition into a .sim script block.
     * @param {ModuleDefinition} def
     * @returns {string}
     */
    _exportModuleDefinition(def) {
        const paramsHeader = def.params && def.params.length > 0 ? `(${def.params.join(", ")})` : "";
        const lines = [`module ${def.name}${paramsHeader} {`];

        // 1. Export input ports in def.inputs order
        for (const inputName of def.inputs) {
            lines.push(`    input ${inputName}`);
        }

        // 2. Export output ports in def.outputs order
        for (const outputName of def.outputs) {
            lines.push(`    output ${outputName}`);
        }

        // Build temporary circuit for subcircuit component & wire export
        const tempCircuit = new Circuit();
        deserializeCircuit({
            components: def.components,
            wires: def.wires,
            buses: [],
            definitions: []
        }, tempCircuit, this.registry);

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

        const inputGateNames = new Set(def.inputs);
        const outputGateNames = new Set(def.outputs);

        // Sort inner components
        const sortedComps = Array.from(tempCircuit.components.values())
            .sort((a, b) => a.id.localeCompare(b.id));

        for (const comp of sortedComps) {
            // Skip port Input / Output gates since they are declared via input/output statements
            if (comp.type === "Input" && (inputGateNames.has(comp.id) || inputGateNames.has(comp.label))) continue;
            if (comp.type === "Output" && (outputGateNames.has(comp.id) || outputGateNames.has(comp.label))) continue;

            let typeAlias = reverseTypeMap[comp.type];
            if (!typeAlias) {
                if (comp.type === "UserModule" && comp.definition) {
                    typeAlias = comp.definition.name;
                } else {
                    typeAlias = comp.type.toLowerCase();
                }
            }

            lines.push(`    add ${typeAlias} ${comp.id}`);
            lines.push(`    move ${comp.id} to (${comp.x},${comp.y})`);

            if (comp.label && comp.label !== comp.id) {
                lines.push(`    set ${comp.id}.label ${comp.label}`);
            }
        }

        // Export inner wires
        const sortedWires = Array.from(tempCircuit.wires.values())
            .filter(w => w.fromPin && w.toPin && w.fromPin.component && w.toPin.component)
            .sort((a, b) => {
                const keyA = `${a.fromPin.component.id}.${a.fromPin.name}->${a.toPin.component.id}.${a.toPin.name}`;
                const keyB = `${b.fromPin.component.id}.${b.fromPin.name}->${b.toPin.component.id}.${b.toPin.name}`;
                return keyA.localeCompare(keyB);
            });

        for (const wire of sortedWires) {
            const srcComp = wire.fromPin.component;
            const dstComp = wire.toPin.component;

            let srcRef = "";
            if (srcComp.type === "Input" && (inputGateNames.has(srcComp.id) || inputGateNames.has(srcComp.label))) {
                srcRef = srcComp.label || srcComp.id;
            } else {
                srcRef = `${srcComp.id}.${wire.fromPin.name}`;
            }

            let dstRef = "";
            if (dstComp.type === "Output" && (outputGateNames.has(dstComp.id) || outputGateNames.has(dstComp.label))) {
                dstRef = dstComp.label || dstComp.id;
            } else {
                dstRef = `${dstComp.id}.${wire.toPin.name}`;
            }

            lines.push(`    connect ${srcRef} ${dstRef}`);
        }

        lines.push("}");
        return lines.join("\n");
    }

    /**
     * Export current circuit graph to .sim script string format.
     * @returns {string}
     */
    exportScript() {
        const lines = ["# Circuit exported to .sim format"];

        // Export custom module definitions
        if (this.registry) {
            for (const def of this.registry.definitions.values()) {
                lines.push(this._exportModuleDefinition(def));
                lines.push("");
            }
        }

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
