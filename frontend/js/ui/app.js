/**
 * Orchestrator and entrypoint for the Digital Logic Simulator workspace loop and UI bindings.
 */

import { Circuit, Wire } from "../simulation/core.js";
import { createComponent, COMPONENT_REGISTRY } from "../simulation/components.js";
import { SimulationEngine } from "../simulation/simulation_engine.js";
import { ModuleRegistry, ModuleDefinition, UserModule } from "../simulation/modules.js";
import { serializeCircuit, deserializeCircuit } from "../simulation/serialization.js";
import { Workspace } from "../canvas/workspace.js";
import { isPointNearWire, drawWire, computeManhattanRoute } from "../canvas/wires.js";
import { SelectionManager, ClipboardManager, HistoryManager } from "../canvas/interactions.js";

// Global instances
const circuit = new Circuit();
const engine = new SimulationEngine(circuit);
const registry = new ModuleRegistry();

let canvas, workspace, selectionManager, clipboardManager, historyManager;

// Interaction states
let placingComponentType = null; // Type of gate we are currently placing
let activePinSource = null;     // Pin we started drawing a wire from
let activeMouseWorld = { x: 0, y: 0 };
let isDrawingWire = false;
let isPanning = false;
let panLastX = 0;
let panLastY = 0;

// Marquee (rectangle selection) selection states
let isSelectingMarquee = false;
let marqueeStartWorld = { x: 0, y: 0 };
let marqueeEndWorld = { x: 0, y: 0 };

// Animation Loop
function appLoop() {
    render();
    requestAnimationFrame(appLoop);
}

// Initialization on load
window.addEventListener("DOMContentLoaded", () => {
    canvas = document.getElementById("simulator-canvas");
    resizeCanvasToWindow();

    workspace = new Workspace(canvas);
    selectionManager = new SelectionManager();
    clipboardManager = new ClipboardManager();
    historyManager = new HistoryManager();

    // Listeners
    window.addEventListener("resize", resizeCanvasToWindow);
    setupCanvasEvents();
    setupUIEvents();
    setupKeyboardShortcuts();

    // Rebuild initial state
    engine.evaluateAll();

    // Set up periodic clock trigger (e.g. 500ms toggle for ClockGate types)
    setInterval(() => {
        let changed = false;
        for (const comp of circuit.components.values()) {
            if (comp.type === "Clock") {
                comp.stateValue = comp.stateValue === 1 ? 0 : 1;
                comp.evaluate();
                engine.propagatePin(comp.outputs[0]);
                changed = true;
            }
        }
        if (changed) {
            engine.propagate();
        }
    }, 500);

    // Initial state push
    saveHistoryState();

    // Start workspace loop
    requestAnimationFrame(appLoop);
});

function resizeCanvasToWindow() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
}

// History utilities
function saveHistoryState() {
    const snap = JSON.stringify(serializeCircuit(circuit, registry));
    historyManager.pushState(snap);
}

function restoreState(snapString) {
    if (!snapString) return;
    const data = JSON.parse(snapString);
    deserializeCircuit(data, circuit, registry);
    selectionManager.clear();
    engine.evaluateAll();
    updatePropertiesPanel();
    updateStatusBar();
}

/**
 * Capture canvas clicks, coordinate shifts, and dragging.
 */
