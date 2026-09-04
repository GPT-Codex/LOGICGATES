import assert from "assert";
import { Circuit, Wire } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { MUXGate, InputGate, OutputGate } from "../frontend/js/simulation/components.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { ModuleRegistry } from "../frontend/js/simulation/modules.js";
import { getCompletions, ensureLibraryCached } from "../frontend/js/ui/autocomplete.js";
import { APP_VERSION, RELEASE_NOTES, isNewVersionAvailable } from "../frontend/js/ui/whats_new.js";
import { serializeCircuit, deserializeCircuit } from "../frontend/js/simulation/serialization.js";

async function runMuxAndWhatsNewTests() {
    console.log("Running MUX & What's New System Unit Test Suite...");

    // 1. What's New Version System
    {
        assert.ok(APP_VERSION, "APP_VERSION must be defined");
        assert.strictEqual(APP_VERSION, "v0.19.0");
        assert.ok(Array.isArray(RELEASE_NOTES) && RELEASE_NOTES.length > 0);
        assert.strictEqual(RELEASE_NOTES[0].version, "v0.19.0");
        assert.ok(RELEASE_NOTES[0].isCurrent);
        console.log("  ✓ What's New version system metadata passed");
    }

    // 2. Imported Module Autocomplete (Unqualified, Aliased, Parameters)
    {
        await ensureLibraryCached("arithmetic");
        await ensureLibraryCached("logic");

        // Unqualified import
        const script1 = `import "arithmetic"\nadd R`;
        const res1 = getCompletions(script1, script1.length, {});
        assert.ok(res1.suggestions.some(s => s.name === "RCA"), "Unqualified import 'arithmetic' must suggest RCA");

        // Aliased import prefix
        const script2 = `import "arithmetic" as operations\nadd operations.`;
        const res2 = getCompletions(script2, script2.length, {});
        assert.ok(res2.suggestions.some(s => s.name === "RCA"), "Aliased import 'operations.' must suggest RCA");
        assert.ok(res2.suggestions.some(s => s.name === "FADDER"), "Aliased import 'operations.' must suggest FADDER");

        // Parameter hints
        const script3 = `import "arithmetic" as operations\nadd operations.RCA(`;
        const res3 = getCompletions(script3, script3.length, {});
        assert.ok(res3.suggestions.some(s => s.name === "width="), "Aliased parameterized module 'operations.RCA(' must suggest width=");

        console.log("  ✓ Imported module autocomplete (unqualified, aliased, parameters) passed");
    }

    // 3. 2:1 Multiplexer (MUXGate) Truth Table
    {
        const circuit = new Circuit();
        const mux = new MUXGate("M1", 0, 0);
        const inA = new InputGate("A", 0, 0);
        const inB = new InputGate("B", 0, 0);
        const inSEL = new InputGate("SEL", 0, 0);
        const outY = new OutputGate("Y", 0, 0);

        circuit.addComponent(mux);
        circuit.addComponent(inA);
        circuit.addComponent(inB);
        circuit.addComponent(inSEL);
        circuit.addComponent(outY);

        circuit.addWire(new Wire("wA", inA.outputs[0], mux.inputs[0]));
        circuit.addWire(new Wire("wB", inB.outputs[0], mux.inputs[1]));
        circuit.addWire(new Wire("wSEL", inSEL.outputs[0], mux.inputs[2]));
        circuit.addWire(new Wire("wY", mux.outputs[0], outY.inputs[0]));

        const engine = new SimulationEngine(circuit);
        engine.evaluateAll();

        // SEL = 0 -> Y = A
        inA.stateValue = 1; inB.stateValue = 0; inSEL.stateValue = 0;
        engine.triggerInputToggle(inA);
        assert.strictEqual(mux.outputs[0].value, 1, "SEL=0: Y must equal A (1)");

        inA.stateValue = 0;
        engine.triggerInputToggle(inA);
        inB.stateValue = 1;
        engine.triggerInputToggle(inB);
        assert.strictEqual(mux.outputs[0].value, 0, "SEL=0: Y must equal A (0) even when B=1");

        // SEL = 1 -> Y = B
        inSEL.stateValue = 1;
        engine.triggerInputToggle(inSEL);
        assert.strictEqual(mux.outputs[0].value, 1, "SEL=1: Y must equal B (1)");

        inA.stateValue = 1; inB.stateValue = 0; inSEL.stateValue = 1;
        engine.triggerInputToggle(inB);
        assert.strictEqual(mux.outputs[0].value, 0, "SEL=1: Y must equal B (0) even when A=1");

        console.log("  ✓ 2:1 Multiplexer (MUXGate) truth table evaluation passed");
    }

    // 4. MUX Serialization & Script Execution
    {
        const circuit = new Circuit();
        const registry = new ModuleRegistry();
        const engine = new CommandEngine(circuit, registry);

        const script = `
            add input A
            add input B
            add input SEL
            add mux M1
            add output Y

            connect A -> M1.A
            connect B -> M1.B
            connect SEL -> M1.SEL
            connect M1.Y -> Y
        `;

        const res = await engine.executeScript(script);
        assert.ok(res.success, `Script execution failed: ${res.error}`);

        const m1 = circuit.components.get("M1");
        assert.ok(m1);
        assert.strictEqual(m1.type, "MUX");

        const serialized = serializeCircuit(circuit, registry);
        const newCircuit = new Circuit();
        deserializeCircuit(serialized, newCircuit, registry);

        const restoredM1 = newCircuit.components.get("M1");
        assert.ok(restoredM1);
        assert.strictEqual(restoredM1.type, "MUX");

        console.log("  ✓ MUX script creation & serialization passed");
    }

    console.log("All MUX & What's New System unit tests passed successfully!");
}

runMuxAndWhatsNewTests().catch(err => {
    console.error("Test Failure:", err);
    process.exit(1);
});
