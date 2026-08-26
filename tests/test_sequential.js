import assert from "assert";
import { Circuit, Wire } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { RegisterGate, CounterGate, InputGate } from "../frontend/js/simulation/components.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { ModuleRegistry } from "../frontend/js/simulation/modules.js";
import { serializeCircuit, deserializeCircuit } from "../frontend/js/simulation/serialization.js";

async function runSequentialTests() {
    console.log("Running Sequential Logic Components (Register & Counter) Unit Test Suite...");

    // 1. RegisterGate - Simultaneous Sampling & Widths (1, 4, 8, 16)
    {
        for (const w of [1, 4, 8, 16]) {
            const circuit = new Circuit();
            const reg = new RegisterGate("R1", 0, 0, w);
            const inCLK = new InputGate("CLK", 0, 0);

            circuit.addComponent(reg);
            circuit.addComponent(inCLK);

            // Connect CLK
            const clkPin = reg.inputs[reg.inputs.length - 1];
            circuit.addWire(new Wire("wCLK", inCLK.outputs[0], clkPin));

            // Connect D inputs
            const dInputs = [];
            for (let i = 0; i < w; i++) {
                const inD = new InputGate(`D_${i}`, 0, 0);
                circuit.addComponent(inD);
                circuit.addWire(new Wire(`wD_${i}`, inD.outputs[0], reg.inputs[i]));
                dInputs.push(inD);
            }

            const engine = new SimulationEngine(circuit);
            engine.evaluateAll();

            // Initial Q = 0
            for (let i = 0; i < w; i++) {
                assert.strictEqual(reg.outputs[i].value, 0, `Width ${w}: Bit ${i} initial Q must be 0`);
            }

            // Set D inputs to alternating 1 and 0 (D[0]=1, D[1]=0, D[2]=1...)
            for (let i = 0; i < w; i++) {
                dInputs[i].stateValue = i % 2 === 0 ? 1 : 0;
                engine.triggerInputToggle(dInputs[i]);
            }

            // Before clock edge, Q must remain 0
            for (let i = 0; i < w; i++) {
                assert.strictEqual(reg.outputs[i].value, 0, `Width ${w}: Bit ${i} Q must remain 0 before clock edge`);
            }

            // Trigger rising clock edge: 0 -> 1
            inCLK.stateValue = 1;
            engine.triggerInputToggle(inCLK);

            // All bits must simultaneously capture D
            for (let i = 0; i < w; i++) {
                const expected = i % 2 === 0 ? 1 : 0;
                assert.strictEqual(reg.outputs[i].value, expected, `Width ${w}: Bit ${i} must capture D=${expected} on clock edge`);
            }

            // Change D without clock edge -> Q must remain stable
            for (let i = 0; i < w; i++) {
                dInputs[i].stateValue = 0;
                engine.triggerInputToggle(dInputs[i]);
            }
            for (let i = 0; i < w; i++) {
                const expected = i % 2 === 0 ? 1 : 0;
                assert.strictEqual(reg.outputs[i].value, expected, `Width ${w}: Bit ${i} Q must remain stable when D changes without clock edge`);
            }
        }
        console.log("  ✓ RegisterGate widths (1, 4, 8, 16) & simultaneous sampling passed");
    }

    // 2. CounterGate - Incrementing, EN control, & Wraparound
    {
        const circuit = new Circuit();
        const counter = new CounterGate("C1", 0, 0, 4); // 4-bit counter (0..15)
        const inCLK = new InputGate("CLK", 0, 0);
        const inEN = new InputGate("EN", 0, 0);

        circuit.addComponent(counter);
        circuit.addComponent(inCLK);
        circuit.addComponent(inEN);

        circuit.addWire(new Wire("wCLK", inCLK.outputs[0], counter.inputs[0]));
        circuit.addWire(new Wire("wEN", inEN.outputs[0], counter.inputs[1]));

        const engine = new SimulationEngine(circuit);
        engine.evaluateAll();

        // Initial count = 0
        assert.strictEqual(counter.count, 0);

        // Enable = 1
        inEN.stateValue = 1;
        engine.triggerInputToggle(inEN);

        // Pulse clock 15 times: 0 -> 15
        for (let step = 1; step <= 15; step++) {
            inCLK.stateValue = 1; engine.triggerInputToggle(inCLK);
            inCLK.stateValue = 0; engine.triggerInputToggle(inCLK);
            assert.strictEqual(counter.count, step, `Counter must be ${step} after ${step} clock pulses`);
            // Check binary outputs Q[0..3]
            for (let b = 0; b < 4; b++) {
                const bitVal = (step >> b) & 1;
                assert.strictEqual(counter.outputs[b].value, bitVal, `Q[${b}] must match bit ${b} of count ${step}`);
            }
        }

        // Pulse 16: Wraparound 15 -> 0
        inCLK.stateValue = 1; engine.triggerInputToggle(inCLK);
        inCLK.stateValue = 0; engine.triggerInputToggle(inCLK);
        assert.strictEqual(counter.count, 0, "4-bit counter must wrap around 15 -> 0");

        // Disable counter: EN = 0
        inEN.stateValue = 0;
        engine.triggerInputToggle(inEN);

        // Pulse clock -> count must hold at 0
        inCLK.stateValue = 1; engine.triggerInputToggle(inCLK);
        inCLK.stateValue = 0; engine.triggerInputToggle(inCLK);
        assert.strictEqual(counter.count, 0, "Counter must hold count when EN = 0");

        console.log("  ✓ CounterGate 4-bit counting, EN enable control, & wraparound passed");
    }

    // 3. Serialization of Register & Counter
    {
        const circuit = new Circuit();
        const registry = new ModuleRegistry();

        const reg = new RegisterGate("R8", 0, 0, 8);
        reg.storedState = [1, 0, 1, 0, 1, 0, 1, 0];

        const cnt = new CounterGate("C8", 200, 0, 8);
        cnt.count = 200;

        circuit.addComponent(reg);
        circuit.addComponent(cnt);

        const serialized = serializeCircuit(circuit, registry);

        const newCircuit = new Circuit();
        deserializeCircuit(serialized, newCircuit, registry);

        const restoredReg = newCircuit.components.get("R8");
        assert.ok(restoredReg);
        assert.strictEqual(restoredReg.widthBits, 8);
        assert.deepStrictEqual(restoredReg.storedState, [1, 0, 1, 0, 1, 0, 1, 0]);

        const restoredCnt = newCircuit.components.get("C8");
        assert.ok(restoredCnt);
        assert.strictEqual(restoredCnt.widthBits, 8);
        assert.strictEqual(restoredCnt.count, 200);
        console.log("  ✓ Register & Counter serialization / deserialization passed");
    }

    // 4. Script Execution of Parameterized Instantiations
    {
        const circuit = new Circuit();
        const engine = new CommandEngine(circuit);

        const script = `
            add REGISTER(16) R16
            add COUNTER(8) C8
        `;

        const res = await engine.executeScript(script);
        assert.ok(res.success, `Script execution failed: ${res.error}`);

        const r16 = circuit.components.get("R16");
        assert.ok(r16);
        assert.strictEqual(r16.widthBits, 16);

        const c8 = circuit.components.get("C8");
        assert.ok(c8);
        assert.strictEqual(c8.widthBits, 8);
        console.log("  ✓ Parameterized script instantiation (add REGISTER(16), add COUNTER(8)) passed");
    }

    console.log("All Sequential Logic Components unit tests passed successfully!");
}

runSequentialTests().catch(err => {
    console.error("Sequential Test Failure:", err);
    process.exit(1);
});
