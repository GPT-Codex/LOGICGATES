import assert from "assert";
import { Circuit } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { ModuleRegistry, ModuleDefinition } from "../frontend/js/simulation/modules.js";

function runTests() {
    console.log("Running Visual -> .sim -> New Project Round-Trip unit tests...");

    // Test 1: Standard Components, Properties & Wire Round-Trip
    {
        const circuit1 = new Circuit();
        const engine1 = new SimulationEngine(circuit1);
        const commandEngine1 = new CommandEngine(circuit1, null, null, engine1);

        // Build circuit via commands/visual graph
        commandEngine1.execute("add input A");
        commandEngine1.execute("move A to (100,100)");
        commandEngine1.execute("set A.label InA");

        commandEngine1.execute("add clock CLK1");
        commandEngine1.execute("move CLK1 to (100,200)");
        commandEngine1.execute("set CLK1.freq 50kHz");
        commandEngine1.execute("set CLK1.rotation 90");

        commandEngine1.execute("add button BTN1");
        commandEngine1.execute("move BTN1 to (100,300)");
        commandEngine1.execute("set BTN1.buttonMode hold");
        commandEngine1.execute("set BTN1.holdDuration 500");

        commandEngine1.execute("add and G1");
        commandEngine1.execute("move G1 to (300,150)");

        commandEngine1.execute("add led LED1");
        commandEngine1.execute("move LED1 to (500,150)");
        commandEngine1.execute("set LED1.ledColor Blue");

        commandEngine1.execute("add output OUT1");
        commandEngine1.execute("move OUT1 to (500,250)");

        commandEngine1.execute("connect A.Q G1.A");
        commandEngine1.execute("connect CLK1.CLK G1.B");
        commandEngine1.execute("connect G1.Y LED1.In");
        commandEngine1.execute("connect BTN1.Out OUT1.D");

        // 1. Export script S1
        const script1 = commandEngine1.exportScript();
        assert(typeof script1 === "string" && script1.length > 0, "Exported script should be non-empty");

        // 2. Import S1 into a brand NEW project circuit
        const circuit2 = new Circuit();
        const engine2 = new SimulationEngine(circuit2);
        const commandEngine2 = new CommandEngine(circuit2, null, null, engine2);

        const importRes = commandEngine2.executeScript(script1);
        assert(importRes.success, `Importing S1 into new project failed: ${importRes.error}`);

        // 3. Assert Graph Equivalence
        assert.strictEqual(circuit2.components.size, circuit1.components.size, "Component count should match");
        assert.strictEqual(circuit2.wires.size, circuit1.wires.size, "Wire count should match");

        // Check component properties
        const clk2 = circuit2.components.get("CLK1");
        assert(clk2, "CLK1 should exist in new project");
        assert.strictEqual(clk2.frequencyValue, 50, "CLK1 frequencyValue should match");
        assert.strictEqual(clk2.frequencyUnit, "kHz", "CLK1 frequencyUnit should match");
        assert.strictEqual(clk2.rotation, 90, "CLK1 rotation should match");

        const btn2 = circuit2.components.get("BTN1");
        assert(btn2, "BTN1 should exist in new project");
        assert.strictEqual(btn2.buttonMode, "hold", "BTN1 buttonMode should match");
        assert.strictEqual(btn2.holdDuration, 500, "BTN1 holdDuration should match");

        const led2 = circuit2.components.get("LED1");
        assert(led2, "LED1 should exist in new project");
        assert.strictEqual(led2.ledColor, "Blue", "LED1 ledColor should match");

        // Check wire connections
        const wires1Keys = Array.from(circuit1.wires.values()).map(w => `${w.fromPin.component.id}.${w.fromPin.name}->${w.toPin.component.id}.${w.toPin.name}`).sort();
        const wires2Keys = Array.from(circuit2.wires.values()).map(w => `${w.fromPin.component.id}.${w.fromPin.name}->${w.toPin.component.id}.${w.toPin.name}`).sort();
        assert.deepStrictEqual(wires1Keys, wires2Keys, "Wire topology keys must match exactly");

        // 4. Test Determinism: Re-export S2 and assert S1 === S2
        const script2 = commandEngine2.exportScript();
        assert.strictEqual(script1, script2, "Exported script S1 and S2 must be 100% identical");
    }

    // Test 2: Nets & Buses Round-Trip
    {
        const circuit1 = new Circuit();
        const engine1 = new SimulationEngine(circuit1);
        const commandEngine1 = new CommandEngine(circuit1, null, null, engine1);

        commandEngine1.execute("add input IN[0..3]");
        commandEngine1.execute("add output OUT[0..3]");
        commandEngine1.execute("net BUS[0..3]");
        commandEngine1.execute("connect IN[0..3] BUS[0..3]");
        commandEngine1.execute("connect BUS[0..3] OUT[0..3]");

        const script1 = commandEngine1.exportScript();

        // Import onto new project
        const circuit2 = new Circuit();
        const engine2 = new SimulationEngine(circuit2);
        const commandEngine2 = new CommandEngine(circuit2, null, null, engine2);

        const res = commandEngine2.executeScript(script1);
        assert(res.success, `Nets/Buses script import failed: ${res.error}`);

        assert.strictEqual(circuit2.components.size, circuit1.components.size, "Nets/Buses component count should match");
        assert.strictEqual(circuit2.wires.size, circuit1.wires.size, "Nets/Buses wire count should match");

        // Check simulation signal pass-through on new project
        const in0 = circuit2.components.get("IN[0]");
        const out0 = circuit2.components.get("OUT[0]");
        in0.stateValue = 1;
        in0.evaluate();
        engine2.evaluateAll();
        assert.strictEqual(out0.inputs[0].value, 1, "Signal should pass through net on new project");

        const script2 = commandEngine2.exportScript();
        assert.strictEqual(script1, script2, "Nets/Buses export script must be 100% identical");
    }

    // Test 3: Custom Modules Round-Trip
    {
        const registry = new ModuleRegistry();
        const def = new ModuleDefinition(
            "half_adder",
            "Half Adder",
            "2-bit half adder",
            "Arithmetic",
            ["A", "B"],
            ["Sum", "Carry"],
            [],
            [],
            "Module",
            "Custom"
        );
        registry.register(def);

        const circuit1 = new Circuit();
        const engine1 = new SimulationEngine(circuit1);
        const commandEngine1 = new CommandEngine(circuit1, registry, null, engine1);

        commandEngine1.execute("add input A");
        commandEngine1.execute("add input B");
        commandEngine1.execute("add Half Adder HA1");
        commandEngine1.execute("add output SUM");
        commandEngine1.execute("add output CARRY");

        commandEngine1.execute("connect A.Q HA1.A");
        commandEngine1.execute("connect B.Q HA1.B");
        commandEngine1.execute("connect HA1.Sum SUM.D");
        commandEngine1.execute("connect HA1.Carry CARRY.D");

        const script1 = commandEngine1.exportScript();
        assert(script1.includes("add Half Adder HA1"), "Exported script should preserve custom module command");

        // Import into new project
        const circuit2 = new Circuit();
        const engine2 = new SimulationEngine(circuit2);
        const commandEngine2 = new CommandEngine(circuit2, registry, null, engine2);

        const res = commandEngine2.executeScript(script1);
        assert(res.success, `Custom module script import failed: ${res.error}`);

        const ha2 = circuit2.components.get("HA1");
        assert(ha2, "Custom module instance HA1 should exist in new project");
        assert.strictEqual(ha2.type, "UserModule", "HA1 should be UserModule type");
        assert.strictEqual(ha2.definition.name, "Half Adder", "HA1 definition name should match");

        const script2 = commandEngine2.exportScript();
        assert.strictEqual(script1, script2, "Custom module export script must be 100% identical");
    }

    console.log("Visual -> .sim -> New Project Round-Trip unit tests passed successfully!");
}

runTests();
