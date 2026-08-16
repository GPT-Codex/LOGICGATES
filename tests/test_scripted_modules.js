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

console.log("All Scripted Modules unit tests passed successfully!");
