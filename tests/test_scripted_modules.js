import assert from "assert";
import { Circuit, Wire, Bus } from "../frontend/js/simulation/core.js";
import { ModuleRegistry, ModuleDefinition, UserModule } from "../frontend/js/simulation/modules.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { serializeCircuit, deserializeCircuit } from "../frontend/js/simulation/serialization.js";

console.log("Running Scripted Modules Unit Test Suite...");

// Test Setup Helper
function createTestSetup() {
    const circuit = new Circuit();
    const registry = new ModuleRegistry();
    const engine = new SimulationEngine(circuit);
    const cmdEngine = new CommandEngine(circuit, registry, null, engine);
    return { circuit, registry, engine, cmdEngine };
}

// 1. Defining a simple module
{
    const { registry, cmdEngine } = createTestSetup();
    const script = `
        module HalfAdder {
            input A
            input B
            output S
            output C

            expr S = A XOR B
            expr C = A AND B
        }
    `;
    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);

    const def = registry.get("mod_halfadder");
    assert.ok(def, "HalfAdder module should be registered");
    assert.strictEqual(def.name, "HalfAdder");
    assert.deepStrictEqual(def.inputs, ["A", "B"]);
    assert.deepStrictEqual(def.outputs, ["S", "C"]);
    console.log("  ✓ Simple module definition passed");
}

// 2. Defining a module with multiple inputs/outputs
{
    const { registry, cmdEngine } = createTestSetup();
    const script = `
        module FullAdder {
            input A
            input B
            input Cin

            output S
            output Cout

            expr S = (A XOR B) XOR Cin
            expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
        }
    `;
    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);

    const def = registry.get("mod_fulladder");
    assert.ok(def);
    assert.deepStrictEqual(def.inputs, ["A", "B", "Cin"]);
    assert.deepStrictEqual(def.outputs, ["S", "Cout"]);
    console.log("  ✓ Multi-input/output module definition passed");
}

// 3. Instantiating a module and connecting pins
{
    const { circuit, cmdEngine } = createTestSetup();
    const script = `
        module FullAdder {
            input A
            input B
            input Cin
            output S
            output Cout

            expr S = (A XOR B) XOR Cin
            expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
        }

        add input InA
        add input InB
        add input InCin
        add FullAdder FA0
        add output OutS
        add output OutCout

        connect InA FA0.A
        connect InB FA0.B
        connect InCin FA0.Cin
        connect FA0.S OutS
        connect FA0.Cout OutCout
    `;
    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);

    const faComp = circuit.components.get("FA0");
    assert.ok(faComp);
    assert.strictEqual(faComp.type, "UserModule");
    assert.strictEqual(faComp.inputs.length, 3);
    assert.strictEqual(faComp.outputs.length, 2);
    console.log("  ✓ Module instantiation and wiring passed");
}

// 4. Moving and flipping module instances
{
    const { circuit, cmdEngine } = createTestSetup();
    const script = `
        module HalfAdder {
            input A
            input B
            output S
            output C

            expr S = A XOR B
            expr C = A AND B
        }

        add HalfAdder HA0
        move HA0 to (300, 400)
        set HA0.flipX true
        set HA0.flipY true
    `;
    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);

    const ha = circuit.components.get("HA0");
    assert.strictEqual(ha.x, 300);
    assert.strictEqual(ha.y, 400);
    assert.strictEqual(ha.flipX, true);
    assert.strictEqual(ha.flipY, true);

    // Verify logical pin identity is unaffected by flipping
    const pinA = ha.inputs.find(p => p.name === "A");
    assert.ok(pinA, "Pin A should exist regardless of flip state");
    console.log("  ✓ Moving and flipping module instances passed");
}

// 5. Vector bus ports and loops inside modules
{
    const { registry, cmdEngine } = createTestSetup();
    const script = `
        module Buffer8 {
            input A[0..7]
            output O[0..7]

            for i in 0..7 {
                expr O[i] = A[i]
            }
        }
    `;
    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);

    const def = registry.get("mod_buffer8");
    assert.ok(def);
    assert.strictEqual(def.inputs.length, 8);
    assert.strictEqual(def.outputs.length, 8);
    assert.strictEqual(def.inputs[0], "A[0]");
    assert.strictEqual(def.inputs[7], "A[7]");
    console.log("  ✓ Vector bus ports and loops inside modules passed");
}

