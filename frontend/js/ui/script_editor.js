/**
 * Syntax Highlighter Tokenizer for .sim circuit scripts.
 * Matches grammar:
 * - Commands: add, remove, move, connect, disconnect, set, get, list, show, expr, bus, net, for, in
 * - Component types: input, output, clock, and, or, xor, not, nand, nor, xnor, buffer, button, npn, pnp, led, 7-segment display, 10-segment display
 * - Numbers / Coordinates / Frequencies / Booleans
 * - Operators: =, ->, =>, AND, OR, XOR, NOT, NAND, NOR, XNOR
 * - Identifiers: A, A[0], G[1].A
 * - Comments: # ...
 */

const COMMANDS = new Set([
    "add", "remove", "move", "connect", "disconnect", "set", "get", "list", "show", "expr", "bus", "net", "for", "in"
]);

const COMP_TYPES = new Set([
    "input", "output", "clock", "and", "or", "xor", "not", "nand", "nor", "xnor",
    "buffer", "button", "npn", "pnp", "led", "7-segment display", "10-segment display",
    "constant high", "constant low"
]);

const LOGIC_OPS = new Set([
    "and", "or", "xor", "not", "nand", "nor", "xnor"
]);

/**
 * Escape HTML special characters.
 */
function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Highlight a line or chunk of .sim script text into HTML.
 * @param {string} text
 * @returns {string}
 */
export function highlightSimScript(text) {
    if (typeof text !== "string") return "";

    const lines = text.split("\n");
    const highlightedLines = lines.map(line => {
        let commentHtml = "";
        let codePart = line;

        const commentIdx = line.indexOf("#");
        if (commentIdx !== -1) {
            codePart = line.substring(0, commentIdx);
            const rawComment = line.substring(commentIdx);
            commentHtml = `<span class="syn-comment">${escapeHtml(rawComment)}</span>`;
        }

        // Tokenize codePart
        let html = "";
        let i = 0;

        while (i < codePart.length) {
            const ch = codePart[i];

            if (/\s/.test(ch)) {
                html += escapeHtml(ch);
                i++;
                continue;
            }

            // Arrow operators -> or =>
            if ((ch === "-" || ch === "=") && codePart[i + 1] === ">") {
                html += `<span class="syn-operator">${escapeHtml(ch + ">")}</span>`;
                i += 2;
                continue;
            }

            if (ch === "=") {
                html += `<span class="syn-operator">=</span>`;
                i++;
                continue;
            }

            // Numbers / ranges / coordinates / frequencies
            if (/\d/.test(ch)) {
                let numStr = "";
                while (i < codePart.length && /[\d\.]/.test(codePart[i])) {
                    numStr += codePart[i];
                    i++;
                }
                // Check optional unit like MHz, kHz, Hz, GHz
                let unitStr = "";
                if (i < codePart.length && /[a-zA-Z]/.test(codePart[i])) {
                    let uStart = i;
                    while (i < codePart.length && /[a-zA-Z]/.test(codePart[i])) {
                        i++;
                    }
                    unitStr = codePart.substring(uStart, i);
                }
                html += `<span class="syn-number">${escapeHtml(numStr + unitStr)}</span>`;
                continue;
            }

            // Words (commands, keywords, types, identifiers)
            if (/[a-zA-Z_]/.test(ch)) {
                let wStart = i;
                while (i < codePart.length && /[a-zA-Z0-9_]/.test(codePart[i])) {
                    i++;
                }
                const word = codePart.substring(wStart, i);
                const lowerWord = word.toLowerCase();

                if (COMMANDS.has(lowerWord)) {
                    html += `<span class="syn-command">${escapeHtml(word)}</span>`;
                } else if (COMP_TYPES.has(lowerWord)) {
                    html += `<span class="syn-type">${escapeHtml(word)}</span>`;
                } else if (LOGIC_OPS.has(lowerWord)) {
                    html += `<span class="syn-operator">${escapeHtml(word)}</span>`;
                } else if (["true", "false"].includes(lowerWord)) {
                    html += `<span class="syn-number">${escapeHtml(word)}</span>`;
                } else {
                    html += `<span class="syn-identifier">${escapeHtml(word)}</span>`;
                }
                continue;
            }

            // Brackets / Parens / Punctuation
            if (["{", "}", "(", ")", "[", "]", ".", ","].includes(ch)) {
                html += `<span class="syn-punctuation">${escapeHtml(ch)}</span>`;
                i++;
                continue;
            }

            html += escapeHtml(ch);
            i++;
        }

        return html + commentHtml;
    });

    return highlightedLines.join("\n");
}

/**
 * Custom Script Editor component wrapping a textarea, syntax highlighter layer, and line number gutter.
 */
