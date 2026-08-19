/**
 * Script parser and loop expander for .sim circuit scripts.
 * Supports:
 * - Simple for loops: `for VAR in START..END { ... }`
 * - Descending and ascending ranges: `0..7`, `7..0`
 * - Module blocks: `module Name { ... }`
 * - Simple integer arithmetic in indices, coordinates, and math expressions
 * - Nested loops with local scoping
 * - Safety execution limits (nesting depth, total iterations, expanded commands)
 * - Line number and loop iteration tracking for error reporting
 */

import { Circuit, Wire, Bus } from "./core.js";
import { ModuleDefinition, ModuleDependencyGraph } from "./modules.js";
import { serializeCircuit, findDefinitionByNameAndType } from "./serialization.js";

const MAX_NESTING_DEPTH = 5;
const MAX_TOTAL_ITERATIONS = 100000;
const MAX_EXPANDED_COMMANDS = 50000;

/**
 * Evaluate a simple integer arithmetic expression string given a variable scope map.
 * Supports: +, -, *, /, %, (), numbers, and variable references.
 * @param {string} exprStr
 * @param {Object.<string, number>} scope
 * @returns {number}
 */
export function evaluateIntExpression(exprStr, scope = {}) {
    if (typeof exprStr !== "string") {
        throw new Error(`Invalid expression: ${exprStr}`);
    }

    const trimmed = exprStr.trim();
    if (!trimmed) {
        throw new Error("Empty expression in arithmetic evaluation");
    }

    // Tokenize
    const tokens = [];
    let i = 0;
    while (i < trimmed.length) {
        const ch = trimmed[i];

        if (/\s/.test(ch)) {
            i++;
            continue;
        }

        if (/\d/.test(ch)) {
            let numStr = "";
            while (i < trimmed.length && /\d/.test(trimmed[i])) {
                numStr += trimmed[i];
                i++;
            }
            tokens.push({ type: "NUM", value: parseInt(numStr, 10) });
            continue;
        }

        if (/[a-zA-Z_]/.test(ch)) {
            let varName = "";
            while (i < trimmed.length && /[a-zA-Z0-9_]/.test(trimmed[i])) {
                varName += trimmed[i];
                i++;
            }
            if (Object.prototype.hasOwnProperty.call(scope, varName)) {
                tokens.push({ type: "NUM", value: scope[varName] });
            } else {
                throw new Error(`Undefined variable '${varName}' in expression '${exprStr}'`);
            }
            continue;
        }

        if (["+", "-", "*", "/", "%", "(", ")"].includes(ch)) {
            tokens.push({ type: "OP", value: ch });
            i++;
            continue;
        }

        throw new Error(`Unexpected character '${ch}' in arithmetic expression '${exprStr}'`);
    }

    // Parser for arithmetic expressions (unary +, -, binary +, -, *, /, %, parens)
    let pos = 0;

    function parseExpr() {
        let left = parseTerm();
        while (pos < tokens.length && tokens[pos].type === "OP" && ["+", "-"].includes(tokens[pos].value)) {
            const op = tokens[pos++].value;
            const right = parseTerm();
            if (op === "+") left += right;
            else left -= right;
        }
        return left;
    }

    function parseTerm() {
        let left = parseFactor();
        while (pos < tokens.length && tokens[pos].type === "OP" && ["*", "/", "%"].includes(tokens[pos].value)) {
            const op = tokens[pos++].value;
            const right = parseFactor();
            if (op === "*") left *= right;
            else if (op === "/") {
                if (right === 0) throw new Error("Division by zero in arithmetic expression");
                left = Math.floor(left / right);
            } else if (op === "%") {
                if (right === 0) throw new Error("Modulo by zero in arithmetic expression");
                left = left % right;
            }
        }
        return left;
    }

    function parseFactor() {
        if (pos >= tokens.length) {
            throw new Error(`Unexpected end of expression in '${exprStr}'`);
        }
        const tok = tokens[pos++];
        if (tok.type === "NUM") {
            return tok.value;
        }
        if (tok.type === "OP" && tok.value === "+") {
            return parseFactor();
        }
        if (tok.type === "OP" && tok.value === "-") {
            return -parseFactor();
        }
        if (tok.type === "OP" && tok.value === "(") {
            const val = parseExpr();
            if (pos >= tokens.length || tokens[pos].type !== "OP" || tokens[pos].value !== ")") {
                throw new Error(`Missing closing ')' in expression '${exprStr}'`);
            }
            pos++; // consume ')'
            return val;
        }
        throw new Error(`Unexpected token '${tok.value}' in expression '${exprStr}'`);
    }

    const result = parseExpr();
    if (pos < tokens.length) {
        throw new Error(`Unexpected token '${tokens[pos].value}' at end of expression '${exprStr}'`);
    }

    return result;
}

