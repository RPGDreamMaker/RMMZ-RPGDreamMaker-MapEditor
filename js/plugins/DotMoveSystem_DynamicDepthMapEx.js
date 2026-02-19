"use strict";
/*:
 * @target MZ
 * @plugindesc v1.0 - DotMove Dynamic Depth Extension (Rewritten, No Drift, No Choose File Button)
 * @author You
 * @base DotMoveSystem
 *
 * @help
 * Fully rewritten Dynamic Depth Overlay plugin.
 *   - Zero drift (IDENTICAL to original DynamicOverlayEx timing)
 *   - Per-map JSON overlay definitions
 *   - Live editor in Test Mode (Ctrl + Shift + D)
 *   - Full Z-index depth logic
 *
 * JSON file created at: /data/DynamicDepthMaps.json
 */

(() => {

console.log("DynamicDepthEx: Initializing clean rewrite…");

/* ============================================================================
   MODULE ROOTS
============================================================================ */
const DD_Env = {};
const DD_Core = {};
const DD_Editor = {};
window.DynamicDepth_Env        = DD_Env;
window.DynamicDepth_Core       = DD_Core;
window.DynamicDepth_EditorMode = DD_Editor;

/* ============================================================================
   PHASE 1 — ENVIRONMENT DETECT
============================================================================ */
(function() {
    const isNw = Utils.isNwjs();
    const isTest = Utils.isOptionValid("test");

    let mode = "browser";
    if (isNw && isTest) mode = "editorTest";
    else if (isNw) mode = "windowsBuild";

    DD_Env.isNwjs = isNw;
    DD_Env.isTest = isTest;
    DD_Env.mode   = mode;

    console.log("DynamicDepthEx Mode:", mode);
})();

/* ============================================================================
   PHASE 2 — JSON LOAD / SAVE
============================================================================ */
DD_Core.MapData = {};

DD_Editor.fs = null;
DD_Editor.path = null;
DD_Editor.jsonPath = null;

DD_Editor.init = function() {
    if (DD_Env.mode !== "editorTest") return;

    this.fs   = require("fs");
    this.path = require("path");
    this.jsonPath = this.path.join(process.cwd(), "data/DynamicDepthMaps.json");

    this.loadJson();
};

DD_Editor.loadJson = function() {
    try {
        if (!this.fs.existsSync(this.jsonPath)) {
            console.warn("DynamicDepthEx: Creating new JSON file.");
            this.fs.writeFileSync(this.jsonPath, JSON.stringify({}, null, 2));
        }
        const txt = this.fs.readFileSync(this.jsonPath, "utf8");
        DD_Core.MapData = JSON.parse(txt);
    } catch(e) {
        console.error("DynamicDepthEx: Failed JSON load:", e);
        DD_Core.MapData = {};
    }
};

DD_Editor.saveJson = function() {
    if (DD_Env.mode !== "editorTest") return;
    try {
        this.fs.writeFileSync(
            this.jsonPath,
            JSON.stringify(DD_Core.MapData, null, 2)
        );
    } catch(e) {
        console.error("DynamicDepthEx: Failed JSON save:", e);
    }
};

if (DD_Env.mode === "editorTest") DD_Editor.init();

/* ============================================================================
   PHASE 3 + 4 — DRIFT-FREE EXACT OVERLAY SYSTEM
   (Runtime Spriteset logic)
============================================================================ */

/* ---------------------------------------------------------------------------
   Override Spriteset_Map.initialize
--------------------------------------------------------------------------- */
const _DD_SM_init = Spriteset_Map.prototype.initialize;
Spriteset_Map.prototype.initialize = function() {
    _DD_SM_init.call(this);

    this._ddData    = [];   // raw overlay definitions for current map
    this._ddSprites = [];   // actual runtime overlay sprites

    this.ddLoadMapData();   // load from JSON
    this.ddCreateSprites(); // create sprites
};


/* ---------------------------------------------------------------------------
   Load per-map overlay data from JSON
--------------------------------------------------------------------------- */
Spriteset_Map.prototype.ddLoadMapData = function() {
    const id = String($gameMap.mapId());
    const d  = DD_Core.MapData[id];

    // Deep-copy array to avoid direct mutation by editor
    this._ddData = Array.isArray(d)
        ? JSON.parse(JSON.stringify(d))
        : [];
};


/* ---------------------------------------------------------------------------
   Create overlay sprites (IDENTICAL logic to original DynamicOverlayEx)
--------------------------------------------------------------------------- */
Spriteset_Map.prototype.ddCreateSprites = function() {
    const tilemap        = this._tilemap;
    const tw             = $gameMap.tileWidth();
    const th             = $gameMap.tileHeight();
    const characterLayer = tilemap.children.find(c => c._characterSprites);

    for (const ov of this._ddData) {
        const spr = new Sprite(ImageManager.loadParallax(ov.filename));

        // Store overlay metadata for update+sorting logic
        spr._ddMapX      = ov.mapX;
        spr._ddMapY      = ov.mapY;
        spr._ddThreshold = ov.thresholdY;
        spr._ddZOffset   = ov.zOffset || 0;
        spr._ddAlpha     = ov.alpha;
        spr._ddVisible   = ov.visible !== false;

        // Position + visibility update
        spr.updateDD = function() {
            const ox = $gameMap.displayX() * tw;
            const oy = $gameMap.displayY() * th;
            this.x      = this._ddMapX - ox;
            this.y      = this._ddMapY - oy;
            this.alpha  = this._ddAlpha;
            this.visible = this._ddVisible;
        };

        spr.bitmap.addLoadListener(() => spr.updateDD());

        // Add to correct layer
        (characterLayer ?? tilemap).addChild(spr);

        this._ddSprites.push(spr);
    }
};


/* ---------------------------------------------------------------------------
   Override update → refresh positions + sorting
--------------------------------------------------------------------------- */
const _DD_SM_update = Spriteset_Map.prototype.update;
Spriteset_Map.prototype.update = function() {
    _DD_SM_update.call(this);
    this.ddUpdatePositions();
    this.ddUpdateSorting();
};


/* ---------------------------------------------------------------------------
   Update overlay sprite positions
--------------------------------------------------------------------------- */
Spriteset_Map.prototype.ddUpdatePositions = function() {
    for (const s of this._ddSprites) s.updateDD();
};


/* ---------------------------------------------------------------------------
   Sorting logic — identical to original DynamicOverlayEx
--------------------------------------------------------------------------- */
Spriteset_Map.prototype.ddUpdateSorting = function() {
    const tilemap  = this._tilemap;
    const overlays = this._ddSprites;
    const chars    = this._characterSprites;
    const th       = $gameMap.tileHeight();

    // Sort overlays by thresholdY ascending
    overlays.sort((a, b) => a._ddThreshold - b._ddThreshold);

    const base = 1001;  // base Z used in original plugin
    let z = base;

    // Assign Z to overlays
    for (const ov of overlays) {
        ov.z = z + (ov._ddZOffset || 0);
        z += 2; // spacing to allow character insertion
    }

    // Assign Z to characters relative to overlays
    for (const cs of chars) {
        const ch = cs._character;
        const cy = ch._realY * th;
        let cz = base;

        for (const ov of overlays) {
            if (cy > ov._ddThreshold) cz = Math.max(cz, ov.z + 1);
            else                      cz = Math.min(cz, ov.z - 1);
        }
        cs.z = cz;
    }

    // Final layer sort
    tilemap.children.sort((a, b) => (a.z || 0) - (b.z || 0));
};



/* ============================================================================
   PHASE 5 — EDITOR ENTRY (test-mode only)
   (Hotkey, popup window, HTML injection)
============================================================================ */

if (DD_Env.mode === "editorTest") {

const ED = DD_Editor;
ED.editorWindow = null;


/* ---------------------------------------------------------------------------
   Ctrl+Shift+D → Toggle popup window
--------------------------------------------------------------------------- */
document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.shiftKey && e.code === "KeyD") {
        e.preventDefault();
        ED.toggle();
    }
});


