"use strict";
/*:
 * @target MZ
 * @plugindesc v0.0.1 Elements Mapping editor placeholder (UI only, no logic).
 * @author You
 *
 * @param Enable auto-opening
 * @type boolean
 * @default false
 * @desc If true, the editor opens automatically when a playtest starts (and will snap per the setting below).
 *
 * @param Snap live editor to
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
 * @desc Position to snap the live editor when auto-opening is enabled.
 *
 * @param Default collision overlay
 * @type boolean
 * @default false
 * @desc Whether the Collision Overlay checkbox starts enabled when the editor opens.
 *
 * @param Default collider outlines
 * @type boolean
 * @default false
 * @desc Whether the Collider Outlines checkbox starts enabled when the editor opens.
 */

/*
Current Plugin Layering Structure:

Ground layer: spriteset._groundLayer (child of tilemap, z = -1000). 
Ground elements’ bottom/base + bottom FX go here.

Base layer: MZ tilemap itself (spriteset._tilemap). 
Non‑ground bottom/base + bottom FX go here. 
Collision debug overlay and collider Layer is also attached here when enabled.

Upper layer: spriteset._upperLayer (z = 10000). 
All top/base + top FX + gradient + editor selection highlights + previews go there.

Collision layer: it isn't a separate render layer. 
it’s a debug overlay sprite added to the tilemap when the toggle is on.
*/

// ============================================================================
// Root object + plugin parameters
// ============================================================================
const ElementsMapping = {};
ElementsMapping._params = (() => {
    const p = PluginManager.parameters("DotMoveSystem_ElementsMappingEx");
    return {
        autoOpen: String(p["Enable auto-opening"] || "false") === "true",
        snapTo: String(p["Snap live editor to"] || "top-left"),
        defaultCollisionOverlay: String(p["Default collision overlay"] || "false") === "true",
        defaultColliderOverlay: String(p["Default collider outlines"] || "false") === "true"
    };
})();

// ============================================================================
// Displacement Filter setup
// ============================================================================
ElementsMapping.DISPLACE_IMAGE = "displace";
ElementsMapping.DISPLACE_SCALE_X = 20;
ElementsMapping.DISPLACE_SCALE_Y = 20;
ElementsMapping.DISPLACE_SPEED_X = 5;
ElementsMapping.DISPLACE_SPEED_Y = 5;

/*
texture: the displacement map image loaded from img/system/ (PNG extension is optional). This texture gets scrolled and sampled by the filter.
scale: { x, y }: base displacement strength in X/Y. Higher values = stronger distortion.
speed: { x, y }: how fast the displacement texture scrolls in X/Y each frame. This is the main motion.
drift: { x, y }: extra micro‑offset added via sine over time to break repetition (small values recommended).
breathe: { x, y }: amount of sinusoidal modulation applied to the filter scale, making the distortion “pulse.”
alpha: { base, variance }: base alpha for the displacement sprite plus a sine‑based wobble. Higher variance = more opacity pulsing.
mode: key name for the preset; used in the FX dropdown (displace:shadowAlive).
*/

ElementsMapping.DisplacementPresets = {
    "01_veryheavyWeight": {
        texture: "displace_flag_horizontal_seamless.png",
        scale: { x: 0.50, y: 2.0 },
        speed: { x: 0.4, y: 0.0 },
        mode: "01_veryheavyWeight"
    },
    "02_heavyWeight": {
        texture: "displace_flag_horizontal_seamless.png",
        scale: { x: 0.50, y: 4.0 },
        speed: { x: 0.6, y: 0.0 },
        mode: "02_heavyWeight"
    },
    "03_mediumWeight": {
        texture: "displace_flag_horizontal_seamless.png",
        scale: { x: 0.75, y: 6.0 },
        speed: { x: 0.8, y: 0.0 },
        mode: "03_mediumWeight"
    },
    "04_lightWeight": {
        texture: "displace_flag_horizontal_seamless.png",
        scale: { x: 1.00, y: 8.0 },
        speed: { x: 1.0, y: 0.0 },
        mode: "04_lightWeight"
    },
    "05_verylightWeight": {
        texture: "displace_flag_horizontal_seamless.png",
        scale: { x: 10.00, y: 10.0 },
        speed: { x: 1.2, y: 0.0 },
        mode: "05_verylightWeight"
    },
    "06_strongFire": {
        texture: "displace_fire_vertical.png",
        scale: { x: 18.0, y: 0.0 },
        speed: { x: 0.0, y: -5.0 },
        mode: "06_strongFire"
    },
    "07_lightFire": {
        texture: "displace_fire_vertical.png",
        scale: { x: 18.0, y: 0.0 },
        speed: { x: 0.0, y: -2.5 },
        mode: "07_lightFire"
    }
};

// ============================================================================
// Data / State
// ============================================================================
ElementsMapping.Store = {
    mapData: {},
    currentElements: [],
    currentMapId: null,
    selectedIndex: -1,
    autoSaveJson: false,
    collisionOverlay: ElementsMapping._params.defaultCollisionOverlay,
    colliderOverlay: ElementsMapping._params.defaultColliderOverlay,

    async loadJson() {
        try {
            const res = await fetch("data/ElementMaps.json");
            this.mapData = res.ok ? await res.json() : {};
        } catch {
            this.mapData = {};
        }
    },

    saveJson() {
        try {
            if (!Utils?.isNwjs?.() || typeof require !== "function") {
                console.warn("ElementsMapping: JSON save skipped (not NW.js environment).");
                return false;
            }
            const fs = require("fs");
            const path = require("path");
            const jsonPath = path.join(process.cwd(), "data/ElementMaps.json");
            fs.writeFileSync(jsonPath, JSON.stringify(this.mapData, null, 2));
            console.log("ElementsMapping: ElementMaps.json saved.");
            return true;
        } catch (e) {
            console.error("ElementsMapping: Failed to save ElementMaps.json", e);
            return false;
        }
    },

    _optionalBitmap(base, name) {
        if (Utils?.isNwjs?.() && typeof require === "function") {
            const fs = require("fs");
            const path = require("path");
            const filePath = path.join(process.cwd(), base, `${name}.png`);
            if (!fs.existsSync(filePath)) return null;
        }
        return ImageManager.loadBitmap(base, name);
    },

    loadElementImages(id) {
        const meta = this._decodeTilesetId(id);
        if (meta) {
            return this._buildTilesetCrops(meta);
        }
        const base = this._resolveElementBase(id);
        return {
            col: ImageManager.loadBitmap(base, "collision_base"),
            bot: ImageManager.loadBitmap(base, "bottom_base"),
            botFx: this._optionalBitmap(base, "bottom_fx01"),
            botFx2: this._optionalBitmap(base, "bottom_fx02"),
            top: ImageManager.loadBitmap(base, "top_base"),
            fx: this._optionalBitmap(base, "top_fx01"),
            fx2: this._optionalBitmap(base, "top_fx02")
        };
    },

    _decodeTilesetId(id) {
        if (typeof id !== "string" || !id.startsWith("tileset:")) return null;
        const parts = id.split(":");
        if (parts.length !== 6) return null;
        const [, encFolder, sx, sy, sw, sh] = parts;
        const folder = decodeURIComponent(encFolder);
        const x = Number(sx), y = Number(sy), w = Number(sw), h = Number(sh);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
        return { folder, x, y, w, h };
    },

    _buildTilesetCrops(meta) {
        const { folder, x, y, w, h } = meta;
        const basePath = `img/elements/tilesets/${folder}/`;
        const src = {
            col: ImageManager.loadBitmap(basePath, "collision_base"),
            bot: ImageManager.loadBitmap(basePath, "bottom_base"),
            botFx: this._optionalBitmap(basePath, "bottom_fx01"),
            botFx2: this._optionalBitmap(basePath, "bottom_fx02"),
            top: ImageManager.loadBitmap(basePath, "top_base"),
            fx: this._optionalBitmap(basePath, "top_fx01"),
            fx2: this._optionalBitmap(basePath, "top_fx02")
        };
        const crop = key => {
            const bmp = new Bitmap(w, h);
            const srcBmp = src[key];
            if (!srcBmp) return null;
            bmp._image = bmp._canvas; // keep drawImage safe
            bmp._elementsPendingBlit = true;
            const redraw = () => {
                if (!srcBmp || !srcBmp.isReady()) return setTimeout(redraw, 16);
                bmp.blt(srcBmp, x, y, w, h, 0, 0);
                bmp._image = bmp._canvas;
                bmp._setDirty?.();
                bmp._elementsPendingBlit = false;
            };
            redraw();
            return bmp;
        };
        return {
            col: crop("col"),
            bot: crop("bot"),
            botFx: crop("botFx"),
            botFx2: crop("botFx2"),
            top: crop("top"),
            fx: crop("fx"),
            fx2: crop("fx2")
        };
    },

    _resolveElementBase(id) {
        if (!id) return `img/elements/${id}/`;
        if (id.startsWith("singles/")) return `img/elements/${id}/`;
        const defaultBase = `img/elements/${id}/`;
        const singlesDirect = `img/elements/singles/${id}/`;
        try {
            if (Utils?.isNwjs?.() && typeof require === "function") {
            const fs = require("fs");
            const path = require("path");
            const cwd = process.cwd();
            const existsPng = rel => fs.existsSync(path.join(cwd, rel, "collision_base.png"));
                if (existsPng(singlesDirect)) return singlesDirect;
                if (!id.includes("/")) {
                    const singlesRoot = path.join(cwd, "img", "elements", "singles");
                    if (fs.existsSync(singlesRoot)) {
                        const cats = fs.readdirSync(singlesRoot, { withFileTypes: true })
                            .filter(d => d.isDirectory())
                            .map(d => d.name);
                        for (const cat of cats) {
                            const candidate = `img/elements/singles/${cat}/${id}/`;
                            if (existsPng(candidate)) return candidate;
                        }
                    }
                }
                if (existsPng(defaultBase)) return defaultBase;
            }
        } catch {
            // ignore and fall through
        }
        return defaultBase;
    },

    waitForBitmaps(elements) {
        const wait = bmp => new Promise(resolve => {
            const tick = () => {
                if (bmp?._elementsPendingBlit) return setTimeout(tick, 16);
                if (bmp && typeof bmp.isReady === "function" && bmp.isReady()) return resolve();
                return setTimeout(tick, 16);
            };
            tick();
        });
        const promises = [];
        elements.forEach(el => {
            ["col", "bot", "top", "fx", "fx2", "botFx", "botFx2"].forEach(key => {
                const bmp = el.images?.[key];
                if (bmp) promises.push(wait(bmp));
            });
        });
        return Promise.all(promises);
    }
};

// ============================================================================
// Shared displacement filter applied only to FX sprites
// ============================================================================
ElementsMapping.DisplacementFX = {
    instances: [],
    _lastDisplayX: null,
    _lastDisplayY: null,

    _normalizeTextureName(name) {
        if (!name) return "";
        return String(name).toLowerCase().endsWith(".png") ? String(name).slice(0, -4) : String(name);
    },

    _getPreset(key) {
        return ElementsMapping.DisplacementPresets?.[key] || null;
    },

    getPresetKey(mode) {
        if (!mode) return null;
        const text = String(mode);
        if (text.startsWith("displace:")) return text.slice("displace:".length);
        return null;
    },

    ensure(spriteset) {
        return this.ensureInstance(null, spriteset);
    },

    ensureInstance(presetKey, spriteset) {
        const key = presetKey || "";
        if (key) {
            const existing = this.instances.find(inst => inst.key === key);
            if (existing) return existing;
        }
        const preset = key ? this._getPreset(key) : null;
        if (!preset) return null;
        if (!PIXI.filters?.DisplacementFilter) return null;
        const textureName = this._normalizeTextureName(preset.texture || ElementsMapping.DISPLACE_IMAGE);
        const bitmap = ImageManager.loadSystem(textureName);
        const sprite = new Sprite();
        const buildGrid = () => {
            const w = bitmap.width || 1;
            const h = bitmap.height || 1;
            if (!w || !h) return;
            const tiled = new Bitmap(w * 3, h * 3);
            for (let iy = 0; iy < 3; iy++) {
                for (let ix = 0; ix < 3; ix++) {
                    tiled.blt(bitmap, 0, 0, w, h, ix * w, iy * h);
                }
            }
            sprite.bitmap = tiled;
            sprite._emTileW = w;
            sprite._emTileH = h;
        };
        buildGrid();
        bitmap.addLoadListener(buildGrid);
        sprite.alpha = preset.alpha?.base ?? 1.0;
        sprite.z = 999998;
        const filter = new PIXI.filters.DisplacementFilter(sprite);
        const scaleX = preset.scale?.x ?? ElementsMapping.DISPLACE_SCALE_X;
        const scaleY = preset.scale?.y ?? ElementsMapping.DISPLACE_SCALE_Y;
        filter.scale.set(scaleX, scaleY);
        filter._emState = {
            t: Math.random() * 1000,
            t2: Math.random() * 1000,
            ox: 0,
            oy: 0
        };

        // manual start offset (pixels inside the map)
        filter._emState.ox = 256;
        filter._emState.oy = 256;
        const parent = spriteset?._upperLayer || spriteset;
        parent?.addChild(sprite);
        const inst = { key, preset, sprite, filter };
        this.instances.push(inst);
        return inst;
    },

    applyTo(sprite, spriteset, presetKey) {
        if (!sprite) return;
        const inst = this.ensureInstance(presetKey, spriteset);
        if (!inst || !inst.filter) return;
        const list = Array.isArray(sprite.filters) ? sprite.filters.slice() : [];
        if (!list.includes(inst.filter)) {
            list.push(inst.filter);
            sprite.filters = list;
        }
    },

    _getScrollDelta() {
        const map = $gameMap;
        if (!map) return { dx: 0, dy: 0 };
        const tw = typeof map.tileWidth === "function" ? map.tileWidth() : 48;
        const th = typeof map.tileHeight === "function" ? map.tileHeight() : 48;
        const dispX = typeof map.displayX === "function" ? map.displayX() : (map._displayX || 0);
        const dispY = typeof map.displayY === "function" ? map.displayY() : (map._displayY || 0);
        if (this._lastDisplayX == null || this._lastDisplayY == null) {
            this._lastDisplayX = dispX;
            this._lastDisplayY = dispY;
            return { dx: 0, dy: 0 };
        }
        const dx = (dispX - this._lastDisplayX) * tw;
        const dy = (dispY - this._lastDisplayY) * th;
        this._lastDisplayX = dispX;
        this._lastDisplayY = dispY;
        return { dx, dy };
    },

    updateDisplacement(filter, sprite, preset, scrollDx = 0, scrollDy = 0) {
        if (!filter || !sprite || !preset) return;
        const s = filter._emState;
        if (!s) return;

        s.t += 0.001;
        s.t2 += 0.0007;

        s.ox += preset.speed?.x || 0;
        s.oy += preset.speed?.y || 0;

        if (preset.drift) {
            s.ox += Math.sin(s.t * 2.1) * (preset.drift.x || 0);
            s.oy += Math.sin(s.t2 * 1.7) * (preset.drift.y || 0);
        }
        if (scrollDx || scrollDy) {
            s.ox -= scrollDx;
            s.oy -= scrollDy;
        }

        const w = sprite._emTileW || 1;
        const h = sprite._emTileH || 1;
        s.ox = ((s.ox % w) + w) % w;
        s.oy = ((s.oy % h) + h) % h;
        sprite.x = -w + s.ox;
        sprite.y = -h + s.oy;

        const bx = preset.breathe?.x || 0;
        const by = preset.breathe?.y || 0;
        const baseX = preset.scale?.x ?? 1;
        const baseY = preset.scale?.y ?? 1;
        filter.scale.x = baseX * (1 + Math.sin(s.t) * bx);
        filter.scale.y = baseY * (1 + Math.sin(s.t2) * by);

        if (preset.alpha) {
            const a = preset.alpha;
            sprite.alpha =
                (a.base ?? 1.0) +
                Math.sin(s.t * (a.speed1 || 1)) * (a.variance || 0) +
                Math.sin(s.t2 * (a.speed2 || 1)) * (a.variance || 0);
        }
    },

    update() {
        if (!this.instances.length) return;
        const scroll = this._getScrollDelta();
        this.instances.forEach(inst => {
            this.updateDisplacement(inst.filter, inst.sprite, inst.preset, scroll.dx, scroll.dy);
        });
    },

    clear() {
        this.instances.forEach(inst => {
            if (inst.sprite?.parent) inst.sprite.parent.removeChild(inst.sprite);
        });
        this.instances = [];
        this._lastDisplayX = null;
        this._lastDisplayY = null;
    }
};

ElementsMapping._setBlendMode = (sprite, mode) => {
    if (!sprite) return;
    const text = String(mode || "opaque");
    if (text.startsWith("displace:")) {
        sprite.blendMode = PIXI.BLEND_MODES.NORMAL;
        return;
    }
    if (text === "multiply") sprite.blendMode = PIXI.BLEND_MODES.MULTIPLY;
    else if (text === "add") sprite.blendMode = PIXI.BLEND_MODES.ADD;
    else if (text === "screen") sprite.blendMode = PIXI.BLEND_MODES.SCREEN;
    else sprite.blendMode = PIXI.BLEND_MODES.NORMAL;
};

ElementsMapping._fxModeOptionsHtml = () => {
    const base = [
        { value: "opaque", label: "Opaque" },
        { value: "multiply", label: "Multiply" },
        { value: "add", label: "Add" },
        { value: "screen", label: "Screen" }
    ];
    const presets = ElementsMapping.DisplacementPresets || {};
    const presetKeys = Object.keys(presets).sort((a, b) => a.localeCompare(b));
    let html = base.map(opt => `          <option value="${opt.value}">${opt.label}</option>`).join("\n");
    presetKeys.forEach(key => {
        html += `\n          <option value="displace:${key}">Displace: ${key}</option>`;
    });
    return html;
};

