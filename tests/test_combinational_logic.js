import { Circuit } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { DecoderGate, PriorityEncoderGate, ComparatorGate, COMPONENT_REGISTRY } from "../frontend/js/simulation/components.js";
import { serializeCircuit, deserializeCircuit } from "../frontend/js/simulation/serialization.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { ModuleRegistry } from "../frontend/js/simulation/modules.js";

console.log("Running Combinational Logic Unit Test Suite...");

// 1. DecoderGate Unit Tests
(function testDecoder() {
    const circuit = new Circuit();
    const dec = new DecoderGate("DEC1", 100, 100, 2); // 2-to-4 decoder
    circuit.addComponent(dec);
    const engine = new SimulationEngine(circuit);

    // Initial state (A=0, B=0, EN=1)
    engine.evaluateAll();
    const y0 = dec.outputs.find(p => p.name === "Y0");
    const y1 = dec.outputs.find(p => p.name === "Y1");
    const y2 = dec.outputs.find(p => p.name === "Y2");
    const y3 = dec.outputs.find(p => p.name === "Y3");

    console.assert(y0.value === 1, "Decoder Y0 should be 1 for address 0");
    console.assert(y1.value === 0, "Decoder Y1 should be 0 for address 0");
    console.assert(y2.value === 0, "Decoder Y2 should be 0 for address 0");
    console.assert(y3.value === 0, "Decoder Y3 should be 0 for address 0");

    // Address = 3 (A=1, B=1)
    const pinA = dec.inputs.find(p => p.name === "A");
    const pinB = dec.inputs.find(p => p.name === "B");
    pinA.value = 1;
    pinB.value = 1;
    engine.evaluateAll();

    console.assert(y0.value === 0, "Decoder Y0 should be 0 for address 3");
    console.assert(y3.value === 1, "Decoder Y3 should be 1 for address 3");

    // Disable (EN = 0)
    const en = dec.inputs.find(p => p.name === "EN");
    en.value = 0;
    engine.evaluateAll();
    console.assert(y3.value === 0, "Decoder Y3 should be 0 when EN=0");
    console.assert(y0.value === 0, "Decoder Y0 should be 0 when EN=0");

    console.log("  ✓ DecoderGate evaluation and EN control passed");
})();

// 2. PriorityEncoderGate Unit Tests
(function testPriorityEncoder() {
    const circuit = new Circuit();
    const enc = new PriorityEncoderGate("ENC1", 100, 100, 4); // 4-to-2 encoder
    circuit.addComponent(enc);
    const engine = new SimulationEngine(circuit);

    // Initial state: no inputs active
    engine.evaluateAll();
    const valid = enc.outputs.find(p => p.name === "VALID");
    const outA = enc.outputs.find(p => p.name === "A");
    const outB = enc.outputs.find(p => p.name === "B");

    console.assert(valid.value === 0, "PriorityEncoder VALID should be 0 when inactive");
    console.assert(outA.value === 0, "PriorityEncoder A should be 0 when inactive");
    console.assert(outB.value === 0, "PriorityEncoder B should be 0 when inactive");

    // Activate I1 (index 1 -> A=1, B=0)
    const i1 = enc.inputs.find(p => p.name === "I1");
    i1.value = 1;
    engine.evaluateAll();

    console.assert(valid.value === 1, "PriorityEncoder VALID should be 1");
    console.assert(outA.value === 1, "PriorityEncoder A should be 1 for I1");
    console.assert(outB.value === 0, "PriorityEncoder B should be 0 for I1");

    // Activate I3 (highest index 3 -> A=1, B=1 overriding I1)
    const i3 = enc.inputs.find(p => p.name === "I3");
    i3.value = 1;
    engine.evaluateAll();

    console.assert(outA.value === 1, "PriorityEncoder A should be 1 for I3");
    console.assert(outB.value === 1, "PriorityEncoder B should be 1 for I3");

    console.log("  ✓ PriorityEncoderGate evaluation and priority resolution passed");
})();