/* ---------------------------------------------------------------------------
   Open/Close logic for popup
--------------------------------------------------------------------------- */
ED.toggle = function() {
    // prevent opening outside of maps
    if (!SceneManager._scene || !(SceneManager._scene instanceof Scene_Map)) {
        console.warn("DynamicDepthEx: Cannot open editor outside Scene_Map.");
        return;
    }

    if (this.editorWindow && !this.editorWindow.closed) {
        this.editorWindow.close();
        this.editorWindow = null;
        return;
    }
    this.open();
};


/* ---------------------------------------------------------------------------
   Open live editor popup
--------------------------------------------------------------------------- */
ED.open = function() {
    const html = this.makeHtml();
    const url  = "data:text/html," + encodeURIComponent(html);

    nw.Window.open(
        url,
        { width: 1100, height: 700 },
        win => {
            this.editorWindow = win;
            win.on("closed", () => this.editorWindow = null);

            // Send overlay list once popup is ready
            setTimeout(() => this.sendList(), 80);
        }
    );
};

/* ---------------------------------------------------------------------------
    Popup HTML with Choose File… Button
--------------------------------------------------------------------------- */
ED.makeHtml = function() {

return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Dynamic Depth Editor</title>

<style>

/* ---------------------------------------------------------
   GLOBAL PAGE LAYOUT
---------------------------------------------------------- */

body {
    margin: 0;
    padding: 20px;
    background: #222;
    color: #eee;
    font-family: sans-serif;
}

/* 2-column layout: LEFT = list, RIGHT = editor */
.container {
    display: grid;
    grid-template-columns: 550px 1fr;
    gap: 20px;
}

/* ---------------------------------------------------------
   LEFT SIDE — OVERLAY LIST
---------------------------------------------------------- */

.list-box {
    background: #333;
    padding: 12px;
    border-radius: 8px;
    max-height: 600px;
    overflow-y: auto;
}

/* Each overlay entry in the list */
.list-entry {
    background: #444;
    padding: 8px;
    margin-bottom: 8px;
    border-radius: 6px;
    display: grid;
    grid-template-columns: 1fr 80px 80px 80px;
    gap: 10px;
    align-items: center;
}

/* Generic button styling */
button {
    padding: 6px 12px;
    border-radius: 4px;
}

/* The “+ Add Overlay” button */
#addBtn {
    display: block;
    margin-bottom: 16px;
}

