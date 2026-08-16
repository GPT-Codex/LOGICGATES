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
| `show` | `show NAME` | Display detailed inspection metadata for a component or bus. |
| `list` | `list` | List all components, buses, and wires in the active circuit. |
| `net` | `net NAME` | Create a net signal node (buffer pass-through). |
| `bus` | `bus NAME[START..END]` | Declare a first-class $N$-bit bus vector. |
| `expr` | `expr OUTPUT = BOOLEAN_EXPRESSION` | Synthesize a boolean expression into gates and wires. |
| `for` | `for VAR in START..END { ... }` | Loop over an inclusive numerical range. |

---

## 2. Component Types

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
- Custom Module Names (e.g. `HalfAdder`, `FullAdder`)

---

## 3. Position & Geometry

All coordinates on the canvas use a 20px grid system. Explicitly positioned components using `move NAME to (X, Y)` are marked as position-locked anchors (`isExplicitPosition = true`) and will **not** be moved or rearranged during subsequent boolean expression synthesis (`expr`).

Example:
```text
add input A
move A to (0, 100)

add input B
move B to (0, 200)

add output S
move S to (600, 150)

expr S = A XOR B
```

---

## 4. Indexed Identifiers & Ranges

Component and signal identifiers support multi-dimensional array indexing:
- `A[0]`, `A[1]`, `G[0][1]`
- `G[0].A` (accessing pin `A` on component `G[0]`)

Ranges support inclusive ascending (`0..15`) and descending (`15..0`) ranges:
```text
for i in 0..7 {
    add input A[i]
    move A[i] to (0, i * 40)
}
```

---

## 5. First-Class Buses & Vector Operations

Declare buses with `bus NAME[START..END]`:
```text
bus A[0..15]
bus B[0..15]
```

Vector connections automatically map corresponding index bits pairwise between compatible buses:
```text
connect A B
```
If source and destination widths mismatch (e.g., `A[0..15]` to `B[0..7]`), execution aborts with a descriptive width error: `Cannot connect A to B: source width = 16, destination width = 8`.

Explicit bus slices are also supported:
```text
connect A[0..7] B[0..7]
```

---

## 6. Boolean Expression Synthesis

Synthesize expressions directly into gates and wires using `expr`:
```text
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
```text
# INVALID - Self-referential expression!
expr A = A XOR B
```
This is rejected with a clear error: `Cannot define 'A' because it is referenced by its own expression.`

---

## 7. Comments & Error Reporting

Lines or suffixes starting with `#` are treated as comments:
```text
# Full Adder Circuit
add input A # Primary input
```

Script execution operates within a single transaction boundary. If an error occurs on any line or loop iteration, the entire execution rolls back cleanly, reporting the 1-based line number and loop context:
```text
Line 5:
Loop iteration: i = 2
Unknown pin 'INVALID' on component 'G[2]'
```

---

## 8. Complete Working Examples

### 1. Half Adder
```text
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
```text
# Full Adder Script
add input A
move A to (0, 100)
set A.label A

add input B
move B to (0, 180)
set B.label B

add input Cin
move Cin to (0, 260)
set Cin.label Cin

add output S
move S to (600, 100)
set S.label S

add output Cout
move Cout to (600, 180)
set Cout.label Cout

expr S = A XOR B XOR Cin
expr Cout = (A AND B) OR (A AND Cin) OR (B AND Cin)
```

### 3. 4-Bit Ripple-Carry Adder
```text
# 4-Bit Ripple-Carry Adder
bus A[0..3]
bus B[0..3]
bus SUM[0..3]

add input Cin
move Cin to (0, 0)

for i in 0..3 {
    add input A[i]
    move A[i] to (0, i * 80 + 100)
    add input B[i]
    move B[i] to (0, i * 80 + 140)
    add output SUM[i]
    move SUM[i] to (800, i * 80 + 120)
}

add output Cout
move Cout to (800, 450)

# Bit 0
expr SUM[0] = A[0] XOR B[0] XOR Cin
expr C[0] = (A[0] AND B[0]) OR (A[0] AND Cin) OR (B[0] AND Cin)

# Bits 1..3
for i in 1..3 {
    expr SUM[i] = A[i] XOR B[i] XOR C[i - 1]
    expr C[i] = (A[i] AND B[i]) OR (A[i] AND C[i - 1]) OR (B[i] AND C[i - 1])
}

connect C[3] Cout
```

### 4. 8-Bit Ripple-Carry Adder
```text
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
```text
# First-Class Vector Bus Example
bus IN_BUS[0..7]
bus OUT_BUS[0..7]

for i in 0..7 {
    add input IN[i]
    move IN[i] to (0, i * 40)
    add output OUT[i]
    move OUT[i] to (600, i * 40)
    connect IN[i] IN_BUS[i]
    connect OUT_BUS[i] OUT[i]
}

# Connect entire 8-bit bus with one command
connect IN_BUS OUT_BUS
```
