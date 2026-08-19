import { Component, Circuit, Pin, Wire } from "./core.js";
import { createComponent } from "./components.js";
import { SimulationEngine } from "./simulation_engine.js";
import { findDefinitionByNameAndType } from "./serialization.js";

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
     * @param {string} moduleType - "Module", "Cable", "Connector"
     * @param {string} type
     * @param {string[]} dependencies - array of child module names/IDs
     */
    constructor(id, name, description, category, inputs, outputs, components, wires, moduleType = "Module", type = null, dependencies = [], params = [], paramValues = null) {
        this.id = id;
        this.name = name;
        this.description = description;
        this.category = category || "Custom";
        this.type = type || this.category || "Custom";
        this.inputs = inputs;   // array of strings
        this.outputs = outputs; // array of strings
        this.components = components; // serialized data
        this.wires = wires;           // serialized data
        this.moduleType = moduleType; // "Module", "Cable", "Connector"
        this.dependencies = dependencies || [];
        this.params = params || [];                 // e.g. ["width"]
        this.paramValues = paramValues || null;      // e.g. { width: 16 }
        this.specializations = new Map();           // paramKey -> ModuleDefinition
    }
}

/**
 * Dependency graph for managing relationships and compilation order of modules.
 */
export class ModuleDependencyGraph {
    constructor() {
        /** @type {Set<string>} */
        this.nodes = new Set();
        /** @type {Map<string, Set<string>>} */
        this.adj = new Map();
    }

    addModule(name) {
        if (!name) return;
        const norm = name.trim();
        this.nodes.add(norm);
        if (!this.adj.has(norm)) {
            this.adj.set(norm, new Set());
        }
    }

    addDependency(fromModule, toModule) {
        if (!fromModule || !toModule) return;
        const normFrom = fromModule.trim();
        const normTo = toModule.trim();
        this.addModule(normFrom);
        this.addModule(normTo);
        this.adj.get(normFrom).add(normTo);
    }

    getDependencies(moduleName) {
        const norm = moduleName.trim();
        return Array.from(this.adj.get(norm) || []);
    }

    /**
     * Detect cycle in dependency graph.
     * @param {string} [startNode]
     * @returns {string[]|null} Array of node names forming a cycle e.g. ["A", "B", "C", "A"], or null if no cycle.
     */
    detectCycle(startNode = null) {
        const visited = new Set();
        const recStack = new Set();
        const path = [];

        const searchNodes = startNode ? [startNode.trim()] : Array.from(this.nodes);

        for (const root of searchNodes) {
            if (!visited.has(root)) {
                const result = this._dfsCycle(root, visited, recStack, path);
                if (result) return result;
            }
        }
        return null;
    }

    _dfsCycle(u, visited, recStack, path) {
        visited.add(u);
        recStack.add(u);
        path.push(u);

        const neighbors = this.adj.get(u) || new Set();
        for (const v of neighbors) {
            if (!visited.has(v)) {
                const res = this._dfsCycle(v, visited, recStack, path);
                if (res) return res;
            } else if (recStack.has(v)) {
                // Cycle found
                const cycleStartIndex = path.indexOf(v);
                const cyclePath = path.slice(cycleStartIndex);
                cyclePath.push(v);
                return cyclePath;
            }
        }

        path.pop();
        recStack.delete(u);
        return null;
    }

    /**
     * Get topological compilation order (dependencies before dependents).
     * @returns {string[]}
     */
    getCompilationOrder() {
        const cycle = this.detectCycle();
        if (cycle) {
            throw new Error(`Circular module dependency: ${cycle.join(" → ")}`);
        }

        const visited = new Set();
        const order = [];

        for (const node of this.nodes) {
            if (!visited.has(node)) {
                this._dfsTopo(node, visited, order);
            }
        }

        return order;
    }