/* The top bar (Add button + map info) */
.top-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
}

/* The container holding the map info text */
.map-info-box {
    display: flex;
    align-items: center; /* vertically centered text */
    gap: 10px;
    margin-bottom: 14px;
}

/* ---------------------------------------------------------
   RIGHT SIDE — EDITOR PANEL (consistent layout)
---------------------------------------------------------- */

/* One “row” of the form (label + input + optional button) */
.editor-row {
    display: flex;
    align-items: center; /* vertical centering */
    gap: 10px;
    margin-bottom: 14px;
}

/* Labels in the editor */
.editor-label {
    width: 100px;
    text-align: left;
    font-size: 15px;
}

/* Input fields (fixed width + no flex-grow) */
.editor-input {
    width: 200px;
    flex: 0 0 auto;
    padding: 6px;
    background: #444;
    color: #eee;
    border: 1px solid #555;
    border-radius: 4px;
}

/* Buttons inside editor rows (Choose file, Capture Y, etc.) */
.editor-button {
    padding: 6px 12px;
    border-radius: 4px;
    height: 36px; /* matches input height */
    display: flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
}

/* Save JSON + Reload buttons block */
.editor-actions {
    display: flex;
    gap: 10px;
    margin-top: 20px;
}

</style>

</head>

<body>
<h2>📐 Dynamic Depth — Live Editor</h2>

<div class="container">

<!-- ---------------------------------------------------------
     LEFT COLUMN
---------------------------------------------------------- -->
<div>

    <!-- Add Overlay + Map Info -->
    <div class="top-bar">
        <button id="addBtn" class="editor-button">+ Add Overlay</button>

        <div class="map-info-box">
            <span id="currentMap"></span>
        </div>
    </div>

    <!-- Overlay list -->
    <div id="list" class="list-box"></div>
</div>


<!-- ---------------------------------------------------------
     RIGHT COLUMN — EDITOR PANEL
