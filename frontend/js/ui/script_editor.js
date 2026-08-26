import { getCompletions, fetchServerLibraries } from "./autocomplete.js";

/**
 * .sim Script Editor — presentation layer only.
 *
 * Drop-in replacement for js/ui/script_editor.js.
 * Public API is unchanged:
 *   - export function highlightSimScript(text) -> html string
 *   - export class ScriptEditor { getValue, setValue, setErrorLine, update }
 *
 * Additions (all optional, purely presentational):
 *   - setDiagnostics([{ line, severity: "error"|"warning", message }])
 *   - clearDiagnostics()
 *   - focus(), goToLine(n), setReadOnly(bool)
 *   - options: { initialValue, onRun, onChange, height, label, toolbar: false }
 *
 * This file NEVER parses or executes .sim scripts. It only tokenizes for
 * colouring and renders whatever diagnostics the app hands it.
 */

/* ------------------------------------------------------------------ *
 * Grammar tables (same vocabulary as before)
 * ------------------------------------------------------------------ */

const COMMANDS = new Set([
  "add", "remove", "move", "connect", "disconnect", "set", "get", "list",
  "show", "trace", "expand", "detach", "undo", "redo", "expr", "bus", "net",
  "for", "in", "module", "const", "import", "as"
]);

const COMP_TYPES = new Set([
  "input", "output", "clock", "and", "or", "xor", "not", "nand", "nor",
  "xnor", "buffer", "button", "npn", "pnp", "led", "dff", "register", "counter",
]);

/** Multi-word component types, matched before single words. */
const MULTIWORD_TYPES = [
  "7-segment display",
  "10-segment display",
  "constant high",
  "constant low",
];

const LOGIC_OPS = new Set(["and", "or", "xor", "not", "nand", "nor", "xnor"]);

const BOOLEANS = new Set(["true", "false", "high", "low", "on", "off"]);

const UNITS = new Set([
  "hz", "khz", "mhz", "ghz", "ms", "us", "ns", "s", "px", "v", "mv",
]);

const colors = {
    yellow: "rgb(211, 211, 157)",
    green: "rgb(69, 194, 167)",
    purple: "rgb(188, 123, 184)",
    deepBlue: "rgb(70, 130, 184)",
    blue: "rgb(63, 164, 225)",
    red: "rgb(203, 94, 94)"
}

const custom_colours = {
    "add": colors.yellow,
    "remove": colors.yellow,
    "move": colors.yellow,
    "connect": colors.purple,
    "disconnect": colors.purple,
    "set": colors.yellow,
    "get": colors.yellow,
    "list": colors.yellow,
    "show": colors.yellow,
    "trace": colors.yellow,
    "expand": colors.yellow,
    "detach": colors.yellow,
    "undo": colors.yellow,
    "redo": colors.yellow,
    "expr": colors.purple,
    "bus": colors.yellow,
    "net": colors.yellow,
    "for": colors.purple,
    "in": colors.purple,
    "module": colors.green,
    "const": colors.deepBlue,
    "import": colors.purple,
    "as": colors.purple
};

/* ------------------------------------------------------------------ *
 * Highlighter — pure: string in, escaped HTML out
 * ------------------------------------------------------------------ */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function span(cls, text, style=null) {
    if (style) return `<span class="${cls}" style="${style}">${escapeHtml(text)}</span>`;
    return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

function matchMultiword(text, i) {
  const rest = text.substring(i).toLowerCase();
  for (const type of MULTIWORD_TYPES) {
    if (rest.startsWith(type)) {
      const after = rest[type.length];
      if (after === undefined || /[\s,;)\]}]/.test(after)) {
        return text.substr(i, type.length);
      }
    }
  }
  return null;
}

