import assert from "assert";
import { Circuit, naturalCompare } from "../frontend/js/simulation/core.js";
import { ModuleRegistry, UserModule } from "../frontend/js/simulation/modules.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { resolveConstantsInBlock, processScriptImports, resolveImportPath, normalizePath } from "../frontend/js/simulation/script_parser.js";

async function runAllImportTests() {
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
        const res = await cmdEngine.executeScript(script);
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
            "gates.sim": `
                module NOT_GATE {
                    input A
                    output Y
                    expr Y = NOT A
                }
            `
        };

        const fileResolver = async (path) => {
            if (virtualFiles[path] || virtualFiles[`lib/${path}`] || virtualFiles[`${path}.sim`]) {
                return { INFO: "OK", DATA: virtualFiles[path] || virtualFiles[`lib/${path}`] || virtualFiles[`${path}.sim`] };
            }
            return { INFO: "ERROR", MODULE: path, PATH: `lib/${path}.sim`, ERROR: "Module not found", DATA: `${path}: Module not found!` };
        };

        const { circuit, registry, cmdEngine } = createTestSetup();
        const script = `
            import "gates.sim"

            add input InA
            add NOT_GATE N1
            add output OutY

            connect InA N1.A
            connect N1.Y OutY
        `;

        const res = await cmdEngine.executeScript(script, { fileResolver, filePath: "main.sim" });
        assert.strictEqual(res.success, true, res.error);

        assert.ok(registry.get("mod_gates_sim_not_gate") || registry.get("mod_not_gate"));
        assert.ok(circuit.components.get("N1"));
        console.log("  ✓ Basic import and relative path resolution passed");
    }

    // 6. Transitive & Multi-level Library Imports (logic.sim -> arithmetic.sim -> main.sim)
    {
        const virtualFiles = {
            "logic.sim": `
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
            "arithmetic.sim": `
                import "logic.sim"

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

        const fileResolver = async (path) => {
            if (virtualFiles[path] || virtualFiles[`lib/${path}`] || virtualFiles[`${path}.sim`]) {
                return { INFO: "OK", DATA: virtualFiles[path] || virtualFiles[`lib/${path}`] || virtualFiles[`${path}.sim`] };
            }
            return { INFO: "ERROR", MODULE: path, PATH: `lib/${path}.sim`, ERROR: "Module not found", DATA: `${path}: Module not found!` };
        };

        const { circuit, engine, cmdEngine, registry } = createTestSetup();
        const mainScript = `
            import "arithmetic.sim"

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

        const res = await cmdEngine.executeScript(mainScript, { fileResolver, filePath: "main.sim" });
        assert.strictEqual(res.success, true, res.error);

        assert.ok(registry.get("mod_logic_sim_fadder") || registry.get("mod_fadder"));
        assert.ok(registry.get("mod_arithmetic_sim_rca") || registry.get("mod_rca"));

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
            "common.sim": `
                module BUF1 {
                    input A
                    output Y
                    expr Y = A
                }
            `,
            "partA.sim": `
                import "common.sim"
            `,
            "partB.sim": `
                import "common.sim"
            `
        };

        const fileResolver = async (path) => {
            if (virtualFiles[path] || virtualFiles[`lib/${path}`] || virtualFiles[`${path}.sim`]) {
                return { INFO: "OK", DATA: virtualFiles[path] || virtualFiles[`lib/${path}`] || virtualFiles[`${path}.sim`] };
            }
            return { INFO: "ERROR", MODULE: path, PATH: `lib/${path}.sim`, ERROR: "Module not found", DATA: `${path}: Module not found!` };
        };

        const { cmdEngine, registry } = createTestSetup();
        const script = `
            import "partA.sim"
            import "partB.sim"
            import "common.sim"

            add BUF1 B1
        `;

        const res = await cmdEngine.executeScript(script, { fileResolver, filePath: "main.sim" });
        assert.strictEqual(res.success, true, res.error);
        assert.ok(registry.get("mod_common_sim_buf1") || registry.get("mod_buf1"));
        console.log("  ✓ Duplicate import deduplication passed");
    }

    // 8. Import Error Diagnostics (Single file & Nested Chain)
    {
        // 8a. Single file missing import
        const { cmdEngine: cmdEngine1 } = createTestSetup();
        const script1 = `import "does_not_exist"`;
        const fileResolver1 = async (m) => ({
            INFO: "ERROR",
            MODULE: m,
            PATH: `lib/${m}.sim`,
            ERROR: "Module not found",
            DATA: `${m}: Module not found!`
        });

        const res1 = await cmdEngine1.executeScript(script1, { fileResolver: fileResolver1, filePath: "main.sim" });
        assert.strictEqual(res1.success, false);
        assert.ok(res1.error.includes("File: main.sim"));
        assert.ok(res1.error.includes("Line: 1"));
        assert.ok(res1.error.includes('Import: "does_not_exist"'));
        assert.ok(res1.error.includes("Module not found: does_not_exist"));
        assert.ok(res1.error.includes("Expected server library:\nlib/does_not_exist.sim"));

        // 8b. Nested missing import chain
        const virtualFilesNested = {
            "arithmetic.sim": `import "logic"`,
            "logic.sim": `
                # Line 1
                # Line 2
                import "missing"
            `
        };

        const fileResolverNested = async (m) => {
            if (virtualFilesNested[m] || virtualFilesNested[`${m}.sim`]) {
                return { INFO: "OK", DATA: virtualFilesNested[m] || virtualFilesNested[`${m}.sim`] };
            }
            return {
                INFO: "ERROR",
                MODULE: m,
                PATH: `lib/${m}.sim`,
                ERROR: "Module not found",
                DATA: `${m}: Module not found!`
            };
        };

        const { cmdEngine: cmdEngine2 } = createTestSetup();
        const script2 = `import "arithmetic.sim"`;
        const res2 = await cmdEngine2.executeScript(script2, { fileResolver: fileResolverNested, filePath: "main.sim" });
        assert.strictEqual(res2.success, false);
        assert.ok(res2.error.includes("main.sim"));
        assert.ok(res2.error.includes("arithmetic"));
        assert.ok(res2.error.includes("logic"));
        assert.ok(res2.error.includes("missing"));
        assert.ok(res2.error.includes("Source file: logic.sim"));
        assert.ok(res2.error.includes("Line: 4"));
        assert.ok(res2.error.includes("Module not found: missing"));
        assert.ok(res2.error.includes("lib/missing.sim"));

        console.log("  ✓ Import error diagnostics (Single & Nested chain) passed");
    }

    // 9. Natural Pin Ordering Unit Tests (Indexed pins, multi-digit indices, parameterized RCA)
    {
        // 9a. Natural ordering comparator verification
        const rawList = ["B[0]", "B[1]", "B[10]", "B[11]", "B[12]", "B[2]", "B[3]", "B[9]", "B[100]"];
        const sortedList = [...rawList].sort(naturalCompare);
        assert.deepStrictEqual(sortedList, ["B[0]", "B[1]", "B[2]", "B[3]", "B[9]", "B[10]", "B[11]", "B[12]", "B[100]"]);

        // 9b. Script-defined module pin layout order
        const { registry, cmdEngine, circuit, engine } = createTestSetup();
        const script = `
            module TEST {
                input A[0..15]
                output B[0..15]
            }

            add TEST TST
        `;
        const res = await cmdEngine.executeScript(script);
        assert.strictEqual(res.success, true, res.error);

        const tstComp = circuit.components.get("TST");
        assert.ok(tstComp);

        const outputPinNames = tstComp.outputs.map(p => p.name);
        const expectedOrder = Array.from({ length: 16 }, (_, i) => `B[${i}]`);
        assert.deepStrictEqual(outputPinNames, expectedOrder, `Outputs must be in natural numeric order 0..15, got: ${outputPinNames.join(",")}`);

        const inputPinNames = tstComp.inputs.map(p => p.name);
        const expectedInputOrder = Array.from({ length: 16 }, (_, i) => `A[${i}]`);
        assert.deepStrictEqual(inputPinNames, expectedInputOrder, `Inputs must be in natural numeric order 0..15, got: ${inputPinNames.join(",")}`);

        // 9c. Parameterized module natural ordering
        const paramScript = `
            module RCA(width) {
                input A[0..width-1]
                output S[0..width-1]
            }
            add RCA(16) ADD16
        `;
        const paramRes = await cmdEngine.executeScript(paramScript);
        assert.strictEqual(paramRes.success, true, paramRes.error);

        const add16Comp = circuit.components.get("ADD16");
        const add16Outputs = add16Comp.outputs.map(p => p.name);
        const expectedParamOrder = Array.from({ length: 16 }, (_, i) => `S[${i}]`);
        assert.deepStrictEqual(add16Outputs, expectedParamOrder);

        // 9d. Wiring identity persistence test
        const wireScript = `
            module WIRE_TEST {
                input In[0..15]
                output Out[0..15]
                for i in 0..15 {
                    expr Out[i] = In[i]
                }
            }

            add WIRE_TEST WT0
            add input SRC_10
            add output DST_10

            connect SRC_10 WT0.In[10]
            connect WT0.Out[10] DST_10
        `;
        const wireRes = await cmdEngine.executeScript(wireScript);
        assert.strictEqual(wireRes.success, true, wireRes.error);

        const src10 = circuit.components.get("SRC_10");
        const dst10 = circuit.components.get("DST_10");

        src10.stateValue = 1;
        engine.triggerInputToggle(src10);

        assert.strictEqual(dst10.inputs[0].value, 1, "Signal at index 10 must map precisely to Out[10] without index shifting");

        console.log("  ✓ Natural pin ordering (Indexed pins, multi-digit, parameterized, wiring mapping) passed");
    }

    // 10. Import Alias Unit Tests
    {
        const virtualFiles = {
            "logic.sim": `
                module FADDER {
                    input A
                    input B
                    input Cin
                    output S
                    output Cout
                    expr S = (A XOR B) XOR Cin
                    expr Cout = (A AND B) OR (Cin AND (A XOR B))
                }
            `,
            "arithmetic.sim": `
                import "logic.sim"
                const MAX_WIDTH = 256
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
            `,
            "consts.sim": `
                const BUS_WIDTH = 8
            `
        };

        const fileResolver = async (path) => {
            if (virtualFiles[path] || virtualFiles[`lib/${path}`] || virtualFiles[`${path}.sim`]) {
                return { INFO: "OK", DATA: virtualFiles[path] || virtualFiles[`lib/${path}`] || virtualFiles[`${path}.sim`] };
            }
            return { INFO: "ERROR", MODULE: path, PATH: `lib/${path}.sim`, ERROR: "Module not found", DATA: `${path}: Module not found!` };
        };

        // 10a. Basic Alias Import, Qualified Module, and Qualified Constant
        const { cmdEngine, circuit } = createTestSetup();
        const script10a = `
            import "logic.sim" as logic
            import "arithmetic.sim" as math
            import "consts.sim" as c

            bus DATA[0..c.BUS_WIDTH-1]

            add logic.FADDER FA0
            add math.RCA(8) ADD8
        `;
        const res10a = await cmdEngine.executeScript(script10a, { fileResolver, filePath: "main.sim" });
        assert.strictEqual(res10a.success, true, res10a.error);
        assert.ok(circuit.buses.has("DATA"));
        assert.strictEqual(circuit.buses.get("DATA").width, 8);
        assert.ok(circuit.components.get("FA0"));
        assert.ok(circuit.components.get("ADD8"));

        // 10b. Invalid alias identifier & Duplicate alias rejection
        const { cmdEngine: cmdEngineErr } = createTestSetup();
        const script10b = `
            import "logic.sim" as logic
            import "arithmetic.sim" as logic
        `;
        const res10b = await cmdEngineErr.executeScript(script10b, { fileResolver, filePath: "main.sim" });
        assert.strictEqual(res10b.success, false);
        assert.ok(res10b.error.includes("Duplicate import alias 'logic'"));

        // 10c. Collision and Ambiguous Unqualified Reference Rejection
        const virtualCollisions = {
            "lib1.sim": "module CUSTOM_GATE {\n    input A\n    output Y\n    expr Y = A\n}",
            "lib2.sim": "module CUSTOM_GATE {\n    input A\n    output Y\n    expr Y = A\n}"
        };
        const fileResolverColl = async (path) => ({ INFO: "OK", DATA: virtualCollisions[path] || virtualCollisions[`${path}.sim`] });

        const { cmdEngine: cmdEngineAmb } = createTestSetup();
        const scriptAmb = `
            import "lib1.sim" as l1
            import "lib2.sim" as l2
            add CUSTOM_GATE M0
        `;
        const resAmb = await cmdEngineAmb.executeScript(scriptAmb, { fileResolver: fileResolverColl, filePath: "main.sim" });
        assert.strictEqual(resAmb.success, false);
        assert.ok(resAmb.error.includes("Ambiguous module 'CUSTOM_GATE'"));
        assert.ok(resAmb.error.includes("l1.CUSTOM_GATE"));
        assert.ok(resAmb.error.includes("l2.CUSTOM_GATE"));

        // 10d. Disambiguated Qualified Calls
        const { cmdEngine: cmdEngineDisamb, circuit: circuitDisamb } = createTestSetup();
        const scriptDisamb = `
            import "lib1.sim" as l1
            import "lib2.sim" as l2
            add l1.CUSTOM_GATE MUX_A
            add l2.CUSTOM_GATE MUX_B
        `;
        const resDisamb = await cmdEngineDisamb.executeScript(scriptDisamb, { fileResolver: fileResolverColl, filePath: "main.sim" });
        assert.strictEqual(resDisamb.success, true, resDisamb.error);
        assert.ok(circuitDisamb.components.get("MUX_A"));
        assert.ok(circuitDisamb.components.get("MUX_B"));

        // 10e. show import ALIAS inspection command
        const showRes = cmdEngineDisamb.execute("show import l1");
        assert.strictEqual(showRes.success, true);
        assert.ok(showRes.data.includes("Alias: l1"));
        assert.ok(showRes.data.includes("Exported Modules:\n  - CUSTOM_GATE"));

        console.log("  ✓ Import aliases (syntax, qualified modules/constants, disambiguation, show import) passed");
    }

    console.log("All Script Constants & Libraries unit tests passed successfully!");
}

await runAllImportTests();
