/**
 * Interaction handlers: SelectionManager, ClipboardManager, and HistoryManager.
 */

import { computeManhattanRoute } from "./wires.js";
import { createComponent } from "../simulation/components.js";
import { UserModule } from "../simulation/modules.js";
import { Wire } from "../simulation/core.js";

/**
 * Manages selecting components and wires on the canvas.
 */
export class SelectionManager {
    constructor() {
        /** @type {Set<any>} */
        this.selectedComponents = new Set();
        /** @type {Set<any>} */
        this.selectedWires = new Set();
        
        // Dragging states
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.initialPositions = new Map(); // CompID -> {x, y}
    }

    selectSingleComponent(comp) {
        this.selectedComponents.clear();
        this.selectedWires.clear();
        this.selectedComponents.add(comp);
    }

    selectSingleWire(wire) {
        this.selectedComponents.clear();
        this.selectedWires.clear();
        this.selectedWires.add(wire);
    }

    toggleComponent(comp) {
        if (this.selectedComponents.has(comp)) {
            this.selectedComponents.delete(comp);
        } else {
            this.selectedComponents.add(comp);
        }
    }

    toggleWire(wire) {
        if (this.selectedWires.has(wire)) {
            this.selectedWires.delete(wire);
        } else {
            this.selectedWires.add(wire);
        }
    }

    clear() {
        this.selectedComponents.clear();
        this.selectedWires.clear();
    }

    /**
     * Set up positions before starting drag.
     */
    startDrag(worldX, worldY) {
        this.isDragging = true;
        this.dragStartX = worldX;
        this.dragStartY = worldY;
        this.initialPositions.clear();
        for (const comp of this.selectedComponents) {
            this.initialPositions.set(comp.id, { x: comp.x, y: comp.y });
        }
    }

    /**
     * Process dragging of selected components with snapping.
     */
    drag(worldX, worldY, workspace) {
        if (!this.isDragging) return;
        const dx = worldX - this.dragStartX;
        const dy = worldY - this.dragStartY;

        for (const comp of this.selectedComponents) {
            const initPos = this.initialPositions.get(comp.id);
            if (initPos) {
                // Snap each individually to keep grid alignment neat!
                comp.x = workspace.snap(initPos.x + dx);
                comp.y = workspace.snap(initPos.y + dy);
            }
        }
    }

    endDrag() {
        this.isDragging = false;
        this.initialPositions.clear();
    }

    /**
     * Returns true if anything is selected.
     */
    hasSelection() {
        return this.selectedComponents.size > 0 || this.selectedWires.size > 0;
    }
}

/**
 * Handles copy/paste/duplicate with wire index mapping so copied subcircuits remain connected!
 */
export class ClipboardManager {
    constructor() {
        this.copiedComponents = [];
        this.copiedWires = [];
    }

