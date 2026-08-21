import assert from "assert";
import { Circuit, Wire } from "../frontend/js/simulation/core.js";
import { createComponent } from "../frontend/js/simulation/components.js";
import { ModuleRegistry, ModuleDefinition } from "../frontend/js/simulation/modules.js";
import { serializeCircuit, deserializeCircuit } from "../frontend/js/simulation/serialization.js";

function runTests() {
    console.log("Running serialization tests...");

    const registry = new ModuleRegistry();
    const circuit = new Circuit();

    // Setup input, NOT, output
    const input = createComponent("Input", "in_1", 10, 20);
    input.label = "My Input";
    const notGate = createComponent("NOT", "not_1", 100, 20);
    const output = createComponent("Output", "out_1", 200, 20);

    circuit.addComponent(input);
    circuit.addComponent(notGate);
    circuit.addComponent(output);

    const wire1 = new Wire("w1", input.outputs[0], notGate.inputs[0], "#ff00ff");
    const wire2 = new Wire("w2", notGate.outputs[0], output.inputs[0]);

    circuit.addWire(wire1);
    circuit.addWire(wire2);

    // 1. Serialize
    const serialized = serializeCircuit(circuit, registry);

    assert.strictEqual(serialized.components.length, 3);
    assert.strictEqual(serialized.wires.length, 2);
    assert.strictEqual(serialized.components[0].label, "My Input");
    assert.strictEqual(serialized.wires[0].color, "#ff00ff");

    // 2. Deserialize onto fresh circuit
    const freshCircuit = new Circuit();
    const freshRegistry = new ModuleRegistry();

    deserializeCircuit(serialized, freshCircuit, freshRegistry);

    assert.strictEqual(freshCircuit.components.size, 3);
    assert.strictEqual(freshCircuit.wires.size, 2);

    const freshInput = freshCircuit.components.get("in_1");
    assert.strictEqual(freshInput.label, "My Input");
    assert.strictEqual(freshInput.x, 10);
    assert.strictEqual(freshInput.y, 20);

    const freshWire1 = freshCircuit.wires.get("w1");
    assert.strictEqual(freshWire1.color, "#ff00ff");
    assert.strictEqual(freshWire1.fromPin.id, "in_1_out");
    assert.strictEqual(freshWire1.toPin.id, "not_1_in");

    console.log("Serialization tests passed successfully!");
}

runTests();
