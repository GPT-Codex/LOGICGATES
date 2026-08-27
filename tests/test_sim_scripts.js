import assert from "assert";
import { Circuit } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { HistoryManager } from "../frontend/js/canvas/interactions.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";

async function runTests() {
    console.log("Running .sim Circuit Script unit tests...");

    // Test 1: Parsing and Comments
    {
        const circuit = new Circuit();
        const engine = new SimulationEngine(circuit);
        const historyManager = new HistoryManager();
        const commandEngine = new CommandEngine(circuit, null, historyManager, engine);

        const scriptText = `
# Full adder comment line 1
# Another comment

add input A # create input A
add input B
add and G1

# Blank lines above
connect A.out G1.A # connect A to G1
`;

        const res = await commandEngine.executeScript(scriptText);
        assert(res.success, `Script execution failed: ${res.error}`);
        assert.strictEqual(res.linesExecuted, 4, "Should have executed 4 valid command lines");
        assert(circuit.components.has("A"), "Component A should be added");
        assert(circuit.components.has("B"), "Component B should be added");
        assert(circuit.components.has("G1"), "Component G1 should be added");
        assert.strictEqual(circuit.wires.size, 1, "There should be 1 wire connected");
    }

    // Test 2: Line Numbers on Error
    {
        const circuit = new Circuit();
        const engine = new SimulationEngine(circuit);
        const historyManager = new HistoryManager();
        const commandEngine = new CommandEngine(circuit, null, historyManager, engine);

        const scriptText = `# Line 1: Comment
# Line 2: Comment
add input A
add input B
# Line 5: Comment
add invalid_component_type C
add output S
`;

        const res = await commandEngine.executeScript(scriptText);
        assert(!res.success, "Script should fail on invalid component type");
        assert.strictEqual(res.line, 6, "Failure line should be exactly 6");
        assert(res.error.includes("Line 6:"), `Error message should contain 'Line 6:', got: ${res.error}`);
    }

    // Test 3: Transaction Rollback on Error
    {
        const circuit = new Circuit();
        const engine = new SimulationEngine(circuit);
        const historyManager = new HistoryManager();
        const commandEngine = new CommandEngine(circuit, null, historyManager, engine);

        // Pre-existing component
        commandEngine.execute("add clock CLK_ORIG");
        assert.strictEqual(circuit.components.size, 1, "Initial circuit has 1 component");

        const scriptText = `# Transaction test script
add input A
add input B
add and G1
connect A.out G1.A
add input A
`;

        const res = await commandEngine.executeScript(scriptText);
        assert(!res.success, "Script should fail due to duplicate component");
        assert.strictEqual(res.line, 6, "Failure line should be 6");

        // Verify full rollback: Circuit should revert to state before script execution
        assert.strictEqual(circuit.components.size, 1, "Circuit should be rolled back to 1 component");
        assert(circuit.components.has("CLK_ORIG"), "CLK_ORIG should remain");
        assert(!circuit.components.has("A"), "A should be rolled back");
        assert(!circuit.components.has("B"), "B should be rolled back");
        assert(!circuit.components.has("G1"), "G1 should be rolled back");
        assert.strictEqual(circuit.wires.size, 0, "All script-created wires should be rolled back");
    }

    // Test 4: Transaction Single History State & Undo
    {
        const circuit = new Circuit();
        const engine = new SimulationEngine(circuit);
        const historyManager = new HistoryManager();
        const commandEngine = new CommandEngine(circuit, null, historyManager, engine);

        // Initial state
        historyManager.pushState(JSON.stringify({ components: [], wires: [], definitions: [] }));

        const scriptText = `
add input A
add input B
add and G1
add output S
connect A.out G1.A
connect G1.Y S.D
`;

        const res = await commandEngine.executeScript(scriptText);
        assert(res.success, `Script execution failed: ${res.error}`);
        assert.strictEqual(circuit.components.size, 4, "Circuit should have 4 components");
        assert.strictEqual(circuit.wires.size, 2, "Circuit should have 2 wires");

        // Undo single transaction
        const undoRes = commandEngine.execute("undo");
        assert(undoRes.success, "Undo should succeed");
        assert.strictEqual(circuit.components.size, 0, "Undo should remove all script components in 1 step");
        assert.strictEqual(circuit.wires.size, 0, "Undo should remove all script wires in 1 step");
    }

    // Test 5: Export and Import Consistency
    {
        const circuit = new Circuit();
        const engine = new SimulationEngine(circuit);
        const historyManager = new HistoryManager();
        const commandEngine = new CommandEngine(circuit, null, historyManager, engine);

        const originalScript = `
# Half adder test
add input A
move A to (50,50)
set A.label InputA
add input B
move B to (50,150)
set B.label InputB
add xor G1
move G1 to (200,50)
add and G2
move G2 to (200,150)
add output SUM
move SUM to (350,50)
add output CARRY
move CARRY to (350,150)
connect A.Q G1.A
connect B.Q G1.B
connect A.Q G2.A
connect B.Q G2.B
connect G1.Y SUM.D
connect G2.Y CARRY.D
`;

        const res1 = await commandEngine.executeScript(originalScript);
        assert(res1.success, `Original script execution failed: ${res1.error}`);
        assert.strictEqual(circuit.components.size, 6, "Original circuit should have 6 components");
        assert.strictEqual(circuit.wires.size, 6, "Original circuit should have 6 wires");

        // Export circuit to script
        const exportedScript = commandEngine.exportScript();
        assert(typeof exportedScript === "string" && exportedScript.length > 0, "Exported script should be non-empty string");

        // Clear circuit
        circuit.clear();
        assert.strictEqual(circuit.components.size, 0, "Cleared circuit should have 0 components");

        // Re-import exported script
        const res2 = await commandEngine.executeScript(exportedScript);
        assert(res2.success, `Importing exported script failed: ${res2.error}`);

        // Verify graph equivalence
        assert.strictEqual(circuit.components.size, 6, "Restored circuit should have 6 components");
        assert.strictEqual(circuit.wires.size, 6, "Restored circuit should have 6 wires");

        const compA = circuit.components.get("A");
        assert(compA, "Component A should exist");
        assert.strictEqual(compA.x, 50, "Component A x position should match");
        assert.strictEqual(compA.y, 50, "Component A y position should match");
        assert.strictEqual(compA.label, "InputA", "Component A label should match");

        const compSUM = circuit.components.get("SUM");
        assert(compSUM, "Component SUM should exist");
        assert.strictEqual(compSUM.x, 350, "Component SUM x position should match");

        // Re-export and verify text structure parity
        const reExportedScript = commandEngine.exportScript();
        assert.strictEqual(reExportedScript, exportedScript, "Re-exported script should be identical to exported script");
    }

    console.log(".sim Circuit Script unit tests passed successfully!");
}

await runTests();