    _dfsTopo(u, visited, order) {
        visited.add(u);
        const neighbors = this.adj.get(u) || new Set();
        for (const v of neighbors) {
            if (!visited.has(v)) {
                this._dfsTopo(v, visited, order);
            }
        }
        order.push(u);
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
     * @param {ModuleRegistry} [registry]
     */
    constructor(id, definition, x = 0, y = 0, registry = null) {
        super(id, definition.name, x, y);
        this.definition = definition;
        this.registry = registry;
        this.params = definition.params || [];
        this.paramValues = definition.paramValues || null;
        this.type = "UserModule";

        // Calculate dynamic dimensions based on pin count
        const pinCount = Math.max(definition.inputs.length, definition.outputs.length);
        this.width = 100;
        this.height = Math.max(60, pinCount * 22 + 20);

        // Sort inputs and outputs alphabetically by pin name
        const sortedInputs = [...definition.inputs].sort((a, b) => a.localeCompare(b));
        const sortedOutputs = [...definition.outputs].sort((a, b) => a.localeCompare(b));

        // Add external pins
        this.inputs = [];
        sortedInputs.forEach((name, idx) => {
            const pin = this.addInput(`${id}_in_${name}`, name);
            pin.side = "left";
            pin.offset = -this.height / 2 + 20 + idx * 22;
            this.applyPinSideMath(pin);
        });

        this.outputs = [];
        sortedOutputs.forEach((name, idx) => {
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
            if (compData.type === "UserModule") {
                // Look up child module definition
                let childDef = compData.definition;
                if (!childDef && this.registry) {
                    if (compData.definitionId) {
                        childDef = this.registry.get(compData.definitionId);
                    }
                    if (!childDef) {
                        for (const d of this.registry.definitions.values()) {
                            if (d.name.toLowerCase() === (compData.label || compData.id).toLowerCase()) {
                                childDef = d;
                                break;
                            }
                        }
                    }
                }
                if (childDef) {
                    comp = new UserModule(compData.id, childDef, compData.x, compData.y, this.registry);
                } else {
                    console.error(`Missing definition for nested custom module '${compData.id}'.`);
                    comp = createComponent("Buffer", compData.id, compData.x, compData.y);
                }
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
        ctx.save();
        let borderCol = "#8e44ad";
        let bgCol = "#2b1b3d";

        if (this.definition && this.definition.moduleType === "Cable") {
            bgCol = "#090909"; // Cable default color is Black
            borderCol = "#444444";
        } else if (this.definition && this.definition.moduleType === "Connector") {
            bgCol = "#112233"; // Connector has distinct steel styling
            borderCol = "#335577";
        }

        // Translate to component center and rotate!
        ctx.translate(this.x, this.y);
        ctx.rotate((this.rotation * Math.PI) / 180);

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
        ctx.save();
        ctx.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        ctx.roundRect(-this.width / 2, -this.height / 2, this.width, this.height, 8);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.restore(); // restore to world coordinates before drawing pins and text

        // Draw outer pins
        this.drawPins(ctx);

        // Draw pin text labels inside the module block based on assigned sides!
        ctx.fillStyle = "#a29bfe";
        ctx.font = "9px sans-serif";
        ctx.textBaseline = "middle";

        this.pins().forEach(pin => {
            const side = pin.side || "left";

            // Map pin screen coordinate relative to component center
            const rx = this.flipX ? -pin.relX : pin.relX;
            const ry = this.flipY ? -pin.relY : pin.relY;

            let visualSide = side;
            if (this.flipX) {
                if (side === "left") visualSide = "right";
                else if (side === "right") visualSide = "left";
            }
            if (this.flipY) {
                if (side === "top") visualSide = "bottom";
                else if (side === "bottom") visualSide = "top";
            }

            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate((this.rotation * Math.PI) / 180);

            if (visualSide === "left") {
                ctx.textAlign = "left";
                ctx.fillText(pin.name, rx + 8, ry);
            } else if (visualSide === "right") {
                ctx.textAlign = "right";
                ctx.fillText(pin.name, rx - 8, ry);
            } else if (visualSide === "top") {
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText(pin.name, rx, ry + 8);
            } else if (visualSide === "bottom") {
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
    }
}

/**
 * Detach a custom module instance, expanding its internal components and remapping external wires.
 * @param {Circuit} circuit
 * @param {UserModule} comp
 * @param {ModuleRegistry} [registry]
 */
export function detachModuleInstance(circuit, comp, registry = null) {
    if (!comp || comp.type !== "UserModule") {
        throw new Error(`Component '${comp ? comp.id : "null"}' is not a custom module instance`);
    }

    const originX = comp.x;
    const originY = comp.y;

    // 1. Gather external wires connected to comp's input/output pins
    const extInputPins = new Set(comp.inputs);
    const extOutputPins = new Set(comp.outputs);

    const extWiresToInputs = [];
    const extWiresFromOutputs = [];

    for (const wire of circuit.wires.values()) {
        if (wire.toPin && extInputPins.has(wire.toPin)) {
            extWiresToInputs.push(wire);
        } else if (wire.fromPin && extOutputPins.has(wire.fromPin)) {
            extWiresFromOutputs.push(wire);
        }
    }

    // 2. Instantiate all internal components of the module onto circuit
    const idMap = new Map();          // innerComp.id -> newComp
    const inputsToGates = new Map();  // portName -> instantiated InputGate
    const outputsToGates = new Map(); // portName -> instantiated OutputGate

    for (const innerC of comp.definition.components) {
        const newId = `${innerC.id}_${Math.random().toString(36).substring(2, 6)}`;

        let newGate;
        if (innerC.type === "UserModule") {
            let childDef = innerC.definition;
            if (!childDef && registry) {
                if (innerC.definitionId) {
                    childDef = registry.get(innerC.definitionId);
                }
                if (!childDef) {
                    childDef = findDefinitionByNameAndType(registry, innerC.label || innerC.id, "Custom");
                }
            }
            if (childDef) {
                newGate = new UserModule(newId, childDef, originX + innerC.x, originY + innerC.y, registry);
            } else {
                newGate = createComponent("Buffer", newId, originX + innerC.x, originY + innerC.y);
            }
        } else {
            newGate = createComponent(innerC.type, newId, originX + innerC.x, originY + innerC.y);
        }

        newGate.label = innerC.label || "";
        circuit.addComponent(newGate);
        idMap.set(innerC.id, newGate);

        if (innerC.type === "Input") {
            inputsToGates.set(innerC.label || innerC.id, newGate);
        } else if (innerC.type === "Output") {
            outputsToGates.set(innerC.label || innerC.id, newGate);
        }
    }

    // 3. Re-create internal wires
    const instantiatedIntWires = [];
    const pinMap = new Map();
    for (const [oldId, newGate] of idMap.entries()) {
        newGate.pins().forEach(p => {
            pinMap.set(`${oldId}_${p.name}`, p);
            pinMap.set(`${oldId}.${p.name}`, p);
        });
    }

    for (const innerW of comp.definition.wires) {
        let fromPinObj = pinMap.get(innerW.fromPin);
        let toPinObj = pinMap.get(innerW.toPin);

        if (!fromPinObj || !toPinObj) {
            const srcParts = innerW.fromPin.split(/[_.]/);
            const dstParts = innerW.toPin.split(/[_.]/);
            const srcComp = idMap.get(srcParts[0]);
            const dstComp = idMap.get(dstParts[0]);
            if (srcComp && dstComp) {
                fromPinObj = srcComp.outputs.find(p => p.name === srcParts[srcParts.length - 1]) || srcComp.outputs[0];
                toPinObj = dstComp.inputs.find(p => p.name === dstParts[dstParts.length - 1]) || dstComp.inputs[0];
            }
        }

        if (fromPinObj && toPinObj) {
            const newWireId = `wire_${Math.random().toString(36).substring(2, 9)}`;
            const wireObj = new Wire(newWireId, fromPinObj, toPinObj, innerW.color || null);
            circuit.addWire(wireObj);
            instantiatedIntWires.push(wireObj);
        }
    }

    // 4. Remap input wires
    for (const [portName, inputGate] of inputsToGates.entries()) {
        const matchingExtWires = extWiresToInputs.filter(w => w.toPin && w.toPin.name === portName);
        const matchingIntWires = instantiatedIntWires.filter(w => w.fromPin && w.fromPin.component === inputGate);

        if (matchingExtWires.length > 0 && matchingIntWires.length > 0) {
            const sourcePin = matchingExtWires[0].fromPin;
            for (const intW of matchingIntWires) {
                intW.fromPin = sourcePin;
            }
            matchingExtWires.forEach(w => circuit.removeWire(w.id));
            circuit.removeComponent(inputGate.id);
        } else if (matchingExtWires.length > 0) {
            matchingExtWires.forEach(w => circuit.removeWire(w.id));
            circuit.removeComponent(inputGate.id);
        }
    }

    // 5. Remap output wires
    for (const [portName, outputGate] of outputsToGates.entries()) {
        const matchingExtWires = extWiresFromOutputs.filter(w => w.fromPin && w.fromPin.name === portName);
        const matchingIntWire = instantiatedIntWires.find(w => w.toPin && w.toPin.component === outputGate);

        if (matchingExtWires.length > 0 && matchingIntWire) {
            const intSourcePin = matchingIntWire.fromPin;
            for (const extW of matchingExtWires) {
                extW.fromPin = intSourcePin;
            }
            circuit.removeWire(matchingIntWire.id);
            circuit.removeComponent(outputGate.id);
        } else if (matchingExtWires.length > 0) {
            matchingExtWires.forEach(w => circuit.removeWire(w.id));
            circuit.removeComponent(outputGate.id);
        }
    }

    // 6. Remove original module instance
    circuit.removeComponent(comp.id);
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
