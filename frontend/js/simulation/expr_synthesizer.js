import { Wire } from "./core.js";
import { createComponent } from "./components.js";

/**
 * Flexible pin lookup for components.
 */
function findPin(comp, pinRef, pinType) {
    if (!comp) return null;
    const pins = comp.pins().filter(p => !pinType || p.type === pinType);
    if (pins.length === 0) return null;

    let found = pins.find(p => p.name === pinRef);
    if (found) return found;

    const lowerRef = (pinRef || "").toLowerCase();
    found = pins.find(p => p.name.toLowerCase() === lowerRef);
    if (found) return found;

    if (pinType === "output") {
        if (pins.length === 1) return pins[0];
        found = pins.find(p => ["q", "y", "clk", "out"].includes(p.name.toLowerCase()));
        if (found) return found;
    } else if (pinType === "input") {
        if (pins.length === 1) return pins[0];
        found = pins.find(p => ["d", "in", "a"].includes(p.name.toLowerCase()));
        if (found) return found;
    }

    return pins[0] || null;
}

/**
 * Connect two pins with a wire.
 */
function connectPins(circuit, fromPin, toPin) {
    for (const wire of circuit.wires.values()) {
        if (wire.toPin === toPin) {
            circuit.removeWire(wire.id);
        }
    }
    const wireId = `wire_${Math.random().toString(36).substring(2, 9)}`;
    const wire = new Wire(wireId, fromPin, toPin);
    circuit.addWire(wire);
    return wire;
}

/**
 * Compute canonical AST string key for subexpression deduplication.
 */
function getAstKey(node) {
    if (node.type === "Variable") {
        return node.name;
    }
    if (node.type === "Unary") {
        return `${node.op}(${getAstKey(node.expr)})`;
    }
    if (node.type === "Binary") {
        const kL = getAstKey(node.left);
        const kR = getAstKey(node.right);
        // Commutative operators: AND, OR, XOR, NAND, NOR, XNOR
        if (["AND", "OR", "XOR", "NAND", "NOR", "XNOR"].includes(node.op)) {
            return `${node.op}(${kL < kR ? kL + "," + kR : kR + "," + kL})`;
        }
        return `${node.op}(${kL},${kR})`;
    }
    return JSON.stringify(node);
}

/**
 * Compute AST node depth for column placement.
 */
function getNodeDepth(node) {
    if (node.type === "Variable") {
        return 0;
    }
    if (node.type === "Unary") {
        return 1 + getNodeDepth(node.expr);
    }
    if (node.type === "Binary") {
        return 1 + Math.max(getNodeDepth(node.left), getNodeDepth(node.right));
    }
    return 0;
}

/**
 * Generate unique gate ID for synthesized components.
 */
function generateGateId(circuit, op) {
    const prefix = `G_${op.toLowerCase()}`;
    let count = 1;
    while (circuit.components.has(`${prefix}_${count}`)) {
        count++;
    }
    return `${prefix}_${count}`;
}

/**
 * Synthesize a boolean AST into gates and wires on the circuit graph.
 * @param {Circuit} circuit
 * @param {string} outputName
 * @param {any} astNode
 * @param {SimulationEngine} [engine]
 * @returns {Component} output component
 */
