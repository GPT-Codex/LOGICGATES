import assert from "assert";
import { Circuit } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { HistoryManager } from "../frontend/js/canvas/interactions.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { applyAutoLayout } from "../frontend/js/simulation/expr_synthesizer.js";

function runTests() {
    console.log("Running Bus Parsing & Auto-Layout unit tests...");

    // Test 1: Bus Range Parsing & Expansion
    {
        const circuit = new Circuit();
        const engine = new SimulationEngine(circuit);
        const commandEngine = new CommandEngine(circuit, null, null, engine);

        // 1. Bus net command
        const r1 = commandEngine.execute("net BUS[0..7]");
        assert(r1.success, `net BUS[0..7] failed: ${r1.error}`);
        for (let i = 0; i < 8; i++) {
            assert(circuit.components.has(`BUS[${i}]`), `BUS[${i}] should exist`);
        }

        // 2. Bus input command
        const r2 = commandEngine.execute("add input IN[0..3]");
        assert(r2.success, `add input IN[0..3] failed: ${r2.error}`);
        for (let i = 0; i < 4; i++) {
            assert(circuit.components.has(`IN[${i}]`), `IN[${i}] should exist`);
        }

        // 3. Bus output command
        const r3 = commandEngine.execute("add output OUT[0..3]");
        assert(r3.success, `add output OUT[0..3] failed: ${r3.error}`);
        for (let i = 0; i < 4; i++) {
            assert(circuit.components.has(`OUT[${i}]`), `OUT[${i}] should exist`);
        }

        // 4. Bus connect command
        const r4 = commandEngine.execute("connect IN[0..3] OUT[0..3]");
        assert(r4.success, `connect IN[0..3] OUT[0..3] failed: ${r4.error}`);
        assert.strictEqual(circuit.wires.size, 4, "Should create 4 bus wires");

        // Verify simulation over bus connections
        const in0 = circuit.components.get("IN[0]");
        const out0 = circuit.components.get("OUT[0]");
        in0.stateValue = 1;
        in0.evaluate();
        engine.evaluateAll();
        assert.strictEqual(out0.inputs[0].value, 1, "OUT[0] should receive HIGH signal from IN[0]");
    }

    // Test 2: 'net NAME' Signal Connection & Propagation
    {
        const circuit = new Circuit();
        const engine = new SimulationEngine(circuit);
        const commandEngine = new CommandEngine(circuit, null, null, engine);

        commandEngine.execute("add input A");
        commandEngine.execute("add output B");
        commandEngine.execute("net SIG1");
        commandEngine.execute("connect A SIG1");
        commandEngine.execute("connect SIG1 B");

        assert(circuit.components.has("SIG1"), "Net SIG1 should exist as pass-through component");
        assert.strictEqual(circuit.wires.size, 2, "Should create 2 wires through net SIG1");

        const gateA = circuit.components.get("A");
        const gateB = circuit.components.get("B");

        gateA.stateValue = 1;
        gateA.evaluate();
        engine.evaluateAll();
        assert.strictEqual(gateB.inputs[0].value, 1, "Signal should propagate through net SIG1 to output B");
    }

    // Test 3: Deterministic Layout & Grid Snapping
    {
        const circuit = new Circuit();
        const engine = new SimulationEngine(circuit);
        const commandEngine = new CommandEngine(circuit, null, null, engine);

        commandEngine.execute("expr S = (A XOR B) XOR Cin");
        commandEngine.execute("expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)");

        // 1. Verify Inputs are placed at Column 0 (x = 100)
        const inA = circuit.components.get("A");
        const inB = circuit.components.get("B");
        const inCin = circuit.components.get("Cin");

        assert.strictEqual(inA.x, 100, "Input A x position should be 100");
        assert.strictEqual(inB.x, 100, "Input B x position should be 100");
        assert.strictEqual(inCin.x, 100, "Input Cin x position should be 100");

        // 2. Verify Outputs are placed on the right
        const outS = circuit.components.get("S");
        const outCout = circuit.components.get("Cout");

        assert(outS.x > 100, "Output S x position should be on the right");
        assert(outCout.x > 100, "Output Cout x position should be on the right");

        // 3. Verify 20px Grid Snapping for all components
        for (const comp of circuit.components.values()) {
            assert.strictEqual(comp.x % 20, 0, `Component ${comp.id} x (${comp.x}) should be aligned to 20px grid`);
            assert.strictEqual(comp.y % 20, 0, `Component ${comp.id} y (${comp.y}) should be aligned to 20px grid`);
        }

        // 4. Verify Layout Determinism (snapshot positions and re-apply auto-layout)
        const pos1 = Array.from(circuit.components.values()).map(c => ({ id: c.id, x: c.x, y: c.y }));

        applyAutoLayout(circuit);

        const pos2 = Array.from(circuit.components.values()).map(c => ({ id: c.id, x: c.x, y: c.y }));

        assert.deepStrictEqual(pos1, pos2, "Re-applying layout must produce 100% identical positions");
    }

    console.log("Bus Parsing & Auto-Layout unit tests passed successfully!");
}

runTests();