// 6. Invalid module syntax & line reporting
{
    const { cmdEngine } = createTestSetup();
    const script = `
        # Line 2
        module BrokenModule {
            input A
            output S
            connect NON_EXISTENT.out S
        }
    `;
    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("BrokenModule"));
    assert.ok(res.error.includes("Line 3") || res.error.includes("Line 6"));
    console.log("  ✓ Invalid module syntax and error reporting passed");
}

// 7. Missing output driver validation
{
    const { cmdEngine } = createTestSetup();
    const script = `
        module UndrivenOutput {
            input A
            output S
            add xor X1
        }
    `;
    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("has no driver"));
    console.log("  ✓ Missing output driver rejection passed");
}

// 8. Rejection of direct and indirect recursive modules
{
    const { cmdEngine } = createTestSetup();

    // Direct recursion
    const directScript = `
        module RecursiveA {
            input A
            output S
            add RecursiveA R1
        }
    `;
    const resDirect = cmdEngine.executeScript(directScript);
    assert.strictEqual(resDirect.success, false);
    assert.ok(resDirect.error.includes("recursively"));

    // Indirect recursion
    const indirectScript = `
        module ModB {
            input A
            output S
            expr S = A
        }

        module ModA {
            input A
            output S
            add ModB B1
            connect A B1.A
            connect B1.S S
        }

        module ModB {
            input A
            output S
            add ModA A1
            connect A A1.A
            connect A1.S S
        }
    `;
    const resIndirect = cmdEngine.executeScript(indirectScript);
    assert.strictEqual(resIndirect.success, false);
    assert.ok(resIndirect.error.includes("Recursive module dependency"));
    console.log("  ✓ Direct and indirect recursive module rejection passed");
}

// 9. Transaction rollback on compilation failure
{
    const { circuit, registry, cmdEngine } = createTestSetup();
    cmdEngine.execute("add input PreExistingInput");

    const failedScript = `
        add input AddedInScript
        module FailingMod {
            input A
            output S
            connect INVALID.out S
        }
    `;
    const res = cmdEngine.executeScript(failedScript);
    assert.strictEqual(res.success, false);

    // Verify workspace was completely rolled back
    assert.strictEqual(circuit.components.has("AddedInScript"), false, "AddedInScript should be rolled back");
    assert.strictEqual(circuit.components.has("PreExistingInput"), true, "PreExistingInput should be preserved");
    assert.strictEqual(registry.definitions.size, 0, "No partial module should remain in registry");
    console.log("  ✓ Transaction rollback on compilation failure passed");
}

// 10. Electrical simulation of Full Adder
{
    const { circuit, engine, cmdEngine } = createTestSetup();
    const script = `
        module FullAdder {
            input A
            input B
            input Cin
            output S
            output Cout

            expr S = (A XOR B) XOR Cin
            expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
        }

        add input A
        add input B
        add input Cin
        add FullAdder FA
        add output S
        add output Cout

        connect A FA.A
        connect B FA.B
        connect Cin FA.Cin
        connect FA.S S
        connect FA.Cout Cout
    `;
    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);

    const compA = circuit.components.get("A");
    const compB = circuit.components.get("B");
    const compCin = circuit.components.get("Cin");
    const compS = circuit.components.get("S");
    const compCout = circuit.components.get("Cout");

    const truthTable = [
        // A, B, Cin -> S, Cout
        [0, 0, 0, 0, 0],
        [1, 0, 0, 1, 0],
        [0, 1, 0, 1, 0],
        [1, 1, 0, 0, 1],
        [0, 0, 1, 1, 0],
        [1, 0, 1, 0, 1],
        [0, 1, 1, 0, 1],
        [1, 1, 1, 1, 1]
    ];

    for (const [inA, inB, inCin, expectedS, expectedCout] of truthTable) {
        compA.stateValue = inA;
        compB.stateValue = inB;
        compCin.stateValue = inCin;

        engine.triggerInputToggle(compA);
        engine.triggerInputToggle(compB);
        engine.triggerInputToggle(compCin);

        const actualS = compS.inputs[0].value;
        const actualCout = compCout.inputs[0].value;

        assert.strictEqual(actualS, expectedS, `FA S for A=${inA}, B=${inB}, Cin=${inCin} expected ${expectedS}, got ${actualS}`);
        assert.strictEqual(actualCout, expectedCout, `FA Cout for A=${inA}, B=${inB}, Cin=${inCin} expected ${expectedCout}, got ${actualCout}`);
    }
    console.log("  ✓ Full Adder electrical truth table simulation passed (8/8 cases)");
}

