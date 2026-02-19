/*:
 * @target MZ
 * @plugindesc Bounding Box Maps EX — Per-map collider editor (DotMoveSystem) v1.0.0
 * @author RPG Dream Maker
 *
 * @help
 * ============================================================================
 *   DotMoveSystem_BoundingBoxMapsEx.js
 *   Per-map bounding box editor with live DotMoveSystem integration
 *   (Ctrl + Shift + B to open editor)
 *
 *   • Stores collider size/offset for:
 *        - Player
 *        - Followers (3)
 *        - Events (per-map, dynamic)
 *
 *   • Writes to:
 *         data/BoundingBoxMaps.json
 *
 *   • Editor available ONLY in NW.js Play Test
 *   • Uses DotMoveSystem's collisionRect() as the canonical source
 *   • Collider debug overlay identical to CollisionMapEx style
 *
 * ============================================================================
 */

(() => {
"use strict";

// ============================================================================
// 0. Namespaces
// ============================================================================
const BBM_Env          = {};   // environment detector (3 modes)
const BBM_Core         = {};   // shared runtime logic
const BBM_EditorMode   = {};   // live editor (NW.js test only)
const BBM_DebugOverlay = {};   // collider rectangles overlay
const BBM_WindowsBuild = {};   // NW.js export / Windows build
const BBM_BrowserBuild = {};   // Browser / HTML5 build

// JSON runtime memory store
let BBM_Data = {};             // loaded from BoundingBoxMaps.json
// Overlay visibility control
let BBM_OverlayEnabled = false;

// ============================================================================
// 1. Environment Detector
// ============================================================================
(() => {
    const isNwjs = Utils.isNwjs();
    const isTest = Utils.isOptionValid("test");

    let mode = "browser";
    if (isNwjs && isTest) mode = "editorTest";
    else if (isNwjs)      mode = "windowsBuild";

    BBM_Env.isNwjs = isNwjs;
    BBM_Env.isTest = isTest;
    BBM_Env.mode   = mode;

    console.log("BBM: Runtime Mode =", mode);
})();

// ============================================================================
// 2. BBM_Core — Shared Runtime Logic (all modes)
// ============================================================================
BBM_Core.JSON_PATH = "data/BoundingBoxMaps.json";

// Utility: deep clone
BBM_Core.clone = obj => JSON.parse(JSON.stringify(obj));

/**
 * Default collider data for any character
 */
BBM_Core.defaultCollider = () => ({
    width: 1.00,
    height: 1.00,
    offsetX: 0.00,
    offsetY: 0.00,
});

/**
 * Load JSON (in editor mode via FS, in other modes via fetch)
 */
BBM_Core.loadJson = async function() {
    if (BBM_Env.mode === "editorTest") {
        try {
            const fs   = require("fs");
            const path = require("path");
            const full = path.join(process.cwd(), BBM_Core.JSON_PATH);

            if (!fs.existsSync(full)) {
                fs.writeFileSync(full, JSON.stringify({}, null, 2));
            }

            const raw = fs.readFileSync(full, "utf8");
            BBM_Data = JSON.parse(raw);

        } catch (e) {
            console.error("BBM_Core: Failed to load JSON (editor)", e);
            BBM_Data = {};
        }
    }
    else {
        try {
            const resp = await fetch(BBM_Core.JSON_PATH);
            if (resp.ok) {
                BBM_Data = await resp.json();
            } else {
                console.warn("BBM_Core: JSON not found, creating empty");
                BBM_Data = {};
            }
        } catch(e) {
            console.error("BBM_Core: Failed to load JSON (browser/windows)", e);
            BBM_Data = {};
        }
    }
};

/**
 * Save JSON — editor mode only
 */
BBM_Core.saveJson = function() {
    if (BBM_Env.mode !== "editorTest") return;

    try {
        const fs   = require("fs");
        const path = require("path");
        const full = path.join(process.cwd(), BBM_Core.JSON_PATH);
        fs.writeFileSync(full, JSON.stringify(BBM_Data, null, 2));
    } catch (e) {
        console.error("BBM_Core: Failed to save JSON", e);
    }
};

/**
 * Ensure map entry exists and auto-generate missing structures.
 */
BBM_Core.ensureMapEntry = function(mapId) {
    const id = String(mapId);

    if (!BBM_Data[id]) {
        BBM_Data[id] = {};
    }
    const m = BBM_Data[id];

    // Player
    if (!m.player) m.player = BBM_Core.defaultCollider();

    // Followers (exactly 3 entries)
    if (!Array.isArray(m.followers)) m.followers = [];
    while (m.followers.length < 3) {
        m.followers.push(BBM_Core.defaultCollider());
    }

    // Events
    if (!m.events) m.events = {};
    const ev = m.events;

    // Scan map events dynamically
    $gameMap.events().forEach(e => {
        const eid = String(e.eventId());
        if (!ev[eid]) ev[eid] = BBM_Core.defaultCollider();
    });
};

/**
 * Apply colliders to all characters on current map.
 */
BBM_Core.applyAllColliders = function() {
    const id = String($gameMap.mapId());
    if (!BBM_Data[id]) return;

    const mapData = BBM_Data[id];

    // PLAYER
    BBM_Core.applyToCharacter($gamePlayer, mapData.player);

    // FOLLOWERS
    const fl = $gamePlayer.followers().visibleFollowers();
    for (let i = 0; i < fl.length; i++) {
        if (mapData.followers[i]) {
            BBM_Core.applyToCharacter(fl[i], mapData.followers[i]);
        }
    }

    // EVENTS
    const ev = $gameMap.events();
    ev.forEach(event => {
        const eid = String(event.eventId());
        if (mapData.events[eid]) {
            BBM_Core.applyToCharacter(event, mapData.events[eid]);
        }
    });
};

/**
 * Apply collider size/offset to a specific character.
 */
BBM_Core.applyToCharacter = function(char, data) {
    if (!char || !data) return;

    // These 4 properties are recognized by DotMoveSystem
    char._width   = Number(data.width);
    char._height  = Number(data.height);
    char._offsetX = Number(data.offsetX);
    char._offsetY = Number(data.offsetY);
};

/**
 * Install map-transfer & map-start hooks to reapply colliders.
 */
BBM_Core.installHooks = function() {

    // --- Scene_Map start ---
    const _SceneMap_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        _SceneMap_start.call(this);

        const id = $gameMap.mapId();
        BBM_Core.ensureMapEntry(id);
        BBM_Core.applyAllColliders();
    };

    // --- Map Transfer ---
    const _GamePlayer_transfer = Game_Player.prototype.performTransfer;
    Game_Player.prototype.performTransfer = function() {
        const was = this.isTransferring();
        _GamePlayer_transfer.call(this);

        if (was) {
            setTimeout(() => {
                const id = $gameMap.mapId();
                BBM_Core.ensureMapEntry(id);
                BBM_Core.applyAllColliders();

                // Inform editor (if open)
                if (BBM_EditorMode.onMapChanged) {
                    BBM_EditorMode.onMapChanged();
                }
            }, 20);
        }
    };
};

// ============================================================================
// 3. BBM_EditorMode — Live Editor (NW.js Test Mode Only)
// ============================================================================
BBM_EditorMode.fs = null;
BBM_EditorMode.path = null;
BBM_EditorMode.jsonPath = null;
BBM_EditorMode.editorWindow = null;

BBM_EditorMode.init = function() {
    if (BBM_Env.mode !== "editorTest") return;

    console.log("BBM_EditorMode: Init");

    this.fs   = require("fs");
    this.path = require("path");
    this.jsonPath = this.path.join(process.cwd(), BBM_Core.JSON_PATH);

    // Hotkey for editor
    this._setupHotkey();

    // Popup message listener
    this._setupMessageListener();
};

/**
 * Ctrl + Shift + B to toggle editor
 */
BBM_EditorMode._setupHotkey = function() {
document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.shiftKey && e.code === "KeyB") {
        e.preventDefault();

        // Only open on Scene_Map
        const scene = SceneManager._scene;
        if (!scene || !(scene instanceof Scene_Map)) {
            console.warn("BBM Editor: Can only be opened on Scene_Map.");
            return;
        }

        this.toggleEditor();
    }
});
};

