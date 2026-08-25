# Scripting Language Reference (`.sim`)

The `.sim` circuit scripting language allows you to create, modify, connect, and analyze digital logic circuits programmatically using clean text commands. Scripts operate directly on the single source-of-truth circuit graph used by the visual editor and execute atomically as single undoable transactions.

---

## 1. Commands

| Command | Syntax | Description |
| :--- | :--- | :--- |
| `add` | `add TYPE NAME` | Add a gate, module, or component of type `TYPE` named `NAME`. |
| `move` | `move NAME to (X,Y)` / `move NAME by (DX,DY)` | Position or translate component `NAME`. |
| `connect` | `connect FROM TO` / `connect FROM -> TO` | Connect output pin `FROM` to input pin `TO`. |
| `set` | `set NAME.PROP VALUE` | Modify component properties (`label`, `freq`, `buttonMode`, `rotation`, `flipX`, `flipY`, etc.). |
| `remove` | `remove NAME` | Delete component `NAME` and automatically detach connected wires. |
| `show` | `show NAME` / `show module NAME` | Display detailed inspection metadata for a component, bus, or module. |
| `trace` | `trace PIN_REF` | Trace logical signal propagation path through module boundaries. |
| `expand` | `expand NAME` | Inspect the internal component hierarchy tree (`├──`, `└──`) of a module. |
| `detach` | `detach INSTANCE` | Detach/expand a module instance into individual gates on the circuit. |
| `list` | `list` | List all components, buses, and wires in the active circuit. |
| `net` | `net NAME` | Create a net signal node (buffer pass-through). |
| `const` | `const NAME = EXPR` | Declare an immutable compile-time integer constant. |
| `import` | `import "module"` / `import "module" as alias` | Import reusable constants and module definitions with optional namespace aliases. |
| `bus` | `bus NAME[START..END]` | Declare a first-class $N$-bit bus vector. |
| `expr` | `expr OUTPUT = BOOLEAN_EXPRESSION` | Synthesize a boolean expression into gates and wires. |
| `for` | `for VAR in START..END { ... }` | Loop over an inclusive numerical range. |
| `module` | `module NAME { ... }` / `module NAME(P1, P2) { ... }` | Define a reusable, compiled (or parameterized) subcircuit module. |

---

## 2. Reusable Scripted Modules (`module`)

Define reusable circuit components using the `module` block:

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
Modules can accept compile-time integer parameters:
```sim
module RCA(width) {
    input A[0..width-1]
    input B[0..width-1]
    input Cin

    output S[0..width-1]
    output Cout

    add FADDER FA[0]
    connect A[0] FA[0].A
    connect B[0] FA[0].B
    connect Cin FA[0].Cin
    connect FA[0].S S[0]

    for i in 1..width-1 {
        add FADDER FA[i]
        connect A[i] FA[i].A
        connect B[i] FA[i].B
        connect FA[i - 1].Cout FA[i].Cin
        connect FA[i].S S[i]
    }

    connect FA[width - 1].Cout Cout
}
```

Instantiate parameterized modules using positional or named arguments:
- Positional: `add RCA(16) ADD16`
- Named: `add RCA(width=16) ADD16`
- Expression args: `add RCA(w * 2) ADD32`

Compile-time parameters are evaluated for port vector widths, range bounds, array indices, coordinate math, and nested parameter propagation (`add RCA(width=w) SUB`).
Parameter values must be integers, and parameters controlling widths/sizes must be positive non-zero integers bounded by safety limits (`width <= 256`). Specialized definitions are automatically compiled and cached per unique argument signature.

### Module Ports (`input` and `output`)
External module pins are declared using `input NAME` and `output NAME`:
- Port names are exact, case-sensitive, and unique.
- Vector ports can be declared with range syntax: `input A[0..3]` or `output S[0..3]`.

### Module Body
The module body uses the existing scripting language (`add`, `move`, `connect`, `expr`, `for`, `bus`).
When compiled, the subcircuit is validated for valid drivers, port connections, and dependency cycles.

### Hierarchical Modules
Modules can instantiate other user-defined modules to construct arbitrary N-level component hierarchies:

