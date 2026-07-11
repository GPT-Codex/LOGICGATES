/**
 * Handles JSON serialization and deserialization of projects, libraries, and custom modules.
 */

import { Circuit, Wire } from "./core.js";
import { createComponent } from "./components.js";
import { UserModule, ModuleDefinition } from "./modules.js";

/**
 * Serializes the active circuit into a human-readable JSON-friendly object structure.
 * @param {Circuit} circuit
 * @param {ModuleRegistry} registry
 * @returns {any}
 */
export function serializeCircuit(circuit, registry) {
    const components = [];
    for (const comp of circuit.components.values()) {
        const serialized = {
            id: comp.id,
            type: comp.type,
            x: comp.x,
            y: comp.y,
            label: comp.label || ""
        };

        // If it's a UserModule, save its definition's ID
        if (comp.type === "UserModule" && comp.definition) {
            serialized.definitionId = comp.definition.id;
        }

        components.push(serialized);
    }

    const wires = [];
    for (const wire of circuit.wires.values()) {
        wires.push({
            id: wire.id,
            fromPin: wire.fromPin.id,
            toPin: wire.toPin.id,
            color: wire.color || null
        });
    }

    // Include registered user module definitions so projects load self-contained!
    const definitions = [];
    if (registry) {
        for (const def of registry.definitions.values()) {
            definitions.push({
                id: def.id,
                name: def.name,
                description: def.description,
                category: def.category,
                inputs: def.inputs,
                outputs: def.outputs,
                components: def.components,
                wires: def.wires
            });
        }
    }

    return {
        components,
        wires,
        definitions
    };
}

/**
 * Deserializes JSON data, rebuilding the components and wire structures on the Circuit.
 * @param {any} data
 * @param {Circuit} circuit
 * @param {ModuleRegistry} registry
 */
export function deserializeCircuit(data, circuit, registry) {
    circuit.clear();

    // 1. Re-register any custom definitions contained in the project save file
    if (data.definitions && registry) {
        for (const defData of data.definitions) {
            const def = new ModuleDefinition(
                defData.id,
                defData.name,
                defData.description,
                defData.category,
                defData.inputs,
                defData.outputs,
                defData.components,
                defData.wires
            );
            registry.register(def);
        }
    }

    // Map to quickly find pin instances by their ID during wire rebuilding
    const pinMap = new Map();

    // 2. Instantiate components
    for (const compData of data.components) {
        let comp;
        if (compData.type === "UserModule") {
            const def = registry ? registry.get(compData.definitionId) : null;
            if (def) {
                comp = new UserModule(compData.id, def, compData.x, compData.y);
            } else {
                console.error(`Missing definition '${compData.definitionId}' for custom module instance '${compData.id}'.`);
                continue;
            }
        } else {
            comp = createComponent(compData.type, compData.id, compData.x, compData.y);
        }

        comp.label = compData.label || "";
        circuit.addComponent(comp);

        // Map pins
        comp.pins().forEach(pin => {
            pinMap.set(pin.id, pin);
        });
    }

    // 3. Rebuild wires
    for (const wireData of data.wires) {
        const fromPin = pinMap.get(wireData.fromPin);
        const toPin = pinMap.get(wireData.toPin);
        if (fromPin && toPin) {
            const wire = new Wire(wireData.id, fromPin, toPin, wireData.color || null);
            circuit.addWire(wire);
        }
    }
}
