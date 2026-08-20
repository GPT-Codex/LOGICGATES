import assert from "assert";
import { createComponent } from "../frontend/js/simulation/components.js";

function runTests() {
    console.log("Running component rotation tests...");

    // Create an AND Gate at x=100, y=100
    // Default size is width=60, height=40
    const andGate = createComponent("AND", "and_rot", 100, 100);
    assert.strictEqual(andGate.rotation, 0);

    // Initial bounding box dimensions
    let bbox = andGate.boundingBox();
    assert.strictEqual(bbox.width, 60);
    assert.strictEqual(bbox.height, 40);
    assert.strictEqual(bbox.x, 70); // 100 - 30
    assert.strictEqual(bbox.y, 80); // 100 - 20

    // Rel positions of input A: relX = -30, relY = -10
    let pinA = andGate.inputs[0];
    let pos = andGate.getPinAbsolutePosition(pinA);
    assert.strictEqual(pos.x, 70); // 100 - 30
    assert.strictEqual(pos.y, 90); // 100 - 10

    // Rotate 90 degrees
    andGate.rotation = 90;
    bbox = andGate.boundingBox();
    // Width and height should swap!
    assert.strictEqual(bbox.width, 40);
    assert.strictEqual(bbox.height, 60);

    // Rotated pin position for 90 degrees:
    // x' = x - relY, y' = y + relX
    // x' = 100 - (-10) = 110
    // y' = 100 + (-30) = 70
    pos = andGate.getPinAbsolutePosition(pinA);
    assert.strictEqual(pos.x, 110);
    assert.strictEqual(pos.y, 70);

    // Rotate 180 degrees
    andGate.rotation = 180;
    bbox = andGate.boundingBox();
    assert.strictEqual(bbox.width, 60);
    assert.strictEqual(bbox.height, 40);

    // Rotated pin position for 180 degrees:
    // x' = x - relX, y' = y - relY
    // x' = 100 - (-30) = 130
    // y' = 100 - (-10) = 110
    pos = andGate.getPinAbsolutePosition(pinA);
    assert.strictEqual(pos.x, 130);
    assert.strictEqual(pos.y, 110);

    console.log("Component rotation tests passed successfully!");
}

runTests();
