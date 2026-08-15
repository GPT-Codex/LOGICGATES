/**
 * Tokenizer and AST Parser for boolean expressions.
 * Supported operators: NOT, AND, OR, XOR, NAND, NOR, XNOR, ()
 */

export function tokenize(str) {
    const tokens = [];
    let i = 0;

    while (i < str.length) {
        const ch = str[i];

        if (/\s/.test(ch)) {
            i++;
            continue;
        }

        if (ch === "(") {
            tokens.push({ type: "LPAREN", value: "(" });
            i++;
            continue;
        }

        if (ch === ")") {
            tokens.push({ type: "RPAREN", value: ")" });
            i++;
            continue;
        }

        if (/[a-zA-Z]/.test(ch)) {
            let start = i;
            while (i < str.length && /[a-zA-Z0-9_]/.test(str[i])) {
                i++;
            }
            const word = str.substring(start, i);
            const upper = word.toUpperCase();
            if (["NOT", "AND", "OR", "XOR", "NAND", "NOR", "XNOR"].includes(upper)) {
                tokens.push({ type: "OP", value: upper });
            } else {
                tokens.push({ type: "VAR", value: word });
            }
            continue;
        }

        throw new Error(`Unexpected character '${ch}' at position ${i + 1}`);
    }

    tokens.push({ type: "EOF", value: "" });
    return tokens;
}

export function parseBooleanExpression(exprStr) {
    if (!exprStr || !exprStr.trim()) {
        throw new Error("Empty expression");
    }

    const tokens = tokenize(exprStr);
    let current = 0;

    function peek() {
        return tokens[current];
    }

    function consume(expectedType, expectedValue) {
        const tok = peek();
        if (expectedType && tok.type !== expectedType) {
            throw new Error(`Expected '${expectedValue || expectedType}', got '${tok.value || tok.type}'`);
        }
        if (expectedValue && tok.value !== expectedValue) {
            throw new Error(`Expected '${expectedValue}', got '${tok.value}'`);
        }
        current++;
        return tok;
    }

    function parseExpression() {
        return parseOrNor();
    }

    function parseOrNor() {
        let left = parseXorXnor();
        while (peek().type === "OP" && ["OR", "NOR"].includes(peek().value)) {
            const op = consume().value;
            const right = parseXorXnor();
            left = { type: "Binary", op, left, right };
        }
        return left;
    }

    function parseXorXnor() {
        let left = parseAndNand();
        while (peek().type === "OP" && ["XOR", "XNOR"].includes(peek().value)) {
            const op = consume().value;
            const right = parseAndNand();
            left = { type: "Binary", op, left, right };
        }
        return left;
    }

    function parseAndNand() {
        let left = parseUnary();
        while (peek().type === "OP" && ["AND", "NAND"].includes(peek().value)) {
            const op = consume().value;
            const right = parseUnary();
            left = { type: "Binary", op, left, right };
        }
        return left;
    }

    function parseUnary() {
        if (peek().type === "OP" && peek().value === "NOT") {
            consume();
            const expr = parseUnary();
            return { type: "Unary", op: "NOT", expr };
        }
        return parsePrimary();
    }

    function parsePrimary() {
        const tok = peek();
        if (tok.type === "LPAREN") {
            consume("LPAREN");
            const expr = parseExpression();
            consume("RPAREN", ")");
            return expr;
        }
        if (tok.type === "VAR") {
            consume("VAR");
            return { type: "Variable", name: tok.value };
        }
        throw new Error(`Unexpected token '${tok.value || tok.type}'`);
    }

    const ast = parseExpression();
    if (peek().type !== "EOF") {
        throw new Error(`Unexpected token '${peek().value}' after valid expression`);
    }

    return ast;
}
