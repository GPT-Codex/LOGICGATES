import assert from "assert";
import fs from "fs";
import path from "path";
import { highlightSimScript } from "../frontend/js/ui/script_editor.js";
import { renderMarkdown } from "../frontend/js/ui/markdown_renderer.js";

function runEditorDocsTests() {
    console.log("Running Script Editor & Documentation unit tests...");

    // ==========================================
    // 1. Syntax Highlighting Tokenizer Tests
    // ==========================================
    console.log("  1. Testing Syntax Highlighting Tokenizer...");

    const sampleScript = `
        # Full adder
        for i in 0..15 {
            add input A[i]
            move A[i] to (0, i * 40)
        }
        expr S = A[0] XOR B[0]
    `;

    const html = highlightSimScript(sampleScript);
    assert(html.includes('<span class="syn-comment"># Full adder</span>'), "Comments should be highlighted");
    assert(html.includes('<span class="syn-command"') && html.includes('>for</span>'), "'for' keyword should be highlighted as command");
    assert(html.includes('<span class="syn-command"') && html.includes('>in</span>'), "'in' keyword should be highlighted as command");
    assert(html.includes('<span class="syn-number">0..15</span>'), "Range should be highlighted as number");
    assert(html.includes('<span class="syn-type">input</span>'), "'input' should be highlighted as component type");
    assert(html.includes('<span class="syn-identifier">A</span>'), "'A' should be highlighted as identifier");
    assert(html.includes('<span class="syn-punctuation">=</span>'), "'=' should be highlighted");
    assert(html.includes('XOR</span>'), "'XOR' should be highlighted");

    // ==========================================
    // 2. Client-side Markdown Renderer Tests
    // ==========================================
    console.log("  2. Testing Markdown Renderer...");

    const markdownSample = `
# Title Header
## Section Header
- Item 1
- Item 2

\`\`\`text
for i in 0..3 {
    add and G[i]
}
\`\`\`
    `;

    const rendered = renderMarkdown(markdownSample);
    assert(rendered.includes('<h1 class="doc-h1">Title Header</h1>'), "H1 should be rendered");
    assert(rendered.includes('<h2 class="doc-h2">Section Header</h2>'), "H2 should be rendered");
    assert(rendered.includes('<ul class="doc-list"><li>Item 1</li><li>Item 2</li></ul>'), "Lists should be rendered");
    assert(rendered.includes('<pre class="doc-code-block"><code>for i in 0..3 {'), "Code block should be rendered");

    // ==========================================
    // 3. Documentation File Validation
    // ==========================================
    console.log("  3. Testing Canonical Documentation File...");

    const docsPath = path.resolve("docs/scripting.md");
    assert(fs.existsSync(docsPath), "docs/scripting.md must exist");

    const docsContent = fs.readFileSync(docsPath, "utf-8");
    assert(docsContent.includes("# Scripting Language Reference"), "Docs must have title");
    assert(docsContent.includes("Half Adder"), "Docs must include Half Adder example");
    assert(docsContent.includes("Full Adder"), "Docs must include Full Adder example");
    assert(docsContent.includes("4-Bit Ripple-Carry Adder"), "Docs must include 4-Bit Adder example");
    assert(docsContent.includes("8-Bit Ripple-Carry Adder"), "Docs must include 8-Bit Adder example");
    assert(docsContent.includes("Vector Bus Example"), "Docs must include Vector Bus example");

    console.log("Script Editor & Documentation unit tests passed successfully!");
}

runEditorDocsTests();
