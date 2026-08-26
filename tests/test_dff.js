import assert from "assert";
import { Circuit, Wire } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { DFFGate, InputGate } from "../frontend/js/simulation/components.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { ModuleRegistry } from "../frontend/js/simulation/modules.js";
import { serializeCircuit, deserializeCircuit } from "../frontend/js/simulation/serialization.js";

async function runDFFTests() {
    console.log("Running DFF Sequential Logic Unit Test Suite...");

    // 1. Initial State
    {
        const dff = new DFFGate("FF0", 0, 0);
        assert.strictEqual(dff.outputs[0].value, 0, "Initial Q must be 0");
        assert.strictEqual(dff.outputs[1].value, 1, "Initial /Q must be 1");
        console.log("  ✓ Initial DFF state (Q=0, /Q=1) passed");
    }

    // 2. Positive Clock Edge Capture
    {
        const circuit = new Circuit();
        const dff = new DFFGate("FF0", 0, 0);
        const inD = new InputGate("D_IN", 0, 0);
        const inCLK = new InputGate("CLK_IN", 0, 0);

        circuit.addComponent(dff);
        circuit.addComponent(inD);
        circuit.addComponent(inCLK);

        circuit.addWire(new Wire("wD", inD.outputs[0], dff.inputs[0]));
        circuit.addWire(new Wire("wCLK", inCLK.outputs[0], dff.inputs[1]));

        const engine = new SimulationEngine(circuit);
        engine.evaluateAll();

        assert.strictEqual(dff.outputs[0].value, 0, "Q is 0 initially");

        // Set D = 1 (no clock transition yet)
        inD.stateValue = 1;
        engine.triggerInputToggle(inD);
        assert.strictEqual(dff.outputs[0].value, 0, "D change without clock edge must NOT update Q");

        // Trigger rising edge on CLK: 0 -> 1
        inCLK.stateValue = 1;
        engine.triggerInputToggle(inCLK);
        assert.strictEqual(dff.outputs[0].value, 1, "Rising edge on CLK must capture D=1 into Q");
        assert.strictEqual(dff.outputs[1].value, 0, "/Q must be inverted (0)");

        // Falling edge on CLK: 1 -> 0
        inCLK.stateValue = 0;
        engine.triggerInputToggle(inCLK);
        assert.strictEqual(dff.outputs[0].value, 1, "Falling edge must NOT alter Q");

        // Set D = 0 (no clock transition)
        inD.stateValue = 0;
        engine.triggerInputToggle(inD);
        assert.strictEqual(dff.outputs[0].value, 1, "D change without clock edge must NOT update Q");

        // Trigger rising edge on CLK: 0 -> 1
        inCLK.stateValue = 1;
        engine.triggerInputToggle(inCLK);
        assert.strictEqual(dff.outputs[0].value, 0, "Rising edge on CLK must capture D=0 into Q");
        assert.strictEqual(dff.outputs[1].value, 1, "/Q must be inverted (1)");

        console.log("  ✓ Positive clock edge capture & stability between edges passed");
    }

    // 3. Sequential Feedback Loop (/Q -> D Toggle Flip-Flop)
    {
        const circuit = new Circuit();
        const dff = new DFFGate("FF0", 0, 0);
        const inCLK = new InputGate("CLK_IN", 0, 0);

        circuit.addComponent(dff);
        circuit.addComponent(inCLK);

        // Feedback wire: /Q -> D
        circuit.addWire(new Wire("wFB", dff.outputs[1], dff.inputs[0]));
        circuit.addWire(new Wire("wCLK", inCLK.outputs[0], dff.inputs[1]));

        const engine = new SimulationEngine(circuit);
        engine.evaluateAll();

        assert.strictEqual(dff.outputs[0].value, 0);

        // Cycle 1
        inCLK.stateValue = 1; engine.triggerInputToggle(inCLK);
        assert.strictEqual(dff.outputs[0].value, 1, "Toggle pulse 1: Q becomes 1");

        inCLK.stateValue = 0; engine.triggerInputToggle(inCLK);
        assert.strictEqual(dff.outputs[0].value, 1, "Falling edge: Q remains 1");

        // Cycle 2
        inCLK.stateValue = 1; engine.triggerInputToggle(inCLK);
        assert.strictEqual(dff.outputs[0].value, 0, "Toggle pulse 2: Q becomes 0");

        console.log("  ✓ Sequential feedback loop (/Q -> D divide-by-2 toggle) passed");
    }

    // 4. Save / Load Serialization of DFF State
    {
        const circuit = new Circuit();
        const registry = new ModuleRegistry();
        const dff = new DFFGate("FF1", 100, 100);
        dff.storedState = 1;
        dff.outputs[0].value = 1;
        dff.outputs[1].value = 0;
        circuit.addComponent(dff);

        const serialized = serializeCircuit(circuit, registry);
        assert.strictEqual(serialized.components[0].storedState, 1);

        const newCircuit = new Circuit();
        deserializeCircuit(serialized, newCircuit, registry);

        const restoredDFF = newCircuit.components.get("FF1");
        assert.ok(restoredDFF);
        assert.strictEqual(restoredDFF.storedState, 1);
        assert.strictEqual(restoredDFF.outputs[0].value, 1);
        assert.strictEqual(restoredDFF.outputs[1].value, 0);
        console.log("  ✓ DFF state serialization & deserialization passed");
    }

    // 5. Scripted Register Module (REG8)
    {
        const circuit = new Circuit();
        const registry = new ModuleRegistry();
        const engine = new CommandEngine(circuit, registry);

        const script = `
            module REG8 {
                input D[0..7]
                input CLK
                output Q[0..7]

                add dff FF[0..7]

                for i in 0..7 {
                    connect D[i] -> FF[i].D
                    connect CLK -> FF[i].CLK
                    connect FF[i].Q -> Q[i]
                }
            }

            add REG8 R8
        `;

        const res = await engine.executeScript(script);
        assert.ok(res.success, `Script execution failed: ${res.error}`);

        const r8 = circuit.components.get("R8");
        assert.ok(r8);
        assert.strictEqual(r8.inputs.length, 9, "REG8 must have 8 D inputs + 1 CLK input");
        assert.strictEqual(r8.outputs.length, 8, "REG8 must have 8 Q outputs");
        console.log("  ✓ Scripted 8-bit register module (REG8) using DFFs passed");
    }

    console.log("All DFF Sequential Logic unit tests passed successfully!");
}

runDFFTests().catch(err => {
    console.error("DFF Test Failure:", err);
    process.exit(1);
});
