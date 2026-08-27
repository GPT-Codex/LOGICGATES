import assert from "assert";
import { Circuit } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { ModuleRegistry } from "../frontend/js/simulation/modules.js";
import { HistoryManager } from "../frontend/js/canvas/interactions.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { serializeCircuit, deserializeCircuit } from "../frontend/js/simulation/serialization.js";

async function runExprLayoutTests() {
    console.log("Running Expression Layout & Anchoring unit tests...");

    const registry = new ModuleRegistry();
    const circuit = new Circuit();
    const engine = new SimulationEngine(circuit);
    const historyManager = new HistoryManager();
    const commandEngine = new CommandEngine(circuit, registry, historyManager, engine);

    historyManager.pushState(JSON.stringify(serializeCircuit(circuit, registry)));

    // ==========================================
    // 1. Preserving Explicitly Positioned Components
    // ==========================================
    console.log("  1. Testing Explicit Position Preservation...");

    const script1 = `
        add input A
        move A to (0, 100)
        add input B
        move B to (0, 200)
        add output O
        move O to (600, 150)

        expr O = A XOR B
    `;

    const r1 = await commandEngine.executeScript(script1);
    assert(r1.success, `Script 1 failed: ${r1.error}`);

    const aComp = circuit.components.get("A");
    const bComp = circuit.components.get("B");
    const oComp = circuit.components.get("O");

    assert.strictEqual(aComp.x, 0, "A x position must be preserved at 0");
    assert.strictEqual(aComp.y, 100, "A y position must be preserved at 100");
    assert.strictEqual(bComp.x, 0, "B x position must be preserved at 0");
    assert.strictEqual(bComp.y, 200, "B y position must be preserved at 200");
    assert.strictEqual(oComp.x, 600, "O x position must be preserved at 600");
    assert.strictEqual(oComp.y, 150, "O y position must be preserved at 150");

    // ==========================================
    // 2. Unrelated Circuits Unmoved
    // ==========================================
    console.log("  2. Testing Unrelated Circuit Non-Interference...");

    const script2 = `
        add input UNRELATED_IN
        move UNRELATED_IN to (1000, 1000)
        add output UNRELATED_OUT
        move UNRELATED_OUT to (1200, 1000)
        connect UNRELATED_IN UNRELATED_OUT

        expr S_NEW = A AND B
    `;

    const r2 = await commandEngine.executeScript(script2);
    assert(r2.success, `Script 2 failed: ${r2.error}`);

    const uIn = circuit.components.get("UNRELATED_IN");
    const uOut = circuit.components.get("UNRELATED_OUT");

    assert.strictEqual(uIn.x, 1000, "Unrelated input must remain at x=1000");
    assert.strictEqual(uIn.y, 1000, "Unrelated input must remain at y=1000");
    assert.strictEqual(uOut.x, 1200, "Unrelated output must remain at x=1200");
    assert.strictEqual(uOut.y, 1000, "Unrelated output must remain at y=1000");

    // ==========================================
    // 3. Repeated Expression Synthesis
    // ==========================================
    console.log("  3. Testing Repeated Expression Synthesis...");

    const script3 = `
        for i in 0..3 {
            add input X[i]
            move X[i] to (0, i * 40)
            add input Y[i]
            move Y[i] to (0, i * 40 + 200)
            add output OUT[i]
            move OUT[i] to (800, i * 40 + 100)
        }

        for i in 0..3 {
            expr OUT[i] = X[i] AND Y[i]
        }
    `;

    const r3 = await commandEngine.executeScript(script3);
    assert(r3.success, `Repeated expr script failed: ${r3.error}`);

    for (let i = 0; i <= 3; i++) {
        const out = circuit.components.get(`OUT[${i}]`);
        assert.strictEqual(out.x, 800, `OUT[${i}] x position must be preserved at 800`);
        assert.strictEqual(out.y, i * 40 + 100, `OUT[${i}] y position must be preserved`);
    }

    // ==========================================
    // 4. Self-Referential Expression Rejection
    // ==========================================
    console.log("  4. Testing Self-Referential Expression Rejection...");

    const preSelfCount = circuit.components.size;

    const selfRefScript = `
        add input IN_VAL
        add output TARGET
        expr TARGET = TARGET XOR IN_VAL
    `;

    const failRes = await commandEngine.executeScript(selfRefScript);
    assert(!failRes.success, "Self-referential expression must be rejected");
    assert(failRes.error.includes("referenced by its own expression"), "Error should report self-reference");
    assert.strictEqual(circuit.components.size, preSelfCount, "State must roll back on self-reference failure");

    // ==========================================
    // 5. Serialization & Save/Load of Explicit Metadata
    // ==========================================
    console.log("  5. Testing Save/Load Preservation of Explicit Position Flag...");

    const snap = serializeCircuit(circuit, registry);
    const newCircuit = new Circuit();
    deserializeCircuit(snap, newCircuit, registry);

    assert(newCircuit.components.get("A").isExplicitPosition, "A must maintain isExplicitPosition=true");
    assert(newCircuit.components.get("O").isExplicitPosition, "O must maintain isExplicitPosition=true");

    // ==========================================
    // 6. Single-Step Undo/Redo Integrity
    // ==========================================
    console.log("  6. Testing Undo/Redo Integrity...");

    const preUndoCount = circuit.components.size;
    const undoRes = commandEngine.execute("undo");
    assert(undoRes.success, "Undo failed");
    assert.strictEqual(circuit.components.size, preUndoCount - 16); // 4 * (X, Y, OUT) + 4 synthesized AND gates

    const redoRes = commandEngine.execute("redo");
    assert(redoRes.success, "Redo failed");
    assert.strictEqual(circuit.components.size, preUndoCount);

    console.log("Expression Layout & Anchoring unit tests passed successfully!");
}

await runExprLayoutTests();
