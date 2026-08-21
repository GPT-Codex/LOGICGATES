import { Circuit } from "../frontend/js/simulation/core.js";
import { BufferGate } from "../frontend/js/simulation/components.js";
import { deserializeCircuit, serializeCircuit } from "../frontend/js/simulation/serialization.js";
import { ClipboardManager } from "../frontend/js/canvas/interactions.js";

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assertion failed");
    }
}

console.log("Running Component Flipping & Clipboard preservation tests...");

const circuit = new Circuit();
const gate = new BufferGate("g1", 100, 100); // Input relX = -25, Output relX = 25
circuit.addComponent(gate);

// Test default pin absolute coordinates (unflipped)
const inputPin = gate.inputs[0];
const outputPin = gate.outputs[0];

const posInputInitial = gate.getPinAbsolutePosition(inputPin);
const posOutputInitial = gate.getPinAbsolutePosition(outputPin);

assert(posInputInitial.x === 75, "Default input pin absolute X should be 75");
assert(posOutputInitial.x === 125, "Default output pin absolute X should be 125");

// Test horizontal flip (flipX)
gate.flipX = true;
const posInputFlippedX = gate.getPinAbsolutePosition(inputPin);
const posOutputFlippedX = gate.getPinAbsolutePosition(outputPin);

assert(posInputFlippedX.x === 125, "FlippedX input pin absolute X should be 125");
assert(posOutputFlippedX.x === 75, "FlippedX output pin absolute X should be 75");

// Test serialization & deserialization of flipping states
const serialized = serializeCircuit(circuit, null);
assert(serialized.components[0].flipX === true, "Serialized flipX should be true");
assert(serialized.components[0].flipY === false, "Serialized flipY should be false");

const circuit2 = new Circuit();
deserializeCircuit(serialized, circuit2, null);
const loadedGate = circuit2.components.get("g1");
assert(loadedGate !== undefined, "Flipped gate should be deserialized");
assert(loadedGate.flipX === true, "Loaded gate flipX should be true");
assert(loadedGate.flipY === false, "Loaded gate flipY should be false");

// Test Clipboard copy/paste preservation
const clipboard = new ClipboardManager();
const selectedComponents = new Set([loadedGate]);
clipboard.copy(selectedComponents, new Set(), circuit2.wires.values());

const circuit3 = new Circuit();
const pasted = clipboard.paste(circuit3, { snap: (x) => x });
assert(pasted.length === 1, "Pasted should have 1 component");
assert(pasted[0].flipX === true, "Pasted component should preserve flipX = true");
assert(pasted[0].flipY === false, "Pasted component should preserve flipY = false");

console.log("Component Flipping & Clipboard preservation tests passed successfully!");
