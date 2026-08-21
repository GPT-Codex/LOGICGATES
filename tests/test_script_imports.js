import assert from "assert";
import { Circuit } from "../frontend/js/simulation/core.js";
import { ModuleRegistry } from "../frontend/js/simulation/modules.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { resolveConstantsInBlock, processScriptImports, resolveImportPath, normalizePath } from "../frontend/js/simulation/script_parser.js";

console.log("Running Script Constants & Libraries Unit Test Suite...");

function createTestSetup() {
    const circuit = new Circuit();
    const registry = new ModuleRegistry();
    const engine = new SimulationEngine(circuit);
    const cmdEngine = new CommandEngine(circuit, registry, null, engine);
    return { circuit, registry, engine, cmdEngine };
}

// 1. Basic Constant Declarations & Arithmetic
{
    const lines = [
        "const WIDTH = 16",
        "const HALF = WIDTH / 2",
        "const LAST = WIDTH - 1",
        "const EXPR = (WIDTH + 4) * 2"
    ];
    const scope = resolveConstantsInBlock(lines);
    assert.strictEqual(scope.WIDTH, 16);
    assert.strictEqual(scope.HALF, 8);
    assert.strictEqual(scope.LAST, 15);
    assert.strictEqual(scope.EXPR, 40);
    console.log("  ✓ Basic constant declarations & arithmetic passed");
}

// 2. Constant Cycle Rejection
{
    const lines = [
        "const A = B + 1",
        "const B = A + 1"
    ];
    assert.throws(() => {
        resolveConstantsInBlock(lines);
    }, (err) => err.message.includes("Constant dependency cycle"));
    console.log("  ✓ Constant cycle rejection passed");
}

// 3. Constant Reassignment Rejection
{
    const lines = [
        "const WIDTH = 16",
        "const WIDTH = 32"
    ];
    assert.throws(() => {
        resolveConstantsInBlock(lines);
    }, (err) => err.message.includes("Cannot reassign constant 'WIDTH'"));
    console.log("  ✓ Constant reassignment rejection passed");
}

// 4. Constants in Bus Ranges, Loops, and Module Parameters
{
    const { circuit, cmdEngine } = createTestSetup();
    const script = `
        const WORD_SIZE = 4
        const LAST = WORD_SIZE - 1

        bus BUS_A[0..LAST]
        bus BUS_B[0..LAST]

        for i in 0..LAST {
            add input IN_A[i]
            add input IN_B[i]
        }
    `;
    const res = cmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);

    assert.ok(circuit.buses.has("BUS_A"));
    assert.strictEqual(circuit.buses.get("BUS_A").width, 4);
    assert.ok(circuit.components.has("IN_A[0]"));
    assert.ok(circuit.components.has("IN_A[3]"));
    console.log("  ✓ Constants in bus ranges, loops, and script execution passed");
}

