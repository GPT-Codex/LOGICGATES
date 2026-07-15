import { Circuit, Wire } from "../frontend/js/simulation/core.js";
import { BufferGate } from "../frontend/js/simulation/components.js";
import { deserializeCircuit, serializeCircuit } from "../frontend/js/simulation/serialization.js";

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assertion failed");
    }
}

console.log("Running Editable Wire Routing unit tests...");

// Set up simple circuit with a wire connecting two gates
const circuit = new Circuit();
const g1 = new BufferGate("g1", 100, 100);
const g2 = new BufferGate("g2", 300, 100);
circuit.addComponent(g1);
circuit.addComponent(g2);

const pin1 = g1.outputs[0];
const pin2 = g2.inputs[0];
const wire = new Wire("w1", pin1, pin2);
circuit.addWire(wire);

// Initially not manually routed
assert(wire.isManuallyRouted === false, "Should default to automatic routing");

// Trigger a serialization
const serialized = serializeCircuit(circuit, null);
assert(serialized.wires[0].isManuallyRouted === false, "Serialized property should be false");

// Now let's simulate adding bend points and enabling manual routing
wire.isManuallyRouted = true;
wire.points = [
    { x: 125, y: 100 },
    { x: 200, y: 150 },
    { x: 275, y: 100 }
];

const serializedManual = serializeCircuit(circuit, null);
assert(serializedManual.wires[0].isManuallyRouted === true, "Serialized property should be true for manual");
assert(serializedManual.wires[0].points.length === 3, "Serialized bend points length should be 3");

// Let's deserialize into a new circuit
const circuit2 = new Circuit();
deserializeCircuit(serializedManual, circuit2, null);
const loadedWire = circuit2.wires.get("w1");
assert(loadedWire !== undefined, "Manual wire should be loaded");
assert(loadedWire.isManuallyRouted === true, "Loaded wire should have isManuallyRouted = true");
assert(loadedWire.points.length === 3, "Loaded wire should have 3 bend points");
assert(loadedWire.points[1].x === 200 && loadedWire.points[1].y === 150, "Loaded bend point coordinate should match");

console.log("Editable Wire Routing unit tests passed successfully!");