function setupCanvasEvents() {
    canvas.addEventListener("mousedown", (e) => {
        const world = workspace.screenToWorld(e.clientX, e.clientY);

        // Handle Panning with Middle Click or Right Click
        if (e.button === 1 || e.button === 2) {
            isPanning = true;
            panLastX = e.clientX;
            panLastY = e.clientY;
            e.preventDefault();
            return;
        }

        if (e.button === 0) {
            // Check if we are in placing gate mode
            if (placingComponentType) {
                const id = `${placingComponentType.toLowerCase().replace(/\s+/g, "_")}_${Math.random().toString(36).substring(2, 9)}`;
                const x = workspace.snap(world.x);
                const y = workspace.snap(world.y);

                let newComp;
                if (placingComponentType.startsWith("UserModule:")) {
                    const defId = placingComponentType.split(":")[1];
                    const def = registry.get(defId);
                    if (def) {
                        newComp = new UserModule(id, def, x, y);
                    }
                } else {
                    newComp = createComponent(placingComponentType, id, x, y);
                }

                if (newComp) {
                    circuit.addComponent(newComp);
                    engine.evaluateAll();
                    saveHistoryState();
                }

                // Reset placing unless shift is held
                if (!e.shiftKey) {
                    placingComponentType = null;
                    canvas.style.cursor = "crosshair";
                }
                updatePropertiesPanel();
                updateStatusBar();
                return;
            }

            // 1. Check if clicked near a component's Pin first (to start drawing a wire!)
            const pinSearch = findPinAt(world.x, world.y);
            if (pinSearch) {
                activePinSource = pinSearch.pin;
                isDrawingWire = true;
                return;
            }

            // 2. Check if clicked on an actual Component
            const clickedComp = findComponentAt(world.x, world.y);
            if (clickedComp) {
                // Manage multi-select and toggle
                if (e.shiftKey) {
                    selectionManager.toggleComponent(clickedComp);
                } else {
                    if (!selectionManager.selectedComponents.has(clickedComp)) {
                        selectionManager.selectSingleComponent(clickedComp);
                    }
                }

                // Start component drag
                selectionManager.startDrag(world.x, world.y);
                updatePropertiesPanel();
                return;
            }

            // 3. Check if clicked on a Wire (using segment proximity checks!)
            const clickedWire = findWireAt(world.x, world.y);
            if (clickedWire) {
                if (e.shiftKey) {
                    selectionManager.toggleWire(clickedWire);
                } else {
                    selectionManager.selectSingleWire(clickedWire);
                }
                updatePropertiesPanel();
                return;
            }

            // 4. Clicked empty space: start marquee selection
            selectionManager.clear();
            isSelectingMarquee = true;
            marqueeStartWorld = { x: world.x, y: world.y };
            marqueeEndWorld = { x: world.x, y: world.y };
            updatePropertiesPanel();
        }
    });

    canvas.addEventListener("mousemove", (e) => {
        const world = workspace.screenToWorld(e.clientX, e.clientY);
        activeMouseWorld = world;

        if (isPanning) {
            const dx = e.clientX - panLastX;
            const dy = e.clientY - panLastY;
            workspace.pan(dx, dy);
            panLastX = e.clientX;
            panLastY = e.clientY;
            return;
        }

        if (isDrawingWire) {
            // Keep drawing temporary line
            return;
        }

        if (selectionManager.isDragging) {
            selectionManager.drag(world.x, world.y, workspace);
            return;
        }

        if (isSelectingMarquee) {
            marqueeEndWorld = world;
            // Update selected components / wires inside marquee box
            updateMarqueeSelection();
            return;
        }
    });

    canvas.addEventListener("mouseup", (e) => {
        if (isPanning) {
            isPanning = false;
            return;
        }

        if (isDrawingWire) {
            isDrawingWire = false;
            const world = workspace.screenToWorld(e.clientX, e.clientY);
            const targetPinSearch = findPinAt(world.x, world.y);

            // Connect wire if valid target input pin is hit
            if (activePinSource && targetPinSearch) {
                const targetPin = targetPinSearch.pin;

                // Wires must only connect OUTPUT -> INPUT and separate components
                if (activePinSource.type === "output" && targetPin.type === "input" && activePinSource.component !== targetPin.component) {

                    // Remove existing wire to target input pin if it exists (one connection limit per input pin)
                    for (const wire of circuit.wires.values()) {
                        if (wire.toPin === targetPin) {
                            circuit.removeWire(wire.id);
                        }
                    }

                    const wireId = `wire_${Math.random().toString(36).substring(2, 9)}`;
                    const newWire = new Wire(wireId, activePinSource, targetPin);
                    circuit.addWire(newWire);
                    engine.evaluateAll();
                    saveHistoryState();
                }
            }
            activePinSource = null;
            updateStatusBar();
            return;
        }

        if (selectionManager.isDragging) {
            selectionManager.endDrag();
            saveHistoryState();
            return;
        }

        if (isSelectingMarquee) {
            isSelectingMarquee = false;
            return;
        }
    });

    canvas.addEventListener("wheel", (e) => {
        const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
        workspace.zoomAt(e.clientX, e.clientY, zoomFactor);
        document.getElementById("viewport-zoom").textContent = `Zoom: ${Math.round(workspace.scale * 100)}%`;
        e.preventDefault();
    });

    canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const menu = document.getElementById("canvas-context-menu");
        menu.style.display = "block";
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
    });

    // Dismiss context menu
    window.addEventListener("click", () => {
        document.getElementById("canvas-context-menu").style.display = "none";
    });
}

/**
 * Standard elements lookups
 */
function findComponentAt(wx, wy) {
    for (const comp of circuit.components.values()) {
        const bbox = comp.boundingBox();
        if (wx >= bbox.x && wx <= bbox.x + bbox.width && wy >= bbox.y && wy <= bbox.y + bbox.height) {
            return comp;
        }
    }
    return null;
}

function findPinAt(wx, wy) {
    for (const comp of circuit.components.values()) {
        for (const pin of comp.pins()) {
            const px = comp.x + pin.relX;
            const py = comp.y + pin.relY;
            const dist = Math.hypot(wx - px, wy - py);
            if (dist <= 6) {
                return { pin, component: comp };
            }
        }
    }
    return null;
}

function findWireAt(wx, wy) {
    for (const wire of circuit.wires.values()) {
        if (isPointNearWire(wire, wx, wy, 5)) {
            return wire;
        }
    }
    return null;
}

