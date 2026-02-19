"use strict";
/*:
 * @target MZ
 * @plugindesc Dot movement system collision map extension v2.2.2
 * @author RPG Dream Maker
 * @url https://rpgdreammaker.itch.io/
 *
 * @help
 * ============================================================================
 *  ■ CollisionMapEx — Pixel-Perfect Collision System + Built-in Editor
 * ============================================================================
 * CollisionMapEx adds **pixel-perfect collisions** to RPG Maker MZ by reading
 * RED pixels from a PNG image assigned to each map.
 * 
 * This is a clean, modular rewrite of the original CollisionMapEx plugin.
 * Internal structure is now split into mode-specific components:
 *
 *   • CMEX_Core          — Shared collision engine + DotMoveSystem hook  
 *   • CMEX_EditorMode    — NW.js test-mode editor + PNG selector (Ctrl+Shift+C)  
 *   • CMEX_WindowsBuild  — Desktop exports (no editor)  
 *   • CMEX_BrowserBuild  — HTML5/Web exports (no editor)
 *
 * The plugin automatically detects the runtime:
 *
 *       editorTest   → NW.js Play Test (full editor enabled)
 *       windowsBuild → Exported desktop game
 *       browser      → Web/HTML5 deployment
 *
 * ============================================================================
 *  ■ How It Works
 * ============================================================================
 * 1. Place your collision PNGs in:
 *         img/parallaxes/
 *
 * 2. Mark solid areas using FULL RED pixels:
 *
 *        RED   = 255, 0, 0, 255   → solid / not passable  
 *        Other = any other color  → walkable  
 *
 * 3. During play-test (NW.js), press **Ctrl+Shift+C** to open the editor:
 *       • Select a PNG file for the current map  
 *       • Toggle “Pixel Overlay” (visualize red pixels)  
 *       • Toggle “Collider Debug” (player/events rectangles + labels)
 *
 * 4. The selected PNG filenames are saved in:
 *         data/CollisionMaps.json
 *
 * ============================================================================
 *  ■ DotMoveSystem Compatibility
 * ============================================================================
 * CollisionMapEx integrates directly into DotMoveSystem’s collision pipeline.
 *
 *   • A movement is blocked if its collision rectangle crosses a RED pixel.  
 *   • CollisionResult objects are injected cleanly into DotMoveSystem.  
 *   • Sliding, touch triggers, event collisions — all continue to work.  
 *
 * No setup required — simply place this plugin **below** DotMoveSystem:
 * DotMoveSystem
 * DotMoveSystem_FunctionEx
 * DotMoveSystem_DecideTriggerEx
 * DotMoveSystem_CollisionMapEx
 *
 * ============================================================================
 *  ■ Editor Controls (Play-Test Only)
 * ============================================================================
 *   • **Ctrl+Shift+C**  — Open/close the Collision Map Editor  
 *   • **Show Pixel Overlay**   — Display RED collision pixels  
 *   • **Show Collider Debug**  — Draw rectangles + facing indicators  
 *
 * The editor is only available in **NW.js test mode**.  
 * It does *not* run in exported games.
 *
 * ============================================================================
 *  ■ Notes
 * ============================================================================
 * • Your PNG must match the map’s pixel dimensions:
 *       width  = mapWidth  × tileWidth  
 *       height = mapHeight × tileHeight  
 *
 *   If the PNG is larger or smaller, the plugin still loads it —
 *   out-of-range pixels are treated as walkable.
 *
 * • This modular rewrite preserves the original timing:
 *       Collision overlays + debug layers refresh instantly  
 *       on map change, PNG assignment, and scene start.
 *
 * • The plugin is safe for:
 *       ✓ Desktop Test (full features)  
 *       ✓ Desktop Export (no editor, collisions only)  
 *       ✓ Browser Deployment (no editor, collisions only)
 *
 * ============================================================================
 *  End of Help
 * ============================================================================
 *
 * ============================================================================
 * ■ Commercial License — CollisionMapEx
 * Copyright (c) 2025 RPG Dream Maker
 * https://rpgdreammaker.itch.io/
 * ============================================================================
 *
 * This plugin is licensed. All rights are reserved by RPG Dream Maker.
 *
 * Permission is granted to the purchaser to integrate this plugin into any
 * number of RPG Maker MV/MZ game projects, whether commercial or non-commercial.
 *
 * Distribution of this plugin, in original or modified form, outside of
 * compiled/encrypted game builds is strictly prohibited.
 *
 * The purchaser MAY:
 *   • Use the plugin in unlimited RPG Maker projects.
 *   • Use the plugin in both free and commercial games.
 *   • Modify the plugin for personal project use only.
 *   • Distribute the plugin *only* as part of a finished game build.
 *
 * The purchaser MAY NOT:
 *   • Redistribute the plugin files publicly in any form.
 *   • Upload, post, share, or publish the plugin online.
 *   • Resell or sublicense the plugin.
 *   • Include any part of this plugin's code in another plugin
 *     meant for public release.
 *
 * Each purchase grants ONE user license.  
 * If a team has multiple developers using the plugin directly, each must own a
 * valid copy.
 *
 * Modifications are permitted for personal use, but derivative works may not be
 * distributed, published, or shared.
 *
 * All rights not expressly granted are reserved by RPG Dream Maker.
 *
 * By downloading, purchasing, or using this plugin, you agree to all terms
 * listed above.
 * ============================================================================
 */

