/**
 * Autocomplete suggestion engine for the .sim circuit script editor.
 * Performs context extraction, partial AST/token inspection, symbol table aggregation,
 * and candidate ranking without modifying circuit graph state or script execution.
 */

import { COMPONENT_REGISTRY } from "../simulation/components.js";
import { naturalCompare } from "../simulation/core.js";

// Source of truth for commands and keywords in the language
export const SCRIPT_COMMANDS = [
    { name: "add", type: "command", desc: "Add a gate, module, or component" },
    { name: "move", type: "command", desc: "Position or translate component" },
    { name: "connect", type: "command", desc: "Connect output pin to input pin" },
    { name: "set", type: "command", desc: "Modify component property" },
    { name: "remove", type: "command", desc: "Delete component and detaches wires" },
    { name: "show", type: "command", desc: "Inspect metadata for component, bus, or module" },
    { name: "trace", type: "command", desc: "Trace signal path through modules" },
    { name: "expand", type: "command", desc: "Display internal component hierarchy" },
    { name: "detach", type: "command", desc: "Expand module instance onto circuit canvas" },
    { name: "list", type: "command", desc: "List all circuit components, buses, and wires" },
    { name: "net", type: "command", desc: "Create a net signal node (buffer pass-through)" },
    { name: "const", type: "command", desc: "Declare compile-time integer constant" },
    { name: "import", type: "command", desc: "Import server library module or alias" },
    { name: "bus", type: "command", desc: "Declare N-bit bus vector" },
    { name: "expr", type: "command", desc: "Synthesize boolean expression into gates" },
    { name: "for", type: "keyword", desc: "Loop over inclusive range" },
    { name: "module", type: "keyword", desc: "Define reusable subcircuit module" },
    { name: "undo", type: "command", desc: "Undo last history state" },
    { name: "redo", type: "command", desc: "Redo last undone state" }
];

export const KEYWORDS = ["input", "output", "in", "as", "to", "by"];

/**
 * Common property options for set command
 */
export const PROPERTY_VALUES = {
    freq: ["Hz", "kHz", "MHz", "GHz"],
    buttonmode: ["press", "hold"],
    ledcolor: ["Red", "Green", "Blue", "RGBA"],
    flipx: ["true", "false"],
    flipy: ["true", "false"],
    rotation: ["0", "90", "180", "270"]
};

export const COMMON_PROPERTIES = [
    { name: "label", type: "property", desc: "Display label text" },
    { name: "freq", type: "property", desc: "Clock frequency (e.g. 50kHz, 1MHz)" },
    { name: "buttonMode", type: "property", desc: "Button trigger mode (press, hold)" },
    { name: "holdDuration", type: "property", desc: "Hold duration in ms" },
    { name: "ledColor", type: "property", desc: "LED color (Red, Green, Blue, RGBA)" },
    { name: "rgbaValue", type: "property", desc: "LED RGBA hex string" },
    { name: "rotation", type: "property", desc: "Visual orientation (0, 90, 180, 270)" },
    { name: "flipX", type: "property", desc: "Horizontal flip (true, false)" },
    { name: "flipY", type: "property", desc: "Vertical flip (true, false)" }
];

/**
 * Cached library module names list from GET /api/import
 */
let cachedServerLibraries = null;

export async function fetchServerLibraries() {
    if (cachedServerLibraries) return cachedServerLibraries;
    try {
        const response = await fetch("/api/import", { method: "GET" });
        const data = await response.json();
        if (data && data.INFO === "OK" && Array.isArray(data.LIBRARIES)) {
            cachedServerLibraries = data.LIBRARIES;
            return cachedServerLibraries;
        }
    } catch (e) {
        // Ignore fetch errors
    }
    return ["logic", "arithmetic"]; // Fallback defaults
}

/**
 * Extract active scope constants and loop variables from full script text up to current line
 * @param {string} fullText
 * @param {number} currentLineIdx - 0-based index
 * @returns {{ constants: Map<string, number|string>, loopVars: Set<string> }}
 */