function updateMarqueeSelection() {
    selectionManager.clear();
    const xMin = Math.min(marqueeStartWorld.x, marqueeEndWorld.x);
    const xMax = Math.max(marqueeStartWorld.x, marqueeEndWorld.x);
    const yMin = Math.min(marqueeStartWorld.y, marqueeEndWorld.y);
    const yMax = Math.max(marqueeStartWorld.y, marqueeEndWorld.y);

    for (const comp of circuit.components.values()) {
        if (comp.x >= xMin && comp.x <= xMax && comp.y >= yMin && comp.y <= yMax) {
            selectionManager.selectedComponents.add(comp);
        }
    }
}

/**
 * Hook up all buttons, modals, category toggles, and side inputs.
 */
function setupUIEvents() {
    // Categories collapse/toggle
    document.querySelectorAll(".category-header").forEach(header => {
        header.addEventListener("click", () => {
            header.parentElement.classList.toggle("collapsed");
        });
    });

    // Clicking Toolbox item registers active placing type
    document.querySelectorAll(".toolbox-item").forEach(item => {
        item.addEventListener("click", () => {
            const type = item.getAttribute("data-type");
            placingComponentType = type;
            canvas.style.cursor = "copy";
        });
    });

    // Search Box logic
    document.getElementById("search-toolbox").addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase().trim();
        document.querySelectorAll(".toolbox-item").forEach(item => {
            const name = item.textContent.toLowerCase();
            if (name.includes(query)) {
                item.style.display = "flex";
            } else {
                item.style.display = "none";
            }
        });
    });

    // Global settings handlers
    document.getElementById("input-oscillation-limit").addEventListener("input", (e) => {
        const val = parseInt(e.target.value) || 1000;
        engine.oscillationLimit = val;
    });

    document.getElementById("select-grid-snap").addEventListener("change", (e) => {
        const val = parseInt(e.target.value) || 20;
        workspace.gridSize = val;
    });

    // Header buttons
    document.getElementById("btn-new-circuit").addEventListener("click", () => {
        if (confirm("Are you sure you want to clear the entire circuit workspace?")) {
            circuit.clear();
            selectionManager.clear();
            engine.evaluateAll();
            saveHistoryState();
            updatePropertiesPanel();
            updateStatusBar();
        }
    });

    document.getElementById("btn-save-project").addEventListener("click", () => {
        const name = prompt("Enter project name to save:", "my_project");
        if (!name) return;

        const payload = serializeCircuit(circuit, registry);
        fetch(`/api/projects/${encodeURIComponent(name)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        })
        .then(res => res.json())
        .then(data => alert(data.message || data.error))
        .catch(err => console.error("Error saving:", err));
    });

    document.getElementById("btn-load-project").addEventListener("click", () => {
        const name = prompt("Enter project name to load:");
        if (!name) return;

        fetch(`/api/projects/${encodeURIComponent(name)}`)
        .then(res => {
            if (!res.ok) throw new Error("Project file not found");
            return res.json();
        })
        .then(data => {
            deserializeCircuit(data, circuit, registry);
            engine.evaluateAll();
            saveHistoryState();
            rebuildCustomModulesList();
            updatePropertiesPanel();
            updateStatusBar();
            alert("Project loaded successfully!");
        })
        .catch(err => alert(err.message));
    });

    // CUSTOM MODULE CREATION WORKFLOW
    const modal = document.getElementById("create-module-modal");

    document.getElementById("btn-create-module").addEventListener("click", () => {
        if (selectionManager.selectedComponents.size === 0) {
            alert("Please select multiple gates on the canvas first to group them into a custom module!");
            return;
        }

        // Identify internal input/output gates
        const inputs = [];
        const outputs = [];
        for (const comp of selectionManager.selectedComponents) {
            if (comp.type === "Input") {
                inputs.push(comp.label || comp.id);
            } else if (comp.type === "Output") {
                outputs.push(comp.label || comp.id);
            }
        }

        // Populating modal info lists
        const inputsList = document.getElementById("modal-inputs-list");
        inputsList.innerHTML = "";
        inputs.forEach(name => {
            const li = document.createElement("li");
            li.textContent = name;
            inputsList.appendChild(li);
        });

        const outputsList = document.getElementById("modal-outputs-list");
        outputsList.innerHTML = "";
        outputs.forEach(name => {
            const li = document.createElement("li");
            li.textContent = name;
            outputsList.appendChild(li);
        });

        document.getElementById("modal-input-count").textContent = inputs.length;
        document.getElementById("modal-output-count").textContent = outputs.length;

        modal.classList.add("active");
    });

    // Close modal triggers
    const closeModal = () => modal.classList.remove("active");
    document.getElementById("btn-close-module-modal").addEventListener("click", closeModal);
    document.getElementById("btn-cancel-module").addEventListener("click", closeModal);

    document.getElementById("create-module-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const name = document.getElementById("module-name").value.trim();
        const desc = document.getElementById("module-desc").value.trim();
        const cat = document.getElementById("module-category").value.trim();

        if (!name) return;

        const modId = name.toLowerCase().replace(/\s+/g, "_") + "_" + Math.random().toString(36).substring(2, 6);

        // Serialize selected subcircuit
        const selectedSet = selectionManager.selectedComponents;
        const compIds = new Set(Array.from(selectedSet).map(c => c.id));

        const subComps = [];
        for (const comp of selectedSet) {
            subComps.push({
                id: comp.id,
                type: comp.type,
                x: comp.x,
                y: comp.y,
                label: comp.label || "",
                definition: comp.type === "UserModule" ? comp.definition : null
            });
        }

        const subWires = [];
        for (const wire of circuit.wires.values()) {
            if (compIds.has(wire.fromPin.component.id) && compIds.has(wire.toPin.component.id)) {
                subWires.push({
                    id: wire.id,
                    fromPin: wire.fromPin.id,
                    toPin: wire.toPin.id,
                    color: wire.color || null
                });
            }
        }

        const externalInputs = [];
        const externalOutputs = [];
        selectedSet.forEach(comp => {
            if (comp.type === "Input") {
                externalInputs.push(comp.label || comp.id);
            } else if (comp.type === "Output") {
                externalOutputs.push(comp.label || comp.id);
            }
        });

        // Create and register the Definition
        const newDef = new ModuleDefinition(modId, name, desc, cat, externalInputs, externalOutputs, subComps, subWires);
        registry.register(newDef);

        // Save to backend custom modules file
        fetch("/api/modules", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: modId,
                name,
                description: desc,
                category: cat,
                inputs: externalInputs,
                outputs: externalOutputs,
                components: subComps,
                wires: subWires
            })
        })
        .then(res => res.json())
        .then(() => {
            rebuildCustomModulesList();
            closeModal();
            alert(`Custom module '${name}' registered and added to toolbox!`);
        });
    });

    // Context popup menu trigger handlers
    document.getElementById("ctx-copy").addEventListener("click", () => triggerCopy());
    document.getElementById("ctx-paste").addEventListener("click", () => triggerPaste());
    document.getElementById("ctx-duplicate").addEventListener("click", () => triggerDuplicate());
    document.getElementById("ctx-delete").addEventListener("click", () => triggerDelete());
    document.getElementById("ctx-rotate").addEventListener("click", () => {
        if (selectionManager.selectedComponents.size === 1) {
            const comp = Array.from(selectionManager.selectedComponents)[0];
            comp.rotation = (comp.rotation + 90) % 360;
            saveHistoryState();
            updatePropertiesPanel();
        }
    });
    document.getElementById("ctx-detach-module").addEventListener("click", () => triggerDetachModuleInstance());
}

/**
 * Rebuild Custom modules toolbox buttons
 */
function rebuildCustomModulesList() {
    const list = document.getElementById("custom-modules-list");
    list.innerHTML = "";

    if (registry.definitions.size === 0) {
        list.innerHTML = '<p class="placeholder-text">No custom modules created yet.</p>';
        return;
    }

    for (const def of registry.definitions.values()) {
        const item = document.createElement("div");
        item.className = "toolbox-item";
        item.setAttribute("data-type", `UserModule:${def.id}`);
        item.innerHTML = `<i class="fa-solid fa-cube"></i> ${def.name}`;
        item.addEventListener("click", () => {
            placingComponentType = `UserModule:${def.id}`;
            canvas.style.cursor = "copy";
        });
        list.appendChild(item);
    }
}

/**
 * Update the left properties inspector panel with details of the selection.
 */
function updatePropertiesPanel() {
    const container = document.getElementById("selection-details");
    container.innerHTML = "";

    // 1. Single Component selected
    if (selectionManager.selectedComponents.size === 1) {
        const comp = Array.from(selectionManager.selectedComponents)[0];

        let customControlsHtml = "";
        // Specific controls by type
        if (comp.type === "Input") {
            customControlsHtml = `
                <div class="property-row">
                    <label for="comp-prop-state">Signal State</label>
                    <select id="comp-prop-state">
                        <option value="0" ${comp.stateValue === 0 ? "selected" : ""}>LOW (0)</option>
                        <option value="1" ${comp.stateValue === 1 ? "selected" : ""}>HIGH (1)</option>
                    </select>
                </div>
            `;
        } else if (comp.type === "Clock") {
            customControlsHtml = `
                <div class="property-row">
                    <label for="comp-prop-clock">Delay (ms)</label>
                    <input type="number" id="comp-prop-clock" value="${comp.intervalMs || 1000}" min="100">
                </div>
            `;
        } else if (comp.type === "LED") {
            customControlsHtml = `
                <div class="property-row">
                    <label for="comp-prop-led-color">LED Color</label>
                    <select id="comp-prop-led-color">
                        <option value="Red" ${comp.ledColor === "Red" ? "selected" : ""}>Red</option>
                        <option value="Green" ${comp.ledColor === "Green" ? "selected" : ""}>Green</option>
                        <option value="Blue" ${comp.ledColor === "Blue" ? "selected" : ""}>Blue</option>
                        <option value="RGBA" ${comp.ledColor === "RGBA" ? "selected" : ""}>Custom RGBA</option>
                    </select>
                </div>
                <div id="led-rgba-row" class="property-row" style="display: ${comp.ledColor === "RGBA" ? "flex" : "none"};">
                    <label for="comp-prop-led-rgba">RGBA Hex/Value</label>
                    <input type="text" id="comp-prop-led-rgba" value="${comp.rgbaValue || "rgba(255, 242, 0, 0.8)"}">
                </div>
            `;
        }

        // Rotation control HTML (always displayed for single component)
        let rotationControlHtml = `
            <div class="property-row">
                <label for="comp-prop-rotation">Rotation</label>
                <select id="comp-prop-rotation">
                    <option value="0" ${comp.rotation === 0 ? "selected" : ""}>0°</option>
                    <option value="90" ${comp.rotation === 90 ? "selected" : ""}>90° (Clockwise)</option>
                    <option value="180" ${comp.rotation === 180 ? "selected" : ""}>180°</option>
                    <option value="270" ${comp.rotation === 270 ? "selected" : ""}>270° (Counter-CW)</option>
                </select>
            </div>
        `;

        // Custom Modules Controls (rename/delete)
        let customModuleDefControls = "";
        let customModuleRepositioningHtml = "";
        if (comp.type === "UserModule") {
            customModuleDefControls = `
                <div class="inspector-section" style="margin-top: 15px;">
                    <h3>Manage Module Def</h3>
                    <div class="property-row">
                        <label for="def-prop-name">Def Name</label>
                        <input type="text" id="def-prop-name" value="${comp.definition.name}">
                    </div>
                    <button id="btn-save-def-rename" class="btn btn-secondary" style="width: 100%; margin-bottom: 8px;"><i class="fa-solid fa-pen"></i> Rename Definition</button>
                    <button id="btn-delete-def" class="btn btn-danger" style="width: 100%;"><i class="fa-solid fa-trash-can"></i> Delete Definition</button>
                </div>
            `;

            const pins = comp.pins();
            if (pins.length > 0) {
                const firstPin = pins[0];
                customModuleRepositioningHtml = `
                    <div class="inspector-section" style="margin-top: 15px;">
                        <h3>Reposition External Pins</h3>
                        <div class="property-row">
                            <label for="comp-prop-pin-select">Select Pin</label>
                            <select id="comp-prop-pin-select">
                                ${pins.map(p => `<option value="${p.id}">${p.name} (${p.type})</option>`).join("")}
                            </select>
                        </div>
                        <div class="property-row">
                            <label for="comp-prop-pin-side">Assign Side</label>
                            <select id="comp-prop-pin-side">
                                <option value="left" ${firstPin.side === "left" ? "selected" : ""}>Left</option>
                                <option value="right" ${firstPin.side === "right" ? "selected" : ""}>Right</option>
                                <option value="top" ${firstPin.side === "top" ? "selected" : ""}>Top</option>
                                <option value="bottom" ${firstPin.side === "bottom" ? "selected" : ""}>Bottom</option>
                            </select>
                        </div>
                        <div class="property-row">
                            <label for="comp-prop-pin-offset">Offset Slider</label>
                            <input type="range" id="comp-prop-pin-offset" min="-150" max="150" value="${firstPin.offset || 0}">
                        </div>
                    </div>
                `;
            }
        }

        container.innerHTML = `
            <div class="inspector-section">
                <h3>Component Properties</h3>
                <div class="property-row">
                    <label>ID</label>
                    <span style="font-size: 11px; color:#aaa; font-family: monospace;">${comp.id}</span>
                </div>
                <div class="property-row">
                    <label>Type</label>
                    <strong style="color: #00adb5;">${comp.type}</strong>
                </div>
                <div class="property-row">
                    <label for="comp-prop-label">Label</label>
                    <input type="text" id="comp-prop-label" value="${comp.label || ""}">
                </div>
                ${rotationControlHtml}
                ${customControlsHtml}
                <button id="btn-comp-delete-single" class="btn btn-danger" style="width: 100%; margin-top: 10px;"><i class="fa-solid fa-trash"></i> Delete Gate</button>
            </div>
            ${customModuleRepositioningHtml}
            ${customModuleDefControls}
        `;

        // Bind property updates
        document.getElementById("comp-prop-label").addEventListener("input", (e) => {
            comp.label = e.target.value.trim();
            saveHistoryState();
        });

        // Rotation listener
        document.getElementById("comp-prop-rotation").addEventListener("change", (e) => {
            comp.rotation = parseInt(e.target.value);
            saveHistoryState();
        });

        if (comp.type === "Input") {
            document.getElementById("comp-prop-state").addEventListener("change", (e) => {
                comp.stateValue = parseInt(e.target.value);
                engine.triggerInputToggle(comp);
                saveHistoryState();
            });
        }

        if (comp.type === "Clock") {
            document.getElementById("comp-prop-clock").addEventListener("input", (e) => {
                comp.intervalMs = parseInt(e.target.value) || 1000;
                saveHistoryState();
            });
        }

        if (comp.type === "LED") {
            document.getElementById("comp-prop-led-color").addEventListener("change", (e) => {
                comp.ledColor = e.target.value;
                const row = document.getElementById("led-rgba-row");
                if (comp.ledColor === "RGBA") {
                    row.style.display = "flex";
                } else {
                    row.style.display = "none";
                }
                saveHistoryState();
            });
            document.getElementById("comp-prop-led-rgba").addEventListener("input", (e) => {
                comp.rgbaValue = e.target.value.trim() || "rgba(255, 242, 0, 0.8)";
                saveHistoryState();
            });
        }

        document.getElementById("btn-comp-delete-single").addEventListener("click", () => {
            circuit.removeComponent(comp.id);
            selectionManager.clear();
            engine.evaluateAll();
            saveHistoryState();
            updatePropertiesPanel();
            updateStatusBar();
        });

        // Bind custom module rename/delete definition triggers!
        if (comp.type === "UserModule") {
            document.getElementById("btn-save-def-rename").addEventListener("click", () => {
                const newName = document.getElementById("def-prop-name").value.trim();
                if (newName) {
                    registry.rename(comp.definition.id, newName);
                    // Update current instance label and definition name
                    comp.definition.name = newName;
                    comp.label = newName;
                    // Propagate to all matching instances on canvas!
                    for (const other of circuit.components.values()) {
                        if (other.type === "UserModule" && other.definition.id === comp.definition.id) {
                            other.definition.name = newName;
                            other.label = newName;
                        }
                    }
                    rebuildCustomModulesList();
                    saveHistoryState();
                    updatePropertiesPanel();
                    alert("Module definition renamed successfully!");
                }
            });

            document.getElementById("btn-delete-def").addEventListener("click", () => {
                if (confirm(`Are you sure you want to delete the definition '${comp.definition.name}'? This will remove all of its active instances from the canvas!`)) {
                    const defId = comp.definition.id;

                    // Remove all matching instances from circuit
                    for (const other of Array.from(circuit.components.values())) {
                        if (other.type === "UserModule" && other.definition.id === defId) {
                            circuit.removeComponent(other.id);
                        }
                    }

                    // Call backend API to delete custom module JSON definition file
                    fetch(`/api/modules/${encodeURIComponent(defId)}`, { method: "DELETE" })
                    .then(() => {
                        registry.delete(defId);
                        rebuildCustomModulesList();
                        selectionManager.clear();
                        engine.evaluateAll();
                        saveHistoryState();
                        updatePropertiesPanel();
                        updateStatusBar();
                        alert("Custom module definition and all instances deleted.");
                    });
                }
            });

            // Pin repositioning elements and listeners
            const pinSelect = document.getElementById("comp-prop-pin-select");
            if (pinSelect) {
                const pinSideSelect = document.getElementById("comp-prop-pin-side");
                const pinOffsetInput = document.getElementById("comp-prop-pin-offset");

                pinSelect.addEventListener("change", () => {
                    const selectedPinId = pinSelect.value;
                    const pinObj = comp.pins().find(p => p.id === selectedPinId);
                    if (pinObj) {
                        pinSideSelect.value = pinObj.side || "left";
                        pinOffsetInput.value = pinObj.offset || 0;
                    }
                });

                const updatePinPosition = () => {
                    const selectedPinId = pinSelect.value;
                    const newSide = pinSideSelect.value;
                    const newOffset = parseInt(pinOffsetInput.value);
                    comp.repositionPin(selectedPinId, newSide, newOffset);
                    saveHistoryState();
                };

                pinSideSelect.addEventListener("change", updatePinPosition);
                pinOffsetInput.addEventListener("input", updatePinPosition);
            }
        }

    }
    // 2. Single Wire selected
    else if (selectionManager.selectedWires.size === 1) {
        const wire = Array.from(selectionManager.selectedWires)[0];

        container.innerHTML = `
            <div class="inspector-section">
                <h3>Wire Properties</h3>
                <div class="property-row">
                    <label>ID</label>
                    <span style="font-size: 11px; color:#aaa; font-family: monospace;">${wire.id}</span>
                </div>
                <div class="property-row">
                    <label>Signal</label>
                    <strong style="color: ${wire.value === 1 ? "#39ff14" : "#e74c3c"};">${wire.value === 1 ? "HIGH (1)" : "LOW (0)"}</strong>
                </div>
                <div class="property-row">
                    <label for="wire-color-picker">Custom Color</label>
                    <input type="color" id="wire-color-picker" value="${wire.color || "#5c6b73"}">
                </div>
                <button id="btn-wire-reset-color" class="btn btn-secondary" style="width: 100%; margin-bottom: 8px;"><i class="fa-solid fa-rotate-left"></i> Use Default State Color</button>
                <button id="btn-wire-delete-single" class="btn btn-danger" style="width: 100%;"><i class="fa-solid fa-trash"></i> Delete Wire</button>
            </div>
        `;

        // Bind color picker input
        document.getElementById("wire-color-picker").addEventListener("input", (e) => {
            wire.color = e.target.value;
            saveHistoryState();
        });

        document.getElementById("btn-wire-reset-color").addEventListener("click", () => {
            wire.color = null;
            document.getElementById("wire-color-picker").value = "#5c6b73";
            saveHistoryState();
        });

        document.getElementById("btn-wire-delete-single").addEventListener("click", () => {
            circuit.removeWire(wire.id);
            selectionManager.clear();
            engine.evaluateAll();
            saveHistoryState();
            updatePropertiesPanel();
            updateStatusBar();
        });
    }
    // 3. No selection placeholder
    else {
        container.innerHTML = `
            <div class="global-settings">
                <h3>Simulation Controls</h3>
                <div class="property-row">
                    <label for="input-oscillation-limit-sub">Oscillation Limit</label>
                    <input type="number" id="input-oscillation-limit-sub" value="${engine.oscillationLimit}" min="10">
                </div>
            </div>
            <div class="placeholder-text">
                <i class="fa-solid fa-info-circle" style="font-size: 24px; color: #444; margin-bottom: 10px;"></i>
                <p>Select a gate, module, or wire on the workspace canvas to inspect and customize its properties.</p>
            </div>
        `;

        // Propagate changes from sub oscillation limit field too
        document.getElementById("input-oscillation-limit-sub").addEventListener("input", (e) => {
            const val = parseInt(e.target.value) || 1000;
            engine.oscillationLimit = val;
            document.getElementById("input-oscillation-limit").value = val;
        });
    }
}

/**
 * Update Stats bottom indicators
 */
function updateStatusBar() {
    document.getElementById("stat-comp-count").textContent = circuit.components.size;
    document.getElementById("stat-wire-count").textContent = circuit.wires.size;

    const simStatusText = document.getElementById("simulation-status");
    if (engine.status === "Oscillation Detected") {
        simStatusText.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Status: <span class="status-red">Oscillation Detected</span>`;
    } else {
        simStatusText.innerHTML = `<i class="fa-solid fa-circle"></i> Status: <span class="status-green">Running</span>`;
    }
}

/**
 * Handle Keyboard Shortcuts
 */
function setupKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
        // Prevent collision with normal text typing in forms
        if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") {
            return;
        }

        const isCtrl = e.ctrlKey || e.metaKey;

        if (isCtrl && e.key.toLowerCase() === "c") {
            e.preventDefault();
            triggerCopy();
        }
        else if (isCtrl && e.key.toLowerCase() === "v") {
            e.preventDefault();
            triggerPaste();
        }
        else if (isCtrl && e.key.toLowerCase() === "d") {
            e.preventDefault();
            triggerDuplicate();
        }
        else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            triggerDelete();
        }
        else if (isCtrl && e.key.toLowerCase() === "z") {
            e.preventDefault();
            const prev = historyManager.undo(JSON.stringify(serializeCircuit(circuit, registry)));
            if (prev) {
                restoreState(prev);
            }
        }
        else if (isCtrl && e.key.toLowerCase() === "y") {
            e.preventDefault();
            const next = historyManager.redo(JSON.stringify(serializeCircuit(circuit, registry)));
            if (next) {
                restoreState(next);
            }
        }
        else if (e.key.toLowerCase() === "r") {
            e.preventDefault();
            if (selectionManager.selectedComponents.size === 1) {
                const comp = Array.from(selectionManager.selectedComponents)[0];
                comp.rotation = (comp.rotation + 90) % 360;
                saveHistoryState();
                updatePropertiesPanel();
            }
        }
    });
}