// ============================================================================
//  STEP 1 — Environment Detector (From Previous Step)
// ============================================================================
const CMEX_Env = (() => {

    const isNwjs = Utils.isNwjs();
    const isTest = Utils.isOptionValid("test");

    let mode;

    if (isNwjs && isTest)        mode = "editorTest";
    else if (isNwjs)            mode = "windowsBuild";
    else                        mode = "browser";

    console.log("CMEX: Runtime Mode =", mode);

    return {
        isNwjs,
        isTest,
        mode  // "editorTest" | "windowsBuild" | "browser"
    };

})();

// ============================================================================
//  STEP 2 — Modular Plugin Structure (Skeleton)
// ============================================================================

/* --------------------------------------------------------------
 *  CMEX Core (Shared Collision Engine)
 *  Will contain:
 *    - PNG loading
 *    - Canvas extraction
 *    - Pixel scanning
 *    - blockerSet
 *    - rectOverlapsSolid
 *    - DotMoveSystem collision hook
 *    - Debug overlay (optional)
 * -------------------------------------------------------------- */
const CMEX_Core = {

    // Runtime storage for the loaded PNG and pixel data
    image: null,
    canvas: null,
    ctx: null,
    pixels: null,
    width: 0,
    height: 0,

    blockerSet: new Set(),   // movement blockers (RED + ORANGE)
    losBlockerSet: new Set(),// LOS blockers (RED only)  ← ADD THIS
    blockers: [],

    init() {
        console.log("CMEX_Core: Init");
        this._hookDotMoveSystem();
    },

    /* ----------------------------------------------------------
     *  Load collision PNG for the current map
     * ---------------------------------------------------------- */
    async loadCollisionPng(filename) {
        if (!filename) return;

        const src = `img/parallaxes/${filename}`;
        const img = await this._loadBitmap(src).catch(err => {
            console.error("CMEX_Core: Failed to load PNG:", src, err);
        });

        if (!img) return;

        this._createCanvas(img);
        this._scanPixels();
    },

    /* ----------------------------------------------------------
     *  Internal PNG loader
     * ---------------------------------------------------------- */
    _loadBitmap(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.src = src;
            img.onload = () => resolve(img);
            img.onerror = err => reject(err);
        });
    },

    /* ----------------------------------------------------------
     *  Draw PNG to an off-screen canvas
     * ---------------------------------------------------------- */
    _createCanvas(img) {
        this.image = img;
        this.width = img.width;
        this.height = img.height;

        this.canvas = document.createElement("canvas");
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.ctx = this.canvas.getContext("2d");
        this.ctx.drawImage(img, 0, 0);

        const data = this.ctx.getImageData(0, 0, this.width, this.height);
        this.pixels = data.data;
    },

    /* ----------------------------------------------------------
     *  Pixel Scanner (extract RED blockers and ORANGE Blockers)
     * ---------------------------------------------------------- */