```sim
module FADDER {
    input A
    input B
    input Cin

    output S
    output Cout

    expr S = (A XOR B) XOR Cin
    expr Cout = (A AND B) OR (Cin AND (A XOR B))
}

module ADDER4 {
    input A[0..3]
    input B[0..3]
    input Cin

    output S[0..3]
    output Cout

    add FADDER FA0
    add FADDER FA1
    add FADDER FA2
    add FADDER FA3

    connect A[0] FA0.A
    connect B[0] FA0.B
    connect Cin FA0.Cin
    connect FA0.S S[0]
    connect FA0.Cout FA1.Cin

    connect A[1] FA1.A
    connect B[1] FA1.B
    connect FA1.S S[1]
    connect FA1.Cout FA2.Cin

    connect A[2] FA2.A
    connect B[2] FA2.B
    connect FA2.S S[2]
    connect FA2.Cout FA3.Cin

    connect A[3] FA3.A
    connect B[3] FA3.B
    connect FA3.S S[3]
    connect FA3.Cout Cout
}
```

### Module Dependency Graph & Recursion Rejection
An explicit dependency graph is maintained across all script-defined and registered modules.
Compilation order is determined automatically using topological sorting, so declaration order in text files does not restrict module composition.
Direct recursion (`add A X` inside `A`) and indirect circular module dependencies (`A → B → C → A`) are strictly rejected before partial modification occurs:
```sim
Cannot compile module A.
Circular module dependency: A → B → C → A
```

### Instance Arrays & Loops
Modules support indexed instance arrays:
```sim
for i in 0..3 {
    add FADDER FA[i]
    connect A[i] FA[i].A
    connect B[i] FA[i].B
}
```
Each instance (`FA[0]`, `FA[1]`, etc.) is a distinct simulator component with independent pins (`FA[0].A`, `FA[0].Cout`).

### Hierarchical Pin References
Pin references support dot notation across nested module boundaries:
- `FA0.A`
- `FA[0].Cout`
- `RIPPLE.FA0.Cout` (nested multi-level reference)

### Inspection, Tracing & Debugging Commands
- `show module ADDER4`: Displays module metadata, vector port ranges, internal instances, and explicit dependencies.
- `show FA0`: Displays instance type, position, flip state, ports with live signal values, and wire connections.
- `trace FA0.Cout`: Traces logical signal propagation through module boundaries, outputting the path chain (`FA0.Cout ↓ FA1.Cin ↓ FA1.Cout ↓ Cout`).
- `expand ADDER4`: Displays an ASCII tree representation (`├──`, `└──`) of internal components and wire links.
- `detach FA0`: Expands module instance `FA0` into its constituent gates and wires directly on the circuit canvas without leaving stale references.
- `show library "PATH"`: Displays library file metadata, imported dependencies, constants, and exported module definitions.

---

## 3. Compile-Time Integer Constants (`const`)

Declare immutable compile-time integer constants using `const NAME = EXPR`:

```sim
const WIDTH = 16
const LAST = WIDTH - 1
const HALF = WIDTH / 2
```

### Usage
Constants can be used anywhere compile-time integer expressions are accepted:
- Bus vector ranges: `bus A[0..LAST]`
- Loop ranges: `for i in 0..LAST`
- Array indices and coordinate arithmetic: `move A[i] to (0, i * 40)`
- Module parameter arguments: `add RCA(WIDTH) ADD16`

### Resolution & Rules
1. **Dependency Resolution:** Constants can reference previously or forwardly declared constants. Resolution is deterministic using topological ordering.
2. **Cycle Detection:** Constant dependency cycles (`const A = B + 1` and `const B = A + 1`) are strictly rejected with an error chain (`Constant dependency cycle: A -> B -> A`).
3. **Immutability:** Reassigning or attempting to overwrite a constant (e.g., `const WIDTH = 32`) throws a clear error.
4. **Scope Hierarchy:** `local loop variable / parameter` → `module-local constant` → `project-level / library constant`.

---

## 4. Reusable Script Libraries & Imports (`import`)

Import reusable constants and module definitions from server-provided `.sim` library files:

```sim
import "logic" as logic
import "arithmetic" as arithmetic
```

### Import Semantics & Namespaces
- **Import Aliases:** Import statements support `import "module" as alias`. The alias establishes a local namespace for symbols provided by that library.
- **Qualified Module References:** Definitions are referenced using dot notation (e.g. `add logic.FADDER F0` or `add arithmetic.RCA(16) ADD16`).
- **Qualified Constants:** Compile-time constants defined in aliased imports are referenced via dot notation (e.g., `bus A[0..consts.WIDTH-1]`).
- **Name Disambiguation:** If two imported libraries contain conflicting symbol names (e.g., both define `MUX`), using aliases prevents name collisions (`add l1.MUX MUX_A` and `add l2.MUX MUX_B`).
- **Unqualified References & Ambiguity Errors:** Unqualified names (`add FADDER F0`) remain supported when unambiguous. If multiple aliased libraries contain candidate definitions for an unqualified name, execution aborts with a descriptive ambiguity error listing candidate choices:
  ```text
  Ambiguous module 'FADDER'.

  Candidates:
    l1.FADDER
    l2.FADDER
  ```
