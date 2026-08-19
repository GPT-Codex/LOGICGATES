/**
 * Orchestrator and entrypoint for the Digital Logic Simulator workspace loop and UI bindings.
 */

import { Circuit, Wire } from "../simulation/core.js";
import { createComponent, COMPONENT_REGISTRY } from "../simulation/components.js";
import { SimulationEngine } from "../simulation/simulation_engine.js";
import { ModuleRegistry, ModuleDefinition, UserModule, detachModuleInstance } from "../simulation/modules.js";
import { serializeCircuit, deserializeCircuit, findDefinitionByNameAndType, getUniqueName } from "../simulation/serialization.js";
import { CommandEngine } from "../simulation/command_engine.js";
import { Workspace } from "../canvas/workspace.js";
import { isPointNearWire, drawWire, computeManhattanRoute, isPointNearSegment } from "../canvas/wires.js";
import { SelectionManager, ClipboardManager, HistoryManager } from "../canvas/interactions.js";
import { openModal, closeModal } from "./modals.js";
import { ScriptEditor } from "./script_editor.js";
import { renderMarkdown } from "./markdown_renderer.js";

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

let isDraggingBendPoint = false;
let activeDragWire = null;
let activeDragPointIndex = -1;

let isResizingCableLeft = false;
let isResizingCableRight = false;
let activeResizeCable = null;
let fixedEdgeX = 0;

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

    // Initialize CommandEngine & Setup Power-User Terminal
    const commandEngine = new CommandEngine(circuit, registry, historyManager, engine);

    // Listeners
    window.addEventListener("resize", resizeCanvasToWindow);
    setupCanvasEvents();
    setupUIEvents(commandEngine);
    setupKeyboardShortcuts();
    setupTerminal(commandEngine);

    // Rebuild initial state
    engine.evaluateAll();

    // Master Timer for Clocks and high-resolution visual simulation logic
    let lastTickTime = performance.now();
    setInterval(() => {
        const now = performance.now();
        const elapsedMs = now - lastTickTime;
        lastTickTime = now;

        let changed = false;
        for (const comp of circuit.components.values()) {
            if (comp.type === "Clock") {
                if (!comp.elapsedAccumulator) comp.elapsedAccumulator = 0;
                comp.elapsedAccumulator += elapsedMs;

                if (comp.frequency <= 0) continue;

                // T = 1 / f seconds. Half period = 500 / f ms.
                const halfPeriodMs = 500 / comp.frequency;

                const toggles = Math.floor(comp.elapsedAccumulator / halfPeriodMs);
                if (toggles > 0) {
                    comp.elapsedAccumulator -= toggles * halfPeriodMs;

                    // Cap real-time evaluation toggles to prevent browser freezing.
                    // For frequencies > 1 kHz, cap toggles to a safe number per tick.
                    const cap = comp.frequency > 1000 ? Math.min(toggles, 10) : toggles;
                    for (let i = 0; i < cap; i++) {
                        comp.stateValue = comp.stateValue === 1 ? 0 : 1;
                        comp.evaluate();
                        engine.propagatePin(comp.outputs[0]);
                    }
                    changed = true;
                }
            }
        }
        if (changed) {
            engine.propagate();
        }

        // Always update visual values (which runs 1 kHz logic matching visual throttling rules)
        updateVisualValues(elapsedMs);
    }, 10); // Master timer ticks every 10ms

    // Initial state push
    saveHistoryState();

    // Fetch and register custom modules from backend on startup
    fetch("/api/modules")
    .then(res => res.json())
    .then(data => {
        const modules = data.modules || [];
        for (const modData of modules) {
            const def = new ModuleDefinition(
                modData.id,
                modData.name,
                modData.description,
                modData.category,
                modData.inputs,
                modData.outputs,
                modData.components,
                modData.wires,
                modData.moduleType || "Module",
                modData.type || modData.category || "Custom"
            );
            registry.register(def);
        }
        rebuildCustomModulesList();
        engine.evaluateAll();
        updatePropertiesPanel();
        updateStatusBar();
    })
    .catch(err => console.error("Error loading custom modules on startup:", err));

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
            // Check if clicked near a bend point handle of the selected wire(s)
            for (const wire of selectionManager.selectedWires) {
                if (wire.points && wire.points.length > 2) {
                    for (let i = 1; i < wire.points.length - 1; i++) {
                        const pt = wire.points[i];
                        const dist = Math.hypot(world.x - pt.x, world.y - pt.y);
                        if (dist <= 6) {
                            isDraggingBendPoint = true;
                            activeDragWire = wire;
                            activeDragPointIndex = i;
                            e.preventDefault();
                            return;
                        }
                    }
                }
            }

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
                // Shift keyheld bypasses activation (Req 7) to prioritize editor operations like selection/dragging
                if (clickedComp.type === "Button" && !e.shiftKey) {
                    clickedComp.triggerClick(engine);
                    selectionManager.selectSingleComponent(clickedComp);
                    saveHistoryState();
                    updatePropertiesPanel();
                    return;
                }

                // If it is a Cable, check if clicked near its left or right resizing edges
                if (clickedComp.type === "UserModule" && clickedComp.definition && clickedComp.definition.moduleType === "Cable") {
                    const rightX = clickedComp.x + clickedComp.width / 2;
                    const leftX = clickedComp.x - clickedComp.width / 2;

                    if (Math.abs(world.x - rightX) <= 12) {
                        isResizingCableRight = true;
                        activeResizeCable = clickedComp;
                        fixedEdgeX = leftX; // left edge stays fixed
                        e.preventDefault();
                        return;
                    }
                    if (Math.abs(world.x - leftX) <= 12) {
                        isResizingCableLeft = true;
                        activeResizeCable = clickedComp;
                        fixedEdgeX = rightX; // right edge stays fixed
                        e.preventDefault();
                        return;
                    }
                }

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

        if (isDraggingBendPoint && activeDragWire) {
            const pt = activeDragWire.points[activeDragPointIndex];
            if (pt) {
                pt.x = workspace.snap(world.x);
                pt.y = workspace.snap(world.y);
                activeDragWire.isManuallyRouted = true;
            }
            return;
        }

        if (isResizingCableRight && activeResizeCable) {
            const newWidth = world.x - fixedEdgeX;
            if (newWidth >= 40) {
                activeResizeCable.width = workspace.snap(newWidth);
                activeResizeCable.x = fixedEdgeX + activeResizeCable.width / 2;
                activeResizeCable.pins().forEach(p => activeResizeCable.applyPinSideMath(p));
            }
            return;
        }

        if (isResizingCableLeft && activeResizeCable) {
            const newWidth = fixedEdgeX - world.x;
            if (newWidth >= 40) {
                activeResizeCable.width = workspace.snap(newWidth);
                activeResizeCable.x = fixedEdgeX - activeResizeCable.width / 2;
                activeResizeCable.pins().forEach(p => activeResizeCable.applyPinSideMath(p));
            }
            return;
        }

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

    const deactivateMomentaryButtons = () => {
        let changed = false;
        for (const comp of circuit.components.values()) {
            if (comp.type === "Button") {
                if (comp.buttonMode === "press") {
                    comp.isPressed = false;
                } else if (comp.buttonMode === "hold") {
                    if (comp.isPressed) {
                        comp.isPressed = false;
                        comp.evaluate();
                        engine.propagatePin(comp.outputs[0]);
                        changed = true;
                    }
                }
            }
        }
        if (changed) {
            engine.propagate();
        }
    };

    window.addEventListener("mouseup", deactivateMomentaryButtons);
    window.addEventListener("blur", deactivateMomentaryButtons);
    canvas.addEventListener("mouseleave", deactivateMomentaryButtons);
    canvas.addEventListener("pointercancel", deactivateMomentaryButtons);

    canvas.addEventListener("mouseup", (e) => {
        deactivateMomentaryButtons();

        if (isResizingCableLeft || isResizingCableRight) {
            isResizingCableLeft = false;
            isResizingCableRight = false;
            activeResizeCable = null;
            saveHistoryState();
            return;
        }

        if (isDraggingBendPoint) {
            isDraggingBendPoint = false;
            activeDragWire = null;
            activeDragPointIndex = -1;
            saveHistoryState();
            return;
        }

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

                    const compA = activePinSource.component;
                    const compB = targetPin.component;

                    const isCompACable = compA.type === "UserModule" && compA.definition && compA.definition.moduleType === "Cable";
                    const isCompBConnector = compB.type === "UserModule" && compB.definition && compB.definition.moduleType === "Connector";

                    const isCompBCable = compB.type === "UserModule" && compB.definition && compB.definition.moduleType === "Cable";
                    const isCompAConnector = compA.type === "UserModule" && compA.definition && compA.definition.moduleType === "Connector";

                    if ((isCompACable && isCompBConnector) || (isCompBCable && isCompAConnector)) {
                        const cable = isCompACable ? compA : compB;
                        const connector = isCompACable ? compB : compA;

                        const cablePins = cable.pins();
                        const connectorPins = connector.pins();

                        // 1. Check number of pins
                        if (cablePins.length !== connectorPins.length) {
                            alert(`Connection Rejected: Pin count mismatch.\nCable has ${cablePins.length} pins, but Connector has ${connectorPins.length} pins.`);
                            activePinSource = null;
                            updateStatusBar();
                            return;
                        }

                        // 2. Check Pin names (case-sensitive) must match exactly
                        const cableNames = cablePins.map(p => p.name).sort();
                        const connectorNames = connectorPins.map(p => p.name).sort();

                        for (let i = 0; i < cableNames.length; i++) {
                            if (cableNames[i] !== connectorNames[i]) {
                                alert(`Connection Rejected: Pin name mismatch.\nNo exact case-sensitive match found for pin "${cableNames[i]}" in the Connector.`);
                                activePinSource = null;
                                updateStatusBar();
                                return;
                            }
                        }
                    }

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

    canvas.addEventListener("dblclick", (e) => {
        const world = workspace.screenToWorld(e.clientX, e.clientY);

        // 1. Check if double-clicked near a bend point handle of selected wire
        for (const wire of selectionManager.selectedWires) {
            if (wire.points && wire.points.length > 2) {
                for (let i = 1; i < wire.points.length - 1; i++) {
                    const pt = wire.points[i];
                    const dist = Math.hypot(world.x - pt.x, world.y - pt.y);
                    if (dist <= 8) {
                        // Delete this bend point!
                        wire.points.splice(i, 1);
                        wire.isManuallyRouted = true;
                        saveHistoryState();
                        updatePropertiesPanel();
                        e.preventDefault();
                        return;
                    }
                }
            }
        }

        // 2. Check if double-clicked on any segment of a wire to ADD a bend point!
        for (const wire of circuit.wires.values()) {
            if (wire.points && wire.points.length >= 2) {
                for (let i = 0; i < wire.points.length - 1; i++) {
                    const p1 = wire.points[i];
                    const p2 = wire.points[i+1];
                    if (isPointNearSegment(world.x, world.y, p1, p2, 6)) {
                        // Insert a new bend point at the snapped click position
                        const newPt = {
                            x: workspace.snap(world.x),
                            y: workspace.snap(world.y)
                        };
                        wire.points.splice(i + 1, 0, newPt);
                        wire.isManuallyRouted = true;
                        selectionManager.selectSingleWire(wire);
                        saveHistoryState();
                        updatePropertiesPanel();
                        e.preventDefault();
                        return;
                    }
                }
            }
        }
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

function setupTerminal(commandEngine) {
    const panel = document.getElementById("terminal-panel");
    const header = document.getElementById("terminal-header");
    const toggleBtn = document.getElementById("btn-toggle-terminal");
    const toggleIcon = document.getElementById("terminal-toggle-icon");
    const outputArea = document.getElementById("terminal-output");
    const inputField = document.getElementById("terminal-input");

    if (!panel || !header || !toggleBtn || !toggleIcon || !outputArea || !inputField) {
        return;
    }

    // Toggle collapse
    const toggleTerminal = () => {
        panel.classList.toggle("collapsed");
        const isCollapsed = panel.classList.contains("collapsed");
        toggleIcon.className = isCollapsed ? "fa-solid fa-chevron-up" : "fa-solid fa-chevron-down";
        if (!isCollapsed) {
            inputField.focus();
        }
    };

    header.addEventListener("click", toggleTerminal);
    toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // prevent header click triggering toggle again
        toggleTerminal();
    });

    // History list
    const history = [];
    let historyIdx = -1;

    // Helper to log line
    const logLine = (text, className = "") => {
        const line = document.createElement("div");
        line.className = `terminal-line ${className}`;
        line.textContent = text;
        outputArea.appendChild(line);
        outputArea.scrollTop = outputArea.scrollHeight;
    };

    // Command suggestions for Tab completion
    const suggestionList = [
        "add", "move", "connect", "set", "remove", "list", "show", "undo", "redo",
        "clock", "and", "or", "not", "xor", "nand", "nor", "xnor", "buffer", "button", "input", "output", "led", "npn", "pnp"
    ];

    inputField.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const val = inputField.value.trim();
            if (!val) return;

            // Log command
            logLine(`> ${val}`, "command-line");

            // Execute command
            const res = commandEngine.execute(val);

            if (res.success) {
                logLine(res.message || "Command executed successfully", "success-line");
                // Immediately refresh workspace rendering and properties
                commandEngine.engine.evaluateAll();
                selectionManager.clear();
                updatePropertiesPanel();
                updateStatusBar();
            } else {
                logLine(res.error || "Execution failed", "error-line");
            }

            // Save history
            history.push(val);
            historyIdx = history.length;
            inputField.value = "";
        }
        else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (history.length === 0) return;
            if (historyIdx > 0) {
                historyIdx--;
                inputField.value = history[historyIdx];
            }
        }
        else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (history.length === 0) return;
            if (historyIdx < history.length - 1) {
                historyIdx++;
                inputField.value = history[historyIdx];
            } else {
                historyIdx = history.length;
                inputField.value = "";
            }
        }
        else if (e.key === "Tab") {
            e.preventDefault();
            const val = inputField.value;
            const parts = val.trim().split(/\s+/);
            if (parts.length === 0 || val === "") return;

            const lastWord = parts[parts.length - 1].toLowerCase();
            
            // Check suggestions
            let matches = suggestionList.filter(s => s.startsWith(lastWord));

            // Also suggest existing component names from circuit graph!
            const compNames = Array.from(commandEngine.circuit.components.keys());
            const compMatches = compNames.filter(name => name.toLowerCase().startsWith(lastWord));
            matches = matches.concat(compMatches);

            if (matches.length === 1) {
                // Perform completion
                parts[parts.length - 1] = matches[0];
                inputField.value = parts.join(" ") + " ";
            } else if (matches.length > 1) {
                // Show multiple matches
                logLine(`Suggestions: ${matches.join(", ")}`, "system-line");
            }
        }
        else if (e.key === "Escape") {
            e.preventDefault();
            if (!panel.classList.contains("collapsed")) {
                toggleTerminal();
            }
        }
    });
}