// 11. 4-bit Ripple-Carry Adder with multiple module instances and electrical evaluation
{
    const { circuit, engine, cmdEngine } = createTestSetup();
    const script = `
        module FullAdder {
            input A
            input B
            input Cin
            output S
            output Cout

            expr S = (A XOR B) XOR Cin
            expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
        }

        add input Cin

        for i in 0..3 {
            add input A[i]
            add input B[i]
            add FullAdder FA[i]
            add output S[i]

            connect A[i] FA[i].A
            connect B[i] FA[i].B
            connect FA[i].S S[i]
        }

        add output Cout

        connect Cin FA[0].Cin
        for i in 1..3 {
            connect FA[i - 1].Cout FA[i].Cin
        }
        connect FA[3].Cout Cout
    `;
    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);

    // Test addition: 9 + 5 + 1 (Cin) = 15 -> S = 1111 (15), Cout = 0
    // A = 9 (1001_2 -> A[0]=1, A[1]=0, A[2]=0, A[3]=1)
    // B = 5 (0101_2 -> B[0]=1, B[1]=0, B[2]=1, B[3]=0)
    // Cin = 1
    circuit.components.get("Cin").stateValue = 1;
    engine.triggerInputToggle(circuit.components.get("Cin"));

    const valA = 9;
    const valB = 5;
    for (let i = 0; i < 4; i++) {
        const bitA = (valA >> i) & 1;
        const bitB = (valB >> i) & 1;

        const gateA = circuit.components.get(`A[${i}]`);
        const gateB = circuit.components.get(`B[${i}]`);

        gateA.stateValue = bitA;
        gateB.stateValue = bitB;

        engine.triggerInputToggle(gateA);
        engine.triggerInputToggle(gateB);
    }

    let sumVal = 0;
    for (let i = 0; i < 4; i++) {
        const bitS = circuit.components.get(`S[${i}]`).inputs[0].value;
        sumVal |= (bitS << i);
    }
    const coutVal = circuit.components.get("Cout").inputs[0].value;

    assert.strictEqual(sumVal, 15, `Expected Sum 15, got ${sumVal}`);
    assert.strictEqual(coutVal, 0, `Expected Cout 0, got ${coutVal}`);
    console.log("  ✓ 4-bit Ripple-Carry Adder electrical evaluation passed (9 + 5 + 1 = 15)");
}

// 12. Save/Load and .sim export/import roundtrip
{
    const setup1 = createTestSetup();
    const script = `
        module HalfAdder {
            input A
            input B
            output S
            output C

            expr S = A XOR B
            expr C = A AND B
        }

        add input InA
        add input InB
        add HalfAdder HA0
        add output OutS
        add output OutC

        connect InA HA0.A
        connect InB HA0.B
        connect HA0.S OutS
        connect HA0.C OutC
    `;
    setup1.cmdEngine.executeScript(script);

    // Export .sim script from setup1
    const exportedScript = setup1.cmdEngine.exportScript();
    assert.ok(exportedScript.includes("module HalfAdder {"));
    assert.ok(exportedScript.includes("add HalfAdder HA0"));

    // Import into fresh setup2
    const setup2 = createTestSetup();
    const importRes = setup2.cmdEngine.executeScript(exportedScript);
    assert.strictEqual(importRes.success, true, importRes.error);

    assert.ok(setup2.registry.get("mod_halfadder"));
    assert.ok(setup2.circuit.components.get("HA0"));

    // Verify electrical equivalence in setup2
    const compA = setup2.circuit.components.get("InA");
    const compB = setup2.circuit.components.get("InB");
    const compS = setup2.circuit.components.get("OutS");
    const compC = setup2.circuit.components.get("OutC");

    compA.stateValue = 1;
    compB.stateValue = 1;
    setup2.engine.triggerInputToggle(compA);
    setup2.engine.triggerInputToggle(compB);

    assert.strictEqual(compS.inputs[0].value, 0);
    assert.strictEqual(compC.inputs[0].value, 1);
    console.log("  ✓ Save/Load and .sim export/import roundtrip passed");
}