// 5. Basic Import and Relative Path Resolution
{
    const virtualFiles = {
        "lib/gates.sim": `
            module NOT_GATE {
                input A
                output Y
                expr Y = NOT A
            }
        `
    };

    const { circuit, registry, cmdEngine } = createTestSetup();
    const script = `
        import "./lib/gates.sim"

        add input InA
        add NOT_GATE N1
        add output OutY

        connect InA N1.A
        connect N1.Y OutY
    `;

    const res = cmdEngine.executeScript(script, { virtualFiles, filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);

    assert.ok(registry.get("mod_not_gate"));
    assert.ok(circuit.components.get("N1"));
    console.log("  ✓ Basic import and relative path resolution passed");
}

// 6. Transitive & Multi-level Library Imports (logic.sim -> arithmetic.sim -> main.sim)
{
    const virtualFiles = {
        "lib/logic.sim": `
            module FADDER {
                input A
                input B
                input Cin
                output S
                output Cout
                expr S = A XOR B XOR Cin
                expr Cout = (A AND B) OR (Cin AND (A XOR B))
            }
        `,
        "lib/arithmetic.sim": `
            import "./logic.sim"

            const MAX_BITS = 16

            module RCA(width) {
                input A[0..width-1]
                input B[0..width-1]
                input Cin
                output S[0..width-1]
                output Cout

                add FADDER FA[0]
                connect A[0] -> FA[0].A
                connect B[0] -> FA[0].B
                connect Cin -> FA[0].Cin
                connect FA[0].S -> S[0]

                for i in 1..width-1 {
                    add FADDER FA[i]
                    connect A[i] -> FA[i].A
                    connect B[i] -> FA[i].B
                    connect FA[i - 1].Cout -> FA[i].Cin
                    connect FA[i].S -> S[i]
                }

                connect FA[width - 1].Cout -> Cout
            }
        `
    };

    const { circuit, engine, cmdEngine, registry } = createTestSetup();
    const mainScript = `
        import "./lib/arithmetic.sim"

        add input Cin
        add RCA(4) ADD4
        add output Cout

        connect Cin -> ADD4.Cin
        connect ADD4.Cout -> Cout

        for i in 0..3 {
            add input A[i]
            add input B[i]
            add output S[i]

            connect A[i] -> ADD4.A[i]
            connect B[i] -> ADD4.B[i]
            connect ADD4.S[i] -> S[i]
        }
    `;

    const res = cmdEngine.executeScript(mainScript, { virtualFiles, filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);

    assert.ok(registry.get("mod_fadder"));
    assert.ok(registry.get("mod_rca"));

    // Verify electrical truth table (9 + 5 + 1 = 15)
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

    assert.strictEqual(sumVal, 15, `Expected sum 15, got ${sumVal}`);
    assert.strictEqual(coutVal, 0, `Expected cout 0, got ${coutVal}`);
    console.log("  ✓ Multi-level library imports & RCA(4) electrical simulation passed");
}

// 7. Duplicate Import Deduplication
{
    const virtualFiles = {
        "lib/common.sim": `
            module BUF1 {
                input A
                output Y
                expr Y = A
            }
        `,
        "lib/partA.sim": `
            import "./common.sim"
        `,
        "lib/partB.sim": `
            import "./common.sim"
        `
    };

    const { cmdEngine, registry } = createTestSetup();
    const script = `
        import "./lib/partA.sim"
        import "./lib/partB.sim"
        import "./lib/common.sim"

        add BUF1 B1
    `;

    const res = cmdEngine.executeScript(script, { virtualFiles, filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);
    assert.ok(registry.get("mod_buf1"));
    console.log("  ✓ Duplicate import deduplication passed");
}

// 8. Circular Import Rejection
{
    const virtualFiles = {
        "A.sim": `import "./B.sim"`,
        "B.sim": `import "./A.sim"`
    };

    const { cmdEngine } = createTestSetup();
    const script = `import "./A.sim"`;

    const res = cmdEngine.executeScript(script, { virtualFiles, filePath: "main.sim" });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("Circular import"));
    console.log("  ✓ Circular import rejection passed");
}

// 9. Import Name Conflict Rejection
{
    const virtualFiles = {
        "lib1.sim": `
            module DUP_MOD {
                input A
                output Y
                expr Y = A
            }
        `,
        "lib2.sim": `
            module DUP_MOD {
                input A
                output Y
                expr Y = NOT A
            }
        `
    };

    const { cmdEngine } = createTestSetup();
    const script = `
        import "./lib1.sim"
        import "./lib2.sim"
    `;

    const res = cmdEngine.executeScript(script, { virtualFiles, filePath: "main.sim" });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("Import conflict"));
    assert.ok(res.error.includes("DUP_MOD"));
    console.log("  ✓ Import name conflict rejection passed");
}

// 10. Library Inspection (`show library`)
{
    const virtualFiles = {
        "lib/arithmetic.sim": `
            const WORD_SIZE = 16
            module RCA {
                input A
                output S
                expr S = A
            }
        `
    };

    const { cmdEngine } = createTestSetup();
    const script = `
        import "./lib/arithmetic.sim"
    `;
    cmdEngine.executeScript(script, { virtualFiles, filePath: "main.sim" });

    const showRes = cmdEngine.execute('show library "lib/arithmetic.sim"');
    assert.strictEqual(showRes.success, true, showRes.error);
    assert.ok(showRes.data.includes("Library: lib/arithmetic.sim"));
    assert.ok(showRes.data.includes("WORD_SIZE"));
    assert.ok(showRes.data.includes("RCA"));
    console.log("  ✓ Library inspection (`show library`) passed");
}

// 11. Atomic Rollback on Failed Import / Compilation
{
    const virtualFiles = {
        "broken.sim": `
            module BROKEN {
                input A
                output Y
                connect NON_EXISTENT.out Y
            }
        `
    };

    const { circuit, registry, cmdEngine } = createTestSetup();
    cmdEngine.execute("add input PreInput");

    const script = `
        import "./broken.sim"
        add input AddedInScript
    `;

    const res = cmdEngine.executeScript(script, { virtualFiles, filePath: "main.sim" });
    assert.strictEqual(res.success, false);
    assert.strictEqual(circuit.components.has("AddedInScript"), false);
    assert.strictEqual(circuit.components.has("PreInput"), true);
    assert.strictEqual(registry.definitions.has("mod_broken"), false);
    console.log("  ✓ Atomic rollback on failed import passed");
}

// 12. Path Traversal Security Rejection
{
    const virtualFiles = {
        "outside.sim": `const SECRET = 42`
    };

    const { cmdEngine } = createTestSetup();
    const script = `import "../outside.sim"`;

    const res = cmdEngine.executeScript(script, { virtualFiles, filePath: "main.sim" });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("traverses outside project root"));
    console.log("  ✓ Path traversal security rejection passed");
}