_scanPixels() {
    this.blockers.length = 0;
    this.blockerSet.clear();
    this.losBlockerSet.clear(); // NEW

    if (!this.pixels) return;

    const w = this.width;
    const h = this.height;
    const img = this.pixels;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;

            const r = img[i];
            const g = img[i+1];
            const b = img[i+2];
            const a = img[i+3];

            if (a === 0) continue;

            // RED → collision + LOS
            if (r === 255 && g === 0 && b === 0) {
                this.blockers.push({ x, y });
                this.blockerSet.add(`${x},${y}`);
                this.losBlockerSet.add(`${x},${y}`); // NEW
            }

            // ORANGE (255,165,0) → collision only
            else if (r === 255 && g === 165 && b === 0) {
                this.blockers.push({ x, y });
                this.blockerSet.add(`${x},${y}`);
                // NO losBlockerSet for orange
            }
        }
    }

    console.log(
        `CMEX_Core: ${this.blockerSet.size} collision pixels, `
        + `${this.losBlockerSet.size} LOS-blockers found.`
    );
},

    /* ----------------------------------------------------------
     *  Collision Sampling (DotMove rectangle sampling)
     * ---------------------------------------------------------- */
    rectOverlapsSolid(px, py, pw, ph) {
        const step = 3;

        const x1 = px | 0;
        const y1 = py | 0;
        const x2 = (px + pw) | 0;
        const y2 = (py + ph) | 0;

        // Vertical edges
        for (let y = y1; y <= y2; y += step) {
            if (this.blockerSet.has(`${x1},${y}`)) return true;
            if (this.blockerSet.has(`${x2},${y}`)) return true;
        }

        // Horizontal edges
        for (let x = x1; x <= x2; x += step) {
            if (this.blockerSet.has(`${x},${y1}`)) return true;
            if (this.blockerSet.has(`${x},${y2}`)) return true;
        }

        return false;
    },

    /* ----------------------------------------------------------
     *  DotMoveSystem Hook
     * ---------------------------------------------------------- */
    _hookDotMoveSystem() {

        const DMS = window.DotMoveSystem;
        if (!DMS || !DMS.CharacterCollisionChecker) {
            console.warn("CMEX_Core: DotMoveSystem not found.");
            return;
        }

        const proto = DMS.CharacterCollisionChecker.prototype;
        if (proto.__cmex_hooked__) return;
        proto.__cmex_hooked__ = true;

        const _check = proto.checkCollisionMasses;

        proto.checkCollisionMasses = function(x, y, d, option) {

            const result = _check.call(this, x, y, d, option);
            const base = Array.isArray(result) ? result.slice() : [];

            if (!CMEX_Core.blockerSet.size)
                return base;

            const tw = $gameMap.tileWidth();
            const th = $gameMap.tileHeight();

            const char = this._character;
            const rect = char.collisionRect();

            const currPx = rect.x * tw;
            const currPy = rect.y * th;
            const currPw = rect.width  * tw;
            const currPh = rect.height * th;

            const nextPx = x * tw;
            const nextPy = y * th;
            const nextPw = currPw;
            const nextPh = currPh;

            if (CMEX_Core.rectOverlapsSolid(currPx, currPy, currPw, currPh)) {
				//return base.length ? base : [{}]; Supposedly fixes the random crash
                /*
                TypeError: result.getCollisionLengthByDirection is not a function
                */
                return base.length ? base : [];
			}

            if (CMEX_Core.rectOverlapsSolid(nextPx, nextPy, nextPw, nextPh)) {

                const hitX = nextPx + nextPw / 2;
                const hitY = nextPy + nextPh / 2;

                const blockRect = new DMS.DotMoveRectangle(
                    hitX / tw,
                    hitY / th,
                    1 / tw,
                    1 / th
                );

                //base.push(new DMS.CollisionResult(rect, blockRect, char));
                /*
                TypeError: result.getCollisionLengthByDirection is not a function
                */
                if (Number.isFinite(hitX) && Number.isFinite(hitY)) {
                    base.push(new DMS.CollisionResult(rect, blockRect, char));
                }
                return base;
            }

            return base;
        };
    }
};



/* --------------------------------------------------------------
 *  CMEX Editor Mode (NW.js Play-Test Only)
 *  Will contain:
 *    - Ctrl+Shift+C editor
 *    - NW.js popup window
 *    - File system read/write
 *    - CollisionMaps.json saving
 *    - Red pixel overlay toggle
 *    - Collider debug toggle
 * -------------------------------------------------------------- */