export function synthesizeExpression(circuit, outputName, astNode, engine) {
    const memoMap = new Map(); // astKey -> { comp, pin }
    const columnYMap = new Map(); // depth -> next Y position

    function getNextPos(depth) {
        if (!columnYMap.has(depth)) {
            columnYMap.set(depth, 100);
        }
        const y = columnYMap.get(depth);
        columnYMap.set(depth, y + 80);

        const x = 100 + depth * 140;
        // Align to grid (20px)
        const snappedX = Math.round(x / 20) * 20;
        const snappedY = Math.round(y / 20) * 20;

        return { x: snappedX, y: snappedY };
    }

    function buildNode(node) {
        const key = getAstKey(node);
        if (memoMap.has(key)) {
            return memoMap.get(key);
        }

        if (node.type === "Variable") {
            let comp = circuit.components.get(node.name);
            if (!comp) {
                const pos = getNextPos(0);
                comp = createComponent("Input", node.name, pos.x, pos.y);
                comp.label = node.name;
                circuit.addComponent(comp);
            }
            const pin = findPin(comp, "out", "output");
            const res = { comp, pin };
            memoMap.set(key, res);
            return res;
        }

        if (node.type === "Unary" && node.op === "NOT") {
            const childRes = buildNode(node.expr);
            const depth = getNodeDepth(node);
            const pos = getNextPos(depth);

            const gateId = generateGateId(circuit, "not");
            const notComp = createComponent("NOT", gateId, pos.x, pos.y);
            circuit.addComponent(notComp);

            const inPin = findPin(notComp, "A", "input");
            connectPins(circuit, childRes.pin, inPin);

            const outPin = findPin(notComp, "Y", "output");
            const res = { comp: notComp, pin: outPin };
            memoMap.set(key, res);
            return res;
        }

        if (node.type === "Binary") {
            const leftRes = buildNode(node.left);
            const rightRes = buildNode(node.right);
            const depth = getNodeDepth(node);
            const pos = getNextPos(depth);

            const typeMap = {
                "AND": "AND",
                "OR": "OR",
                "XOR": "XOR",
                "NAND": "NAND",
                "NOR": "NOR",
                "XNOR": "XNOR"
            };

            const compType = typeMap[node.op] || "AND";
            const gateId = generateGateId(circuit, node.op);
            const gateComp = createComponent(compType, gateId, pos.x, pos.y);
            circuit.addComponent(gateComp);

            const inputs = gateComp.inputs;
            const inPinA = inputs[0] || findPin(gateComp, "A", "input");
            const inPinB = inputs[1] || findPin(gateComp, "B", "input");

            connectPins(circuit, leftRes.pin, inPinA);
            connectPins(circuit, rightRes.pin, inPinB);

            const outPin = findPin(gateComp, "Y", "output");
            const res = { comp: gateComp, pin: outPin };
            memoMap.set(key, res);
            return res;
        }

        throw new Error(`Unsupported AST node type: ${node.type}`);
    }

    // Synthesize expression AST
    const rootRes = buildNode(astNode);

    // Target output component
    let outComp = circuit.components.get(outputName);
    if (!outComp) {
        const rootDepth = getNodeDepth(astNode);
        const pos = getNextPos(rootDepth + 1);
        outComp = createComponent("Output", outputName, pos.x, pos.y);
        outComp.label = outputName;
        circuit.addComponent(outComp);
    }

    const outInPin = findPin(outComp, "D", "input");
    connectPins(circuit, rootRes.pin, outInPin);

    // Run deterministic auto-layout pass
    applyAutoLayout(circuit);

    if (engine) {
        engine.evaluateAll();
    }

    return outComp;
}

/**
 * Auto-layout components in layered columns:
 * - Inputs placed on the left (Column 0) sorted alphabetically.
 * - Intermediate gates placed in topological depth columns (Columns 1..D).
 * - Outputs placed on the right (Column D+1).
 * - Barycenter Y-ordering heuristic minimizes wire crossings deterministically.
 * - All coordinates strictly aligned to 20px grid.
 */
