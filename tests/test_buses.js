import assert from "assert";
import { Circuit } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { ModuleRegistry } from "../frontend/js/simulation/modules.js";
import { HistoryManager } from "../frontend/js/canvas/interactions.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { serializeCircuit, deserializeCircuit } from "../frontend/js/simulation/serialization.js";

async function runBusTests() {
    console.log("Running First-Class Buses & Vector Operations unit tests...");

    const registry = new ModuleRegistry();
    const circuit = new Circuit();
    const engine = new SimulationEngine(circuit);
    const historyManager = new HistoryManager();
    const commandEngine = new CommandEngine(circuit, registry, historyManager, engine);

    historyManager.pushState(JSON.stringify(serializeCircuit(circuit, registry)));

    // ==========================================
    // 1. Bus Declarations (8-bit, 16-bit, 32-bit & Descending)
    // ==========================================
    console.log("  1. Testing Bus Declarations...");

    assert(commandEngine.execute("bus A[0..7]").success, "Declaring 8-bit bus A should succeed");
    assert(commandEngine.execute("bus B[0..15]").success, "Declaring 16-bit bus B should succeed");
    assert(commandEngine.execute("bus C[31..0]").success, "Declaring 32-bit descending bus C should succeed");

    const busA = circuit.buses.get("A");
    assert(busA, "Bus A should exist");
    assert.strictEqual(busA.width, 8);
    assert.strictEqual(busA.members.length, 8);
    assert.strictEqual(busA.members[0], "A[0]");

    const busC = circuit.buses.get("C");
    assert(busC, "Bus C should exist");
    assert.strictEqual(busC.width, 32);
    assert.strictEqual(busC.isDescending, true);
    assert.strictEqual(busC.members[0], "C[31]");
    assert.strictEqual(busC.members[31], "C[0]");

    // ==========================================
    // 2. Bus Introspection (show & list)
    // ==========================================
    console.log("  2. Testing Bus Introspection...");

    const showRes = commandEngine.execute("show A");
    assert(showRes.success);
    assert(showRes.data.includes("Bus: A"));
    assert(showRes.data.includes("Width: 8"));

    const listRes = commandEngine.execute("list");
    assert(listRes.success);
    assert(listRes.data.includes("Buses:"));
    assert(listRes.data.includes("A [0..7]"));

    // ==========================================
    // 3. Vector-to-Vector Connections & Width Validation
    // ==========================================
    console.log("  3. Testing Vector Connections & Width Validation...");

    assert(commandEngine.execute("bus D[0..7]").success);

    // Connecting equal-width buses A (8-bit) -> D (8-bit)
    const connSuccess = commandEngine.execute("connect A D");
    assert(connSuccess.success, `Bus connection failed: ${connSuccess.error}`);

    // Verify bitwise connections
    for (let i = 0; i < 8; i++) {
        const wireExists = Array.from(circuit.wires.values()).some(
            w => w.fromPin && w.toPin && w.fromPin.component.id === `A[${i}]` && w.toPin.component.id === `D[${i}]`
        );
        assert(wireExists, `Wire for bit ${i} (A[${i}] -> D[${i}]) should exist`);
    }

    // Mismatched width connection attempt (16-bit B vs 8-bit D)
    const mismatchRes = commandEngine.execute("connect B D");
    assert(!mismatchRes.success, "Connecting mismatched width buses must fail");
    assert(mismatchRes.error.includes("source width = 16, destination width = 8"), "Error should report width mismatch");

    // ==========================================
    // 4. Sliced Bus Connections (e.g. B[0..7] -> D[0..7])
    // ==========================================
    console.log("  4. Testing Sliced Bus Connections...");

    const sliceConn = commandEngine.execute("connect B[0..7] D[0..7]");
    assert(sliceConn.success, `Sliced bus connect failed: ${sliceConn.error}`);

    const sliceMismatch = commandEngine.execute("connect B[0..15] D[0..7]");
    assert(!sliceMismatch.success, "Mismatch sliced connect must fail");

    // ==========================================
    // 5. Combining Buses with For Loops
    // ==========================================
    console.log("  5. Testing Buses with For Loops...");

    const loopBusScript = `
        bus IN_BUS[0..3]
        bus OUT_BUS[0..3]
        for i in 0..3 {
            add input IN_GATE[i]
            add output OUT_GATE[i]
            connect IN_GATE[i] IN_BUS[i]
            connect OUT_BUS[i] OUT_GATE[i]
        }
        connect IN_BUS OUT_BUS
    `;

    const r5 = await commandEngine.executeScript(loopBusScript);
    assert(r5.success, `Loop bus script failed: ${r5.error}`);

    // Verify electrical propagation through loop-connected bus
    const inGate0 = circuit.components.get("IN_GATE[0]");
    const outGate0 = circuit.components.get("OUT_GATE[0]");
    inGate0.stateValue = 1;
    engine.evaluateAll();
    assert.strictEqual(outGate0.inputs[0].value, 1, "OUT_GATE[0] should receive HIGH signal through IN_BUS -> OUT_BUS");

    // ==========================================
    // 6. Undo/Redo & Transaction Rollback
    // ==========================================
    console.log("  6. Testing Undo/Redo & Rollback...");

    const preUndoWireCount = circuit.wires.size;
    const undoRes = commandEngine.execute("undo");
    assert(undoRes.success);
    assert.strictEqual(circuit.wires.size, preUndoWireCount - 12); // 4 + 4 + 4

    const redoRes = commandEngine.execute("redo");
    assert(redoRes.success);
    assert.strictEqual(circuit.wires.size, preUndoWireCount);

    // ==========================================
    // 7. Save / Load & .sim Export / Import
    // ==========================================
    console.log("  7. Testing Save/Load & .sim Export/Import...");

    const exportedScript = commandEngine.exportScript();
    assert(exportedScript.includes("bus A[0..7]"));
    assert(exportedScript.includes("bus C[31..0]"));

    const newCircuit = new Circuit();
    const newEngine = new SimulationEngine(newCircuit);
    const newCmdEngine = new CommandEngine(newCircuit, registry, null, newEngine);

    const importRes = await newCmdEngine.executeScript(exportedScript);
    assert(importRes.success, `Importing exported script failed: ${importRes.error}`);
    assert(newCircuit.buses.has("A"));
    assert(newCircuit.buses.has("C"));
    assert.strictEqual(newCircuit.buses.get("C").width, 32);

    console.log("First-Class Buses & Vector Operations unit tests passed successfully!");
}

await runBusTests();