const CMEX_EditorMode = {

    fs: null,
    path: null,
    jsonPath: null,
    collisionMapData: {},

    editorWindow: null,

    // Session debug toggles (must persist like original)
    showPixelOverlay: false,
    showColliderDebug: false,

    init() {
        console.log("CMEX_EditorMode: Init");

        if (!CMEX_Env.isNwjs || !CMEX_Env.isTest) {
            console.warn("CMEX_EditorMode: Wrong environment — skipped.");
            return;
        }

        this._setupFs();
        this._loadJson();
		this._setupHotkey();      
        this._injectMapTransferHook();
        this._setupPopupMessageListener();
        this._injectSceneMapStartHook();
    },

    /* ----------------------------------------------------------
     *  FS INIT
     * ---------------------------------------------------------- */
    _setupFs() {
        this.fs = require("fs");
        this.path = require("path");
        this.jsonPath = this.path.join(process.cwd(), "data/CollisionMaps.json");
    },

    /* ----------------------------------------------------------
     *  JSON LOAD / SAVE
     * ---------------------------------------------------------- */
    _loadJson() {
        try {
            if (!this.fs.existsSync(this.jsonPath)) {
                this.collisionMapData = {};
                this._saveJson();
                return;
            }
            const raw = this.fs.readFileSync(this.jsonPath, "utf8");
            this.collisionMapData = JSON.parse(raw);
        } catch (e) {
            console.error("CMEX_EditorMode: Failed to load JSON", e);
            this.collisionMapData = {};
        }
    },

    _saveJson() {
        try {
            this.fs.writeFileSync(
                this.jsonPath,
                JSON.stringify(this.collisionMapData, null, 2)
            );
        } catch (e) {
            console.error("CMEX_EditorMode: Failed to save JSON", e);
        }
    },

    /* ----------------------------------------------------------
     *  Ctrl+Shift+C = Toggle Editor
     * ---------------------------------------------------------- */
	_setupHotkey() {
		document.addEventListener("keydown", e => {
			// Ctrl + Shift + C
			if (e.ctrlKey && e.shiftKey && e.code === "KeyC") {
				e.preventDefault();
				CMEX_EditorMode._toggleEditorWindow();
			}
		});
	},

    _toggleEditorWindow() {
        if (this.editorWindow && !this.editorWindow.closed) {
            this.editorWindow.close();
            this.editorWindow = null;
            return;
        }
        this._openPopup();
    },

    /* ----------------------------------------------------------
     *  NW.js Popup Editor
     * ---------------------------------------------------------- */
    _openPopup() {

        const html = this._buildPopupHtml();
        const url = "data:text/html," + encodeURIComponent(html);

        nw.Window.open(url, { width: 530, height: 330 }, win => {
            this.editorWindow = win;
            win.on("closed", () => this.editorWindow = null);

            setTimeout(() => this._sendMapInfo(), 60);
        });
    },

    _buildPopupHtml() {

return `
<!DOCTYPE html>
<html>
<body style="background:#222;color:#eee;font-family:sans-serif;padding:16px;">

<h2>Collision Map Editor</h2>

<div id="info"></div>

<hr style="margin:16px 0;">

<button id="choose">Choose PNG</button>

<hr style="margin:16px 0;">

<label style="display:block;margin-bottom:8px;">
  <input type="checkbox" id="pixOverlay">
  Show Pixel Overlay
</label>

<label style="display:block;margin-bottom:8px;">
  <input type="checkbox" id="colDebug">
  Show Collider Debug
</label>

<script>
/* PNG PICKER */
document.getElementById("choose").onclick = () => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".png";
    picker.nwworkingdir = "img/parallaxes";
    picker.onchange = () => {
        if (!picker.value) return;
        const file = picker.value.split(/(\\\\|\\/)/g).pop();
        window.opener.postMessage({ type:"selectedPNG", name:file }, "*");
    };
    picker.click();
};

/* TOGGLES */
document.getElementById("pixOverlay").onchange = e => {
    window.opener.postMessage({ type:"togglePixelOverlay", value:e.target.checked }, "*");
};
document.getElementById("colDebug").onchange = e => {
    window.opener.postMessage({ type:"toggleColliderDebug", value:e.target.checked }, "*");
};

/* RECEIVE MAP INFO */
window.addEventListener("message", e => {
    if (e.data.type === "mapInfo") {
        document.getElementById("info").innerHTML =
            "Map ID: " + e.data.mapId + "<br>" +
            "Map Name: " + e.data.mapName + "<br>" +
            "PNG: " + (e.data.assigned || "(none)");

        document.getElementById("pixOverlay").checked = e.data.pixelOverlay;
        document.getElementById("colDebug").checked = e.data.colliderDebug;
    }
});
</script>

</body>
</html>`;
    },

    /* ----------------------------------------------------------
     *  Popup → Game message listener
     * ---------------------------------------------------------- */
    _setupPopupMessageListener() {
        window.addEventListener("message", e => {
            if (!e.data) return;

            switch (e.data.type) {

                case "selectedPNG":
                    this._assignPNG(e.data.name);
                    break;

                case "togglePixelOverlay":
                    this.showPixelOverlay = e.data.value;
                    CMEX_DebugOverlay.refreshPixelOverlay();
                    break;

                case "toggleColliderDebug":
                    this.showColliderDebug = e.data.value;
                    CMEX_DebugOverlay.refreshColliderDebug();
                    break;
            }
        });
    },

    /* ----------------------------------------------------------
     *  Assign PNG to current map
     *  (FIXED: now refreshes overlays immediately, like original)
     * ---------------------------------------------------------- */
    _assignPNG(filename) {
        const id = $gameMap.mapId();

        this.collisionMapData[id] = filename;
        this._saveJson();

        CMEX_Core.loadCollisionPng(filename).then(() => {
            // EXACT original sequence:
            CMEX_DebugOverlay.removePixelOverlay();
            CMEX_DebugOverlay.removeColliderLayersOnMapChange();
            CMEX_DebugOverlay.refreshPixelOverlay();
            CMEX_DebugOverlay.refreshColliderDebug();
        });

        this._sendMapInfo();
    },

    /* ----------------------------------------------------------
     *  Send map info to popup
     * ---------------------------------------------------------- */
    _sendMapInfo() {
        if (!this.editorWindow) return;

        const id = $gameMap.mapId();
        const mapName = $dataMapInfos[id] ? $dataMapInfos[id].name : "(Unknown)";
        const assigned = this.collisionMapData[id];

        this.editorWindow.window.postMessage({
            type: "mapInfo",
            mapId: id,
            mapName: mapName,
            assigned: assigned,
            pixelOverlay: this.showPixelOverlay,
            colliderDebug: this.showColliderDebug
        }, "*");
    },

    /* ----------------------------------------------------------
     *  Map Transfer Hook
     *  (FIXED: must remove layers BEFORE refresh)
     * ---------------------------------------------------------- */
    _injectMapTransferHook() {

        const alias = Game_Player.prototype.performTransfer;

        Game_Player.prototype.performTransfer = function() {

            const was = this.isTransferring();
            alias.call(this);

            if (was) {
                setTimeout(() => {

                    CMEX_EditorMode._sendMapInfo();

                    const id = $gameMap.mapId();
                    const file = CMEX_EditorMode.collisionMapData[id];

                    if (file) {
                        CMEX_Core.loadCollisionPng(file).then(() => {

                            // EXACT original behavior:
                            CMEX_DebugOverlay.removePixelOverlay();
                            CMEX_DebugOverlay.removeColliderLayersOnMapChange();

                            CMEX_DebugOverlay.refreshPixelOverlay();
                            CMEX_DebugOverlay.refreshColliderDebug();
                        });
                    }

                }, 20);
            }
        };
    },

    /* ----------------------------------------------------------
     *  Scene_Map.start — refresh overlays on map start
     * ---------------------------------------------------------- */
    _injectSceneMapStartHook() {

        const alias = Scene_Map.prototype.start;

        Scene_Map.prototype.start = function() {
            alias.call(this);

            // EXACT original sequence:
            CMEX_DebugOverlay.removePixelOverlay();
            CMEX_DebugOverlay.removeColliderLayersOnMapChange();

            CMEX_DebugOverlay.refreshPixelOverlay();
            CMEX_DebugOverlay.refreshColliderDebug();
        };
    }
};

