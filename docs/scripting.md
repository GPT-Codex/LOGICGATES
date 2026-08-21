# Scripting Language Reference (`.sim`)

The `.sim` circuit scripting language allows you to create, modify, connect, and analyze digital logic circuits programmatically using clean text commands. Scripts operate directly on the single source-of-truth circuit graph used by the visual editor and execute atomically within single undoable transactions.

---

## 1. Command Overview

| Command | Syntax | Description |
| :--- | :--- | :--- |
| `add` | `add TYPE NAME` / `add TYPE(ARGS) NAME` | Add a gate, component, or custom module instance named `NAME`. |
| `remove` | `remove NAME` | Delete component `NAME` and automatically detach connected wires. |
| `move` | `move NAME to (X,Y)` / `move NAME by (DX,DY)` | Position or translate component `NAME` on the 20px grid. |
| `connect` | `connect FROM TO` / `connect FROM -> TO` | Connect output pin `FROM` to input pin `TO`. |
| `set` | `set NAME.PROPERTY VALUE` | Modify component properties (`label`, `freq`, `buttonMode`, `holdDuration`, `ledColor`, `rgbaValue`, `rotation`, `flipX`, `flipY`). |
| `list` | `list` | List all components, buses, and wires in the active circuit graph. |
| `show` | `show NAME` / `show module NAME` / `show library "PATH"` | Display detailed inspection metadata for a component, bus, module, or library file. |
| `trace` | `trace PIN_REF` | Trace logical signal propagation path through subcircuit and module boundaries. |
| `expand` | `expand NAME` | Inspect the internal component hierarchy tree (`├──`, `└──`) of a module definition or instance. |
| `detach` | `detach INSTANCE` | Detach/expand a module instance into individual gates directly on the circuit canvas. |
| `undo` / `redo` | `undo` / `redo` | Revert or re-apply the previous circuit mutation transaction. |
| `net` | `net NAME` | Create a net signal node (buffer pass-through element). |
| `bus` | `bus NAME[START..END]` | Declare a first-class $N$-bit bus vector. |
| `const` | `const NAME = EXPR` | Declare an immutable compile-time integer constant. |
| `import` | `import "PATH"` / `import "./PATH"` | Import reusable constants and module definitions from a script file. |
| `expr` | `expr OUTPUT = BOOLEAN_EXPRESSION` | Synthesize a boolean expression into gates and wires. |
| `for` | `for VAR in START..END { ... }` | Loop over an inclusive ascending or descending numerical range. |
| `module` | `module NAME { ... }` / `module NAME(P1, P2) { ... }` | Define a reusable, compiled (or parameterized) subcircuit module. |

---

## 2. Reusable Script Libraries & Imports (`import`)

Import reusable constants and module definitions from external `.sim` files:

```sim
import "./lib/logic.sim"
```

### Import Semantics & Path Resolution
- **Definitions-Only Loading:** `import` loads constants and compiles `module` blocks into the application's module registry. Importing a library file **never** automatically places components onto the circuit canvas; component instantiation requires explicit `add` commands.
- **Relative Path Resolution:** Import paths starting with `./` or `../` or relative paths like `"lib/logic.sim"` are resolved relative to the directory containing the importing `.sim` file, not the browser's or system process's current working directory.
- **Project Root Security:** Relative paths are normalized (`/`, `./`, `../`, duplicate separators). Any path traversal attempt escaping the project boundary (e.g., `import "../outside.sim"` at top-level) is strictly detected and rejected.
- **Deduplication:** Importing the same file multiple times across different dependency branches (e.g., `import "./logic.sim"` in two different files) loads and compiles the library exactly once.
- **Circular Import Protection:** Circular import dependencies (e.g. `A.sim → B.sim → A.sim`) are detected and rejected before compilation without leaving partially registered definitions or modifying the circuit.
- **Name Conflict Prevention:** If two imported files define the same module or constant name, compilation aborts with a clear conflict error identifying the conflicting source files.
- **REPL & Script Execution Integration:** The same import resolver is shared across `.sim` script files, the Run Script editor, and top-level REPL terminal commands.

### Multi-File Project Example (`logic.sim`, `arithmetic.sim`, `main.sim`)

#### `lib/logic.sim`
```sim
# Logic primitives library
module FADDER {
    input A
    input B
    input Cin

    output S
    output Cout

    expr S = A XOR B XOR Cin
    expr Cout = (A AND B) OR (Cin AND (A XOR B))
}
```

#### `lib/arithmetic.sim`
```sim
# Arithmetic modules library
import "./logic.sim"

const MAX_WIDTH = 256

module RCA(width) {
    input A[0..width-1]
    input B[0..width-1]
    input Cin

    output S[0..width-1]
    output Cout

    add FADDER FA[0]
    connect A[0] -> FA[0].A
    connect B[0] -> FA[0].B
    connect Cin -> FA[0].Cin
    connect FA[0].S -> S[0]

    for i in 1..width-1 {
        add FADDER FA[i]
        connect A[i] -> FA[i].A
        connect B[i] -> FA[i].B
        connect FA[i - 1].Cout -> FA[i].Cin
        connect FA[i].S -> S[i]
    }

    connect FA[width - 1].Cout -> Cout
}
```

