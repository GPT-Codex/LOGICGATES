/**
 * Authoritative Project File Store for digital logic simulator projects.
 * Handles path normalization, root-escaping security checks, in-memory project file storage,
 * and JSON serialization/deserialization.
 */

/**
 * Normalize file path string using '/' as the canonical path separator.
 * Resolves '.' and '..' segments.
 * @param {string} pathStr
 * @returns {string}
 */
export function normalizePath(pathStr) {
    if (typeof pathStr !== "string") return "";
    const cleanStr = pathStr.trim().replace(/^['"]|['"]$/g, "");
    const parts = cleanStr.replace(/\\/g, "/").split("/");
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
 * Check if a path string attempts to traverse above/outside the project root.
 * @param {string} pathStr
 * @returns {boolean}
 */
export function isEscapingRoot(pathStr) {
    if (typeof pathStr !== "string") return true;
    const cleanStr = pathStr.trim().replace(/^['"]|['"]$/g, "");
    const parts = cleanStr.replace(/\\/g, "/").split("/");
    let depth = 0;
    for (const part of parts) {
        if (!part || part === ".") continue;
        if (part === "..") {
            depth--;
            if (depth < 0) return true;
        } else {
            depth++;
        }
    }
    return false;
}

/**
 * In-memory Project File Store representing all .sim files in the current simulator project.
 */
export class ProjectFileStore {
    constructor() {
        /** @type {Map<string, string>} normalized relative path -> file content */
        this.files = new Map();
    }

    /**
     * Store or update a file's source content.
     * @param {string} path
     * @param {string} content
     */
    setFile(path, content) {
        if (isEscapingRoot(path)) {
            throw new Error(`Security Error: Cannot access path outside project root: '${path}'`);
        }
        const norm = normalizePath(path);
        if (!norm) {
            throw new Error(`Invalid file path: '${path}'`);
        }
        this.files.set(norm, typeof content === "string" ? content : String(content ?? ""));
    }

    /**
     * Retrieve a file's content string. Returns null if file does not exist.
     * @param {string} path
     * @returns {string|null}
     */
    getFile(path) {
        if (isEscapingRoot(path)) {
            throw new Error(`Security Error: Cannot access path outside project root: '${path}'`);
        }
        const norm = normalizePath(path);
        return this.files.has(norm) ? this.files.get(norm) : null;
    }

    /**
     * Check if a file exists in the store.
     * @param {string} path
     * @returns {boolean}
     */
    hasFile(path) {
        if (isEscapingRoot(path)) return false;
        const norm = normalizePath(path);
        return this.files.has(norm);
    }

    /**
     * Remove a file from the store.
     * @param {string} path
     */
    removeFile(path) {
        const norm = normalizePath(path);
        this.files.delete(norm);
    }

    /**
     * List all file paths in the store, sorted alphabetically.
     * @returns {string[]}
     */
    listFiles() {
        return Array.from(this.files.keys()).sort();
    }

    /**
     * Clear all project files.
     */
    clear() {
        this.files.clear();
    }

    /**
     * Serialize project files to a plain key-value object.
     * @returns {Object.<string, string>}
     */
    serialize() {
        const obj = {};
        for (const [filePath, content] of this.files.entries()) {
            obj[filePath] = content;
        }
        return obj;
    }

    /**
     * Populate store from a serialized object or array.
     * @param {Object.<string, string>|Array<{path: string, content: string}>} data
     */
    deserialize(data) {
        this.clear();
        if (!data) return;

        if (Array.isArray(data)) {
            for (const item of data) {
                if (item && item.path) {
                    this.setFile(item.path, item.content || "");
                }
            }
        } else if (typeof data === "object") {
            for (const [filePath, content] of Object.entries(data)) {
                this.setFile(filePath, content);
            }
        }
    }
}