export class ScriptEditor {
    /**
     * @param {HTMLElement} containerEl
     * @param {Object} options
     */
    constructor(containerEl, options = {}) {
        this.container = containerEl;
        this.options = options;
        this.errorLine = null;

        this._buildDom();
        this._bindEvents();
    }

    _buildDom() {
        this.container.innerHTML = `
            <div class="sim-editor-wrapper">
                <div class="sim-editor-gutter" id="editor-gutter">1</div>
                <div class="sim-editor-code-container" id="editor-code-container">
                    <pre class="sim-editor-highlight" id="editor-highlight" aria-hidden="true"><code id="editor-code"></code></pre>
                    <textarea class="sim-editor-textarea" id="editor-textarea" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="# Enter .sim script code..."></textarea>
                </div>
            </div>
        `;

        this.gutterEl = this.container.querySelector("#editor-gutter");
        this.codeContainerEl = this.container.querySelector("#editor-code-container");
        this.highlightEl = this.container.querySelector("#editor-highlight");
        this.codeEl = this.container.querySelector("#editor-code");
        this.textareaEl = this.container.querySelector("#editor-textarea");

        if (this.options.initialValue) {
            this.textareaEl.value = this.options.initialValue;
        }
        this.update();
    }

    _bindEvents() {
        // Input event
        this.textareaEl.addEventListener("input", () => {
            this.errorLine = null;
            this.update();
        });

        // Scroll sync (both vertical and horizontal)
        this.textareaEl.addEventListener("scroll", () => {
            this.highlightEl.scrollTop = this.textareaEl.scrollTop;
            this.highlightEl.scrollLeft = this.textareaEl.scrollLeft;
            this.gutterEl.scrollTop = this.textareaEl.scrollTop;
        });

        // Keyboard navigation (Tab, Enter auto-indent)
        this.textareaEl.addEventListener("keydown", (e) => {
            if (e.key === "Tab") {
                e.preventDefault();
                const start = this.textareaEl.selectionStart;
                const end = this.textareaEl.selectionEnd;
                const val = this.textareaEl.value;

                if (!e.shiftKey) {
                    // Insert 4 spaces
                    this.textareaEl.value = val.substring(0, start) + "    " + val.substring(end);
                    this.textareaEl.selectionStart = this.textareaEl.selectionEnd = start + 4;
                } else {
                    // Outdent 4 spaces if line starts with spaces
                    const lineStart = val.lastIndexOf("\n", start - 1) + 1;
                    if (val.substring(lineStart, lineStart + 4) === "    ") {
                        this.textareaEl.value = val.substring(0, lineStart) + val.substring(lineStart + 4);
                        this.textareaEl.selectionStart = this.textareaEl.selectionEnd = Math.max(lineStart, start - 4);
                    }
                }
                this.update();
            } else if (e.key === "Enter") {
                const start = this.textareaEl.selectionStart;
                const val = this.textareaEl.value;
                const lineStart = val.lastIndexOf("\n", start - 1) + 1;
                const currentLine = val.substring(lineStart, start);

                // Calculate leading indentation
                const indentMatch = currentLine.match(/^(\s*)/);
                let indent = indentMatch ? indentMatch[1] : "";

                if (currentLine.trim().endsWith("{")) {
                    indent += "    ";
                }

                if (indent.length > 0) {
                    e.preventDefault();
                    this.textareaEl.value = val.substring(0, start) + "\n" + indent + val.substring(start);
                    this.textareaEl.selectionStart = this.textareaEl.selectionEnd = start + 1 + indent.length;
                    this.update();
                }
            }
        });
    }

    /**
     * Get current text value.
     */
    getValue() {
        return this.textareaEl.value;
    }

    /**
     * Set text value.
     * @param {string} val
     */
    setValue(val) {
        this.textareaEl.value = val || "";
        this.errorLine = null;
        this.update();
    }

    /**
     * Set error line for highlighting.
     * @param {number|null} lineNum - 1-based line index
     */
    setErrorLine(lineNum) {
        this.errorLine = lineNum;
        this.update();
    }

    /**
     * Update syntax highlighting and gutter line numbers.
     */
    update() {
        const val = this.textareaEl.value;
        const lines = val.split("\n");
        const lineCount = lines.length;

        // Build gutter numbers HTML
        let gutterHtml = "";
        for (let i = 1; i <= lineCount; i++) {
            const isErr = (this.errorLine === i);
            const errClass = isErr ? " err-line" : "";
            gutterHtml += `<div class="gutter-num${errClass}">${i}</div>`;
        }
        this.gutterEl.innerHTML = gutterHtml;

        // Highlight code text
        // Ensure trailing newline renders correctly in <pre>
        const textToHighlight = val.endsWith("\n") ? val + " " : val;
        this.codeEl.innerHTML = highlightSimScript(textToHighlight);
    }
}
