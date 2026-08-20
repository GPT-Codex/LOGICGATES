import assert from "assert";
import { Circuit } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { HistoryManager } from "../frontend/js/canvas/interactions.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";

function runTests() {
    console.log("Running Command Execution Engine unit tests...");

    const circuit = new Circuit();
    const engine = new SimulationEngine(circuit);
    const historyManager = new HistoryManager();
    const commandEngine = new CommandEngine(circuit, null, historyManager, engine);

    // Initial state push (required to test undo/redo correctly)
    const snap = JSON.stringify({ components: [], wires: [], definitions: [] });
    historyManager.pushState(snap);

    // 1. Test "add" commands
    const r1 = commandEngine.execute("add clock CLK");
    assert(r1.success, `add clock failed: ${r1.error}`);
    assert(circuit.components.has("CLK"), "CLK component should be added");

    const r2 = commandEngine.execute("add and G1");
    assert(r2.success, `add and failed: ${r2.error}`);
    assert(circuit.components.has("G1"), "G1 component should be added");

    // Test duplicate add
    const r3 = commandEngine.execute("add and G1");
    assert(!r3.success, "Should fail when adding an existing component");
    assert.strictEqual(r3.error, "Component with name 'G1' already exists");

    // Test invalid identifier
    const r4 = commandEngine.execute("add and 1G");
    assert(!r4.success, "Should fail when adding invalid identifier name");

    // 2. Test "move" commands
    const r5 = commandEngine.execute("move G1 to (10,20)");
    assert(r5.success, `move to failed: ${r5.error}`);
    const g1 = circuit.components.get("G1");
    assert.strictEqual(g1.x, 10, "G1 x coord should be 10");
    assert.strictEqual(g1.y, 20, "G1 y coord should be 20");

    const r6 = commandEngine.execute("move G1 by (5,-10)");
    assert(r6.success, `move by failed: ${r6.error}`);
    assert.strictEqual(g1.x, 15, "G1 x coord should be 15 after translation");
    assert.strictEqual(g1.y, 10, "G1 y coord should be 10 after translation");

    // Test move with invalid format
    const r7 = commandEngine.execute("move G1 to 10,20");
    assert(!r7.success, "Should fail with invalid coordinate format");

    // 3. Test "set" commands
    const r8 = commandEngine.execute("set CLK.freq 5MHz");
    assert(r8.success, `set freq failed: ${r8.error}`);
    const clk = circuit.components.get("CLK");
    assert.strictEqual(clk.frequencyValue, 5, "CLK frequencyValue should be 5");
    assert.strictEqual(clk.frequencyUnit, "MHz", "CLK frequencyUnit should be MHz");

    // Test invalid property name
    const r9 = commandEngine.execute("set CLK.invalidProp 123");
    assert(!r9.success, "Should fail for invalid property name");

    // 4. Test "connect" commands
    // CLK has "CLK" output, G1 has "A" and "B" inputs.
    const r10 = commandEngine.execute("connect CLK.CLK G1.A");
    assert(r10.success, `connect failed: ${r10.error}`);
    assert.strictEqual(circuit.wires.size, 1, "There should be 1 wire after connection");

    // Test invalid connect: connect to itself
    const r11 = commandEngine.execute("connect CLK.CLK CLK.CLK");
    assert(!r11.success, "Should fail connecting component to itself");

    // 5. Test "list" and "show" commands
    const r12 = commandEngine.execute("list");
    assert(r12.success, "list failed");
    assert(r12.data.includes("CLK (Clock)"), "list should contain CLK details");
    assert(r12.data.includes("G1 (AND)"), "list should contain G1 details");

    const r13 = commandEngine.execute("show CLK");
    assert(r13.success, "show failed");
    assert(r13.data.includes("Component: CLK"), "show should contain CLK details");

    // 6. Test "remove" command
    const r14 = commandEngine.execute("remove G1");
    assert(r14.success, `remove failed: ${r14.error}`);
    assert(!circuit.components.has("G1"), "G1 should be removed from the circuit");
    assert.strictEqual(circuit.wires.size, 0, "Wires connected to G1 should be auto-removed");

    // 7. Test "undo" and "redo" commands
    // CLK remains. Let's undo removing G1.
    const r15 = commandEngine.execute("undo");
    assert(r15.success, `undo failed: ${r15.error}`);
    assert(circuit.components.has("G1"), "G1 should be restored on undo");
    assert.strictEqual(circuit.wires.size, 1, "Wire connecting CLK to G1 should be restored");

    // Redo removing G1.
    const r16 = commandEngine.execute("redo");
    assert(r16.success, `redo failed: ${r16.error}`);
    assert(!circuit.components.has("G1"), "G1 should be removed again on redo");
    assert.strictEqual(circuit.wires.size, 0, "Wires should be removed again on redo");

    console.log("Command Execution Engine unit tests passed successfully!");
}

runTests();