export function applyAutoLayout(circuit) {
    if (!circuit || circuit.components.size === 0) return;

    const comps = Array.from(circuit.components.values());
    const inputs = comps.filter(c => c.type === "Input");
    const outputs = comps.filter(c => c.type === "Output");
    const gates = comps.filter(c => c.type !== "Input" && c.type !== "Output");

    // 1. Calculate topological depth for gates
    const depthMap = new Map();
    inputs.forEach(c => depthMap.set(c.id, 0));

    // Multiple passes to resolve depth for all gates
    let maxDepth = 0;
    for (let pass = 0; pass < gates.length + 1; pass++) {
        for (const gate of gates) {
            let maxSrcDepth = 0;
            for (const wire of circuit.wires.values()) {
                if (wire.toPin && wire.toPin.component.id === gate.id && wire.fromPin) {
                    const srcId = wire.fromPin.component.id;
                    const srcD = depthMap.get(srcId) || 0;
                    if (srcD > maxSrcDepth) {
                        maxSrcDepth = srcD;
                    }
                }
            }
            const gateD = maxSrcDepth + 1;
            depthMap.set(gate.id, gateD);
            if (gateD > maxDepth) {
                maxDepth = gateD;
            }
        }
    }

    if (maxDepth === 0) maxDepth = 1;
    outputs.forEach(c => depthMap.set(c.id, maxDepth + 1));

    // 2. Group components into columns
    const columns = new Map();
    comps.forEach(comp => {
        const d = depthMap.get(comp.id) || 0;
        if (!columns.has(d)) {
            columns.set(d, []);
        }
        columns.get(d).push(comp);
    });

    const yPosMap = new Map();

    // 3. Layout Column 0 (Inputs)
    if (columns.has(0)) {
        const col0 = columns.get(0);
        col0.sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));
        col0.forEach((comp, idx) => {
            const y = 100 + idx * 80;
            yPosMap.set(comp.id, y);
        });
    }

    // 4. Layout Intermediate Gate Columns (1..maxDepth) using Barycenter heuristic
    for (let d = 1; d <= maxDepth; d++) {
        if (!columns.has(d)) continue;
        const colG = columns.get(d);

        const barycenters = new Map();
        for (const gate of colG) {
            let sumY = 0;
            let count = 0;
            for (const wire of circuit.wires.values()) {
                if (wire.toPin && wire.toPin.component.id === gate.id && wire.fromPin) {
                    const srcId = wire.fromPin.component.id;
                    if (yPosMap.has(srcId)) {
                        sumY += yPosMap.get(srcId);
                        count++;
                    }
                }
            }
            const bc = count > 0 ? sumY / count : 100;
            barycenters.set(gate.id, bc);
        }

        colG.sort((a, b) => {
            const bcA = barycenters.get(a.id);
            const bcB = barycenters.get(b.id);
            if (bcA !== bcB) return bcA - bcB;
            return a.id.localeCompare(b.id);
        });

        colG.forEach((gate, idx) => {
            const y = 100 + idx * 80;
            yPosMap.set(gate.id, y);
        });
    }

    // 5. Layout Output Column (maxDepth + 1)
    const outDepth = maxDepth + 1;
    if (columns.has(outDepth)) {
        const colOut = columns.get(outDepth);
        const barycenters = new Map();
        for (const out of colOut) {
            let sumY = 0;
            let count = 0;
            for (const wire of circuit.wires.values()) {
                if (wire.toPin && wire.toPin.component.id === out.id && wire.fromPin) {
                    const srcId = wire.fromPin.component.id;
                    if (yPosMap.has(srcId)) {
                        sumY += yPosMap.get(srcId);
                        count++;
                    }
                }
            }
            const bc = count > 0 ? sumY / count : 100;
            barycenters.set(out.id, bc);
        }

        colOut.sort((a, b) => {
            const bcA = barycenters.get(a.id);
            const bcB = barycenters.get(b.id);
            if (bcA !== bcB) return bcA - bcB;
            return (a.label || a.id).localeCompare(b.label || b.id);
        });

        colOut.forEach((out, idx) => {
            const y = 100 + idx * 80;
            yPosMap.set(out.id, y);
        });
    }

    // 6. Apply Grid-Aligned Coordinates
    comps.forEach(comp => {
        const d = depthMap.get(comp.id) || 0;
        const x = 100 + d * 160;
        const y = yPosMap.get(comp.id) || 100;

        comp.x = Math.round(x / 20) * 20;
        comp.y = Math.round(y / 20) * 20;
    });
}
