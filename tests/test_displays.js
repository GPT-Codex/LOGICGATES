import assert from "assert";
import { createComponent } from "../frontend/js/simulation/components.js";

async function runTests() {
    console.log("Running display components tests...");

    // Test LED creation
    const led = createComponent("LED", "led_1", 100, 100);
    assert.strictEqual(led.type, "LED");
    assert.strictEqual(led.inputs.length, 1);
    assert.strictEqual(led.outputs.length, 0);

    // Test 7 Segment creation
    const seg7 = createComponent("7-Segment Display", "seg_7", 100, 100);
    assert.strictEqual(seg7.type, "7-Segment Display");
    assert.strictEqual(seg7.inputs.length, 8);
    assert.strictEqual(seg7.outputs.length, 0);

    // Test 4-Digit 7 Segment creation
    const seg4digit = createComponent("4-Digit 7-Segment Display", "seg_4d", 100, 100);
    assert.strictEqual(seg4digit.type, "4-Digit 7-Segment Display");
    assert.strictEqual(seg4digit.inputs.length, 12, "4-Digit 7-Segment Display should have 12 inputs (8 segments + 4 digit selects)");
    assert.strictEqual(seg4digit.outputs.length, 0);
    assert.strictEqual(seg4digit.inputs[0].name, "a");
    assert.strictEqual(seg4digit.inputs[7].name, "dp");
    assert.strictEqual(seg4digit.inputs[8].name, "DIG1");
    assert.strictEqual(seg4digit.inputs[11].name, "DIG4");

    // Test 10 Segment creation
    const seg10 = createComponent("10-Segment Display", "seg_10", 100, 100);
    assert.strictEqual(seg10.type, "10-Segment Display");
    assert.strictEqual(seg10.inputs.length, 10);
    assert.strictEqual(seg10.outputs.length, 0);

    // Composite Display Tests
    const { Circuit, Wire } = await import("../frontend/js/simulation/core.js");
    const { ModuleDefinition, ModuleRegistry, UserModule } = await import("../frontend/js/simulation/modules.js");
    const { SimulationEngine } = await import("../frontend/js/simulation/simulation_engine.js");
    const { CommandEngine } = await import("../frontend/js/simulation/command_engine.js");

    const registry = new ModuleRegistry();

    // Create Composite Display definition containing two 7-Segment displays and an LED
    const dispDef = new ModuleDefinition(
        "dual_display",
        "DualDisplay",
        "Dual 7-Segment and LED composite display",
        "Displays",
        ["a", "b", "c", "d", "e", "f", "g", "dp", "led_in"], // external inputs
        [],
        [
            { id: "in_a", type: "Input", x: -100, y: -40, label: "a" },
            { id: "seg7_1", type: "7-Segment Display", x: -50, y: 0, label: "SEG1" },
            { id: "in_led", type: "Input", x: 100, y: -40, label: "led_in" },
            { id: "led_1", type: "LED", x: 50, y: 0, label: "LED1" }
        ],
        [
            { id: "w1", fromPin: "in_a_out", toPin: "seg7_1_in_A" },
            { id: "w2", fromPin: "in_led_out", toPin: "led_1_in" }
        ],
        "display",
        "display",
        [], [], null,
        { width: 220, height: 120 }
    );

    registry.register(dispDef);

    // Instantiate UserModule for composite display
    const circuit = new Circuit();
    const engine = new SimulationEngine(circuit);
    const compDisp = new UserModule("disp1", dispDef, 200, 200, registry);

    assert.strictEqual(compDisp.width, 220, "Composite display width should preserve original geometry");
    assert.strictEqual(compDisp.height, 120, "Composite display height should preserve original geometry");
    assert.strictEqual(compDisp.inputs.length, 9, "Composite display should expose derived input pins");

    circuit.addComponent(compDisp);

    // Drive external input 'a' and 'led_in'
    const extInputA = compDisp.inputs.find(p => p.name === "a");
    const extInputLed = compDisp.inputs.find(p => p.name === "led_in");

    assert(extInputA, "External pin 'a' should exist");
    assert(extInputLed, "External pin 'led_in' should exist");

    extInputA.value = 1;
    extInputLed.value = 1;

    compDisp.evaluate();

    // Check inner component states
    const innerSeg = compDisp.innerCircuit.components.get("seg7_1");
    const innerLed = compDisp.innerCircuit.components.get("led_1");

    assert.strictEqual(innerSeg.inputs[0].value, 1, "Internal segment A should receive external signal HIGH");
    assert.strictEqual(innerLed.inputs[0].value, 1, "Internal LED should receive external signal HIGH");

    // Test Script execution `add display DualDisplay D1`
    const cmdEngine = new CommandEngine(circuit, registry, null, engine);
    const res = cmdEngine.execute("add display DualDisplay D1");
    assert.strictEqual(res.success, true, "Should instantiate display custom part via script command");
    assert(circuit.components.has("D1"));
    const d1Comp = circuit.components.get("D1");
    assert.strictEqual(d1Comp.width, 220);

    console.log("Display components tests passed successfully!");
}

runTests();