/**
 * Expand range string like `0..7` or `7..0` into array of numbers.
 * @param {string} rangeStr
 * @param {Object.<string, number>} scope
 * @returns {number[]}
 */
export function expandRange(rangeStr, scope = {}) {
    const dotsIdx = rangeStr.indexOf("..");
    if (dotsIdx === -1) {
        throw new Error(`Invalid range syntax '${rangeStr}', expected START..END`);
    }

    const startStr = rangeStr.substring(0, dotsIdx).trim();
    const endStr = rangeStr.substring(dotsIdx + 2).trim();

    if (!startStr || !endStr) {
        throw new Error(`Invalid range syntax '${rangeStr}', expected START..END`);
    }

    const start = evaluateIntExpression(startStr, scope);
    const end = evaluateIntExpression(endStr, scope);

    const result = [];
    if (start <= end) {
        for (let i = start; i <= end; i++) {
            result.push(i);
        }
    } else {
        for (let i = start; i >= end; i--) {
            result.push(i);
        }
    }

    return result;
}

/**
 * Perform variable and math substitution on a single command string.
 * Evaluates `[EXPR]` array index expressions and `to (EXPR, EXPR)` or `by (EXPR, EXPR)` coordinates.
 * @param {string} commandStr
 * @param {Object.<string, number>} scope
 * @returns {string}
 */
export function substituteCommand(commandStr, scope) {
    if (Object.keys(scope).length === 0) {
        return commandStr;
    }

    let result = commandStr;

    // 1. Substitute array brackets: e.g. G[i], G[i + 1], G[row][col]
    // Replace [EXPR] with evaluated [INT]
    result = result.replace(/\[([^\]]+)\]/g, (match, inner) => {
        try {
            const val = evaluateIntExpression(inner, scope);
            return `[${val}]`;
        } catch (e) {
            return match; // If not arithmetic/variable, keep intact
        }
    });

    // 2. Substitute coordinate tuples: to (EXPR, EXPR) or by (EXPR, EXPR)
    result = result.replace(/\b(to|by)\s*\(\s*([^,]+)\s*,\s*([^\)]+)\s*\)/g, (match, rel, xExpr, yExpr) => {
        try {
            const xVal = evaluateIntExpression(xExpr, scope);
            const yVal = evaluateIntExpression(yExpr, scope);
            return `${rel} (${xVal},${yVal})`;
        } catch (e) {
            return match;
        }
    });

    // 3. Substitute frequency/numeric values: set CLK.freq (i + 1)MHz
    result = result.replace(/\bset\s+([a-zA-Z0-9_\[\]\.]+)\s+\(([^)]+)\)([a-zA-Z]*)/g, (match, target, expr, unit) => {
        try {
            const val = evaluateIntExpression(expr, scope);
            return `set ${target} ${val}${unit}`;
        } catch (e) {
            return match;
        }
    });

    return result;
}

/**
 * Preprocess and expand a .sim script string into a list of executable commands with source mapping.
 * @param {string} scriptText
 * @returns {Array<{ line: number, command: string, loopContext?: string }>}
 */