/* --------------------------------------------------------------
 *  CMEX_DebugOverlay — EXACT original timing & behavior
 * -------------------------------------------------------------- */
const CMEX_DebugOverlay = {

    // ----------------------------------------------------------
    // STATE
    // ----------------------------------------------------------
    pixelSprite: null,      // red debug overlay image
    colliderLayer: null,    // PIXI.Graphics for rectangles
    textLayer: null,        // PIXI.Container for labels

    // ==========================================================
    // PUBLIC REFRESH API
    // Called when toggles change or when map loads
    // ==========================================================
    refreshPixelOverlay() {
        this.removePixelOverlay();
        if (CMEX_EditorMode.showPixelOverlay) {
            this.createPixelOverlay();
        }
    },

    refreshColliderDebug() {
        if (CMEX_EditorMode.showColliderDebug) {
            this.showColliderLayers();
        } else {
            this.hideColliderLayers();
        }
    },

    // ==========================================================
    // 1. PIXEL OVERLAY (Red collision map)
    // ==========================================================
    createPixelOverlay() {
        if (!CMEX_Core.image || !CMEX_Core.pixels) return;
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map)) return;

        const ss = scene._spriteset;
        if (!ss) return;

        const w = CMEX_Core.width;
        const h = CMEX_Core.height;

        const bmp = new Bitmap(w, h);
        const ctx = bmp.context;
        const imgData = ctx.createImageData(w, h);
        const out = imgData.data;
        const inp = CMEX_Core.pixels;

        let any = false;