/**
 * Toggle popup window
 */
BBM_EditorMode.toggleEditor = function() {

    // Only allow editor on Scene_Map
    const scene = SceneManager._scene;
    if (!scene || !(scene instanceof Scene_Map)) {
        console.warn("BBM Editor: Can only be opened on Scene_Map.");
        return;
    }

    if (this.editorWindow && !this.editorWindow.closed) {
        this.editorWindow.close();
        this.editorWindow = null;
        BBM_OverlayEnabled = false;
        BBM_DebugOverlay.remove();
        return;
    }

    this.openEditor();
};

/**
 * Open popup editor
 */
BBM_EditorMode.openEditor = function() {
	
	// Only allow editor on Scene_Map
    const scene = SceneManager._scene;
    if (!scene || !(scene instanceof Scene_Map)) {
        console.warn("BBM Editor: Can only be opened on Scene_Map.");
        return;
    }
	
    const html = this._buildPopupHtml();
    const url  = "data:text/html," + encodeURIComponent(html);

	nw.Window.open(url, { width: 960, height: 600, resizable: false }, win => {
		this.editorWindow = win;

		win.on("closed", () => {
			this.editorWindow = null;

			// FINAL FIX: clean up overlay when window is manually closed
			BBM_OverlayEnabled = false;
			BBM_DebugOverlay.remove();
		});

		BBM_OverlayEnabled = true;

		setTimeout(() => {
			this.sendList();
			BBM_DebugOverlay.refresh();
		}, 80);
	});
};

