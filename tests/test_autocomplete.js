import assert from "assert";
import { Circuit } from "../frontend/js/simulation/core.js";
import { ModuleRegistry, ModuleDefinition } from "../frontend/js/simulation/modules.js";
import { createComponent } from "../frontend/js/simulation/components.js";
import {
    getCompletions,
    extractScopeMetadata,
    rankCandidates,
    SCRIPT_COMMANDS
} from "../frontend/js/ui/autocomplete.js";

function runAutocompleteTests() {
    console.log("Running Autocomplete Unit Test Suite...");

    // 1. Candidate Ranking
    {
        const candidates = [
            { name: "button", type: "component" },
            { name: "bus", type: "command" },
            { name: "buffer", type: "component" }
        ];
        const ranked = rankCandidates(candidates, "bu");
        assert.strictEqual(ranked[0].name, "buffer");
        assert.strictEqual(ranked[1].name, "bus");
        assert.strictEqual(ranked[2].name, "button");
        console.log("  ✓ Candidate ranking & prefix filtering passed");
    }

    // 2. Command completion at line start
    {
        const fullText = "a";
        const res = getCompletions(fullText, 1, {});
        assert.strictEqual(res.contextType, "command");
        assert.strictEqual(res.replacePrefix, "a");
        assert.ok(res.suggestions.some(s => s.name === "add"));
        console.log("  ✓ Command completion at line start passed");
    }

    // 3. Component / module type completion after `add `
    {
        const registry = new ModuleRegistry();
        registry.register(new ModuleDefinition("mod_rca", "RCA", "16-bit RCA", "Arithmetic", [], []));

        const fullText = "add R";
        const res = getCompletions(fullText, fullText.length, { registry });
        assert.strictEqual(res.contextType, "component_type");
        assert.strictEqual(res.replacePrefix, "R");
        assert.ok(res.suggestions.some(s => s.name === "RCA"));
        console.log("  ✓ Component & module type completion after 'add ' passed");
    }

    // 4. Import path completion after `import "`
    {
        const fullText = 'import "';
        const serverLibraries = ["logic", "arithmetic", "memory"];
        const res = getCompletions(fullText, fullText.length, { serverLibraries });
        assert.strictEqual(res.contextType, "import_path");
        assert.ok(res.suggestions.some(s => s.name === "logic"));
        assert.ok(res.suggestions.some(s => s.name === "arithmetic"));
        console.log("  ✓ Server library path completion after 'import \"' passed");
    }

    // 5. Qualified module symbol completion after `add math.`
    {
        const registry = new ModuleRegistry();
        const def = new ModuleDefinition("mod_arith_rca", "RCA", "Ripple Carry Adder", "Arithmetic", [], []);
        def.aliases = ["math"];
        registry.register(def);

        const fullText = "add math.R";
        const res = getCompletions(fullText, fullText.length, { registry });
        assert.strictEqual(res.contextType, "qualified_symbol");
        assert.strictEqual(res.replacePrefix, "R");
        assert.ok(res.suggestions.some(s => s.name === "RCA"));
        console.log("  ✓ Qualified symbol completion after alias prefix passed");
    }

    // 6. Instance name completion for `move`, `remove`, `show`
    {
        const circuit = new Circuit();
        circuit.addComponent(createComponent("AND", "G1", 100, 100));
        circuit.addComponent(createComponent("Clock", "CLK1", 100, 200));

        const fullText = "move G";
        const res = getCompletions(fullText, fullText.length, { circuit });
        assert.strictEqual(res.contextType, "instance");
        assert.strictEqual(res.replacePrefix, "G");
        assert.strictEqual(res.suggestions[0].name, "G1");
        console.log("  ✓ Instance name completion for commands passed");
    }

    // 7. Pin completion for `connect G1.`
    {
        const circuit = new Circuit();
        circuit.addComponent(createComponent("AND", "G1", 100, 100));

        const fullText = "connect G1.";
        const res = getCompletions(fullText, fullText.length, { circuit });
        assert.strictEqual(res.contextType, "pin");
        assert.ok(res.suggestions.some(s => s.name === "A"));
        assert.ok(res.suggestions.some(s => s.name === "B"));
        assert.ok(res.suggestions.some(s => s.name === "Y"));
        console.log("  ✓ Pin completion for 'connect COMP.' passed");
    }

    // 8. Property & value completion for `set CLK.` and `set BTN.buttonMode `
    {
        const circuit = new Circuit();
        circuit.addComponent(createComponent("Clock", "CLK1", 100, 100));
        circuit.addComponent(createComponent("Button", "BTN1", 100, 200));

        const resProp = getCompletions("set CLK1.f", 10, { circuit });
        assert.strictEqual(resProp.contextType, "property");
        assert.ok(resProp.suggestions.some(s => s.name === "freq"));

        const resVal = getCompletions("set BTN1.buttonMode ", 20, { circuit });
        assert.strictEqual(resVal.contextType, "property_value");
        assert.ok(resVal.suggestions.some(s => s.name === "press"));
        assert.ok(resVal.suggestions.some(s => s.name === "hold"));
        console.log("  ✓ Property & value completion for set command passed");
    }

    // 9. Module parameter hints for `add RCA(`
    {
        const registry = new ModuleRegistry();
        const def = new ModuleDefinition("mod_rca", "RCA", "16-bit RCA", "Arithmetic", [], [], [], [], "Module", "Custom", [], ["width"]);
        registry.register(def);

        const fullText = "add RCA(w";
        const res = getCompletions(fullText, fullText.length, { registry });
        assert.strictEqual(res.contextType, "parameter");
        assert.ok(res.suggestions.some(s => s.name === "width="));
        console.log("  ✓ Module parameter hints for 'add MODULE(' passed");
    }

    // 10. Loop variable scoping inside `for i in 0..15 {`
    {
        const script = `for i in 0..15 {\n  show i`;
        const meta = extractScopeMetadata(script, 1);
        assert.ok(meta.loopVars.has("i"));

        const res = getCompletions("i", 1, {});
        assert.ok(res.suggestions.some(s => s.name === "import"));
        console.log("  ✓ Loop variable scoping in context extraction passed");
    }

    // 11. Autocomplete tolerance with incomplete syntax
    {
        const incompleteScript = `
            module TEST {
                input A
                output B
            # Incomplete line
            connect A ->
        `;
        const res = getCompletions("connect A -> ", "connect A -> ".length, {});
        assert.notStrictEqual(res, null);
        assert.strictEqual(res.contextType, "signal");
        console.log("  ✓ Autocomplete tolerance with incomplete syntax passed");
    }

    // 12. Script-defined unexecuted module completion & port completion
    {
        const script = `module FADDER {\n input A\n input B\n input Cin\n output S\n output Cout\n}\nadd FA`;
        const resAdd = getCompletions(script, script.length, {});
        assert.ok(resAdd.suggestions.some(s => s.name === "FADDER"));

        const scriptParam = `module RCA(width) {\n input A[0..width-1]\n output S[0..width-1]\n}\nadd RCA(`;
        const resParam = getCompletions(scriptParam, scriptParam.length, {});
        assert.ok(resParam.suggestions.some(s => s.name === "width="));

        const scriptConnect = `module FADDER {\n input A\n input B\n input Cin\n output S\n output Cout\n}\nconnect FADDER.`;
        const resPin = getCompletions(scriptConnect, scriptConnect.length, {});
        assert.ok(resPin.suggestions.some(s => s.name === "A"));
        assert.ok(resPin.suggestions.some(s => s.name === "Cin"));
        assert.ok(resPin.suggestions.some(s => s.name === "S"));
        assert.ok(resPin.suggestions.some(s => s.name === "Cout"));
        console.log("  ✓ Script-defined module & port completions passed");
    }

    console.log("All Autocomplete unit tests passed successfully!");
}

runAutocompleteTests();