// ============================================================================
// Gradient/bitmap helpers
// ============================================================================
ElementsMapping._createGradientBitmap = function(width, height, stops, orientation = "vertical") {
    const bmp = new Bitmap(width, height);
    const ctx = bmp._context;
    const grad = orientation === "horizontal"
        ? ctx.createLinearGradient(0, 0, width, 0)
        : ctx.createLinearGradient(0, 0, 0, height);

    Object.keys(stops || {})
        .map(parseFloat)
        .filter(n => Number.isFinite(n))
        .sort((a, b) => a - b)
        .forEach(stop => {
            const clamped = Math.min(1, Math.max(0, stop));
            grad.addColorStop(clamped, stops[stop]);
        });

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
    bmp._setDirty?.();
    return bmp;
};

ElementsMapping._bitmapOpaqueBounds = function(bmp) {
    try {
        if (!bmp || typeof bmp.isReady !== "function" || !bmp.isReady()) return null;
        if (!bmp._context) return null;
        const w = bmp.width;
        const h = bmp.height;
        const data = bmp._context.getImageData(0, 0, w, h).data;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const a = data[(y * w + x) * 4 + 3];
                if (a !== 0) {
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < minX || maxY < minY) return null;
        return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    } catch {
        return null;
    }
};

ElementsMapping._playerFootPixel = function() {
    if (!$gamePlayer || typeof $gamePlayer.collisionRect !== "function") return null;
    const rect = $gamePlayer.collisionRect();
    if (!rect) return null;
    const tw = $gameMap.tileWidth();
    const th = $gameMap.tileHeight();
    return {
        x: (rect.x + rect.width / 2) * tw,
        y: (rect.y + rect.height) * th
    };
};

ElementsMapping._alphaAtPixel = function(bmp, x, y) {
    try {
        if (!bmp || typeof bmp.isReady !== "function" || !bmp.isReady()) return 0;
        if (typeof bmp.getAlphaPixel === "function") return bmp.getAlphaPixel(x, y) || 0;
        if (bmp._context) {
            const data = bmp._context.getImageData(x, y, 1, 1).data;
            return data?.[3] || 0;
        }
    } catch (e) {
        //
    }
    return 0;
};

// ============================================================================
// Map lifecycle
// ============================================================================
ElementsMapping.MapLifecycle = {
    async onMapStart() {
        try {
            const mapId = $gameMap?.mapId?.();
            if (!mapId) return;
            ElementsMapping.Collision.hookDotMoveSystem();
            await ElementsMapping.Store.loadJson();
            const list = Array.isArray(ElementsMapping.Store.mapData[mapId]) ? ElementsMapping.Store.mapData[mapId] : [];
            const elements = list.map((e, i) => ({
                id: e.id,
                x: e.x,
                y: e.y,
                useGradient: !!e.useGradient,
                isGround: !!e.isGround,
                useBottomFx: e.useBottomFx !== undefined ? !!e.useBottomFx : !!e.botFx,
                bottomFxMode: e.bottomFxMode || "opaque",
                useBottomFx2: e.useBottomFx2 !== undefined ? !!e.useBottomFx2 : !!e.useBottomFx,
                bottomFxMode2: e.bottomFxMode2 || e.bottomFxMode || "opaque",
                useFx: e.useFx !== undefined ? !!e.useFx : true,
                fxMode: e.fxMode || "opaque",
                useFx2: e.useFx2 !== undefined ? !!e.useFx2 : !!e.useFx,
                fxMode2: e.fxMode2 || e.fxMode || "opaque",
                _index: i,
                images: ElementsMapping.Store.loadElementImages(e.id)
            }));
            await ElementsMapping.Store.waitForBitmaps(elements);
            ElementsMapping.Store.currentMapId = mapId;
            ElementsMapping.Store.currentElements = elements;
            ElementsMapping.Store.selectedIndex = -1;
            ElementsMapping.Collision.build(elements);
            const spriteset = SceneManager._scene?._spriteset;
            ElementsMapping.Collision.attachOverlays(spriteset);
            if (spriteset) {
                ElementsMapping.Renderer.create(elements, spriteset);
                ElementsMapping.Renderer.refreshNow();
            }
            ElementsMapping.Editor.sendState();
        } catch (e) {
            console.error("ElementsMapping: failed to prepare map elements", e);
        }
    },

    onMapEnd() {
        ElementsMapping.Store.currentElements = [];
        ElementsMapping.Store.currentMapId = null;
        ElementsMapping.Store.selectedIndex = -1;
        ElementsMapping.Collision.clearOverlays();
        ElementsMapping.Collision.reset();
        ElementsMapping.Renderer.clear?.();
        ElementsMapping.DisplacementFX.clear();
        ElementsMapping.Editor.sendState();
    }
};

