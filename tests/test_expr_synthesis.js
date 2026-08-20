import assert from "assert";
import { Circuit } from "../frontend/js/simulation/core.js";
import { SimulationEngine } from "../frontend/js/simulation/simulation_engine.js";
import { HistoryManager } from "../frontend/js/canvas/interactions.js";
import { CommandEngine } from "../frontend/js/simulation/command_engine.js";
import { parseBooleanExpression } from "../frontend/js/simulation/expr_parser.js";

function runTests() {
    console.log("Running Boolean Expression Synthesis unit tests...");

    // Test 1: Parser & Operator Precedence
    {
        // NOT precedence > AND
        const ast1 = parseBooleanExpression("NOT A AND B");
        assert.strictEqual(ast1.type, "Binary");
        assert.strictEqual(ast1.op, "AND");
        assert.strictEqual(ast1.left.type, "Unary");
        assert.strictEqual(ast1.left.op, "NOT");
        assert.strictEqual(ast1.right.type, "Variable");

        // Parentheses override precedence
        const ast2 = parseBooleanExpression("NOT (A AND B)");
        assert.strictEqual(ast2.type, "Unary");
        assert.strictEqual(ast2.op, "NOT");
        assert.strictEqual(ast2.expr.type, "Binary");
        assert.strictEqual(ast2.expr.op, "AND");

        // Precedence: AND > XOR > OR
        const ast3 = parseBooleanExpression("A OR B XOR C AND D");
        assert.strictEqual(ast3.type, "Binary");
        assert.strictEqual(ast3.op, "OR");
        assert.strictEqual(ast3.right.type, "Binary");
        assert.strictEqual(ast3.right.op, "XOR");
        assert.strictEqual(ast3.right.right.type, "Binary");
        assert.strictEqual(ast3.right.right.op, "AND");

        // All operators supported
        const ast4 = parseBooleanExpression("A NAND B NOR C XNOR D");
        assert(ast4, "Should parse NAND, NOR, XNOR");
    }

    // Test 2: Expression Synthesis & Subexpression Deduplication
    {
        const circuit = new Circuit();
        const engine = new SimulationEngine(circuit);
        const commandEngine = new CommandEngine(circuit, null, null, engine);

        // Expression with duplicate subexpression: (A AND B) OR (A AND B)
        const res = commandEngine.execute("expr Y = (A AND B) OR (A AND B)");
        assert(res.success, `expr execution failed: ${res.error}`);

        // Count AND gates
        let andCount = 0;
        for (const comp of circuit.components.values()) {
            if (comp.type === "AND") andCount++;
        }
        assert.strictEqual(andCount, 1, "Should deduplicate (A AND B) and create only 1 AND gate");
    }

    // Test 3: Simulation Truth Table for Full Adder (S & Cout)
    {
        const circuit = new Circuit();
        const engine = new SimulationEngine(circuit);
        const commandEngine = new CommandEngine(circuit, null, null, engine);

        const r1 = commandEngine.execute("expr S = (A XOR B) XOR Cin");
        assert(r1.success, `expr S failed: ${r1.error}`);

        const r2 = commandEngine.execute("expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)");
        assert(r2.success, `expr Cout failed: ${r2.error}`);

        const gateA = circuit.components.get("A");
        const gateB = circuit.components.get("B");
        const gateCin = circuit.components.get("Cin");
        const gateS = circuit.components.get("S");
        const gateCout = circuit.components.get("Cout");

        assert(gateA && gateB && gateCin && gateS && gateCout, "All inputs and outputs should exist");

        // Full Adder Truth Table
        const truthTable = [
            { a: 0, b: 0, cin: 0, s: 0, cout: 0 },
            { a: 0, b: 0, cin: 1, s: 1, cout: 0 },
            { a: 0, b: 1, cin: 0, s: 1, cout: 0 },
            { a: 0, b: 1, cin: 1, s: 0, cout: 1 },
            { a: 1, b: 0, cin: 0, s: 1, cout: 0 },
            { a: 1, b: 0, cin: 1, s: 0, cout: 1 },
            { a: 1, b: 1, cin: 0, s: 0, cout: 1 },
            { a: 1, b: 1, cin: 1, s: 1, cout: 1 }
        ];

        for (const row of truthTable) {
            gateA.stateValue = row.a;
            gateA.evaluate();
            gateB.stateValue = row.b;
            gateB.evaluate();
            gateCin.stateValue = row.cin;
            gateCin.evaluate();

            engine.evaluateAll();

            const actualS = gateS.inputs[0].value;
            const actualCout = gateCout.inputs[0].value;

            assert.strictEqual(
                actualS,
                row.s,
                `Full Adder S failed for A=${row.a}, B=${row.b}, Cin=${row.cin}. Expected ${row.s}, got ${actualS}`
            );
            assert.strictEqual(
                actualCout,
                row.cout,
                `Full Adder Cout failed for A=${row.a}, B=${row.b}, Cin=${row.cin}. Expected ${row.cout}, got ${actualCout}`
            );
        }
    }

    // Test 4: .sim Script Execution with expr Commands & Transaction Rollback
    {
        const circuit = new Circuit();
        const engine = new SimulationEngine(circuit);
        const historyManager = new HistoryManager();
        const commandEngine = new CommandEngine(circuit, null, historyManager, engine);

        const scriptText = `# Full adder script
expr S = (A XOR B) XOR Cin
expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
`;

        const res = commandEngine.executeScript(scriptText);
        assert(res.success, `Script failed: ${res.error}`);

        assert(circuit.components.has("A"), "Input A should exist");
        assert(circuit.components.has("B"), "Input B should exist");
        assert(circuit.components.has("Cin"), "Input Cin should exist");
        assert(circuit.components.has("S"), "Output S should exist");
        assert(circuit.components.has("Cout"), "Output Cout should exist");

        // Test error in script transaction rollback
        const badScript = `
expr Y = A AND B
expr Z = A AND (B OR
`;
        const badRes = commandEngine.executeScript(badScript);
        assert(!badRes.success, "Bad script should fail on syntax error");
        assert.strictEqual(badRes.line, 3, "Failure line should be 3");
    }

    console.log("Boolean Expression Synthesis unit tests passed successfully!");
}

runTests();
