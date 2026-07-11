/**
 * Handles orthogonal (Manhattan) routing, proximity checks, and rendering of wires.
 */

/**
 * Computes orthogonal path between two points.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @returns {Array<{x: number, y: number}>}
 */
export function computeManhattanRoute(x1, y1, x2, y2) {
    const points = [{ x: x1, y: y1 }];

    if (x2 >= x1 + 30) {
        // Target is to the right: standard 3-segment (2 bends) orthogonal route
        const xMid = (x1 + x2) / 2;
        points.push({ x: xMid, y: y1 });
        points.push({ x: xMid, y: y2 });
    } else {
        // Target is to the left or too close: 5-segment (4 bends) loop-around route
        const xOffsetOut = x1 + 15;
        const xOffsetIn = x2 - 15;
        const yMid = (y1 + y2) / 2;

        points.push({ x: xOffsetOut, y: y1 });
        points.push({ x: xOffsetOut, y: yMid });
        points.push({ x: xOffsetIn, y: yMid });
        points.push({ x: xOffsetIn, y: y2 });
    }

    points.push({ x: x2, y: y2 });
    return points;
}

/**
 * Checks if a point (wx, wy) is close to a line segment between p1 and p2.
 */
function isPointNearSegment(wx, wy, p1, p2, threshold) {
    const minX = Math.min(p1.x, p2.x) - threshold;
    const maxX = Math.max(p1.x, p2.x) + threshold;
    const minY = Math.min(p1.y, p2.y) - threshold;
    const maxY = Math.max(p1.y, p2.y) + threshold;

    // Check if within segment bounding box
    if (wx < minX || wx > maxX || wy < minY || wy > maxY) {
        return false;
    }

    // Horizontal segment
    if (Math.abs(p1.y - p2.y) < 0.1) {
        return Math.abs(wy - p1.y) <= threshold;
    }

    // Vertical segment
    if (Math.abs(p1.x - p2.x) < 0.1) {
        return Math.abs(wx - p1.x) <= threshold;
    }

    // Generic line distance (fallback)
    const l2 = (p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2;
    if (l2 === 0) return false;
    const t = ((wx - p1.x) * (p2.x - p1.x) + (wy - p1.y) * (p2.y - p1.y)) / l2;
    const clampedT = Math.max(0, Math.min(1, t));
    const projX = p1.x + clampedT * (p2.x - p1.x);
    const projY = p1.y + clampedT * (p2.y - p1.y);
    const dist2 = (wx - projX) ** 2 + (wy - projY) ** 2;
    return dist2 <= threshold ** 2;
}

/**
 * Checks if a point (wx, wy) in world coordinates is near any segment of a wire.
 * @param {Wire} wire
 * @param {number} wx
 * @param {number} wy
 * @param {number} threshold
 * @returns {boolean}
 */
export function isPointNearWire(wire, wx, wy, threshold = 6) {
    const route = wire.points || [];
    if (route.length < 2) return false;

    for (let i = 0; i < route.length - 1; i++) {
        if (isPointNearSegment(wx, wy, route[i], route[i + 1], threshold)) {
            return true;
        }
    }
    return false;
}

/**
 * Draws a Wire with state coloring, glowing halos, and selection styling.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Wire} wire
 * @param {boolean} isSelected
 */
export function drawWire(ctx, wire, isSelected) {
    if (!wire.fromPin || !wire.toPin) return;

    const p1 = wire.fromPin.component.getPinAbsolutePosition(wire.fromPin);
    const p2 = wire.toPin.component.getPinAbsolutePosition(wire.toPin);
    const x1 = p1.x;
    const y1 = p1.y;
    const x2 = p2.x;
    const y2 = p2.y;

    // Recalculate route points dynamically
    wire.points = computeManhattanRoute(x1, y1, x2, y2);

    ctx.save();

    const isHigh = wire.value === 1;

    // Choose wire colors
    let baseColor = "#5c6b73"; // Default LOW state color
    if (isHigh) {
        baseColor = "#39ff14"; // Bright glowing green for HIGH state
    }

    // Override if custom color is configured
    if (wire.color) {
        baseColor = wire.color;
    }

    // 1. Draw glowing highlight under wire if selected or active HIGH
    if (isSelected) {
        ctx.strokeStyle = "rgba(0, 173, 181, 0.4)";
        ctx.lineWidth = 8;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(wire.points[0].x, wire.points[0].y);
        for (let i = 1; i < wire.points.length; i++) {
            ctx.lineTo(wire.points[i].x, wire.points[i].y);
        }
        ctx.stroke();
    } else if (isHigh) {
        // High signal glow
        ctx.strokeStyle = "rgba(57, 255, 20, 0.25)";
        ctx.lineWidth = 6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(wire.points[0].x, wire.points[0].y);
        for (let i = 1; i < wire.points.length; i++) {
            ctx.lineTo(wire.points[i].x, wire.points[i].y);
        }
        ctx.stroke();
    }

    // 2. Draw actual wire line
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(wire.points[0].x, wire.points[0].y);
    for (let i = 1; i < wire.points.length; i++) {
        ctx.lineTo(wire.points[i].x, wire.points[i].y);
    }
    ctx.stroke();

    // 3. Draw dot markers at corners or branching points
    ctx.fillStyle = baseColor;
    for (let i = 1; i < wire.points.length - 1; i++) {
        // Dot marker at bends
        ctx.beginPath();
        ctx.arc(wire.points[i].x, wire.points[i].y, 2.5, 0, 2 * Math.PI);
        ctx.fill();
    }

    ctx.restore();
}
