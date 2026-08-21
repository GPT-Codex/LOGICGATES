import assert from "assert";
import { Circuit } from "../frontend/js/simulation/core.js";
import { ModuleRegistry } from "../frontend/js/simulation/modules.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { serializeCircuit, deserializeCircuit } from "../frontend/js/simulation/serialization.js";
import { ProjectFileStore } from "../frontend/js/simulation/project_files.js";

console.log("Running Comprehensive Browser Project File Store & Import Test Suite...");

function createBrowserSetup() {
    const circuit = new Circuit();
    const registry = new ModuleRegistry();
    const engine = new SimulationEngine(circuit);
    const cmdEngine = new CommandEngine(circuit, registry, null, engine);
    return { circuit, registry, engine, cmdEngine };
}

// Scenario 1: Browser import of a sibling project file
{
    const { circuit, registry, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("lib/logic.sim", `
        module FADDER {
            input A
            input B
            input Cin
            output S
            output Cout
            expr S = A XOR B XOR Cin
            expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
        }
    `);

    const mainScript = `
        import "./lib/logic.sim"
        add FADDER TST
    `;

    const res = cmdEngine.executeScript(mainScript, { filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);
    assert.ok(registry.get("mod_fadder"));
    assert.ok(circuit.components.get("TST"));
    console.log("  1. ✓ Browser import of a sibling project file passed");
}

// Scenario 2: Browser import of a nested project file
{
    const { circuit, registry, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("lib/deeper/arithmetic.sim", `
        module SUB1 {
            input A
            output Y
            expr Y = NOT A
        }
    `);

    const mainScript = `
        import "./lib/deeper/arithmetic.sim"
        add SUB1 S1
    `;

    const res = cmdEngine.executeScript(mainScript, { filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);
    assert.ok(registry.get("mod_sub1"));
    assert.ok(circuit.components.get("S1"));
    console.log("  2. ✓ Browser import of a nested project file passed");
}

// Scenario 3: ../ resolution in nested import
{
    const { circuit, registry, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("lib/logic.sim", `
        module HALF_ADDER {
            input A
            input B
            output S
            output C
            expr S = A XOR B
            expr C = A AND B
        }
    `);
    circuit.files.setFile("lib/deeper/arithmetic.sim", `
        import "../logic.sim"
        module WRAPPER {
            input A
            input B
            output S
            add HALF_ADDER HA0
            connect A -> HA0.A
            connect B -> HA0.B
            connect HA0.S -> S
        }
    `);

    const mainScript = `
        import "./lib/deeper/arithmetic.sim"
        add WRAPPER W1
    `;

    const res = cmdEngine.executeScript(mainScript, { filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);
    assert.ok(registry.get("mod_half_adder"));
    assert.ok(registry.get("mod_wrapper"));
    console.log("  3. ✓ Relative ../ path resolution passed");
}

// Scenario 4: Missing file with detailed error context & dependency chain reporting
{
    const { circuit, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("lib/arithmetic.sim", `
        import "./missing_logic.sim"
    `);

    const mainScript = `
        import "./lib/arithmetic.sim"
    `;

    const res = cmdEngine.executeScript(mainScript, { filePath: "main.sim" });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("Import error"), res.error);
    assert.ok(res.error.includes("Dependency chain: main.sim -> lib/arithmetic.sim"), res.error);
    assert.ok(res.error.includes("Source: lib/arithmetic.sim"), res.error);
    assert.ok(res.error.includes("Requested: ./missing_logic.sim"), res.error);
    assert.ok(res.error.includes("Resolved: lib/missing_logic.sim"), res.error);
    assert.ok(res.error.includes("File does not exist in the current project"), res.error);
    console.log("  4. ✓ Missing file error context & dependency chain reporting passed");
}

// Scenario 5: Duplicate import deduplication
{
    const { circuit, registry, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("lib/gates.sim", `
        module BUF_PRIM {
            input A
            output Y
            expr Y = A
        }
    `);

    const mainScript = `
        import "./lib/gates.sim"
        import "./lib/gates.sim"
        import "lib/gates.sim"
        add BUF_PRIM B1
    `;

    const res = cmdEngine.executeScript(mainScript, { filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);
    assert.ok(registry.get("mod_buf_prim"));
    console.log("  5. ✓ Duplicate import deduplication passed");
}

// Scenario 6: Circular import rejection
{
    const { circuit, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("A.sim", `import "./B.sim"`);
    circuit.files.setFile("B.sim", `import "./A.sim"`);

    const mainScript = `import "./A.sim"`;
    const res = cmdEngine.executeScript(mainScript, { filePath: "main.sim" });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("Circular import"), res.error);
    console.log("  6. ✓ Circular import rejection passed");
}

// Scenario 7: Imported compile-time constants
{
    const { circuit, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("lib/constants.sim", `
        const WIDTH = 16
        const LAST = WIDTH - 1
    `);

    const mainScript = `
        import "./lib/constants.sim"
        bus A[0..LAST]
    `;

    const res = cmdEngine.executeScript(mainScript, { filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);
    assert.ok(circuit.buses.has("A"));
    assert.strictEqual(circuit.buses.get("A").width, 16);
    console.log("  7. ✓ Imported constants passed");
}

// Scenario 8: Imported parameterized modules
{
    const { circuit, registry, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("lib/arithmetic.sim", `
        module RCA(width) {
            input A[0..width-1]
            input B[0..width-1]
            output S[0..width-1]
            for i in 0..width-1 {
                add buffer BUF[i]
                connect A[i] -> BUF[i].in
                connect BUF[i].out -> S[i]
            }
        }
    `);

    const mainScript = `
        import "./lib/arithmetic.sim"
        add RCA(4) ADD4
        add RCA(8) ADD8
        add RCA(16) ADD16
    `;

    const res = cmdEngine.executeScript(mainScript, { filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);
    assert.ok(circuit.components.get("ADD4"));
    assert.ok(circuit.components.get("ADD8"));
    assert.ok(circuit.components.get("ADD16"));
    console.log("  8. ✓ Imported parameterized modules passed");
}

// Scenario 9: Imported hierarchical custom modules
{
    const { circuit, registry, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("lib/logic.sim", `
        module FADDER {
            input A
            input B
            input Cin
            output S
            output Cout
            expr S = A XOR B XOR Cin
            expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
        }
    `);
    circuit.files.setFile("lib/arithmetic.sim", `
        import "./logic.sim"
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
    `);

    const mainScript = `
        import "./lib/arithmetic.sim"
        add RCA(16) ADD16
    `;

    const res = cmdEngine.executeScript(mainScript, { filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);
    assert.ok(registry.get("mod_fadder"));
    assert.ok(registry.get("mod_rca"));
    assert.ok(circuit.components.get("ADD16"));
    console.log("  9. ✓ Imported hierarchical modules passed");
}

// Scenario 10: Save/Reload project with project files
{
    const { circuit, registry, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("lib/logic.sim", `
        module BUF_GATE {
            input A
            output Y
            expr Y = A
        }
    `);

    const script = `
        import "./lib/logic.sim"
        add BUF_GATE B1
    `;
    cmdEngine.executeScript(script, { filePath: "main.sim" });

    // Save project
    const savedData = serializeCircuit(circuit, registry);
    assert.ok(savedData.files);
    assert.strictEqual(savedData.files["lib/logic.sim"], circuit.files.getFile("lib/logic.sim"));

    // Reload into clean setup
    const setup2 = createBrowserSetup();
    deserializeCircuit(savedData, setup2.circuit, setup2.registry);

    assert.ok(setup2.circuit.files.hasFile("lib/logic.sim"));

    // Re-import in setup2
    const res2 = setup2.cmdEngine.executeScript(`import "./lib/logic.sim"\nadd BUF_GATE B2`, { filePath: "main.sim" });
    assert.strictEqual(res2.success, true, res2.error);
    assert.ok(setup2.circuit.components.get("B2"));
    console.log(" 10. ✓ Save/Reload project with project files passed");
}

// Scenario 11: Project export/import JSON roundtrip
{
    const { circuit, registry, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("lib/logic.sim", `
        module NOT1 {
            input A
            output Y
            expr Y = NOT A
        }
    `);
    circuit.files.setFile("lib/arithmetic.sim", `
        import "./logic.sim"
        module INV_PAIR {
            input A
            output Y
            add NOT1 N1
            connect A -> N1.A
            connect N1.Y -> Y
        }
    `);

    const jsonString = JSON.stringify(serializeCircuit(circuit, registry));

    const setup2 = createBrowserSetup();
    deserializeCircuit(JSON.parse(jsonString), setup2.circuit, setup2.registry);

    assert.ok(setup2.circuit.files.hasFile("lib/logic.sim"));
    assert.ok(setup2.circuit.files.hasFile("lib/arithmetic.sim"));

    const mainScript = `
        import "./lib/arithmetic.sim"
        add INV_PAIR P1
    `;
    const res = setup2.cmdEngine.executeScript(mainScript, { filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);
    console.log(" 11. ✓ Project export/import JSON roundtrip passed");
}

// Scenario 12: Path traversal security rejection
{
    const { circuit, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("lib/logic.sim", `module M1 { input A output Y expr Y = A }`);

    const script = `import "../../outside.sim"`;
    const res = cmdEngine.executeScript(script, { filePath: "main.sim" });
    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("Security Error"), res.error);
    assert.ok(res.error.includes("outside project root"), res.error);
    console.log(" 12. ✓ Path traversal security rejection passed");
}

// Scenario 13: Editing imported file and re-importing/recompiling
{
    const { circuit, registry, cmdEngine } = createBrowserSetup();
    circuit.files.setFile("lib/logic.sim", `
        module MY_GATE {
            input A
            output Y
            expr Y = A
        }
    `);

    cmdEngine.executeScript(`import "./lib/logic.sim"`, { filePath: "main.sim" });
    assert.ok(registry.get("mod_my_gate"));

    // Update file in store
    circuit.files.setFile("lib/logic.sim", `
        module MY_GATE_V2 {
            input A
            output Y
            expr Y = NOT A
        }
    `);

    cmdEngine.executeScript(`import "./lib/logic.sim"`, { filePath: "main.sim" });
    assert.ok(registry.get("mod_my_gate_v2"));
    console.log(" 13. ✓ Editing imported file and re-importing passed");
}

// Scenario 14: Two unrelated projects with same relative library paths
{
    const setup1 = createBrowserSetup();
    setup1.circuit.files.setFile("lib/shared.sim", `
        module MOD_PROJ1 {
            input A
            output Y
            expr Y = A
        }
    `);

    const setup2 = createBrowserSetup();
    setup2.circuit.files.setFile("lib/shared.sim", `
        module MOD_PROJ2 {
            input A
            output Y
            expr Y = NOT A
        }
    `);

    const res1 = setup1.cmdEngine.executeScript(`import "./lib/shared.sim"\nadd MOD_PROJ1 P1`, { filePath: "main.sim" });
    const res2 = setup2.cmdEngine.executeScript(`import "./lib/shared.sim"\nadd MOD_PROJ2 P2`, { filePath: "main.sim" });

    assert.strictEqual(res1.success, true, res1.error);
    assert.strictEqual(res2.success, true, res2.error);
    assert.ok(setup1.registry.get("mod_mod_proj1"));
    assert.strictEqual(setup1.registry.get("mod_mod_proj2"), undefined);

    assert.ok(setup2.registry.get("mod_mod_proj2"));
    assert.strictEqual(setup2.registry.get("mod_mod_proj1"), undefined);
    console.log(" 14. ✓ Unrelated project isolation passed");
}

// Scenario 15: Large import dependency graph
{
    const { circuit, registry, cmdEngine } = createBrowserSetup();
    const count = 20;

    for (let i = 0; i < count; i++) {
        const nextImport = i < count - 1 ? `import "./node_${i + 1}.sim"\n` : "";
        circuit.files.setFile(`node_${i}.sim`, `
            ${nextImport}
            module GATE_${i} {
                input A
                output Y
                expr Y = A
            }
        `);
    }

    const res = cmdEngine.executeScript(`import "./node_0.sim"`, { filePath: "main.sim" });
    assert.strictEqual(res.success, true, res.error);

    for (let i = 0; i < count; i++) {
        assert.ok(registry.get(`mod_gate_${i}`), `Missing module GATE_${i}`);
    }
    console.log(" 15. ✓ Large import dependency graph passed");
}

console.log("All Comprehensive Browser Project File Store & Import unit tests passed successfully!");