/**
 * Build HTML editor UI
 */
BBM_EditorMode._buildPopupHtml = function() {
return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>BoundingBox Map Editor</title>

<style>
body {
    background: #222;
    color: #eee;
    font-family: system-ui, sans-serif;
    margin: 0;
    padding: 16px;
}
h2 {
    margin-top: 0;
}
#mapInfo {
    margin-bottom: 12px;
}
.container {
    display: grid;
    grid-template-columns: 350px 1fr;
    gap: 16px;
}
.list-box {
    background: #333;
    padding: 10px;
    border-radius: 6px;
    max-height: 440px;
    overflow-y: auto;
}
.list-entry {
    background: #444;
    margin-bottom: 8px;
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
}
.list-entry:hover {
    background: #555;
}
.selected {
    outline: 2px solid #66aaff;
}
.editor-box {
    background: #333;
    padding: 12px;
    border-radius: 6px;
}
.row {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
    gap: 10px;
}
label {
    width: 90px;
}
input[type="number"] {
    width: 120px;
    padding: 4px;
    background: #222;
    color: #eee;
    border: 1px solid #555;
    border-radius: 4px;
}
button {
    padding: 6px 12px;
    margin-right: 10px;
}
</style>

</head>
<body>

<h2>Bounding Box Editor</h2>

<div id="mapInfo"></div>

<div class="container">
    <!-- LEFT: list of characters -->
    <div class="list-box" id="list"></div>

    <!-- RIGHT: editor panel -->
    <div class="editor-box">
        <h3 id="title">Select an item to edit</h3>

        <div id="editorUI">
            <div class="row">
                <label>Width</label>
                <input type="number" id="width" step="0.01">
            </div>

            <div class="row">
                <label>Height</label>
                <input type="number" id="height" step="0.01">
            </div>

            <div class="row">
                <label>Offset X</label>
                <input type="number" id="offsetX" step="0.01">
            </div>

            <div class="row">
                <label>Offset Y</label>
                <input type="number" id="offsetY" step="0.01">
            </div>

            <div class="row">
                <button id="saveJson">Save JSON</button>
                <button id="reload">Reload From JSON</button>
            </div>
        </div>
    </div>
</div>

<script>
let items = [];      // editor list (player + followers + events)
let selected = -1;   // selected index
let mapId = null;

// Build left list
function fillList() {
    const box = document.getElementById("list");
    box.innerHTML = "";

    items.forEach((it, i) => {
        const div = document.createElement("div");
        div.className = "list-entry";
        if (i === selected) div.classList.add("selected");
        div.textContent = it.label;
        div.onclick = () => select(i);
        box.appendChild(div);
    });
}

function select(i) {
    selected = i;
    fillList();

    const it = items[i];
    if (!it) return;

    document.getElementById("title").textContent = "Editing: " + it.label;

    document.getElementById("width").value   = it.data.width;
    document.getElementById("height").value  = it.data.height;
    document.getElementById("offsetX").value = it.data.offsetX;
    document.getElementById("offsetY").value = it.data.offsetY;

    enableEditor(true);
}