---------------------------------------------------------- -->
<div class="newfield">

    <h3 id="title">Add or select an overlay to edit</h3>

    <div id="editorUI">

        <!-- FILENAME ROW -->
        <div class="editor-row">
            <label class="editor-label">Filename</label>
            <input id="filename" class="editor-input" type="text">
            <button id="filePickBtn" class="editor-button">Choose File…</button>
        </div>

        <!-- MAP X -->
        <div class="editor-row">
            <label class="editor-label">Map X</label>
            <input id="mapX" class="editor-input" type="number">
        </div>

        <!-- MAP Y -->
        <div class="editor-row">
            <label class="editor-label">Map Y</label>
            <input id="mapY" class="editor-input" type="number">
        </div>

        <!-- ALPHA -->
        <div class="editor-row">
            <label class="editor-label">Alpha</label>
            <input id="alpha" class="editor-input" type="number" step="0.01" min="0" max="1">
        </div>

        <!-- THRESHOLD Y -->
        <div class="editor-row">
            <label class="editor-label">Threshold Y</label>
            <input id="thresholdY" class="editor-input" type="number">
            <button id="captureYBtn" class="editor-button">Capture Player Y</button>
        </div>

        <!-- Z OFFSET -->
        <div class="editor-row">
            <label class="editor-label">Z Offset</label>
            <input id="zOffset" class="editor-input" type="number">
        </div>

    </div>

    <!-- SAVE + RELOAD -->
    <div class="editor-actions">
        <button id="saveJson">Save to JSON</button>
        <button id="reload">Rescue Current Data In-Game Reload</button>
    </div>

</div>

</div> <!-- end container -->


<!-- ---------------------------------------------------------
     SCRIPT BLOCK
------------------------------------------------------------->
<script>
/* ============================================================================
   1. GLOBAL STATE
   ========================================================================== */
let overlays = [];
let selected  = -1;


/* ============================================================================
   2. MESSAGE HANDLER (incoming data from the game)
   ========================================================================== */
window.addEventListener("message", e => {
    if (e.data.type !== "DD_OVERLAY_LIST") return;

    overlays = e.data.overlays;

    // Update map info text
    document.getElementById("currentMap").textContent =
        "You are currently working on: MAP" +
        String(e.data.mapId).padStart(3, "0") +
        " (" + e.data.mapName + ")";

    fillList();

    // If map changed or editor reset
    if (e.data.resetSelection) {
        selected = -1;
        setEditorEnabled(false);
        document.getElementById("title").textContent =
            "Add or select an overlay to edit";
        return;
    }

    // Refresh current selection when overlay list updates
    if (selected >= 0) {
        select(selected);
    } else {
        setEditorEnabled(false);
    }
});


/* ============================================================================
   3. INITIAL REQUEST FOR DATA
   ========================================================================== */
window.opener.postMessage({ type:"DD_GET_OVERLAYS" }, "*");
setEditorEnabled(false);


/* ============================================================================
   4. UI RENDERING FUNCTIONS
   ========================================================================== */

/* --- Render overlay list (left panel) --- */
function fillList() {
    const ul = document.getElementById("list");
    ul.innerHTML = "";

    overlays.forEach((ov, i) => {
        const div = document.createElement("div");
        div.className = "list-entry";

        const s = document.createElement("span");
        s.textContent = ov.filename || "(none)";

        const eBtn = document.createElement("button");
        eBtn.textContent = "Edit";
        eBtn.onclick = () => select(i);

        const vBtn = document.createElement("button");
        vBtn.textContent = ov.visible === false ? "Show" : "Hide";
        vBtn.onclick = () => {
            const newVisible = !ov.visible;
            ov.visible = newVisible;

            window.opener.postMessage(
                { type:"DD_UPDATE_OVERLAY", index:i, key:"visible", value:newVisible },
                "*"
            );

            vBtn.textContent = newVisible ? "Hide" : "Show";
        };

        const dBtn = document.createElement("button");
        dBtn.textContent = "Delete";
        dBtn.onclick = () =>
            window.opener.postMessage({ type:"DD_DELETE_OVERLAY", index:i }, "*");

        div.appendChild(s);
        div.appendChild(eBtn);
        div.appendChild(vBtn);
        div.appendChild(dBtn);
        ul.appendChild(div);
    });
}


/* --- Select an overlay for editing --- */
function select(i) {
    selected = i;
    setEditorEnabled(true);

    const o = overlays[i];

    document.getElementById("title").textContent =
        "Editing: " + (o.filename || "(none)");

    document.getElementById("filename").value    = o.filename;
    document.getElementById("mapX").value        = o.mapX;
    document.getElementById("mapY").value        = o.mapY;
    document.getElementById("alpha").value       = o.alpha;
    document.getElementById("thresholdY").value  = o.thresholdY;
    document.getElementById("zOffset").value     = o.zOffset;
}


