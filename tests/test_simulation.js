import assert from "assert";
import { Circuit, Wire } from "../frontend/js/simulation/core.js";
import { createComponent } from "../frontend/js/simulation/components.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";

function runTests() {
    console.log("Running simulation engine tests...");

    const circuit = new Circuit();
    const engine = new SimulationEngine(circuit);

    // Create simple buffer / negation chain:
    // Input -> NOT -> Output
    const input = createComponent("Input", "in_1", 0, 0);
    const notGate = createComponent("NOT", "not_1", 100, 0);
    const output = createComponent("Output", "out_1", 200, 0);

    circuit.addComponent(input);
    circuit.addComponent(notGate);
    circuit.addComponent(output);

    // Wires
    const wire1 = new Wire("w1", input.outputs[0], notGate.inputs[0]);
    const wire2 = new Wire("w2", notGate.outputs[0], output.inputs[0]);

    circuit.addWire(wire1);
    circuit.addWire(wire2);

    // Initialize & evaluate
    engine.evaluateAll();

    // With input = 0: Output of NOT is 1, so Output gate gets 1
    assert.strictEqual(input.outputs[0].value, 0);
    assert.strictEqual(notGate.outputs[0].value, 1);
    assert.strictEqual(output.inputs[0].value, 1);

    // Toggle Input state to 1
    input.stateValue = 1;
    engine.triggerInputToggle(input);

    // With input = 1: Output of NOT is 0, so Output gate gets 0
    assert.strictEqual(input.outputs[0].value, 1);
    assert.strictEqual(notGate.outputs[0].value, 0);
    assert.strictEqual(output.inputs[0].value, 0);

    // Test Oscillation Detection:
    // Wire NOT's output to its own input
    const feedbackCircuit = new Circuit();
    const feedbackEngine = new SimulationEngine(feedbackCircuit);
    feedbackEngine.oscillationLimit = 50; // set low for fast test

    const oscNot = createComponent("NOT", "not_osc", 0, 0);
    feedbackCircuit.addComponent(oscNot);

    // Output wired to its own input
    const selfWire = new Wire("w_self", oscNot.outputs[0], oscNot.inputs[0]);
    feedbackCircuit.addWire(selfWire);

    feedbackEngine.evaluateAll();
    assert.strictEqual(feedbackEngine.status, "Oscillation Detected");

    console.log("Simulation engine tests passed successfully!");
}

runTests();