/**
 * Extract module definitions directly declared in the script source text.
 * Allows unexecuted or forward-declared modules in the editor to be suggested immediately.
 * @param {string} fullText
 * @returns {Array<{ name: string, params: string[], inputs: string[], outputs: string[], type: string, desc: string, detail: string }>}
 */
/**
 * Extract import statements from script text.
 * @param {string} fullText
 * @returns {Array<{ rawImport: string, libName: string, alias: string|null }>}
 */
export function extractScriptImports(fullText) {
    if (!fullText) return [];
    const imports = [];
    const seen = new Set();

    const lines = fullText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const cIdx = line.indexOf("#");
        if (cIdx !== -1) line = line.substring(0, cIdx);
        const trimmed = line.trim();

        const match = trimmed.match(/^import\s+["']([^"']+)["'](?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i);
        if (match) {
            const rawImport = match[1].trim();
            const alias = match[2] ? match[2].trim() : null;
            const key = `${rawImport}:${alias || ""}`;
            if (!seen.has(key)) {
                seen.add(key);
                imports.push({ rawImport, libName: rawImport, alias });
            }
        }
    }

    return imports;
}

/**
 * Global cache of server library definitions for instant autocomplete resolution.
 */
export const LIBRARY_CACHE = new Map();

// Seed default known server libraries for instant offline/test availability
LIBRARY_CACHE.set("logic", {
    modules: [
        { name: "FADDER", params: [], inputs: ["A", "B", "Cin"], outputs: ["S", "Cout"], type: "module", desc: "Module FADDER" }
    ],
    constants: new Map()
});

LIBRARY_CACHE.set("arithmetic", {
    modules: [
        { name: "RCA", params: ["width"], inputs: ["A", "B", "Cin"], outputs: ["S", "Cout"], type: "module", desc: "Module RCA(width)" },
        { name: "FADDER", params: [], inputs: ["A", "B", "Cin"], outputs: ["S", "Cout"], type: "module", desc: "Module FADDER" }
    ],
    constants: new Map([["MAX_WIDTH", 256]])
});

export async function ensureLibraryCached(libName) {
    if (!libName) return null;
    const norm = libName.toLowerCase();

    try {
        if (typeof fetch === "function") {
            const response = await fetch("/api/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file: libName })
            });
            const data = await response.json();
            if (data && data.INFO === "OK" && data.DATA) {
                const libScript = data.DATA;
                const mods = extractScriptModules(libScript);
                const { constants } = extractScopeMetadata(libScript, 99999);

                const libEntry = { modules: mods, constants };
                LIBRARY_CACHE.set(norm, libEntry);
                return libEntry;
            }
        }
    } catch (e) {
        // Fallback
    }

    return LIBRARY_CACHE.get(norm) || null;
}

export function extractScriptModules(fullText) {
    if (!fullText) return [];
    const modules = [];
    const seen = new Set();

    const lines = fullText.split(/\r?\n/);
    let currentMod = null;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const commentIdx = line.indexOf("#");
        if (commentIdx !== -1) line = line.substring(0, commentIdx);
        const trimmed = line.trim();

        const modMatch = trimmed.match(/^module\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\(([^)]*)\))?/i);
        if (modMatch) {
            const name = modMatch[1];
            const lower = name.toLowerCase();
            const rawParams = modMatch[2] ? modMatch[2].split(",").map(p => p.trim()).filter(Boolean) : [];

            currentMod = {
                name,
                params: rawParams,
                inputs: [],
                outputs: [],
                type: "module",
                desc: `Script-defined module ${name}${rawParams.length > 0 ? `(${rawParams.join(", ")})` : ""}`,
                detail: rawParams.length > 0 ? `(${rawParams.join(", ")})` : ""
            };

            if (!seen.has(lower)) {
                seen.add(lower);
                modules.push(currentMod);
            }
            continue;
        }

        if (currentMod) {
            if (trimmed === "}") {
                currentMod = null;
                continue;
            }

            const inMatch = trimmed.match(/^input\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
            if (inMatch) {
                currentMod.inputs.push(inMatch[1]);
            }

            const outMatch = trimmed.match(/^output\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
            if (outMatch) {
                currentMod.outputs.push(outMatch[1]);
            }
        }
    }

    return modules;
}