- **Transitive Dependency Scope:** Qualified imported modules internally referencing other modules maintain their internal dependency chains without requiring outer scripts to re-alias nested dependencies.
- **Inspection Command:** `show import ALIAS` reports the alias name, target library path, and exported module definitions.

### Multi-File Server Library Structure Example with Aliases

#### `PROJECT_ROOT/lib/logic.sim`
```sim
# Server primitive library
module FADDER {
    input A
    input B
    input Cin

    output S
    output Cout

    expr S = (A XOR B) XOR Cin
    expr Cout = (A AND B) OR (Cin AND (A XOR B))
}
```

#### `PROJECT_ROOT/lib/arithmetic.sim`
```sim
import "logic"

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
# Top-level project script loading server library with aliases
import "logic" as logic
import "arithmetic" as math

add input A
add input B
add input Cin
add logic.FADDER FA0
add math.RCA(16) ADD16
add output S
add output Cout

connect A FA0.A
connect B FA0.B
connect Cin FA0.Cin
connect FA0.S S
connect FA0.Cout Cout
```

### Restrictions
- Direct recursion and indirect circular module dependencies are rejected.
- Compilation errors identify the module name and failing line number.
- Scripted modules are integrated with the visual Custom Parts library and can be placed, moved, flipped, saved, and loaded.

### Module Instantiation & Pin Identity
Instantiate defined modules with `add`:
```sim
add FullAdder FA0
add FullAdder FA1

connect A -> FA0.A
connect B -> FA0.B
connect Cin -> FA0.Cin
```
Pin identity (e.g. `FA0.A`, `FA0.S`) is logical and persistent regardless of visual rendering, position, or horizontal/vertical flipping.

---

## 3. Component Types

Supported built-in component types:
- `input` (Interactive Input Switch)
- `output` (Visual Output Indicator)
- `clock` (Pulse Clock Generator)
- `constant high` / `constant low`
- `button` (Push Button Switch)
- `and` / `nand`
- `or` / `nor`
- `xor` / `xnor`
- `not`
- `buffer`
- `npn` / `pnp` (Transistor Switches)
- `led`
- `7-segment display` / `10-segment display`
- Custom & Scripted Module Names (e.g. `HalfAdder`, `FullAdder`, `RippleAdder4`)

---

## 4. Position & Geometry

All coordinates on the canvas use a 20px grid system. Explicitly positioned components using `move NAME to (X, Y)` are marked as position-locked anchors (`isExplicitPosition = true`) and will **not** be moved or rearranged during subsequent boolean expression synthesis (`expr`).

Example:
```sim
add input A
move A to (0, 100)

add input B
move B to (0, 200)

add output S
move S to (600, 150)

expr S = A XOR B
```

---

## 4.2 Script Editor Autocomplete

The `.sim` script editor features a context-sensitive, VS Code-style autocomplete system that provides instant suggestions as you type or upon manual invocation (`Tab`, `Ctrl+Space`, `Cmd+Space`).

### Keyboard Navigation & Shortcuts
- `Ctrl+Space` / `Cmd+Space`: Trigger autocomplete suggestions manually.
- `ArrowUp` / `ArrowDown`: Navigate through suggestion items.
- `Enter` / `Tab`: Accept and insert the selected completion.
- `Escape`: Dismiss the autocomplete popup.