for (let i = 0; i < inp.length; i += 4) {

    const r = inp[i];
    const g = inp[i+1];
    const b = inp[i+2];
    const a = inp[i+3];

    if (a === 0) continue;

    // RED collision pixel (LOS + movement)
    if (r === 255 && g === 0 && b === 0) {
        out[i]   = 255;   // R
        out[i+1] = 0;     // G
        out[i+2] = 0;     // B
        out[i+3] = 120;   // opacity
        any = true;
    }

    // ORANGE collision pixel (movement only)
    else if (r === 255 && g === 165 && b === 0) {
        out[i]   = 255;   // R
        out[i+1] = 165;   // G
        out[i+2] = 0;     // B
        out[i+3] = 120;   // opacity
        any = true;
    }
}

        if (!any) return;

        ctx.putImageData(imgData, 0, 0);
        bmp._baseTexture.update();

        const sprite = new Sprite(bmp);

        // original plugin behavior
        sprite.update = function() {
            this.x = -($gameMap.displayX() * $gameMap.tileWidth());
            this.y = -($gameMap.displayY() * $gameMap.tileHeight());
        };

        this.pixelSprite = sprite;
        ss.addChild(sprite);

        // ✔ IMPORTANT FIX: run one immediate update so it aligns instantly
        sprite.update();
    },

    removePixelOverlay() {
        if (this.pixelSprite && this.pixelSprite.parent) {
            this.pixelSprite.parent.removeChild(this.pixelSprite);
        }
        this.pixelSprite = null;
    },

    // ==========================================================
    // 2. COLLIDER DEBUG LAYERS
    // ==========================================================
    createColliderLayer() {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map)) return;

        const ss = scene._spriteset;
        if (!ss) return;

        if (!this.colliderLayer) {
            this.colliderLayer = new PIXI.Graphics();
            this.colliderLayer.zIndex = 999999;

            // ✔ FIX: must attach to tilemap to match original
            ss._tilemap.addChild(this.colliderLayer);
			this.updateColliderLayer();   // Live Update Fix
        }
    },

    createTextLayer() {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map)) return;

        const ss = scene._spriteset;
        if (!ss) return;

        if (!this.textLayer) {
            this.textLayer = new PIXI.Container();
            this.textLayer.zIndex = 1000000;

            // ✔ FIX: must attach to tilemap to match original
            ss._tilemap.addChild(this.textLayer);
			this.updateTextLayer();       // Live Update Fix
        }
    },

    hideColliderLayers() {
        if (this.colliderLayer) this.colliderLayer.visible = false;
        if (this.textLayer) this.textLayer.visible = false;
    },

    showColliderLayers() {
        this.createColliderLayer();
        this.createTextLayer();

        if (this.colliderLayer) this.colliderLayer.visible = true;
        if (this.textLayer) this.textLayer.visible = true;
    },

    removeColliderLayersOnMapChange() {
        if (this.colliderLayer && this.colliderLayer.parent)
            this.colliderLayer.parent.removeChild(this.colliderLayer);
        if (this.textLayer && this.textLayer.parent)
            this.textLayer.parent.removeChild(this.textLayer);

        this.colliderLayer = null;
        this.textLayer = null;
    },

    // ==========================================================
    // PER-FRAME UPDATES
    // ==========================================================
    updateColliderLayer() {
        if (!CMEX_EditorMode.showColliderDebug) return;
        if (!this.colliderLayer) return;

        const g = this.colliderLayer;
        g.clear();

        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        const ox = $gameMap.displayX() * tw;
        const oy = $gameMap.displayY() * th;

        const drawRect = (r, color) => {
            if (!r) return;
            g.lineStyle(2, color, 0.85);
            g.beginFill(color, 0.15);
            g.drawRect(
                r.x * tw - ox,
                r.y * th - oy,
                r.width * tw,
                r.height * th
            );
            g.endFill();
        };

        drawRect($gamePlayer.collisionRect(), 0x00ff00);
        $gamePlayer.followers().visibleFollowers().forEach(f =>
            drawRect(f.collisionRect(), 0x00aaff)
        );
        $gameMap.events().forEach(ev =>
            drawRect(ev.collisionRect(), 0xff00ff)
        );
    },

    updateTextLayer() {
        if (!CMEX_EditorMode.showColliderDebug) return;
        if (!this.textLayer) return;

        const c = this.textLayer;
        c.removeChildren();

        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        const ox = $gameMap.displayX() * tw;
        const oy = $gameMap.displayY() * th;

        const makeText = t => new PIXI.Text(t, {
            fontFamily: "Arial",
            fontSize: 14,
            fill: 0xffffff,
            stroke: 0x000000,
            strokeThickness: 3
        });

        const arrow = d => ({2:"▼",4:"◀",6:"▶",8:"▲"}[d] || "");

        // Player
        {
            const r = $gamePlayer.collisionRect();
            const x = r.x*tw - ox;
            const y = r.y*th - oy;
            const w = r.width*tw;
            const t = makeText("PLAYER " + arrow($gamePlayer.direction()));
            t.x = x + w/2 - t.width/2;
            t.y = y - t.height - 2;
            c.addChild(t);
        }

        // Followers
        $gamePlayer.followers().visibleFollowers().forEach(f => {
            const r = f.collisionRect();
            const x = r.x*tw - ox;
            const y = r.y*th - oy;
            const w = r.width*tw;
            const t = makeText("FOL " + arrow(f.direction()));
            t.x = x + w/2 - t.width/2;
            t.y = y - t.height - 2;
            c.addChild(t);
        });

        // Events
        $gameMap.events().forEach(ev => {
            const r = ev.collisionRect();
            const x = r.x*tw - ox;
            const y = r.y*th - oy;
            const w = r.width*tw;
            const name = ev.event().name.trim();
            const txt = name ?
                `${ev.eventId()} – ${name} ${arrow(ev.direction())}` :
                `${ev.eventId()} ${arrow(ev.direction())}`;
            const t = makeText(txt);
            t.x = x + w/2 - t.width/2;
            t.y = y - t.height - 2;
            c.addChild(t);
        });
    }
};