// Clipboard workflows
function triggerCopy() {
    if (!selectionManager.hasSelection()) return;
    clipboardManager.copy(selectionManager.selectedComponents, selectionManager.selectedWires, circuit.wires.values());
}

function triggerPaste() {
    const pasted = clipboardManager.paste(circuit, workspace);
    if (pasted.length > 0) {
        selectionManager.clear();
        pasted.forEach(comp => selectionManager.selectedComponents.add(comp));
        engine.evaluateAll();
        saveHistoryState();
        updatePropertiesPanel();
        updateStatusBar();
    }
}

function triggerDuplicate() {
    triggerCopy();
    triggerPaste();
}

function triggerDelete() {
    if (!selectionManager.hasSelection()) return;

    for (const comp of selectionManager.selectedComponents) {
        circuit.removeComponent(comp.id);
    }
    for (const wire of selectionManager.selectedWires) {
        circuit.removeWire(wire.id);
    }

    selectionManager.clear();
    engine.evaluateAll();
    saveHistoryState();
    updatePropertiesPanel();
    updateStatusBar();
}

/**
 * "Detach Instance" Converts custom module instance to its normal inner gates & wires on canvas
 */
function triggerDetachModuleInstance() {
    if (selectionManager.selectedComponents.size !== 1) return;
    const comp = Array.from(selectionManager.selectedComponents)[0];
    if (comp.type !== "UserModule") return;

    if (confirm(`Convert the module instance '${comp.label || comp.definition.name}' into normal individual gates on the workspace?`)) {

        const originX = comp.x;
        const originY = comp.y;

        // Map to correlate internal clone IDs to new external gate instances
        const idMap = new Map();

        // 1. Re-instantiate all internal components of the module onto main circuit
        for (const innerC of comp.definition.components) {
            const newId = `${innerC.type.toLowerCase().replace(/\s+/g, "_")}_${Math.random().toString(36).substring(2, 8)}`;

            let newGate;
            if (innerC.type === "UserModule") {
                newGate = new UserModule(newId, innerC.definition, originX + innerC.x, originY + innerC.y);
            } else {
                newGate = createComponent(innerC.type, newId, originX + innerC.x, originY + innerC.y);
            }
            newGate.label = innerC.label;
            circuit.addComponent(newGate);
            idMap.set(innerC.id, newGate);
        }

        // 2. Re-create all internal wire links on main circuit
        for (const innerW of comp.definition.wires) {
            // Find old wire terminal pins original parent ID
            const srcCompId = innerW.fromPin.split("_").slice(0, -1).join("_");
            const tgtCompId = innerW.toPin.split("_").slice(0, -1).join("_");

            const srcNewGate = idMap.get(srcCompId);
            const tgtNewGate = idMap.get(tgtCompId);

            if (srcNewGate && tgtNewGate) {
                // Pin references
                const srcPinName = innerW.fromPin.split("_").slice(-1)[0];
                const tgtPinName = innerW.toPin.split("_").slice(-1)[0];

                // Map by index or name
                const srcPin = srcNewGate.outputs.find(p => p.name === srcPinName) || srcNewGate.outputs[0];
                const tgtPin = tgtNewGate.inputs.find(p => p.name === tgtPinName) || tgtNewGate.inputs[0];

                if (srcPin && tgtPin) {
                    const newWireId = `wire_${Math.random().toString(36).substring(2, 9)}`;
                    const wireObj = new Wire(newWireId, srcPin, tgtPin, innerW.color || null);
                    circuit.addWire(wireObj);
                }
            }
        }

        // 3. Remove the parent module instance
        circuit.removeComponent(comp.id);

        selectionManager.clear();
        engine.evaluateAll();
        saveHistoryState();
        updatePropertiesPanel();
        updateStatusBar();
        alert("Custom module successfully detached!");
    }
}

