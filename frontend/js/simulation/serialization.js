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
export function findDefinitionByNameAndType(registry, name, type) {
    if (!registry) return null;
    const normName = name.toLowerCase().trim();
    const normType = type.toLowerCase().trim();
    for (const def of registry.definitions.values()) {
        const defType = (def.type || def.category || "Custom").toLowerCase().trim();
        if (def.name.toLowerCase().trim() === normName && defType === normType) {
            return def;
        }
    }
    return null;
}

export function getUniqueName(registry, name, type) {
    if (!registry) return name;
    let currentName = name;
    let suffix = 1;
    while (findDefinitionByNameAndType(registry, currentName, type)) {
        currentName = `${name} (${suffix})`;
        suffix++;
    }
    return currentName;
}

export function serializeCircuit(circuit, registry) {
    const components = [];
    for (const comp of circuit.components.values()) {
        const serialized = {
            id: comp.id,
            type: comp.type,
            x: comp.x,
            y: comp.y,
            label: comp.label || "",
            rotation: comp.rotation || 0,
            flipX: comp.flipX || false,
            flipY: comp.flipY || false
        };

        if (comp.type === "Clock") {
            serialized.frequencyValue = comp.frequencyValue || 1;
            serialized.frequencyUnit = comp.frequencyUnit || "Hz";
            serialized.intervalMs = comp.intervalMs || 1000;
        } else if (comp.type === "LED") {
            serialized.ledColor = comp.ledColor || "Red";
            serialized.rgbaValue = comp.rgbaValue || "";
        } else if (comp.type === "Button") {
            serialized.buttonMode = comp.buttonMode || "press";
            serialized.holdDuration = comp.holdDuration || 1000;
        } else if (comp.type === "UserModule" && comp.definition) {
            serialized.definitionId = comp.definition.id;
            serialized.pinPositions = comp.pins().map(p => ({
                id: p.id,
                side: p.side,
                offset: p.offset
            }));
        }

        components.push(serialized);
    }

    const wires = [];
    for (const wire of circuit.wires.values()) {
        wires.push({
            id: wire.id,
            fromPin: wire.fromPin.id,
            toPin: wire.toPin.id,
            color: wire.color || null,
            isManuallyRouted: wire.isManuallyRouted || false,
            points: wire.points || []
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
                type: def.type || def.category || "Custom",
                inputs: def.inputs,
                outputs: def.outputs,
                components: def.components,
                wires: def.wires,
                moduleType: def.moduleType || "Module"
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
            const defType = defData.type || defData.category || "Custom";

            // Check if definition already exists in registry
            const existingById = registry.get(defData.id);
            if (existingById) {
                continue; // already registered, keep it
            }

            const existingByNameAndType = findDefinitionByNameAndType(registry, defData.name, defType);
            if (existingByNameAndType) {
                // Same name and type, but different ID.
                // To avoid duplicate (name, type) violation, we can auto-rename the incoming definition!
                const uniqueName = getUniqueName(registry, defData.name, defType);
                defData.name = uniqueName;
            }

            const def = new ModuleDefinition(
                defData.id,
                defData.name,
                defData.description,
                defData.category,
                defData.inputs,
                defData.outputs,
                defData.components,
                defData.wires,
                defData.moduleType || "Module",
                defType
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
        comp.rotation = compData.rotation || 0;
        comp.flipX = compData.flipX || false;
        comp.flipY = compData.flipY || false;

        if (comp.type === "Clock") {
            if (compData.frequencyValue !== undefined) {
                comp.frequencyValue = compData.frequencyValue;
                comp.frequencyUnit = compData.frequencyUnit || "Hz";
            } else if (compData.intervalMs !== undefined) {
                // Backward compatibility from delay
                comp.frequency = 500 / compData.intervalMs;
                comp.frequencyValue = comp.frequency;
                comp.frequencyUnit = "Hz";
            }
            if (compData.intervalMs !== undefined) {
                comp.intervalMs = compData.intervalMs;
            }
            comp.updateFrequency();
        } else if (comp.type === "LED") {
            comp.ledColor = compData.ledColor || "Red";
            comp.rgbaValue = compData.rgbaValue || "";
        } else if (comp.type === "Button") {
            comp.buttonMode = compData.buttonMode || "press";
            comp.holdDuration = compData.holdDuration || 1000;
        } else if (comp.type === "UserModule" && compData.pinPositions) {
            compData.pinPositions.forEach(pos => {
                comp.repositionPin(pos.id, pos.side, pos.offset);
            });
        }

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
            wire.isManuallyRouted = wireData.isManuallyRouted || false;
            wire.points = wireData.points || [];
            circuit.addWire(wire);
        }
    }
}