// ============================================================================
// Collision / LOS DotMoveSystem Compatibility
// ============================================================================
ElementsMapping.Collision = {
    canvas: null,
    ctx: null,
    pixels: null,
    width: 0,
    height: 0,
    blockers: [],
    blockerSet: new Set(),
    losBlockerSet: new Set(),
    debugSprite: null,
    colliderLayer: null,

    build(elements) {
        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        this.width = $gameMap.width() * tw;
        this.height = $gameMap.height() * th;
        this.canvas = document.createElement("canvas");
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx = this.canvas.getContext("2d");
        this.ctx.clearRect(0, 0, this.width, this.height);

        for (const el of elements || []) {
            const bmp = el.images?.col;
            if (!bmp || !bmp.isReady?.()) continue;
            const x = Math.round(el.x - bmp.width / 2);
            const y = Math.round(el.y - bmp.height);
            this.ctx.drawImage(bmp._image || bmp.canvas || bmp._canvas || bmp.bitmap || bmp.baseTexture?.resource?.source || bmp, x, y);
        }

        const img = this.ctx.getImageData(0, 0, this.width, this.height);
        this.pixels = img.data;
        this._scanPixels();
    },

    _scanPixels() {
        this.blockers.length = 0;
        this.blockerSet.clear();
        this.losBlockerSet.clear();
        if (!this.pixels) return;
        const w = this.width;
        const h = this.height;
        const img = this.pixels;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const i = (y * w + x) * 4;
                const r = img[i], g = img[i + 1], b = img[i + 2], a = img[i + 3];
                if (a === 0) continue;
                if (r === 255 && g === 0 && b === 0) {
                    this.blockers.push({ x, y });
                    this.blockerSet.add(`${x},${y}`);
                    this.losBlockerSet.add(`${x},${y}`);
                } else if (r === 255 && g === 165 && b === 0) {
                    this.blockers.push({ x, y });
                    this.blockerSet.add(`${x},${y}`);
                }
            }
        }
    },

    rectOverlapsSolid(px, py, pw, ph) {
        const step = 3;
        const x1 = px | 0, y1 = py | 0;
        const x2 = (px + pw) | 0, y2 = (py + ph) | 0;
        for (let y = y1; y <= y2; y += step) {
            if (this.blockerSet.has(`${x1},${y}`)) return true;
            if (this.blockerSet.has(`${x2},${y}`)) return true;
        }
        for (let x = x1; x <= x2; x += step) {
            if (this.blockerSet.has(`${x},${y1}`)) return true;
            if (this.blockerSet.has(`${x},${y2}`)) return true;
        }
        return false;
    },

    attachOverlays(spriteset) {
        if (!spriteset) return;
        this._removeDebugLayers({ overlay: true, colliders: true });

        const debugBmp = this.buildDebugBitmap();
        if (ElementsMapping.Store.collisionOverlay && debugBmp) {
            this._attachDebugSprite(debugBmp, spriteset);
        }

        if (ElementsMapping.Store.colliderOverlay) {
            if (!this.colliderLayer) {
                this.colliderLayer = new PIXI.Graphics();
                this.colliderLayer.zIndex = 999999;
                (spriteset._tilemap || spriteset).addChild(this.colliderLayer);
            }
            this.colliderLayer.visible = true;
            this.updateColliderLayer();
        } else if (this.colliderLayer) {
            this.colliderLayer.clear();
            this.colliderLayer.visible = false;
        }
    },

    clearOverlays() {
        this._removeDebugLayers({ overlay: true, colliders: true });
    },

    reset() {
        this._removeDebugLayers({ overlay: true, colliders: true });
        this.canvas = null;
        this.ctx = null;
        this.pixels = null;
        this.width = 0;
        this.height = 0;
        this.blockers.length = 0;
        this.blockerSet.clear();
        this.losBlockerSet.clear();
    },

    buildDebugBitmap() {
        if (!this.pixels || !ElementsMapping.Store.collisionOverlay) return null;

        const bmp = new Bitmap(this.width, this.height);
        const out = bmp._context.getImageData(0, 0, this.width, this.height);
        const inp = this.pixels;
        let any = false;

        for (let i = 0; i < inp.length; i += 4) {
            const r = inp[i], g = inp[i + 1], b = inp[i + 2], a = inp[i + 3];
            if (a === 0) continue;
            if (r === 255 && g === 0 && b === 0) {
                out.data[i] = 255;
                out.data[i + 1] = 0;
                out.data[i + 2] = 0;
                out.data[i + 3] = 192;
                any = true;
            } else if (r === 255 && g === 165 && b === 0) {
                out.data[i] = 255;
                out.data[i + 1] = 165;
                out.data[i + 2] = 0;
                out.data[i + 3] = 192;
                any = true;
            }
        }

        if (!any) return null;
        bmp._context.putImageData(out, 0, 0);

        const ctx = bmp._context;
        const w = this.width;
        const h = this.height;
        const data = out.data;
        const idx = (x, y) => (y * w + x) * 4 + 3;
        const isSolid = (x, y) =>
            x >= 0 && y >= 0 && x < w && y < h && data[idx(x, y)] !== 0;

        ctx.save();
        ctx.fillStyle = "rgba(255,255,0,1)";
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!isSolid(x, y)) continue;
                if (!isSolid(x - 1, y) || !isSolid(x + 1, y) || !isSolid(x, y - 1) || !isSolid(x, y + 1)) {
                    ctx.fillRect(x, y, 2, 2);
                }
            }
        }
        ctx.restore();

        bmp._setDirty?.();
        return bmp;
    },

    updateColliderLayer() {
        if (!this.colliderLayer) return;
        const g = this.colliderLayer;
        g.clear();

        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        const ox = $gameMap.displayX() * tw;
        const oy = $gameMap.displayY() * th;

        const drawRect = (rect, color) => {
            if (!rect) return;
            g.lineStyle(2, color, 0.85);
            g.beginFill(color, 0.15);
            g.drawRect(
                rect.x * tw - ox,
                rect.y * th - oy,
                rect.width * tw,
                rect.height * th
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

    _updateOverlayPosition() {
        if (!this.debugSprite) return;
        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        this.debugSprite.x = -$gameMap.displayX() * tw;
        this.debugSprite.y = -$gameMap.displayY() * th;
    },

    _attachDebugSprite(bitmap, spriteset) {
        if (!bitmap || !spriteset) return null;
        const sprite = new Sprite(bitmap);
        sprite.alpha = 0.25;
        sprite.z = 999999;
        sprite.zIndex = 999999;
        spriteset.addChild(sprite);
        this.debugSprite = sprite;
        this._updateOverlayPosition();
        return sprite;
    },

    _removeDebugLayers({ overlay = true, colliders = true } = {}) {
        if (overlay && this.debugSprite?.parent) {
            this.debugSprite.parent.removeChild(this.debugSprite);
        }
        if (overlay) this.debugSprite = null;

        if (colliders) {
            if (this.colliderLayer?.parent) {
                this.colliderLayer.parent.removeChild(this.colliderLayer);
            }
            this.colliderLayer = null;
        }
    },

    rebuildDebugLayers(scene) {
        if (!(scene instanceof Scene_Map)) return;
        if (!ElementsMapping.Store.currentElements.length) return;

        this.build(ElementsMapping.Store.currentElements);
        this._removeDebugLayers({ overlay: true, colliders: false });

        const debugBmp = this.buildDebugBitmap();
        if (ElementsMapping.Store.collisionOverlay && debugBmp) {
            this._attachDebugSprite(debugBmp, scene._spriteset);
        }

        if (ElementsMapping.Store.colliderOverlay) {
            if (!this.colliderLayer) {
                this.colliderLayer = new PIXI.Graphics();
                this.colliderLayer.zIndex = 999999;
                scene._spriteset._tilemap.addChild(this.colliderLayer);
            }
            this.colliderLayer.visible = true;
            this.updateColliderLayer();
        } else if (this.colliderLayer) {
            this.colliderLayer.clear();
            this.colliderLayer.visible = false;
        }
    },

    hookDotMoveSystem() {
        const DMS = window.DotMoveSystem;
        if (!DMS || !DMS.CharacterCollisionChecker) return;
        const proto = DMS.CharacterCollisionChecker.prototype;
        if (proto.__elements_collision_hook__) return;
        proto.__elements_collision_hook__ = true;
        const _check = proto.checkCollisionMasses;
        proto.checkCollisionMasses = function(x, y, d, option) {
            const result = _check.call(this, x, y, d, option);
            const base = Array.isArray(result) ? result.slice() : [];
            if (!ElementsMapping.Collision.blockerSet.size) return base;
            const tw = $gameMap.tileWidth();
            const th = $gameMap.tileHeight();
            const char = this._character;
            const rect = char.collisionRect();
            const currPx = rect.x * tw;
            const currPy = rect.y * th;
            const currPw = rect.width * tw;
            const currPh = rect.height * th;
            const nextPx = x * tw;
            const nextPy = y * th;
            const nextPw = currPw;
            const nextPh = currPh;
            if (ElementsMapping.Collision.rectOverlapsSolid(currPx, currPy, currPw, currPh)) {
                return base.length ? base : [];
            }
            if (ElementsMapping.Collision.rectOverlapsSolid(nextPx, nextPy, nextPw, nextPh)) {
                const hitX = nextPx + nextPw / 2;
                const hitY = nextPy + nextPh / 2;
                if (Number.isFinite(hitX) && Number.isFinite(hitY)) {
                    const blockRect = new DMS.DotMoveRectangle(hitX / tw, hitY / th, 1 / tw, 1 / th);
                    base.push(new DMS.CollisionResult(rect, blockRect, char));
                }
                return base;
            }
            return base;
        };
    }
};
// ============================================================================
// Renderer for element sprites (bottom/top/fx layers)
// ============================================================================
ElementsMapping.Renderer = {
    sprites: [],
    _ensureGroundLayer(spriteset) {
        if (!spriteset) return null;
        const tilemap = spriteset._tilemap || spriteset;
        if (!tilemap) return null;
        if (!spriteset._groundLayer) {
            const layer = new Sprite();
            layer.z = -1000;
            layer._elementsLayer = "ground";
            tilemap.addChild(layer);
            spriteset._groundLayer = layer;
        }
        return spriteset._groundLayer;
    },

    create(elements, spriteset) {
        this.clear();
        const tilemap = spriteset?._tilemap || spriteset;
        const groundLayer = this._ensureGroundLayer(spriteset);
        const tileH   = $gameMap.tileHeight();
        const tileW   = $gameMap.tileWidth();

        if (!spriteset?._upperLayer) {
            spriteset._upperLayer = new Sprite();
            spriteset._upperLayer.z = 10000;
            spriteset.addChild(spriteset._upperLayer);
        }

        for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
            const el = elements[elementIndex];
            const colBmp = el.images.col;
            const botBmp = el.images.bot;
            const topBmp = el.images.top;
            const fxBmp  = el.images.fx;
            const fx2Bmp = el.images.fx2;
            // Require mandatory sheets: collision, bottom, top
            if (!colBmp || !botBmp || !topBmp) continue;

            const useGradient = !!el.useGradient;
            const useFxLayer = (el.useFx !== undefined) ? !!el.useFx : !!fxBmp;
            const useFxLayer2 = (el.useFx2 !== undefined) ? !!el.useFx2 : !!fx2Bmp;
            const gradientBmp = useGradient ? topBmp : null;
            if (useGradient && !gradientBmp) continue;

            const bot = new Sprite(botBmp);
            bot._elementsLayer = "tilemap";
            const top = useGradient ? null : new Sprite(topBmp);
            if (top) top._elementsLayer = "upper";
            const fxPlain  = useGradient ? new Sprite(gradientBmp) : null;
            const fxMasked = useGradient ? new Sprite(gradientBmp) : null;
            if (fxPlain) fxPlain._elementsLayer = "upper";
            if (fxMasked) fxMasked._elementsLayer = "upper";
            const botFxBmp = el.images.botFx;
            const botFx2Bmp = el.images.botFx2;

            const fxLayerDefs = [];
            if (useFxLayer && fxBmp) fxLayerDefs.push({ bmp: fxBmp, mode: el.fxMode || "opaque", key: "fx1" });
            if (useFxLayer2 && fx2Bmp) fxLayerDefs.push({ bmp: fx2Bmp, mode: el.fxMode2 || el.fxMode || "opaque", key: "fx2" });
            const fxSolo = fxLayerDefs.filter(() => !useGradient).map(def => {
                const sp = new Sprite(def.bmp);
                sp._elementsLayer = "upper";
                return { ...def, sprite: sp };
            });
            const fxGradient = fxLayerDefs.filter(() => useGradient).map(def => ({
                ...def,
                plain: new Sprite(def.bmp),
                masked: new Sprite(def.bmp)
            }));
            fxGradient.forEach(layer => {
                layer.plain._elementsLayer = "upper";
                layer.masked._elementsLayer = "upper";
            });
            const sel = new PIXI.Graphics();
            sel._elementsLayer = "upper";

            const botH = botBmp.height;
            const topH = topBmp.height;
            const fxH  = gradientBmp ? gradientBmp.height : 0;
            let fxMask = null;
            let fxMaskBmp = null;
            let fxBounds = null;
            const gradientStops = {
                0.0:  "rgba(255,255,255,0.30)",
                0.7: "rgba(255,255,255,0.50)",
                0.8: "rgba(255,255,255,0.80)",
                0.9: "rgba(255,255,255,1)",
                1.0:  "rgba(255,255,255,1)"
            };
            const ensureFxMask = () => {
                if (!useGradient) return;
                if (fxMask || !gradientBmp?.isReady?.()) return;
                fxBounds = ElementsMapping._bitmapOpaqueBounds(gradientBmp);
                const maskH = fxBounds?.height || gradientBmp.height;
                const maskW = gradientBmp.width;
                fxMaskBmp = ElementsMapping._createGradientBitmap(maskW, maskH, gradientStops, "vertical");
                fxMask = new Sprite(fxMaskBmp);
                fxMask._elementsLayer = "upper";
                fxMask.visible = false;
                spriteset._upperLayer.addChild(fxMask);
                this.sprites.push(fxMask);
            };
            const applyFxMode = (sprite, mode) => {
                if (!sprite) return;
                const presetKey = ElementsMapping.DisplacementFX.getPresetKey(mode);
                if (presetKey) {
                    ElementsMapping.DisplacementFX.applyTo(sprite, spriteset, presetKey);
                }
                ElementsMapping._setBlendMode(sprite, mode);
            };
            fxSolo.forEach(layer => applyFxMode(layer.sprite, layer.mode));
            fxGradient.forEach(layer => {
                applyFxMode(layer.plain, layer.mode);
                applyFxMode(layer.masked, layer.mode);
            });

            bot.update = function() {
                const ox = $gameMap.displayX() * tileW;
                const oy = $gameMap.displayY() * tileH;
                this.x = el.x - this.width / 2 - ox;
                this.y = el.y - botH - oy;
                this.z = el.isGround ? 0 : 1;
            };
            const botFxSprites = [];
            if (el.useBottomFx && botFxBmp) {
                const sp = new Sprite(botFxBmp);
                sp._elementsLayer = "tilemap";
                sp.z = el.isGround ? 0 : 2;
                botFxSprites.push({ sprite: sp, bmp: botFxBmp, mode: el.bottomFxMode || "opaque" });
            }
            if (el.useBottomFx2 && botFx2Bmp) {
                const sp = new Sprite(botFx2Bmp);
                sp._elementsLayer = "tilemap";
                sp.z = el.isGround ? 0 : 2;
                botFxSprites.push({ sprite: sp, bmp: botFx2Bmp, mode: el.bottomFxMode2 || el.bottomFxMode || "opaque" });
            }
            botFxSprites.forEach(layer => {
                const h = layer.bmp.height;
                const presetKey = ElementsMapping.DisplacementFX.getPresetKey(layer.mode);
                if (presetKey) {
                    ElementsMapping.DisplacementFX.applyTo(layer.sprite, spriteset, presetKey);
                }
                ElementsMapping._setBlendMode(layer.sprite, layer.mode);
                layer.sprite.update = function() {
                    const ox = $gameMap.displayX() * tileW;
                    const oy = $gameMap.displayY() * tileH;
                    this.x = el.x - this.width / 2 - ox;
                    this.y = el.y - h - oy;
                    this.z = el.isGround ? 0 : 2;
                };
            });

            if (top) {
                top.update = function() {
                    const ox = $gameMap.displayX() * tileW;
                    const oy = $gameMap.displayY() * tileH;
                    this.x = el.x - this.width / 2 - ox;
                    this.y = el.y - topH - oy + 0.5;
                    this.z = Number(el.y) || 0;
                };
            }

            if (useGradient && fxPlain && fxMasked) {
                let fadeTimer = 0;
                const fadeFrames = 60;
                const updateFxSprites = function() {
                    ensureFxMask();
                    const ox = $gameMap.displayX() * tileW;
                    const oy = $gameMap.displayY() * tileH;

                    const x = el.x - gradientBmp.width / 2 - ox;
                    const y = el.y - fxH - oy + 0.5;
                    fxPlain.x = x;
                    fxPlain.y = y;
                    fxMasked.x = x;
                    fxMasked.y = y;
                    const depthZ = Number(el.y) || 0;
                    fxPlain.z = depthZ;
                    fxMasked.z = depthZ;
                    fxGradient.forEach(layer => {
                        const lx = el.x - layer.bmp.width / 2 - ox;
                        const ly = el.y - layer.bmp.height - oy + 0.5;
                        layer.plain.x = lx;
                        layer.plain.y = ly;
                        layer.masked.x = lx;
                        layer.masked.y = ly;
                        layer.plain.z = depthZ;
                        layer.masked.z = depthZ;
                    });

                    const foot = ElementsMapping._playerFootPixel();
                    let inside = false;
                    if (foot && gradientBmp.isReady?.()) {
                        const left = el.x - gradientBmp.width / 2;
                        const topPos = el.y - fxH;
                        const px = Math.floor(foot.x - left);
                        const py = Math.floor(foot.y - topPos);
                        if (px >= 0 && py >= 0 && px < gradientBmp.width && py < gradientBmp.height) {
                            inside = ElementsMapping._alphaAtPixel(gradientBmp, px, py) > 0;
                        }
                    }

                    if (inside) fadeTimer = Math.min(fadeFrames, fadeTimer + 1);
                    else fadeTimer = Math.max(0, fadeTimer - 1);
                    const t = fadeFrames > 0 ? fadeTimer / fadeFrames : 1;

                    fxPlain.alpha = 1 - t;
                    fxMasked.alpha = t > 0 ? 1 : 0;
                    fxGradient.forEach(layer => {
                        layer.plain.alpha = 1 - t;
                        layer.masked.alpha = t > 0 ? 1 : 0;
                    });

                    if (fxMask) {
                        const yOffset = fxBounds ? fxBounds.y : 0;
                        fxMask.x = x;
                        fxMask.y = y + yOffset;
                        fxMask.z = fxMasked.z;
                        fxMask.zIndex = fxMasked.zIndex;
                        fxMasked.mask = fxMask;
                        fxMask.visible = fxMasked.alpha > 0;
                    }
                    fxGradient.forEach(layer => {
                        if (!layer.masked) return;
                        layer.masked.mask = fxMask;
                    });
                    if (fxMask) {
                        const anyMasked = fxGradient.some(layer => layer.masked?.alpha > 0) || fxMasked.alpha > 0;
                        fxMask.visible = anyMasked;
                    }
                };

                fxPlain.update = updateFxSprites;
                fxMasked.update = updateFxSprites;
                fxGradient.forEach(layer => {
                    if (layer.plain) layer.plain.update = updateFxSprites;
                    if (layer.masked) layer.masked.update = updateFxSprites;
                });
            }

            fxSolo.forEach(layer => {
                const h = layer.bmp.height;
                layer.sprite.update = function() {
                    const ox = $gameMap.displayX() * tileW;
                    const oy = $gameMap.displayY() * tileH;
                    this.x = el.x - this.width / 2 - ox;
                    this.y = el.y - h - oy + 0.5;
                    this.z = Number(el.y) || 0;
                };
            });

            sel.update = function() {
                const isSelected = elementIndex === ElementsMapping.Store.selectedIndex;
                this.visible = isSelected;
                if (!isSelected) return;
                const colBmp = el.images?.col;
                if (!colBmp || !colBmp.isReady()) return;

                const ox = $gameMap.displayX() * tileW;
                const oy = $gameMap.displayY() * tileH;
                const x = el.x - colBmp.width / 2 - ox;
                const y = el.y - colBmp.height - oy;

                this.clear();
                this.lineStyle(4, 0xffff00, 0.95);
                this.beginFill(0xffff00, 0.08);
                this.drawRect(x, y, colBmp.width, colBmp.height);
                this.endFill();

                if (this.parent?.setChildIndex) {
                    this.parent.setChildIndex(this, this.parent.children.length - 1);
                }
            };

            if (el.isGround && groundLayer) {
                groundLayer.addChild(bot);
                botFxSprites.forEach(layer => groundLayer.addChild(layer.sprite));
            } else {
                tilemap.addChild(bot);
                botFxSprites.forEach(layer => tilemap.addChild(layer.sprite));
            }
            if (top) spriteset._upperLayer.addChild(top);
            if (fxPlain) spriteset._upperLayer.addChild(fxPlain);
            if (fxMasked) spriteset._upperLayer.addChild(fxMasked);
            fxGradient.forEach(layer => {
                if (layer.plain) spriteset._upperLayer.addChild(layer.plain);
                if (layer.masked) spriteset._upperLayer.addChild(layer.masked);
            });
            fxSolo.forEach(layer => {
                if (layer.sprite) spriteset._upperLayer.addChild(layer.sprite);
            });
            spriteset._upperLayer.addChild(sel);

            this.sprites.push(bot);
            botFxSprites.forEach(layer => this.sprites.push(layer.sprite));
            if (top) this.sprites.push(top);
            if (fxPlain) this.sprites.push(fxPlain);
            if (fxMasked) this.sprites.push(fxMasked);
            fxGradient.forEach(layer => {
                if (layer.plain) this.sprites.push(layer.plain);
                if (layer.masked) this.sprites.push(layer.masked);
            });
            fxSolo.forEach(layer => {
                if (layer.sprite) this.sprites.push(layer.sprite);
            });
            this.sprites.push(sel);
        }
    },

    refreshSelection() {
        this.sprites.forEach(sp => {
            if (sp && typeof sp.update === "function") sp.update();
        });
    },

    refreshNow() {
        this.sprites.forEach(sp => {
            if (sp && typeof sp.update === "function") sp.update();
        });
        const tilemap = SceneManager._scene?._spriteset?._tilemap;
        if (tilemap?.children?.length) {
            tilemap.children.sort((a, b) => (a.z || 0) - (b.z || 0));
        }
        const upper = SceneManager._scene?._spriteset?._upperLayer;
        if (upper?.children?.length) {
            upper.children.sort((a, b) => (a.z || 0) - (b.z || 0));
        }
    },

    clear() {
        this.sprites.forEach(sp => {
            if (sp?.parent) sp.parent.removeChild(sp);
        });
        this.sprites = [];
    }
};
// ============================================================================
// Editor (hotkey + popup scaffolding; UI mirrors legacy design)
// ============================================================================
ElementsMapping.Editor = {
    editorWindow: null,
    _addWindow: null,
    _tilesetWindow: null,
    _autoOpened: false,

    init() {
        document.addEventListener("keydown", e => {
            if (e.ctrlKey && e.shiftKey && e.code === "KeyE") {
                e.preventDefault();
                this.toggleEditor();
            }
        });
        if (ElementsMapping._params.autoOpen && Utils.isNwjs?.()) {
            setTimeout(() => {
                if (this._autoOpened) return;
                this._autoOpened = true;
                this.openPopup(true);
            }, 400);
        }
        window.addEventListener("message", evt => this._handleMessage(evt));
    },

    toggleEditor() {
        if (this.editorWindow && !this.editorWindow.closed) {
            this.editorWindow.close();
            this.editorWindow = null;
            return;
        }
        this.openPopup();
    },

    openPopup(forceSnap = false) {
        if (!Utils.isNwjs?.()) {
            console.warn("ElementsMapping editor requires NW.js playtest.");
            return;
        }
        if (ElementsMapping._params.autoOpen) this._autoOpened = true;
        const html = this.popupHTML();
        const url = "data:text/html," + encodeURIComponent(html);
        const opts = { width: 840, height: 1100 };
        if (forceSnap && ElementsMapping._params.autoOpen) {
            const pos = this._computeSnapPosition(opts.width, opts.height);
            if (pos) {
                opts.x = Math.round(pos.x);
                opts.y = Math.round(pos.y);
            }
        }
        nw.Window.open(url, opts, win => {
            this.editorWindow = win;
            win.on("closed", () => { this.editorWindow = null; });
            setTimeout(() => this.sendState(), 50);
        });
    },

    _computeSnapPosition(w, h) {
        if (!Utils.isNwjs?.()) return null;
        const scr = window?.screen || {};
        const left = Number(scr.availLeft ?? scr.availX ?? 0) || 0;
        const top = Number(scr.availTop ?? scr.availY ?? 0) || 0;
        const sw = Number(scr.availWidth ?? scr.width ?? 0) || 0;
        const sh = Number(scr.availHeight ?? scr.height ?? 0) || 0;
        if (!sw || !sh) return null;
        const mode = ElementsMapping._params.snapTo;
        const cx = left + (sw - w) / 2;
        const cy = top + (sh - h) / 2;
        switch (mode) {
            case "top-left": return { x: left, y: top };
            case "bottom-left": return { x: left, y: top + sh - h };
            case "bottom-right": return { x: left + sw - w, y: top + sh - h };
            case "top-right": return { x: left + sw - w, y: top };
            case "left": return { x: left, y: cy };
            case "right": return { x: left + sw - w, y: cy };
            default: return null;
        }
    },

    sendState() {
        if (!this.editorWindow) return;
        this.editorWindow.window.postMessage({
            type: "elementsMappingState",
            collisionOverlay: !!ElementsMapping.Store.collisionOverlay,
            colliderOverlay: !!ElementsMapping.Store.colliderOverlay,
            autoSaveJson: !!ElementsMapping.Store.autoSaveJson,
            columns: this._buildColumns(),
            selected: this._getSelectedElement()
        }, "*");
    },

    _buildColumns() {
        const list = ElementsMapping.Store.currentElements || [];
        const cols = [];
        let maxIdx = 0;
        list.forEach((e, i) => {
            const colIdx = Math.max(0, Math.floor((Number(e.x) || 0) / 480));
            maxIdx = Math.max(maxIdx, colIdx);
            if (!cols[colIdx]) cols[colIdx] = [];
            cols[colIdx].push({ id: e.id, x: e.x, y: e.y, index: i });
        });
        const targetCols = Math.max(8, maxIdx + 1);
        for (let i = 0; i < targetCols; i++) {
            if (!cols[i]) cols[i] = [];
            cols[i].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
        }
        return cols;
    },

    _getSelectedElement() {
        const idx = ElementsMapping.Store.selectedIndex;
        const el = ElementsMapping.Store.currentElements?.[idx];
        if (!el) return null;
        return { index: idx, id: el.id, x: el.x, y: el.y };
    },

    _handleMessage(evt) {
        const data = evt.data;
        if (!data) return;
        if (data.type === "elementsMappingToggle") {
            ElementsMapping.Store.collisionOverlay = !!data.collisionOverlay;
            ElementsMapping.Store.colliderOverlay = !!data.colliderOverlay;
            ElementsMapping.Store.autoSaveJson = !!data.autoSaveJson;
            ElementsMapping.Collision.rebuildDebugLayers(SceneManager._scene);
            if (ElementsMapping.Store.autoSaveJson) ElementsMapping.Store.saveJson();
            this.sendState();
        } else if (data.type === "elementsMappingSelect") {
            const idx = (data.index == null ? -1 : Number(data.index));
            ElementsMapping.Store.selectedIndex = Number.isFinite(idx) ? idx : -1;
            if (ElementsMapping.Collision.colliderLayer) ElementsMapping.Collision.updateColliderLayer();
            ElementsMapping.Renderer.refreshSelection?.();
            this.sendState();
        } else if (data.type === "elementsMappingMove" || data.type === "elementsMappingSet") {
            if (data.type === "elementsMappingMove") {
                this._applyDelta(data.dx || 0, data.dy || 0);
            } else {
                this._applySet(data.x, data.y);
            }
        } else if (data.type === "elementsMappingSave") {
            ElementsMapping.Store.saveJson();
            this.sendState();
        } else if (data.type === "elementsMappingAddPopup") {
            this._openAddPopup();
        } else if (data.type === "elementsMappingAddTilesetPopup") {
            this._openAddTilesetPopup();
        } else if (data.type === "elementsMappingDelete") {
            const idx = (data.index == null ? ElementsMapping.Store.selectedIndex : Number(data.index));
            this._deleteSelected(idx);
        } else if (data.type === "elementsMappingAddChosen") {
            this._addElement(
                data.id,
                data.x,
                data.y,
                data.useGradient,
                data.useFx,
                data.fxMode,
                data.useFx2,
                data.fxMode2,
                data.useBottomFx,
                data.bottomFxMode,
                data.useBottomFx2,
                data.bottomFxMode2
            );
        } else if (data.type === "elementsMappingAddTilesetCreate") {
            this._createElementFromTileset(
                data.folder,
                data.selection,
                data.x,
                data.y,
                data.useGradient,
                data.useFx,
                data.fxMode,
                data.useFx2,
                data.fxMode2,
                data.useBottomFx,
                data.bottomFxMode,
                data.useBottomFx2,
                data.bottomFxMode2,
                data.isGround
            );
        } else if (data.type === "elementsMappingPing") {
            this.sendState();
        } else if (data.type === "elementsMappingPickPositionStart") {
            this._startPickPosition();
        } else if (data.type === "elementsMappingTilesetPreviewStart" || data.type === "elementsMappingSinglePreviewStart") {
            if (data.type === "elementsMappingTilesetPreviewStart") {
                this._startTilesetPreview(
                    data.folder,
                    data.selection,
                    data.useGradient,
                    data.useFx,
                    data.fxMode,
                    data.roundTo10,
                    data.snapTo48,
                    data.useFx2,
                    data.fxMode2,
                    data.useBottomFx,
                    data.bottomFxMode,
                    data.useBottomFx2,
                    data.bottomFxMode2,
                    data.isGround
                );
            } else {
                this._startSinglePreview(
                    data.id,
                    data.useGradient,
                    data.useFx,
                    data.fxMode,
                    data.roundTo10,
                    data.snapTo48,
                    data.useFx2,
                    data.fxMode2,
                    data.useBottomFx,
                    data.bottomFxMode,
                    data.useBottomFx2,
                    data.bottomFxMode2
                );
            }
        }
    },

    _openAddPopup() {
        this._sendSwitchTab("single");
    },

    _openAddTilesetPopup() {
        this._sendSwitchTab("tileset");
    },

    _sendSwitchTab(tab) {
        if (!this.editorWindow || this.editorWindow.closed) return;
        try {
            this.editorWindow.window.postMessage({ type: "elementsMappingSwitchTab", tab }, "*");
        } catch (e) {
            console.warn("ElementsMapping: failed to switch tab", e);
        }
    },

    _applyDelta(dx, dy) {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map)) return;
        const el = ElementsMapping.Store.currentElements?.[ElementsMapping.Store.selectedIndex];
        if (!el) return;
        el.x += dx;
        el.y += dy;
        const mapList = ElementsMapping.Store.mapData[ElementsMapping.Store.currentMapId];
        if (mapList && mapList[ElementsMapping.Store.selectedIndex]) {
            mapList[ElementsMapping.Store.selectedIndex].x = el.x;
            mapList[ElementsMapping.Store.selectedIndex].y = el.y;
        }
        ElementsMapping.Collision.rebuildDebugLayers(scene);
        ElementsMapping.Renderer.refreshNow();
        if (ElementsMapping.Store.autoSaveJson) ElementsMapping.Store.saveJson();
        this.sendState();
    },

    _applySet(x, y) {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map)) return;
        const el = ElementsMapping.Store.currentElements?.[ElementsMapping.Store.selectedIndex];
        if (!el) return;
        if (typeof x === "number" && !Number.isNaN(x)) el.x = x;
        if (typeof y === "number" && !Number.isNaN(y)) el.y = y;
        const mapList = ElementsMapping.Store.mapData[ElementsMapping.Store.currentMapId];
        if (mapList && mapList[ElementsMapping.Store.selectedIndex]) {
            if (typeof x === "number" && !Number.isNaN(x)) mapList[ElementsMapping.Store.selectedIndex].x = x;
            if (typeof y === "number" && !Number.isNaN(y)) mapList[ElementsMapping.Store.selectedIndex].y = y;
        }
        ElementsMapping.Collision.rebuildDebugLayers(scene);
        ElementsMapping.Renderer.refreshNow();
        if (ElementsMapping.Store.autoSaveJson) ElementsMapping.Store.saveJson();
        this.sendState();
    },

    _deleteSelected(targetIndex = null) {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map) || !scene._spriteset) return;
        const spriteset = scene._spriteset;
        const idx = (targetIndex == null ? ElementsMapping.Store.selectedIndex : Number(targetIndex));
        if (idx == null || idx < 0) return;
        const list = ElementsMapping.Store.currentElements;
        if (!Array.isArray(list) || !list[idx]) return;

        list.splice(idx, 1);
        const mapList = ElementsMapping.Store.mapData[ElementsMapping.Store.currentMapId];
        if (Array.isArray(mapList) && mapList[idx]) {
            mapList.splice(idx, 1);
        }
        ElementsMapping.Store.selectedIndex = -1;

        ElementsMapping.Collision.build(list);
        ElementsMapping.Collision._removeDebugLayers({ overlay:true, colliders:true });

        ElementsMapping.Collision.attachOverlays(spriteset);

        ElementsMapping.Renderer.create(list, spriteset);
        ElementsMapping.Renderer.refreshNow();
        ElementsMapping.Renderer.refreshSelection?.();

        if (ElementsMapping.Store.autoSaveJson) ElementsMapping.Store.saveJson();
        this.sendState();
    },

    async _addElement(
        id,
        x = 0,
        y = 0,
        useGradient = false,
        useFx = false,
        fxMode = "opaque",
        useFx2 = false,
        fxMode2 = "opaque",
        useBottomFx = false,
        bottomFxMode = "opaque",
        useBottomFx2 = false,
        bottomFxMode2 = "opaque",
        isGround = false
    ) {
        if (!id) return;
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map) || !scene._spriteset) return;
        const spriteset = scene._spriteset;

        if (!ElementsMapping.Store.currentMapId) ElementsMapping.Store.currentMapId = String($gameMap.mapId());
        if (!Array.isArray(ElementsMapping.Store.currentElements)) ElementsMapping.Store.currentElements = [];

        const newX = Number(x);
        const newY = Number(y);
        const finalX = Number.isFinite(newX) ? newX : 0;
        const finalY = Number.isFinite(newY) ? newY : 0;

        const mapList = ElementsMapping.Store.mapData[ElementsMapping.Store.currentMapId];
        if (!Array.isArray(mapList)) ElementsMapping.Store.mapData[ElementsMapping.Store.currentMapId] = [];

        const el = {
            id,
            x: finalX,
            y: finalY,
            useGradient: !!useGradient,
            useFx: !!useFx,
            fxMode: fxMode || "opaque",
            useFx2: !!useFx2,
            fxMode2: fxMode2 || "opaque",
            isGround: !!isGround,
            _index: ElementsMapping.Store.currentElements.length,
            images: ElementsMapping.Store.loadElementImages(id)
        };
        const hasBotFx = !!el.images.botFx;
        const hasBotFx2 = !!el.images.botFx2;
        el.useBottomFx = (useBottomFx !== undefined ? !!useBottomFx : hasBotFx);
        el.bottomFxMode = bottomFxMode || "opaque";
        el.useBottomFx2 = (useBottomFx2 !== undefined ? !!useBottomFx2 : hasBotFx2);
        el.bottomFxMode2 = bottomFxMode2 || el.bottomFxMode || "opaque";

        const newEntry = {
            id,
            x: finalX,
            y: finalY,
            useGradient: el.useGradient,
            useBottomFx: el.useBottomFx,
            bottomFxMode: el.bottomFxMode,
            useBottomFx2: el.useBottomFx2,
            bottomFxMode2: el.bottomFxMode2,
            useFx: el.useFx,
            fxMode: el.fxMode,
            useFx2: el.useFx2,
            fxMode2: el.fxMode2,
            isGround: !!isGround
        };
        ElementsMapping.Store.mapData[ElementsMapping.Store.currentMapId].push(newEntry);
        ElementsMapping.Store.currentElements.push(el);

        await ElementsMapping.Store.waitForBitmaps([el]);

        ElementsMapping.Collision.build(ElementsMapping.Store.currentElements);
        ElementsMapping.Collision._removeDebugLayers({ overlay:true, colliders:true });
        ElementsMapping.Collision.attachOverlays(spriteset);

        ElementsMapping.Renderer.create(ElementsMapping.Store.currentElements, spriteset);
        ElementsMapping.Renderer.refreshNow();

        ElementsMapping.Store.selectedIndex = -1;
        if (ElementsMapping.Collision.colliderLayer) ElementsMapping.Collision.updateColliderLayer();
        ElementsMapping.Renderer.refreshSelection?.();

        if (ElementsMapping.Store.autoSaveJson) ElementsMapping.Store.saveJson();
        this.sendState();
    },

    async _addElementsBatchFromPreview(data, positions = []) {
        if (!data || !positions.length) return;
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map) || !scene._spriteset) return;
        const spriteset = scene._spriteset;

        if (!ElementsMapping.Store.currentMapId) ElementsMapping.Store.currentMapId = String($gameMap.mapId());
        if (!Array.isArray(ElementsMapping.Store.currentElements)) ElementsMapping.Store.currentElements = [];
        if (!ElementsMapping.Store.mapData[ElementsMapping.Store.currentMapId]) {
            ElementsMapping.Store.mapData[ElementsMapping.Store.currentMapId] = [];
        }

        const current = ElementsMapping.Store.currentElements;
        const mapList = ElementsMapping.Store.mapData[ElementsMapping.Store.currentMapId];
        const occupied = new Set(
            current
                .filter(el => (data.isGround ? !!el.isGround : !el.isGround))
                .map(el => `${el.x},${el.y}`)
        );
        const newElements = [];

        positions.forEach(pos => {
            const finalX = Number(pos.x);
            const finalY = Number(pos.y);
            if (!Number.isFinite(finalX) || !Number.isFinite(finalY)) return;
            const key = `${finalX},${finalY}`;
            if (occupied.has(key)) return;
            occupied.add(key);

            const el = {
                id: data.id,
                x: finalX,
                y: finalY,
                useGradient: !!data.useGradient,
                useFx: !!data.useFx,
                fxMode: data.fxMode || "opaque",
                useFx2: !!data.useFx2,
                fxMode2: data.fxMode2 || "opaque",
                isGround: !!data.isGround,
                _index: current.length,
                images: ElementsMapping.Store.loadElementImages(data.id)
            };
            const hasBotFx = !!el.images.botFx;
            const hasBotFx2 = !!el.images.botFx2;
            el.useBottomFx = (data.useBottomFx !== undefined ? !!data.useBottomFx : hasBotFx);
            el.bottomFxMode = data.bottomFxMode || "opaque";
            el.useBottomFx2 = (data.useBottomFx2 !== undefined ? !!data.useBottomFx2 : hasBotFx2);
            el.bottomFxMode2 = data.bottomFxMode2 || el.bottomFxMode || "opaque";

            const newEntry = {
                id: data.id,
                x: finalX,
                y: finalY,
                useGradient: el.useGradient,
                useBottomFx: el.useBottomFx,
                bottomFxMode: el.bottomFxMode,
                useBottomFx2: el.useBottomFx2,
                bottomFxMode2: el.bottomFxMode2,
                useFx: el.useFx,
                fxMode: el.fxMode,
                useFx2: el.useFx2,
                fxMode2: el.fxMode2,
                isGround: !!data.isGround
            };
            mapList.push(newEntry);
            current.push(el);
            newElements.push(el);
        });

        if (!newElements.length) return;

        await ElementsMapping.Store.waitForBitmaps(newElements);

        ElementsMapping.Collision.build(current);
        ElementsMapping.Collision._removeDebugLayers({ overlay:true, colliders:true });
        ElementsMapping.Collision.attachOverlays(spriteset);

        ElementsMapping.Renderer.create(current, spriteset);
        ElementsMapping.Renderer.refreshNow();

        ElementsMapping.Store.selectedIndex = -1;
        if (ElementsMapping.Collision.colliderLayer) ElementsMapping.Collision.updateColliderLayer();
        ElementsMapping.Renderer.refreshSelection?.();

        if (ElementsMapping.Store.autoSaveJson) ElementsMapping.Store.saveJson();
        this.sendState();
    },

    _createElementFromTileset(
        folder,
        selection,
        x = 0,
        y = 0,
        useGradient = false,
        useFx = false,
        fxMode = "opaque",
        useFx2 = false,
        fxMode2 = "opaque",
        useBottomFx = false,
        bottomFxMode = "opaque",
        useBottomFx2 = false,
        bottomFxMode2 = "opaque",
        isGround = false
    ) {
        if (!folder || !selection || selection.w <= 0 || selection.h <= 0) return;
        const grid = 48;
        const snap = v => Math.max(0, Math.floor(v / grid) * grid);
        const sx = snap(selection.x);
        const sy = snap(selection.y);
        const sw = Math.max(grid, Math.floor(selection.w / grid) * grid);
        const sh = Math.max(grid, Math.floor(selection.h / grid) * grid);
        const encFolder = encodeURIComponent(folder);
        const id = `tileset:${encFolder}:${sx}:${sy}:${sw}:${sh}`;
        this._addElement(
            id,
            x,
            y,
            useGradient,
            useFx,
            fxMode,
            useFx2,
            fxMode2,
            useBottomFx,
            bottomFxMode,
            useBottomFx2,
            bottomFxMode2,
            isGround
        );
    },

    async _startSinglePreview(
        id,
        useGradient = false,
        useFx = false,
        fxMode = "opaque",
        roundTo10 = false,
        snapTo48 = false,
        useFx2 = false,
        fxMode2 = "opaque",
        useBottomFx = false,
        bottomFxMode = "opaque",
        useBottomFx2 = false,
        bottomFxMode2 = "opaque",
        isGround = false
    ) {
        if (!id) return;
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map) || !scene._spriteset) return;
        this._stopTilesetPreview();

        const images = ElementsMapping.Store.loadElementImages(id);
        await ElementsMapping.Store.waitForBitmaps([{ images }]);
        const botBmp = images.bot;
        const topBmp = images.top;
        if (!topBmp && !botBmp) return;

        const spriteset = scene?._spriteset;
        if (!spriteset) return;
        if (!spriteset._upperLayer) {
            spriteset._upperLayer = new Sprite();
            spriteset._upperLayer.z = 10000;
            spriteset.addChild(spriteset._upperLayer);
        }
        const preview = {
            id,
            useGradient: !!useGradient,
            useFx: !!useFx,
            fxMode: fxMode || "opaque",
            roundTo10: !!roundTo10,
            snapTo48: !!snapTo48,
            useFx2: !!useFx2,
            fxMode2: fxMode2 || "opaque",
            useBottomFx: !!useBottomFx,
            bottomFxMode: bottomFxMode || "opaque",
            useBottomFx2: !!useBottomFx2,
            bottomFxMode2: bottomFxMode2 || bottomFxMode || "opaque",
            isGround: !!isGround,
            sprites: [],
            mask: null,
            maskBmp: null,
            botBmp,
            topBmp,
            fxBmp: images.fx,
            fx2Bmp: images.fx2,
            botFxBmp: images.botFx,
            botFx2Bmp: images.botFx2,
            worldX: 0,
            worldY: 0
        };

        this._createPreviewLabel(preview, spriteset);
        preview.outline = new PIXI.Graphics();
        preview.outline.alpha = 0.9;
        spriteset._upperLayer.addChild(preview.outline);
        preview.sprites.push(preview.outline);

        if (botBmp) {
            const botSp = new Sprite(botBmp);
            botSp.alpha = 0.7;
            spriteset._upperLayer.addChild(botSp);
            preview.botSp = botSp;
            preview.sprites.push(botSp);
        }
        if (preview.useBottomFx && preview.botFxBmp) {
            const fxSp = new Sprite(preview.botFxBmp);
            fxSp.alpha = 0.7;
            const mode = preview.bottomFxMode || "opaque";
            spriteset._upperLayer.addChild(fxSp);
            ElementsMapping._setBlendMode(fxSp, mode);
            const presetKey = ElementsMapping.DisplacementFX.getPresetKey(mode);
            if (presetKey) ElementsMapping.DisplacementFX.applyTo(fxSp, spriteset, presetKey);
            preview.botFxSp = fxSp;
            preview.sprites.push(fxSp);
        }
        if (preview.useBottomFx2 && preview.botFx2Bmp) {
            const fxSp2 = new Sprite(preview.botFx2Bmp);
            fxSp2.alpha = 0.7;
            const modeB = preview.bottomFxMode2 || "opaque";
            spriteset._upperLayer.addChild(fxSp2);
            ElementsMapping._setBlendMode(fxSp2, modeB);
            const presetKeyB = ElementsMapping.DisplacementFX.getPresetKey(modeB);
            if (presetKeyB) ElementsMapping.DisplacementFX.applyTo(fxSp2, spriteset, presetKeyB);
            preview.botFx2Sp = fxSp2;
            preview.sprites.push(fxSp2);
        }

        if (preview.useGradient && topBmp) {
            const plain = new Sprite(topBmp);
            plain.alpha = 0.7;
            const masked = new Sprite(topBmp);
            masked.alpha = 0.7;
            spriteset._upperLayer.addChild(plain);
            spriteset._upperLayer.addChild(masked);
            preview.topPlain = plain;
            preview.topMasked = masked;
            preview.sprites.push(plain, masked);

            const bounds = ElementsMapping._bitmapOpaqueBounds(topBmp);
            const maskH = bounds?.height || topBmp.height;
            const maskW = topBmp.width;
            preview.maskBmp = ElementsMapping._createGradientBitmap(
                maskW,
                maskH,
                {
                    0.0:  "rgba(255,255,255,0.30)",
                    0.7:  "rgba(255,255,255,0.50)",
                    0.8:  "rgba(255,255,255,0.80)",
                    0.9:  "rgba(255,255,255,1)",
                    1.0:  "rgba(255,255,255,1)"
                },
                "vertical"
            );
            preview.mask = new Sprite(preview.maskBmp);
            preview.mask.visible = true;
            spriteset._upperLayer.addChild(preview.mask);
            preview.sprites.push(preview.mask);
            masked.mask = preview.mask;
        } else if (topBmp) {
            const topSp = new Sprite(topBmp);
            topSp.alpha = 0.7;
            spriteset._upperLayer.addChild(topSp);
            preview.topSp = topSp;
            preview.sprites.push(topSp);
        }

        if (preview.useFx && preview.fxBmp) {
            const fxSp = new Sprite(preview.fxBmp);
            fxSp.alpha = 0.7;
            spriteset._upperLayer.addChild(fxSp);
            ElementsMapping._setBlendMode(fxSp, preview.fxMode);
            const presetKey = ElementsMapping.DisplacementFX.getPresetKey(preview.fxMode);
            if (presetKey) ElementsMapping.DisplacementFX.applyTo(fxSp, spriteset, presetKey);
            preview.fxSp = fxSp;
            preview.sprites.push(fxSp);
        }
        if (preview.useFx2 && preview.fx2Bmp) {
            const fx2Sp = new Sprite(preview.fx2Bmp);
            fx2Sp.alpha = 0.7;
            spriteset._upperLayer.addChild(fx2Sp);
            ElementsMapping._setBlendMode(fx2Sp, preview.fxMode2);
            const presetKey2 = ElementsMapping.DisplacementFX.getPresetKey(preview.fxMode2);
            if (presetKey2) ElementsMapping.DisplacementFX.applyTo(fx2Sp, spriteset, presetKey2);
            preview.fx2Sp = fx2Sp;
            preview.sprites.push(fx2Sp);
        }

        this._previewState = preview;
        this._installPreviewHandlers();
        this._updatePreviewPosition();
    },

    async _startTilesetPreview(
        folder,
        selection,
        useGradient = false,
        useFx = false,
        fxMode = "opaque",
        roundTo10 = false,
        snapTo48 = false,
        useFx2 = false,
        fxMode2 = "opaque",
        useBottomFx = false,
        bottomFxMode = "opaque",
        useBottomFx2 = false,
        bottomFxMode2 = "opaque",
        isGround = false
    ) {
        if (!folder || !selection) return;
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map) || !scene._spriteset) return;
        this._stopTilesetPreview();

        const grid = 48;
        const snap = v => Math.max(0, Math.floor(v / grid) * grid);
        const sx = snap(selection.x);
        const sy = snap(selection.y);
        const sw = Math.max(grid, Math.floor(selection.w / grid) * grid);
        const sh = Math.max(grid, Math.floor(selection.h / grid) * grid);
        const encFolder = encodeURIComponent(folder);
        const id = `tileset:${encFolder}:${sx}:${sy}:${sw}:${sh}`;

        const images = ElementsMapping.Store.loadElementImages(id);
        await ElementsMapping.Store.waitForBitmaps([{ images }]);
        const botBmp = images.bot;
        const topBmp = images.top;
        if (!topBmp && !botBmp) return;

        const spriteset = scene?._spriteset;
        if (!spriteset) return;
        if (!spriteset._upperLayer) {
            spriteset._upperLayer = new Sprite();
            spriteset._upperLayer.z = 10000;
            spriteset.addChild(spriteset._upperLayer);
        }
        const preview = {
            id,
            useGradient: !!useGradient,
            useFx: !!useFx,
            fxMode: fxMode || "opaque",
            roundTo10: !!roundTo10,
            snapTo48: !!snapTo48,
            useFx2: !!useFx2,
            fxMode2: fxMode2 || "opaque",
            useBottomFx: !!useBottomFx,
            bottomFxMode: bottomFxMode || "opaque",
            useBottomFx2: !!useBottomFx2,
            bottomFxMode2: bottomFxMode2 || bottomFxMode || "opaque",
            isGround: !!isGround,
            sprites: [],
            mask: null,
            maskBmp: null,
            botBmp,
            topBmp,
            fxBmp: images.fx,
            fx2Bmp: images.fx2,
            botFxBmp: images.botFx,
            botFx2Bmp: images.botFx2,
            worldX: 0,
            worldY: 0
        };

        this._createPreviewLabel(preview, spriteset);
        preview.outline = new PIXI.Graphics();
        preview.outline.alpha = 0.9;
        spriteset._upperLayer.addChild(preview.outline);
        preview.sprites.push(preview.outline);

        if (botBmp) {
            const botSp = new Sprite(botBmp);
            botSp.alpha = 0.7;
            spriteset._upperLayer.addChild(botSp);
            preview.botSp = botSp;
            preview.sprites.push(botSp);
        }
        if (preview.useBottomFx && preview.botFxBmp) {
            const fxSp = new Sprite(preview.botFxBmp);
            fxSp.alpha = 0.7;
            const mode = preview.bottomFxMode || "opaque";
            spriteset._upperLayer.addChild(fxSp);
            ElementsMapping._setBlendMode(fxSp, mode);
            const presetKey = ElementsMapping.DisplacementFX.getPresetKey(mode);
            if (presetKey) ElementsMapping.DisplacementFX.applyTo(fxSp, spriteset, presetKey);
            preview.botFxSp = fxSp;
            preview.sprites.push(fxSp);
        }
        if (preview.useBottomFx2 && preview.botFx2Bmp) {
            const fxSp2 = new Sprite(preview.botFx2Bmp);
            fxSp2.alpha = 0.7;
            const modeB = preview.bottomFxMode2 || "opaque";
            spriteset._upperLayer.addChild(fxSp2);
            ElementsMapping._setBlendMode(fxSp2, modeB);
            const presetKeyB = ElementsMapping.DisplacementFX.getPresetKey(modeB);
            if (presetKeyB) ElementsMapping.DisplacementFX.applyTo(fxSp2, spriteset, presetKeyB);
            preview.botFx2Sp = fxSp2;
            preview.sprites.push(fxSp2);
        }

        if (preview.useGradient && topBmp) {
            const plain = new Sprite(topBmp);
            plain.alpha = 0.7;
            const masked = new Sprite(topBmp);
            masked.alpha = 0.7;
            spriteset._upperLayer.addChild(plain);
            spriteset._upperLayer.addChild(masked);
            preview.topPlain = plain;
            preview.topMasked = masked;
            preview.sprites.push(plain, masked);

            const bounds = ElementsMapping._bitmapOpaqueBounds(topBmp);
            const maskH = bounds?.height || topBmp.height;
            const maskW = topBmp.width;
            preview.maskBmp = ElementsMapping._createGradientBitmap(
                maskW,
                maskH,
                {
                    0.0:  "rgba(255,255,255,0.30)",
                    0.7:  "rgba(255,255,255,0.50)",
                    0.8:  "rgba(255,255,255,0.80)",
                    0.9:  "rgba(255,255,255,1)",
                    1.0:  "rgba(255,255,255,1)"
                },
                "vertical"
            );
            preview.mask = new Sprite(preview.maskBmp);
            preview.mask.visible = true;
            spriteset._upperLayer.addChild(preview.mask);
            preview.sprites.push(preview.mask);
            masked.mask = preview.mask;
        } else if (topBmp) {
            const topSp = new Sprite(topBmp);
            topSp.alpha = 0.7;
            spriteset._upperLayer.addChild(topSp);
            preview.topSp = topSp;
            preview.sprites.push(topSp);
        }

        if (preview.useFx && preview.fxBmp) {
            const fxSp = new Sprite(preview.fxBmp);
            fxSp.alpha = 0.7;
            spriteset._upperLayer.addChild(fxSp);
            ElementsMapping._setBlendMode(fxSp, preview.fxMode);
            const presetKey = ElementsMapping.DisplacementFX.getPresetKey(preview.fxMode);
            if (presetKey) ElementsMapping.DisplacementFX.applyTo(fxSp, spriteset, presetKey);
            preview.fxSp = fxSp;
            preview.sprites.push(fxSp);
        }
        if (preview.useFx2 && preview.fx2Bmp) {
            const fx2Sp = new Sprite(preview.fx2Bmp);
            fx2Sp.alpha = 0.7;
            spriteset._upperLayer.addChild(fx2Sp);
            ElementsMapping._setBlendMode(fx2Sp, preview.fxMode2);
            const presetKey2 = ElementsMapping.DisplacementFX.getPresetKey(preview.fxMode2);
            if (presetKey2) ElementsMapping.DisplacementFX.applyTo(fx2Sp, spriteset, presetKey2);
            preview.fx2Sp = fx2Sp;
            preview.sprites.push(fx2Sp);
        }

        this._previewState = preview;
        this._installPreviewHandlers();
        this._updatePreviewPosition();
    },

    _stopTilesetPreview() {
        if (!this._previewState) return;
        const spriteset = SceneManager._scene?._spriteset;
        this._previewState.sprites?.forEach(sp => {
            if (sp?.parent) sp.parent.removeChild(sp);
        });
        this._previewState = null;
        this._removePreviewHandlers();
        if (spriteset?._upperLayer?.children?.length) {
            spriteset._upperLayer.children.sort((a, b) => (a.z || 0) - (b.z || 0));
        }
    },

    _installPreviewHandlers() {
        this._removePreviewHandlers();
        this._previewMoveHandler = e => {
            const scene = SceneManager._scene;
            if (!(scene instanceof Scene_Map)) return;
            const tw = $gameMap.tileWidth();
            const th = $gameMap.tileHeight();
            const SNAP = 48;
            const cx = Graphics.pageToCanvasX(e.pageX);
            const cy = Graphics.pageToCanvasY(e.pageY);
            if (cx < 0 || cy < 0) return;
            let worldX = cx + $gameMap.displayX() * tw;
            let worldY = cy + $gameMap.displayY() * th;
            if (this._previewState?.snapTo48) {
                worldX = Math.round(worldX / SNAP) * SNAP;
                worldY = Math.round(worldY / SNAP) * SNAP;
            } else if (this._previewState?.roundTo10) {
                worldX = Math.round(worldX / 10) * 10;
                worldY = Math.round(worldY / 10) * 10;
            }
            if (this._previewState) {
                this._previewState.worldX = worldX;
                this._previewState.worldY = worldY;
                if (this._previewState.dragActive) {
                    this._previewState.dragEndX = worldX;
                    this._previewState.dragEndY = worldY;
                }
                this._updatePreviewPosition();
            }
        };
        this._previewClickHandler = e => {
            if (e.button === 2) {
                if (this._previewState) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                this._stopTilesetPreview();
                this._clearTilesetSelection();
                return;
            }
            if (e.button !== 0) return;
            const scene = SceneManager._scene;
            if (!(scene instanceof Scene_Map) || !this._previewState) return;
            const tw = $gameMap.tileWidth();
            const th = $gameMap.tileHeight();
            const SNAP = 48;
            const cx = Graphics.pageToCanvasX(e.pageX);
            const cy = Graphics.pageToCanvasY(e.pageY);
            if (cx < 0 || cy < 0) return;
            let worldX = cx + $gameMap.displayX() * tw;
            let worldY = cy + $gameMap.displayY() * th;
            if (this._previewState.snapTo48) {
                worldX = Math.round(worldX / SNAP) * SNAP;
                worldY = Math.round(worldY / SNAP) * SNAP;
            } else if (this._previewState.roundTo10) {
                worldX = Math.round(worldX / 10) * 10;
                worldY = Math.round(worldY / 10) * 10;
            }
            this._previewState.worldX = worldX;
            this._previewState.worldY = worldY;
            if (this._previewState.snapTo48) {
                this._previewState.dragActive = true;
                this._previewState.dragStartX = worldX;
                this._previewState.dragStartY = worldY;
                this._previewState.dragEndX = worldX;
                this._previewState.dragEndY = worldY;
                this._updatePreviewPosition();
                e.preventDefault();
                e.stopPropagation();
            } else {
        const data = this._previewState;
        const parts = data.id.split(":");
        if (parts.length === 6 && parts[0] === "tileset") {
            const folder = decodeURIComponent(parts[1]);
            const sel = {
                x: Number(parts[2]),
                y: Number(parts[3]),
                w: Number(parts[4]),
                h: Number(parts[5])
            };
            this._createElementFromTileset(
                folder,
                sel,
                worldX,
                worldY,
                data.useGradient,
                data.useFx,
                data.fxMode,
                data.useFx2,
                data.fxMode2,
                data.useBottomFx,
                data.bottomFxMode,
                data.useBottomFx2,
                data.bottomFxMode2,
                data.isGround
            );
        } else {
            this._addElement(
                data.id,
                worldX,
                worldY,
                data.useGradient,
                data.useFx,
                data.fxMode,
                data.useFx2,
                data.fxMode2,
                data.useBottomFx,
                data.bottomFxMode,
                data.useBottomFx2,
                data.bottomFxMode2,
                data.isGround
            );
        }
                this._updatePreviewPosition();
            }
        };
        this._previewUpHandler = e => {
            if (e.button !== 0) return;
            const scene = SceneManager._scene;
            const data = this._previewState;
            if (!(scene instanceof Scene_Map) || !data || !data.dragActive || !data.snapTo48) return;
            data.dragActive = false;
            const SNAP = 48;
            const startX = Math.round((data.dragStartX ?? data.worldX) / SNAP) * SNAP;
            const startY = Math.round((data.dragStartY ?? data.worldY) / SNAP) * SNAP;
            const endX = Math.round((data.dragEndX ?? data.worldX) / SNAP) * SNAP;
            const endY = Math.round((data.dragEndY ?? data.worldY) / SNAP) * SNAP;
            const minX = Math.min(startX, endX);
            const maxX = Math.max(startX, endX);
            const minY = Math.min(startY, endY);
            const maxY = Math.max(startY, endY);
            const positions = [];
            for (let x = minX; x <= maxX; x += SNAP) {
                for (let y = minY; y <= maxY; y += SNAP) {
                    positions.push({ x, y });
                }
            }
            this._addElementsBatchFromPreview(data, positions);
            this._updatePreviewPosition();
        };
        this._previewContextHandler = e => {
            if (this._previewState) {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        document.addEventListener("mousemove", this._previewMoveHandler, true);
        document.addEventListener("mousedown", this._previewClickHandler, true);
        document.addEventListener("mouseup", this._previewUpHandler, true);
        document.addEventListener("contextmenu", this._previewContextHandler, true);
    },

    _removePreviewHandlers() {
        if (this._previewMoveHandler) {
            document.removeEventListener("mousemove", this._previewMoveHandler, true);
            this._previewMoveHandler = null;
        }
        if (this._previewClickHandler) {
            document.removeEventListener("mousedown", this._previewClickHandler, true);
            this._previewClickHandler = null;
        }
        if (this._previewUpHandler) {
            document.removeEventListener("mouseup", this._previewUpHandler, true);
            this._previewUpHandler = null;
        }
        if (this._previewContextHandler) {
            document.removeEventListener("contextmenu", this._previewContextHandler, true);
            this._previewContextHandler = null;
        }
    },

    _clearTilesetSelection() {
        if (this._tilesetWindow && !this._tilesetWindow.closed) {
            try {
                this._tilesetWindow.window.postMessage({ type: "elementsTilesetSelectionClear" }, "*");
            } catch {
                //
            }
        }
    },

    _createPreviewLabel(preview, spriteset) {
        const bmp = new Bitmap(180, 28);
        const sp = new Sprite(bmp);
        sp.alpha = 0.9;
        spriteset._upperLayer.addChild(sp);
        preview.labelBmp = bmp;
        preview.labelSp = sp;
        preview.sprites.push(sp);
    },

    _updatePreviewPosition() {
        const preview = this._previewState;
        const scene = SceneManager._scene;
        if (!preview || !(scene instanceof Scene_Map)) return;
        const spriteset = scene._spriteset;
        if (!spriteset || !preview.sprites?.length) return;
        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        const ox = $gameMap.displayX() * tw;
        const oy = $gameMap.displayY() * th;
        const topBmp = preview.topBmp;
        const botBmp = preview.botBmp;
        const fxBmp = preview.fxBmp;
        const fx2Bmp = preview.fx2Bmp;
        const refW = Math.max(
            topBmp?.width || 0,
            botBmp?.width || 0,
            fxBmp?.width || 0,
            fx2Bmp?.width || 0,
            preview.botFxBmp?.width || 0,
            preview.botFx2Bmp?.width || 0
        );
        const refH = Math.max(
            topBmp?.height || 0,
            botBmp?.height || 0,
            fxBmp?.height || 0,
            fx2Bmp?.height || 0,
            preview.botFxBmp?.height || 0,
            preview.botFx2Bmp?.height || 0
        );
        const baseW = refW || (topBmp?.width || botBmp?.width || fxBmp?.width || fx2Bmp?.width || preview.botFxBmp?.width || preview.botFx2Bmp?.width || 0);
        const baseH = refH || (topBmp?.height || botBmp?.height || fxBmp?.height || fx2Bmp?.height || preview.botFxBmp?.height || preview.botFx2Bmp?.height || 0);
        const sx = preview.worldX - baseW / 2 - ox;
        const sy = preview.worldY - baseH - oy + 0.5;
        const labelText = `x: ${Math.round(preview.worldX)}  y: ${Math.round(preview.worldY)}`;
        const outline = preview.outline;

        if (preview.botSp && botBmp) {
            preview.botSp.x = preview.worldX - botBmp.width / 2 - ox;
            preview.botSp.y = preview.worldY - botBmp.height - oy + 0.5;
        }
        if (preview.botFxSp && preview.botFxBmp) {
            preview.botFxSp.x = preview.worldX - preview.botFxBmp.width / 2 - ox;
            preview.botFxSp.y = preview.worldY - preview.botFxBmp.height - oy + 0.5;
        }
        if (preview.botFx2Sp && preview.botFx2Bmp) {
            preview.botFx2Sp.x = preview.worldX - preview.botFx2Bmp.width / 2 - ox;
            preview.botFx2Sp.y = preview.worldY - preview.botFx2Bmp.height - oy + 0.5;
        }
        if (preview.topSp && topBmp) {
            preview.topSp.x = preview.worldX - topBmp.width / 2 - ox;
            preview.topSp.y = preview.worldY - topBmp.height - oy + 0.5;
        }
        if (preview.topPlain && topBmp) {
            preview.topPlain.x = preview.worldX - topBmp.width / 2 - ox;
            preview.topPlain.y = preview.worldY - topBmp.height - oy + 0.5;
        }
        if (preview.topMasked && topBmp) {
            preview.topMasked.x = preview.worldX - topBmp.width / 2 - ox;
            preview.topMasked.y = preview.worldY - topBmp.height - oy + 0.5;
        }
        if (preview.mask && preview.maskBmp && topBmp) {
            const bounds = ElementsMapping._bitmapOpaqueBounds(topBmp);
            const yOffset = bounds ? bounds.y : 0;
            preview.mask.x = preview.worldX - preview.maskBmp.width / 2 - ox;
            preview.mask.y = preview.worldY - topBmp.height - oy + 0.5 + yOffset;
            preview.mask.visible = true;
        }
        if (preview.fxSp && fxBmp) {
            preview.fxSp.x = preview.worldX - fxBmp.width / 2 - ox;
            preview.fxSp.y = preview.worldY - fxBmp.height - oy + 0.5;
        }
        if (preview.fx2Sp && fx2Bmp) {
            preview.fx2Sp.x = preview.worldX - fx2Bmp.width / 2 - ox;
            preview.fx2Sp.y = preview.worldY - fx2Bmp.height - oy + 0.5;
        }
        if (preview.labelBmp && preview.labelSp) {
            const bmp = preview.labelBmp;
            bmp.clear();
            bmp.drawText(labelText, 0, 0, bmp.width, bmp.height, "center");
            preview.labelSp.x = preview.worldX - bmp.width / 2 - ox;
            preview.labelSp.y = sy - bmp.height - 4;
        }
        if (outline) {
            outline.clear();
            outline.lineStyle(3, 0xffe500, 0.95);
            outline.beginFill(0xffe500, 0.12);
            if (preview.dragActive && preview.snapTo48) {
                const startX = preview.dragStartX ?? preview.worldX;
                const startY = preview.dragStartY ?? preview.worldY;
                const endX = preview.dragEndX ?? preview.worldX;
                const endY = preview.dragEndY ?? preview.worldY;
                const minX = Math.min(startX, endX);
                const maxX = Math.max(startX, endX);
                const minY = Math.min(startY, endY);
                const maxY = Math.max(startY, endY);
                outline.x = minX - tw / 2 - ox;
                outline.y = minY - th - oy + 0.5;
                outline.drawRect(0, 0, (maxX - minX) + tw, (maxY - minY) + th);
            } else {
                outline.x = sx;
                outline.y = sy;
                outline.drawRect(0, 0, baseW, baseH);
            }
            outline.endFill();
        }
    },
    _startPickPosition() {
        if (this._movePickHandler) {
            document.removeEventListener("mousedown", this._movePickHandler, true);
            this._movePickHandler = null;
        }

        this._movePickHandler = e => {
            if (e.button !== 0) return;
            const scene = SceneManager._scene;
            if (!(scene instanceof Scene_Map)) return;
            if (ElementsMapping.Store.selectedIndex == null || ElementsMapping.Store.selectedIndex < 0) return;

            const tw = $gameMap.tileWidth();
            const th = $gameMap.tileHeight();
            const cx = Graphics.pageToCanvasX(e.pageX);
            const cy = Graphics.pageToCanvasY(e.pageY);
            if (cx < 0 || cy < 0) return;

            const worldX = Math.round(cx + $gameMap.displayX() * tw);
            const worldY = Math.round(cy + $gameMap.displayY() * th);

            this._applySet(worldX, worldY);

            document.removeEventListener("mousedown", this._movePickHandler, true);
            this._movePickHandler = null;
        };
        document.addEventListener("mousedown", this._movePickHandler, true);
    },

    _sharedCSS() {
        return `
:root {
    --bg: #111217;
    --panel: #181b24;
    --panel-2: #1e222d;
    --border: #2f3340;
    --border-strong: #3f4555;
    --text: #e8ecf5;
    --text-muted: #9ca3b5;
    --accent: #4ac0ff;
}
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--text); font-family: "Segoe UI", system-ui, sans-serif; margin:0; padding:16px; }
h3 { margin:0 0 10px 0; letter-spacing:0.4px; color: var(--text); }
button { padding:8px 12px; height:38px; border:1px solid var(--border); background: linear-gradient(145deg, #242a36, #1a1f29); color: var(--text); cursor:pointer; border-radius:6px; }
button:disabled { opacity:0.6; cursor:not-allowed; }
input[type="number"], input[type="text"], select { height:36px; padding:8px 10px; background:#0f121a; color: var(--text); border:1px solid var(--border); border-radius:6px; }
label { color: var(--text-muted); }
.card { background: var(--panel); border:1px solid var(--border); padding:12px; border-radius:8px; box-shadow:0 10px 24px rgba(0,0,0,0.25); }
.card-label { position:absolute; top:-12px; left:14px; padding:2px 10px; background: var(--bg); border:1px solid var(--border); font-size:12px; letter-spacing:0.5px; text-transform:uppercase; }
.field { display:flex; align-items:center; gap:10px; }
.checkbox-field { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.checkbox-field input { width:18px; height:18px; }
.list-shell { background: var(--panel); border:1px solid var(--border); padding:10px; border-radius:8px; }
.list { max-height:530px; min-height:530px; overflow-y:auto; background: var(--panel-2); border:1px solid var(--border-strong); padding:6px; border-radius:8px; color: var(--text); }
.list .item { background: var(--panel); border:1px solid var(--border); cursor:pointer; padding:8px 10px; margin:4px 0; border-radius:6px; }
.list .item:hover { background:#23293a; }
.list .item.selected { background:#2c3550; border-color:var(--accent); }
.field + .checkbox-field,
.checkbox-field + .field,
.checkbox-field + .checkbox-field { margin-top: 6px; }
.field + .field { margin-top: 6px; }
.card { gap: 8px; }
`;
    },

    popupHTML() {
        const scanSingles = () => {
            if (!Utils?.isNwjs?.() || typeof require !== "function") return { categories: [], elementsByCategory: {}, previewDataById: {} };
            const fs = require("fs");
            const path = require("path");
            const singlesBase = path.join(process.cwd(), "img", "elements", "singles");
            const required = ["collision_base.png", "bottom_base.png", "top_base.png"];
            const previewDataById = {};
            const listElementDirs = dirPath =>
                fs.readdirSync(dirPath, { withFileTypes: true })
                    .filter(d => d.isDirectory())
                    .map(d => d.name)
                    .filter(name => required.every(file => fs.existsSync(path.join(dirPath, name, file))))
                    .sort((a, b) => a.localeCompare(b));

            const toData = filePath => {
                try {
                    return "data:image/png;base64," + require("fs").readFileSync(filePath).toString("base64");
                } catch {
                    return null;
                }
            };

            const addPreviewFor = (idPath, dir) => {
                previewDataById[idPath] = {
                    bot: toData(path.join(dir, "bottom_base.png")),
                    botFx: toData(path.join(dir, "bottom_fx01.png")),
                    botFx2: toData(path.join(dir, "bottom_fx02.png")),
                    top: toData(path.join(dir, "top_base.png")),
                    fx: toData(path.join(dir, "top_fx01.png")),
                    fx2: toData(path.join(dir, "top_fx02.png"))
                };
            };

            const categories = [];
            let rootCategory = null;
            const elementsByCategory = {};
            try {
                const rootElements = fs.existsSync(singlesBase) ? listElementDirs(singlesBase) : [];
                if (rootElements.length) {
                    elementsByCategory[""] = rootElements;
                    rootCategory = { label: "(singles)", value: "" };
                    rootElements.forEach(name => addPreviewFor(name, path.join(singlesBase, name)));
                }

                const topDirs = fs.existsSync(singlesBase)
                    ? fs.readdirSync(singlesBase, { withFileTypes: true })
                        .filter(d => d.isDirectory())
                        .map(d => d.name)
                    : [];

                topDirs.sort((a, b) => a.localeCompare(b)).forEach(cat => {
                    const catPath = path.join(singlesBase, cat);
                    const items = listElementDirs(catPath);
                    if (!items.length) return;
                    categories.push({ label: cat, value: cat });
                    elementsByCategory[cat] = items;
                    items.forEach(name => addPreviewFor(`${cat}/${name}`, path.join(catPath, name)));
                });

                if (rootCategory) categories.push(rootCategory);
            } catch (e) {
                console.warn("ElementsMapping: Failed to read singles directory", e);
            }
            return { categories, elementsByCategory, previewDataById };
        };

        const scanTilesets = () => {
            if (!Utils?.isNwjs?.() || typeof require !== "function") return { folders: [], previewDataByFolder: {} };
            const fs = require("fs");
            const path = require("path");
            const tilesetBase = path.join(process.cwd(), "img", "elements", "tilesets");
            const required = ["collision_base.png", "bottom_base.png", "top_base.png"];
            let folders = [];
            const previewDataByFolder = {};
            try {
                folders = fs.readdirSync(tilesetBase, { withFileTypes: true })
                    .filter(d => d.isDirectory())
                    .map(d => d.name)
                    .filter(name => {
                        const dir = path.join(tilesetBase, name);
                        const missing = required.filter(f => !fs.existsSync(path.join(dir, f)));
                        if (missing.length) {
                            console.warn(`ElementsMapping: tileset folder '${name}' missing files: ${missing.join(", ")}`);
                            return false;
                        }
                        return true;
                    })
                    .sort((a, b) => a.localeCompare(b));

                const toData = filePath => "data:image/png;base64," + fs.readFileSync(filePath).toString("base64");
                folders.forEach(name => {
                    const dir = path.join(tilesetBase, name);
                    const botFxPath = path.join(dir, "bottom_fx01.png");
                    const botFx2Path = path.join(dir, "bottom_fx02.png");
                    const fxPath = path.join(dir, "top_fx01.png");
                    const fx2Path = path.join(dir, "top_fx02.png");
                    previewDataByFolder[name] = {
                        bot: toData(path.join(dir, "bottom_base.png")),
                        botFx: fs.existsSync(botFxPath) ? toData(botFxPath) : null,
                        botFx2: fs.existsSync(botFx2Path) ? toData(botFx2Path) : null,
                        top: toData(path.join(dir, "top_base.png")),
                        fx: fs.existsSync(fxPath) ? toData(fxPath) : null,
                        fx2: fs.existsSync(fx2Path) ? toData(fx2Path) : null
                    };
                });
            } catch (e) {
                console.warn("ElementsMapping: Failed to read tileset directory", e);
            }
            return { folders, previewDataByFolder };
        };

        const { categories, elementsByCategory, previewDataById } = scanSingles();
        const { folders, previewDataByFolder } = scanTilesets();
        const baseHref = "file:///" + process.cwd().replace(/\\/g, "/") + "/";
        const singleHtml = this._addPopupHTML(categories, elementsByCategory, previewDataById);
        const tilesetHtml = this._tilesetPopupHTML(folders, baseHref, previewDataByFolder);
        const singleSrc = "data:text/html," + encodeURIComponent(singleHtml);
        const tilesetSrc = "data:text/html," + encodeURIComponent(tilesetHtml);
        return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Elements Mapping</title>
<style>
${this._sharedCSS()}
.tabs { display:flex; gap:8px; border-bottom:1px solid #2f3340; padding:0 4px; }
.tab-btn { border-radius:8px 8px 0 0; border:1px solid #444; border-bottom:1px solid #2f3340; background:#171b24; padding:10px 14px; font-weight:600; color:#9ca3b5; margin-bottom:-1px; }
.tab-btn.active { background:#1f2430; color:#e8ecf5; border-color:#4ac0ff; border-bottom-color:#1f2430; box-shadow: inset 0 -2px 0 0 #111217; }
.tab-btn:focus { outline:none; box-shadow:none; }
.tab-btn:focus-visible { outline:2px solid #4ac0ff; outline-offset:-2px; }
.tab-pane { display:none; padding:10px 4px 0 4px; }
.tab-pane.active { display:block; }
.layout { display:grid; grid-template-columns: 240px 1fr; gap:16px; align-items:start; }
.card label { display:block; margin-bottom:10px; }
.pos-card { background:#1e222d; border:1px solid #2f3340; padding:12px; border-radius:6px; width:360px; box-shadow:0 8px 18px rgba(0,0,0,0.35); }
.pos-grid { display:grid; grid-template-columns: repeat(5, 1fr); gap:8px; margin-top:8px; }
.pos-grid input { width:100%; }
.actions-row { display:flex; gap:12px; margin:10px 0 0 0; }
.actions-row button { flex:1; height:44px; font-size:15px; }
.cols { display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap; margin-top:16px; }
.col { background:#1e222d; border:1px solid #2f3340; padding:10px; min-width:160px; width:186px; height:380px; overflow-y:auto; border-radius:6px; }
.col h4 { margin:0 0 8px 0; font-size:13px; color:#9ca3b5; }
.item { font-size:12px; margin:2px 0; padding:6px 6px; border-radius:4px; background:#1f2430; border:1px solid #2f3340; display:flex; align-items:center; justify-content:space-between; gap:6px; min-height:28px; }
.item button.del-btn { background:#252a36; color:#e8ecf5; border:1px solid #2f3340; border-radius:4px; padding:2px 6px; cursor:pointer; font-size:11px; line-height:14px; height:22px; min-width:24px; }
.item button.del-btn:hover { background:#303543; }
.item.active { background:#ffe500; color:#111; border:1px solid #b7a200; }
.iframe-shell { border:1px solid #2f3340; border-radius:6px; overflow:hidden; box-shadow:0 8px 18px rgba(0,0,0,0.35); }
.iframe-shell iframe { width:100%; height:1000px; border:none; display:block; background:#111; }
</style>
</head>
<body>
  <div class="tabs">
    <button class="tab-btn active" data-tab="main">Overview</button>
    <button class="tab-btn" data-tab="single">Add Single</button>
    <button class="tab-btn" data-tab="tileset">Add Tileset</button>
  </div>

  <div id="tab-main" class="tab-pane active">
    <div class="layout">
      <div class="card">
        <h3>Elements Debug</h3>
        <label><input id="chkColl" type="checkbox"> Collision Overlay</label>
        <label><input id="chkCols" type="checkbox"> Collider Outlines</label>
        <label><input id="chkAutoSave" type="checkbox"> JSON auto-update</label>
        <button id="btnSaveJson" style="margin-top:6px; width:140px;">SAVE to JSON</button>
      </div>

      <div class="pos-card">
        <h3 style="margin:0 0 8px 0;">Element Positioning</h3>
        <div class="pos-grid">
          <button class="btnMove" data-dx="-96" data-dy="0">&#8592; 96</button>
          <button class="btnMove" data-dx="-48" data-dy="0">&#8592; 48</button>
          <input id="posX" type="number">
          <button class="btnMove" data-dx="48" data-dy="0">48 &#8594;</button>
          <button class="btnMove" data-dx="96" data-dy="0">96 &#8594;</button>

          <button class="btnMove" data-dx="0" data-dy="96">&#8595; 96</button>
          <button class="btnMove" data-dx="0" data-dy="48">&#8595; 48</button>
          <input id="posY" type="number">
          <button class="btnMove" data-dx="0" data-dy="-48">48 &#8593;</button>
          <button class="btnMove" data-dx="0" data-dy="-96">96 &#8593;</button>
        </div>
        <div style="display:flex; justify-content:flex-end; margin-top:6px;">
          <button id="btnPickPos" style="width:360px;">Click on the map to reposition this element</button>
        </div>
        <small id="selInfo" style="color:#aaa; display:block; margin-top:6px;">No element selected</small>
      </div>
    </div>

    <div id="cols" class="cols"></div>
  </div>

  <div id="tab-single" class="tab-pane">
    <div class="iframe-shell">
      <iframe id="singleFrame" src="${singleSrc}" title="Add Single Element"></iframe>
    </div>
  </div>

  <div id="tab-tileset" class="tab-pane">
    <div class="iframe-shell">
      <iframe id="tilesetFrame" src="${tilesetSrc}" title="Add Tileset Element" style="height:1000px;"></iframe>
    </div>
  </div>

  <script>
    const tabs = Array.from(document.querySelectorAll(".tab-btn"));
    const panes = { main: document.getElementById("tab-main"), single: document.getElementById("tab-single"), tileset: document.getElementById("tab-tileset") };
    function switchTab(tab) {
        tabs.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
        Object.entries(panes).forEach(([k, pane]) => pane.classList.toggle("active", k === tab));
    }
    tabs.forEach(btn => btn.onclick = () => switchTab(btn.dataset.tab));
    window.addEventListener("message", e => {
        if (e.data && e.data.type === "elementsMappingSwitchTab") switchTab(e.data.tab);
    });

    const host = window.opener;
    const chkColl = document.getElementById("chkColl");
    const chkCols = document.getElementById("chkCols");
    const chkAutoSave = document.getElementById("chkAutoSave");
    const btnSaveJson = document.getElementById("btnSaveJson");
    const colsDiv = document.getElementById("cols");
    const posX = document.getElementById("posX");
    const posY = document.getElementById("posY");
    const selInfo = document.getElementById("selInfo");
    const btnAddElement = document.getElementById("btnAddElement");
    const btnAddTilesetElement = document.getElementById("btnAddTilesetElement");
    const btnDeleteElement = document.getElementById("btnDeleteElement");
    const btnPickPos = document.getElementById("btnPickPos");
    let currentSelection = null;

    document.querySelectorAll(".btnMove").forEach(btn => {
        btn.onclick = () => {
            if (currentSelection == null) return;
            const dx = Number(btn.dataset.dx || 0);
            const dy = Number(btn.dataset.dy || 0);
            host.postMessage({ type:"elementsMappingMove", dx, dy },"*");
        };
    });
    [posX, posY].forEach(inp => {
        inp.onchange = () => {
            if (currentSelection == null) return;
            const x = Number(posX.value);
            const y = Number(posY.value);
            host.postMessage({ type:"elementsMappingSet", x, y },"*");
        };
    });

    function renderColumns(columns){
        colsDiv.innerHTML = "";
        if (!columns || !columns.length) columns = Array.from({ length: 8 }, () => []);
        if (columns.length < 8) for (let i = columns.length; i < 8; i++) columns.push([]);
        columns.forEach((col, idx) => {
            const wrap = document.createElement("div");
            wrap.className = "col";
            const h = document.createElement("h4");
            h.textContent = "X " + (idx*480) + " - " + ((idx+1)*480);
            wrap.appendChild(h);
            if (!col.length) {
                const empty = document.createElement("div");
                empty.className = "item";
                empty.style.color = "#888";
                empty.style.fontSize = "12px";
                empty.textContent = "(empty)";
                wrap.appendChild(empty);
            } else {
                col.forEach(item => {
                    let displayName = "";
                    if (item.id && item.id.startsWith("tileset:")) {
                        const parts = item.id.split(":");
                        displayName = decodeURIComponent(parts[1] || "");
                    } else {
                        displayName = (item.id || "").split("/").pop();
                    }
                    const d = document.createElement("div");
                    d.className = "item";
                    d.dataset.index = item.index;

                    const nameSpan = document.createElement("span");
                    nameSpan.textContent = displayName;
                    nameSpan.style.flex = "1";

                    const delBtn = document.createElement("button");
                    delBtn.className = "del-btn";
                    delBtn.textContent = "✕";
                    delBtn.title = "Delete this element";
                    delBtn.onclick = ev => {
                        ev.stopPropagation();
                        host.postMessage({ type:"elementsMappingDelete", index:item.index },"*");
                    };

                    d.onclick = () => {
                        if (currentSelection === item.index) {
                            currentSelection = null;
                            host.postMessage({ type:"elementsMappingSelect", index:null },"*");
                        } else {
                            currentSelection = item.index;
                            host.postMessage({ type:"elementsMappingSelect", index:item.index },"*");
                        }
                        highlightActive();
                    };

                    d.appendChild(nameSpan);
                    d.appendChild(delBtn);
                    wrap.appendChild(d);
                });
            }
            colsDiv.appendChild(wrap);
        });
        highlightActive();
    }
    function highlightActive() {
        colsDiv.querySelectorAll(".item").forEach(el => {
            const idx = Number(el.dataset.index);
            el.classList.toggle("active", currentSelection === idx);
        });
    }

    window.addEventListener("message", e => {
        if (e.data.type === "elementsMappingState") {
            chkColl.checked = !!e.data.collisionOverlay;
            chkCols.checked = !!e.data.colliderOverlay;
            chkAutoSave.checked = !!e.data.autoSaveJson;
            btnSaveJson.disabled = chkAutoSave.checked;
            currentSelection = e.data.selected ? e.data.selected.index : null;
            renderColumns(e.data.columns);
            if (e.data.selected) {
                posX.value = e.data.selected.x;
                posY.value = e.data.selected.y;
                selInfo.textContent = \`Selected: \${e.data.selected.id}\`;
            } else {
                posX.value = "";
                posY.value = "";
                selInfo.textContent = "No element selected";
            }
        }
    });
    const send = () => {
        host.postMessage({
            type:"elementsMappingToggle",
            collisionOverlay: chkColl.checked,
            colliderOverlay: chkCols.checked,
            autoSaveJson: chkAutoSave.checked
        },"*");
    };
    chkColl.onchange = send;
    chkCols.onchange = send;
    chkAutoSave.onchange = () => { btnSaveJson.disabled = chkAutoSave.checked; send(); };
    btnSaveJson.onclick = () => host.postMessage({ type:"elementsMappingSave" },"*");
    if (btnPickPos) btnPickPos.onclick = () => host.postMessage({ type:"elementsMappingPickPositionStart" },"*");
    host?.postMessage({ type:"elementsMappingPing" },"*");
  </script>
</body>
</html>`;
    },
    _tilesetPopupHTML(folders = [], baseHref = "", previewDataByFolder = {}) {
        // Copied design from legacy tileset picker (placeholder behavior)
        const fxModeOptions = ElementsMapping._fxModeOptionsHtml();
        return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<base href="${baseHref}">
<title>Add Tileset Element</title>
<style>
${this._sharedCSS()}
body { user-select: none; }
.field { display: flex; align-items: center; gap: 10px; }
.field label { min-width: 120px; }
.checkbox-field { display: flex; align-items: center; gap: 10px; }
.checkbox-field label { min-width: 150px; }
.checkbox-field input { width: 18px; height: 18px; }
.row-inline { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; }
.cards-row { display: flex; gap: 16px; align-items: flex-start; margin: 8px 0 10px 0; flex-wrap: wrap; }
.tile-card { background: var(--panel); border: 1px solid var(--border); padding: 18px 14px 14px 14px; position: relative; display: flex; flex-direction: column; gap: 10px; flex: 1; min-width: 320px; margin-top: 14px; margin-bottom: 8px; border-radius:10px; box-shadow:0 10px 24px rgba(0,0,0,0.25); }
.sel-info { color: var(--text-muted); font-size: 12px; text-align: right; min-width: 180px; display: inline-block; }
.preview-shell { width: 100%; max-width: 820px; margin: 6px auto 0 auto; }
.preview { width: 768px; height: 576px; border: 1px solid var(--border); background: #0b0d12; position: relative; border-radius:8px; overflow:hidden; }
.preview canvas { position:absolute; top:0; left:0; image-rendering: pixelated; width:768px; height:576px; }
</style>
</head>
<body>
  
  <div class="field" style="margin-bottom:10px;">
    <label for="folderSel" style="min-width:70px;">Folder</label>
    <select id="folderSel" style="flex:1; min-width:260px;"></select>
  </div>
  <div class="row-inline" style="margin-bottom:8px;">
    <div class="checkbox-field">
      <label for="chkGround" style="min-width:160px;">Draw on the Ground Layer</label>
      <input id="chkGround" type="checkbox">
    </div>
    <div class="checkbox-field">
      <label for="chkRound10" style="min-width:140px;">Round to closest 10th</label>
      <input id="chkRound10" type="checkbox">
    </div>
    <div class="checkbox-field">
      <label for="chkSnap48" style="min-width:140px;">Snap to a 48px Grid</label>
      <input id="chkSnap48" type="checkbox">
    </div>
  </div>

  <div class="cards-row">
    <div class="tile-card">
      <div class="card-label">Bottom</div>
      <div class="checkbox-field">
        <label for="chkBottomUseFx">Use Additional FX Layer 1</label>
        <input id="chkBottomUseFx" type="checkbox">
      </div>
      <div class="field">
        <label for="bottomFxMode">FX Layer 1</label>
        <select id="bottomFxMode" style="width:220px;">
${fxModeOptions}
        </select>
      </div>
      <div class="checkbox-field">
        <label for="chkBottomUseFx2">Use Additional FX Layer 2</label>
        <input id="chkBottomUseFx2" type="checkbox">
      </div>
      <div class="field">
        <label for="bottomFxMode2">FX Layer 2</label>
        <select id="bottomFxMode2" style="width:220px;">
${fxModeOptions}
        </select>
      </div>
    </div>

    <div class="tile-card">
      <div class="card-label">Top</div>
      <div class="checkbox-field">
        <label for="chkGradient">Use gradient fade</label>
        <input id="chkGradient" type="checkbox">
      </div>
      <div class="checkbox-field">
        <label for="chkUseFx">Use Additional FX Layer 1</label>
        <input id="chkUseFx" type="checkbox">
      </div>
      <div class="field">
        <label for="fxMode">FX Layer 1</label>
        <select id="fxMode" style="width:220px;">
${fxModeOptions}
        </select>
      </div>
      <div class="checkbox-field">
        <label for="chkUseFx2">Use Additional FX Layer 2</label>
        <input id="chkUseFx2" type="checkbox">
      </div>
      <div class="field">
        <label for="fxMode2">FX Layer 2</label>
        <select id="fxMode2" style="width:220px;">
${fxModeOptions}
        </select>
      </div>
    </div>
  </div>

  <div class="preview-shell">
    <div style="text-align:right; padding-right:0; margin-bottom:4px;">
      <span id="selInfo" class="sel-info">Current Grid Selection: (none)</span>
    </div>
    <div class="preview">
      <canvas id="tilesetCanvas" width="768" height="576"></canvas>
      <canvas id="overlayCanvas" width="768" height="576" style="pointer-events:none;"></canvas>
    </div>
  </div>
  <script>
    const host = window.opener || (window.parent && window.parent.opener) || window.parent;
    const chkGradient = document.getElementById("chkGradient");
    const chkGround = document.getElementById("chkGround");
    const chkRound10 = document.getElementById("chkRound10");
    const chkSnap48 = document.getElementById("chkSnap48");
    const chkUseFx = document.getElementById("chkUseFx");
    const chkUseFx2 = document.getElementById("chkUseFx2");
    const fxModeSel = document.getElementById("fxMode");
    const fxMode2Sel = document.getElementById("fxMode2");
    const chkBottomUseFx = document.getElementById("chkBottomUseFx");
    const chkBottomUseFx2 = document.getElementById("chkBottomUseFx2");
    const bottomFxModeSel = document.getElementById("bottomFxMode");
    const bottomFxMode2Sel = document.getElementById("bottomFxMode2");
    const folderSel = document.getElementById("folderSel");
    let folders = ${JSON.stringify(folders)};
    const previewDataByFolder = ${JSON.stringify(previewDataByFolder)};
    const canvas = document.getElementById("tilesetCanvas");
    const ctx = canvas.getContext("2d");
    const overlay = document.getElementById("overlayCanvas");
    const octx = overlay.getContext("2d");
    overlay.style.pointerEvents = "none";
    const selInfo = document.getElementById("selInfo");
    const GRID = 48;
    let drawMeta = null;
    let selection = null;
    let dragging = false;

    function renderFolders() {
        if ((!folders || !folders.length) && previewDataByFolder && Object.keys(previewDataByFolder).length) {
            folders = Object.keys(previewDataByFolder);
        }
        folderSel.innerHTML = "";
        if (!folders.length) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "(no tileset folders found)";
            folderSel.appendChild(opt);
            folderSel.disabled = true;
            return;
        }
        folders.forEach(name => {
            const opt = document.createElement("option");
            opt.value = name;
            opt.textContent = name;
            folderSel.appendChild(opt);
        });
        folderSel.disabled = false;
        folderSel.value = folders[0] || "";
    }
    renderFolders();

    function updateSelectionInfo() {
        if (!selInfo) return;
        if (selection) selInfo.textContent = \`Current Grid Selection: \${selection.w} x \${selection.h}\`;
        else selInfo.textContent = "No selection";
    }

    function drawOverlay() {
        octx.clearRect(0, 0, overlay.width, overlay.height);
        if (!drawMeta) return;
        const { dx, dy, scale, srcW, srcH } = drawMeta;
        octx.strokeStyle = "rgba(255,255,255,0.15)";
        octx.lineWidth = 1;
        for (let x = dx; x <= dx + srcW * scale + 0.5; x += GRID * scale) {
            const px = Math.round(x) + 0.5;
            octx.beginPath(); octx.moveTo(px, dy); octx.lineTo(px, dy + srcH * scale); octx.stroke();
        }
        for (let y = dy; y <= dy + srcH * scale + 0.5; y += GRID * scale) {
            const py = Math.round(y) + 0.5;
            octx.beginPath(); octx.moveTo(dx, py); octx.lineTo(dx + srcW * scale, py); octx.stroke();
        }
        if (selection) {
            const sx = dx + selection.x * scale;
            const sy = dy + selection.y * scale;
            const sw = selection.w * scale;
            const sh = selection.h * scale;
            octx.fillStyle = "rgba(255,230,0,0.18)";
            octx.strokeStyle = "rgba(255,230,0,0.9)";
            octx.lineWidth = 2;
            octx.fillRect(sx, sy, sw, sh);
            octx.strokeRect(sx + 1, sy + 1, Math.max(0, sw - 2), Math.max(0, sh - 2));
        }
    }

    function drawLayered(
        botSrc,
        topSrc,
        fxSrc,
        fx2Src,
        botFxSrc,
        botFx2Src,
        keepSelection = false,
        opts = {}
    ) {
        const sources = [
            { src: botSrc || "" },                         // 0 base
            { src: topSrc || "" },                         // 1 top
            { src: (opts.useFx ? fxSrc : "") || "" },      // 2 top fx1
            { src: (opts.useFx2 ? fx2Src : "") || "" },    // 3 top fx2
            { src: (opts.useBottomFx ? botFxSrc : "") || "" },  // 4 bottom fx1
            { src: (opts.useBottomFx2 ? botFx2Src : "") || "" } // 5 bottom fx2
        ];
        const images = sources.map(() => new Image());
        let loaded = 0;
        const onLoad = () => {
            loaded++;
            if (loaded < images.length) return;
            const base = images[0];
            const top = images[1];
            const fx1 = images[2];
            const fx2 = images[3];
            const bfx1 = images[4];
            const bfx2 = images[5];
            const srcW = Math.max(base.width, top.width, fx1.width, fx2.width, bfx1.width, bfx2.width);
            const srcH = Math.max(base.height, top.height, fx1.height, fx2.height, bfx1.height, bfx2.height);
            const maxW = canvas.width - 32;
            const maxH = canvas.height - 32;
            const scale = Math.min(1, Math.min(maxW / srcW, maxH / srcH));
            const dx = (canvas.width - srcW * scale) / 2;
            const dy = (canvas.height - srcH * scale) / 2;
            const drawLayer = (img, mode = "normal") => {
                if (!img || !img.width || !img.height) return;
                const text = String(mode || "normal");
                const blend =
                    text.startsWith("displace:") ? "source-over" :
                    text === "multiply" ? "multiply" :
                    text === "add" ? "lighter" :
                    text === "screen" ? "screen" :
                    "source-over";
                ctx.save();
                ctx.globalCompositeOperation = blend;
                ctx.drawImage(img, 0, 0, srcW, srcH, dx, dy, srcW * scale, srcH * scale);
                ctx.restore();
            };
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = false;
            drawLayer(base, "normal");
            if (opts.useBottomFx) drawLayer(bfx1, opts.bottomFxMode || "normal");
            if (opts.useBottomFx2) drawLayer(bfx2, opts.bottomFxMode2 || opts.bottomFxMode || "normal");
            drawLayer(top, "normal");
            if (opts.useFx) drawLayer(fx1, opts.fxMode || "normal");
            if (opts.useFx2) drawLayer(fx2, opts.fxMode2 || opts.fxMode || "normal");
            drawMeta = { dx, dy, scale, srcW, srcH };
            if (!keepSelection) selection = null;
            updateSelectionInfo();
            drawOverlay();
        };
        images.forEach((img, idx) => {
            img.onload = onLoad;
            img.onerror = onLoad;
            img.src = sources[idx].src;
        });
    }

    function loadPreview(name, keepSelection = false) {
        const entry = previewDataByFolder[name] || {};
        const botSrc = entry.bot || ("img/elements/tilesets/" + encodeURIComponent(name) + "/bottom_base.png");
        const botFxSrc = entry.botFx || ("img/elements/tilesets/" + encodeURIComponent(name) + "/bottom_fx01.png");
        const botFx2Src = entry.botFx2 || ("img/elements/tilesets/" + encodeURIComponent(name) + "/bottom_fx02.png");
        const topSrc = entry.top || ("img/elements/tilesets/" + encodeURIComponent(name) + "/top_base.png");
        const fxSrc  = entry.fx  || ("img/elements/tilesets/" + encodeURIComponent(name) + "/top_fx01.png");
        const fx2Src = entry.fx2 || ("img/elements/tilesets/" + encodeURIComponent(name) + "/top_fx02.png");
        const opts = {
            useFx: !!(chkUseFx && chkUseFx.checked),
            useFx2: !!(chkUseFx2 && chkUseFx2.checked),
            useBottomFx: !!(chkBottomUseFx && chkBottomUseFx.checked),
            useBottomFx2: !!(chkBottomUseFx2 && chkBottomUseFx2.checked),
            fxMode: (fxModeSel && fxModeSel.value) || "opaque",
            fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque",
            bottomFxMode: (bottomFxModeSel && bottomFxModeSel.value) || "opaque",
            bottomFxMode2: (bottomFxMode2Sel && bottomFxMode2Sel.value) || "opaque"
        };
        drawLayered(botSrc, topSrc, fxSrc, fx2Src, botFxSrc, botFx2Src, keepSelection, opts);
    }

    const refreshLocalPreview = (keepSelection = true) => loadPreview(folderSel.value, keepSelection);

    folderSel.onchange = () => loadPreview(folderSel.value);

    canvas.addEventListener("mousedown", e => {
        if (!drawMeta) return;
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const { dx, dy, scale, srcW, srcH } = drawMeta;
        const gx = Math.max(0, Math.floor((cx - dx) / (GRID * scale)) * GRID);
        const gy = Math.max(0, Math.floor((cy - dy) / (GRID * scale)) * GRID);
        selection = {
            x: Math.min(gx, Math.max(0, srcW - GRID)),
            y: Math.min(gy, Math.max(0, srcH - GRID)),
            w: GRID,
            h: GRID
        };
        dragging = true;
        updateSelectionInfo();
        drawOverlay();
        sendPreview();
    });

    canvas.addEventListener("mousemove", e => {
        if (!dragging || !drawMeta) return;
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const { dx, dy, scale, srcW, srcH } = drawMeta;
        const gx = Math.max(0, Math.floor((cx - dx) / (GRID * scale)) * GRID);
        const gy = Math.max(0, Math.floor((cy - dy) / (GRID * scale)) * GRID);
        const maxW = Math.max(GRID, srcW - selection.x);
        const maxH = Math.max(GRID, srcH - selection.y);
        selection.w = Math.max(GRID, Math.min(maxW, gx - selection.x + GRID));
        selection.h = Math.max(GRID, Math.min(maxH, gy - selection.y + GRID));
        updateSelectionInfo();
        drawOverlay();
        sendPreview();
    });

    window.addEventListener("mouseup", () => { dragging = false; });

    function sendPreview() {
        if (!selection || !folderSel.value) return;
        host.postMessage({
            type: "elementsMappingTilesetPreviewStart",
            folder: folderSel.value,
            selection: { ...selection },
            isGround: !!(chkGround && chkGround.checked),
            useGradient: !!(chkGradient && chkGradient.checked),
            useBottomFx: !!(chkBottomUseFx && chkBottomUseFx.checked),
            bottomFxMode: (bottomFxModeSel && bottomFxModeSel.value) || "opaque",
            useBottomFx2: !!(chkBottomUseFx2 && chkBottomUseFx2.checked),
            bottomFxMode2: (bottomFxMode2Sel && bottomFxMode2Sel.value) || "opaque",
            useFx: !!(chkUseFx && chkUseFx.checked),
            useFx2: !!(chkUseFx2 && chkUseFx2.checked),
            roundTo10: !!(chkRound10 && chkRound10.checked),
            snapTo48: !!(chkSnap48 && chkSnap48.checked),
            fxMode: (fxModeSel && fxModeSel.value) || "opaque",
            fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque"
        }, "*");
    }

    if (chkGradient) chkGradient.onchange = () => { sendPreview(); refreshLocalPreview(); };
    if (chkGround) chkGround.onchange = () => { sendPreview(); refreshLocalPreview(); };
    if (chkUseFx) chkUseFx.onchange = () => { sendPreview(); refreshLocalPreview(); };
    if (chkUseFx2) chkUseFx2.onchange = () => { sendPreview(); refreshLocalPreview(); };
    if (chkRound10) chkRound10.onchange = () => {
        if (chkRound10.checked && chkSnap48) chkSnap48.checked = false;
        sendPreview();
        refreshLocalPreview();
    };
    if (chkSnap48) chkSnap48.onchange = () => {
        if (chkSnap48.checked && chkRound10) chkRound10.checked = false;
        sendPreview();
        refreshLocalPreview();
    };
    if (fxModeSel) fxModeSel.onchange = () => { sendPreview(); refreshLocalPreview(); };
    if (fxMode2Sel) fxMode2Sel.onchange = () => { sendPreview(); refreshLocalPreview(); };
    if (chkBottomUseFx) chkBottomUseFx.onchange = () => { sendPreview(); refreshLocalPreview(); };
    if (chkBottomUseFx2) chkBottomUseFx2.onchange = () => { sendPreview(); refreshLocalPreview(); };
    if (bottomFxModeSel) bottomFxModeSel.onchange = () => { sendPreview(); refreshLocalPreview(); };
    if (bottomFxMode2Sel) bottomFxMode2Sel.onchange = () => { sendPreview(); refreshLocalPreview(); };

    if (folders.length) loadPreview(folders[0]);
  </script>
</body>
</html>`;
    },

    _addPopupHTML(categories = [], elementsByCategory = {}, previewDataById = {}) {
        // Copied design from legacy single picker (placeholder behavior)
        const fxModeOptions = ElementsMapping._fxModeOptionsHtml();
        return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Add Single Element</title>
<style>
${this._sharedCSS()}
body { padding: 16px; }
h3 { margin: 0 0 14px 0; letter-spacing: 0.2px; }
.layout { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.left { flex: 1; min-width: 320px; display: flex; flex-direction: column; gap: 12px; }
.right { flex: 1; min-width: 280px; }
.field label { width: 170px; }
.checkbox-field { justify-content: space-between; }
.checkbox-field label { flex: 1; }
.card { padding: 18px 14px 14px 14px; position: relative; gap: 10px; margin-top: 20px; }
.card:first-of-type { margin-top: 30px; }
.card + .card { margin-top: 10px; }
.list { max-height: 530px; min-height: 530px; overflow-y: auto; }
.item { padding: 8px 10px; margin: 4px 0; }
.item:hover { background:#3a3a3a; }
.item.selected { background:#556; border-color:#88a; }
.single-preview-shell { margin-top: 12px; padding: 8px; background: #161922; border: 1px solid #2a2e3a; border-radius: 12px; flex: 1 1 100%; }
.single-preview-shell canvas { width: 100%; height: auto; background: #0f1118; border: 1px solid #2a2e3a; border-radius: 10px; display: block; }
</style>
</head>
<body>
  <h3>Add Single Element</h3>
  <div class="layout">
    <div class="left">
      <div class="field">
        <label for="folderSel">Folder</label>
        <select id="folderSel" style="flex:1;"></select>
      </div>
      <div class="checkbox-field">
        <label for="chkRound10">Round to closest 10th</label>
        <input id="chkRound10" type="checkbox">
      </div>
      <div class="checkbox-field">
        <label for="chkSnap48">Snap to a 48px Grid</label>
        <input id="chkSnap48" type="checkbox">
      </div>

      <div class="card">
        <div class="card-label">Top</div>
        <div class="checkbox-field">
          <label for="chkGradient">Use gradient fade</label>
          <input id="chkGradient" type="checkbox">
        </div>
        <div class="checkbox-field">
          <label for="chkUseFx">Use Additional FX Layer 1</label>
          <input id="chkUseFx" type="checkbox">
        </div>
        <div class="field">
          <label for="fxMode">FX Layer 1</label>
          <select id="fxMode" style="width:220px;">
${fxModeOptions}
          </select>
        </div>
        <div class="checkbox-field">
          <label for="chkUseFx2">Use Additional FX Layer 2</label>
          <input id="chkUseFx2" type="checkbox">
        </div>
        <div class="field">
          <label for="fxMode2">FX Layer 2</label>
          <select id="fxMode2" style="width:220px;">
${fxModeOptions}
          </select>
        </div>
      </div>

      <div class="card">
        <div class="card-label">Bottom</div>
        <div class="checkbox-field">
          <label for="chkBottomUseFx">Use Additional FX Layer 1</label>
          <input id="chkBottomUseFx" type="checkbox">
        </div>
        <div class="field">
          <label for="bottomFxMode">FX Layer 1</label>
          <select id="bottomFxMode" style="width:220px;">
${fxModeOptions}
          </select>
        </div>
        <div class="checkbox-field">
          <label for="chkBottomUseFx2">Use Additional FX Layer 2</label>
          <input id="chkBottomUseFx2" type="checkbox">
        </div>
        <div class="field">
          <label for="bottomFxMode2">FX Layer 2</label>
          <select id="bottomFxMode2" style="width:220px;">
${fxModeOptions}
          </select>
        </div>
      </div>
    </div>

    <div class="right">
      <div class="list-shell">
        <div id="list" class="list"></div>
      </div>
    </div>
    <div class="single-preview-shell">
      <canvas id="singlePreviewCanvas" width="768" height="330"></canvas>
    </div>
  </div>
  <script>
    const host = window.opener || (window.parent && window.parent.opener) || window.parent;
    const categories = ${JSON.stringify(categories)};
    const elementsByCategory = ${JSON.stringify(elementsByCategory)};
    const previewDataById = ${JSON.stringify(previewDataById)};
    const listDiv = document.getElementById("list");
    const folderSel = document.getElementById("folderSel");
    const chkGradient = document.getElementById("chkGradient");
    const chkRound10 = document.getElementById("chkRound10");
    const chkSnap48 = document.getElementById("chkSnap48");
    const chkUseFx = document.getElementById("chkUseFx");
    const chkUseFx2 = document.getElementById("chkUseFx2");
    const fxModeSel = document.getElementById("fxMode");
    const fxMode2Sel = document.getElementById("fxMode2");
    const chkBottomUseFx = document.getElementById("chkBottomUseFx");
    const chkBottomUseFx2 = document.getElementById("chkBottomUseFx2");
    const bottomFxModeSel = document.getElementById("bottomFxMode");
    const bottomFxMode2Sel = document.getElementById("bottomFxMode2");
    const canvas = document.getElementById("singlePreviewCanvas");
    const ctx = canvas?.getContext("2d");

    let currentId = null;

    function drawPreview(layered) {
        if (!ctx || !canvas) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!layered || !layered.bot) return;
        const imgs = ["botFx", "botFx2", "bot", "top", "fx", "fx2"].map(k => layered[k]).filter(Boolean);
        const srcW = Math.max(...imgs.map(i => i.width || 0), layered.bot.width);
        const srcH = Math.max(...imgs.map(i => i.height || 0), layered.bot.height);
        const maxW = canvas.width - 32;
        const maxH = canvas.height - 32;
        const scale = Math.min(1, Math.min(maxW / srcW, maxH / srcH));
        const dx = (canvas.width - srcW * scale) / 2;
        const dy = (canvas.height - srcH * scale) / 2;
        const drawLayer = (img, mode = "normal") => {
            if (!img || !img.width || !img.height) return;
            const text = String(mode || "normal");
            const blend =
                text.startsWith("displace:") ? "source-over" :
                text === "multiply" ? "multiply" :
                text === "add" ? "lighter" :
                text === "screen" ? "screen" :
                "source-over";
            ctx.save();
            ctx.globalCompositeOperation = blend;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, img.width * scale, img.height * scale);
            ctx.restore();
        };
        drawLayer(layered.bot, "normal");
        if (layered.useBottomFx) drawLayer(layered.botFx, layered.bottomFxMode || "normal");
        if (layered.useBottomFx2) drawLayer(layered.botFx2, layered.bottomFxMode2 || layered.bottomFxMode || "normal");
        drawLayer(layered.top, "normal");
        if (layered.useFx) drawLayer(layered.fx, layered.fxMode || "normal");
        if (layered.useFx2) drawLayer(layered.fx2, layered.fxMode2 || layered.fxMode || "normal");
    }

    function loadLayered(id) {
        return new Promise(resolve => {
            if (!id) return resolve(null);
            const entry = previewDataById[id];
            const keys = [
                ["bot", entry?.bot],
                ["botFx", entry?.botFx],
                ["botFx2", entry?.botFx2],
                ["top", entry?.top],
                ["fx", entry?.fx],
                ["fx2", entry?.fx2]
            ];
            const out = {};
            let remaining = keys.length;
            const done = () => {
                remaining--;
                if (remaining <= 0) resolve(out);
            };
            keys.forEach(([k, src]) => {
                const img = new Image();
                img.onload = () => { out[k] = img; done(); };
                img.onerror = () => { out[k] = null; done(); };
                img.src = src || "";
            });
        });
    }

    async function refreshCanvasPreview() {
        if (!currentId) { drawPreview(null); return; }
        const layered = await loadLayered(currentId);
        if (!layered) { drawPreview(null); return; }
        layered.useFx = !!(chkUseFx && chkUseFx.checked);
        layered.useFx2 = !!(chkUseFx2 && chkUseFx2.checked);
        layered.fxMode = (fxModeSel && fxModeSel.value) || "opaque";
        layered.fxMode2 = (fxMode2Sel && fxMode2Sel.value) || "opaque";
        layered.useBottomFx = !!(chkBottomUseFx && chkBottomUseFx.checked);
        layered.useBottomFx2 = !!(chkBottomUseFx2 && chkBottomUseFx2.checked);
        layered.bottomFxMode = (bottomFxModeSel && bottomFxModeSel.value) || "opaque";
        layered.bottomFxMode2 = (bottomFxMode2Sel && bottomFxMode2Sel.value) || "opaque";
        drawPreview(layered);
    }

    const triggerSinglePreview = () => {
        if (currentId) {
            host.postMessage({
                type:"elementsMappingSinglePreviewStart",
                id: currentId,
                useGradient: !!(chkGradient && chkGradient.checked),
                useBottomFx: !!(chkBottomUseFx && chkBottomUseFx.checked),
                bottomFxMode: (bottomFxModeSel && bottomFxModeSel.value) || "opaque",
                useBottomFx2: !!(chkBottomUseFx2 && chkBottomUseFx2.checked),
                bottomFxMode2: (bottomFxMode2Sel && bottomFxMode2Sel.value) || "opaque",
                useFx: !!(chkUseFx && chkUseFx.checked),
                useFx2: !!(chkUseFx2 && chkUseFx2.checked),
                roundTo10: !!(chkRound10 && chkRound10.checked),
                snapTo48: !!(chkSnap48 && chkSnap48.checked),
                fxMode: (fxModeSel && fxModeSel.value) || "opaque",
                fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque"
            }, "*");
            refreshCanvasPreview();
        }
    };

    function buildIdPath(category, id) {
        return category ? (category + "/" + id) : id;
    }

    function renderList(category) {
        listDiv.innerHTML = "";
        const available = elementsByCategory[category] || [];
        if (!available.length) {
            const empty = document.createElement("div");
            empty.textContent = "(no elements found in this folder)";
            empty.style.color = "#888";
            listDiv.appendChild(empty);
            return;
        }
        available.forEach(id => {
            const div = document.createElement("div");
            div.className = "item";
            div.textContent = id;
            div.onclick = () => {
                currentId = buildIdPath(category, id);
                host.postMessage({
                    type:"elementsMappingSinglePreviewStart",
                    id: currentId,
                    useGradient: !!(chkGradient && chkGradient.checked),
                    useBottomFx: !!(chkBottomUseFx && chkBottomUseFx.checked),
                    bottomFxMode: (bottomFxModeSel && bottomFxModeSel.value) || "opaque",
                    useBottomFx2: !!(chkBottomUseFx2 && chkBottomUseFx2.checked),
                    bottomFxMode2: (bottomFxMode2Sel && bottomFxMode2Sel.value) || "opaque",
                    useFx: !!(chkUseFx && chkUseFx.checked),
                    useFx2: !!(chkUseFx2 && chkUseFx2.checked),
                    roundTo10: !!(chkRound10 && chkRound10.checked),
                    snapTo48: !!(chkSnap48 && chkSnap48.checked),
                    fxMode: (fxModeSel && fxModeSel.value) || "opaque",
                    fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque"
                }, "*");
                refreshCanvasPreview();
            };
            listDiv.appendChild(div);
        });
    }

    function renderFolderOptions() {
        folderSel.innerHTML = "";
        if (!categories.length) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.textContent = "(no folders)";
            folderSel.appendChild(opt);
            folderSel.disabled = true;
            return;
        }
        categories.forEach(c => {
            const opt = document.createElement("option");
            opt.value = c.value;
            opt.textContent = c.label;
            folderSel.appendChild(opt);
        });
        folderSel.disabled = false;
    }

    renderFolderOptions();
    const firstNonRoot = categories.find(c => c.value !== "")?.value;
    if (firstNonRoot != null) folderSel.value = firstNonRoot;
    const initial = folderSel.value;
    renderList(initial);
    refreshCanvasPreview();
    folderSel.onchange = () => renderList(folderSel.value);
    if (chkGradient) chkGradient.onchange = () => { triggerSinglePreview(); refreshCanvasPreview(); };
    if (chkRound10) chkRound10.onchange = () => {
        if (chkRound10.checked && chkSnap48) chkSnap48.checked = false;
        triggerSinglePreview();
    };
    if (chkSnap48) chkSnap48.onchange = () => {
        if (chkSnap48.checked && chkRound10) chkRound10.checked = false;
        triggerSinglePreview();
    };
    if (chkUseFx) chkUseFx.onchange = () => { triggerSinglePreview(); refreshCanvasPreview(); };
    if (chkUseFx2) chkUseFx2.onchange = () => { triggerSinglePreview(); refreshCanvasPreview(); };
    if (fxModeSel) fxModeSel.onchange = () => { triggerSinglePreview(); refreshCanvasPreview(); };
    if (fxMode2Sel) fxMode2Sel.onchange = () => { triggerSinglePreview(); refreshCanvasPreview(); };
    if (chkBottomUseFx) chkBottomUseFx.onchange = () => { triggerSinglePreview(); refreshCanvasPreview(); };
    if (chkBottomUseFx2) chkBottomUseFx2.onchange = () => { triggerSinglePreview(); refreshCanvasPreview(); };
    if (bottomFxModeSel) bottomFxModeSel.onchange = () => { triggerSinglePreview(); refreshCanvasPreview(); };
    if (bottomFxMode2Sel) bottomFxMode2Sel.onchange = () => { triggerSinglePreview(); refreshCanvasPreview(); };
  </script>
</body>
</html>`;
    }
};

// Boot editor hotkey on load (wait for Scene_Map definition)
(function bootstrapElementsMapping() {
    const wait = () => {
        if (typeof Scene_Map === "undefined") return setTimeout(wait, 30);
        ElementsMapping.Editor.init();
    };
    wait();
})();

(function patchSpritesetMapUpdate() {
    if (typeof Spriteset_Map === "undefined") return;
    const _Spriteset_Map_update = Spriteset_Map.prototype.update;
    Spriteset_Map.prototype.update = function() {
        _Spriteset_Map_update.call(this);

        ElementsMapping.Collision._updateOverlayPosition();
        if (ElementsMapping.Store.colliderOverlay) {
            ElementsMapping.Collision.updateColliderLayer();
        }
        ElementsMapping.DisplacementFX.update();

        const tilemap = this._tilemap;
        if (tilemap?.children) {
            tilemap.children.sort((a, b) => (a.z || 0) - (b.z || 0));
        }
        const upper = this._upperLayer;
        if (upper?.children) {
            upper.children.sort((a, b) => (a.z || 0) - (b.z || 0));
        }
    };
})();

// Hook Scene_Map lifecycle to load/unload elements
(function patchSceneMapLifecycle() {
    if (typeof Scene_Map === "undefined") return;
    const _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        _Scene_Map_start.call(this);
        Promise.resolve().then(() => ElementsMapping.MapLifecycle.onMapStart());
    };
    const _Scene_Map_terminate = Scene_Map.prototype.terminate;
    Scene_Map.prototype.terminate = function() {
        ElementsMapping.MapLifecycle.onMapEnd();
        _Scene_Map_terminate.call(this);
    };
})();
// Codex patch test marker