// 13. Support for `import "lib/logic.sim"` and `import "./lib/logic.sim"`
{
    const virtualFiles = {
        "lib/logic.sim": `
            module INV {
                input A
                output Y
                expr Y = NOT A
            }
        `
    };

    const { registry, cmdEngine } = createTestSetup();
    const script = `
        import "lib/logic.sim"
        add INV I1
    `;

    const res = cmdEngine.executeScript(script, { virtualFiles, filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);
    assert.ok(registry.get("mod_inv"));
    console.log("  ✓ Import without leading ./ passed");
}

// 14. Deeply Nested Directory Imports (`../` resolution)
{
    const virtualFiles = {
        "lib/logic.sim": `
            module BUF_GATE {
                input A
                output Y
                expr Y = A
            }
        `,
        "lib/deeper/arithmetic.sim": `
            import "../logic.sim"
            module PASS_THRU {
                input A
                output Y
                add BUF_GATE BG
                connect A -> BG.A
                connect BG.Y -> Y
            }
        `
    };

    const { registry, cmdEngine } = createTestSetup();
    const script = `
        import "./lib/deeper/arithmetic.sim"
        add PASS_THRU PT
    `;

    const res = cmdEngine.executeScript(script, { virtualFiles, filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);
    assert.ok(registry.get("mod_buf_gate"));
    assert.ok(registry.get("mod_pass_thru"));
    console.log("  ✓ Deeply nested relative imports passed");
}

// 15. Missing File Chain Diagnostics
{
    const virtualFiles = {
        "lib/arithmetic.sim": `
            import "./missing.sim"
        `
    };

    const { cmdEngine } = createTestSetup();
    const script = `import "./lib/arithmetic.sim"`;

    const res = cmdEngine.executeScript(script, { virtualFiles, filePath: "main.sim" });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("main.sim"));
    assert.ok(res.error.includes("imports lib/arithmetic.sim"));
    assert.ok(res.error.includes("imports ./missing.sim"));
    assert.ok(res.error.includes("ERROR: file not found"));
    console.log("  ✓ Missing file chain diagnostics passed");
}

// 16. Parameterized Imported Modules Instantiation
{
    const virtualFiles = {
        "lib/param.sim": `
            module MULTI_RCA(width) {
                input A[0..width-1]
                output Y[0..width-1]
                for i in 0..width-1 {
                    add buffer B[i]
                    connect A[i] -> B[i].in
                    connect B[i].out -> Y[i]
                }
            }
        `
    };

    const { circuit, registry, cmdEngine } = createTestSetup();
    const script = `
        import "./lib/param.sim"

        add MULTI_RCA(4) ADD4
        add MULTI_RCA(8) ADD8
        add MULTI_RCA(16) ADD16
    `;

    const res = cmdEngine.executeScript(script, { virtualFiles, filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);
    assert.ok(registry.get("mod_multi_rca"));
    assert.ok(circuit.components.get("ADD4"));
    assert.ok(circuit.components.get("ADD8"));
    assert.ok(circuit.components.get("ADD16"));
    console.log("  ✓ Parameterized imported modules instantiation passed");
}

// 17. REPL Terminal Import Command
{
    const { circuit, registry, cmdEngine } = createTestSetup();
    circuit.files = {
        "lib/term.sim": `
            module TERM_MOD {
                input A
                output Y
                expr Y = A
            }
        `
    };

    const execRes = cmdEngine.execute('import "./lib/term.sim"');
    assert.strictEqual(execRes.success, true, execRes.error);
    assert.ok(registry.get("mod_term_mod"));
    console.log("  ✓ REPL terminal import command passed");
}

// 18. Save / Load Project State with Files Map
{
    const { serializeCircuit, deserializeCircuit } = await import("../frontend/js/simulation/serialization.js");
    const { circuit, registry, cmdEngine } = createTestSetup();

    circuit.files = {
        "lib/saved.sim": `
            module SAVED_MOD {
                input A
                output Y
                expr Y = A
            }
        `
    };

    const snap = serializeCircuit(circuit, registry);
    assert.ok(snap.files);
    assert.ok(snap.files["lib/saved.sim"]);

    const newCircuit = new Circuit();
    const newRegistry = new ModuleRegistry();
    const newEngine = new SimulationEngine(newCircuit);
    const newCmdEngine = new CommandEngine(newCircuit, newRegistry, null, newEngine);

    deserializeCircuit(snap, newCircuit, newRegistry);
    assert.ok(newCircuit.files["lib/saved.sim"]);

    const script = `
        import "./lib/saved.sim"
        add SAVED_MOD S1
    `;
    const res = newCmdEngine.executeScript(script);
    assert.strictEqual(res.success, true, res.error);
    assert.ok(newRegistry.get("mod_saved_mod"));
    console.log("  ✓ Save/load project state with files map passed");
}

console.log("All Script Constants & Libraries unit tests passed successfully!");