// 3. ComparatorGate Unit Tests
(function testComparator() {
    const circuit = new Circuit();
    const comp = new ComparatorGate("CMP1", 100, 100, 4); // 4-bit comparator
    circuit.addComponent(comp);
    const engine = new SimulationEngine(circuit);

    // Initial state: A=0, B=0 -> EQ=1, GT=0, LT=0
    engine.evaluateAll();
    const eq = comp.outputs.find(p => p.name === "EQ");
    const gt = comp.outputs.find(p => p.name === "GT");
    const lt = comp.outputs.find(p => p.name === "LT");

    console.assert(eq.value === 1, "Comparator EQ should be 1 when A==B");
    console.assert(gt.value === 0, "Comparator GT should be 0 when A==B");
    console.assert(lt.value === 0, "Comparator LT should be 0 when A==B");

    // A = 5 (0101), B = 3 (0011) -> A > B -> GT=1, EQ=0, LT=0
    comp.inputs.find(p => p.name === "A[0]").value = 1;
    comp.inputs.find(p => p.name === "A[1]").value = 0;
    comp.inputs.find(p => p.name === "A[2]").value = 1;
    comp.inputs.find(p => p.name === "A[3]").value = 0;

    comp.inputs.find(p => p.name === "B[0]").value = 1;
    comp.inputs.find(p => p.name === "B[1]").value = 1;
    comp.inputs.find(p => p.name === "B[2]").value = 0;
    comp.inputs.find(p => p.name === "B[3]").value = 0;

    engine.evaluateAll();

    console.assert(eq.value === 0, "Comparator EQ should be 0 when A > B");
    console.assert(gt.value === 1, "Comparator GT should be 1 when A > B");
    console.assert(lt.value === 0, "Comparator LT should be 0 when A > B");

    // A = 5, B = 9 (1001) -> A < B -> LT=1, GT=0, EQ=0
    comp.inputs.find(p => p.name === "B[3]").value = 1; // B = 9
    engine.evaluateAll();

    console.assert(eq.value === 0, "Comparator EQ should be 0 when A < B");
    console.assert(gt.value === 0, "Comparator GT should be 0 when A < B");
    console.assert(lt.value === 1, "Comparator LT should be 1 when A < B");

    console.log("  ✓ ComparatorGate evaluation (EQ, GT, LT) passed");
})();

// 4. Scripting and Serialization Tests
(async function testScriptAndSerialization() {
    const circuit = new Circuit();
    const registry = new ModuleRegistry();
    const engine = new SimulationEngine(circuit);
    const cmdEngine = new CommandEngine(circuit, registry, null, engine);

    const script = `
        add DECODER(3) DEC
        add PRIORITY_ENCODER(8) PE
        add COMPARATOR(8) CMP
    `;

    const res = await cmdEngine.executeScript(script);
    console.assert(res.success === true, `Script execution failed: ${res.error}`);

    console.assert(circuit.components.has("DEC"), "DEC component should exist");
    console.assert(circuit.components.has("PE"), "PE component should exist");
    console.assert(circuit.components.has("CMP"), "CMP component should exist");

    // Serialization roundtrip
    const serialized = serializeCircuit(circuit, registry);
    const newCircuit = new Circuit();
    deserializeCircuit(serialized, newCircuit, registry);

    console.assert(newCircuit.components.has("DEC"), "DEC component should exist in deserialized circuit");
    console.assert(newCircuit.components.get("DEC").widthBits === 3, "DEC bits parameter preserved");
    console.assert(newCircuit.components.get("PE").numInputs === 8, "PE numInputs parameter preserved");
    console.assert(newCircuit.components.get("CMP").widthBits === 8, "CMP width parameter preserved");

    console.log("  ✓ Script creation and serialization roundtrip passed");
})();

console.log("All Combinational Logic unit tests passed successfully!");