function highlightLine(line) {
  let commentHtml = "";
  let codePart = line;

  // Comments: `#` outside of a quoted string.
  let inStr = null;
  let commentIdx = -1;
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (inStr) {
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'") {
      inStr = c;
    } else if (c === "#") {
      commentIdx = k;
      break;
    }
  }
  if (commentIdx !== -1) {
    codePart = line.substring(0, commentIdx);
    commentHtml = span("syn-comment", line.substring(commentIdx));
  }

  let html = "";
  let i = 0;

  while (i < codePart.length) {
    const ch = codePart[i];

    // Whitespace
    if (/\s/.test(ch)) {
      html += escapeHtml(ch);
      i++;
      continue;
    }

    // Strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < codePart.length && codePart[j] !== quote) j++;
      const raw = codePart.substring(i, Math.min(j + 1, codePart.length));
      html += span("syn-string", raw, "color: rgb(199, 133, 108);");
      i = j + 1;
      continue;
    }

    // Arrow operators -> / =>
    if ((ch === "-" || ch === "=") && codePart[i + 1] === ">") {
      html += span("syn-operator", ch + ">");
      i += 2;
      continue;
    }

    // Assignment / comparison
    if (ch === "=" || ch === "<" || ch === ">" || ch === "!") {
      let op = ch;
      if (codePart[i + 1] === "=") op += "=";
      html += span("syn-punctuation", op);
      i += op.length;
      continue;
    }

    // Multi-word component types (7-segment display, constant high, ...)
    const mw = matchMultiword(codePart, i);
    if (mw) {
      html += span("syn-type", mw);
      i += mw.length;
      continue;
    }

    // Numbers, ranges, coordinates, frequencies
    if (/\d/.test(ch) || (ch === "-" && /\d/.test(codePart[i + 1] || ""))) {
      let numStr = ch;
      i++;
      while (i < codePart.length && /[\d.]/.test(codePart[i])) {
        numStr += codePart[i];
        i++;
      }
      html += span("syn-number", numStr);

      // Trailing unit (MHz, ms, px...) rendered as its own token.
      if (i < codePart.length && /[a-zA-Z]/.test(codePart[i])) {
        const uStart = i;
        while (i < codePart.length && /[a-zA-Z]/.test(codePart[i])) i++;
        const unit = codePart.substring(uStart, i);
        html += span(UNITS.has(unit.toLowerCase()) ? "syn-unit" : "syn-identifier", unit);
      }
      continue;
    }

    // Words: commands, types, logic ops, booleans, identifiers
    if (/[a-zA-Z_]/.test(ch)) {
      const wStart = i;
      while (i < codePart.length && /[a-zA-Z0-9_]/.test(codePart[i])) i++;
      const word = codePart.substring(wStart, i);
      const lower = word;

      if (COMMANDS.has(lower)) {
        if (lower in custom_colours) html += span("syn-command", word, `color: ${custom_colours[lower]};`);
        else html += span("syn-command", word);
      }
      else if (COMP_TYPES.has(lower) && !LOGIC_OPS.has(lower)) html += span("syn-type", word);
      else if (LOGIC_OPS.has(lower)) html += span("syn-operator", word, `color: ${colors.blue};`);
      else if (BOOLEANS.has(lower)) html += span("syn-boolean", word);
      else html += span("syn-identifier", word);
      continue;
    }

    // Bracketed index / member access / punctuation
    if (["{", "}", "(", ")", "[", "]", ".", ",", ":", ";"].includes(ch)) {
      const cls = ["[", "]", ".", ":", ";"].includes(ch) ? "syn-punctuation" : "syn-paranthesis";
      html += span(cls, ch);
      i++;
      continue;
    }

    html += escapeHtml(ch);
    i++;
  }

  return html + commentHtml;
}

/**
 * Highlight a chunk of .sim script text into HTML.
 * @param {string} text
 * @returns {string}
 */
export function highlightSimScript(text) {
  if (typeof text !== "string") return "";
  return text.split("\n").map(highlightLine).join("\n");
}

/* ------------------------------------------------------------------ *
 * Editor component
 * ------------------------------------------------------------------ */

const SVG_ERROR =
  '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><rect x="7.1" y="4" width="1.8" height="5" rx="0.9" fill="#141414"/><rect x="7.1" y="10.2" width="1.8" height="1.8" rx="0.9" fill="#141414"/></svg>';

const SVG_WARN =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 1.5 15 14H1z" fill="currentColor"/><rect x="7.2" y="6" width="1.6" height="4.2" rx="0.8" fill="#141414"/><rect x="7.2" y="11" width="1.6" height="1.6" rx="0.8" fill="#141414"/></svg>';

let editorUid = 0;

/**
 * Custom script editor: textarea + highlight layer + gutter + toolbar.
 */