export function extractScopeMetadata(fullText, currentLineIdx) {
    const lines = fullText.split(/\r?\n/);
    const constants = new Map();
    const loopVars = new Set();

    let depth = 0;
    const activeBlocks = [];

    for (let i = 0; i <= Math.min(currentLineIdx, lines.length - 1); i++) {
        let line = lines[i];
        const cIdx = line.indexOf("#");
        if (cIdx !== -1) line = line.substring(0, cIdx);
        const trimmed = line.trim();

        if (i < currentLineIdx) {
            const constMatch = trimmed.match(/^const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/i);
            if (constMatch) {
                constants.set(constMatch[1], constMatch[2]);
            }

            const forMatch = trimmed.match(/^for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+/i);
            if (forMatch) {
                loopVars.add(forMatch[1]);
                activeBlocks.push({ type: "for", varName: forMatch[1] });
            }

            if (trimmed.endsWith("{")) {
                if (!forMatch) activeBlocks.push({ type: "block" });
            }
            if (trimmed === "}" && activeBlocks.length > 0) {
                const popped = activeBlocks.pop();
                if (popped && popped.type === "for") {
                    // Check if variable is still in outer scope
                    const stillActive = activeBlocks.some(b => b.type === "for" && b.varName === popped.varName);
                    if (!stillActive) {
                        loopVars.delete(popped.varName);
                    }
                }
            }
        } else {
            // Current line partial scope
            const forMatch = trimmed.match(/^for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+/i);
            if (forMatch) {
                loopVars.add(forMatch[1]);
            }
        }
    }

    return { constants, loopVars };
}

/**
 * Filter and rank candidates by typed query string.
 * Priority: 1. Exact prefix match, 2. Case-insensitive prefix match, 3. Word start match, 4. Substring match.
 * @param {Array<{ name: string, type: string, desc?: string, detail?: string }>} candidates
 * @param {string} query
 * @returns {Array<{ name: string, type: string, desc?: string, detail?: string }>}
 */
export function rankCandidates(candidates, query = "") {
    if (!query) {
        return candidates;
    }

    const qLower = query.toLowerCase();

    const matches = [];
    for (const item of candidates) {
        const nameLower = item.name.toLowerCase();
        let score = -1;

        if (item.name === query) {
            score = 1000;
        } else if (nameLower === qLower) {
            score = 900;
        } else if (item.name.startsWith(query)) {
            score = 800;
        } else if (nameLower.startsWith(qLower)) {
            score = 700;
        } else {
            const wordIdx = nameLower.indexOf(`_${qLower}`);
            if (wordIdx !== -1) {
                score = 500 - wordIdx;
            } else {
                const subIdx = nameLower.indexOf(qLower);
                if (subIdx !== -1) {
                    score = 300 - subIdx;
                }
            }
        }

        if (score > 0) {
            matches.push({ item, score });
        }
    }

    matches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return naturalCompare(a.item.name, b.item.name);
    });

    return matches.map(m => m.item);
}

/**
 * Analyze line context up to cursor and return suggestions list and insert prefix info.
 * @param {string} fullText
 * @param {number} cursorOffset
 * @param {Object} envContext - { circuit, registry, fileImportAliases, serverLibraries }
 * @returns {{ suggestions: Array, replacePrefix: string, contextType: string }}
 */
