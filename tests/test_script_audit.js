import assert from "assert";
import { Circuit } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { ModuleRegistry, ModuleDefinition, UserModule } from "../frontend/js/simulation/modules.js";
import { HistoryManager } from "../frontend/js/canvas/interactions.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { serializeCircuit, deserializeCircuit } from "../frontend/js/simulation/serialization.js";

function runAuditTests() {
    console.log("Running Scripting System Audit & Hardening tests...");

    const registry = new ModuleRegistry();
    const circuit = new Circuit();
    const engine = new SimulationEngine(circuit);
    const historyManager = new HistoryManager();
    const commandEngine = new CommandEngine(circuit, registry, historyManager, engine);

    // Initial state snapshot
    historyManager.pushState(JSON.stringify(serializeCircuit(circuit, registry)));

    // ==========================================
    // 1. Command Execution Correctness & Error Handling
    // ==========================================
    console.log("  1. Testing Command Execution Correctness & Validation...");

    // Invalid syntax checks
    assert(!commandEngine.execute("add").success, "Should fail: missing type and name");
    assert(!commandEngine.execute("add and").success, "Should fail: missing name");
    assert(!commandEngine.execute("add NonExistentType G1").success, "Should fail: unknown component type");
    assert(!commandEngine.execute("add and 123Name").success, "Should fail: invalid name identifier");

    // Add valid components
    assert(commandEngine.execute("add input A").success);
    assert(commandEngine.execute("add input B").success);
    assert(commandEngine.execute("add and G1").success);
    assert(commandEngine.execute("add output Y").success);

    // Duplicate name
    assert(!commandEngine.execute("add input A").success, "Should fail: duplicate component name");

    // Move validation
    assert(!commandEngine.execute("move NonExistent to (10,10)").success, "Should fail: unknown component");
    assert(!commandEngine.execute("move A to 10,10").success, "Should fail: invalid coord format");
    assert(commandEngine.execute("move A to (20, 40)").success);
    assert.strictEqual(circuit.components.get("A").x, 20);
    assert.strictEqual(circuit.components.get("A").y, 40);

    // Set validation
    assert(!commandEngine.execute("set A.invalidProp 123").success, "Should fail: unknown property");
    assert(!commandEngine.execute("set G1.freq 10Hz").success, "Should fail: AND gate does not support freq");
    assert(commandEngine.execute("add clock CLK").success);
    assert(!commandEngine.execute("set CLK.freq invalid").success, "Should fail: invalid frequency format");
    assert(!commandEngine.execute("set CLK.freq -5Hz").success, "Should fail: negative frequency");
    assert(!commandEngine.execute("set CLK.freq 10FooUnit").success, "Should fail: unknown frequency unit");
    assert(commandEngine.execute("set CLK.freq 10MHz").success);

    // Connect validation
    assert(!commandEngine.execute("connect NonExistent.out G1.A").success, "Should fail: unknown component");
    assert(!commandEngine.execute("connect A.out G1.InvalidPin").success, "Should fail: unknown pin");
    assert(!commandEngine.execute("connect G1.A A.out").success, "Should fail: input to output direction error");
    assert(!commandEngine.execute("connect G1 G1").success, "Should fail: self-connection");

    // Valid connections
    assert(commandEngine.execute("connect A G1.A").success);
    assert(commandEngine.execute("connect B G1.B").success);
    assert(commandEngine.execute("connect G1 Y").success);
    assert.strictEqual(circuit.wires.size, 3);

    // Verify electrical evaluation
    circuit.components.get("A").stateValue = 1;
    circuit.components.get("B").stateValue = 1;
    engine.evaluateAll();
    assert.strictEqual(circuit.components.get("Y").inputs[0].value, 1, "AND output Y should be 1 when inputs are 1");

    circuit.components.get("B").stateValue = 0;
    engine.evaluateAll();
    assert.strictEqual(circuit.components.get("Y").inputs[0].value, 0, "AND output Y should be 0 when input B is 0");

    // ==========================================
    // 2. Script Atomicity & Rollback
    // ==========================================
    console.log("  2. Testing Script Atomicity & Rollback...");

    const preFailCompCount = circuit.components.size;
    const preFailWireCount = circuit.wires.size;

    const failingScript = `
        add input C
        add or G2
        connect C.out G2.A
        connect G2.out INVALID_COMPONENT.in
    `;

    const failRes = commandEngine.executeScript(failingScript);
    assert(!failRes.success, "Script should fail due to invalid target component");
    assert.strictEqual(failRes.line, 5, "Failure should be reported at line 5");
    assert(failRes.error.includes("Line 5"), "Error message should report line number");

    // Verify complete rollback
    assert.strictEqual(circuit.components.size, preFailCompCount, "Circuit components should roll back completely");
    assert.strictEqual(circuit.wires.size, preFailWireCount, "Circuit wires should roll back completely");
    assert(!circuit.components.has("C"), "Component C added before failure should be rolled back");
    assert(!circuit.components.has("G2"), "Component G2 added before failure should be rolled back");

    // ==========================================
    // 3. Undo / Redo Transaction Integrity
    // ==========================================
    console.log("  3. Testing Undo/Redo Transaction Integrity...");

    const preScriptCompCount = circuit.components.size;
    const preScriptWireCount = circuit.wires.size;

    const validScript = `
        # Add half adder components
        add input IN1
        add input IN2
        add xor XOR1
        add and AND1
        add output SUM
        add output CARRY

        connect IN1 XOR1.A
        connect IN2 XOR1.B
        connect IN1 AND1.A
        connect IN2 AND1.B
        connect XOR1 SUM
        connect AND1 CARRY
    `;

    const scriptRes = commandEngine.executeScript(validScript);
    assert(scriptRes.success, `Script execution failed: ${scriptRes.error}`);

    const postScriptCompCount = circuit.components.size;
    const postScriptWireCount = circuit.wires.size;
    assert.strictEqual(postScriptCompCount, preScriptCompCount + 6);
    assert.strictEqual(postScriptWireCount, preScriptWireCount + 6);

    // Single Undo should revert the entire script
    const undoRes = commandEngine.execute("undo");
    assert(undoRes.success, "Undo should succeed");
    assert.strictEqual(circuit.components.size, preScriptCompCount, "All script components removed on single undo");
    assert.strictEqual(circuit.wires.size, preScriptWireCount, "All script wires removed on single undo");

    // Single Redo should restore the entire script
    const redoRes = commandEngine.execute("redo");
    assert(redoRes.success, "Redo should succeed");
    assert.strictEqual(circuit.components.size, postScriptCompCount, "All script components restored on single redo");
    assert.strictEqual(circuit.wires.size, postScriptWireCount, "All script wires restored on single redo");

    // ==========================================
    // 4. Custom Module Scripting & Wiring Protection
    // ==========================================
    console.log("  4. Testing Custom Module Scripting & Wiring...");

    // Register a half adder definition in registry
    const haDef = new ModuleDefinition(
        "half_adder_mod",
        "HalfAdder",
        "Half Adder Module",
        "Custom",
        ["A", "B"],
        ["CARRY", "SUM"],
        [
            { id: "i1", type: "Input", label: "A", x: 50, y: 50 },
            { id: "i2", type: "Input", label: "B", x: 50, y: 150 },
            { id: "g1", type: "XOR", label: "", x: 200, y: 50 },
            { id: "g2", type: "AND", label: "", x: 200, y: 150 },
            { id: "o1", type: "Output", label: "SUM", x: 350, y: 50 },
            { id: "o2", type: "Output", label: "CARRY", x: 350, y: 150 }
        ],
        [
            { id: "w1", fromPin: "i1_out", toPin: "g1_inA" },
            { id: "w2", fromPin: "i2_out", toPin: "g1_inB" },
            { id: "w3", fromPin: "i1_out", toPin: "g2_inA" },
            { id: "w4", fromPin: "i2_out", toPin: "g2_inB" },
            { id: "w5", fromPin: "g1_out", toPin: "o1_in" },
            { id: "w6", fromPin: "g2_out", toPin: "o2_in" }
        ]
    );
    registry.register(haDef);

    // Instantiate custom module via script
    assert(commandEngine.execute("add HalfAdder HA1").success);
    const haComp = circuit.components.get("HA1");
    assert(haComp instanceof UserModule);

    // Connect to HA1 pins
    assert(commandEngine.execute("connect IN1 HA1.A").success);
    assert(commandEngine.execute("connect IN2 HA1.B").success);

    // Test moving HA1 preserves inner circuit and external wiring
    assert(commandEngine.execute("move HA1 to (300, 300)").success);
    assert.strictEqual(haComp.x, 300);
    assert.strictEqual(haComp.y, 300);

    // Test electrical propagation through custom module
    circuit.components.get("IN1").stateValue = 1;
    circuit.components.get("IN2").stateValue = 1;
    engine.evaluateAll();
    haComp.evaluate();

    const sumPin = haComp.outputs.find(p => p.name === "SUM");
    const carryPin = haComp.outputs.find(p => p.name === "CARRY");
    assert.strictEqual(sumPin.value, 0, "1 XOR 1 = 0");
    assert.strictEqual(carryPin.value, 1, "1 AND 1 = 1");

    // ==========================================
    // 5. Expression Parsing & Error Handling
    // ==========================================
    console.log("  5. Testing Expression Parsing & Error Handling...");

    assert(!commandEngine.execute("expr S = (A XOR B").success, "Should fail: missing closing parenthesis");
    assert(!commandEngine.execute("expr S = A AND").success, "Should fail: missing operand");
    assert(!commandEngine.execute("expr S = A INVALID_OP B").success, "Should fail: unknown operator");
    assert(!commandEngine.execute("expr 123Bad = A").success, "Should fail: invalid output name");

    assert(commandEngine.execute("expr EXPR_OUT = (IN1 XOR IN2) AND CLK").success);
    assert(circuit.components.has("EXPR_OUT"));

    // ==========================================
    // 6. Nets & Bus Range Handling
    // ==========================================
    console.log("  6. Testing Nets & Bus Ranges...");

    assert(commandEngine.execute("net VCC").success);
    assert(commandEngine.execute("add and GATE_BUS[0]").success);
    assert(commandEngine.execute("add and GATE_BUS[1]").success);

    // Bus range expansion command
    const busAddRes = commandEngine.execute("add buffer BUF[0..3]");
    assert(busAddRes.success, `Bus add failed: ${busAddRes.error}`);
    assert(circuit.components.has("BUF[0]"));
    assert(circuit.components.has("BUF[3]"));

    // Disconnecting/removing one net member
    assert(commandEngine.execute("connect VCC BUF[0].A").success);
    assert(commandEngine.execute("connect VCC BUF[1].A").success);
    assert(commandEngine.execute("remove BUF[0]").success);

    assert(!circuit.components.has("BUF[0]"), "BUF[0] removed");
    assert(circuit.components.has("VCC"), "Net VCC should remain intact when one target is removed");
    assert(circuit.components.has("BUF[1]"), "BUF[1] should remain intact");

    // ==========================================
    // 7. Serialization Equivalence Audit
    // ==========================================
    console.log("  7. Testing Serialization & Save/Load Equivalence...");

    const originalJson = serializeCircuit(circuit, registry);
    const newCircuit = new Circuit();
    deserializeCircuit(originalJson, newCircuit, registry);

    assert.strictEqual(newCircuit.components.size, circuit.components.size, "Component counts must match");
    assert.strictEqual(newCircuit.wires.size, circuit.wires.size, "Wire counts must match");

    for (const [id, comp] of circuit.components.entries()) {
        const deserializedComp = newCircuit.components.get(id);
        assert(deserializedComp, `Component ${id} must survive serialization`);
        assert.strictEqual(deserializedComp.type, comp.type);
        assert.strictEqual(deserializedComp.x, comp.x);
        assert.strictEqual(deserializedComp.y, comp.y);
    }

    // ==========================================
    // 8. Large Circuit Stress Test (100+ components, 200+ wires)
    // ==========================================
    console.log("  8. Testing Large Circuit Stress & Performance...");

    const largeCircuit = new Circuit();
    const largeEngine = new SimulationEngine(largeCircuit);
    const largeCmdEngine = new CommandEngine(largeCircuit, registry, null, largeEngine);

    const startTime = Date.now();
    const scriptLines = ["# Large Stress Circuit"];

    // Generate 100 inputs, 100 buffers, 100 outputs
    for (let i = 0; i < 100; i++) {
        scriptLines.push(`add input IN_${i}`);
        scriptLines.push(`add buffer BUF_${i}`);
        scriptLines.push(`add output OUT_${i}`);
        scriptLines.push(`move IN_${i} to (${100 + i * 10}, 100)`);
        scriptLines.push(`connect IN_${i} BUF_${i}`);
        scriptLines.push(`connect BUF_${i} OUT_${i}`);
    }

    const largeScriptStr = scriptLines.join("\n");
    const stressRes = largeCmdEngine.executeScript(largeScriptStr);
    const elapsed = Date.now() - startTime;

    assert(stressRes.success, `Large script execution failed: ${stressRes.error}`);
    assert.strictEqual(largeCircuit.components.size, 300, "Should have 300 components");
    assert.strictEqual(largeCircuit.wires.size, 200, "Should have 200 wires");
    console.log(`     Executed 300 components + 200 wires script in ${elapsed}ms`);

    // Verify export script on large circuit
    const exportedLarge = largeCmdEngine.exportScript();
    assert(exportedLarge.includes("add input IN_0"));
    assert(exportedLarge.includes("connect BUF_99.Y OUT_99.D"));

    console.log("Scripting System Audit & Hardening tests passed successfully!");
}

runAuditTests();