// 13. Module introspection via `show module`
{
    const { cmdEngine } = createTestSetup();
    const script = `
        module FullAdder {
            input A
            input B
            input Cin
            output S
            output Cout

            expr S = (A XOR B) XOR Cin
            expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
        }
    `;
    cmdEngine.executeScript(script);

    const showRes = cmdEngine.execute("show module FullAdder");
    assert.strictEqual(showRes.success, true);
    assert.ok(showRes.data.includes("Module: FullAdder"));
    assert.ok(showRes.data.includes("Inputs:"));
    assert.ok(showRes.data.includes("Outputs:"));
    console.log("  ✓ Module introspection via `show module` passed");
}

// 14. Hierarchical Modules (2-level & 3-level) and Out-of-Order Compilation
{
    const { registry, cmdEngine } = createTestSetup();
    // ADDER4 appears BEFORE FADDER in text order to test topological sort
    const script = `
        module ADDER4 {
            input A[0..3]
            input B[0..3]
            input Cin

            output S[0..3]
            output Cout

            add FADDER FA0
            add FADDER FA1
            add FADDER FA2
            add FADDER FA3

            connect A[0] -> FA0.A
            connect B[0] -> FA0.B
            connect Cin -> FA0.Cin
            connect FA0.S -> S[0]
            connect FA0.Cout -> FA1.Cin

            connect A[1] -> FA1.A
            connect B[1] -> FA1.B
            connect FA1.S -> S[1]
            connect FA1.Cout -> FA2.Cin

            connect A[2] -> FA2.A
            connect B[2] -> FA2.B
            connect FA2.S -> S[2]
            connect FA2.Cout -> FA3.Cin

            connect A[3] -> FA3.A
            connect B[3] -> FA3.B
            connect FA3.S -> S[3]
            connect FA3.Cout -> Cout
        }

        module FADDER {
            input A
            input B
            input Cin

            output S
            output Cout

            expr S = A XOR B XOR Cin
            expr Cout = (A AND B) OR (Cin AND (A XOR B))
        }

        module MATH_UNIT {
            input A[0..3]
            input B[0..3]
            input Cin
            output S[0..3]
            output Cout

            add ADDER4 ADD0
            connect A -> ADD0.A
            connect B -> ADD0.B
            connect Cin -> ADD0.Cin
            connect ADD0.S -> S
            connect ADD0.Cout -> Cout
        }
    `;

    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);

    assert.ok(registry.get("mod_fadder"));
    assert.ok(registry.get("mod_adder4"));
    assert.ok(registry.get("mod_math_unit"));

    const adder4Def = registry.get("mod_adder4");
    assert.ok(adder4Def.dependencies.includes("FADDER"));
    console.log("  ✓ Hierarchical modules (2-level & 3-level) out-of-order compilation passed");
}