#### `main.sim`
```sim
# Main project script
import "./lib/arithmetic.sim"

const WORD_SIZE = 16

bus A[0..WORD_SIZE-1]
bus B[0..WORD_SIZE-1]

add input Cin
add RCA(WORD_SIZE) ADDER16
add output Cout

connect Cin -> ADDER16.Cin
connect ADDER16.Cout -> Cout

for i in 0..WORD_SIZE-1 {
    add input A[i]
    add input B[i]
    add output S[i]

    connect A[i] -> ADDER16.A[i]
    connect B[i] -> ADDER16.B[i]
    connect ADDER16.S[i] -> S[i]
}
```

---

## 3. Compile-Time Constants (`const`)

Declare immutable compile-time integer constants using `const NAME = EXPR`:

```sim
const WIDTH = 16
const LAST = WIDTH - 1
const HALF = WIDTH / 2
```

### Scope & Evaluation Rules
1. **Topological Evaluation:** Constants can reference other constants regardless of declaration order. Arithmetic expressions (`+`, `-`, `*`, `/`, `%`, `()`) are evaluated at compile time.
2. **Cycle Rejection:** Dependency cycles among constants (`const A = B + 1` and `const B = A + 1`) are rejected with an explicit error chain (`Constant dependency cycle: A -> B -> A`).
3. **Immutability:** Reassigning an existing constant throws a reassignment error.
4. **Usage:** Constants can be used in bus ranges (`bus A[0..LAST]`), loop bounds (`for i in 0..LAST`), coordinate math (`move A[i] to (0, i * 40)`), array indices, and module parameters (`add RCA(WIDTH) ADD16`).

---

## 4. Reusable Scripted Modules (`module`)

Define subcircuit modules using `module Name { ... }` or parameterized syntax `module Name(P1, P2) { ... }`:

```sim
module FullAdder {
    input A
    input B
    input Cin

    output S
    output Cout

    expr S = (A XOR B) XOR Cin
    expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
}
```

### Parameterized Modules
Modules accept integer parameters for width, size, and loop bounds:
```sim
module RCA(width) {
    input A[0..width-1]
    input B[0..width-1]
    input Cin

    output S[0..width-1]
    output Cout

    add FADDER FA[0]
    connect A[0] -> FA[0].A
    connect B[0] -> FA[0].B
    connect Cin -> FA[0].Cin
    connect FA[0].S -> S[0]

    for i in 1..width-1 {
        add FADDER FA[i]
        connect A[i] -> FA[i].A
        connect B[i] -> FA[i].B
        connect FA[i - 1].Cout -> FA[i].Cin
        connect FA[i].S -> S[i]
    }

    connect FA[width - 1].Cout -> Cout
}
```

Instantiate parameterized modules across imports using positional or named arguments:
- `add RCA(4) ADD4`
- `add RCA(8) ADD8`
- `add RCA(16) ADD16`
- `add RCA(width=32) ADD32`

Specialized module definitions are compiled and cached deterministically per unique parameter argument signature. Parameter values must be integers within valid safety bounds (`width <= 256`).

### Module Ports (`input` and `output`)
- External pins are declared with `input NAME` / `output NAME` or vector syntax `input A[0..7]`.
- Port names are exact and case-sensitive.

### Hierarchical Modules & Cycle Rejection
Modules can instantiate other custom modules with arbitrary nesting depth. Recursive module instantiation (`module A` adding `A`) and circular dependencies (`A → B → C → A`) are strictly detected and rejected during graph compilation.

### Module Instance Arrays & Hierarchical Pins
- Loop iteration supports instance arrays: `add FADDER FA[i]`.
- Hierarchical pin access uses dot notation: `FA[0].A`, `FA0.Cout`, `RIPPLE.FA0.Cout`.

---

## 5. First-Class Buses & Vector Operations

Declare bus vectors with `bus NAME[START..END]`:
```sim
bus A[0..15]
bus B[0..15]
```

Connect matching buses or vector ports pairwise:
```sim
connect A B
```
If widths differ (e.g. 16-bit to 8-bit), connection aborts with a descriptive width mismatch error: `Cannot connect A to B: source width = 16, destination width = 8`.

Explicit bus slices are also supported: `connect A[0..7] B[0..7]`.

---

## 6. Boolean Expression Synthesis (`expr`)

Synthesize boolean logic directly into gates and wires:
```sim
expr S = A XOR B XOR Cin
expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
```

### Implemented Operators & Precedence
1. Parentheses `()`
2. `NOT` (Unary)
3. `AND` / `NAND`
4. `XOR` / `XNOR`
5. `OR` / `NOR`

### Self-Reference Restriction
Outputs cannot reference themselves: `expr A = A XOR B` is rejected with `Cannot define 'A' because it is referenced by its own expression.`

---

## 7. Component Types & Property Customization

