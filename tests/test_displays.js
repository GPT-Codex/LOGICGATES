import assert from "assert";
import { createComponent } from "../frontend/js/simulation/components.js";

function runTests() {
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

    // Test 10 Segment creation
    const seg10 = createComponent("10-Segment Display", "seg_10", 100, 100);
    assert.strictEqual(seg10.type, "10-Segment Display");
    assert.strictEqual(seg10.inputs.length, 10);
    assert.strictEqual(seg10.outputs.length, 0);

    console.log("Display components tests passed successfully!");
}

runTests();
