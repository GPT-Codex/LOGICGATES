import assert from "assert";
import { ModuleDefinition, UserModule, ModuleRegistry } from "../frontend/js/simulation/modules.js";
import { Circuit, Wire } from "../frontend/js/simulation/core.js";
import { createComponent } from "../frontend/js/simulation/components.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";

function runTests() {
    console.log("Running custom module system tests...");

    const registry = new ModuleRegistry();

    // 1. Create half-adder subcircuit definition
    // Inner components:
    // - Input A, Label: "A"
    // - Input B, Label: "B"
    // - XOR gate
    // - AND gate
    // - Output Sum, Label: "Sum"
    // - Output Carry, Label: "Carry"

    const innerComps = [
        { type: "Input", id: "in_a", x: -100, y: -50, label: "A" },
        { type: "Input", id: "in_b", x: -100, y: 50, label: "B" },
        { type: "XOR", id: "xor_gate", x: 0, y: -50 },
        { type: "AND", id: "and_gate", x: 0, y: 50 },
        { type: "Output", id: "out_sum", x: 100, y: -50, label: "Sum" },
        { type: "Output", id: "out_carry", x: 100, y: 50, label: "Carry" }
    ];

    const innerWires = [
        { id: "w_a_xor", fromPin: "in_a_out", toPin: "xor_gate_inA" },
        { id: "w_b_xor", fromPin: "in_b_out", toPin: "xor_gate_inB" },
        { id: "w_a_and", fromPin: "in_a_out", toPin: "and_gate_inA" },
        { id: "w_b_and", fromPin: "in_b_out", toPin: "and_gate_inB" },
        { id: "w_xor_sum", fromPin: "xor_gate_out", toPin: "out_sum_in" },
        { id: "w_and_carry", fromPin: "and_gate_out", toPin: "out_carry_in" }
    ];

    const halfAdderDef = new ModuleDefinition(
        "half_adder",
        "Half Adder",
        "XOR & AND based half adder",
        "Arithmetic",
        ["A", "B"],
        ["Sum", "Carry"],
        innerComps,
        innerWires
    );

    registry.register(halfAdderDef);

    // Verify registry operations
    assert.strictEqual(registry.get("half_adder"), halfAdderDef);
    assert.strictEqual(registry.rename("half_adder", "My Half Adder"), true);
    assert.strictEqual(halfAdderDef.name, "My Half Adder");

    // 2. Instantiate UserModule on main canvas
    const mainCircuit = new Circuit();
    const mainEngine = new SimulationEngine(mainCircuit);

    const mainInputA = createComponent("Input", "main_in_a", 0, 0);
    const mainInputB = createComponent("Input", "main_in_b", 0, 100);
    const halfAdderInstance = new UserModule("ha_inst", halfAdderDef, 100, 50);
    const mainOutSum = createComponent("Output", "main_out_sum", 250, 0);
    const mainOutCarry = createComponent("Output", "main_out_carry", 250, 100);

    mainCircuit.addComponent(mainInputA);
    mainCircuit.addComponent(mainInputB);
    mainCircuit.addComponent(halfAdderInstance);
    mainCircuit.addComponent(mainOutSum);
    mainCircuit.addComponent(mainOutCarry);

    // Connect external wires
    // ha_inst has pins matching definition inputs ["A", "B"] and outputs ["Sum", "Carry"]
    // Pin IDs inside UserModule constructor are generated as `${id}_in_${name}` and `${id}_out_${name}`
    const w1 = new Wire("w1", mainInputA.outputs[0], halfAdderInstance.inputs[0]);
    const w2 = new Wire("w2", mainInputB.outputs[0], halfAdderInstance.inputs[1]);
    const w3 = new Wire("w3", halfAdderInstance.outputs[0], mainOutSum.inputs[0]);
    const w4 = new Wire("w4", halfAdderInstance.outputs[1], mainOutCarry.inputs[0]);

    mainCircuit.addWire(w1);
    mainCircuit.addWire(w2);
    mainCircuit.addWire(w3);
    mainCircuit.addWire(w4);

    mainEngine.evaluateAll();

    // With main input A=0, B=0: Sum=0, Carry=0
    assert.strictEqual(mainOutSum.inputs[0].value, 0);
    assert.strictEqual(mainOutCarry.inputs[0].value, 0);

    // Toggle input A to 1
    mainInputA.stateValue = 1;
    mainEngine.triggerInputToggle(mainInputA);

    // With main input A=1, B=0: Sum=1, Carry=0
    assert.strictEqual(mainOutSum.inputs[0].value, 1);
    assert.strictEqual(mainOutCarry.inputs[0].value, 0);

    // Toggle both inputs A=1, B=1
    mainInputB.stateValue = 1;
    mainEngine.triggerInputToggle(mainInputB);

    // With main input A=1, B=1: Sum=0, Carry=1
    assert.strictEqual(mainOutSum.inputs[0].value, 0);
    assert.strictEqual(mainOutCarry.inputs[0].value, 1);

    // Delete custom module definition
    registry.delete("half_adder");
    assert.strictEqual(registry.get("half_adder"), undefined);

    console.log("Custom module system tests passed successfully!");
}

runTests();
