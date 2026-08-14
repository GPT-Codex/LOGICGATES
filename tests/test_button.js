import { Circuit } from "../frontend/js/simulation/core.js";
import { ButtonGate } from "../frontend/js/simulation/components.js";
import { deserializeCircuit, serializeCircuit } from "../frontend/js/simulation/serialization.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { ClipboardManager } from "../frontend/js/canvas/interactions.js";

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assertion failed");
    }
}

console.log("Running Button Component unit tests...");

const circuit = new Circuit();
const button = new ButtonGate("btn1", 100, 100);
circuit.addComponent(button);

const engine = new SimulationEngine(circuit);
engine.evaluateAll();

// 1. Initially OFF, Output is 0
assert(button.outputs[0].value === 0, "Button should initially have inactive output");

// 2. Click in Press (Toggle) Mode with NO power
button.triggerClick(engine);
assert(button.toggleState === true, "Clicking should toggle state to true");
assert(button.outputs[0].value === 0, "Without input power, output must remain 0");

// 3. Supply input power
button.inputs[0].value = 1;
button.evaluate();
engine.propagatePin(button.outputs[0]);
engine.propagate();

assert(button.outputs[0].value === 1, "With power and toggle ON, output should be 1");

// 4. Click again (Toggle OFF)
button.triggerClick(engine);
assert(button.toggleState === false, "Clicking again should toggle state to false");
assert(button.outputs[0].value === 0, "Toggled OFF: output should be 0");

// 5. Momentary Hold Mode
button.buttonMode = "hold";

button.triggerClick(engine);
assert(button.isPressed === true, "Triggering hold should set isPressed = true");
assert(button.outputs[0].value === 1, "With power and hold active, output should be 1");

// Simulate releasing the mouse physically:
button.isPressed = false;
button.evaluate();
engine.propagatePin(button.outputs[0]);
engine.propagate();
assert(button.isPressed === false, "Releasing hold should set isPressed = false");
assert(button.outputs[0].value === 0, "Releasing hold: output should be 0");

// 6. Test Serialization
button.buttonMode = "press";
button.toggleState = true;
button.holdDuration = 500;

const serialized = serializeCircuit(circuit, null);
assert(serialized.components[0].buttonMode === "press", "Serialized buttonMode should be press");
assert(serialized.components[0].holdDuration === 500, "Serialized holdDuration should be 500");

const circuit2 = new Circuit();
deserializeCircuit(serialized, circuit2, null);
const loadedButton = circuit2.components.get("btn1");
assert(loadedButton !== undefined, "Loaded button should be deserialized");
assert(loadedButton.buttonMode === "press", "Loaded buttonMode should match");
assert(loadedButton.holdDuration === 500, "Loaded holdDuration should match");

// 7. Clipboard preserve
const clipboard = new ClipboardManager();
const selected = new Set([loadedButton]);
clipboard.copy(selected, new Set(), circuit2.wires.values());

const circuit3 = new Circuit();
const pasted = clipboard.paste(circuit3, { snap: (x) => x });
assert(pasted.length === 1, "Pasted components count should be 1");
assert(pasted[0].buttonMode === "press", "Pasted button should preserve buttonMode");
assert(pasted[0].holdDuration === 500, "Pasted button should preserve holdDuration");

console.log("Button Component unit tests passed successfully!");