export class ScriptEditor {
  /**
   * @param {HTMLElement} containerEl
   * @param {Object} [options]
   */
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.options = options;
    this.uid = ++editorUid;
    this.errorLine = null;
    this.diagnostics = [];
    this.activeLine = 1;
    this.wrap = false;

    this.selectedIndex = 0;
    this.completions = [];
    this.activePrefix = "";

    this._buildDom();
    this._bindEvents();
    this.update();
    fetchServerLibraries();
  }

  /* --------------------------- DOM --------------------------- */

  _buildDom() {
    const showToolbar = this.options.toolbar !== false;
    const label = this.options.label || "script.sim";
    const height = this.options.height || null;

    this.container.classList.add("sim-editor-host");
    this.container.innerHTML = `
      <div class="sim-editor" data-editor-uid="${this.uid}">
        ${
          showToolbar
            ? `
        <div class="sim-editor-toolbar">
          <span class="sim-editor-file">
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M9.5 1H4a1.5 1.5 0 0 0-1.5 1.5v11A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5V5z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9.3 1.2v4h4.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>
            <span data-role="label">${escapeHtml(label)}</span>
          </span>
          <div class="sim-editor-actions">
            <button type="button" class="sim-editor-btn is-accent" data-act="run" title="Run script (Ctrl+Enter)">Run</button>
            <button type="button" class="sim-editor-btn" data-act="copy" title="Copy all">Copy</button>
            <button type="button" class="sim-editor-btn" data-act="wrap" title="Toggle soft wrap" aria-pressed="false">Wrap</button>
            <button type="button" class="sim-editor-btn is-quiet" data-act="clear" title="Clear editor">Clear</button>
            <span class="sim-editor-sep"></span>
            <span class="sim-editor-stat" data-role="diagstat"></span>
            <span class="sim-editor-stat" data-role="caret">Ln 1, Col 1</span>
            <span class="sim-editor-hint-wrap">
              <button type="button" class="sim-editor-btn is-quiet" data-act="hints" title="Keyboard shortcuts">?</button>
              <div class="sim-editor-hints" data-role="hints" hidden>
                <div class="hint-row"><span>Indent / Outdent</span><kbd>Tab</kbd><kbd>Shift+Tab</kbd></div>
                <div class="hint-row"><span>Run script</span><kbd>Ctrl+Enter</kbd></div>
                <div class="hint-row"><span>Comment line</span><kbd>Ctrl+/</kbd></div>
                <div class="hint-row"><span>Auto-indent</span><kbd>Enter</kbd></div>
              </div>
            </span>
          </div>
        </div>`
            : ""
        }
        <div class="sim-editor-wrapper"${height ? ` style="height:${escapeHtml(String(height))}"` : ""}>
          <div class="sim-editor-gutter" data-role="gutter"><div class="gutter-num is-active">1</div></div>
          <div class="sim-editor-code-container" data-role="code-container">
            <div class="sim-editor-lines" data-role="lines" aria-hidden="true"></div>
            <pre class="sim-editor-highlight" data-role="highlight" aria-hidden="true"><code data-role="code"></code></pre>
            <textarea class="sim-editor-textarea" data-role="textarea" spellcheck="false" autocomplete="off"
              autocapitalize="off" autocorrect="off" wrap="off"
              placeholder="# Enter .sim script code…&#10;add and G1&#10;connect A -> G1.in0"></textarea>
            <div class="sim-autocomplete-popup" data-role="popup" hidden></div>
          </div>
        </div>
      </div>
    `;

    const q = (role) => this.container.querySelector(`[data-role="${role}"]`);
    this.rootEl = this.container.querySelector(".sim-editor");
    this.gutterEl = q("gutter");
    this.codeContainerEl = q("code-container");
    this.linesEl = q("lines");
    this.highlightEl = q("highlight");
    this.codeEl = q("code");
    this.textareaEl = q("textarea");
    this.caretStatEl = q("caret");
    this.diagStatEl = q("diagstat");
    this.hintsEl = q("hints");
    this.popupEl = q("popup");

    // Legacy ids kept so any existing querySelector("#editor-textarea") still works.
    if (!document.getElementById("editor-textarea")) {
      this.textareaEl.id = "editor-textarea";
      this.gutterEl.id = "editor-gutter";
      this.highlightEl.id = "editor-highlight";
      this.codeEl.id = "editor-code";
      this.codeContainerEl.id = "editor-code-container";
    }

    if (this.options.initialValue) {
      this.textareaEl.value = this.options.initialValue;
    }
  }

  /* ------------------------- Events ------------------------- */

  _bindEvents() {
    const ta = this.textareaEl;

    ta.addEventListener("input", () => {
      this.errorLine = null;
      this.diagnostics = [];
      this.update();
      this._triggerAutocomplete();
      if (typeof this.options.onChange === "function") {
        this.options.onChange(ta.value);
      }
    });

    ta.addEventListener("scroll", () => this._syncScroll());
    ["click", "keyup", "select", "focus"].forEach((evt) =>
      ta.addEventListener(evt, () => this._refreshCaret()),
    );

    ta.addEventListener("keydown", (e) => this._onKeyDown(e));

    if (this.rootEl) {
      this.rootEl.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-act]");
        if (!btn) return;
        e.preventDefault();
        this._onAction(btn.dataset.act, btn);
      });
    }

    document.addEventListener("click", (e) => {
      if (this.hintsEl && !this.hintsEl.hidden && !e.target.closest(".sim-editor-hint-wrap")) {
        this.hintsEl.hidden = true;
      }
      if (this.popupEl && !this.popupEl.hidden && !e.target.closest(".sim-editor-host")) {
        this.dismissAutocomplete();
      }
    });

    if (this.popupEl) {
      this.popupEl.addEventListener("click", (e) => {
        const itemEl = e.target.closest(".sim-auto-item");
        if (itemEl && itemEl.dataset.idx) {
          const idx = parseInt(itemEl.dataset.idx, 10);
          if (this.completions[idx]) {
            this.acceptAutocomplete(this.completions[idx]);
          }
        }
      });
    }

    // Gutter click jumps to that line.
    this.gutterEl.addEventListener("click", (e) => {
      const num = e.target.closest(".gutter-num");
      if (num && num.dataset.line) this.goToLine(Number(num.dataset.line));
    });
  }

  _onAction(act, btn) {
    switch (act) {
      case "run":
        if (typeof this.options.onRun === "function") this.options.onRun(this.getValue());
        break;
      case "copy":
        this._copy(btn);
        break;
      case "wrap":
        this.wrap = !this.wrap;
        btn.setAttribute("aria-pressed", String(this.wrap));
        btn.classList.toggle("is-on", this.wrap);
        this.rootEl.classList.toggle("is-wrapped", this.wrap);
        this.textareaEl.setAttribute("wrap", this.wrap ? "soft" : "off");
        this.update();
        break;
      case "clear":
        this.setValue("");
        this.textareaEl.focus();
        break;
      case "hints":
        if (this.hintsEl) this.hintsEl.hidden = !this.hintsEl.hidden;
        break;
      default:
        break;
    }
  }

  _copy(btn) {
    const done = () => {
      if (!btn) return;
      const prev = btn.textContent;
      btn.textContent = "Copied";
      btn.classList.add("is-on");
      setTimeout(() => {
        btn.textContent = prev;
        btn.classList.remove("is-on");
      }, 1200);
    };
    const text = this.getValue();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => {});
    } else {
      this.textareaEl.select();
      try {
        document.execCommand("copy");
        done();
      } catch (_) {
        /* ignore */
      }
    }
  }

  _onKeyDown(e) {
    const ta = this.textareaEl;
    const val = ta.value;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    // Manual autocomplete trigger
    if ((e.ctrlKey || e.metaKey) && e.key === " ") {
      e.preventDefault();
      this._triggerAutocomplete(true);
      return;
    }

    // Popup Navigation
    if (this.popupEl && !this.popupEl.hidden && this.completions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex + 1) % this.completions.length;
        this._renderPopupList();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex - 1 + this.completions.length) % this.completions.length;
        this._renderPopupList();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (this.completions[this.selectedIndex]) {
          this.acceptAutocomplete(this.completions[this.selectedIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        this.dismissAutocomplete();
        return;
      }
    }

    // Run
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (typeof this.options.onRunScript === "function") this.options.onRunScript(this.getValue());
      return;
    }

    // Toggle line comment
    if ((e.ctrlKey || e.metaKey) && (e.key === "/" || e.code === "Slash")) {
      e.preventDefault();
      const lineStart = val.lastIndexOf("\n", start - 1) + 1;
      let lineEnd = val.indexOf("\n", start);
      if (lineEnd === -1) lineEnd = val.length;
      const line = val.substring(lineStart, lineEnd);
      const commented = /^(\s*)#\s?/.exec(line);
      let next;
      let delta;
      if (commented) {
        next = line.replace(/^(\s*)#\s?/, "$1");
        delta = next.length - line.length;
      } else {
        next = line.replace(/^(\s*)/, "$1# ");
        delta = 2;
      }
      ta.value = val.substring(0, lineStart) + next + val.substring(lineEnd);
      ta.selectionStart = ta.selectionEnd = Math.max(lineStart, start + delta);
      this.update();
      return;
    }

    // Indent / outdent
    if (e.key === "Tab") {
      e.preventDefault();
      const multiline = val.substring(start, end).includes("\n");

      if (multiline) {
        const blockStart = val.lastIndexOf("\n", start - 1) + 1;
        let blockEnd = val.indexOf("\n", end);
        if (blockEnd === -1) blockEnd = val.length;
        const block = val.substring(blockStart, blockEnd);
        const shifted = block
          .split("\n")
          .map((l) =>
            e.shiftKey ? l.replace(/^ {1,4}/, "") : l.length ? "    " + l : l,
          )
          .join("\n");
        ta.value = val.substring(0, blockStart) + shifted + val.substring(blockEnd);
        ta.selectionStart = blockStart;
        ta.selectionEnd = blockStart + shifted.length;
      } else if (!e.shiftKey) {
        ta.value = val.substring(0, start) + "    " + val.substring(end);
        ta.selectionStart = ta.selectionEnd = start + 4;
      } else {
        const lineStart = val.lastIndexOf("\n", start - 1) + 1;
        const removed = /^ {1,4}/.exec(val.substring(lineStart));
        if (removed) {
          const n = removed[0].length;
          ta.value = val.substring(0, lineStart) + val.substring(lineStart + n);
          ta.selectionStart = ta.selectionEnd = Math.max(lineStart, start - n);
        }
      }
      this.update();
      return;
    }

    // Auto-indent on Enter
    if (e.key === "Enter") {
      const lineStart = val.lastIndexOf("\n", start - 1) + 1;
      const currentLine = val.substring(lineStart, start);
      const indentMatch = currentLine.match(/^(\s*)/);
      let indent = indentMatch ? indentMatch[1] : "";
      if (currentLine.trim().endsWith("{")) indent += "    ";

      if (indent.length > 0) {
        e.preventDefault();
        ta.value = val.substring(0, start) + "\n" + indent + val.substring(end);
        ta.selectionStart = ta.selectionEnd = start + 1 + indent.length;
        this.update();
      }
    }
  }

  /* ------------------------- Rendering ------------------------- */

  _syncScroll() {
    const top = this.textareaEl.scrollTop;
    const left = this.textareaEl.scrollLeft;
    this.highlightEl.scrollTop = top;
    this.highlightEl.scrollLeft = left;
    this.gutterEl.scrollTop = top;
    if (this.linesEl) this.linesEl.style.transform = `translateY(${-top}px)`;
  }

  _refreshCaret() {
    const ta = this.textareaEl;
    const upto = ta.value.substring(0, ta.selectionStart);
    const line = upto.split("\n").length;
    const col = upto.length - upto.lastIndexOf("\n");
    if (this.caretStatEl) this.caretStatEl.textContent = `Ln ${line}, Col ${col}`;
    if (line !== this.activeLine) {
      this.activeLine = line;
      this._renderGutter();
      this._renderLineBands();
    }
  }

  _diagFor(lineNo) {
    return this.diagnostics.find((d) => Number(d.line) === lineNo) || null;
  }

  _renderGutter() {
    const lines = this.textareaEl.value.split("\n");
    let html = "";
    for (let n = 1; n <= lines.length; n++) {
      const diag = this._diagFor(n);
      const isErr = this.errorLine === n || (diag && diag.severity !== "warning");
      const isWarn = !isErr && diag && diag.severity === "warning";
      const cls = [
        "gutter-num",
        n === this.activeLine ? "is-active" : "",
        isErr ? "err-line" : "",
        isWarn ? "warn-line" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const marker = isErr
        ? `<i class="gutter-marker is-error">${SVG_ERROR}</i>`
        : isWarn
          ? `<i class="gutter-marker is-warning">${SVG_WARN}</i>`
          : "";
      const title = diag && diag.message ? ` title="${escapeHtml(diag.message)}"` : "";
      html += `<div class="${cls}" data-line="${n}"${title}>${marker}<span class="gutter-digit">${n}</span></div>`;
    }
    this.gutterEl.innerHTML = html;
  }

  _renderLineBands() {
    if (!this.linesEl) return;
    const count = this.textareaEl.value.split("\n").length;
    let html = "";
    for (let n = 1; n <= count; n++) {
      const diag = this._diagFor(n);
      const isErr = this.errorLine === n || (diag && diag.severity !== "warning");
      const isWarn = !isErr && diag && diag.severity === "warning";
      const cls = [
        "line-band",
        n === this.activeLine ? "is-active" : "",
        isErr ? "is-error" : "",
        isWarn ? "is-warning" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const title = diag && diag.message ? ` title="${escapeHtml(diag.message)}"` : "";
      html += `<div class="${cls}"${title}></div>`;
    }
    this.linesEl.innerHTML = html;
  }

  _triggerAutocomplete(isManual = false) {
    if (!this.popupEl) return;

    const ta = this.textareaEl;
    const offset = ta.selectionStart;
    const fullText = ta.value;

    const envContext = {
      circuit: this.options.circuit || null,
      registry: this.options.registry || null,
      fileImportAliases: this.options.fileImportAliases || null,
      serverLibraries: this.options.serverLibraries || null
    };

    const res = getCompletions(fullText, offset, envContext);
    const suggestions = res.suggestions || [];

    // Automatic trigger conditions: require at least 1 typed character or explicit manual call
    if (suggestions.length === 0 || (!isManual && !res.replacePrefix && res.contextType !== "import_path" && res.contextType !== "component_type")) {
      this.dismissAutocomplete();
      return;
    }

    this.completions = suggestions;
    this.activePrefix = res.replacePrefix || "";
    this.selectedIndex = 0;

    this._renderPopupList();
    this._positionPopup();
  }

  _positionPopup() {
    if (!this.popupEl) return;
    const ta = this.textareaEl;
    const upto = ta.value.substring(0, ta.selectionStart);
    const lines = upto.split("\n");
    const lineNo = lines.length;
    const colNo = lines[lines.length - 1].length;

    const lh = this._lineHeight();
    const top = (lineNo - 1) * lh - ta.scrollTop + 24;
    const left = Math.min(colNo * 7.5 + 40 - ta.scrollLeft, this.container.clientWidth - 260);

    this.popupEl.style.top = `${Math.max(20, top)}px`;
    this.popupEl.style.left = `${Math.max(40, left)}px`;
    this.popupEl.hidden = false;
  }

  _renderPopupList() {
    if (!this.popupEl) return;
    if (this.completions.length === 0) {
      this.popupEl.hidden = true;
      return;
    }

    let html = "";
    this.completions.slice(0, 10).forEach((item, idx) => {
      const isSel = idx === this.selectedIndex;
      const typeBadge = item.type ? `<span class="sim-auto-badge is-${item.type}">${item.type}</span>` : "";
      const detailStr = item.detail ? `<span class="sim-auto-detail">${escapeHtml(item.detail)}</span>` : "";
      const descStr = item.desc ? `<span class="sim-auto-desc">${escapeHtml(item.desc)}</span>` : "";

      html += `
        <div class="sim-auto-item ${isSel ? "is-selected" : ""}" data-idx="${idx}">
          <div class="sim-auto-main">
            <span class="sim-auto-name">${escapeHtml(item.name)}</span>
            ${detailStr}
            ${typeBadge}
          </div>
          ${descStr ? `<div class="sim-auto-sub">${descStr}</div>` : ""}
        </div>
      `;
    });

    this.popupEl.innerHTML = html;
    this.popupEl.hidden = false;

    // Scroll selected item into view inside popup container
    const selectedEl = this.popupEl.querySelector(".sim-auto-item.is-selected");
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }

  acceptAutocomplete(item) {
    if (!item) return;

    const ta = this.textareaEl;
    const val = ta.value;
    const start = ta.selectionStart;

    // Replace typed prefix with selected item name
    const prefixLen = this.activePrefix ? this.activePrefix.length : 0;
    const insertVal = item.name;

    const before = val.substring(0, start - prefixLen);
    const after = val.substring(start);

    ta.value = before + insertVal + after;
    const newPos = before.length + insertVal.length;
    ta.selectionStart = ta.selectionEnd = newPos;

    this.dismissAutocomplete();
    this.update();
    ta.focus();

    if (typeof this.options.onChange === "function") {
      this.options.onChange(ta.value);
    }
  }

  dismissAutocomplete() {
    this.completions = [];
    this.selectedIndex = 0;
    this.activePrefix = "";
    if (this.popupEl) {
      this.popupEl.hidden = true;
      this.popupEl.innerHTML = "";
    }
  }

  _renderDiagStat() {
    if (!this.diagStatEl) return;
    const errors = this.diagnostics.filter((d) => d.severity !== "warning").length +
      (this.errorLine && !this._diagFor(this.errorLine) ? 1 : 0);
    const warnings = this.diagnostics.filter((d) => d.severity === "warning").length;
    const lineCount = this.textareaEl.value.split("\n").length;

    if (!errors && !warnings) {
      this.diagStatEl.className = "sim-editor-stat is-ok";
      this.diagStatEl.textContent = `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
      return;
    }
    const parts = [];
    if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
    if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
    this.diagStatEl.className = `sim-editor-stat ${errors ? "is-error" : "is-warning"}`;
    this.diagStatEl.textContent = parts.join(" · ");
  }

  /* --------------------------- API --------------------------- */

  getValue() {
    return this.textareaEl.value;
  }

  setValue(val) {
    this.textareaEl.value = val || "";
    this.errorLine = null;
    this.diagnostics = [];
    this.update();
  }

  /**
   * @param {number|null} lineNum 1-based
   */
  setErrorLine(lineNum) {
    this.errorLine = lineNum || null;
    this.update();
    if (lineNum) this.goToLine(lineNum, { select: false });
  }

  /**
   * @param {Array<{line:number, severity?:"error"|"warning", message?:string}>} list
   */
  setDiagnostics(list) {
    this.diagnostics = Array.isArray(list) ? list.filter((d) => d && d.line) : [];
    this.update();
  }

  clearDiagnostics() {
    this.diagnostics = [];
    this.errorLine = null;
    this.update();
  }

  setReadOnly(flag) {
    this.textareaEl.readOnly = !!flag;
    this.rootEl.classList.toggle("is-readonly", !!flag);
  }

  setLabel(text) {
    const el = this.container.querySelector('[data-role="label"]');
    if (el) el.textContent = text;
  }

  focus() {
    this.textareaEl.focus();
  }

  /**
   * Scroll to a 1-based line and place the caret there.
   */
  goToLine(lineNum, { select = true } = {}) {
    const lines = this.textareaEl.value.split("\n");
    const n = Math.max(1, Math.min(lineNum, lines.length));
    let pos = 0;
    for (let i = 0; i < n - 1; i++) pos += lines[i].length + 1;

    this.textareaEl.focus();
    this.textareaEl.selectionStart = pos;
    this.textareaEl.selectionEnd = select ? pos + lines[n - 1].length : pos;

    const lh = this._lineHeight();
    const target = (n - 1) * lh;
    const view = this.textareaEl.clientHeight;
    if (target < this.textareaEl.scrollTop || target > this.textareaEl.scrollTop + view - lh) {
      this.textareaEl.scrollTop = Math.max(0, target - view / 2 + lh);
    }
    this._syncScroll();
    this._refreshCaret();
  }

  _lineHeight() {
    const lh = parseFloat(getComputedStyle(this.textareaEl).lineHeight);
    return Number.isFinite(lh) && lh > 0 ? lh : 20;
  }

  /**
   * Re-render highlighting, gutter, bands and status.
   */
  update() {
    const val = this.textareaEl.value;

    // Trailing newline must render as a real row inside <pre>.
    const textToHighlight = val.endsWith("\n") ? val + " " : val;
    this.codeEl.innerHTML = highlightSimScript(textToHighlight);

    this._renderGutter();
    this._renderLineBands();
    this._renderDiagStat();
    this._refreshCaret();
    this._syncScroll();
  }
}
