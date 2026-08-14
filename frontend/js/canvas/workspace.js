/**
 * Handles the infinite pan-and-zoom workspace math, grid rendering, and snapping.
 */
export class Workspace {
    /**
     * @param {HTMLCanvasElement} canvas 
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        
        // Viewport transform parameters
        this.scale = 1.0;
        this.offsetX = 0;
        this.offsetY = 0;
        
        this.gridSize = 20; // snap spacing
        this.minScale = 0.15;
        this.maxScale = 4.0;
    }

    /**
     * Convert screen coordinates (from mouse events) to world space coordinates.
     */
    screenToWorld(screenX, screenY) {
        const rect = this.canvas.getBoundingClientRect();
        const x = screenX - rect.left;
        const y = screenY - rect.top;
        return {
            x: (x - this.offsetX) / this.scale,
            y: (y - this.offsetY) / this.scale
        };
    }

    /**
     * Convert world space coordinates back to screen space coordinates.
     */
    worldToScreen(worldX, worldY) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: worldX * this.scale + this.offsetX + rect.left,
            y: worldY * this.scale + this.offsetY + rect.top
        };
    }

    /**
     * Round value to the nearest grid intersection.
     */
    snap(val) {
        return Math.round(val / this.gridSize) * this.gridSize;
    }

    /**
     * Zoom centered around a specific screen coordinate (usually the mouse pointer).
     * @param {number} screenX 
     * @param {number} screenY 
     * @param {number} zoomFactor 
     */
    zoomAt(screenX, screenY, zoomFactor) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = screenX - rect.left;
        const mouseY = screenY - rect.top;

        // Remember world coordinates before the zoom
        const worldX = (mouseX - this.offsetX) / this.scale;
        const worldY = (mouseY - this.offsetY) / this.scale;

        // Adjust scale
        this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * zoomFactor));

        // Adjust offset so world position is preserved under the mouse pointer
        this.offsetX = mouseX - worldX * this.scale;
        this.offsetY = mouseY - worldY * this.scale;
    }

    /**
     * Apply the panning offsets directly.
     */
    pan(dx, dy) {
        this.offsetX += dx;
        this.offsetY += dy;
    }

    /**
     * Draw an infinite background grid.
     */
    drawGrid(viewportWidth, viewportHeight) {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = "#141414"; // Beautiful modern darker background
        ctx.fillRect(0, 0, viewportWidth, viewportHeight);

        const scaledGrid = this.gridSize * this.scale;
        
        // Adjust grid division opacity depending on zoom level so it doesn't get cluttered
        let opacity = 0.12;
        if (this.scale < 0.4) opacity = 0.04;

        ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.lineWidth = 1;

        // Calculate where the grid should start relative to viewport boundaries
        const startX = this.offsetX % scaledGrid;
        const startY = this.offsetY % scaledGrid;

        ctx.beginPath();
        
        // Vertical lines
        for (let x = startX; x < viewportWidth; x += scaledGrid) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, viewportHeight);
        }

        // Horizontal lines
        for (let y = startY; y < viewportHeight; y += scaledGrid) {
            ctx.moveTo(0, y);
            ctx.lineTo(viewportWidth, y);
        }

        ctx.stroke();

        // Draw axis lines to indicate coordinates origin (0, 0)
        ctx.strokeStyle = "rgba(100, 150, 255, 0.2)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        
        // Y axis
        if (this.offsetX >= 0 && this.offsetX <= viewportWidth) {
            ctx.moveTo(this.offsetX, 0);
            ctx.lineTo(this.offsetX, viewportHeight);
        }
        
        // X axis
        if (this.offsetY >= 0 && this.offsetY <= viewportHeight) {
            ctx.moveTo(0, this.offsetY);
            ctx.lineTo(viewportWidth, this.offsetY);
        }
        ctx.stroke();

        ctx.restore();
    }
}