/**
 * Save Project Modal Workflow
 */
function triggerSaveProjectDialog() {
    const html = `
        <div class="form-group" style="margin-bottom: 20px;">
            <label for="save-project-name">Project Name</label>
            <input type="text" id="save-project-name" placeholder="e.g. my_project" style="width: 100%; padding: 8px 10px; font-size: 14px; background-color: #252525; border: 1px solid #3d3d3d; border-radius: 4px; color: #fff; outline: none;" value="my_project">
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" id="btn-save-cancel">Cancel</button>
            <button class="btn btn-primary" id="btn-save-confirm">Save</button>
        </div>
    `;

    openModal('<i class="fa-solid fa-floppy-disk"></i> Save Project', html, () => {
        const input = document.getElementById("save-project-name");
        if (input) {
            input.focus();
            input.select();
        }

        document.getElementById("btn-save-cancel").addEventListener("click", closeModal);

        const performSave = () => {
            const name = input.value.trim();
            if (!name) {
                alert("Please enter a valid project name.");
                return;
            }

            fetch("/api/projects")
            .then(res => res.json())
            .then(data => {
                const exists = data.projects && data.projects.includes(name);
                if (exists) {
                    const confirmHtml = `
                        <p style="margin-bottom: 20px; font-size: 13.5px; line-height: 1.5; color: #ddd;">
                            A project named <strong>${name}</strong> already exists. Overwrite?
                        </p>
                        <div class="modal-footer">
                            <button class="btn btn-secondary" id="btn-overwrite-cancel">Cancel</button>
                            <button class="btn btn-danger" id="btn-overwrite-confirm">Overwrite</button>
                        </div>
                    `;
                    openModal('<i class="fa-solid fa-triangle-exclamation" style="color: #ff9f43;"></i> Overwrite Project?', confirmHtml, () => {
                        document.getElementById("btn-overwrite-cancel").addEventListener("click", () => {
                            triggerSaveProjectDialog();
                        });

                        document.getElementById("btn-overwrite-confirm").addEventListener("click", () => {
                            saveProjectPayload(name);
                        });
                    });
                } else {
                    saveProjectPayload(name);
                }
            });
        };

        document.getElementById("btn-save-confirm").addEventListener("click", performSave);

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                performSave();
            }
        });
    });
}