/**
 * Render all viewport elements.
 */
function render() {
    if (!canvas || !workspace) return;
    const ctx = workspace.ctx;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Draw Infinite Grid
    workspace.drawGrid(w, h);

    // Enter viewport transform space
    ctx.save();
    ctx.translate(workspace.offsetX, workspace.offsetY);
    ctx.scale(workspace.scale, workspace.scale);

    // 2. Draw Wires
    for (const wire of circuit.wires.values()) {
        const isSelected = selectionManager.selectedWires.has(wire);
        drawWire(ctx, wire, isSelected);
    }

    // 3. Draw Active Temporary Wire Drawing
    if (isDrawingWire && activePinSource) {
        const x1 = activePinSource.component.x + activePinSource.relX;
        const y1 = activePinSource.component.y + activePinSource.relY;
        const x2 = activeMouseWorld.x;
        const y2 = activeMouseWorld.y;

        const tempRoute = computeManhattanRoute(x1, y1, x2, y2);
        ctx.save();
        ctx.strokeStyle = "rgba(0, 173, 181, 0.75)";
        ctx.lineWidth = 2.5;
        ctx.lineDashOffset = 5;
        ctx.beginPath();
        ctx.moveTo(tempRoute[0].x, tempRoute[0].y);
        for (let i = 1; i < tempRoute.length; i++) {
            ctx.lineTo(tempRoute[i].x, tempRoute[i].y);
        }
        ctx.stroke();
        ctx.restore();
    }

    // 4. Draw Components
    for (const comp of circuit.components.values()) {
        const isSelected = selectionManager.selectedComponents.has(comp);
        comp.draw(ctx, isSelected);
    }

    // 5. Draw Active Marquee Selection rectangle
    if (isSelectingMarquee) {
        ctx.save();
        ctx.fillStyle = "rgba(0, 173, 181, 0.15)";
        ctx.strokeStyle = "#00adb5";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(
            marqueeStartWorld.x,
            marqueeStartWorld.y,
            marqueeEndWorld.x - marqueeStartWorld.x,
            marqueeEndWorld.y - marqueeStartWorld.y
        );
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    ctx.restore();
}
