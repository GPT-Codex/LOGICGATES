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

/**
 * Normalize file path string.
 * @param {string} pathStr
 * @returns {string}
 */
export function normalizePath(pathStr) {
    if (typeof pathStr !== "string") return "";
    const parts = pathStr.replace(/\\/g, "/").split("/");
    const stack = [];
    for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") {
            if (stack.length > 0) stack.pop();
        } else {
            stack.push(part);
        }
    }
    return stack.join("/");
}

/**
 * Resolve an import path relative to the importing file's directory.
 * @param {string} importPath
 * @param {string} [importingFilePath]
 * @returns {string}
 */
export function resolveImportPath(importPath, importingFilePath = "main.sim") {
    const cleanImport = importPath.trim().replace(/^['"]|['"]$/g, "");
    if (cleanImport.startsWith("/")) {
        return normalizePath(cleanImport);
    }
    const lastSlash = importingFilePath.replace(/\\/g, "/").lastIndexOf("/");
    const parentDir = lastSlash !== -1 ? importingFilePath.substring(0, lastSlash) : "";
    const combined = parentDir ? `${parentDir}/${cleanImport}` : cleanImport;
    return normalizePath(combined);
}

/**
 * Default file loader for reading imported .sim scripts.
 * @param {string} filePath
 * @param {Object.<string, string>} [virtualFiles]
 * @returns {string}
 */
export function defaultFileResolver(filePath, virtualFiles = {}) {
    const normPath = normalizePath(filePath);
    if (virtualFiles && Object.prototype.hasOwnProperty.call(virtualFiles, normPath)) {
        return virtualFiles[normPath];
    }
    if (typeof process !== "undefined" && process.versions && process.versions.node) {
        try {
            const fs = eval("require('fs')");
            if (fs.existsSync(normPath)) {
                return fs.readFileSync(normPath, "utf-8");
            }
            const altLibPath = "data/libraries/" + normPath;
            if (fs.existsSync(altLibPath)) {
                return fs.readFileSync(altLibPath, "utf-8");
            }
            const altModPath = "data/modules/" + normPath;
            if (fs.existsSync(altModPath)) {
                return fs.readFileSync(altModPath, "utf-8");
            }
        } catch (e) {
            // fs not available
        }
    }
    throw new Error(`File not found: '${filePath}'`);
}

/**
 * Dependency graph for tracking imported script files and detecting circular imports.
 */
export class ImportDependencyGraph {
    constructor() {
        this.nodes = new Set();
        this.adj = new Map();
    }

    addFile(filePath) {
        const norm = normalizePath(filePath);
        this.nodes.add(norm);
        if (!this.adj.has(norm)) {
            this.adj.set(norm, new Set());
        }
    }

    addImportDependency(fromFile, toFile) {
        const normFrom = normalizePath(fromFile);
        const normTo = normalizePath(toFile);
        this.addFile(normFrom);
        this.addFile(normTo);
        this.adj.get(normFrom).add(normTo);
    }

    detectCycle() {
        const visited = new Set();
        const recStack = new Set();
        const path = [];

        for (const root of this.nodes) {
            if (!visited.has(root)) {
                const res = this._dfsCycle(root, visited, recStack, path);
                if (res) return res;
            }
        }
        return null;
    }

    _dfsCycle(u, visited, recStack, path) {
        visited.add(u);
        recStack.add(u);
        path.push(u);

        const neighbors = this.adj.get(u) || new Set();
        for (const v of neighbors) {
            if (!visited.has(v)) {
                const res = this._dfsCycle(v, visited, recStack, path);
                if (res) return res;
            } else if (recStack.has(v)) {
                const startIdx = path.indexOf(v);
                const cyclePath = path.slice(startIdx);
                cyclePath.push(v);
                return cyclePath;
            }
        }

        path.pop();
        recStack.delete(u);
        return null;
    }

    getCompilationOrder() {
        const cycle = this.detectCycle();
        if (cycle) {
            throw new Error(`Circular import:\n${cycle.join(" -> ")}`);
        }

        const visited = new Set();
        const order = [];

        for (const node of this.nodes) {
            if (!visited.has(node)) {
                this._dfsTopo(node, visited, order);
            }
        }

        return order;
    }

    _dfsTopo(u, visited, order) {
        visited.add(u);
        const neighbors = this.adj.get(u) || new Set();
        for (const v of neighbors) {
            if (!visited.has(v)) {
                this._dfsTopo(v, visited, order);
            }
        }
        order.push(u);
    }
}

/**
 * Process import statements recursively across a script and its dependencies.
 * @param {string} mainScriptText
 * @param {string} [mainFilePath]
 * @param {Object} [options]
 * @returns {{ resolvedConstants: Object.<string, number>, importedModuleDefs: Array, importedFiles: Set<string>, importGraph: ImportDependencyGraph, libraryMetadata: Map<string, Object> }}
 */
export function processScriptImports(mainScriptText, mainFilePath = "main.sim", options = {}) {
    const fileResolver = options.fileResolver || ((path) => defaultFileResolver(path, options.virtualFiles));
    const mainNormPath = normalizePath(mainFilePath) || "main.sim";

    const importGraph = new ImportDependencyGraph();
    importGraph.addFile(mainNormPath);

    const fileTexts = new Map();
    fileTexts.set(mainNormPath, mainScriptText);

    // Recursively collect imports
    function collectImports(currPath, scriptContent) {
        const lines = scriptContent.split(/\r?\n/);
        for (const rawLine of lines) {
            let line = rawLine;
            const cIdx = line.indexOf("#");
            if (cIdx !== -1) line = line.substring(0, cIdx);
            const trimmed = line.trim();

            const importMatch = trimmed.match(/^import\s+["']([^"']+)["']/i);
            if (importMatch) {
                const rawImport = importMatch[1];
                const resolvedTarget = resolveImportPath(rawImport, currPath);

                importGraph.addImportDependency(currPath, resolvedTarget);

                if (!fileTexts.has(resolvedTarget)) {
                    try {
                        const targetContent = fileResolver(resolvedTarget);
                        fileTexts.set(resolvedTarget, targetContent);
                        collectImports(resolvedTarget, targetContent);
                    } catch (e) {
                        throw new Error(`Error compiling ${currPath}:\nCannot import '${rawImport}': ${e.message}`);
                    }
                }
            }
        }
    }

    collectImports(mainNormPath, mainScriptText);

    // Check for circular imports
    const cycle = importGraph.detectCycle();
    if (cycle) {
        throw new Error(`Circular import:\n${cycle.join(" -> ")}`);
    }

    const topoOrder = importGraph.getCompilationOrder();

    let combinedConstantsScope = { ...(options.initialScope || {}) };
    const importedModuleDefs = [];
    const libraryMetadata = new Map();

    const moduleSourceMap = new Map();   // moduleName (lower) -> filePath
    const constSourceMap = new Map();    // constName (lower) -> filePath

    for (const filePath of topoOrder) {
        if (filePath === mainNormPath) continue; // mainScriptText executed separately

        const scriptContent = fileTexts.get(filePath) || "";
        const lines = scriptContent.split(/\r?\n/);

        // 1. Resolve constants in imported file
        try {
            const fileConstants = resolveConstantsInBlock(lines, combinedConstantsScope);

            for (const [key, val] of Object.entries(fileConstants)) {
                if (!(key in combinedConstantsScope)) {
                    const lowerK = key.toLowerCase();
                    if (constSourceMap.has(lowerK) && constSourceMap.get(lowerK) !== filePath) {
                        throw new Error(`Import conflict:\nConstant '${key}' is already defined.\nSource: ${constSourceMap.get(lowerK)}\nConflict: ${filePath}`);
                    }
                    constSourceMap.set(lowerK, filePath);
                }
            }

            combinedConstantsScope = fileConstants;
        } catch (e) {
            throw new Error(`Error compiling ${filePath}:\n${e.message}`);
        }

        // 2. Extract module blocks from imported file
        const expanded = expandScript(scriptContent, combinedConstantsScope);
        const scriptMods = expanded.filter(item => item.moduleDef).map(item => item.moduleDef);

        const fileModNames = [];
        for (const mDef of scriptMods) {
            const lowerName = mDef.name.toLowerCase();
            if (moduleSourceMap.has(lowerName) && moduleSourceMap.get(lowerName) !== filePath) {
                throw new Error(`Import conflict:\nModule '${mDef.name}' is already defined.\nSource: ${moduleSourceMap.get(lowerName)}\nConflict: ${filePath}`);
            }
            moduleSourceMap.set(lowerName, filePath);
            mDef.sourceFile = filePath;
            importedModuleDefs.push(mDef);
            fileModNames.push(mDef.name);
        }

        libraryMetadata.set(filePath, {
            filePath,
            imports: Array.from(importGraph.adj.get(filePath) || []),
            constants: Object.keys(combinedConstantsScope),
            modules: fileModNames
        });
    }

    return {
        resolvedConstants: combinedConstantsScope,
        importedModuleDefs,
        importedFiles: new Set(topoOrder.filter(p => p !== mainNormPath)),
        importGraph,
        libraryMetadata
    };
}
import { serializeCircuit, findDefinitionByNameAndType } from "./serialization.js";

const MAX_NESTING_DEPTH = 5;
const MAX_TOTAL_ITERATIONS = 100000;
const MAX_EXPANDED_COMMANDS = 50000;
const MAX_MODULE_WIDTH = 256;

/**
 * Validate parameter arguments against parameter declarations.
 * @param {string[]} paramNames
 * @param {any[]} argValues
 * @param {string} moduleName
 * @param {string} [instanceName]
 * @returns {Object.<string, number>}
 */
export function parseAndValidateModuleArgs(paramNames, argsStr, moduleName, instanceName = "") {
    const instHeader = instanceName ? ` as ${instanceName}` : "";

    if (!paramNames || paramNames.length === 0) {
        if (argsStr && argsStr.trim()) {
            throw new Error(`Cannot instantiate ${moduleName}${instHeader}:\nModule '${moduleName}' does not accept parameters.`);
        }
        return {};
    }

    if (!argsStr || !argsStr.trim()) {
        const missingParam = paramNames[0];
        throw new Error(`Cannot instantiate ${moduleName}${instHeader}:\nParameter '${missingParam}' is required.\nExpected ${paramNames.length} parameter(s) (${paramNames.join(", ")}), received 0.`);
    }

    const rawArgs = argsStr.split(",").map(a => a.trim()).filter(Boolean);
    const argValues = new Array(paramNames.length);
    let hasNamed = false;

    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (arg.includes("=")) {
            hasNamed = true;
            const eqIdx = arg.indexOf("=");
            const pName = arg.substring(0, eqIdx).trim();
            const pVal = arg.substring(eqIdx + 1).trim();
            const idx = paramNames.findIndex(p => p.toLowerCase() === pName.toLowerCase());
            if (idx === -1) {
                throw new Error(`Cannot instantiate ${moduleName}${instHeader}:\nUnknown parameter '${pName}'. Expected one of: ${paramNames.join(", ")}.`);
            }
            argValues[idx] = pVal;
        } else {
            if (hasNamed) {
                throw new Error(`Cannot mix positional arguments after named arguments in instantiation of '${moduleName}'.`);
            }
            if (i < paramNames.length) {
                argValues[i] = arg;
            } else {
                throw new Error(`Cannot instantiate ${moduleName}${instHeader}:\nToo many arguments provided.\nExpected ${paramNames.length} parameter(s) (${paramNames.join(", ")}), received ${rawArgs.length}.`);
            }
        }
    }

    return validateModuleParameters(paramNames, argValues, moduleName, instanceName);
}

export function validateModuleParameters(paramNames, argValues, moduleName, instanceName = "") {
    const instHeader = instanceName ? ` as ${instanceName}` : "";

    if (!paramNames || paramNames.length === 0) {
        if (argValues && argValues.length > 0) {
            throw new Error(`Cannot instantiate ${moduleName}${instHeader}:\nModule '${moduleName}' does not accept parameters.\nReceived: ${argValues.length} argument(s).`);
        }
        return {};
    }

    const providedCount = argValues ? argValues.filter(v => v !== undefined).length : 0;

    if (providedCount < paramNames.length) {
        let missingParam = paramNames[0];
        for (let i = 0; i < paramNames.length; i++) {
            if (!argValues || argValues[i] === undefined) {
                missingParam = paramNames[i];
                break;
            }
        }
        throw new Error(`Cannot instantiate ${moduleName}${instHeader}:\nParameter '${missingParam}' is required.\nExpected ${paramNames.length} parameter(s) (${paramNames.join(", ")}), received ${providedCount}.`);
    }

    if (argValues.length > paramNames.length) {
        throw new Error(`Cannot instantiate ${moduleName}${instHeader}:\nToo many arguments provided.\nExpected ${paramNames.length} parameter(s) (${paramNames.join(", ")}), received ${argValues.length}.`);
    }

    const paramScope = {};

    for (let i = 0; i < paramNames.length; i++) {
        const pName = paramNames[i];
        const rawArg = argValues[i];

        let numVal = parseInt(rawArg, 10);
        if (typeof rawArg === "number") {
            numVal = rawArg;
        }

        if (isNaN(numVal)) {
            throw new Error(`Cannot instantiate ${moduleName}${instHeader}:\nParameter '${pName}' must be an integer.\nReceived: "${rawArg}".`);
        }

        const lowerPName = pName.toLowerCase();
        if (lowerPName.includes("width") || lowerPName.includes("size") || lowerPName.includes("count") || lowerPName.includes("stage") || lowerPName.includes("bit")) {
            if (numVal <= 0) {
                throw new Error(`Cannot instantiate ${moduleName}${instHeader}:\nParameter '${pName}' must be a positive integer.\nReceived: ${numVal}`);
            }
        }

        if (numVal > MAX_MODULE_WIDTH) {
            throw new Error(`Cannot instantiate ${moduleName}${instHeader}:\nParameter '${pName}' value (${numVal}) exceeds maximum safety limit (${MAX_MODULE_WIDTH}).`);
        }

        paramScope[pName] = numVal;
    }

    return paramScope;
}

/**
 * Extract variable identifier references from an arithmetic expression string.
 * @param {string} exprStr
 * @returns {string[]}
 */
export function findVariableReferencesInExpr(exprStr) {
    const refs = new Set();
    const regex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    let match;
    while ((match = regex.exec(exprStr)) !== null) {
        refs.add(match[1]);
    }
    return Array.from(refs);
}

/**
 * Pre-resolve constant declarations (`const NAME = EXPR`) in a script block.
 * Handles topological evaluation, dependency resolution, cycle detection, and reassignment rejection.
 * @param {string[]} lines
 * @param {Object.<string, number>} [outerScope]
 * @returns {Object.<string, number>}
 */
export function resolveConstantsInBlock(lines, outerScope = {}) {
    const constDecls = [];
    const constMap = new Map();

    for (let idx = 0; idx < lines.length; idx++) {
        const lineNum = idx + 1;
        let line = lines[idx];
        const cIdx = line.indexOf("#");
        if (cIdx !== -1) line = line.substring(0, cIdx);
        const trimmed = line.trim();

        const match = trimmed.match(/^const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/i);
        if (match) {
            const name = match[1];
            const exprStr = match[2].trim();
            const lowerName = name.toLowerCase();

            if (constMap.has(lowerName)) {
                throw new Error(`Line ${lineNum}:\nCannot reassign constant '${name}'`);
            }

            const decl = { name, exprStr, lineNum, deps: [] };
            constDecls.push(decl);
            constMap.set(lowerName, decl);
        }
    }

    if (constDecls.length === 0) {
        return { ...outerScope };
    }

    // Identify constant dependencies
    for (const decl of constDecls) {
        const refs = findVariableReferencesInExpr(decl.exprStr);
        for (const ref of refs) {
            if (constMap.has(ref.toLowerCase())) {
                decl.deps.push(constMap.get(ref.toLowerCase()).name);
            }
        }
    }

    // Cycle detection using DFS
    const visited = new Set();
    const recStack = new Set();
    const path = [];

    function dfs(nodeName) {
        visited.add(nodeName);
        recStack.add(nodeName);
        path.push(nodeName);

        const decl = constMap.get(nodeName.toLowerCase());
        if (decl) {
            for (const dep of decl.deps) {
                const depLower = dep.toLowerCase();
                if (!visited.has(depLower)) {
                    const cycle = dfs(depLower);
                    if (cycle) return cycle;
                } else if (recStack.has(depLower)) {
                    const startIdx = path.findIndex(p => p.toLowerCase() === depLower);
                    const cyclePath = path.slice(startIdx).map(p => constMap.get(p.toLowerCase()).name);
                    cyclePath.push(constMap.get(depLower).name);
                    return cyclePath;
                }
            }
        }

        path.pop();
        recStack.delete(nodeName);
        return null;
    }

    for (const decl of constDecls) {
        const lower = decl.name.toLowerCase();
        if (!visited.has(lower)) {
            const cycle = dfs(lower);
            if (cycle) {
                throw new Error(`Constant dependency cycle:\n${cycle.join(" -> ")}`);
            }
        }
    }

    // Topological evaluation
    const evaluatedScope = { ...outerScope };
    const evalVisited = new Set();

    function evaluateConst(decl) {
        const lower = decl.name.toLowerCase();
        if (evalVisited.has(lower)) return;

        for (const dep of decl.deps) {
            const depDecl = constMap.get(dep.toLowerCase());
            if (depDecl) evaluateConst(depDecl);
        }

        try {
            const val = evaluateIntExpression(decl.exprStr, evaluatedScope);
            evaluatedScope[decl.name] = val;
            evalVisited.add(lower);
        } catch (e) {
            throw new Error(`Line ${decl.lineNum}:\nError evaluating constant '${decl.name}': ${e.message}`);
        }
    }

    for (const decl of constDecls) {
        evaluateConst(decl);
    }

    return evaluatedScope;
}

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

    if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid range bounds in '${rangeStr}' after parameter evaluation.`);
    }

    const result = [];
    if (start <= end) {
        if (start < 0 || end < 0) {
            let paramContext = "";
            if (Object.keys(scope).length > 0) {
                paramContext = "\n" + Object.entries(scope).map(([k, v]) => `Parameter ${k} = ${v}`).join("\n");
            }
            throw new Error(`Invalid range ${rangeStr} after parameter evaluation.\nResolved range: ${start}..${end}${paramContext}`);
        }
        for (let i = start; i <= end; i++) {
            result.push(i);
        }
    } else {
        if (start < 0 || end < 0) {
            let paramContext = "";
            if (Object.keys(scope).length > 0) {
                paramContext = "\n" + Object.entries(scope).map(([k, v]) => `Parameter ${k} = ${v}`).join("\n");
            }
            throw new Error(`Invalid range ${rangeStr} after parameter evaluation.\nResolved range: ${start}..${end}${paramContext}`);
        }
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
    if (!scope || Object.keys(scope).length === 0) {
        return commandStr;
    }

    let result = commandStr;

    // 1. Substitute range brackets: e.g. [0..width-1] or [width-1..0]
    result = result.replace(/\[([^\]\.]+)\.\.([^\]]+)\]/g, (match, startExpr, endExpr) => {
        try {
            const startVal = evaluateIntExpression(startExpr, scope);
            const endVal = evaluateIntExpression(endExpr, scope);
            return `[${startVal}..${endVal}]`;
        } catch (e) {
            return match;
        }
    });

    // 2. Substitute array brackets: e.g. G[i], G[i + 1], G[row][col]
    result = result.replace(/\[([^\]]+)\]/g, (match, inner) => {
        try {
            const val = evaluateIntExpression(inner, scope);
            return `[${val}]`;
        } catch (e) {
            return match; // If not arithmetic/variable, keep intact
        }
    });

    // 3. Substitute type arguments in add command: e.g. add RCA(top_w) ADD16 or add SUB(w = top_w * 2) S1
    result = result.replace(/^(\s*add\s+[a-zA-Z0-9_\s]+)\(([^)]+)\)/i, (match, prefix, argsInside) => {
        try {
            const argParts = argsInside.split(",");
            const evalParts = argParts.map(argStr => {
                const trimmedArg = argStr.trim();
                const eqIdx = trimmedArg.indexOf("=");
                if (eqIdx !== -1) {
                    const paramName = trimmedArg.substring(0, eqIdx).trim();
                    const valExpr = trimmedArg.substring(eqIdx + 1).trim();
                    const val = evaluateIntExpression(valExpr, scope);
                    return `${paramName}=${val}`;
                } else {
                    const val = evaluateIntExpression(trimmedArg, scope);
                    return `${val}`;
                }
            });
            return `${prefix}(${evalParts.join(", ")})`;
        } catch (e) {
            return match;
        }
    });

    // 4. Substitute coordinate tuples: to (EXPR, EXPR) or by (EXPR, EXPR)
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
export function expandScript(scriptText, initialScope = {}) {
    if (typeof scriptText !== "string") {
        throw new Error("Invalid script content");
    }

    const rawLines = scriptText.split(/\r?\n/);
    const resolvedConstantsScope = resolveConstantsInBlock(rawLines, initialScope);
    const expandedList = [];

    let totalIterations = 0;

    /**
     * Recursive block processor
     * @param {number} lineIdx - current line index in rawLines
     * @param {Object.<string, number>} scope - current variable scope
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

            // Skip const and import statements during command expansion as they are pre-resolved compile-time declarations
            if (trimmed.match(/^(const|import)\s+/i)) {
                lineIdx++;
                continue;
            }

            // Check for module definition block: `module ModuleName(params) {` or `module ModuleName {`
            const moduleMatch = trimmed.match(/^module\s+(.+?)(?:\s*\(([^)]*)\))?\s*\{$/i);
            if (moduleMatch && depth === 0) {
                const moduleName = moduleMatch[1];
                const rawParamsStr = moduleMatch[2];
                const params = rawParamsStr ? rawParamsStr.split(",").map(p => p.trim()).filter(Boolean) : [];
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
                        params: params,
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

    processBlock(0, { ...resolvedConstantsScope }, 0, []);

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
export function compileModuleDefinition(moduleName, rawBodyText, startLine, registry, CommandEngineClass, SimulationEngineClass, paramScope = {}, params = []) {
    // 1. Expand script inside module body with parameter scope
    let bodyCommands;
    try {
        bodyCommands = expandScript(rawBodyText, paramScope);
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
        Array.from(dependenciesSet),
        params,
        Object.keys(paramScope).length > 0 ? paramScope : null
    );
    def.rawBodyText = rawBodyText;
    def.startLine = startLine;

    return def;
}
