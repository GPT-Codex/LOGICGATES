/**
 * Authoritative Application Version & What's New Changelog Metadata.
 */

export const APP_VERSION = "v0.19.0";

export const RELEASE_NOTES = [
    {
        version: "v0.19.0",
        date: "Current Release",
        isCurrent: true,
        highlights: [
            "Composite Display Assemblies: Create reusable display custom parts (type = 'display') that preserve exact bounding geometry and render live embedded display components.",
            "3-Terminal BJT Transistors: NPN and PNP transistor switches modeled as digital switch abstractions (Base, Collector, Emitter) with clear schematic symbols.",
            "4-Digit 7-Segment Display: Added 4-digit multiplexed seven-segment display component (a..dp, DIG1..DIG4).",
            "Visual Pin Labels: Added clear pin labels to Register (D[0..N-1], CLK, Q[0..N-1]), Counter (CLK, EN, Q[0..N-1]), and 7-Segment Display (a..g, dp) components."
        ]
    },
    {
        version: "v0.18.0",
        date: "Previous Release",
        isCurrent: false,
        highlights: [
            "Added 2:1 Multiplexer (MUX) component and parameterized vector MUX(width) modules.",
            "Fixed script editor autocomplete for imported library modules and aliased namespaces (e.g. 'operations.RCA').",
            "Added What's New version changelog dialog with unseen update indicator."
        ]
    },
    {
        version: "v0.17.0",
        date: "Previous Release",
        isCurrent: false,
        highlights: [
            "Added Sequential Logic category to component toolbox.",
            "Added edge-triggered D Flip-Flop (DFF) with stored state serialization.",
            "Added parameterized N-bit Register (REGISTER(width)) with simultaneous rising-edge sampling.",
            "Added parameterized N-bit Binary Up-Counter (COUNTER(width)) with enable control and wraparound."
        ]
    },
    {
        version: "v0.16.0",
        date: "Previous Release",
        isCurrent: false,
        highlights: [
            "Added import alias support ('import \"lib\" as alias') and qualified module/constant references.",
            "Added enhanced import error diagnostics reporting source file, line number, server path, and chain traces.",
            "Implemented natural numerical pin ordering for multi-digit indexed pins (B[0]..B[15])."
        ]
    },
    {
        version: "v0.15.0",
        date: "Previous Release",
        isCurrent: false,
        highlights: [
            "Added parameterized script modules (module NAME(params) { ... }).",
            "Added compile-time integer constants (const NAME = EXPR).",
            "Added server-backed .sim library import architecture."
        ]
    }
];

const STORAGE_KEY = "sim_last_seen_version";

export function isNewVersionAvailable() {
    try {
        if (typeof localStorage !== "undefined") {
            const seen = localStorage.getItem(STORAGE_KEY);
            return seen !== APP_VERSION;
        }
    } catch (e) {
        // LocalStorage disabled
    }
    return false;
}

export function markCurrentVersionSeen() {
    try {
        if (typeof localStorage !== "undefined") {
            localStorage.setItem(STORAGE_KEY, APP_VERSION);
        }
    } catch (e) {
        // LocalStorage disabled
    }
}

export function showWhatsNewModal() {
    markCurrentVersionSeen();
    const badge = document.getElementById("whats-new-badge");
    if (badge) badge.style.display = "none";

    let html = `
        <div class="whats-new-container" style="max-height: 480px; overflow-y: auto; padding-right: 8px;">
            <p style="margin-bottom: 16px; font-size: 13px; color: #94a3b8; line-height: 1.5;">
                Welcome to <strong>Digital Logic Simulator ${APP_VERSION}</strong>! Here is what's new in recent updates:
            </p>
    `;

    for (const note of RELEASE_NOTES) {
        const isCurrent = note.isCurrent;
        const currentBadge = isCurrent
            ? `<span style="background: #00adb5; color: #000; font-size: 10px; font-weight: bold; padding: 2px 8px; border-radius: 10px; margin-left: 8px;">CURRENT</span>`
            : "";

        html += `
            <div class="release-block" style="background: #182232; border: 1px solid ${isCurrent ? "#00adb5" : "#2d3748"}; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                    <h3 style="margin: 0; font-size: 15px; color: #f8fafc; font-weight: 600;">
                        ${note.version} ${currentBadge}
                    </h3>
                    <span style="font-size: 12px; color: #64748b;">${note.date}</span>
                </div>
                <ul style="margin: 0; padding-left: 20px; color: #cbd5e1; font-size: 13px; line-height: 1.6;">
                    ${note.highlights.map(item => `<li>${item}</li>`).join("")}
                </ul>
            </div>
        `;
    }

    html += `
        </div>
        <div class="modal-footer" style="margin-top: 16px; text-align: right;">
            <button class="btn btn-primary" id="btn-whats-new-close">Got It!</button>
        </div>
    `;

    import("./modals.js").then(({ openModal, closeModal }) => {
        openModal(`What's New (${APP_VERSION})`, html, () => {
            const btnClose = document.getElementById("btn-whats-new-close");
            if (btnClose) {
                btnClose.addEventListener("click", closeModal);
            }
        });
    });
}

export function initWhatsNewUI() {
    const btn = document.getElementById("btn-whats-new");
    const badge = document.getElementById("whats-new-badge");

    if (badge && isNewVersionAvailable()) {
        badge.style.display = "block";
    }

    if (btn) {
        btn.addEventListener("click", () => {
            showWhatsNewModal();
        });
    }
}
