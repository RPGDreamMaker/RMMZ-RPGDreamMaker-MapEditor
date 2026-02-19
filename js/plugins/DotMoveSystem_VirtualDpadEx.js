"use strict";
/*:
 * @target MZ
 * @plugindesc Dot movement system virtual dpad extension v1.2.2
 * @author RPG Dream Maker
 * @url https://rpgdreammaker.itch.io/
 *
 * @help
 * ============================================================================
 *  ■ Virtual D-Pad EX — Mobile Joystick + Action Buttons (with Editor)
 * ============================================================================
 * Virtual D-Pad EX replaces RPG Maker MZ’s default touch UI with a customizable
 * on-screen joystick and 4 action buttons.
 * 
 * This is a full modular architecture:
 *
 *   • DPad_Core          — Shared runtime engine + DotMoveSystem adapter  
 *   • DPad_EditorMode    — NW.js test-mode live editor (Ctrl+Shift+V)  
 *   • DPad_WindowsBuild  — Desktop exports (JSON load only, no editor)  
 *   • DPad_BrowserBuild  — Web/HTML5 exports (JSON load only, no editor)
 *
 * The plugin automatically detects the environment:
 *
 *       editorTest   → NW.js Play Test (full editor enabled)  
 *       windowsBuild → Desktop export  
 *       browser      → HTML5 / Mobile  
 *
 * Important: MZ’s default **Touch UI buttons are automatically disabled**.
 *
 * ============================================================================
 *  ■ Features
 * ============================================================================
 * ● **Analog Joystick / 8-dir / 4-dir modes**  
 * ● **4 customizable buttons** (OK, Cancel, Menu, Shift, PgUp, PgDown…)  
 * ● **Cooldown system** (prevents double taps)  
 * ● **Hold-type inputs** (Shift/Dash, arrows, etc.)  
 * ● **DotMoveSystem compatible** (Analog mode uses dotMoveByDeg)  
 * ● **Live editor** with instant rebuild of all sprites  
 * ● **Persistent JSON configuration** in exported games  
 *
 * ============================================================================
 *  ■ How It Works
 * ============================================================================
 * 1. The plugin creates:
 *        • A circular D-Pad base with its analog stick  
 *        • Four action buttons  
 *
 * 2. Player movement is read from the stick:
 *        STICK_MODE = 0 → 4-direction  
 *        STICK_MODE = 1 → 8-direction  
 *        STICK_MODE = 2 → Analog (DotMove required)  
 *
 * 3. Buttons trigger mapped actions:
 *        OK / Cancel / Menu / Shift  
 *        PageUp / PageDown   
 *
 * 4. All live changes are saved to:
 *
 *        data/VirtualDPad.json
 *
 *    Used automatically in Desktop/Web exports.
 *
 * ============================================================================
 *  ■ Live Editor (Play-Test Only)
 * ============================================================================
 * Press **Ctrl+Shift+V** in a NW.js Play Test to open the VDP Editor:
 *
 *     • Change sizes, colors, opacity  
 *     • Switch joystick mode  
 *     • Adjust button colors  
 *     • Configure button actions (popup window)  
 *     • Save or reset to defaults  
 *
 * All changes apply **instantly** in-game without reload.
 *
 * Editor consists of:
 *     → Main Window (layout, sizes, colors)  
 *     → Button Actions Popup
 *
 * ============================================================================
 *  ■ DotMoveSystem Integration
 * ============================================================================
 * When you choose the Joystick Mode: Analog (DotMove)
 *
 *     Player moves in **full 360°** using:
 *         player.dotMoveByDeg(angle)
 *
 * In 4-dir and 8-dir mode, the D-Pad feeds standard Input directions:
 *
 *     dir4() → 2 / 4 / 6 / 8  
 *     dir8() → 1 / 2 / 3 / 4 / 6 / 7 / 8 / 9  
 *
 * DotMoveSystem is optional, but Analog mode requires it.
 *
 * ============================================================================
 *  ■ Button Actions
 * ============================================================================
 * Each virtual button can trigger one of:
 *
 *     ok  
 *     cancel  
 *     menu  
 *     shift  
 *     pageup  
 *     pagedown  
 *
 * Hold-type actions (“shift”, arrow keys, control) emulate key-holds.
 *
 * Tap-type actions use a built-in **cooldown system** to prevent double input.
 *
 * ============================================================================
 *  ■ JSON File Structure
 * ============================================================================
 * All saved values are stored in:
 *
 *      data/VirtualDPad.json
 *
 * Contains:
 *     • Sizes  
 *     • Colors  
 *     • Opacity  
 *     • Stick mode  
 *     • Button actions  
 *
 * The file is only written in NW.js Play Test.  
 * Exported builds load this JSON automatically (read-only).
 *
 * ============================================================================
 *  ■ Notes
 * ============================================================================
 * ● Touch UI is forcibly disabled for full compatibility.  
 * ● The editor only runs in **NW.js Play Test**.  
 * ● No editor UI is included in exported games.  
 * ● Mobile browsers supported (HTML5 mode).  
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
// Turning OFF the use of Touch UI MZ Default Buttons
// ============================================================================
//ConfigManager.touchUI = false;

// ============================================================================
// Polyfill — structuredClone (RPG Maker MZ uses older NW.js)
// ============================================================================
if (typeof structuredClone !== "function") {
    window.structuredClone = function(obj) {
        return JSON.parse(JSON.stringify(obj));
    };
}

// Global controller instance (populated by DataManager during boot)
var $dpadController = null;


// ============================================================================
// STEP 1 — Environment Detector (same architecture as CollisionMapEx)
// ============================================================================
const DPad_Env = (() => {

    // Check if running inside NW.js (desktop build or playtest)
    const isNwjs = Utils.isNwjs();

    // Check if RPG Maker was launched in TEST mode (Play Test)
    const isTest = Utils.isOptionValid("test");

    // Determine final mode
    let mode;
    if (isNwjs && isTest) {
        mode = "editorTest";        // NW.js + PlayTest (Editor enabled)
    } else if (isNwjs) {
        mode = "windowsBuild";      // Exported desktop build
    } else {
        mode = "browser";           // HTML5 / Mobile / Web
    }

    console.log(`DPad: Runtime Mode = ${mode}`);

    // Expose the environment info
    return {
        isNwjs,
        isTest,
        mode, // "editorTest" | "windowsBuild" | "browser"
    };

})();


// ============================================================================
// STEP 2 — Core Module (Always Loaded)
// ============================================================================
const DPad_Core = {

    // Live configuration (defaults + saved values applied later)
    Config: {},

    // -------------------------------------------------------------
    // INIT — Runs in ALL environments (editorTest, windows, browser)
    // -------------------------------------------------------------
    init() {
        console.log("DPad_Core: Init");

        // 1. Load plugin parameter defaults
        this._loadPluginParams();

        // 2. Normalize
        this._normalizeConfigObj(this.Config);

        // 3. Inject runtime systems
        this._injectDataManager();
        this._injectSceneCreate();
        this._injectSceneUpdate();

        // 4. Inject Touch / Multi-touch system
        this.injectTouchSystem();

        // 5. Inject movement adapter
        this._injectMovementAdapter();
    },

    // ========================================================================
    // HELPERS - Fade-in and Refresh flags
    // ========================================================================
    // Fade-in global flag
    _hasFadedIn: false,
    // Tracks refresh calls initiated by the live editor
    _refreshFromEditor: false,

    // ========================================================================
    // CONFIG (defaults from plugin parameters)
    // ========================================================================
    _loadPluginParams() {
        const pluginName = "DotMoveSystem_VirtualDpadEx";
        const p = PluginManager.parameters(pluginName);

        const defaults = {
            STICK_MODE:        Number(p["STICK_MODE"] ?? 0),
            PAD_SIZE:          Number(p["PAD_SIZE"] ?? 160),
            STICK_SIZE:        Number(p["STICK_SIZE"] ?? 64),
            BUTTON_SIZE:       Number(p["BUTTON_SIZE"] ?? 64),

            PAD_STROKE_COLOR:   String(p["PAD_STROKE_COLOR"]   ?? "#0000aa"),
            PAD_FILL_COLOR:     String(p["PAD_FILL_COLOR"]     ?? "#ffffff"),
            PAD_OPACITY:        Number(p["PAD_OPACITY"]        ?? 128),

            STICK_STROKE_COLOR: String(p["STICK_STROKE_COLOR"] ?? "#0000aa"),
            STICK_FILL_COLOR:   String(p["STICK_FILL_COLOR"]   ?? "#ffffff"),

            BUTTON_FILL_COLOR_1: String(p["BUTTON_FILL_COLOR_1"] ?? "#0000ff"),
            BUTTON_FILL_COLOR_2: String(p["BUTTON_FILL_COLOR_2"] ?? "#00ff00"),
            BUTTON_FILL_COLOR_3: String(p["BUTTON_FILL_COLOR_3"] ?? "#ffff00"),
            BUTTON_FILL_COLOR_4: String(p["BUTTON_FILL_COLOR_4"] ?? "#ff0000"),
			
			BUTTON_ACTION_1: p["BUTTON_ACTION_1"] ?? "shift",     // (top)
			BUTTON_ACTION_2: p["BUTTON_ACTION_2"] ?? "menu",    // (left)
			BUTTON_ACTION_3: p["BUTTON_ACTION_3"] ?? "ok",        // (bottom)
			BUTTON_ACTION_4: p["BUTTON_ACTION_4"] ?? "cancel",      // (right)
        };

        this.Config = structuredClone(defaults);
    },

    // Validate/clean saved data
    _normalizeConfigObj(cfg) {
        const numeric = [
            "STICK_MODE", "PAD_SIZE", "STICK_SIZE",
            "BUTTON_SIZE", "PAD_OPACITY"
        ];

        for (const k of numeric) {
            if (cfg[k] != null) cfg[k] = Number(cfg[k]);
        }

        if (cfg.PAD_OPACITY != null) {
            cfg.PAD_OPACITY = Math.min(255, Math.max(0, cfg.PAD_OPACITY));
        }
    },

    // ========================================================================
    // CONTROLLER CLASS (formerly CustomVirtualStickController)
    // ========================================================================
    Controller: class {
        constructor() { this.reset(); }

        reset() {
            this._isVisible = true;
            this._point = { x: 0, y: 0 };
            this._deg = null;
            this._state = "open";
        }

        update() {}

        deg() { return this._deg; }

        dir4() {
            if (this._deg == null) return 0;
            const d = this._deg;

            if ((d >= 315 || d < 45)) return 8;
            if (d >= 45  && d < 135)  return 6;
            if (d >= 135 && d < 225)  return 2;
            if (d >= 225 && d < 315)  return 4;

            throw new Error(`${d} invalid`);
        }

        dir8() {
            if (this._deg == null) return 0;
            const d = this._deg;

            if ((d >= 337.5 || d < 22.5)) return 8;
            if (d >= 22.5  && d < 67.5)   return 9;
            if (d >= 67.5  && d < 112.5)  return 6;
            if (d >= 112.5 && d < 157.5)  return 3;
            if (d >= 157.5 && d < 202.5)  return 2;
            if (d >= 202.5 && d < 247.5)  return 1;
            if (d >= 247.5 && d < 292.5)  return 4;
            if (d >= 292.5 && d < 337.5)  return 7;

            throw new Error(`${d} invalid`);
        }

        calcDeg(a, b) {
            const rad = Math.atan2(b.y - a.y, b.x - a.x);
            let deg = (rad / Math.PI) * 180 + 90;
            if (deg > 360) deg %= 360;
            if (deg < 0) deg += 360;
            return deg;
        }

        calcDistance(a, b) {
            return Math.hypot(b.x - a.x, b.y - a.y);
        }
    },

    // ========================================================================
    // DATA MANAGER: create global controller
    // ========================================================================
    _injectDataManager() {
        const alias = DataManager.createGameObjects;
        DataManager.createGameObjects = function() {
            alias.call(this);
            window.$dpadController = new DPad_Core.Controller();
        };
    },

    // ========================================================================
    // SCENE HOOKS: create/update
    // ========================================================================
    _injectSceneCreate() {
        const alias = Scene_Base.prototype.create;
        Scene_Base.prototype.create = function() {
            alias.call(this);

            if (!$dpadController) {
                window.$dpadController = new DPad_Core.Controller();
            }

            if (this.createDPadSprites) this.createDPadSprites();

            $dpadController.reset();
        };
    },

    _injectSceneUpdate() {
        const alias = Scene_Base.prototype.update;
        Scene_Base.prototype.update = function() {
            //$dpadController.update();
			if ($dpadController) $dpadController.update();
            alias.call(this);

            if (this.updateDPadButtonPositions) {
                this.updateDPadButtonPositions();
            }

            // Fade-in on Game Start
            DPad_Core.fadeInOnStart(this);

            this.sortSceneChildren();
        };
    },

    // ========================================================================
    // SORT SPRITES Z-ORDER
    // ========================================================================
    // (mirrors your original)
    // ========================================================================
    // Also used by DPad for proper layering.
    SceneSorterInstalled: (() => {
        Scene_Base.prototype.sortSceneChildren = function() {
            this.children.forEach(child => {
                if (child.z !== undefined) child.zIndex = child.z;
            });
            this.sortChildren();
        };
        return true;
    })(),

    // ========================================================================
    // SPRITE FACTORY (Pad, Stick, Buttons)
    // ========================================================================
    _spriteClass: (Utils.RPGMAKER_NAME === "MZ") ? Sprite : Sprite_Base,

    _markDirty(bitmap) {
        try { bitmap?._setDirty?.(); } catch(_e) {}
    },

    Sprite_DPad: class extends ((Utils.RPGMAKER_NAME === "MZ") ? Sprite : Sprite_Base) {
        constructor() {
            super();
            const C = DPad_Core.Config;

            this.x = 50;
            this.y = Graphics.height - C.PAD_SIZE - 50;

            this.z = 10;
            this.visible = true;
            this.alpha = 1;

            this.defaultOpacity = C.PAD_OPACITY / 255;
            //this.opacity = this.defaultOpacity * 255;

            this.opacity = DPad_Core._hasFadedIn ? C.PAD_OPACITY : 0;
            this.visible = true;

            this.createBitmap();
        }

        createBitmap() {
            const C = DPad_Core.Config;
            this.bitmap = new Bitmap(C.PAD_SIZE, C.PAD_SIZE);
            const ctx = this.bitmap._context;
            const r = this.bitmap.width / 2;
            const cx = r, cy = r;

            ctx.clearRect(0,0,this.bitmap.width,this.bitmap.height);

            ctx.beginPath();
            ctx.arc(cx, cy, r - 1, 0, Math.PI*2);
            ctx.strokeStyle = C.PAD_STROKE_COLOR;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.globalAlpha = C.PAD_OPACITY / 255;
            ctx.fillStyle = C.PAD_FILL_COLOR;
            ctx.fill();

            ctx.closePath();
            DPad_Core._markDirty(this.bitmap);
        }
    },

    Sprite_Stick: class extends ((Utils.RPGMAKER_NAME === "MZ") ? Sprite : Sprite_Base) {
        constructor() {
            super();
            const C = DPad_Core.Config;
            
            this.x = 50 + (C.PAD_SIZE/2 - C.STICK_SIZE/2);
            this.y = (Graphics.height - C.PAD_SIZE - 50)
                   + (C.PAD_SIZE/2 - C.STICK_SIZE/2);

            this.z = 11;
            this.alpha = 1;
            this.visible = true;

            this.defaultOpacity = C.PAD_OPACITY / 255;
            //this.opacity = this.defaultOpacity * 255;

            this.opacity = DPad_Core._hasFadedIn ? C.PAD_OPACITY : 0;
            this.visible = true;

            this.createBitmap();

        }

        createBitmap() {
            const C = DPad_Core.Config;
            this.bitmap = new Bitmap(C.STICK_SIZE, C.STICK_SIZE);
            const r = this.bitmap.width / 2;
            const cx = r, cy = r;

            const ctx = this.bitmap._context;
            ctx.clearRect(0,0,this.bitmap.width,this.bitmap.height);

            ctx.beginPath();
            ctx.arc(cx, cy, r - 1, 0, Math.PI*2);
            ctx.strokeStyle = C.STICK_STROKE_COLOR;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.globalAlpha = C.PAD_OPACITY / 255;
            ctx.fillStyle = C.STICK_FILL_COLOR;
            ctx.fill();

            ctx.closePath();
            DPad_Core._markDirty(this.bitmap);
        }
    },

    Sprite_Button: class extends ((Utils.RPGMAKER_NAME === "MZ") ? Sprite : Sprite_Base) {
        constructor(x, y, fillColor) {
            super();
            const C = DPad_Core.Config;
            
            this.x = x;
            this.y = y;
            this.fillColor = fillColor;

            this.z = 12;
            this.visible = true;
            this.alpha = 1;

            this.defaultOpacity = C.PAD_OPACITY / 255;
            //this.opacity = this.defaultOpacity * 255;

            this.opacity = DPad_Core._hasFadedIn ? C.PAD_OPACITY : 0;
            this.visible = true;

            this.createBitmap();

        }

        createBitmap() {
            const C = DPad_Core.Config;
            this.bitmap = new Bitmap(C.BUTTON_SIZE, C.BUTTON_SIZE);
            const r = this.bitmap.width/2, cx = r, cy = r;

            const ctx = this.bitmap._context;
            ctx.clearRect(0,0,this.bitmap.width,this.bitmap.height);

            ctx.beginPath();
            ctx.arc(cx, cy, r - 1, 0, Math.PI*2);
            ctx.strokeStyle = C.PAD_STROKE_COLOR;
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.globalAlpha = C.PAD_OPACITY / 255;
            ctx.fillStyle = this.fillColor;
            ctx.fill();

            ctx.closePath();
            DPad_Core._markDirty(this.bitmap);
        }
    },
};

// ---------------------------------------------------------------------------
// SPRITE LAYOUT METHODS (extend Scene_Base outside the object literal)
// ---------------------------------------------------------------------------

// Build all DPad sprites
Scene_Base.prototype.createDPadSprites = function() {
    const C = DPad_Core.Config;

    this._dpadPad = new DPad_Core.Sprite_DPad();
    this.addChild(this._dpadPad);

    this._dpadStick = new DPad_Core.Sprite_Stick();
    this.addChild(this._dpadStick);

    this._dpadButtons = [];
    this._createDPadButton(1, 50,                      50,                      C.BUTTON_FILL_COLOR_1);
    this._createDPadButton(2, 50 + C.BUTTON_SIZE * .8, 50,                      C.BUTTON_FILL_COLOR_2);
    this._createDPadButton(3, 50,                      50 + C.BUTTON_SIZE * .8, C.BUTTON_FILL_COLOR_3);
    this._createDPadButton(4, 50 + C.BUTTON_SIZE * .8, 50 + C.BUTTON_SIZE * .8, C.BUTTON_FILL_COLOR_4);

    this.resetDPadStickPosition();
};

Scene_Base.prototype._createDPadButton = function(index, offsetX, offsetY, color) {
    const C = DPad_Core.Config;

    const x = Graphics.width  - C.BUTTON_SIZE - offsetX;
    const y = Graphics.height - C.BUTTON_SIZE - offsetY;

    const btn = new DPad_Core.Sprite_Button(x, y, color);
    this._dpadButtons.push(btn);
    this.addChild(btn);
};

Scene_Base.prototype.updateDPadButtonPositions = function() {
    const C = DPad_Core.Config;
    const b = C.BUTTON_SIZE;

    const pos = [
        { x: b * .8 + 50,           y: b * .8 + b * .8 + 50 },
        { x: b * .8 + b * .8 + 50,  y: b * .8 + 50          },
        { x: b * .8 + 50,           y: 50                   },
        { x: 50,                    y: b * .8 + 50          },
    ];

    this._dpadButtons.forEach((btn, i) => {
        btn.x = Graphics.width  - C.BUTTON_SIZE - pos[i].x;
        btn.y = Graphics.height - C.BUTTON_SIZE - pos[i].y;
    });
};

// Position reset
Scene_Base.prototype.resetDPadStickPosition = function() {
    const C = DPad_Core.Config;
    if (!this._dpadStick) return;

    this._dpadStick.x =
        50 + (C.PAD_SIZE/2 - C.STICK_SIZE/2);

    this._dpadStick.y =
        (Graphics.height - C.PAD_SIZE - 50)
      + (C.PAD_SIZE/2 - C.STICK_SIZE/2);

    $dpadController._point = {
        x: this._dpadStick.x + C.STICK_SIZE / 2,
        y: this._dpadStick.y + C.STICK_SIZE / 2
    };

    $dpadController._deg = null;
};

// ============================================================================
// TOUCH SYSTEM (multi-touch input)
// ============================================================================
DPad_Core.injectTouchSystem = function() {
    const _init = TouchInput.initialize;
    TouchInput.initialize = function() {
        _init.call(this);
        this._touches = [];
    };

    TouchInput._onTouchStart = function(evt) {
        for (const t of evt.changedTouches) {
            const x = Graphics.pageToCanvasX(t.pageX);
            const y = Graphics.pageToCanvasY(t.pageY);

            if (Graphics.isInsideCanvas(x, y)) {
                this._touches.push({
                    id: t.identifier,
                    x, y,
                    pressed: true,
                    moved: false
                });
                this._checkDPadInput();
                evt.preventDefault();
            }
        }
        if (window.cordova || window.navigator.standalone) evt.preventDefault();
    };

    TouchInput._onTouchMove = function(evt) {
        for (const t of evt.changedTouches) {
            const x = Graphics.pageToCanvasX(t.pageX);
            const y = Graphics.pageToCanvasY(t.pageY);
            const td = this._touches.find(tt => tt.id === t.identifier);
            if (td) { td.x = x; td.y = y; td.moved = true; }
        }
        this._checkDPadInput();
    };

    TouchInput._onTouchEnd = function(evt) {
        for (const t of evt.changedTouches) {
            const i = this._touches.findIndex(tt => tt.id === t.identifier);
            if (i >= 0) this._touches.splice(i, 1);
        }
        this._checkDPadInput();
    };

    TouchInput._onTouchCancel = TouchInput._onTouchEnd;

    // Check multi-touch input → apply to DPad
    TouchInput._checkDPadInput = function() {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Base || scene instanceof Scene_Message)) return;

        const C = DPad_Core.Config;
        const pad   = scene._dpadPad;
        const stick = scene._dpadStick;

        if (!pad || !stick) return;

        let touchingDPad = false;

        for (const t of this._touches) {
            const x = t.x, y = t.y;

            if (scene.isTouchInputInsideSprite(pad, x, y)) {
                touchingDPad = true;

                const cx = pad.x + pad.width /2;
                const cy = pad.y + pad.height/2;

                const dist = $dpadController.calcDistance({x:cx,y:cy}, {x,y});
                $dpadController._point = { x, y };

                if (dist <= C.PAD_SIZE/2) {
                    stick.x = x - C.STICK_SIZE/2;
                    stick.y = y - C.STICK_SIZE/2;
                } else {
                    const ang = Math.atan2(y - cy, x - cx);
                    stick.x = cx + Math.cos(ang) * (C.PAD_SIZE/2) - C.STICK_SIZE/2;
                    stick.y = cy + Math.sin(ang) * (C.PAD_SIZE/2) - C.STICK_SIZE/2;

                    $dpadController._point = {
                        x: cx + Math.cos(ang) * (C.PAD_SIZE/2),
                        y: cy + Math.sin(ang) * (C.PAD_SIZE/2)
                    };
                }

                $dpadController._deg =
                    $dpadController.calcDeg({x:cx,y:cy},{x,y});

                stick.opacity = C.PAD_OPACITY * 2;

                if (!(scene instanceof Scene_Map)) {
                    TouchInput._dpadMenuNav($dpadController._deg);
                }

            } else {
                scene._dpadButtons?.forEach((btn,i)=>{
                    if (scene.isTouchInputInsideSprite(btn,x,y)) {
						const action = DPad_Core.Config["BUTTON_ACTION_" + (i+1)];
						DPad_Core._triggerButtonAction(action);
                        btn.opacity = C.PAD_OPACITY * 2;
                    } else {
                        btn.opacity = C.PAD_OPACITY;
                    }
                });
            }
        }

        // Release buttons not touched
        scene._dpadButtons?.forEach((btn,i)=>{
            const inside = this._touches.some(t =>
                scene.isTouchInputInsideSprite(btn, t.x, t.y)
            );
            if (!inside) {
                if (i === 0) Input._currentState["shift"] = false;
                btn.opacity = C.PAD_OPACITY;
            }
        });

        if (!touchingDPad) {
            $dpadController._point = {x:0,y:0};
            $dpadController._deg   = null;
            scene.resetDPadStickPosition();
            stick.opacity = C.PAD_OPACITY;
        }
    };

    // Simple sprite hit-test
    Scene_Base.prototype.isTouchInputInsideSprite = function(sp, x, y){
        if (!sp || !sp.bitmap) return false;
        return (
            x >= sp.x &&
            x <= sp.x + sp.width &&
            y >= sp.y &&
            y <= sp.y + sp.height
        );
    };

	// MENU NAVIGATION (cooldown-based)
	DPad_Core._menuNavCooldown = 0;

	TouchInput._dpadMenuNav = function(deg) {
		const now = performance.now();

		// Prevent double-triggers (120 ms cooldown)
		if (now - DPad_Core._menuNavCooldown < 120) return;
		DPad_Core._menuNavCooldown = now;

		if (deg >= 315 || deg < 45)           Input.virtualClick("up");
		else if (deg >= 45  && deg < 135)     Input.virtualClick("right");
		else if (deg >= 135 && deg < 225)     Input.virtualClick("down");
		else if (deg >= 225 && deg < 315)     Input.virtualClick("left");
	};

    // HELPER: DPad Fade-In On Start-up Speed.
    DPad_Core.FADE_SPEED = 4; // opacity per frame

    DPad_Core.fadeInOnStart = function(scene) {
        if (DPad_Core._hasFadedIn) return; // already done

        const targetOpacity = DPad_Core.Config.PAD_OPACITY;
        const speed = DPad_Core.FADE_SPEED;
        const sprites = [scene._dpadPad, scene._dpadStick, ...(scene._dpadButtons || [])];

        let allDone = true;
        sprites.forEach(sp => {
            if (!sp) return;
            if (sp.opacity < targetOpacity) {
                sp.opacity = Math.min(sp.opacity + speed, targetOpacity);
                if (sp.opacity < targetOpacity) allDone = false;
            }
        });

        if (allDone) {
            DPad_Core._hasFadedIn = true; // lock in so future scenes don’t re-fade
        }
    };

	// ============================================================================
	// BUTTON ACTION HANDLER (cooldown-based)
	// ============================================================================

	// Track cooldown timestamps for every action
	DPad_Core._tapCooldowns = {};

	// Universal handler
	DPad_Core._triggerButtonAction = function(action) {

		// "Hold" actions (no cooldown, stays pressed)
		if (["shift","up","down","left","right","control"].includes(action)) {
			Input._currentState[action] = true;
			return;
		}

		// Custom item shortcut
		if (action === "item") {
			this._cooldownItem();
			return;
		}

		// Normal tap actions (OK, Cancel, Menu, PgUp, PgDown…)
		this._cooldownTap(action);
	};

	// Cooldown tap handler (no multiple activations per 250ms)
	DPad_Core._cooldownTap = function(action) {
		const now = performance.now();
		const last = this._tapCooldowns[action] || 0;

		if (now - last >= 250) {
			this._tapCooldowns[action] = now;
			Input.virtualClick(action);
		}
	};

	// Special cooldown for "item" action
	DPad_Core._cooldownItem = function() {
		const action = "item";
		const now = performance.now();
		const last = this._tapCooldowns[action] || 0;

		if (now - last >= 300) {
			this._tapCooldowns[action] = now;

			const s = SceneManager._scene;
			if (!(s instanceof Scene_Item)) SceneManager.push(Scene_Item);
			else Input.virtualClick("escape");
		}
	};
};

// ============================================================================
// MOVEMENT ADAPTER (DotMove integration)
// ============================================================================
DPad_Core._injectMovementAdapter = function(){
    Game_Player.prototype.getDPadInputDeg = function(){ return null; };

    const alias = Game_Player.prototype.moveByInput;
    Game_Player.prototype.moveByInput = function(){

        if (!this.isMoving() && this.canMove()){

            let dir = this.getInputDirection();
            let deg = this.getDPadInputDeg();

            if (dir > 0){
                $gameTemp.clearDestination();

            } else if (deg != null){
                $gameTemp.clearDestination();
                if (typeof DotMoveSystemPluginName !== "undefined"){
                    this.dotMoveByDeg(deg);
                }

            } else {
                const mode = DPad_Core.Config.STICK_MODE;

                if (mode === 1){
                    dir = $dpadController.dir8();

                } else if (mode === 2){
                    deg = $dpadController.deg();
                    if (typeof DotMoveSystemPluginName !== "undefined"){
                        if (deg != null) this.dotMoveByDeg(deg);
                    }

                } else {
                    dir = $dpadController.dir4();
                }
            }

            if (dir > 0){
                if (this.processMoveByInput)
                    this.processMoveByInput(dir);
                else
                    this.executeMove(dir);
            }
        }
    };
};

// ============================================================================
// REFRESH (rebuild sprites after config change)
// ============================================================================
DPad_Core.refresh = function(){
    const scene = SceneManager._scene;
    if (!scene) return;

    if (scene._dpadPad)    scene.removeChild(scene._dpadPad);
    if (scene._dpadStick)  scene.removeChild(scene._dpadStick);
    if (scene._dpadButtons) scene._dpadButtons.forEach(b=>scene.removeChild(b));

    if (scene.createDPadSprites)
        scene.createDPadSprites();

    // ⭐ NEW: Reset touch memory after rebuild
    if (scene._dpadButtons) {
        scene._wasTouchingDPad     = false;
        scene._wasTouchingButtons  = [false, false, false, false];
    }

    // Editor refresh: restore visibility + opacity immediately
    if (DPad_Core._refreshFromEditor && scene._dpadPad) {
        const targetOpacity = DPad_Core.Config.PAD_OPACITY;

        const sprites = [
            scene._dpadPad,
            scene._dpadStick,
            ...(scene._dpadButtons || [])
        ];

        sprites.forEach(sp => {
            if (!sp) return;
            sp.visible = true;
            sp.opacity = targetOpacity;
        });

        // If you’re tracking input disabling elsewhere, reset here
        scene._dpadTargetVisible = true;
        scene._dpadInputDisabled = false;
    }

};



// ============================================================================
// STEP 3 — Editor Mode (NW.js Test Only, LIVE UPDATE)
// ============================================================================
const DPad_EditorMode = {

    fs: null,
    path: null,
    jsonPath: null,
    editorWindow: null,
    savedConfig: {},

    // ---------------------------------------------------------
    // INIT
    // ---------------------------------------------------------
    init() {
        console.log("DPad_EditorMode: Init");

        if (!DPad_Env.isNwjs || !DPad_Env.isTest) {
            console.warn("DPad_EditorMode: Wrong mode — skipped.");
            return;
        }

        this._setupFs();
        this._loadJson();
        this._setupHotkey();
        this._setupMessageListener();
    },

    // ---------------------------------------------------------
    // FILE SYSTEM
    // ---------------------------------------------------------
    _setupFs() {
        this.fs   = require("fs");
        this.path = require("path");

        this.jsonPath = this.path.join(process.cwd(), "data/VirtualDPad.json");

        if (!this.fs.existsSync(this.jsonPath)) {
            console.log("DPad_EditorMode: Creating default config file");
            this._saveJson({});
        }
    },

    // ---------------------------------------------------------
    // LOAD / SAVE
    // ---------------------------------------------------------
    _loadJson() {
        try {
            const raw = this.fs.readFileSync(this.jsonPath, "utf8");
            this.savedConfig = JSON.parse(raw);

            Object.assign(DPad_Core.Config, this.savedConfig);
            DPad_Core._normalizeConfigObj(DPad_Core.Config);

            console.log("DPad_EditorMode: Loaded settings", this.savedConfig);

            DPad_Core.refresh();
        } catch (e) {
            console.error("DPad_EditorMode: Failed to load JSON", e);
            this.savedConfig = {};
        }
    },

    _saveJson(obj) {
        try {
            this.fs.writeFileSync(
                this.jsonPath,
                JSON.stringify(obj, null, 2),
                "utf8"
            );
        } catch (e) {
            console.error("DPad_EditorMode: Failed to save JSON", e);
        }
    },

    // ---------------------------------------------------------
    // Ctrl+Shift+V = Toggle Editor
    // ---------------------------------------------------------
	_setupHotkey() {
		document.addEventListener("keydown", e => {
			if (e.ctrlKey && e.shiftKey && e.code === "KeyV") {
				e.preventDefault();
				this._toggleEditorWindow();
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

    // ---------------------------------------------------------
    // POPUP WINDOW
    // ---------------------------------------------------------
    _openPopup() {
        const html = this._popupHTML();
        const url  = "data:text/html," + encodeURIComponent(html);

        nw.Window.open(url, { width: 520, height: 720 }, win => {
            this.editorWindow = win;
            win.on("closed", () => { this.editorWindow = null; });

            setTimeout(() => {
                this._sendConfigToWindow();
            }, 80);
        });
    },

    // ---------------------------------------------------------
    // POPUP HTML (LIVE UPDATE VERSION)
    // ---------------------------------------------------------
    _popupHTML() {
    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>DPad Live Editor</title>

<style>
body {
    margin: 0;
    padding: 20px;
    background: #222;
    color: #eee;
    font-family: system-ui, sans-serif;
}

h2 {
    margin-bottom: 20px;
}

.grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 24px;
}

fieldset {
    border: 1px solid #444;
    padding: 16px;
    border-radius: 8px;
    margin-bottom: 20px;
}

legend {
    padding: 0 6px;
    font-size: 14px;
    color: #ccc;
}

label {
    display: block;
    margin-top: 12px;
}

input[type="number"],
input[type="text"],
input[type="color"],
select {
    width: 100%;
    padding: 4px;
    margin-top: 4px;
    background: #333;
    color: #eee;
    border: 1px solid #555;
    border-radius: 4px;
}

button {
    padding: 8px 18px;
    margin-top: 10px;
    margin-right: 10px;
}

#btnButtonsConfig {
    display: block;
    margin: 20px auto;
}

</style>
</head>

<body>

<h2>🎮 Virtual D-Pad — Live Editor</h2>

<div class="grid">

    <!-- ================= COLUMN 1 ================= -->
    <fieldset>
        <legend>Joystick</legend>

        <label>Joystick Mode</label>
        <select id="STICK_MODE">
            <option value="0">4-Direction</option>
            <option value="1">8-Direction</option>
            <option value="2">Analog (DotMove)</option>
        </select>

        <label>Pad Size</label>
        <input id="PAD_SIZE" type="number">

        <label>Stick Size</label>
        <input id="STICK_SIZE" type="number">

        <label>Pad Border Color</label>
        <input id="PAD_STROKE_COLOR" type="color">

        <label>Pad Fill Color</label>
        <input id="PAD_FILL_COLOR" type="color">

        <label>Stick Border Color</label>
        <input id="STICK_STROKE_COLOR" type="color">

        <label>Stick Fill Color</label>
        <input id="STICK_FILL_COLOR" type="color">
    </fieldset>

    <!-- ================= COLUMN 2 ================= -->
    <fieldset>
        <legend>Buttons</legend>

        <label>Buttons Size</label>
        <input id="BUTTON_SIZE" type="number">

        <label>Button Color X</label>
        <input id="BUTTON_FILL_COLOR_1" type="color">

        <label>Button Color Y</label>
        <input id="BUTTON_FILL_COLOR_2" type="color">

        <label>Button Color B</label>
        <input id="BUTTON_FILL_COLOR_3" type="color">

        <label>Button Color A</label>
        <input id="BUTTON_FILL_COLOR_4" type="color">

        <label>General Opacity</label>
        <input id="PAD_OPACITY" type="number" min="0" max="255">
		
		<button id="btnButtonsConfig">Buttons Config</button>

    </fieldset>

</div>

<button id="btnSave">Save to JSON</button>
<button id="btnReset">Reset to Defaults</button>

<script>
let currentConfig = {};

function applyToInputs(cfg) {
    for (const key in cfg) {
        const el = document.getElementById(key);
        if (!el) continue;

        el.value = cfg[key];

        el.oninput = () => {
            currentConfig[key] = (el.type === "number")
                ? Number(el.value)
                : el.value;

            window.opener.postMessage(
                { type:"dpadLiveChange", config: currentConfig },
                "*"
            );
        };
    }
}

window.addEventListener("message", e => {
    if (e.data.type === "dpadConfig") {
        currentConfig = { ...e.data.config };
        applyToInputs(currentConfig);
    }
});

document.getElementById("btnSave").onclick = () => {
    window.opener.postMessage(
        { type:"dpadSaveFile", config: currentConfig },
        "*"
    );
};

document.getElementById("btnReset").onclick = () => {
    window.opener.postMessage({ type:"dpadReset" }, "*");
};

document.getElementById("btnButtonsConfig").onclick = () => {
    window.opener.postMessage({ type:"dpadOpenActionsPopup" }, "*");
};

</script>

</body>
</html>`;
},

_actionsPopupHTML() {
return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Button Actions</title>

<style>
body {
    background: #222;
    color: #eee;
    font-family: system-ui, sans-serif;
    padding: 20px;
}
label {
    display:block;
    margin-top: 14px;
    margin-bottom: 6px;
}
select {
    width: 100%;
    padding: 6px;
    background:#333;
    color:#eee;
    border:1px solid #555;
    border-radius:4px;
}
button {
    padding:8px 14px;
    margin-top:20px;
    width:120px;
}
</style>

</head>
<body>

<h2>🎮 Button Actions</h2>

<label>Button X Action</label>
<select id="BUTTON_ACTION_1"></select>

<label>Button Y Action</label>
<select id="BUTTON_ACTION_2"></select>

<label>Button A Action</label>
<select id="BUTTON_ACTION_3"></select>

<label>Button B Action</label>
<select id="BUTTON_ACTION_4"></select>

<button id="save">Save</button>

<script>
let cfg = {};

const ACTIONS = [
    "ok",
	"cancel",
	"menu",
    "shift",
    "pageup",
	"pagedown",
];

function fillOptions() {
    const ids = [
        "BUTTON_ACTION_1",
        "BUTTON_ACTION_2",
        "BUTTON_ACTION_3",
        "BUTTON_ACTION_4"
    ];

    ids.forEach(id=>{
        const s = document.getElementById(id);
        s.innerHTML = "";
        ACTIONS.forEach(a=>{
            const opt = document.createElement("option");
            opt.value = a;
            opt.textContent = a;
            if (cfg[id] === a) opt.selected = true;
            s.appendChild(opt);
        });

        s.oninput = ()=>{
            cfg[id] = s.value;
            window.opener.postMessage({ 
                type:"dpadLiveButtonsChange",
                config: cfg
            },"*");
        };
    });
}

window.addEventListener("message", e=>{
    if (e.data.type === "dpadButtonsConfig") {
        cfg = {...e.data.config};
        fillOptions();
    }
});

document.getElementById("save").onclick = ()=>{
    window.opener.postMessage({
        type:"dpadSaveButtonsConfig",
        config: cfg
    },"*");
};
</script>

</body>
</html>`;
},


    // ---------------------------------------------------------
    // MESSAGE HANDLING
    // ---------------------------------------------------------
    _setupMessageListener() {
        window.addEventListener("message", e => {
            if (!e.data) return;

            switch (e.data.type) {

                case "dpadLiveChange":
                    this._applyLive(e.data.config);
                    break;

                case "dpadSaveFile":
                    this._applySave(e.data.config);
                    break;

                case "dpadReset":
                    this._resetToDefaults();
                    break;
				case "dpadOpenActionsPopup":
					this._openActionsPopup();
					break;
				case "dpadLiveButtonsChange":
					this._applyLiveButtons(e.data.config);
					break;

				case "dpadSaveButtonsConfig":
					this._applySaveButtons(e.data.config);
					break;
            }
        });
    },

    // ---------------------------------------------------------
    // SEND CONFIG TO POPUP
    // ---------------------------------------------------------
    _sendConfigToWindow() {
        if (!this.editorWindow) return;
        this.editorWindow.window.postMessage({
            type: "dpadConfig",
            config: { ...DPad_Core.Config }
        }, "*");
    },

    // ---------------------------------------------------------
    // LIVE APPLY (no saving)
    // ---------------------------------------------------------
    _applyLive(newCfg) {
        DPad_Core._normalizeConfigObj(newCfg);
        Object.assign(DPad_Core.Config, newCfg);

        DPad_Core._refreshFromEditor = true;
        DPad_Core.refresh();
        DPad_Core._refreshFromEditor = false;

    },

    // ---------------------------------------------------------
    // SAVE TO FILE (Persistent)
    // ---------------------------------------------------------
    _applySave(newCfg) {
        DPad_Core._normalizeConfigObj(newCfg);
        Object.assign(DPad_Core.Config, newCfg);

        this._saveJson({ ...DPad_Core.Config });

        DPad_Core._refreshFromEditor = true;
        DPad_Core.refresh();
        DPad_Core._refreshFromEditor = false;

        this._sendConfigToWindow();

        console.log("DPad_EditorMode: Saved to file:", newCfg);
    },

    // ---------------------------------------------------------
    // RESET
    // ---------------------------------------------------------
    _resetToDefaults() {
        console.log("DPad_EditorMode: Reset to defaults");

        DPad_Core._loadPluginParams();
        DPad_Core._normalizeConfigObj(DPad_Core.Config);

        this._saveJson({ ...DPad_Core.Config });
        DPad_Core.refresh();

        this._sendConfigToWindow();
    },

    // ---------------------------------------------------------
    // Open the Buttons Config Pop-up Menu
    // ---------------------------------------------------------
	_openActionsPopup() {
		const html = this._actionsPopupHTML();
		const url  = "data:text/html," + encodeURIComponent(html);

		nw.Window.open(url, { width: 460, height: 460 }, win => {
			this.actionsWindow = win;
			win.on("closed", () => { this.actionsWindow = null; });

			setTimeout(() => {
				this._sendButtonActionsToWindow();
			}, 50);
		});
	},
	
	// ---------------------------------------------------------
	// SEND BUTTON ACTION CONFIG TO ACTIONS POPUP
	// ---------------------------------------------------------
	_sendButtonActionsToWindow() {
		if (!this.actionsWindow) return;

		this.actionsWindow.window.postMessage({
			type: "dpadButtonsConfig",
			config: {
				BUTTON_ACTION_1: DPad_Core.Config.BUTTON_ACTION_1,
				BUTTON_ACTION_2: DPad_Core.Config.BUTTON_ACTION_2,
				BUTTON_ACTION_3: DPad_Core.Config.BUTTON_ACTION_3,
				BUTTON_ACTION_4: DPad_Core.Config.BUTTON_ACTION_4,
			}
		}, "*");
	},
	
    // ---------------------------------------------------------
    // Apply and Save Buttons Config Changes
    // ---------------------------------------------------------
	_applyLiveButtons(cfg) {
		Object.assign(DPad_Core.Config, cfg);
		DPad_Core._refreshFromEditor = true;
        DPad_Core.refresh();
        DPad_Core._refreshFromEditor = false;

	},

	_applySaveButtons(cfg) {
		Object.assign(DPad_Core.Config, cfg);
		this._saveJson({...DPad_Core.Config});
		DPad_Core._refreshFromEditor = true;
        DPad_Core.refresh();
        DPad_Core._refreshFromEditor = false;
	}
};


// ============================================================================
// STEP 4 — Windows Build Mode (NW.js deployed, NO editor)
// ============================================================================
const DPad_WindowsBuild = {

    loadedConfig: {},

    init() {
        console.log("DPad_WindowsBuild: Init");

        // Only run in NW.js deployment — NOT playtest.
        if (!DPad_Env.isNwjs || DPad_Env.isTest) {
            console.warn("DPad_WindowsBuild: Wrong mode — skipped.");
            return;
        }

        this._loadJson();
    },

    // ---------------------------------------------------------
    // Load config from JSON (read-only, via fetch)
    // ---------------------------------------------------------
    async _loadJson() {
        try {
            const response = await fetch("data/VirtualDPad.json");

            if (response.ok) {
                this.loadedConfig = await response.json();
                console.log("DPad_WindowsBuild: Loaded config", this.loadedConfig);

                // Apply to core
                Object.assign(DPad_Core.Config, this.loadedConfig);
                DPad_Core._normalizeConfigObj(DPad_Core.Config);

                // Refresh sprites with updated settings
                DPad_Core.refresh();

            } else {
                console.warn("DPad_WindowsBuild: Defaults used — JSON missing");
            }

        } catch (err) {
            console.error("DPad_WindowsBuild: Failed to load JSON", err);
        }
    },
};


// ============================================================================
// STEP 5 — Browser Mode (HTML5 exports, NO editor)
// ============================================================================
const DPad_BrowserBuild = {

    loadedConfig: {},

    init() {
        console.log("DPad_BrowserBuild: Init");

        // Runs ONLY when NOT NW.js (i.e., true browser environment)
        if (DPad_Env.isNwjs) {
            console.warn("DPad_BrowserBuild: Wrong mode — skipped.");
            return;
        }

        this._loadJson();
    },

    // ---------------------------------------------------------
    // Load config (read-only) via fetch
    // ---------------------------------------------------------
    async _loadJson() {
        try {
            const response = await fetch("data/VirtualDPad.json");

            if (response.ok) {
                this.loadedConfig = await response.json();
                console.log("DPad_BrowserBuild: Loaded config", this.loadedConfig);

                // Apply settings → into runtime config
                Object.assign(DPad_Core.Config, this.loadedConfig);

                DPad_Core._normalizeConfigObj(DPad_Core.Config);
                DPad_Core.refresh();

            } else {
                console.warn("DPad_BrowserBuild: Defaults used — JSON missing");
            }

        } catch (err) {
            console.error("DPad_BrowserBuild: Failed to load JSON", err);
        }
    },
};


// ============================================================================
// STEP 6 — Main Entry Router
// ============================================================================
(() => {

    // Always initialize shared runtime engine first
    DPad_Core.init();

    // Load correct mode-specific module
    switch (DPad_Env.mode) {
        case "editorTest":
            DPad_EditorMode.init();
            break;

        case "windowsBuild":
            DPad_WindowsBuild.init();
            break;

        case "browser":
        default:
            DPad_BrowserBuild.init();
            break;
    }

})();
