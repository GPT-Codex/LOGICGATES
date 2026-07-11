/**
 * Event-driven Simulation Engine for propagating signals through wires in real time.
 */

export class SimulationEngine {
    /**
     * @param {Circuit} circuit
     */
    constructor(circuit) {
        this.circuit = circuit;
        this.oscillationLimit = 1000;
        this.isRunning = true;

        // Cache to quickly find wires originating from a given pin ID
        /** @type {Map<string, Wire[]>} */
        this.pinToWiresMap = new Map();

        // Event Queue: contains components that need to be evaluated
        /** @type {Set<Component>} */
        this.evaluationQueue = new Set();

        this.status = "Running"; // "Running", "Oscillation Detected", "Stopped"
        this.onStatusChange = null; // Callback for UI
    }

    /**
     * Rebuild the lookup cache of pin connections. Call this when components/wires are added or removed.
     */
    rebuildConnectionsCache() {
        this.pinToWiresMap.clear();
        for (const wire of this.circuit.wires.values()) {
            if (!wire.fromPin || !wire.toPin) continue;

            // Map from output pin to wire
            const fromId = wire.fromPin.id;
            if (!this.pinToWiresMap.has(fromId)) {
                this.pinToWiresMap.set(fromId, []);
            }
            this.pinToWiresMap.get(fromId).push(wire);
        }
    }

    /**
     * Queue a component for evaluation.
     * @param {Component} component
     */
    enqueueComponent(component) {
        if (!this.isRunning) return;
        this.evaluationQueue.add(component);
    }

    /**
     * Force evaluate all components once (e.g. at startup or when state is loaded).
     */
    evaluateAll() {
        for (const comp of this.circuit.components.values()) {
            comp.evaluate();
        }
        this.rebuildConnectionsCache();
        // Propagate the initial output states
        for (const comp of this.circuit.components.values()) {
            for (const outPin of comp.outputs) {
                this.propagatePin(outPin);
            }
        }
        this.propagate();
    }

    /**
     * Propagate a change from an output pin to all connected input pins.
     */
    propagatePin(outPin) {
        const wires = this.pinToWiresMap.get(outPin.id) || [];
        for (const wire of wires) {
            const targetPin = wire.toPin;
            if (targetPin && targetPin.value !== outPin.value) {
                targetPin.value = outPin.value;
                // Since target input changed, we must re-evaluate its parent component
                if (targetPin.component) {
                    this.enqueueComponent(targetPin.component);
                }
            }
        }
    }

    /**
     * Process the queued evaluations.
     * Continues until queue is empty or oscillation limit is reached.
     */
    propagate() {
        if (!this.isRunning) return;

        let steps = 0;

        while (this.evaluationQueue.size > 0) {
            steps++;
            if (steps > this.oscillationLimit) {
                this.status = "Oscillation Detected";
                if (this.onStatusChange) {
                    this.onStatusChange(this.status);
                }
                console.warn("Oscillation/infinite loop detected! Simulation halted.");
                this.evaluationQueue.clear();
                return;
            }

            // Get next batch of components to evaluate
            const batch = Array.from(this.evaluationQueue);
            this.evaluationQueue.clear();

            for (const comp of batch) {
                // Remember previous output values to detect changes
                const prevOutputs = comp.outputs.map(p => p.value);

                // Run component's custom logic
                comp.evaluate();

                // Check if any outputs actually changed
                for (let i = 0; i < comp.outputs.length; i++) {
                    if (comp.outputs[i].value !== prevOutputs[i]) {
                        this.propagatePin(comp.outputs[i]);
                    }
                }
            }
        }

        // Circuit is stable
        if (this.status !== "Running") {
            this.status = "Running";
            if (this.onStatusChange) {
                this.onStatusChange(this.status);
            }
        }
    }

    /**
     * Trigger propagation after interactive input toggles.
     */
    triggerInputToggle(inputGate) {
        inputGate.evaluate();
        this.propagatePin(inputGate.outputs[0]);
        this.propagate();
    }
}
