/**
 * Modern In-App Reusable Modal Dialog manager.
 **/

import { highlightSimScript } from "./script_editor.js";

export function openModal(
    title,
    htmlContent,
    onOpenCallback = null,
    onCloseCallback = null
) {
    const modalOverlay = document.getElementById("generic-dialog-modal");
    const modalTitle = document.getElementById("generic-modal-title");
    const modalBody = document.getElementById("generic-modal-body");

    modalTitle.innerHTML = title;
    modalBody.innerHTML = htmlContent;

    modalBody.querySelectorAll("pre code").forEach((block) => {
        block.innerHTML = highlightSimScript(block.textContent);
    });

    modalOverlay.classList.add("active");

    if (onOpenCallback) {
        onOpenCallback();
    }
}


export function closeModal() {
    const modalOverlay = document.getElementById("generic-dialog-modal");
    modalOverlay.classList.remove("active");
}

// Setup Backdrop and ESC hooks on load
window.addEventListener("DOMContentLoaded", () => {
    const modalOverlay = document.getElementById("generic-dialog-modal");
    const btnClose = document.getElementById("btn-close-generic-modal");

    if (btnClose) {
        btnClose.addEventListener("click", closeModal);
    }

    if (modalOverlay) {
        modalOverlay.addEventListener("mousedown", (e) => {
            if (e.target === modalOverlay) {
                closeModal();
            }
        });
    }

    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (modalOverlay && modalOverlay.classList.contains("active")) {
                closeModal();
            }
        }
    });
});