/* ============================================================================
   5. UI UTILITY FUNCTIONS
   ========================================================================== */

/* --- Enable/disable all editor inputs --- */
function setEditorEnabled(enabled) {
    const ui = document.getElementById("editorUI");
    const inputs = ui.querySelectorAll("input, button");

    inputs.forEach(el => {
        el.disabled = !enabled;
        el.style.opacity = enabled ? "1.0" : "0.5";
    });
}


/* ============================================================================
   6. INPUT FIELD LIVE-UPDATE EVENTS
   ========================================================================== */

["filename","mapX","mapY","alpha","thresholdY","zOffset"].forEach(id => {
    document.getElementById(id).oninput = e => {
        if (selected < 0) return;

        const val =
            id === "filename" ? e.target.value : Number(e.target.value);

        window.opener.postMessage(
            { type:"DD_UPDATE_OVERLAY", index:selected, key:id, value:val },
            "*"
        );
    };
});


/* ============================================================================
   7. BUTTON EVENTS
   ========================================================================== */

/* --- Choose File… picker (parallax PNG only) --- */
document.getElementById("filePickBtn").onclick = () => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".png";
    picker.nwworkingdir = "img/parallaxes";

    picker.onchange = () => {
        if (!picker.value) return;

        const file = picker.value
            .split(/(\\\\|\\/)/g).pop()
            .replace(/\.png$/i, "");

        if (selected >= 0) {
            window.opener.postMessage(
                { type:"DD_UPDATE_OVERLAY", index:selected, key:"filename", value:file },
                "*"
            );
        }

        document.getElementById("filename").value = file;
    };

    picker.click();
};


/* --- Add new overlay --- */
document.getElementById("addBtn").onclick = () => {
    window.opener.postMessage({ type:"DD_ADD_OVERLAY" }, "*");

    // Select newly added overlay (delayed because game modifies array first)
    setTimeout(() => {
        const index = overlays.length - 1;
        if (index >= 0) select(index);
    }, 100);
};


/* --- Save JSON --- */
document.getElementById("saveJson").onclick = () =>
    window.opener.postMessage({ type:"DD_SAVE_JSON" }, "*");


/* --- Reload overlays in-game --- */
document.getElementById("reload").onclick = () =>
    window.opener.postMessage({ type:"DD_RELOAD" }, "*");