    /**
     * Copy selected components and wires.
     */
    copy(selectedComponents, selectedWires, allWires) {
        this.copiedComponents = [];
        this.copiedWires = [];

        // Serialize selected components
        const compIds = new Set();
        for (const comp of selectedComponents) {
            compIds.add(comp.id);
            
            // Reusable serialization format
            const serialized = {
                type: comp.type,
                x: comp.x,
                y: comp.y,
                label: comp.label || "",
                rotation: comp.rotation || 0,
                flipX: comp.flipX || false,
                flipY: comp.flipY || false,
                // Preserve definitions for custom user modules
                definition: comp.type === "UserModule" ? comp.definition : null
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
            this.copiedComponents.push(serialized);
        }

        // Serialize wires that connect copied components
        for (const wire of allWires) {
            if (compIds.has(wire.fromPin.component.id) && compIds.has(wire.toPin.component.id)) {
                // Find pin indexes so we can map them back correctly on paste!
                const fromCompIndex = Array.from(selectedComponents).indexOf(wire.fromPin.component);
                const toCompIndex = Array.from(selectedComponents).indexOf(wire.toPin.component);
                
                const fromPinIndex = wire.fromPin.component.outputs.indexOf(wire.fromPin);
                const toPinIndex = wire.toPin.component.inputs.indexOf(wire.toPin);

                this.copiedWires.push({
                    fromCompIndex,
                    toCompIndex,
                    fromPinIndex,
                    toPinIndex,
                    color: wire.color || null
                });
            }
        }
    }

    /**
     * Paste cloned components and wires onto the circuit.
     */
    paste(circuit, workspace) {
        if (this.copiedComponents.length === 0) return [];

        const pastedComps = [];
        const pastedIdMap = new Map(); // index in copied -> new Component

        // Paste components offset by grid distance
        this.copiedComponents.forEach((cData, idx) => {
            const newId = `${cData.type.toLowerCase().replace(/\s+/g, "_")}_${Math.random().toString(36).substring(2, 9)}`;
            
            let newComp;
            if (cData.type === "UserModule") {
                newComp = new UserModule(newId, cData.definition, cData.x + 40, cData.y + 40);
            } else {
                newComp = createComponent(cData.type, newId, cData.x + 40, cData.y + 40);
            }
            newComp.label = cData.label;
            newComp.rotation = cData.rotation || 0;
            newComp.flipX = cData.flipX || false;
            newComp.flipY = cData.flipY || false;

            if (newComp.type === "Clock") {
                if (cData.frequencyValue !== undefined) {
                    newComp.frequencyValue = cData.frequencyValue;
                    newComp.frequencyUnit = cData.frequencyUnit || "Hz";
                }
                if (cData.intervalMs !== undefined) {
                    newComp.intervalMs = cData.intervalMs;
                }
                newComp.updateFrequency();
            } else if (newComp.type === "LED") {
                newComp.ledColor = cData.ledColor || "Red";
                newComp.rgbaValue = cData.rgbaValue || "";
            } else if (newComp.type === "Button") {
                newComp.buttonMode = cData.buttonMode || "press";
                newComp.holdDuration = cData.holdDuration || 1000;
            } else if (newComp.type === "UserModule" && cData.pinPositions) {
                cData.pinPositions.forEach(pos => {
                    newComp.repositionPin(pos.id, pos.side, pos.offset);
                });
            }

            circuit.addComponent(newComp);
            pastedComps.push(newComp);
            pastedIdMap.set(idx, newComp);
            
            // Keep copy buffer offset so consecutive pastes drift down-right beautifully!
            cData.x += 40;
            cData.y += 40;
        });

        // Paste connected wires using indexes
        this.copiedWires.forEach(wData => {
            const fromComp = pastedIdMap.get(wData.fromCompIndex);
            const toComp = pastedIdMap.get(wData.toCompIndex);

            if (fromComp && toComp) {
                const fromPin = fromComp.outputs[wData.fromPinIndex];
                const toPin = toComp.inputs[wData.toPinIndex];

                if (fromPin && toPin) {
                    const newWireId = `wire_${Math.random().toString(36).substring(2, 9)}`;
                    const newWire = new Wire(newWireId, fromPin, toPin, wData.color || null);
                    circuit.addWire(newWire);
                }
            }
        });

        return pastedComps;
    }
}

/**
 * Handles Undo and Redo states.
 */
export class HistoryManager {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.maxHistory = 50;
    }

    /**
     * Capture active state.
     * @param {any} state - Serialized JSON string of the workspace circuit.
     */
    pushState(state) {
        // Clear redo stack on new user actions
        this.redoStack = [];
        
        // Push state, checking length
        if (this.undoStack.length >= this.maxHistory) {
            this.undoStack.shift();
        }
        this.undoStack.push(state);
    }

    /**
     * Restore previous state.
     */
    undo(currentState) {
        if (this.undoStack.length === 0) return null;
        
        this.redoStack.push(currentState);
        return this.undoStack.pop();
    }

    /**
     * Restore newer state.
     */
    redo(currentState) {
        if (this.redoStack.length === 0) return null;

        this.undoStack.push(currentState);
        return this.redoStack.pop();
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }
}