function enableEditor(ok) {
    const ui = document.getElementById("editorUI");
    const inputs = ui.querySelectorAll("input,button");
    inputs.forEach(i => i.disabled = !ok);
}

// Input → send live update
["width","height","offsetX","offsetY"].forEach(id => {
    document.getElementById(id).oninput = e => {
        if (selected < 0) return;

        const val = Number(e.target.value);
        window.opener.postMessage({
            type: "BBM_UPDATE",
            index: selected,
            key: id,
            value: val
        }, "*");
    };
});

// Save JSON
document.getElementById("saveJson").onclick = () =>
    window.opener.postMessage({ type:"BBM_SAVE_JSON" }, "*");

// Reload JSON
document.getElementById("reload").onclick = () =>
    window.opener.postMessage({ type:"BBM_RELOAD" }, "*");

// Receive list from game
window.addEventListener("message", e => {
    if (e.data.type === "BBM_LIST") {
        mapId  = e.data.mapId;
        items  = e.data.items;
        selected = -1;
        document.getElementById("mapInfo").textContent =
            "Map " + mapId + " — " + e.data.mapName;
        enableEditor(false);
        fillList();
    }
});

// Request list on startup
window.opener.postMessage({ type:"BBM_GET_LIST" }, "*");

</script>
</body>
</html>
`;
};

/**
 * Message listener from popup → game
 */
BBM_EditorMode._setupMessageListener = function() {
    window.addEventListener("message", e => {
        const msg = e.data;
        if (!msg) return;

        switch (msg.type) {

            case "BBM_GET_LIST":
                this.sendList();
                break;

            case "BBM_UPDATE":
                this.liveUpdate(msg.index, msg.key, msg.value);
                break;

            case "BBM_SAVE_JSON":
                BBM_Core.saveJson();
                break;

            case "BBM_RELOAD":
                this.reload();
                break;
        }
    });
};

/**
 * Build list of editable entries (player, followers, events)
 */
BBM_EditorMode.buildItems = function() {
    const id = String($gameMap.mapId());
    const data = BBM_Data[id];
    if (!data) return [];

    const items = [];

    // Player
    items.push({
        label: "Player",
        type: "player",
        id: null,
        data: BBM_Core.clone(data.player)
    });

    // Followers
    if (Array.isArray(data.followers)) {
        data.followers.forEach((f, i) => {
            items.push({
                label: "Follower " + (i+1),
                type: "follower",
                idx: i,
                data: BBM_Core.clone(f)
            });
        });
    }

    // Events
    const ev = data.events || {};
    $gameMap.events().forEach(evObj => {
        const eid = String(evObj.eventId());
        const name = evObj.event().name || "";
        const label = `${eid} — ${name}`;
        items.push({
            label,
            type: "event",
            id: eid,
            data: BBM_Core.clone(ev[eid])
        });
    });

    return items;
};

/**
 * Send list to popup
 */
BBM_EditorMode.sendList = function() {
    if (!this.editorWindow) return;

    const id = String($gameMap.mapId());
    const items = this.buildItems();

    this.editorWindow.window.postMessage({
        type: "BBM_LIST",
        mapId: id,
        mapName: $dataMapInfos[id] ? $dataMapInfos[id].name : "(Unknown)",
        items
    }, "*");
};

/**
 * Popup made a live update
 */
BBM_EditorMode.liveUpdate = function(index, key, value) {
    const id = String($gameMap.mapId());
    const data = BBM_Data[id];
    if (!data) return;

    const items = this.buildItems();
    const it = items[index];
    if (!it) return;

    // Apply to JSON memory
    if (it.type === "player") {
        data.player[key] = value;
    }
    else if (it.type === "follower") {
        data.followers[it.idx][key] = value;
    }
    else if (it.type === "event") {
        data.events[it.id][key] = value;
    }

    // LIVE apply to game
    BBM_Core.applyAllColliders();

    // LIVE update overlay
    BBM_DebugOverlay.refresh();

    // ❌ DO NOT SEND LIST → it breaks selection
    // this.sendList();  <-- remove this line
};

/**
 * Reload JSON from file
 */
BBM_EditorMode.reload = function() {
    BBM_Core.loadJson().then(() => {
        const id = $gameMap.mapId();
        BBM_Core.ensureMapEntry(id);
        BBM_Core.applyAllColliders();
        BBM_DebugOverlay.refresh();
        this.sendList();
    });
};

/**
 * Called when map changes
 */
BBM_EditorMode.onMapChanged = function() {
    if (!this.editorWindow) return;
    this.sendList();
	BBM_DebugOverlay.refresh(); // <--- FIX: recreate overlay after map load
};

// ============================================================================
// 4. BBM_DebugOverlay — CollisionMapEx-style collider rectangles
// ============================================================================
BBM_DebugOverlay.colliderLayer = null;

/**
 * Remove collider layer
 */
BBM_DebugOverlay.remove = function() {
    if (this.colliderLayer && this.colliderLayer.parent) {
        this.colliderLayer.parent.removeChild(this.colliderLayer);
    }
    this.colliderLayer = null;
};

/**
 * Create collider layer
 */
BBM_DebugOverlay.create = function() {
    const scene = SceneManager._scene;
    if (!(scene instanceof Scene_Map)) return;

    const ss = scene._spriteset;
    if (!ss) return;
    if (!ss._tilemap) return; // <-- IMPORTANT FIX

    if (!this.colliderLayer) {
        this.colliderLayer = new PIXI.Graphics();
        this.colliderLayer.zIndex = 999999;
        ss._tilemap.addChild(this.colliderLayer);
    }
};

/**
 * Refresh overlay completely (remove + recreate)
 */
BBM_DebugOverlay.refresh = function() {
    this.remove();
    if (!BBM_Env.isTest || !BBM_Env.isNwjs) return; // editor only
    this.create();
    this.update();
};

/**
 * Draw a character collider rectangle in screen coords
 */
BBM_DebugOverlay._drawRect = function(g, rect, color) {
    if (!rect) return;

    const tw = $gameMap.tileWidth();
    const th = $gameMap.tileHeight();
    const ox = $gameMap.displayX() * tw;
    const oy = $gameMap.displayY() * th;

    g.lineStyle(2, color, 0.85);
    g.beginFill(color, 0.15);

    g.drawRect(
        rect.x * tw - ox,
        rect.y * th - oy,
        rect.width  * tw,
        rect.height * th
    );

    g.endFill();
};

/**
 * Update collider layer each frame (collisionRect updates on movement)
 */
BBM_DebugOverlay.update = function() {

    // Only active in editor mode
    if (!BBM_Env.isNwjs || !BBM_Env.isTest) return;

    // If the spriteset isn't ready, exit safely
    const scene = SceneManager._scene;
    if (!(scene instanceof Scene_Map)) return;
    const ss = scene._spriteset;
    if (!ss || !ss._tilemap) return;

    // If layer doesn't exist yet → try recreating it
    if (!this.colliderLayer || !this.colliderLayer.parent) {
        this.create();

        // If still no layer, bail out safely
        if (!this.colliderLayer || !this.colliderLayer.parent) {
            return;
        }
    }

    const g = this.colliderLayer;

    // PIXI sometimes clears before fully ready — double safety
    if (!g.clear) return;

    g.clear();

    const green  = 0x00ff00;
    const blue   = 0x00aaff;
    const purple = 0xff00ff;

    const tw = $gameMap.tileWidth();
    const th = $gameMap.tileHeight();
    const ox = $gameMap.displayX() * tw;
    const oy = $gameMap.displayY() * th;

    const draw = (rect, color) => {
        if (!rect) return;
        g.lineStyle(2, color, 0.85);
        g.beginFill(color, 0.15);
        g.drawRect(
            rect.x * tw - ox,
            rect.y * th - oy,
            rect.width  * tw,
            rect.height * th
        );
        g.endFill();
    };

    draw($gamePlayer.collisionRect(), green);

    $gamePlayer.followers().visibleFollowers().forEach(f =>
        draw(f.collisionRect(), blue)
    );

    $gameMap.events().forEach(ev =>
        draw(ev.collisionRect(), purple)
    );
};

/**
 * Scene_Map start hook for overlay animation
 */

const _BBM_SceneMap_start = Scene_Map.prototype.start;
Scene_Map.prototype.start = function() {
    _BBM_SceneMap_start.call(this);

    if (BBM_EditorMode.editorWindow) {
        BBM_DebugOverlay.refresh();
    }
};

/**
 * Scene_Map update hook for overlay animation
 */
(() => {
    const _BBM_SceneMap_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _BBM_SceneMap_update.call(this);
		if (BBM_Env.isNwjs && BBM_Env.isTest && BBM_OverlayEnabled) {
			BBM_DebugOverlay.update();
		}
    };
})();

// ============================================================================
// 5. BBM_WindowsBuild — Windows Desktop Build (No Editor)
// ============================================================================
BBM_WindowsBuild.init = function() {
    if (!BBM_Env.isNwjs || BBM_Env.isTest) {
        console.warn("BBM_WindowsBuild: Wrong environment — skipped.");
        return;
    }

    console.log("BBM_WindowsBuild: Init");
    this._loadJson();
    this._installHooks();
};

/**
 * Load JSON via fetch (read-only)
 */
BBM_WindowsBuild._loadJson = async function() {
    try {
        const resp = await fetch(BBM_Core.JSON_PATH);
        if (resp.ok) {
            BBM_Data = await resp.json();
        } else {
            console.warn("BBM_WindowsBuild: JSON not found");
            BBM_Data = {};
        }
    } catch (e) {
        console.error("BBM_WindowsBuild: Failed JSON load", e);
        BBM_Data = {};
    }
};

/**
 * Install hooks to apply colliders after map load/transfer
 */
BBM_WindowsBuild._installHooks = function() {

    // Scene_Map start
    const _SceneMap_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        _SceneMap_start.call(this);

        setTimeout(() => {
            const id = $gameMap.mapId();
            BBM_Core.ensureMapEntry(id);
            BBM_Core.applyAllColliders();
        }, 1);
    };

    // Map Transfer
    const _GamePlayer_trans = Game_Player.prototype.performTransfer;
    Game_Player.prototype.performTransfer = function() {
        const was = this.isTransferring();
        _GamePlayer_trans.call(this);

        if (was) {
            setTimeout(() => {
                const id = $gameMap.mapId();
                BBM_Core.ensureMapEntry(id);
                BBM_Core.applyAllColliders();
            }, 20);
        }
    };
};



// ============================================================================
// 6. BBM_BrowserBuild — HTML5 Browser Deployment (No Editor)
// ============================================================================
BBM_BrowserBuild.init = function() {
    if (BBM_Env.isNwjs) {
        console.warn("BBM_BrowserBuild: Wrong environment — skipped.");
        return;
    }

    console.log("BBM_BrowserBuild: Init");
    this._loadJson();
    this._installHooks();
};

/**
 * Load JSON via fetch
 */
BBM_BrowserBuild._loadJson = async function() {
    try {
        const resp = await fetch(BBM_Core.JSON_PATH);
        if (resp.ok) {
            BBM_Data = await resp.json();
        } else {
            console.warn("BBM_BrowserBuild: JSON not found");
            BBM_Data = {};
        }
    } catch (e) {
        console.error("BBM_BrowserBuild: Failed JSON load", e);
        BBM_Data = {};
    }
};

/**
 * Install hooks identical to WindowsBuild
 */
BBM_BrowserBuild._installHooks = function() {

    // Scene_Map start
    const _SceneMap_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        _SceneMap_start.call(this);

        setTimeout(() => {
            const id = $gameMap.mapId();
            BBM_Core.ensureMapEntry(id);
            BBM_Core.applyAllColliders();
        }, 1);
    };

    // Map Transfer
    const _GamePlayer_trans = Game_Player.prototype.performTransfer;
    Game_Player.prototype.performTransfer = function() {
        const was = this.isTransferring();
        _GamePlayer_trans.call(this);

        if (was) {
            setTimeout(() => {
                const id = $gameMap.mapId();
                BBM_Core.ensureMapEntry(id);
                BBM_Core.applyAllColliders();
            }, 20);
        }
    };
};

// ============================================================================
// 7. Main Entry Router — Initialize Correct Module
// ============================================================================
(async () => {

    // Always load JSON first (all modes)
    await BBM_Core.loadJson();

    // Install shared runtime hooks
    BBM_Core.installHooks();

    // Initialize mode-specific modules
    switch (BBM_Env.mode) {

        case "editorTest":
            BBM_EditorMode.init();
            break;

        case "windowsBuild":
            BBM_WindowsBuild.init();
            break;

        case "browser":
        default:
            BBM_BrowserBuild.init();
            break;
    }

    console.log("BoundingBoxMapsEx Loaded.");

})();
})();