function saveProjectPayload(name) {
    const payload = serializeCircuit(circuit, registry);
    fetch(`/api/projects/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        closeModal();
        alert(data.message || "Project saved successfully!");
    })
    .catch(err => console.error("Error saving:", err));
}

/**
 * Load Project Modal Workflow
 */
function triggerLoadProjectDialog() {
    fetch("/api/projects")
    .then(res => res.json())
    .then(data => {
        const projects = data.projects || [];

        let listHtml = "";
        if (projects.length === 0) {
            listHtml = `<p class="placeholder-text">No saved projects found.</p>`;
        } else {
            listHtml = `
                <div class="search-box" style="margin: 0 0 10px 0;">
                    <i class="fa-solid fa-magnifying-glass search-icon" style="left: 10px; top: 12px;"></i>
                    <input type="text" id="load-project-search" placeholder="Search saved projects..." style="width: 100%; padding: 8px 10px 8px 30px; font-size: 13px; background-color: #252525; border: 1px solid #3d3d3d; border-radius: 4px; color: #fff; outline: none;">
                </div>
                <div class="modal-list-container" id="load-list-container">
                    ${projects.map(name => `
                        <div class="modal-list-item" data-name="${name}">
                            <div class="modal-item-info">
                                <span class="modal-item-name">${name}</span>
                                <span class="modal-item-date">Local Project File</span>
                            </div>
                            <button class="modal-item-delete-btn" data-name="${name}" title="Delete project">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                        </div>
                    `).join("")}
                </div>
            `;
        }

        const html = `
            ${listHtml}
            <div class="modal-footer" style="margin-top: 20px;">
                <button class="btn btn-secondary" id="btn-load-cancel" style="width: 100%;">Cancel</button>
            </div>
        `;

        openModal('<i class="fa-solid fa-folder-open"></i> Load Project', html, () => {
            document.getElementById("btn-load-cancel").addEventListener("click", closeModal);

            const searchInput = document.getElementById("load-project-search");
            if (searchInput) {
                searchInput.addEventListener("input", (e) => {
                    const q = e.target.value.toLowerCase().trim();
                    const items = document.querySelectorAll(".modal-list-item");
                    items.forEach(item => {
                        const name = item.getAttribute("data-name").toLowerCase();
                        if (name.includes(q)) {
                            item.style.display = "flex";
                        } else {
                            item.style.display = "none";
                        }
                    });
                });
            }

            const items = document.querySelectorAll(".modal-list-item");
            items.forEach(item => {
                item.addEventListener("click", (e) => {
                    if (e.target.closest(".modal-item-delete-btn")) return;
                    const name = item.getAttribute("data-name");
                    loadProjectPayload(name);
                });
            });

            const delBtns = document.querySelectorAll(".modal-item-delete-btn");
            delBtns.forEach(btn => {
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const name = btn.getAttribute("data-name");

                    const deleteConfirmHtml = `
                        <p style="margin-bottom: 20px; font-size: 13.5px; line-height: 1.5; color: #ddd;">
                            Are you sure you want to permanently delete project <strong>${name}</strong>?
                        </p>
                        <div class="modal-footer">
                            <button class="btn btn-secondary" id="btn-delete-confirm-cancel">Cancel</button>
                            <button class="btn btn-danger" id="btn-delete-confirm-ok">Delete</button>
                        </div>
                    `;
                    openModal('<i class="fa-solid fa-trash-can" style="color: #e74c3c;"></i> Delete Project?', deleteConfirmHtml, () => {
                        document.getElementById("btn-delete-confirm-cancel").addEventListener("click", () => {
                            triggerLoadProjectDialog();
                        });

                        document.getElementById("btn-delete-confirm-ok").addEventListener("click", () => {
                            fetch(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" })
                            .then(res => res.json())
                            .then(() => {
                                triggerLoadProjectDialog();
                            });
                        });
                    });
                });
            });
        });
    });
}

function loadProjectPayload(name) {
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
        closeModal();
    })
    .catch(err => alert(err.message));
}

/**
 * Run Script Dialog Workflow
 */
function triggerRunScriptDialog(commandEngine, autoSync = false) {
    const html = `
        <div style="margin-bottom: 12px;">
            <p style="font-size: 13px; color: #ccc; margin-bottom: 8px;">Enter or paste a <code>.sim</code> circuit script:</p>
            <div id="sim-editor-mount"></div>
            <div id="sim-script-error" style="display: none; margin-top: 8px; padding: 8px 12px; background-color: rgba(231, 76, 60, 0.2); border: 1px solid #e74c3c; border-radius: 4px; color: #ff6b6b; font-size: 12px; font-family: monospace;"></div>
        </div>
        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; gap: 8px;">
                <button class="btn btn-secondary" id="btn-load-sim-file"><i class="fa-solid fa-file-arrow-up"></i> Load File...</button>
                <button class="btn btn-secondary" id="btn-sync-from-canvas"><i class="fa-solid fa-rotate"></i> Sync from Canvas</button>
            </div>
            <div>
                <button class="btn btn-secondary" id="btn-run-script-cancel">Cancel</button>
                <button class="btn btn-primary" id="btn-run-script-exec"><i class="fa-solid fa-play"></i> Execute</button>
            </div>
        </div>
    `;

    openModal('<i class="fa-solid fa-code"></i> Run .sim Script', html, () => {
        const mountEl = document.getElementById("sim-editor-mount");
        const errorDiv = document.getElementById("sim-script-error");

        const initialCode = autoSync ? commandEngine.exportScript() : "";
        const editor = new ScriptEditor(mountEl, { initialValue: initialCode });

        document.getElementById("btn-run-script-cancel").addEventListener("click", closeModal);

        document.getElementById("btn-sync-from-canvas").addEventListener("click", () => {
            editor.setValue(commandEngine.exportScript());
        });

        document.getElementById("btn-load-sim-file").addEventListener("click", () => {
            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = ".sim,.txt";
            fileInput.style.display = "none";
            document.body.appendChild(fileInput);

            fileInput.addEventListener("change", (e) => {
                const file = e.target.files[0];
                if (!file) {
                    fileInput.remove();
                    return;
                }
                const reader = new FileReader();
                reader.onload = (ev) => {
                    editor.setValue(ev.target.result);
                    fileInput.remove();
                };
                reader.readAsText(file);
            });
            fileInput.click();
        });

        document.getElementById("btn-run-script-exec").addEventListener("click", () => {
            const code = editor.getValue();
            errorDiv.style.display = "none";
            errorDiv.textContent = "";
            editor.setErrorLine(null);

            const res = commandEngine.executeScript(code);
            if (res.success) {
                commandEngine.engine.evaluateAll();
                selectionManager.clear();
                saveHistoryState();
                updatePropertiesPanel();
                updateStatusBar();
                closeModal();
                alert(`Script executed successfully (${res.linesExecuted} commands).`);
            } else {
                errorDiv.style.display = "block";
                errorDiv.textContent = res.error;
                if (res.line) {
                    editor.setErrorLine(res.line);
                }
            }
        });
    });
}

function triggerScriptDocsDialog() {
    fetch("docs/scripting.md")
    .then(res => res.text())
    .then(markdownText => {
        const html = `
            <div style="max-height: 480px; overflow-y: auto; padding: 12px; background-color: #161616; border: 1px solid #333; border-radius: 6px; color: #ddd; font-size: 13px; line-height: 1.6;">
                ${renderMarkdown(markdownText)}
            </div>
            <div class="modal-footer" style="margin-top: 15px; text-align: right;">
                <button class="btn btn-primary" id="btn-close-docs">Close</button>
            </div>
        `;
        openModal('<i class="fa-solid fa-book"></i> Scripting Language Reference (.sim)', html, () => {
            document.getElementById("btn-close-docs").addEventListener("click", closeModal);
        });
    })
    .catch(err => alert("Error loading scripting documentation: " + err.message));
}

/**
 * Import .sim File Workflow
 */
function triggerImportSimDialog(commandEngine) {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".sim,.txt";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);

    fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) {
            fileInput.remove();
            return;
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
            const content = ev.target.result;
            const res = commandEngine.executeScript(content);

            if (res.success) {
                commandEngine.engine.evaluateAll();
                selectionManager.clear();
                saveHistoryState();
                updatePropertiesPanel();
                updateStatusBar();
                alert(`Successfully imported script from '${file.name}' (${res.linesExecuted} commands executed).`);
            } else {
                alert(`Import Failed:\n${res.error}`);
            }
            fileInput.remove();
        };
        reader.readAsText(file);
    });

    fileInput.click();
}

/**
 * Export .sim Circuit Workflow
 */
function triggerExportSimDialog(commandEngine) {
    const scriptText = commandEngine.exportScript();

    // 1. Trigger file download
    const blob = new Blob([scriptText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = url;
    downloadAnchor.download = "circuit.sim";
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);

    // 2. Open preview modal
    const html = `
        <div style="margin-bottom: 12px;">
            <p style="font-size: 13px; color: #ccc; margin-bottom: 8px;">Exported <code>.sim</code> circuit script:</p>
            <textarea id="sim-export-output" rows="10" readonly style="width: 100%; box-sizing: border-box; background-color: #1a1a1a; border: 1px solid #3d3d3d; border-radius: 4px; color: #39ff14; font-family: monospace; font-size: 13px; padding: 10px; resize: vertical; outline: none;">${scriptText}</textarea>
        </div>
        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center;">
            <button class="btn btn-secondary" id="btn-copy-sim"><i class="fa-solid fa-copy"></i> Copy to Clipboard</button>
            <button class="btn btn-primary" id="btn-close-sim-export">Close</button>
        </div>
    `;

    openModal('<i class="fa-solid fa-file-export"></i> Export .sim Circuit', html, () => {
        document.getElementById("btn-close-sim-export").addEventListener("click", closeModal);
        document.getElementById("btn-copy-sim").addEventListener("click", () => {
            const textarea = document.getElementById("sim-export-output");
            textarea.select();
            if (navigator.clipboard) {
                navigator.clipboard.writeText(textarea.value).then(() => {
                    alert("Script copied to clipboard!");
                }).catch(() => {
                    alert("Script copied to clipboard!");
                });
            } else {
                alert("Script copied to clipboard!");
            }
        });
    });
}

/**
 * Hook up all buttons, modals, category toggles, and side inputs.
 */
function setupUIEvents(commandEngine) {
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
        const confirmHtml = `
            <p style="margin-bottom: 20px; font-size: 13.5px; line-height: 1.5; color: #ddd;">
                Are you sure you want to clear the entire circuit workspace? This will delete all components and wires.
            </p>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="btn-clear-cancel">Cancel</button>
                <button class="btn btn-danger" id="btn-clear-confirm">Clear Workspace</button>
            </div>
        `;
        openModal('<i class="fa-solid fa-triangle-exclamation" style="color: #ff9f43;"></i> Clear Workspace?', confirmHtml, () => {
            document.getElementById("btn-clear-cancel").addEventListener("click", closeModal);
            document.getElementById("btn-clear-confirm").addEventListener("click", () => {
                circuit.clear();
                selectionManager.clear();
                engine.evaluateAll();
                saveHistoryState();
                updatePropertiesPanel();
                updateStatusBar();
                closeModal();
            });
        });
    });

    document.getElementById("btn-save-project").addEventListener("click", () => {
        triggerSaveProjectDialog();
    });

    document.getElementById("btn-load-project").addEventListener("click", () => {
        triggerLoadProjectDialog();
    });

    document.getElementById("btn-run-script").addEventListener("click", () => {
        triggerRunScriptDialog(commandEngine, false);
    });

    document.getElementById("btn-sync-canvas").addEventListener("click", () => {
        triggerRunScriptDialog(commandEngine, true);
    });

    document.getElementById("btn-import-sim").addEventListener("click", () => {
        triggerImportSimDialog(commandEngine);
    });

    document.getElementById("btn-export-sim").addEventListener("click", () => {
        triggerExportSimDialog(commandEngine);
    });

    document.getElementById("btn-script-docs").addEventListener("click", () => {
        triggerScriptDocsDialog();
    });

    document.getElementById("btn-export-library").addEventListener("click", () => {
        triggerExportLibrary();
    });

    document.getElementById("btn-import-library").addEventListener("click", () => {
        triggerImportLibrary();
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

    document.getElementById("create-module-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = document.getElementById("module-name").value.trim();
        const desc = document.getElementById("module-desc").value.trim();
        const cat = document.getElementById("module-category").value.trim();
        const moduleType = document.getElementById("module-type").value;

        if (!name) return;

        const type = cat || "Custom";

        // Check for duplicate (name, type)
        const existingDef = findDefinitionByNameAndType(registry, name, type);
        let finalName = name;
        let modId = name.toLowerCase().replace(/\s+/g, "_") + "_" + Math.random().toString(36).substring(2, 6);
        let choice = "new";

        if (existingDef) {
            choice = await promptDuplicateResolve(name, type);
            if (choice === "replace") {
                modId = existingDef.id; // overwrite the same id
            } else {
                finalName = getUniqueName(registry, name, type);
                modId = finalName.toLowerCase().replace(/\s+/g, "_") + "_" + Math.random().toString(36).substring(2, 6);
            }
        }

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

        if (existingDef && choice === "replace") {
            // REPLACE: Update existing definition in-place
            existingDef.name = finalName;
            existingDef.description = desc;
            existingDef.category = cat;
            existingDef.type = type;
            existingDef.inputs = externalInputs;
            existingDef.outputs = externalOutputs;
            existingDef.components = subComps;
            existingDef.wires = subWires;
            existingDef.moduleType = moduleType;

            await saveModuleToBackend(existingDef);

            // Re-build inner circuit of all active matching instances on canvas
            for (const other of circuit.components.values()) {
                if (other.type === "UserModule" && other.definition.id === existingDef.id) {
                    other.buildInnerCircuit();
                }
            }
            alert(`Custom module '${finalName}' replaced successfully!`);
        } else {
            // Create and register the Definition
            const newDef = new ModuleDefinition(modId, finalName, desc, cat, externalInputs, externalOutputs, subComps, subWires, moduleType, type);
            registry.register(newDef);

            await saveModuleToBackend(newDef);
            alert(`Custom module '${finalName}' registered and added to toolbox!`);
        }

        rebuildCustomModulesList();
        closeModal();
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

function promptDuplicateResolve(name, type) {
    return new Promise((resolve) => {
        const html = `
            <p style="margin-bottom: 20px; font-size: 13.5px; line-height: 1.5; color: #ddd;">
                A custom part named <strong>${name}</strong> of type <strong>${type}</strong> already exists.
            </p>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="btn-resolve-new">Save as New</button>
                <button class="btn btn-danger" id="btn-resolve-replace">Replace</button>
            </div>
        `;
        openModal('<i class="fa-solid fa-clone" style="color: #ff9f43;"></i> Duplicate Part Found', html, () => {
            document.getElementById("btn-resolve-new").onclick = () => {
                closeModal();
                resolve("new");
            };
            document.getElementById("btn-resolve-replace").onclick = () => {
                closeModal();
                resolve("replace");
            };
        });
    });
}

function saveModuleToBackend(def) {
    return fetch("/api/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        })
    }).then(res => {
        if (!res.ok) throw new Error("Failed to save imported module to backend");
        return res.json();
    });
}

function triggerExportLibrary() {
    const definitions = [];
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

    const payload = {
        libraryName: "Custom Parts Library",
        exportedAt: new Date().toISOString(),
        definitions: definitions
    };

    const blob = new Blob([JSON.stringify(payload, null, 4)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement("a");
    downloadAnchor.href = url;
    downloadAnchor.download = "custom_parts_library.json";
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);
}

function triggerImportLibrary() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);

    fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) {
            fileInput.remove();
            return;
        }

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target.result);

                // 1. Validation
                if (!data || !Array.isArray(data.definitions)) {
                    alert("Import Failed: Incompatible or malformed library data.");
                    return;
                }

                // 2. Loop through each imported definition
                const defsToProcess = data.definitions;
                let importCount = 0;

                for (const defData of defsToProcess) {
                    // Validate individual definition
                    if (!defData.id || !defData.name || !Array.isArray(defData.inputs) || !Array.isArray(defData.outputs) || !Array.isArray(defData.components) || !Array.isArray(defData.wires)) {
                        alert(`Skipping malformed part definition: ${defData.name || "Unknown"}`);
                        continue;
                    }

                    const name = defData.name.trim();
                    const type = (defData.type || defData.category || "Custom").trim();

                    // Check duplicate rule: combination (name, type)
                    const existingDef = findDefinitionByNameAndType(registry, name, type);
                    if (existingDef) {
                        const choice = await promptDuplicateResolve(name, type);
                        if (choice === "replace") {
                            // REPLACE: Update existing definition
                            existingDef.description = defData.description || "";
                            existingDef.category = defData.category || "Custom";
                            existingDef.type = type;
                            existingDef.inputs = defData.inputs;
                            existingDef.outputs = defData.outputs;
                            existingDef.components = defData.components;
                            existingDef.wires = defData.wires;
                            existingDef.moduleType = defData.moduleType || "Module";

                            // Save to backend custom modules file
                            await saveModuleToBackend(existingDef);

                            // Re-evaluate matching instances on canvas
                            for (const other of circuit.components.values()) {
                                if (other.type === "UserModule" && other.definition.id === existingDef.id) {
                                    other.buildInnerCircuit();
                                }
                            }
                            importCount++;
                        } else if (choice === "new") {
                            // SAVE AS NEW: Generate unique name & ID
                            const uniqueName = getUniqueName(registry, name, type);
                            const uniqueId = uniqueName.toLowerCase().replace(/\s+/g, "_") + "_" + Math.random().toString(36).substring(2, 6);

                            const newDef = new ModuleDefinition(
                                uniqueId,
                                uniqueName,
                                defData.description || "",
                                defData.category || "Custom",
                                defData.inputs,
                                defData.outputs,
                                defData.components,
                                defData.wires,
                                defData.moduleType || "Module",
                                type
                            );

                            registry.register(newDef);
                            await saveModuleToBackend(newDef);
                            importCount++;
                        }
                    } else {
                        // NO DUPLICATE: Register and save
                        // Ensure unique ID in registry to be safe
                        let uniqueId = defData.id;
                        if (registry.get(uniqueId)) {
                            uniqueId = defData.id.split("_").slice(0, -1).join("_") + "_" + Math.random().toString(36).substring(2, 6);
                        }

                        const newDef = new ModuleDefinition(
                            uniqueId,
                            name,
                            defData.description || "",
                            defData.category || "Custom",
                            defData.inputs,
                            defData.outputs,
                            defData.components,
                            defData.wires,
                            defData.moduleType || "Module",
                            type
                        );

                        registry.register(newDef);
                        await saveModuleToBackend(newDef);
                        importCount++;
                    }
                }

                rebuildCustomModulesList();
                engine.evaluateAll();
                saveHistoryState();
                updatePropertiesPanel();
                updateStatusBar();
                alert(`Successfully imported ${importCount} custom parts!`);

            } catch (err) {
                console.error(err);
                alert("Import Failed: Invalid JSON format.");
            } finally {
                fileInput.remove();
            }
        };

        reader.readAsText(file);
    });

    fileInput.click();
}

function formatTypeName(type) {
    if (!type) return "Custom";
    return type.split(/[\s_-]+/)
               .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
               .join(" ");
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

    // Group definitions by their type
    const groups = new Map();
    for (const def of registry.definitions.values()) {
        const typeKey = (def.type || def.category || "Custom").trim();
        if (!groups.has(typeKey)) {
            groups.set(typeKey, []);
        }
        groups.get(typeKey).push(def);
    }

    // Sort group keys to be alphabetical
    const sortedKeys = Array.from(groups.keys()).sort();

    for (const typeKey of sortedKeys) {
        const defs = groups.get(typeKey);
        
        // Create section for this type
        const section = document.createElement("div");
        section.className = "custom-group-section";
        section.style.marginBottom = "10px";

        const header = document.createElement("h4");
        header.className = "custom-group-header";
        header.style.margin = "5px 0";
        header.style.color = "#00adb5";
        header.style.fontSize = "12px";
        header.style.borderBottom = "1px solid #3d3d3d";
        header.style.paddingBottom = "3px";
        header.style.textTransform = "capitalize";
        header.textContent = formatTypeName(typeKey);
        
        section.appendChild(header);

        const itemsContainer = document.createElement("div");
        itemsContainer.className = "custom-group-items";

        for (const def of defs) {
            const item = document.createElement("div");
            item.className = "toolbox-item";
            item.setAttribute("data-type", `UserModule:${def.id}`);
            item.innerHTML = `<i class="fa-solid fa-cube"></i> ${def.name}`;
            item.addEventListener("click", () => {
                placingComponentType = `UserModule:${def.id}`;
                canvas.style.cursor = "copy";
            });
            itemsContainer.appendChild(item);
        }

        section.appendChild(itemsContainer);
        list.appendChild(section);
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
                    <label for="comp-prop-clock-freq">Frequency</label>
                    <div style="display: flex; gap: 5px; width: 120px;">
                        <input type="number" id="comp-prop-clock-freq" value="${comp.frequencyValue !== undefined ? comp.frequencyValue : 1}" step="any" min="0.000001" style="width: 65px; min-width: 0; padding: 4px;">
                        <select id="comp-prop-clock-unit" style="width: 50px; min-width: 0; padding: 2px; font-size: 11px;">
                            <option value="Hz" ${comp.frequencyUnit === "Hz" ? "selected" : ""}>Hz</option>
                            <option value="kHz" ${comp.frequencyUnit === "kHz" ? "selected" : ""}>kHz</option>
                            <option value="MHz" ${comp.frequencyUnit === "MHz" ? "selected" : ""}>MHz</option>
                            <option value="GHz" ${comp.frequencyUnit === "GHz" ? "selected" : ""}>GHz</option>
                        </select>
                    </div>
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
        } else if (comp.type === "Button") {
            customControlsHtml = `
                <div class="property-row">
                    <label for="comp-prop-btn-mode">Mode</label>
                    <select id="comp-prop-btn-mode">
                        <option value="press" ${comp.buttonMode === "press" ? "selected" : ""}>Press (Toggle)</option>
                        <option value="hold" ${comp.buttonMode === "hold" ? "selected" : ""}>Hold (Momentary)</option>
                    </select>
                </div>
                <div id="btn-hold-row" class="property-row" style="display: ${comp.buttonMode === "hold" ? "flex" : "none"};">
                    <label for="comp-prop-btn-duration">Hold Duration</label>
                    <div style="display: flex; gap: 5px; width: 120px;">
                        <input type="number" id="comp-prop-btn-duration" value="${comp.holdUnit === "s" ? comp.holdDuration / 1000 : comp.holdDuration}" step="any" min="0.001" style="width: 65px; min-width: 0; padding: 4px;">
                        <select id="comp-prop-btn-unit" style="width: 50px; min-width: 0; padding: 2px; font-size: 11px;">
                            <option value="ms" ${comp.holdUnit === "ms" ? "selected" : ""}>ms</option>
                            <option value="s" ${comp.holdUnit === "s" ? "selected" : ""}>s</option>
                        </select>
                    </div>
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

        let flipControlHtml = `
            <div class="property-row">
                <label>Flipping</label>
                <div style="display: flex; gap: 10px;">
                    <label style="font-size: 11px; display: flex; align-items: center; gap: 4px; color: #ccc;">
                        <input type="checkbox" id="comp-prop-flip-x" ${comp.flipX ? "checked" : ""}> Flip H
                    </label>
                    <label style="font-size: 11px; display: flex; align-items: center; gap: 4px; color: #ccc;">
                        <input type="checkbox" id="comp-prop-flip-y" ${comp.flipY ? "checked" : ""}> Flip V
                    </label>
                </div>
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
                ${flipControlHtml}
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

        // Flip listeners
        document.getElementById("comp-prop-flip-x").addEventListener("change", (e) => {
            comp.flipX = e.target.checked;
            saveHistoryState();
        });

        document.getElementById("comp-prop-flip-y").addEventListener("change", (e) => {
            comp.flipY = e.target.checked;
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
            const freqInput = document.getElementById("comp-prop-clock-freq");
            const unitSelect = document.getElementById("comp-prop-clock-unit");

            const onFreqChange = () => {
                let val = parseFloat(freqInput.value);
                if (isNaN(val) || val <= 0) val = 1;

                comp.frequencyValue = val;
                comp.frequencyUnit = unitSelect.value;
                comp.updateFrequency();

                // Keep values synchronized on input elements
                freqInput.value = comp.frequencyValue;
                unitSelect.value = comp.frequencyUnit;

                saveHistoryState();
            };

            freqInput.addEventListener("input", onFreqChange);
            unitSelect.addEventListener("change", onFreqChange);
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

        if (comp.type === "Button") {
            const modeSelect = document.getElementById("comp-prop-btn-mode");
            const holdRow = document.getElementById("btn-hold-row");
            const durationInput = document.getElementById("comp-prop-btn-duration");
            const unitSelect = document.getElementById("comp-prop-btn-unit");

            modeSelect.addEventListener("change", (e) => {
                comp.buttonMode = e.target.value;
                if (comp.buttonMode === "hold") {
                    holdRow.style.display = "flex";
                } else {
                    holdRow.style.display = "none";
                }
                saveHistoryState();
            });

            const onDurationChange = () => {
                let val = parseFloat(durationInput.value);
                if (isNaN(val) || val <= 0) val = 1;

                comp.holdUnit = unitSelect.value;
                if (comp.holdUnit === "s") {
                    comp.holdDuration = val * 1000;
                } else {
                    comp.holdDuration = val;
                }
                saveHistoryState();
            };

            durationInput.addEventListener("input", onDurationChange);
            unitSelect.addEventListener("change", onDurationChange);
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
            document.getElementById("btn-save-def-rename").addEventListener("click", async () => {
                const newName = document.getElementById("def-prop-name").value.trim();
                if (!newName) return;

                const type = comp.definition.type || comp.definition.category || "Custom";
                if (newName.toLowerCase().trim() === comp.definition.name.toLowerCase().trim()) {
                    return; // No change
                }

                const existingDef = findDefinitionByNameAndType(registry, newName, type);
                let finalName = newName;

                if (existingDef) {
                    const choice = await promptDuplicateResolve(newName, type);
                    if (choice === "replace") {
                        // REPLACE:
                        // Delete the current definition and update existingDef to use current definition's circuit data
                        existingDef.components = comp.definition.components;
                        existingDef.wires = comp.definition.wires;
                        existingDef.inputs = comp.definition.inputs;
                        existingDef.outputs = comp.definition.outputs;
                        existingDef.description = comp.definition.description;
                        existingDef.moduleType = comp.definition.moduleType;

                        await saveModuleToBackend(existingDef);

                        // Point all instances on canvas of deleted definition to existingDef!
                        const oldId = comp.definition.id;
                        for (const other of circuit.components.values()) {
                            if (other.type === "UserModule" && other.definition.id === oldId) {
                                other.definition = existingDef;
                                other.label = existingDef.name;
                                other.buildInnerCircuit();
                            }
                        }

                        // Call backend API to delete the old custom module definition file
                        fetch(`/api/modules/${encodeURIComponent(oldId)}`, { method: "DELETE" })
                        .then(() => {
                            registry.delete(oldId);
                            rebuildCustomModulesList();
                            saveHistoryState();
                            updatePropertiesPanel();
                            alert(`Definition successfully merged into '${existingDef.name}'!`);
                        });
                        return;

                    } else {
                        // SAVE AS NEW (get unique name):
                        finalName = getUniqueName(registry, newName, type);
                    }
                }

                // If no duplicate or resolved as new:
                registry.rename(comp.definition.id, finalName);
                comp.definition.name = finalName;
                comp.label = finalName;
                // Propagate rename to all matching instances on canvas!
                for (const other of circuit.components.values()) {
                    if (other.type === "UserModule" && other.definition.id === comp.definition.id) {
                        other.definition.name = finalName;
                        other.label = finalName;
                    }
                }
                // Save updated definition to backend
                await saveModuleToBackend(comp.definition);

                rebuildCustomModulesList();
                saveHistoryState();
                updatePropertiesPanel();
                alert(`Module definition renamed to '${finalName}' successfully!`);
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
        else if (isCtrl && e.shiftKey && e.key.toLowerCase() === "z") {
            e.preventDefault();
            const next = historyManager.redo(JSON.stringify(serializeCircuit(circuit, registry)));
            if (next) {
                restoreState(next);
            }
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
        else if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            let dx = 0, dy = 0;
            const step = e.shiftKey ? (workspace ? workspace.gridSize : 20) : 1;
            if (e.key === "ArrowLeft") dx = -step;
            else if (e.key === "ArrowRight") dx = step;
            else if (e.key === "ArrowUp") dy = -step;
            else if (e.key === "ArrowDown") dy = step;

            for (const comp of selectionManager.selectedComponents) {
                comp.x += dx;
                comp.y += dy;
                if (comp.type === "UserModule") {
                    comp.pins().forEach(p => comp.applyPinSideMath(p));
                    if (comp.definition && comp.definition.moduleType === "Cable") {
                        comp.translatePoints(dx, dy);
                    }
                }
            }
            saveHistoryState();
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
        try {
            detachModuleInstance(circuit, comp, registry);
            selectionManager.clear();
            engine.evaluateAll();
            saveHistoryState();
            updatePropertiesPanel();
            updateStatusBar();
            alert("Custom module successfully detached!");
        } catch (e) {
            alert(`Detach failed: ${e.message}`);
        }
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

/**
 * Perform 1 kHz visual evaluation of gate animated states.
 */
function updateVisualValues(elapsedMs) {
    // 1. Set Clock output visualValue
    for (const comp of circuit.components.values()) {
        if (comp.type === "Clock") {
            if (comp.frequency <= 1000) {
                // Low frequency: visual matches exact value
                comp.outputs[0].visualValue = comp.outputs[0].value;
            } else {
                // High frequency: toggle visual value at exactly 1 kHz (half period = 0.5 ms)
                if (!comp.lastVisualToggle) comp.lastVisualToggle = 0;
                comp.lastVisualToggle += elapsedMs;
                if (comp.lastVisualToggle >= 0.5) {
                    comp.lastVisualToggle = 0;
                    comp.visualState = comp.visualState === 1 ? 0 : 1;
                }
                comp.outputs[0].visualValue = comp.visualState || 0;
            }
        } else if (comp.type === "Input") {
            comp.outputs[0].visualValue = comp.outputs[0].value;
        } else if (comp.type === "Constant HIGH") {
            comp.outputs[0].visualValue = 1;
        } else if (comp.type === "Constant LOW") {
            comp.outputs[0].visualValue = 0;
        }
    }

    // 2. Propagate through wires
    for (const wire of circuit.wires.values()) {
        if (wire.fromPin && wire.toPin) {
            wire.toPin.visualValue = wire.fromPin.visualValue;
        }
    }

    // 3. Multi-pass evaluation of gates for visual rendering
    for (let pass = 0; pass < 4; pass++) {
        for (const comp of circuit.components.values()) {
            if (comp.type !== "Clock" && comp.type !== "Input" && comp.type !== "Constant HIGH" && comp.type !== "Constant LOW") {
                // Save original value states
                const savedInputs = comp.inputs.map(p => p.value);
                const savedOutputs = comp.outputs.map(p => p.value);

                // Temporarily assign visualValues to run evaluate()
                comp.inputs.forEach(p => p.value = p.visualValue || 0);

                comp.evaluate();

                // Save resulting evaluation output back to visualValue
                comp.outputs.forEach(p => p.visualValue = p.value);

                // Restore simulation state
                comp.inputs.forEach((p, idx) => p.value = savedInputs[idx]);
                comp.outputs.forEach((p, idx) => p.value = savedOutputs[idx]);
            }
        }
        // Propagate intermediate visualValues
        for (const wire of circuit.wires.values()) {
            if (wire.fromPin && wire.toPin) {
                wire.toPin.visualValue = wire.fromPin.visualValue;
            }
        }
    }
}
