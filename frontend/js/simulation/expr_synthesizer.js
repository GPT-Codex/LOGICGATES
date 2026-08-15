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

    if (engine) {
        engine.evaluateAll();
    }

    return outComp;
}