// 15. Complete 512-case Electrical Truth Table Verification for ADDER4 (Nested FADDERs)
{
    const { circuit, engine, cmdEngine } = createTestSetup();
    const script = `
        module FADDER {
            input A
            input B
            input Cin

            output S
            output Cout

            expr S = A XOR B XOR Cin
            expr Cout = (A AND B) OR (Cin AND (A XOR B))
        }

        module ADDER4 {
            input A[0..3]
            input B[0..3]
            input Cin

            output S[0..3]
            output Cout

            add FADDER FA0
            add FADDER FA1
            add FADDER FA2
            add FADDER FA3

            connect A[0] -> FA0.A
            connect B[0] -> FA0.B
            connect Cin -> FA0.Cin
            connect FA0.S -> S[0]
            connect FA0.Cout -> FA1.Cin

            connect A[1] -> FA1.A
            connect B[1] -> FA1.B
            connect FA1.S -> S[1]
            connect FA1.Cout -> FA2.Cin

            connect A[2] -> FA2.A
            connect B[2] -> FA2.B
            connect FA2.S -> S[2]
            connect FA2.Cout -> FA3.Cin

            connect A[3] -> FA3.A
            connect B[3] -> FA3.B
            connect FA3.S -> S[3]
            connect FA3.Cout -> Cout
        }

        add input Cin
        add ADDER4 ADD0
        add output Cout

        connect Cin -> ADD0.Cin
        connect ADD0.Cout -> Cout

        for i in 0..3 {
            add input A[i]
            add input B[i]
            add output S[i]

            connect A[i] -> ADD0.A[i]
            connect B[i] -> ADD0.B[i]
            connect ADD0.S[i] -> S[i]
        }
    `;

    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);

    let testCasesPassed = 0;
    const cinComp = circuit.components.get("Cin");
    const coutComp = circuit.components.get("Cout");

    for (let cVal = 0; cVal <= 1; cVal++) {
        cinComp.stateValue = cVal;
        engine.triggerInputToggle(cinComp);

        for (let aVal = 0; aVal < 16; aVal++) {
            for (let bVal = 0; bVal < 16; bVal++) {
                for (let i = 0; i < 4; i++) {
                    const gA = circuit.components.get(`A[${i}]`);
                    const gB = circuit.components.get(`B[${i}]`);

                    gA.stateValue = (aVal >> i) & 1;
                    gB.stateValue = (bVal >> i) & 1;

                    engine.triggerInputToggle(gA);
                    engine.triggerInputToggle(gB);
                }

                let sumBits = 0;
                for (let i = 0; i < 4; i++) {
                    const bit = circuit.components.get(`S[${i}]`).inputs[0].value;
                    sumBits |= (bit << i);
                }
                const actualCout = coutComp.inputs[0].value;

                const expectedTotal = aVal + bVal + cVal;
                const actualTotal = sumBits + (actualCout << 4);

                assert.strictEqual(actualTotal, expectedTotal, `ADDER4 failure for A=${aVal}, B=${bVal}, Cin=${cVal}: expected ${expectedTotal}, got ${actualTotal}`);
                testCasesPassed++;
            }
        }
    }

    assert.strictEqual(testCasesPassed, 512);
    console.log("  ✓ Complete 512-case Electrical Truth Table for ADDER4 (Nested FADDERs) passed (512/512)");
}

// 16. Inspection, Tracing & Expansion Commands (`show`, `trace`, `expand`)
{
    const { cmdEngine } = createTestSetup();
    const script = `
        module FADDER {
            input A
            input B
            input Cin
            output S
            output Cout

            expr S = A XOR B XOR Cin
            expr Cout = (A AND B) OR (Cin AND (A XOR B))
        }

        module ADDER4 {
            input A[0..3]
            input B[0..3]
            input Cin
            output S[0..3]
            output Cout

            for i in 0..3 {
                add FADDER FA[i]
                connect A[i] -> FA[i].A
                connect B[i] -> FA[i].B
                connect FA[i].S -> S[i]
            }

            connect Cin -> FA[0].Cin
            connect FA[0].Cout -> FA[1].Cin
            connect FA[1].Cout -> FA[2].Cin
            connect FA[2].Cout -> FA[3].Cin
            connect FA[3].Cout -> Cout
        }

        add input Cin
        add ADDER4 ADD0
        connect Cin -> ADD0.Cin
    `;

    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);

    // 1. show module ADDER4
    const showModRes = cmdEngine.execute("show module ADDER4");
    assert.strictEqual(showModRes.success, true);
    assert.ok(showModRes.data.includes("Module: ADDER4"));
    assert.ok(showModRes.data.includes("Dependencies:"));
    assert.ok(showModRes.data.includes("FADDER"));

    // 2. show ADD0
    const showInstRes = cmdEngine.execute("show ADD0");
    assert.strictEqual(showInstRes.success, true);
    assert.ok(showInstRes.data.includes("Instance: ADD0"));
    assert.ok(showInstRes.data.includes("Type: ADDER4"));

    // 3. trace ADD0.Cin
    const traceRes = cmdEngine.execute("trace ADD0.Cin");
    assert.strictEqual(traceRes.success, true);
    assert.ok(traceRes.data.includes("Cin"));

    // 4. expand ADDER4
    const expandRes = cmdEngine.execute("expand ADDER4");
    assert.strictEqual(expandRes.success, true);
    assert.ok(expandRes.data.includes("ADDER4"));

    console.log("  ✓ Inspection, Tracing & Expansion commands (`show`, `trace`, `expand`) passed");
}