/* --- Capture player Y --- */
document.getElementById("captureYBtn").onclick = () => {
    if (selected < 0) return;

    window.opener.postMessage(
        { type:"DD_CAPTURE_PLAYER_Y", index:selected },
        "*"
    );
};
</script>
</body></html>
`;
};

/* ============================================================================
   1. MESSAGE ROUTER (receives commands from popup)
   ========================================================================== */

window.addEventListener("message", e => {
    const m = e.data;
    if (!m || !m.type) return;

    switch (m.type) {

        case "DD_GET_OVERLAYS":
            ED.sendList();
            break;

        case "DD_UPDATE_OVERLAY":
            ED.update(m.index, m.key, m.value);
            break;

        case "DD_ADD_OVERLAY":
            ED.add();
            break;

        case "DD_DELETE_OVERLAY":
            ED.remove(m.index);
            break;

        case "DD_SAVE_JSON":
            ED.rpc_saveJson();
            break;

        case "DD_RELOAD":
            ED.reload();
            break;

        case "DD_CAPTURE_PLAYER_Y":
            ED.capturePlayerY(m.index);
            break;
    }
});


/* ============================================================================
   2. EDITOR ACTION IMPLEMENTATIONS
   ========================================================================== */

/* Send overlay list to popup */
ED.sendList = function(resetSelection = false) {
    if (!this.editorWindow) return;

    const id  = String($gameMap.mapId());
    const arr = DD_Core.MapData[id] || [];

    this.editorWindow.window.postMessage({
        type:  "DD_OVERLAY_LIST",
        overlays: JSON.parse(JSON.stringify(arr)),
        mapId: id,
        mapName: $dataMap.displayName || "Unnamed Map",
        resetSelection: resetSelection
    }, "*");
};


/* Update specific overlay field */
ED.update = function(i, key, value) {
    const id  = String($gameMap.mapId());
    const arr = DD_Core.MapData[id];
    if (!arr) return;

    arr[i][key] = value;

    // Re-render editor popup + in-game sprites immediately
    this.sendList();
    this.reload();
    this.sendList();
};


/* Add new overlay */
ED.add = function() {
    const id = String($gameMap.mapId());
    if (!DD_Core.MapData[id]) DD_Core.MapData[id] = [];

    DD_Core.MapData[id].push({
        filename: "",
        mapX: 0,
        mapY: 0,
        alpha: 1,
        thresholdY: 0,
        zOffset: 0,
        visible: true
    });

    this.reload();
    this.sendList();
};


/* Remove overlay */
ED.remove = function(i) {
    const id  = String($gameMap.mapId());
    const arr = DD_Core.MapData[id];
    if (!arr) return;

    arr.splice(i, 1);

    this.reload();
    this.sendList();
};


/* Trigger JSON save */
ED.rpc_saveJson = function() {
    DD_Editor.saveJson();
};


/* Rebuild runtime spriteset to apply changes */
ED.reload = function() {
    const ss = SceneManager._scene?._spriteset;
    if (!ss) return;

    ss.ddLoadMapData();

    ss._ddSprites.forEach(s => s.parent.removeChild(s));
    ss._ddSprites = [];

    ss.ddCreateSprites();
};


/* Capture player's Y-position as thresholdY */
ED.capturePlayerY = function(i) {
    const ss = SceneManager._scene?._spriteset;
    if (!ss) return;

    const arr = DD_Core.MapData[String($gameMap.mapId())];
    if (!arr) return;

    const th = $gameMap.tileHeight();

    // Player bottom-pixel Y value
    const rawY = ($gamePlayer._realY + $gamePlayer.height()) * th;
    const bottomY = Math.ceil(rawY);

    arr[i].thresholdY = bottomY;

    this.reload();
    this.sendList();
};


/* ============================================================================
   3. AUTO-REFRESH EDITOR ON MAP TRANSFER
   ========================================================================== */

const _DD_transfer = Game_Player.prototype.performTransfer;
Game_Player.prototype.performTransfer = function() {
    const was = this.isTransferring();
    _DD_transfer.call(this);

    if (was) {
        // Delay ensures Spriteset_Map has actually rebuilt
        setTimeout(() => {
            DD_Editor.onMapChanged();
        }, 20);
    }
};


/* ============================================================================
   4. MAP-CHANGE HANDLER (notify popup)
   ========================================================================== */

DD_Editor.onMapChanged = function() {
    const id = String($gameMap.mapId());

    if (!DD_Core.MapData[id]) DD_Core.MapData[id] = [];

    if (this.editorWindow && !this.editorWindow.closed) {
        this.editorWindow.window.postMessage({
            type: "DD_OVERLAY_LIST",
            overlays: JSON.parse(JSON.stringify(DD_Core.MapData[id])),
            resetSelection: true,
            mapId: id,
            mapName: $dataMap.displayName || "Unnamed Map"
        }, "*");
    }
};
} // end editor mode

/* ============================================================================
   PHASE 6 — WINDOWS BUILD + BROWSER BUILD SUPPORT
   ============================================================================
 *  WINDOWS BUILD MODE (Desktop NW.js Export)
 *  - No editor
 *  - Read-only JSON load (via fetch)
 *  - Rebuild overlays when entering maps or transferring
 * ============================================================================ */
if (DD_Env.mode === "windowsBuild") {

    console.log("DynamicDepthEx: Windows build mode active — read-only.");

    const DD_WindowsBuild = {

        async init() {
            console.log("DD_WindowsBuild: Init");

            // If somehow not in NW.js, abort
            if (!DD_Env.isNwjs || DD_Env.isTest) {
                console.warn("DD_WindowsBuild: Wrong environment — skipped.");
                return;
            }

            await this._loadJson();
            this._injectSceneMapStartHook();
            this._injectMapTransferHook();
        },

        /* ----------------------------------------------------------
         * Load JSON via fetch
         * ---------------------------------------------------------- */
        async _loadJson() {
            try {
                const resp = await fetch("data/DynamicDepthMaps.json");
                if (resp.ok) {
                    DD_Core.MapData = await resp.json();
                } else {
                    console.warn("DD_WindowsBuild: JSON not found");
                    DD_Core.MapData = {};
                }
            } catch (e) {
                console.error("DD_WindowsBuild: Failed to load JSON", e);
                DD_Core.MapData = {};
            }
        },

        /* ----------------------------------------------------------
         * On map start — rebuild overlays AFTER spriteset exists
         * ---------------------------------------------------------- */
        _injectSceneMapStartHook() {
            const alias = Scene_Map.prototype.start;
            Scene_Map.prototype.start = function() {
                alias.call(this);
                setTimeout(() => {
                    const ss = this._spriteset;
                    if (!ss) return;
                    ss.ddLoadMapData();
                    ss._ddSprites.forEach(s => s.parent.removeChild(s));
                    ss._ddSprites = [];
                    ss.ddCreateSprites();
                }, 1);
            };
        },

        /* ----------------------------------------------------------
         * Map Transfer — refresh overlays after transfer completes
         * ---------------------------------------------------------- */
        _injectMapTransferHook() {
            const alias = Game_Player.prototype.performTransfer;

            Game_Player.prototype.performTransfer = function() {
                const was = this.isTransferring();
                alias.call(this);

                if (was) {
                    setTimeout(() => {
                        const ss = SceneManager._scene?._spriteset;
                        if (!ss) return;
                        ss.ddLoadMapData();
                        ss._ddSprites.forEach(s => s.parent.removeChild(s));
                        ss._ddSprites = [];
                        ss.ddCreateSprites();
                    }, 20);
                }
            };
        }
    };

    DD_WindowsBuild.init();
}

/* ============================================================================
 *  PHASE 6 — BROWSER MODE (HTML5 / Mobile)
 *  Read-only JSON load, no editor, refresh overlays on map enter / transfer
 * ============================================================================ */
else if (DD_Env.mode === "browser") {

    console.log("DynamicDepthEx: Browser mode active — read-only overlays.");

    const DD_BrowserBuild = {

        init() {
            console.log("DD_BrowserBuild: Init");

            // If somehow running inside NW.js, abort
            if (DD_Env.isNwjs) {
                console.warn("DD_BrowserBuild: Wrong environment — skipped.");
                return;
            }

            this._loadJson();
            this._injectSceneMapStartHook();
            this._injectMapTransferHook();
        },

        /* ----------------------------------------------------------
         * Load JSON via fetch (browser-safe)
         * ---------------------------------------------------------- */
        async _loadJson() {
            try {
                const resp = await fetch("data/DynamicDepthMaps.json");
                if (resp.ok) {
                    DD_Core.MapData = await resp.json();
                } else {
                    console.warn("DD_BrowserBuild: DynamicDepthMaps.json not found");
                    DD_Core.MapData = {};
                }
            } catch (e) {
                console.error("DD_BrowserBuild: Failed to load JSON", e);
                DD_Core.MapData = {};
            }
        },

        /* ----------------------------------------------------------
         * On map start — refresh overlays AFTER spriteset exists
         * ---------------------------------------------------------- */
        _injectSceneMapStartHook() {
            const alias = Scene_Map.prototype.start;
            Scene_Map.prototype.start = function() {
                alias.call(this);

                // Delay ensures Spriteset_Map has built itself
                setTimeout(() => {
                    const ss = this._spriteset;
                    if (!ss) return;

                    ss.ddLoadMapData();

                    ss._ddSprites.forEach(s => s.parent.removeChild(s));
                    ss._ddSprites = [];

                    ss.ddCreateSprites();
                }, 1);
            };
        },

        /* ----------------------------------------------------------
         * Map transfer — refresh overlays after transfer completes
         * ---------------------------------------------------------- */
        _injectMapTransferHook() {
            const alias = Game_Player.prototype.performTransfer;

            Game_Player.prototype.performTransfer = function() {
                const was = this.isTransferring();
                alias.call(this);

                if (was) {
                    setTimeout(() => {
                        const ss = SceneManager._scene?._spriteset;
                        if (!ss) return;

                        ss.ddLoadMapData();

                        ss._ddSprites.forEach(s => s.parent.removeChild(s));
                        ss._ddSprites = [];

                        ss.ddCreateSprites();
                    }, 20);
                }
            };
        }
    };

    DD_BrowserBuild.init();
}

console.log("DynamicDepthEx loaded.");

})();