Supported built-in types:
- `input` (Input Switch)
- `output` (Output Indicator)
- `clock` (Pulse Clock Generator)
- `constant high` / `constant low`
- `button` (Push Button Switch)
- `and`, `nand`, `or`, `nor`, `xor`, `xnor`, `not`, `buffer`
- `npn`, `pnp` (Transistor Switches)
- `led`, `7-segment display`, `10-segment display`
- Custom Modules & Scripted Modules (e.g. `FullAdder`, `RCA`)

### Setting Component Properties (`set`)
```sim
set CLK.freq 10kHz
set BTN.buttonMode hold
set BTN.holdDuration 500ms
set LED1.ledColor Red
set G1.rotation 90
set G1.flipX true
set G1.flipY true
set G1.label "Data Input"
```

---

## 8. Geometry, Loops & Indexed Identifiers

Canvas coordinates use a 20px grid system. Explicitly positioned components (`move NAME to (X, Y)`) are marked as position-locked anchors and preserved during subsequent `expr` auto-layout.

Loops iterate over inclusive ranges (`0..7` or `7..0`):
```sim
for i in 0..7 {
    add input A[i]
    move A[i] to (0, i * 40)
}
```

Identifiers support multi-dimensional indexing: `A[0]`, `G[0][1]`, `FA[i].A`.

---

## 9. Transactions, Error Reporting & Save/Load Persistence

### Transactional Execution & Rollback
Script execution operates within a single transaction boundary. If an error occurs on any line or dependency import, all circuit modifications and registered definitions roll back cleanly to the initial state.

Error messages include line numbers, loop context, and import dependency chains:
```
Import error:
main.sim
  imports lib/arithmetic.sim
    imports ./missing.sim
      ERROR: file not found
```

### Project Save, Load & Export
Project files (`.json`) serialize all active components, wires, buses, custom module definitions, and project virtual files (`circuit.files`), ensuring projects reload self-contained with all imported dependency files intact. Circuits can also be exported to `.sim` format via the Export button.

---

## 10. Complete Working Examples

### 1. Half Adder
```sim
# Half Adder Script
add input A
move A to (0, 100)
set A.label A

add input B
move B to (0, 200)
set B.label B

add output Sum
move Sum to (600, 100)
set Sum.label Sum

add output Carry
move Carry to (600, 200)
set Carry.label Carry

expr Sum = A XOR B
expr Carry = A AND B
```

### 2. Full Adder
```sim
# Full Adder Script
add input A
move A to (0, 100)

add input B
move B to (0, 180)

add input Cin
move Cin to (0, 260)

add output Sum
move Sum to (600, 140)

add output Cout
move Cout to (600, 220)

expr Sum = (A XOR B) XOR Cin
expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
```

### 3. 4-Bit Ripple-Carry Adder
```sim
# 1. Define FullAdder module
module FullAdder {
    input A
    input B
    input Cin

    output S
    output Cout

    expr S = (A XOR B) XOR Cin
    expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
}

# 2. Build 4-Bit Adder using FullAdder instances
add input Cin
move Cin to (0, 0)

for i in 0..3 {
    add input A[i]
    move A[i] to (0, i * 100 + 80)

    add input B[i]
    move B[i] to (0, i * 100 + 120)

    add FullAdder FA[i]
    move FA[i] to (350, i * 100 + 100)

    add output S[i]
    move S[i] to (700, i * 100 + 100)

    connect A[i] FA[i].A
    connect B[i] FA[i].B
    connect FA[i].S S[i]
}

add output Cout
move Cout to (700, 480)

# Connect carry chain
connect Cin FA[0].Cin
for i in 1..3 {
    connect FA[i - 1].Cout FA[i].Cin
}
connect FA[3].Cout Cout
```

### 4. 8-Bit Ripple-Carry Adder
```sim
# 8-Bit Ripple-Carry Adder
bus A[0..7]
bus B[0..7]
bus SUM[0..7]

add input Cin
move Cin to (0, 0)

for i in 0..7 {
    add input A[i]
    move A[i] to (0, i * 60 + 80)
    add input B[i]
    move B[i] to (0, i * 60 + 110)
    add output SUM[i]
    move SUM[i] to (800, i * 60 + 95)
}

add output Cout
move Cout to (800, 580)

# Bit 0
expr SUM[0] = A[0] XOR B[0] XOR Cin
expr C[0] = (A[0] AND B[0]) OR (A[0] AND Cin) OR (B[0] AND Cin)

# Bits 1..7
for i in 1..7 {
    expr SUM[i] = A[i] XOR B[i] XOR C[i - 1]
    expr C[i] = (A[i] AND B[i]) OR (A[i] AND C[i - 1]) OR (B[i] AND C[i - 1])
}

connect C[7] Cout
```

### 5. Vector Bus Example
```sim
module Buffer8 {
    input A[0..7]
    output O[0..7]

    for i in 0..7 {
        expr O[i] = A[i]
    }
}

bus IN[0..7]
bus OUT[0..7]

add Buffer8 BUF0
move BUF0 to (300, 200)

connect IN BUF0.A
connect BUF0.O OUT
```
