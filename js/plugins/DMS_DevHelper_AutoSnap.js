/*:
 * @target MZ
 * @plugindesc Dev helper: auto-snap the game window on playtest start.
 * @author You
 *
 * @param Enable Game-test auto snapping
 * @type boolean
 * @default false
 * @desc If true, the game window will snap automatically when the playtest starts (NW.js only).
 *
 * @param Snap game test to
 * @type select
 * @option Top-left of screen
 * @value top-left
 * @option Bottom-left of screen
 * @value bottom-left
 * @option Bottom-right of screen
 * @value bottom-right
 * @option Top-right of screen
 * @value top-right
 * @option Left side of screen
 * @value left
 * @option Right side of screen
 * @value right
 * @default top-left
 * @desc Position to snap the playtest window to when auto snapping is enabled.
 *
 * @param Enable Auto-open Console
 * @type boolean
 * @default false
 * @desc If true, DevTools console opens on playtest start (no snapping applied).
 *
 * @param Snap Console to
 * @type select
 * @option Top-left of screen
 * @value top-left
 * @option Bottom-left of screen
 * @value bottom-left
 * @option Bottom-right of screen
 * @value bottom-right
 * @option Top-right of screen
 * @value top-right
 * @option Left side of screen
 * @value left
 * @option Right side of screen
 * @value right
 * @default right
 * @desc Position to snap the DevTools console when auto-open is enabled.
 */
"use strict";

(() => {
    const params = PluginManager.parameters("DMS_DevHelper_AutoSnap");
    const autoSnap = String(params["Enable Game-test auto snapping"] || "false") === "true";
    const snapTo = String(params["Snap game test to"] || "top-left");
    const autoConsole = String(params["Enable Auto-open Console"] || "false") === "true";

    function computeSnapPosition(targetSnap) {
        let left = 0, top = 0, sw = 0, sh = 0;
        try {
            if (typeof nw !== "undefined" && nw.Screen?.Init) {
                if (!computeSnapPosition._inited) {
                    nw.Screen.Init();
                    computeSnapPosition._inited = true;
                }
                const primary = (nw.Screen.screens || []).find(s => s.is_primary) || (nw.Screen.screens || [])[0];
                if (primary?.bounds) {
                    left = Number(primary.bounds.x || 0);
                    top = Number(primary.bounds.y || 0);
                    sw = Number(primary.bounds.width || 0);
                    sh = Number(primary.bounds.height || 0);
                }
            }
        } catch (_) { /* ignore */ }
        if (!sw || !sh) {
            const scr = window?.screen || {};
            left = Number(scr.availLeft ?? scr.availX ?? 0) || 0;
            top = Number(scr.availTop ?? scr.availY ?? 0) || 0;
            sw = Number(scr.availWidth ?? scr.width ?? 0) || 0;
            sh = Number(scr.availHeight ?? scr.height ?? 0) || 0;
        }
        if (!sw || !sh) return null;
        const targetW = Math.max(200, Math.floor(sw / 2)); // half the whole screen width
        const fullH = sh;                // full height for side snaps
        const halfH = Math.max(200, Math.floor(sh / 2)); // half height for corner snaps
        const cx = left + (sw - targetW) / 2;
        const cyTop = top;
        const cyBottom = top + sh - halfH;
        switch (targetSnap) {
            case "top-left":
                return { x: left, y: cyTop, w: targetW, h: halfH };
            case "bottom-left":
                return { x: left, y: cyBottom, w: targetW, h: halfH };
            case "top-right":
                return { x: left + sw - targetW, y: cyTop, w: targetW, h: halfH };
            case "bottom-right":
                return { x: left + sw - targetW, y: cyBottom, w: targetW, h: halfH };
            case "left":
                return { x: left, y: cyTop, w: targetW, h: fullH };
            case "right":
                return { x: left + sw - targetW, y: cyTop, w: targetW, h: fullH };
            default:
                return { x: cx, y: cyTop, w: targetW, h: fullH };
        }
    }

    function snapWindow(targetSnap, targetWin) {
        if (!Utils.isNwjs?.()) return;
        try {
            const gui = require("nw.gui");
            const win = targetWin || gui?.Window?.get?.();
            if (!win) return;
            const pos = computeSnapPosition(targetSnap);
            if (!pos) return;
            // Ensure not maximized before resize/move
            try { win.restore(); } catch (_) {}
            const applySnap = () => {
                if (typeof win.setResizable === "function") win.setResizable(true);
                if (typeof win.setMinimumSize === "function") win.setMinimumSize(0, 0);
                const w = Math.round(pos.w);
                const h = Math.round(pos.h);
                const x = Math.round(pos.x);
                const y = Math.round(pos.y);
                win.resizeTo(w, h);
                win.moveTo(x, y);
            };
            // Try a few times to overcome any renderer resize clamping
            [400, 800, 1200].forEach(delay => setTimeout(applySnap, delay));
        } catch (e) {
            console.warn("[DMS_DevHelper_AutoSnap] Failed to snap window:", e);
        }
    }

    if (autoSnap || autoConsole) {
        window.addEventListener("load", () => {
            if (autoSnap) setTimeout(() => snapWindow(snapTo), 300);
            if (autoConsole) {
                try {
                    const gui = require("nw.gui");
                    const mainWin = gui?.Window?.get?.();
                    if (mainWin?.showDevTools) {
                        try { localStorage.clear(); } catch (_) {}
                        mainWin.showDevTools(null, devWin => {
                            // We can auto-open DevTools; Chromium blocks programmatic resize/move of DevTools.
                            // Leaving hook here in case future NW.js versions permit sizing.
                            if (!devWin) return;
                        });
                    }
                } catch (e) {
                    console.warn("[DMS_DevHelper_AutoSnap] Failed to auto-open/snap console:", e);
                }
            }
        });
    }
})();