### Contextual Suggestions
- **Line Start:** Commands (`add`, `move`, `connect`, `set`, `remove`, `show`, `trace`, `expand`, `detach`, `list`, `net`, `const`, `import`, `bus`, `expr`, `for`, `module`, `undo`, `redo`), in-scope loop variables, and constants.
- **After `add`:** Built-in gate types (`and`, `or`, `nand`, `nor`, `xor`, `not`, `input`, `output`, `clock`, `button`, `npn`, `pnp`, `led`, `7-segment display`, `10-segment display`), custom/scripted modules (`FullAdder`, `RCA`), and import alias prefixes (`logic.`, `math.`).
- **After `import "`:** Available server library `.sim` files (`logic`, `arithmetic`).
- **After `import "module" `:** Keyword `as`.
- **After Alias (`math.`):** Exported module definitions and constants in that library namespace.
- **After `move`, `remove`, `show`, `trace`, `expand`, `detach`:** Instance names and bus names from the active circuit graph.
- **After `connect` / `connect A ->`:** Component names and signal sources/destinations.
- **After `connect COMP.`:** Exposed pins and ports for component `COMP` (including vector indices).
- **After `set COMP.`:** Properties supported by component `COMP` (`label`, `freq`, `buttonMode`, `holdDuration`, `ledColor`, `rgbaValue`, `rotation`, `flipX`, `flipY`).
- **After `set COMP.PROPERTY `:** Enumerated property values (`Hz`, `kHz`, `MHz`, `GHz`, `press`, `hold`, `Red`, `Green`, `Blue`, `RGBA`, `true`, `false`).
- **Module Parameters (`add RCA(`):** Parameter names (`width=`), constants, and loop variables.

---

## 4.1 Natural Numeric Pin Ordering

Module input/output ports and vector buses containing numeric indices (such as `B[0..15]`, `A[0]..A[100]`) are sorted in natural numerical order for visual layout and display:

```text
B[0]
B[1]
B[2]
...
B[9]
B[10]
B[11]
...
B[15]
```

- **Natural Ordering:** Pin numbers are sorted by their integer values rather than lexicographical string comparison (`B[10]` comes *after* `B[9]`, not before `B[2]`).
- **Pin Identity Stability:** Natural sorting applies strictly to visual display and layout ordering. Logical pin identifiers (`"B[10]"`) and electrical wire connections remain unchanged and fully deterministic.

---

## 5. Indexed Identifiers & Ranges

Component and signal identifiers support multi-dimensional array indexing:
- `A[0]`, `A[1]`, `G[0][1]`
- `G[0].A` (accessing pin `A` on component `G[0]`)

Ranges support inclusive ascending (`0..15`) and descending (`15..0`) ranges:
```sim
for i in 0..7 {
    add input A[i]
    move A[i] to (0, i * 40)
}
```

---

## 6. First-Class Buses & Vector Operations

Declare buses with `bus NAME[START..END]`:
```sim
bus A[0..15]
bus B[0..15]
```

Vector connections automatically map corresponding index bits pairwise between compatible buses or module vector ports:
```sim
connect A B
```
If source and destination widths mismatch (e.g., `A[0..15]` to `B[0..7]`), execution aborts with a descriptive width error: `Cannot connect A to B: source width = 16, destination width = 8`.

Explicit bus slices are also supported:
```sim
connect A[0..7] B[0..7]
```

---

## 7. Boolean Expression Synthesis

Synthesize expressions directly into gates and wires using `expr`:
```sim
expr S = A XOR B XOR Cin
expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
```

### Supported Operators & Precedence
1. Parentheses `()`
2. `NOT` (Unary)
3. `AND` / `NAND`
4. `XOR` / `XNOR`
5. `OR` / `NOR`

### Self-Reference Restriction
An output signal cannot reference itself in its own expression:
```sim
# INVALID - Self-referential expression!
expr A = A XOR B
```
This is rejected with a clear error: `Cannot define 'A' because it is referenced by its own expression.`

---

## 8. Comments & Error Reporting

Lines or suffixes starting with `#` are treated as comments:
```sim
# Full Adder Circuit
add input A # Primary input
```

Script execution operates within a single transaction boundary. If an error occurs on any line or loop iteration, the entire execution rolls back cleanly, reporting the 1-based line number and loop context:
```sim
Line 5:
Loop iteration: i = 2
Unknown pin 'INVALID' on component 'G[2]'
```

---

## 9. Complete Working Examples

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

### 2. Full Adder Module Definition & Instantiation
```sim
# 1. Define reusable FullAdder module
module FullAdder {
    input A
    input B
    input Cin

    output S
    output Cout

    expr S = (A XOR B) XOR Cin
    expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
}

# 2. Instantiate and wire Full Adder in main circuit
add input A
move A to (0, 100)

add input B
move B to (0, 180)

add input Cin
move Cin to (0, 260)

add FullAdder FA0
move FA0 to (300, 180)

add output S
move S to (600, 140)

add output Cout
move Cout to (600, 220)

connect A FA0.A
connect B FA0.B
connect Cin FA0.Cin
connect FA0.S S
connect FA0.Cout Cout
```

### 3. 4-Bit Ripple-Carry Adder Using FullAdder Modules & Loops
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
