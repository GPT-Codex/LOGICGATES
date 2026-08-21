import assert from "assert";
import { UserModule, ModuleDefinition } from "../frontend/js/simulation/modules.js";

function runTests() {
    console.log("Running pin repositioning tests...");

    const def = new ModuleDefinition(
        "test_mod",
        "Test Mod",
        "",
        "Custom",
        ["A"],
        ["Q"],
        [],
        []
    );

    const inst = new UserModule("inst_1", def, 100, 100);
    const pinA = inst.inputs[0];

    // Initial position: should be on the left
    assert.strictEqual(pinA.side, "left");
    assert.strictEqual(pinA.relX, -inst.width / 2);

    // Reposition to TOP side at offset 15
    inst.repositionPin(pinA.id, "top", 15);
    assert.strictEqual(pinA.side, "top");
    assert.strictEqual(pinA.offset, 15);
    assert.strictEqual(pinA.relX, 15);
    assert.strictEqual(pinA.relY, -inst.height / 2);

    // Reposition to BOTTOM side at offset -10
    inst.repositionPin(pinA.id, "bottom", -10);
    assert.strictEqual(pinA.side, "bottom");
    assert.strictEqual(pinA.offset, -10);
    assert.strictEqual(pinA.relX, -10);
    assert.strictEqual(pinA.relY, inst.height / 2);

    console.log("Pin repositioning tests passed successfully!");
}

runTests();
