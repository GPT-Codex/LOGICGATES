import assert from "assert";
import { Circuit, Wire } from "../frontend/js/simulation/core.js";
import { NPNTransistorGate, PNPTransistorGate, createComponent } from "../frontend/js/simulation/components.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { serializeCircuit, deserializeCircuit } from "../frontend/js/simulation/serialization.js";

function runTests() {
    console.log("Running NPN and PNP Transistor unit tests...");

    const circuit = new Circuit();
    const engine = new SimulationEngine(circuit);

    const npn = new NPNTransistorGate("npn_1", 100, 100);
    const pnp = new PNPTransistorGate("pnp_1", 200, 100);

    circuit.addComponent(npn);
    circuit.addComponent(pnp);

    // 1. Verify three-terminal interface and pin names
    assert.strictEqual(npn.inputs.length, 2, "NPN should have 2 inputs (Collector and Base)");
    assert.strictEqual(npn.outputs.length, 1, "NPN should have 1 output (Emitter)");
    assert.strictEqual(npn.inputs[0].name, "C", "NPN input 0 should be Collector 'C'");
    assert.strictEqual(npn.inputs[1].name, "B", "NPN input 1 should be Base 'B'");
    assert.strictEqual(npn.outputs[0].name, "E", "NPN output 0 should be Emitter 'E'");

    assert.strictEqual(pnp.inputs.length, 2, "PNP should have 2 inputs (Collector and Base)");
    assert.strictEqual(pnp.outputs.length, 1, "PNP should have 1 output (Emitter)");
    assert.strictEqual(pnp.inputs[0].name, "C", "PNP input 0 should be Collector 'C'");
    assert.strictEqual(pnp.inputs[1].name, "B", "PNP input 1 should be Base 'B'");
    assert.strictEqual(pnp.outputs[0].name, "E", "PNP output 0 should be Emitter 'E'");

    // 2. NPN Logic (Digital switch abstraction: Base controls conduction C -> E)
    // Case A: Collector = 1, Base = 0 -> OFF state -> Emitter = 0
    npn.inputs[0].value = 1; // Collector
    npn.inputs[1].value = 0; // Base
    npn.evaluate();
    assert.strictEqual(npn.outputs[0].value, 0, "NPN with Base=0 should be non-conducting (Emitter = 0)");

    // Case B: Collector = 1, Base = 1 -> ON state -> Emitter = 1 (Conduction C -> E)
    npn.inputs[1].value = 1; // Base
    npn.evaluate();
    assert.strictEqual(npn.outputs[0].value, 1, "NPN with Base=1 should conduct Collector value to Emitter");

    // Case C: Collector = 0, Base = 1 -> ON state -> Emitter = 0 (Conduction C -> E transmits 0)
    npn.inputs[0].value = 0; // Collector
    npn.evaluate();
    assert.strictEqual(npn.outputs[0].value, 0, "NPN with Base=1 should transmit Collector=0 to Emitter");

    // Case D: Collector = 0, Base = 0 -> OFF state -> Emitter = 0
    npn.inputs[0].value = 0;
    npn.inputs[1].value = 0;
    npn.evaluate();
    assert.strictEqual(npn.outputs[0].value, 0, "NPN OFF state should output 0");

    // 3. PNP Logic (Complementary digital switch abstraction: Base=0 conducts C -> E)
    // Case A: Collector = 1, Base = 0 -> ON state -> Emitter = 1
    pnp.inputs[0].value = 1; // Collector
    pnp.inputs[1].value = 0; // Base
    pnp.evaluate();
    assert.strictEqual(pnp.outputs[0].value, 1, "PNP with Base=0 should conduct Collector value to Emitter");

    // Case B: Collector = 0, Base = 0 -> ON state -> Emitter = 0
    pnp.inputs[0].value = 0; // Collector
    pnp.inputs[1].value = 0; // Base
    pnp.evaluate();
    assert.strictEqual(pnp.outputs[0].value, 0, "PNP with Base=0 should transmit Collector=0 to Emitter");

    // Case C: Collector = 1, Base = 1 -> OFF state -> Emitter = 0
    pnp.inputs[0].value = 1;
    pnp.inputs[1].value = 1; // Base
    pnp.evaluate();
    assert.strictEqual(pnp.outputs[0].value, 0, "PNP with Base=1 should be non-conducting (Emitter = 0)");

    // Case D: Collector = 0, Base = 1 -> OFF state -> Emitter = 0
    pnp.inputs[0].value = 0;
    pnp.inputs[1].value = 1;
    pnp.evaluate();
    assert.strictEqual(pnp.outputs[0].value, 0, "PNP with Base=1 should be non-conducting (Emitter = 0)");

    // 4. Test Serialization
    const serialized = serializeCircuit(circuit, null);
    assert.strictEqual(serialized.components[0].type, "NPN Transistor");
    assert.strictEqual(serialized.components[1].type, "PNP Transistor");

    const circuit2 = new Circuit();
    deserializeCircuit(serialized, circuit2, null);
    assert(circuit2.components.has("npn_1"));
    assert(circuit2.components.has("pnp_1"));

    console.log("NPN and PNP Transistor unit tests passed successfully!");
}

runTests();