export function getCompletions(fullText, cursorOffset, envContext = {}) {
    const textUpToCursor = fullText.substring(0, cursorOffset);
    const lineStartIdx = textUpToCursor.lastIndexOf("\n") + 1;
    const currentLine = textUpToCursor.substring(lineStartIdx);
    const currentLineIdx = fullText.substring(0, cursorOffset).split("\n").length - 1;

    // Strip '#' comments
    let activeCodeLine = currentLine;
    const commentIdx = currentLine.indexOf("#");
    if (commentIdx !== -1) {
        activeCodeLine = currentLine.substring(0, commentIdx);
    }

    const { circuit, registry, fileImportAliases, serverLibraries } = envContext;
    const { constants, loopVars } = extractScopeMetadata(fullText, currentLineIdx);

    // Helper: collect built-in component types
    const getBuiltinComponentTypes = () => {
        const types = [];
        const seen = new Set();

        const addType = (name, desc, detail = "") => {
            const lower = name.toLowerCase();
            if (!seen.has(lower)) {
                seen.add(lower);
                types.push({ name, type: "component", desc: desc || "Built-in component", detail });
            }
        };

        for (const [k, v] of Object.entries(COMPONENT_REGISTRY)) {
            let detail = "";
            if (k.toLowerCase() === "register" || k.toLowerCase() === "counter") {
                detail = "(width)";
            }
            addType(k, "Built-in component", detail);
        }
        addType("input", "Interactive Input Switch");
        addType("output", "Visual Output Indicator");
        addType("clock", "Pulse Clock Generator");
        addType("constant high", "Constant High Voltage");
        addType("constant low", "Constant Low Voltage");
        addType("button", "Push Button Switch");
        addType("dff", "Edge-Triggered D Flip-Flop");
        addType("register", "Parameterized N-Bit Register", "(width)");
        addType("counter", "Parameterized N-Bit Binary Up-Counter", "(width)");
        addType("npn", "NPN Transistor Switch");
        addType("pnp", "PNP Transistor Switch");
        addType("7-segment display", "7-Segment LED Display");
        addType("4-digit 7-segment display", "4-Digit 7-Segment Display");
        addType("10-segment display", "10-Segment LED Bargraph");
        return types;
    };

    // Helper: collect user-defined and imported module types
    const getModuleTypes = () => {
        const mods = [];
        const seen = new Set();

        // 1. Script-defined modules extracted directly from editor source text
        const scriptMods = extractScriptModules(fullText);
        for (const sm of scriptMods) {
            seen.add(sm.name.toLowerCase());
            mods.push(sm);
        }

        // 2. Unaliased imported library modules extracted directly from editor text imports
        const scriptImports = extractScriptImports(fullText);
        for (const imp of scriptImports) {
            if (!imp.alias) {
                const cached = LIBRARY_CACHE.get(imp.libName.toLowerCase());
                if (cached && cached.modules) {
                    for (const sm of cached.modules) {
                        if (!seen.has(sm.name.toLowerCase())) {
                            seen.add(sm.name.toLowerCase());
                            const paramsStr = sm.params && sm.params.length > 0 ? `(${sm.params.join(", ")})` : "";
                            mods.push({
                                name: sm.name,
                                type: "module",
                                desc: `Imported module ${sm.name}${paramsStr} from '${imp.rawImport}'`,
                                detail: paramsStr,
                                params: sm.params || [],
                                inputs: sm.inputs || [],
                                outputs: sm.outputs || []
                            });
                        }
                    }
                }
            }
        }

        // 3. Compiled or imported module definitions from registry
        if (registry) {
            for (const def of registry.definitions.values()) {
                if (!seen.has(def.name.toLowerCase())) {
                    seen.add(def.name.toLowerCase());
                    const paramsStr = def.params && def.params.length > 0 ? `(${def.params.join(", ")})` : "";
                    mods.push({
                        name: def.name,
                        type: "module",
                        desc: def.description || `Module ${def.name}${paramsStr}`,
                        detail: paramsStr,
                        params: def.params || [],
                        inputs: def.inputs || [],
                        outputs: def.outputs || []
                    });
                }
            }
        }
        return mods;
    };

    // Helper: collect imported library aliases
    const getImportAliases = () => {
        const aliases = [];
        const seen = new Set();

        // From script text imports
        const scriptImports = extractScriptImports(fullText);
        for (const imp of scriptImports) {
            if (imp.alias && !seen.has(imp.alias.toLowerCase())) {
                seen.add(imp.alias.toLowerCase());
                aliases.push({
                    name: imp.alias,
                    type: "alias",
                    desc: `Import namespace '${imp.alias}' (${imp.rawImport})`
                });
            }
        }

        if (fileImportAliases) {
            for (const [filePath, aliasMap] of fileImportAliases.entries()) {
                if (aliasMap) {
                    for (const aliasInfo of aliasMap.values()) {
                        if (!seen.has(aliasInfo.alias.toLowerCase())) {
                            seen.add(aliasInfo.alias.toLowerCase());
                            aliases.push({
                                name: aliasInfo.alias,
                                type: "alias",
                                desc: `Import namespace '${aliasInfo.alias}' (${aliasInfo.rawImport})`
                            });
                        }
                    }
                }
            }
        }
        return aliases;
    };

    // Helper: collect component & bus & net names from circuit
    const getCircuitInstanceNames = () => {
        const instances = [];
        if (circuit) {
            for (const comp of circuit.components.values()) {
                let typeName = comp.type;
                if (comp.type === "UserModule" && comp.definition) {
                    typeName = comp.definition.name;
                }
                instances.push({
                    name: comp.id,
                    type: "instance",
                    desc: `${typeName} at (${comp.x}, ${comp.y})`
                });
            }
            if (circuit.buses) {
                for (const bus of circuit.buses.values()) {
                    instances.push({
                        name: bus.name,
                        type: "bus",
                        desc: `${bus.width}-bit bus [${bus.start}..${bus.end}]`
                    });
                }
            }
        }
        return instances;
    };

    // Helper: collect pins for a component or bus name
    const getComponentPins = (compName) => {
        const pins = [];
        if (circuit) {
            if (circuit.buses && circuit.buses.has(compName)) {
                const bus = circuit.buses.get(compName);
                for (const member of bus.members) {
                    pins.push({ name: member, type: "pin", desc: `Bus bit signal` });
                }
                return pins;
            }

            const comp = circuit.components.get(compName);
            if (comp) {
                for (const pin of comp.pins()) {
                    pins.push({
                        name: pin.name,
                        type: "pin",
                        desc: `${pin.type} pin (value=${pin.value})`
                    });
                }
                return pins;
            }
        }

        if (registry) {
            // Check if compName matches a module definition name
            for (const def of registry.definitions.values()) {
                if (def.name.toLowerCase() === compName.toLowerCase()) {
                    for (const inp of def.inputs) {
                        pins.push({ name: inp, type: "pin", desc: "input port" });
                    }
                    for (const out of def.outputs) {
                        pins.push({ name: out, type: "pin", desc: "output port" });
                    }
                    return pins;
                }
            }
        }

        // Also check script-extracted modules from editor source text
        const scriptMods = extractScriptModules(fullText);
        for (const sm of scriptMods) {
            if (sm.name.toLowerCase() === compName.toLowerCase()) {
                for (const inp of sm.inputs) {
                    pins.push({ name: inp, type: "pin", desc: "input port" });
                }
                for (const out of sm.outputs) {
                    pins.push({ name: out, type: "pin", desc: "output port" });
                }
                break;
            }
        }
        return pins;
    };

    // --- CONTEXT DETECTION ---

    // 1. `import "` or `import '` -> suggest server library module names
    const importQuoteMatch = activeCodeLine.match(/^(\s*import\s+["'])([^"']*)$/i);
    if (importQuoteMatch) {
        const prefix = importQuoteMatch[2];
        const libList = serverLibraries || ["logic", "arithmetic"];
        const candidates = libList.map(lib => ({
            name: lib,
            type: "library",
            desc: `Server library lib/${lib}.sim`
        }));
        return {
            suggestions: rankCandidates(candidates, prefix),
            replacePrefix: prefix,
            contextType: "import_path"
        };
    }

    // 2. `import "module" ` -> suggest `as` keyword
    const importAsMatch = activeCodeLine.match(/^(\s*import\s+["'][^"']+["']\s+)([a-zA-Z_]*)$/i);
    if (importAsMatch) {
        const prefix = importAsMatch[2];
        const candidates = [{ name: "as", type: "keyword", desc: "Import namespace alias keyword" }];
        return {
            suggestions: rankCandidates(candidates, prefix),
            replacePrefix: prefix,
            contextType: "import_as"
        };
    }

    // 3. Qualified symbol completion: `ALIAS.` (e.g. `add logic.`, `bus A[0..consts.`, `add math.RCA(`)
    const dotSymbolMatch = activeCodeLine.match(/([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z0-9_]*)$/);
    if (dotSymbolMatch) {
        const aliasName = dotSymbolMatch[1];
        const prefix = dotSymbolMatch[2];

        // 1. Check if ALIAS is an import alias in script text imports
        const scriptImports = extractScriptImports(fullText);
        const matchedImport = scriptImports.find(imp => imp.alias && imp.alias.toLowerCase() === aliasName.toLowerCase());

        let targetLib = matchedImport ? matchedImport.libName.toLowerCase() : null;

        const matchingDefs = [];
        if (registry) {
            for (const def of registry.definitions.values()) {
                if (def.aliases && def.aliases.some(a => a.toLowerCase() === aliasName.toLowerCase())) {
                    matchingDefs.push(def);
                }
            }
        }

        if (targetLib && LIBRARY_CACHE.has(targetLib)) {
            const cached = LIBRARY_CACHE.get(targetLib);
            if (cached && cached.modules) {
                for (const sm of cached.modules) {
                    if (!matchingDefs.some(d => d.name.toLowerCase() === sm.name.toLowerCase())) {
                        matchingDefs.push(sm);
                    }
                }
            }
        }

        if (matchingDefs.length > 0) {
            const candidates = [];
            for (const def of matchingDefs) {
                const paramsStr = def.params && def.params.length > 0 ? `(${def.params.join(", ")})` : "";
                candidates.push({
                    name: def.name,
                    type: "module",
                    desc: `Imported module from alias '${aliasName}'`,
                    detail: paramsStr
                });
            }
            // Include constants for this alias from LIBRARY_CACHE or constants
            if (targetLib && LIBRARY_CACHE.has(targetLib)) {
                const cached = LIBRARY_CACHE.get(targetLib);
                if (cached && cached.constants) {
                    for (const [ck, cv] of cached.constants.entries()) {
                        candidates.push({
                            name: ck,
                            type: "constant",
                            desc: `Imported constant = ${cv}`
                        });
                    }
                }
            }
            for (const [k, v] of constants.entries()) {
                if (k.toLowerCase().startsWith(`${aliasName.toLowerCase()}.`)) {
                    const constName = k.substring(aliasName.length + 1);
                    if (!candidates.some(c => c.name.toLowerCase() === constName.toLowerCase())) {
                        candidates.push({
                            name: constName,
                            type: "constant",
                            desc: `Imported constant = ${v}`
                        });
                    }
                }
            }
            return {
                suggestions: rankCandidates(candidates, prefix),
                replacePrefix: prefix,
                contextType: "qualified_symbol"
            };
        }

        // If ALIAS is a component instance on circuit -> suggest pins / ports / properties
        if (activeCodeLine.trim().startsWith("set ")) {
            const props = COMMON_PROPERTIES;
            return {
                suggestions: rankCandidates(props, prefix),
                replacePrefix: prefix,
                contextType: "property"
            };
        } else {
            const pins = getComponentPins(aliasName);
            return {
                suggestions: rankCandidates(pins, prefix),
                replacePrefix: prefix,
                contextType: "pin"
            };
        }
    }

    // 4. `add ` command -> suggest built-in types, custom modules, and import alias prefixes
    const addMatch = activeCodeLine.match(/^(\s*add\s+)([a-zA-Z0-9_\.]*)$/i);
    if (addMatch) {
        const prefix = addMatch[2];

        const candidates = [
            ...getBuiltinComponentTypes(),
            ...getModuleTypes(),
            ...getImportAliases()
        ];

        return {
            suggestions: rankCandidates(candidates, prefix),
            replacePrefix: prefix,
            contextType: "component_type"
        };
    }

    // 5. Module parameter hints: `add MODULE(` or `add ALIAS.MODULE(`
    const paramMatch = activeCodeLine.match(/add\s+(?:([a-zA-Z_][a-zA-Z0-9_]*)\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)$/i);
    if (paramMatch) {
        const modName = paramMatch[2];
        const insideArgs = paramMatch[3];
        const eqIdx = insideArgs.lastIndexOf("=");
        const commaIdx = insideArgs.lastIndexOf(",");
        const prefix = eqIdx > commaIdx ? insideArgs.substring(eqIdx + 1).trim() : insideArgs.substring(commaIdx + 1).trim();

        const candidates = [];
        if (registry) {
            for (const def of registry.definitions.values()) {
                if (def.name.toLowerCase() === modName.toLowerCase() && def.params) {
                    for (const p of def.params) {
                        candidates.push({
                            name: `${p}=`,
                            type: "parameter",
                            desc: `Parameter '${p}' for ${def.name}`
                        });
                    }
                }
            }
        }
        for (const [libKey, cached] of LIBRARY_CACHE.entries()) {
            if (cached && cached.modules) {
                for (const sm of cached.modules) {
                    if (sm.name.toLowerCase() === modName.toLowerCase() && sm.params) {
                        for (const p of sm.params) {
                            if (!candidates.some(c => c.name === `${p}=`)) {
                                candidates.push({
                                    name: `${p}=`,
                                    type: "parameter",
                                    desc: `Parameter '${p}' for ${sm.name}`
                                });
                            }
                        }
                    }
                }
            }
        }
        const scriptMods = extractScriptModules(fullText);
        for (const sm of scriptMods) {
            if (sm.name.toLowerCase() === modName.toLowerCase() && sm.params) {
                for (const p of sm.params) {
                    if (!candidates.some(c => c.name === `${p}=`)) {
                        candidates.push({
                            name: `${p}=`,
                            type: "parameter",
                            desc: `Parameter '${p}' for ${sm.name}`
                        });
                    }
                }
            }
        }
        if (["register", "counter"].includes(modName.toLowerCase())) {
            if (!candidates.some(c => c.name === "width=")) {
                candidates.push({
                    name: "width=",
                    type: "parameter",
                    desc: `Parameter 'width' for ${modName}`
                });
            }
        }
        // Also add scope constants and loop variables as parameter value suggestions
        for (const [k, v] of constants.entries()) {
            candidates.push({ name: k, type: "constant", desc: `Constant = ${v}` });
        }
        for (const v of loopVars) {
            candidates.push({ name: v, type: "variable", desc: "Loop variable in scope" });
        }

        return {
            suggestions: rankCandidates(candidates, prefix),
            replacePrefix: prefix,
            contextType: "parameter"
        };
    }

    // 6. `set COMP.PROPERTY ` -> suggest property enumerated values
    const setPropValMatch = activeCodeLine.match(/^(\s*set\s+([a-zA-Z0-9_\[\]]+)\.([a-zA-Z0-9_]+)\s+)([a-zA-Z0-9_]*)$/i);
    if (setPropValMatch) {
        const propName = setPropValMatch[3].toLowerCase();
        const prefix = setPropValMatch[4];

        const knownVals = PROPERTY_VALUES[propName] || [];
        const candidates = knownVals.map(val => ({
            name: val,
            type: "value",
            desc: `Value for ${setPropValMatch[3]}`
        }));

        return {
            suggestions: rankCandidates(candidates, prefix),
            replacePrefix: prefix,
            contextType: "property_value"
        };
    }

    // 7. Component name commands: `move`, `remove`, `show`, `trace`, `expand`, `detach`, `set`
    const compCmdMatch = activeCodeLine.match(/^(\s*(move|remove|show|trace|expand|detach|set)\s+)([a-zA-Z0-9_\[\]\.]*)$/i);
    if (compCmdMatch) {
        const prefix = compCmdMatch[3];
        const candidates = [
            ...getCircuitInstanceNames(),
            ...getModuleTypes(),
            ...getImportAliases()
        ];

        return {
            suggestions: rankCandidates(candidates, prefix),
            replacePrefix: prefix,
            contextType: "instance"
        };
    }

    // 8. Connection commands: `connect FROM TO` or `connect FROM -> TO`
    const connectMatch = activeCodeLine.match(/^(\s*connect\s+)(.*?)$/i);
    if (connectMatch) {
        const rest = connectMatch[2];
        const arrowIdx = rest.lastIndexOf("->");
        let activeRef = rest;
        if (arrowIdx !== -1) {
            activeRef = rest.substring(arrowIdx + 2);
        } else {
            const parts = rest.trim().split(/\s+/);
            if (parts.length > 1) {
                activeRef = parts[parts.length - 1];
            }
        }
        activeRef = activeRef.trim();

        // Check if typing pin `COMP.`
        if (activeRef.includes(".")) {
            const lastDot = activeRef.lastIndexOf(".");
            const compName = activeRef.substring(0, lastDot);
            const prefix = activeRef.substring(lastDot + 1);

            const pins = getComponentPins(compName);
            return {
                suggestions: rankCandidates(pins, prefix),
                replacePrefix: prefix,
                contextType: "pin"
            };
        } else {
            const candidates = [
                ...getCircuitInstanceNames(),
                ...getImportAliases()
            ];
            return {
                suggestions: rankCandidates(candidates, activeRef),
                replacePrefix: activeRef,
                contextType: "signal"
            };
        }
    }

    // 9. Command line start -> suggest top-level commands and keywords
    const lineStartMatch = activeCodeLine.match(/^(\s*)([a-zA-Z_][a-zA-Z0-9_]*)$/);
    if (lineStartMatch || activeCodeLine.trim() === "") {
        const prefix = lineStartMatch ? lineStartMatch[2] : "";

        const candidates = [
            ...SCRIPT_COMMANDS,
            ...Array.from(loopVars).map(v => ({ name: v, type: "variable", desc: "Loop variable in scope" })),
            ...Array.from(constants.keys()).map(k => ({ name: k, type: "constant", desc: `Constant = ${constants.get(k)}` }))
        ];

        return {
            suggestions: rankCandidates(candidates, prefix),
            replacePrefix: prefix,
            contextType: "command"
        };
    }

    // 10. General expression / identifier / scope completion
    const identMatch = activeCodeLine.match(/([a-zA-Z_][a-zA-Z0-9_\.]*)$/);
    if (identMatch) {
        const prefix = identMatch[1];
        const candidates = [
            ...Array.from(loopVars).map(v => ({ name: v, type: "variable", desc: "Loop variable in scope" })),
            ...Array.from(constants.keys()).map(k => ({ name: k, type: "constant", desc: `Constant = ${constants.get(k)}` })),
            ...getImportAliases()
        ];

        return {
            suggestions: rankCandidates(candidates, prefix),
            replacePrefix: prefix,
            contextType: "general"
        };
    }

    return {
        suggestions: [],
        replacePrefix: "",
        contextType: "none"
    };
}