// 17. Detachment Regression Testing (Nested modules with multiple external wires)
{
    const { circuit, engine, cmdEngine, registry } = createTestSetup();
    const script = `
        module FADDER {
            input A
            input B
            input Cin

            output S
            output Cout

            expr S = A XOR B XOR Cin
            expr Cout = (A AND B) OR (Cin AND (A XOR B))
        }

        module ADDER2 {
            input A[0..1]
            input B[0..1]
            input Cin

            output S[0..1]
            output Cout

            add FADDER FA0
            add FADDER FA1

            connect A[0] -> FA0.A
            connect B[0] -> FA0.B
            connect Cin -> FA0.Cin
            connect FA0.S -> S[0]
            connect FA0.Cout -> FA1.Cin

            connect A[1] -> FA1.A
            connect B[1] -> FA1.B
            connect FA1.S -> S[1]
            connect FA1.Cout -> Cout
        }

        add input InCin
        add input InA0
        add input InA1
        add input InB0
        add input InB1

        add ADDER2 ADD0

        add output OutS0
        add output OutS1
        add output OutCout

        connect InCin -> ADD0.Cin
        connect InA0 -> ADD0.A[0]
        connect InA1 -> ADD0.A[1]
        connect InB0 -> ADD0.B[0]
        connect InB1 -> ADD0.B[1]

        connect ADD0.S[0] -> OutS0
        connect ADD0.S[1] -> OutS1
        connect ADD0.Cout -> OutCout
    `;

    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);

    // Set inputs: 2 + 3 + 1 = 6 -> S1=1, S0=1, Cout=0 (sum 3, carry 0 -> total 3 + 3 = 6)
    // A = 2 (A1=1, A0=0), B = 3 (B1=1, B0=1), Cin = 1
    circuit.components.get("InCin").stateValue = 1;
    circuit.components.get("InA1").stateValue = 1;
    circuit.components.get("InA0").stateValue = 0;
    circuit.components.get("InB1").stateValue = 1;
    circuit.components.get("InB0").stateValue = 1;

    engine.evaluateAll();

    const s0Before = circuit.components.get("OutS0").inputs[0].value;
    const s1Before = circuit.components.get("OutS1").inputs[0].value;
    const coutBefore = circuit.components.get("OutCout").inputs[0].value;

    assert.strictEqual(s0Before, 0); // 0 + 1 + 1 = 2 -> S0=0, C=1
    assert.strictEqual(s1Before, 1); // 1 + 1 + 1 = 3 -> S1=1, Cout=1
    assert.strictEqual(coutBefore, 1);

    // Now execute detach ADD0
    const detachRes = cmdEngine.execute("detach ADD0");
    assert.strictEqual(detachRes.success, true, detachRes.error);

    assert.strictEqual(circuit.components.has("ADD0"), false, "ADD0 instance should be removed");

    // Re-verify electrical results after detachment
    engine.evaluateAll();

    const s0After = circuit.components.get("OutS0").inputs[0].value;
    const s1After = circuit.components.get("OutS1").inputs[0].value;
    const coutAfter = circuit.components.get("OutCout").inputs[0].value;

    assert.strictEqual(s0After, s0Before, "S0 state must remain identical after detachment");
    assert.strictEqual(s1After, s1Before, "S1 state must remain identical after detachment");
    assert.strictEqual(coutAfter, coutBefore, "Cout state must remain identical after detachment");

    // Verify all wires terminate at valid component pins
    for (const wire of circuit.wires.values()) {
        assert.ok(wire.fromPin && wire.fromPin.component, "Wire fromPin must be valid");
        assert.ok(wire.toPin && wire.toPin.component, "Wire toPin must be valid");
        assert.ok(circuit.components.has(wire.fromPin.component.id), "fromPin component must exist on circuit");
        assert.ok(circuit.components.has(wire.toPin.component.id), "toPin component must exist on circuit");
    }

    console.log("  ✓ Detachment regression testing for nested modules passed");
}

console.log("All Scripted Modules unit tests passed successfully!");
