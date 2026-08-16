/**
 * Simple client-side Markdown to HTML renderer.
 * Converts headers, bold, italics, inline code, code blocks, lists, and blockquotes.
 */
export function renderMarkdown(markdownText) {
    if (typeof markdownText !== "string") return "";

    const lines = markdownText.split("\n");
    let html = "";
    let inCodeBlock = false;
    let codeLanguage = "";
    let codeBuffer = [];
    let inList = false;

    function escapeHtml(str) {
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function processInline(text) {
        let escaped = escapeHtml(text);
        // Inline code
        escaped = escaped.replace(/`([^`]+)`/g, '<code class="doc-inline-code">$1</code>');
        // Bold
        escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // Italics
        escaped = escaped.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        return escaped;
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Code block toggle
        if (line.trim().startsWith("```")) {
            if (inCodeBlock) {
                // End code block
                html += `<pre class="doc-code-block"><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`;
                codeBuffer = [];
                inCodeBlock = false;
            } else {
                // Start code block
                if (inList) {
                    html += "</ul>";
                    inList = false;
                }
                inCodeBlock = true;
                codeLanguage = line.trim().substring(3).trim();
            }
            continue;
        }

        if (inCodeBlock) {
            codeBuffer.push(line);
            continue;
        }

        const trimmed = line.trim();

        if (!trimmed) {
            if (inList) {
                html += "</ul>";
                inList = false;
            }
            continue;
        }

        // Headers
        if (trimmed.startsWith("# ")) {
            if (inList) { html += "</ul>"; inList = false; }
            html += `<h1 class="doc-h1">${processInline(trimmed.substring(2))}</h1>`;
            continue;
        }
        if (trimmed.startsWith("## ")) {
            if (inList) { html += "</ul>"; inList = false; }
            html += `<h2 class="doc-h2">${processInline(trimmed.substring(3))}</h2>`;
            continue;
        }
        if (trimmed.startsWith("### ")) {
            if (inList) { html += "</ul>"; inList = false; }
            html += `<h3 class="doc-h3">${processInline(trimmed.substring(4))}</h3>`;
            continue;
        }

        // Unordered lists
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            if (!inList) {
                html += '<ul class="doc-list">';
                inList = true;
            }
            html += `<li>${processInline(trimmed.substring(2))}</li>`;
            continue;
        }

        if (inList) {
            html += "</ul>";
            inList = false;
        }

        // Blockquotes
        if (trimmed.startsWith("> ")) {
            html += `<blockquote class="doc-quote">${processInline(trimmed.substring(2))}</blockquote>`;
            continue;
        }

        // Paragraph
        html += `<p class="doc-p">${processInline(line)}</p>`;
    }

    if (inList) {
        html += "</ul>";
    }

    return html;
}