export function expandScript(scriptText) {
    if (typeof scriptText !== "string") {
        throw new Error("Invalid script content");
    }

    const rawLines = scriptText.split(/\r?\n/);
    const expandedList = [];

    let totalIterations = 0;

    /**
     * Recursive block processor
     * @param {number} lineIdx - current line index in rawLines
     * @param {Object.<string, number>} scope - current loop variable scope
     * @param {number} depth - nesting depth
     * @param {string[]} loopStack - stack of "var = val" strings
     * @returns {number} next lineIdx to process
     */
    function processBlock(lineIdx, scope, depth, loopStack) {
        if (depth > MAX_NESTING_DEPTH) {
            throw new Error(`Maximum loop nesting depth (${MAX_NESTING_DEPTH}) exceeded`);
        }

        while (lineIdx < rawLines.length) {
            const lineNum = lineIdx + 1; // 1-based index
            let rawLine = rawLines[lineIdx];

            // Strip '#' comments
            const commentIdx = rawLine.indexOf("#");
            if (commentIdx !== -1) {
                rawLine = rawLine.substring(0, commentIdx);
            }

            const trimmed = rawLine.trim();

            if (!trimmed) {
                lineIdx++;
                continue;
            }

            if (trimmed === "}") {
                return lineIdx; // End of block
            }

            // Check for module definition block: `module ModuleName {`
            const moduleMatch = trimmed.match(/^module\s+(.+?)\s*\{$/i);
            if (moduleMatch && depth === 0) {
                const moduleName = moduleMatch[1];
                const moduleStartLine = lineNum;
                const moduleBodyLines = [];

                let blockDepth = 1;
                let bodyEndLine = lineIdx + 1;
                while (bodyEndLine < rawLines.length && blockDepth > 0) {
                    let bodyRaw = rawLines[bodyEndLine];
                    const cIdx = bodyRaw.indexOf("#");
                    if (cIdx !== -1) bodyRaw = bodyRaw.substring(0, cIdx);
                    const bTrim = bodyRaw.trim();

                    if ((bTrim.startsWith("for ") || bTrim.startsWith("module ")) && bTrim.endsWith("{")) {
                        blockDepth++;
                    } else if (bTrim === "}") {
                        blockDepth--;
                    }

                    if (blockDepth > 0) {
                        moduleBodyLines.push(rawLines[bodyEndLine]);
                        bodyEndLine++;
                    }
                }

                if (blockDepth !== 0) {
                    throw new Error(`Unclosed 'module' block starting at line ${moduleStartLine}`);
                }

                expandedList.push({
                    line: moduleStartLine,
                    command: `__MODULE_DEF__ ${moduleName}`,
                    moduleDef: {
                        name: moduleName,
                        startLine: moduleStartLine,
                        rawBodyText: moduleBodyLines.join("\n")
                    }
                });

                lineIdx = bodyEndLine + 1;
                continue;
            }

            // Check for loop statement: `for VAR in RANGE {`
            const forMatch = trimmed.match(/^for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+([^\s\{]+)\s*\{$/i);
            if (forMatch) {
                const varName = forMatch[1];
                const rangeStr = forMatch[2];

                const values = expandRange(rangeStr, scope);
                const loopBodyStartLine = lineIdx + 1;

                // Collect lines inside loop block
                let blockDepth = 1;
                let bodyEndLine = loopBodyStartLine;
                while (bodyEndLine < rawLines.length && blockDepth > 0) {
                    let bodyRaw = rawLines[bodyEndLine];
                    const cIdx = bodyRaw.indexOf("#");
                    if (cIdx !== -1) bodyRaw = bodyRaw.substring(0, cIdx);
                    const bTrim = bodyRaw.trim();

                    if (bTrim.startsWith("for ") && bTrim.endsWith("{")) {
                        blockDepth++;
                    } else if (bTrim === "}") {
                        blockDepth--;
                    }
                    if (blockDepth > 0) {
                        bodyEndLine++;
                    }
                }

                if (blockDepth !== 0) {
                    throw new Error(`Unclosed 'for' loop starting at line ${lineNum}`);
                }

                // Iterate over loop values
                for (const val of values) {
                    totalIterations++;
                    if (totalIterations > MAX_TOTAL_ITERATIONS) {
                        throw new Error(`Maximum total loop iterations (${MAX_TOTAL_ITERATIONS}) exceeded`);
                    }

                    // Shadow/bind loop variable in new scope copy
                    const newScope = { ...scope, [varName]: val };
                    const newLoopStack = [...loopStack, `${varName} = ${val}`];

                    // Process body for this iteration
                    let innerLineIdx = loopBodyStartLine;
                    while (innerLineIdx < bodyEndLine) {
                        innerLineIdx = processBlock(innerLineIdx, newScope, depth + 1, newLoopStack);
                        innerLineIdx++;
                    }
                }

                lineIdx = bodyEndLine + 1;
                continue;
            }

            // Normal command line
            const substitutedCmd = substituteCommand(trimmed, scope);
            const loopContextStr = loopStack.length > 0 ? `Loop iteration: ${loopStack.join(", ")}` : undefined;

            expandedList.push({
                line: lineNum,
                command: substitutedCmd,
                loopContext: loopContextStr
            });

            if (expandedList.length > MAX_EXPANDED_COMMANDS) {
                throw new Error(`Maximum expanded script commands (${MAX_EXPANDED_COMMANDS}) exceeded`);
            }

            lineIdx++;
        }

        return lineIdx;
    }

    processBlock(0, {}, 0, []);

    return expandedList;
}

/**
 * Build a dependency graph for a set of script module blocks and existing registered modules.
 * @param {Array<{ name: string, startLine: number, rawBodyText: string }>} moduleDefs
 * @param {ModuleRegistry} [registry]
 * @returns {ModuleDependencyGraph}
 */
export function buildScriptModuleDependencyGraph(moduleDefs, registry) {
    const graph = new ModuleDependencyGraph();

    const moduleMap = new Map();
    for (const mDef of moduleDefs) {
        moduleMap.set(mDef.name.toLowerCase(), mDef);
        graph.addModule(mDef.name);
    }

    if (registry) {
        for (const regDef of registry.definitions.values()) {
            graph.addModule(regDef.name);
            for (const depName of regDef.dependencies || []) {
                graph.addDependency(regDef.name, depName);
            }
        }
    }

    for (const mDef of moduleDefs) {
        let expandedBody;
        try {
            expandedBody = expandScript(mDef.rawBodyText);
        } catch (e) {
            continue;
        }

        for (const item of expandedBody) {
            const parts = item.command.trim().split(/\s+/);
            if (parts.length >= 3 && parts[0].toLowerCase() === "add") {
                const rawTypeStr = parts.slice(1, -1).join(" ").trim();
                const lowerType = rawTypeStr.toLowerCase();

                if (lowerType === mDef.name.toLowerCase()) {
                    graph.addDependency(mDef.name, mDef.name);
                } else if (moduleMap.has(lowerType)) {
                    const targetMDef = moduleMap.get(lowerType);
                    graph.addDependency(mDef.name, targetMDef.name);
                } else if (registry) {
                    for (const existingDef of registry.definitions.values()) {
                        if (existingDef.name.toLowerCase() === lowerType) {
                            graph.addDependency(mDef.name, existingDef.name);
                        }
                    }
                }
            }
        }
    }

    return graph;
}

/**
 * Compile a scripted module definition into a ModuleDefinition instance.
 * @param {string} moduleName
 * @param {string} rawBodyText
 * @param {number} startLine
 * @param {ModuleRegistry} registry
 * @param {typeof CommandEngine} CommandEngineClass
 * @param {typeof SimulationEngine} SimulationEngineClass
 * @returns {ModuleDefinition}
 */
export function compileModuleDefinition(moduleName, rawBodyText, startLine, registry, CommandEngineClass, SimulationEngineClass) {
    // 1. Expand script inside module body
    let bodyCommands;
    try {
        bodyCommands = expandScript(rawBodyText);
    } catch (e) {
        throw new Error(`Module ${moduleName}:\nLine ${startLine}:\n${e.message}`);
    }

    // Temporary circuit graph for compiling and validating the internal module subcircuit
    const tempCircuit = new Circuit();
    const tempEngine = SimulationEngineClass ? new SimulationEngineClass(tempCircuit) : null;
    const tempCmdEngine = new CommandEngineClass(tempCircuit, registry, null, tempEngine);

    const inputsSet = new Set();
    const outputsSet = new Set();
    const inputNames = [];
    const outputNames = [];

    // Process body commands
    for (const item of bodyCommands) {
        const lineNum = startLine + item.line;
        const cmdStr = item.command.trim();
        const parts = cmdStr.split(/\s+/);
        if (parts.length === 0 || !parts[0]) continue;

        const verb = parts[0].toLowerCase();

        // 2. Handle port declarations: `input NAME` or `input NAME[START..END]`
        if (verb === "input" || verb === "output") {
            if (parts.length < 2) {
                throw new Error(`Module ${moduleName}:\nLine ${lineNum}:\nSyntax: ${verb} NAME or ${verb} NAME[START..END]`);
            }

            const portDecl = parts[1];
            const isInput = verb === "input";
            const targetSet = isInput ? inputsSet : outputsSet;
            const targetList = isInput ? inputNames : outputNames;

            // Check if vector port: NAME[START..END]
            const busMatch = portDecl.match(/^([a-zA-Z][a-zA-Z0-9_]*)\[(\d+)\.\.(\d+)\]$/);
            if (busMatch) {
                const portName = busMatch[1];
                const start = parseInt(busMatch[2], 10);
                const end = parseInt(busMatch[3], 10);

                const bus = new Bus(portName, start, end);
                tempCircuit.addBus(bus);

                for (const member of bus.members) {
                    if (inputsSet.has(member) || outputsSet.has(member)) {
                        throw new Error(`Module ${moduleName}:\nLine ${lineNum}:\nDuplicate port declaration '${member}'`);
                    }
                    targetSet.add(member);
                    targetList.push(member);

                    // Add gate to temporary circuit
                    const addRes = tempCmdEngine.execute(`add ${verb} ${member}`);
                    if (!addRes.success) {
                        throw new Error(`Module ${moduleName}:\nLine ${lineNum}:\n${addRes.error}`);
                    }
                }
            } else {
                const portName = portDecl;
                if (!/^[a-zA-Z][a-zA-Z0-9_]*(\[\d+\])*$/.test(portName)) {
                    throw new Error(`Module ${moduleName}:\nLine ${lineNum}:\nInvalid ${verb} pin name '${portName}'`);
                }

                if (inputsSet.has(portName) || outputsSet.has(portName)) {
                    throw new Error(`Module ${moduleName}:\nLine ${lineNum}:\nDuplicate port declaration '${portName}'`);
                }

                targetSet.add(portName);
                targetList.push(portName);

                const addRes = tempCmdEngine.execute(`add ${verb} ${portName}`);
                if (!addRes.success) {
                    throw new Error(`Module ${moduleName}:\nLine ${lineNum}:\n${addRes.error}`);
                }
            }
            continue;
        }

        // 3. Handle internal component addition & check recursive instantiation
        if (verb === "add") {
            const rawTypeStr = parts.slice(1, -1).join(" ").trim();
            if (rawTypeStr.toLowerCase() === moduleName.toLowerCase()) {
                throw new Error(`Cannot compile module ${moduleName}.\nCircular module dependency: ${moduleName} → ${moduleName} (cannot instantiate module '${moduleName}' recursively)`);
            }
        }

        // Execute internal command
        const execRes = tempCmdEngine.execute(cmdStr);
        if (!execRes.success) {
            const ctxStr = item.loopContext ? `${item.loopContext}\n` : "";
            throw new Error(`Module ${moduleName}:\nLine ${lineNum}:\n${ctxStr}${execRes.error}`);
        }
    }

    // 4. Validate output drivers if internal logic gates exist
    const hasInternalGates = Array.from(tempCircuit.components.values()).some(
        c => c.type !== "Input" && c.type !== "Output"
    );

    if (hasInternalGates) {
        for (const outName of outputNames) {
            const outComp = tempCircuit.components.get(outName);
            if (outComp && outComp.type === "Output") {
                const inPin = outComp.inputs[0];
                let isDriven = false;
                for (const wire of tempCircuit.wires.values()) {
                    if (wire.toPin === inPin) {
                        isDriven = true;
                        break;
                    }
                }
                if (!isDriven) {
                    throw new Error(`Module ${moduleName}:\nDeclared output '${outName}' has no driver`);
                }
            }
        }
    }

    // 5. Serialize internal circuit
    const serialized = serializeCircuit(tempCircuit, registry);

    const sortedInputs = inputNames;
    const sortedOutputs = outputNames;

    const modId = `mod_${moduleName.toLowerCase().replace(/[^a-z0-9_]/g, "_")}`;

    const dependenciesSet = new Set();
    for (const comp of tempCircuit.components.values()) {
        if (comp.type === "UserModule" && comp.definition) {
            dependenciesSet.add(comp.definition.name);
        }
    }

    const def = new ModuleDefinition(
        modId,
        moduleName,
        `Script-defined module ${moduleName}`,
        "Custom",
        sortedInputs,
        sortedOutputs,
        serialized.components,
        serialized.wires,
        "Module",
        "Custom",
        Array.from(dependenciesSet)
    );

    return def;
}
