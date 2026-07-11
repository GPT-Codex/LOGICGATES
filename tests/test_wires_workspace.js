import assert from "assert";
import { computeManhattanRoute, isPointNearWire } from "../frontend/js/canvas/wires.js";
import { Workspace } from "../frontend/js/canvas/workspace.js";
import { Circuit, Wire } from "../frontend/js/simulation/core.js";
import { createComponent } from "../frontend/js/simulation/components.js";

// Mock Canvas for Workspace testing
class MockCanvas {
    getBoundingClientRect() {
        return { left: 10, top: 20 };
    }
    getContext() {
        return {}; // Mock context object
    }
}

function runTests() {
    console.log("Running wires & workspace tests...");

    // 1. Test computeManhattanRoute
    // Case A: target further right (2 bends / 4 points)
    const route1 = computeManhattanRoute(0, 0, 100, 50);
    assert.strictEqual(route1.length, 4);
    assert.deepStrictEqual(route1[0], { x: 0, y: 0 });
    assert.deepStrictEqual(route1[3], { x: 100, y: 50 });
    // Check that intermediate legs are orthogonal
    assert.strictEqual(route1[1].y, route1[0].y); // Horizontal segment
    assert.strictEqual(route1[2].x, route1[1].x); // Vertical segment

    // Case B: target close or left (4 bends / 6 points)
    const route2 = computeManhattanRoute(100, 50, 0, 100);
    assert.strictEqual(route2.length, 6);
    assert.deepStrictEqual(route2[0], { x: 100, y: 50 });
    assert.deepStrictEqual(route2[5], { x: 0, y: 100 });

    // 2. Test isPointNearWire
    const circuit = new Circuit();
    const g1 = createComponent("Input", "g1", 0, 0);
    const g2 = createComponent("Output", "g2", 100, 50);
    const wire = new Wire("w", g1.outputs[0], g2.inputs[0]);
    wire.points = computeManhattanRoute(25, 0, 75, 50); // From output pin to input pin

    // Wire path goes: (25, 0) -> (50, 0) -> (50, 50) -> (75, 50)
    // Point (30, 0) is on first horizontal segment
    assert.strictEqual(isPointNearWire(wire, 30, 0, 4), true);
    // Point (50, 25) is on middle vertical segment
    assert.strictEqual(isPointNearWire(wire, 50, 25, 4), true);
    // Point (100, 100) is far away
    assert.strictEqual(isPointNearWire(wire, 100, 100, 4), false);

    // 3. Test Workspace Coordinate Conversions
    const canvas = new MockCanvas();
    const workspace = new Workspace(canvas);

    // Default transform: scale = 1, offset = 0
    // Screen coordinates are shifted by bounding rect: left=10, top=20
    const worldCoord = workspace.screenToWorld(110, 220);
    assert.strictEqual(worldCoord.x, 100);
    assert.strictEqual(worldCoord.y, 200);

    const screenCoord = workspace.worldToScreen(100, 200);
    assert.strictEqual(screenCoord.x, 110);
    assert.strictEqual(screenCoord.y, 220);

    console.log("Wires & workspace tests passed successfully!");
}

runTests();
