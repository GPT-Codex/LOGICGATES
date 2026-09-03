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

    // --- Regression Test: Four Seven-Segment Composite Display ---
    console.log("Running Four Seven-Segment Composite Display regression test...");

    // Create 4 Seven-Segment Displays placed horizontally
    const segA = createComponent("7-Segment Display", "segA", 100, 200);
    const segB = createComponent("7-Segment Display", "segB", 220, 200);
    const segC = createComponent("7-Segment Display", "segC", 340, 200);
    const segD = createComponent("7-Segment Display", "segD", 460, 200);

    const origComps = [segA, segB, segC, segD];

    // Calculate bounding box
    let rMinX = Infinity, rMaxX = -Infinity, rMinY = Infinity, rMaxY = -Infinity;
    for (const c of origComps) {
        const bbox = c.boundingBox();
        rMinX = Math.min(rMinX, bbox.x);
        rMaxX = Math.max(rMaxX, bbox.x + bbox.width);
        rMinY = Math.min(rMinY, bbox.y);
        rMaxY = Math.max(rMaxY, bbox.y + bbox.height);
    }
    const rPadding = 10;
    rMinX -= rPadding; rMaxX += rPadding; rMinY -= rPadding; rMaxY += rPadding;
    const expWidth = rMaxX - rMinX;
    const expHeight = rMaxY - rMinY;
    const rCenterX = (rMinX + rMaxX) / 2;
    const rCenterY = (rMinY + rMaxY) / 2;

    // Create inner components with relative coordinates
    const quadSubComps = origComps.map(c => ({
        id: c.id,
        type: c.type,
        x: c.x - rCenterX,
        y: c.y - rCenterY,
        label: c.id
    }));

    // Add pass-through Input gates for segA segment inputs 'a'..'g'
    const segAPins = ["a", "b", "c", "d", "e", "f", "g", "dp"];
    const quadSubWires = [];
    const quadInputs = [];

    segAPins.forEach(pName => {
        const portName = `segA_${pName}`;
        quadInputs.push(portName);
        quadSubComps.push({
            id: `in_${portName}`,
            type: "Input",
            x: (segA.x - rCenterX) - 40,
            y: segA.y - rCenterY,
            label: portName
        });
        quadSubWires.push({
            id: `wire_${portName}`,
            fromPin: `in_${portName}_out`,
            toPin: `segA_in_${pName.toUpperCase()}`
        });
    });

    const quadDef = new ModuleDefinition(
        "quad_7seg_display",
        "Quad7SegDisplay",
        "Composite display containing four Seven-Segment Displays",
        "Displays",
        quadInputs,
        [],
        quadSubComps,
        quadSubWires,
        "display",
        "display",
        [], [], null,
        { width: expWidth, height: expHeight }
    );

    registry.register(quadDef);

    const quadCircuit = new Circuit();
    const quadEngine = new SimulationEngine(quadCircuit);

    const quadComp = new UserModule("quad1", quadDef, 300, 300, registry);
    quadCircuit.addComponent(quadComp);

    // Verify 1: Display custom part recognition
    const isQuadDisplay = quadComp.definition && quadComp.definition.type === "display";
    assert.strictEqual(isQuadDisplay, true, "Quad composite display must be recognized as type = 'display'");

    // Verify 2: Geometry and dimensions
    assert.strictEqual(quadComp.width, expWidth, "Composite bounds must match original group bounds width");
    assert.strictEqual(quadComp.height, expHeight, "Composite bounds must match original group bounds height");

    // Verify 3: Contains 4 seven-segment children in innerCircuit
    const innerDisplays = Array.from(quadComp.innerCircuit.components.values()).filter(c => c.type === "7-Segment Display");
    assert.strictEqual(innerDisplays.length, 4, "Composite must contain 4 seven-segment display children");

    // Verify 4: Relative positions preserved
    const innerSegA = quadComp.innerCircuit.components.get("segA");
    assert.strictEqual(innerSegA.x, segA.x - rCenterX, "segA relative X position must be preserved");
    assert.strictEqual(innerSegA.y, segA.y - rCenterY, "segA relative Y position must be preserved");

    // Verify 5: Driving external input updates internal seven-segment input in real time
    const extSegA_a = quadComp.inputs.find(p => p.name === "segA_a");
    assert(extSegA_a, "External pin 'segA_a' must exist");

    extSegA_a.value = 1;
    quadComp.evaluate();

    assert.strictEqual(innerSegA.inputs[0].value, 1, "Internal Seven-Segment A segment 'a' must receive external signal 1");

    console.log("Four Seven-Segment Composite Display regression test passed successfully!");
    console.log("Display components tests passed successfully!");
}

runTests();
