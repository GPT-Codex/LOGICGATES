import { ClockGate } from "../frontend/js/simulation/components.js";
import { deserializeCircuit, serializeCircuit } from "../frontend/js/simulation/serialization.js";
import { Circuit } from "../frontend/js/simulation/core.js";

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || "Assertion failed");
    }
}

console.log("Running Clock Frequency & Backward Compatibility tests...");

// 1. Basic properties
const clock = new ClockGate("clock_1", 100, 100);
assert(clock.frequencyValue === 1, "Default frequency value should be 1");
assert(clock.frequencyUnit === "Hz", "Default frequency unit should be Hz");
assert(clock.frequency === 1, "Calculated frequency should be 1 Hz");

// 2. Unit conversions
clock.frequencyValue = 2.5;
clock.frequencyUnit = "kHz";
clock.updateFrequency();
assert(clock.frequency === 2500, "2.5 kHz should convert to 2500 Hz");

clock.frequencyValue = 5;
clock.frequencyUnit = "MHz";
clock.updateFrequency();
assert(clock.frequency === 5000000, "5 MHz should convert to 5,000,000 Hz");

// 3. 10 GHz limit cap
clock.frequencyValue = 12;
clock.frequencyUnit = "GHz";
clock.updateFrequency();
assert(clock.frequency === 10e9, "12 GHz should be capped to 10 GHz");
assert(clock.frequencyUnit === "GHz", "Unit should stay GHz");
assert(clock.frequencyValue === 10, "Value should be capped to 10");

// 4. Backward Compatibility Deserialization
const oldProjectJSON = {
    components: [
        {
            id: "clock_old",
            type: "Clock",
            x: 50,
            y: 50,
            intervalMs: 250 // 250 ms toggle delay -> period = 500 ms -> 2 Hz
        }
    ],
    wires: []
};

const circuit = new Circuit();
deserializeCircuit(oldProjectJSON, circuit, null);
const loadedClock = circuit.components.get("clock_old");
assert(loadedClock !== undefined, "Old clock should be deserialized");
assert(loadedClock.frequency === 2, "250ms toggle should translate to 2 Hz");
assert(loadedClock.frequencyValue === 2, "frequencyValue should be 2");
assert(loadedClock.frequencyUnit === "Hz", "frequencyUnit should default to Hz");

console.log("Clock Frequency & Backward Compatibility tests passed successfully!");