/* --------------------------------------------------------------
 *  Scene_Map Update Hook for Debug Overlay
 *  (Required for collider rectangles + text to animate)
 * -------------------------------------------------------------- */
(() => {

    const _CMEX_SceneMap_update = Scene_Map.prototype.update;
	Scene_Map.prototype.update = function() {
		_CMEX_SceneMap_update.call(this);

        // Pixel overlay does NOT update every frame (bitmap is static)
        // but collider debug + text MUST update every frame:
        CMEX_DebugOverlay.updateColliderLayer();
		CMEX_DebugOverlay.updateTextLayer();
    };

})();


/* --------------------------------------------------------------
 *  Scene_Map.start — ORIGINAL TIMING FOR OVERLAY CREATION
 * -------------------------------------------------------------- */
(function() {

    const _CMEX_SceneMap_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        _CMEX_SceneMap_start.call(this);

        // Remove old layers from previous map
        CMEX_DebugOverlay.removePixelOverlay();
        CMEX_DebugOverlay.removeColliderLayersOnMapChange();
		// Direct Calls to Refresh
		CMEX_DebugOverlay.refreshPixelOverlay();
		CMEX_DebugOverlay.refreshColliderDebug();

    };

})();

/* --------------------------------------------------------------
 *  CMEX Windows Build Mode (Desktop NW.js Export)
 *  - No editor
 *  - Read-only JSON load
 *  - Load PNG automatically when switching maps
 * -------------------------------------------------------------- */
