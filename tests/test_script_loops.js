import assert from "assert";
import { Circuit } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { ModuleRegistry } from "../frontend/js/simulation/modules.js";
import { HistoryManager } from "../frontend/js/canvas/interactions.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { serializeCircuit, deserializeCircuit } from "../frontend/js/simulation/serialization.js";

function runLoopTests() {
    console.log("Running Script Loops & Indexed Arrays unit tests...");

    const registry = new ModuleRegistry();
    const circuit = new Circuit();
    const engine = new SimulationEngine(circuit);
    const historyManager = new HistoryManager();
    const commandEngine = new CommandEngine(circuit, registry, historyManager, engine);

    // Push initial empty snapshot
    historyManager.pushState(JSON.stringify(serializeCircuit(circuit, registry)));

    // ==========================================
    // 1. Basic Ranges (Ascending & Descending)
    // ==========================================
    console.log("  1. Testing Basic Ranges...");

    const rangeScript = `
        for i in 0..2 {
            add input A[i]
        }
        for j in 5..3 {
            add output B[j]
        }
        for i in 0..2 {
            add input IN_B[i]
        }
    `;

    const r1 = commandEngine.executeScript(rangeScript);
    assert(r1.success, `Range script failed: ${r1.error}`);
    assert(circuit.components.has("A[0]"), "A[0] should exist");
    assert(circuit.components.has("A[1]"), "A[1] should exist");
    assert(circuit.components.has("A[2]"), "A[2] should exist");
    assert(circuit.components.has("B[5]"), "B[5] should exist");
    assert(circuit.components.has("B[4]"), "B[4] should exist");
    assert(circuit.components.has("B[3]"), "B[3] should exist");

    // ==========================================
    // 2. Position Arithmetic & Wiring in Loops
    // ==========================================
    console.log("  2. Testing Position Arithmetic & Wiring...");

    const loopWiringScript = `
        for i in 0..3 {
            add and G[i]
            move G[i] to (i * 40, 100)
            connect A[0] G[i].A
        }
    `;

    const r2 = commandEngine.executeScript(loopWiringScript);
    assert(r2.success, `Loop wiring script failed: ${r2.error}`);
    assert.strictEqual(circuit.components.get("G[0]").x, 0);
    assert.strictEqual(circuit.components.get("G[1]").x, 40);
    assert.strictEqual(circuit.components.get("G[2]").x, 80);
    assert.strictEqual(circuit.components.get("G[3]").x, 120);

    // Verify 4 wires connecting A[0] to G[0..3].A
    const connectedWires = Array.from(circuit.wires.values()).filter(w => w.fromPin && w.fromPin.component.id === "A[0]");
    assert.strictEqual(connectedWires.length, 4);

    // ==========================================
    // 3. Nested Loops
    // ==========================================
    console.log("  3. Testing Nested Loops...");

    const nestedScript = `
        for r in 0..1 {
            for c in 0..1 {
                add buffer BUF[r][c]
                move BUF[r][c] to (r * 100, c * 100)
            }
        }
    `;

    const r3 = commandEngine.executeScript(nestedScript);
    assert(r3.success, `Nested loop failed: ${r3.error}`);
    assert(circuit.components.has("BUF[0][0]"));
    assert(circuit.components.has("BUF[0][1]"));
    assert(circuit.components.has("BUF[1][0]"));
    assert(circuit.components.has("BUF[1][1]"));
    assert.strictEqual(circuit.components.get("BUF[1][1]").x, 100);
    assert.strictEqual(circuit.components.get("BUF[1][1]").y, 100);

    // ==========================================
    // 4. Expression Synthesis Inside Loops
    // ==========================================
    console.log("  4. Testing Expression Synthesis in Loops...");

    const exprLoopScript = `
        for i in 0..2 {
            expr S[i] = A[i] XOR IN_B[i]
        }
    `;

    const r4 = commandEngine.executeScript(exprLoopScript);
    assert(r4.success, `Expression in loop failed: ${r4.error}`);
    assert(circuit.components.has("S[0]"), "Synthesized S[0] should exist");
    assert(circuit.components.has("S[1]"), "Synthesized S[1] should exist");
    assert(circuit.components.has("S[2]"), "Synthesized S[2] should exist");

    // Test electrical behavior on synthesized loop S[0]
    circuit.components.get("A[0]").stateValue = 1;
    circuit.components.get("IN_B[0]").stateValue = 0;
    engine.evaluateAll();
    assert.strictEqual(circuit.components.get("S[0]").inputs[0].value, 1, "1 XOR 0 = 1");

    circuit.components.get("IN_B[0]").stateValue = 1;
    engine.evaluateAll();
    assert.strictEqual(circuit.components.get("S[0]").inputs[0].value, 0, "1 XOR 1 = 0");

    // ==========================================
    // 5. Single Transaction Undo / Redo
    // ==========================================
    console.log("  5. Testing Single Transaction Undo/Redo...");

    const preCountComp = circuit.components.size;
    const preCountWire = circuit.wires.size;

    const loopGenScript = `
        for i in 0..7 {
            add input IN_BUS[i]
            add output OUT_BUS[i]
            connect IN_BUS[i] OUT_BUS[i]
        }
    `;

    const r5 = commandEngine.executeScript(loopGenScript);
    assert(r5.success, `Loop gen failed: ${r5.error}`);
    assert.strictEqual(circuit.components.size, preCountComp + 16);
    assert.strictEqual(circuit.wires.size, preCountWire + 8);

    // Undo should revert all 16 components and 8 wires in 1 step
    const undoRes = commandEngine.execute("undo");
    assert(undoRes.success, "Undo failed");
    assert.strictEqual(circuit.components.size, preCountComp);
    assert.strictEqual(circuit.wires.size, preCountWire);

    // Redo should restore all 16 components and 8 wires in 1 step
    const redoRes = commandEngine.execute("redo");
    assert(redoRes.success, "Redo failed");
    assert.strictEqual(circuit.components.size, preCountComp + 16);
    assert.strictEqual(circuit.wires.size, preCountWire + 8);

    // ==========================================
    // 6. Error Reporting & Loop Iteration Context
    // ==========================================
    console.log("  6. Testing Error Reporting & Loop Iteration Context...");

    const preErrorCompCount = circuit.components.size;

    const failingLoopScript = `
        # Line 2
        for i in 0..5 {
            # Line 4
            add and G_FAIL[i]
            connect G_FAIL[i] NON_EXISTENT_COMP
        }
    `;

    const failRes = commandEngine.executeScript(failingLoopScript);
    assert(!failRes.success, "Script should fail due to NON_EXISTENT_COMP");
    assert.strictEqual(failRes.line, 6, "Failure should be on line 6");
    assert(failRes.error.includes("Loop iteration: i = 0"), "Should report loop iteration context 'i = 0'");
    assert(failRes.error.includes("Line 6"), "Should report line 6");

    // Verify rollback
    assert.strictEqual(circuit.components.size, preErrorCompCount, "Circuit state must roll back completely");
    assert(!circuit.components.has("G_FAIL[0]"), "G_FAIL[0] must be rolled back");

    // ==========================================
    // 7. Safety Execution Limits
    // ==========================================
    console.log("  7. Testing Safety Execution Limits...");

    const runawayScript = `
        for i in 0..100000 {
            add buffer B_RUNAWAY[i]
        }
    `;

    const limitRes = commandEngine.executeScript(runawayScript);
    assert(!limitRes.success, "Runaway script should be aborted by safety limits");
    assert(limitRes.error.includes("exceeded"), "Error should report limit exceeded");

    // ==========================================
    // 8. Serialization & Save/Load of Loop-Generated Circuits
    // ==========================================
    console.log("  8. Testing Serialization of Loop-Generated Circuits...");

    const serialized = serializeCircuit(circuit, registry);
    const reloadedCircuit = new Circuit();
    deserializeCircuit(serialized, reloadedCircuit, registry);

    assert.strictEqual(reloadedCircuit.components.size, circuit.components.size);
    assert.strictEqual(reloadedCircuit.wires.size, circuit.wires.size);
    assert(reloadedCircuit.components.has("IN_BUS[7]"));
    assert(reloadedCircuit.components.has("OUT_BUS[7]"));

    console.log("Script Loops & Indexed Arrays unit tests passed successfully!");
}

runLoopTests();
