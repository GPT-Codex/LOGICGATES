import assert from "assert";
import { createComponent, COMPONENT_REGISTRY, SKINS } from "../frontend/js/simulation/components.js";
import { Circuit } from "../frontend/js/simulation/core.js";

function runTests() {
    console.log("Running component & core tests...");

    // Test Circuit creation
    const circuit = new Circuit();
    assert.strictEqual(circuit.components.size, 0);
    assert.strictEqual(circuit.wires.size, 0);

    // Test AND gate creation
    const andGate = createComponent("AND", "and_1", 100, 200);
    assert.strictEqual(andGate.type, "AND");
    assert.strictEqual(andGate.id, "and_1");
    assert.strictEqual(andGate.x, 100);
    assert.strictEqual(andGate.y, 200);
    assert.strictEqual(andGate.inputs.length, 2);
    assert.strictEqual(andGate.outputs.length, 1);

    // Test AND gate evaluation (0 & 0 = 0)
    andGate.inputs[0].value = 0;
    andGate.inputs[1].value = 0;
    andGate.evaluate();
    assert.strictEqual(andGate.outputs[0].value, 0);

    // (1 & 1 = 1)
    andGate.inputs[0].value = 1;
    andGate.inputs[1].value = 1;
    andGate.evaluate();
    assert.strictEqual(andGate.outputs[0].value, 1);

    // Test NOT gate
    const notGate = createComponent("NOT", "not_1", 50, 50);
    notGate.inputs[0].value = 0;
    notGate.evaluate();
    assert.strictEqual(notGate.outputs[0].value, 1);

    notGate.inputs[0].value = 1;
    notGate.evaluate();
    assert.strictEqual(notGate.outputs[0].value, 0);

    // Test Constant HIGH / LOW
    const highGate = createComponent("Constant HIGH", "ch_1", 0, 0);
    highGate.evaluate();
    assert.strictEqual(highGate.outputs[0].value, 1);

    const lowGate = createComponent("Constant LOW", "cl_1", 0, 0);
    lowGate.evaluate();
    assert.strictEqual(lowGate.outputs[0].value, 0);

    // Test XOR Gate
    const xorGate = createComponent("XOR", "xor_1", 0, 0);
    xorGate.inputs[0].value = 0;
    xorGate.inputs[1].value = 1;
    xorGate.evaluate();
    assert.strictEqual(xorGate.outputs[0].value, 1);

    xorGate.inputs[0].value = 1;
    xorGate.inputs[1].value = 1;
    xorGate.evaluate();
    assert.strictEqual(xorGate.outputs[0].value, 0);

    console.log("Component & core tests passed successfully!");
}

runTests();