const CMEX_WindowsBuild = {

    collisionMapData: {},

    init() {
        console.log("CMEX_WindowsBuild: Init");

        if (!CMEX_Env.isNwjs || CMEX_Env.isTest) {
            console.warn("CMEX_WindowsBuild: Wrong environment — skipped.");
            return;
        }

        this._loadJson();
        this._injectMapTransferHook();
        this._injectSceneMapStartHook();
    },

    /* ----------------------------------------------------------
     *  Load JSON via fetch (read-only)
     * ---------------------------------------------------------- */
    async _loadJson() {
        try {
            const response = await fetch("data/CollisionMaps.json");
            if (response.ok) {
                this.collisionMapData = await response.json();
            } else {
                console.warn("CMEX_WindowsBuild: CollisionMaps.json not found");
                this.collisionMapData = {};
            }
        } catch (e) {
            console.error("CMEX_WindowsBuild: Failed to load JSON", e);
            this.collisionMapData = {};
        }
    },

    /* ----------------------------------------------------------
     *  On map start, load PNG
     *  — must run AFTER Spriteset is fully initialized
     * ---------------------------------------------------------- */
    _injectSceneMapStartHook() {
        const alias = Scene_Map.prototype.start;
        Scene_Map.prototype.start = function() {
            alias.call(this);

            // Delay loading so Spriteset_Map is fully ready
            setTimeout(() => {
                const id = $gameMap.mapId();
                const filename = CMEX_WindowsBuild.collisionMapData[id];
                if (filename) CMEX_Core.loadCollisionPng(filename);
            }, 1);
        };
    },

    /* ----------------------------------------------------------
     *  Map Transfer → refresh collision PNG
     * ---------------------------------------------------------- */
    _injectMapTransferHook() {

        const alias = Game_Player.prototype.performTransfer;

        Game_Player.prototype.performTransfer = function() {
            const was = this.isTransferring();
            alias.call(this);

            if (was) {
                setTimeout(() => {
                    const id = $gameMap.mapId();
                    const filename = CMEX_WindowsBuild.collisionMapData[id];
                    if (filename) CMEX_Core.loadCollisionPng(filename);
                }, 20);
            }
        };
    }
};

/* --------------------------------------------------------------
 *  CMEX Browser Mode (HTML5 / Mobile)
 *  - No editor
 *  - Read-only JSON load
 *  - Load PNG automatically when switching maps
 * -------------------------------------------------------------- */
const CMEX_BrowserBuild = {

    collisionMapData: {},

    init() {
        console.log("CMEX_BrowserBuild: Init");

        if (CMEX_Env.isNwjs) {
            console.warn("CMEX_BrowserBuild: Wrong environment — skipped.");
            return;
        }

        this._loadJson();
        this._injectMapTransferHook();
        this._injectSceneMapStartHook();
    },

    /* ----------------------------------------------------------
     *  Load JSON via fetch
     * ---------------------------------------------------------- */
    async _loadJson() {
        try {
            const response = await fetch("data/CollisionMaps.json");
            if (response.ok) {
                this.collisionMapData = await response.json();
            } else {
                console.warn("CMEX_BrowserBuild: CollisionMaps.json not found");
                this.collisionMapData = {};
            }
        } catch (e) {
            console.error("CMEX_BrowserBuild: Failed to load JSON", e);
            this.collisionMapData = {};
        }
    },

    /* ----------------------------------------------------------
     *  On map start — must delay loading until spriteset is ready
     * ---------------------------------------------------------- */
    _injectSceneMapStartHook() {
        const alias = Scene_Map.prototype.start;
        Scene_Map.prototype.start = function() {
            alias.call(this);

            setTimeout(() => {
                const id = $gameMap.mapId();
                const filename = CMEX_BrowserBuild.collisionMapData[id];
                if (filename) CMEX_Core.loadCollisionPng(filename);
            }, 1);
        };
    },

    /* ----------------------------------------------------------
     *  Map Transfer → refresh collision PNG
     * ---------------------------------------------------------- */
    _injectMapTransferHook() {

        const alias = Game_Player.prototype.performTransfer;

        Game_Player.prototype.performTransfer = function() {
            const was = this.isTransferring();
            alias.call(this);

            if (was) {
                setTimeout(() => {
                    const id = $gameMap.mapId();
                    const filename = CMEX_BrowserBuild.collisionMapData[id];
                    if (filename) CMEX_Core.loadCollisionPng(filename);
                }, 20);
            }
        };
    }
};


// ============================================================================
//  Main Entry Router
// ============================================================================
(() => {

    // Always initialize the core engine first
    CMEX_Core.init();

    // Mode-specific modules
    switch (CMEX_Env.mode) {

        case "editorTest":
            CMEX_EditorMode.init();
            break;

        case "windowsBuild":
            CMEX_WindowsBuild.init();
            break;

        case "browser":
        default:
            CMEX_BrowserBuild.init();
            break;
    }

})();
