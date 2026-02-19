/*:
 * @target MZ
 * @plugindesc v1.0 Elements Collision (loads ElementMaps and builds collision)
 * @author You
 *
 * @param Enable auto-opening
 * @type boolean
 * @default false
 * @desc If true, the live editor opens automatically when a playtest starts (and will snap per the setting below).
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
 */
"use strict";

// ============================================================================
// Root object + flags
// ============================================================================
const Elements = {};
Elements.DEBUG = true;            // Toggle collision overlay bitmap
Elements.DEBUG_COLLIDERS = true;  // Toggle collider outlines
Elements.AUTO_SAVE_JSON = false;  // Auto-save ElementMaps.json on edits
Elements.mapData = {};
Elements._menuCache = {};         // cache sprites when opening menu (same map)
Elements._mapReady = null;        // preload info for isReady gating
Elements._mapReadyPromise = null;
Elements.debugSprite = null;      // Collision overlay sprite
Elements.colliderLayer = null;    // PIXI.Graphics layer for colliders
Elements.currentElements = [];    // Elements currently loaded on map
Elements.currentMapId = null;
Elements.selectedIndex = -1;
Elements.DISPLACE_IMAGE = "displace"; // img/system/displace.png
Elements.DISPLACE_SCALE_X = 0.75;
Elements.DISPLACE_SCALE_Y = 0.75;
Elements.DISPLACE_SPEED_X = 25;
Elements.DISPLACE_SPEED_Y = 25;
Elements._params = (() => {
    const p = PluginManager.parameters("DotMoveSystem_ElementsDepthMapEx");
    return {
        autoOpen: String(p["Enable auto-opening"] || "false") === "true",
        snapTo: String(p["Snap live editor to"] || "top-left")
    };
})();

// Shared displacement filter applied only to FX (6.png) sprites
Elements.DisplacementFX = {
    sprite: null,
    filter: null,

    ensure(spriteset) {
        if (this.filter) return this.filter;
        if (!PIXI.filters?.DisplacementFilter) return null;
        this.sprite = new Sprite(ImageManager.loadSystem(Elements.DISPLACE_IMAGE));
        const tex = this.sprite.texture?.baseTexture;
        if (tex) {
            tex.wrapMode = PIXI.WRAP_MODES.REPEAT;
            if (!tex.valid && typeof tex.on === "function") {
                tex.on("loaded", () => { tex.wrapMode = PIXI.WRAP_MODES.REPEAT; });
            }
        }
        this.sprite.alpha = 0.0001; // effectively hidden but still rendered for the filter
        this.sprite.zIndex = 999998;
        this.filter = new PIXI.filters.DisplacementFilter(this.sprite);
        this.filter.scale.set(Elements.DISPLACE_SCALE_X, Elements.DISPLACE_SCALE_Y);
        const parent = spriteset?._upperLayer || spriteset;
        parent?.addChild(this.sprite);
        return this.filter;
    },

    applyTo(sprite, spriteset) {
        if (!sprite) return;
        const filter = this.ensure(spriteset);
        if (!filter) return;
        const list = Array.isArray(sprite.filters) ? sprite.filters.slice() : [];
        if (!list.includes(filter)) {
            list.push(filter);
            sprite.filters = list;
        }
    },

    update() {
        if (!this.sprite) return;
        this.sprite.x += Elements.DISPLACE_SPEED_X;
        this.sprite.y += Elements.DISPLACE_SPEED_Y;
        const tex = this.sprite.texture?.baseTexture;
        const w = tex?.width || 0;
        const h = tex?.height || 0;
        if (w > 0) this.sprite.x = ((this.sprite.x % w) + w) % w; // keep offset bounded
        if (h > 0) this.sprite.y = ((this.sprite.y % h) + h) % h;
    },

    clear() {
        if (this.sprite?.parent) this.sprite.parent.removeChild(this.sprite);
        this.sprite = null;
        this.filter = null;
    }
};

// ============================================================================
// Player helpers
// ============================================================================
Elements._playerFootPixel = function() {
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

// Return alpha value (0-255) at bitmap pixel if available
Elements._alphaAtPixel = function(bmp, x, y) {
    try {
        if (!bmp || typeof bmp.isReady !== "function" || !bmp.isReady()) return 0;
        if (typeof bmp.getAlphaPixel === "function") return bmp.getAlphaPixel(x, y) || 0;
        if (bmp._context) {
            const data = bmp._context.getImageData(x, y, 1, 1).data;
            return data?.[3] || 0;
        }
    } catch (e) {
        // ignore
    }
    return 0;
};

// Build a simple linear gradient bitmap for masking (supports vertical/horizontal)
Elements._createGradientBitmap = function(width, height, stops, orientation = "vertical") {
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

// Compute tight opaque bounds of a bitmap (min/max where alpha > 0)
Elements._bitmapOpaqueBounds = function(bmp) {
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
        return {
            x: minX,
            y: minY,
            width: maxX - minX + 1,
            height: maxY - minY + 1
        };
    } catch {
        return null;
    }
};

// ============================================================================
// Data loading helpers
// ============================================================================
Elements.loadJson = async function() {
    try {
        const res = await fetch("data/ElementMaps.json");
        this.mapData = res.ok ? await res.json() : {};
    } catch {
        this.mapData = {};
    }
};

Elements._prepareMapElements = async function(mapId) {
    await Elements.loadJson();
    const list = Elements.mapData[mapId] || [];
    const elements = list.map((e, i) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        useGradient: !!e.useGradient,
        useFx: (e.useFx !== undefined ? !!e.useFx : true),
        fxMode: e.fxMode || "opaque",
        useFx2: (e.useFx2 !== undefined ? !!e.useFx2 : !!e.useFx), // fallback to fx1 if legacy data
        fxMode2: e.fxMode2 || e.fxMode || "opaque",
        _index: i,
        images: Elements.loadElementImages(e.id)
    }));
    await Elements.waitForBitmaps(elements);
    Elements._mapReady = { mapId, list, elements };
};

Elements.saveJson = function() {
    try {
        if (!Utils?.isNwjs?.() || typeof require !== "function") {
            console.warn("Elements: JSON save skipped (not NW.js environment).");
            return false;
        }
        const fs = require("fs");
        const path = require("path");
        const jsonPath = path.join(process.cwd(), "data/ElementMaps.json");
        fs.writeFileSync(jsonPath, JSON.stringify(this.mapData, null, 2));
        console.log("Elements: ElementMaps.json saved.");
        return true;
    } catch (e) {
        console.error("Elements: Failed to save ElementMaps.json", e);
        return false;
    }
};

Elements.loadElementImages = function(id) {
    // tileset:<folder>:<sx>:<sy>:<w>:<h>
    const meta = Elements._decodeTilesetId(id);
    if (meta) {
        return Elements._buildTilesetCrops(meta);
    }
    const base = Elements._resolveElementBase(id);
    return {
        col: ImageManager.loadBitmap(base, "1"), // collision bitmap
        bot: ImageManager.loadBitmap(base, "2"), // underlay
        botFx: ImageManager.loadBitmap(base, "3"), // extra underlay A (bottom)
        botFx2: ImageManager.loadBitmap(base, "4"), // extra underlay B (bottom)
        top: ImageManager.loadBitmap(base, "5"), // overlay
        fx:  ImageManager.loadBitmap(base, "6"), // extra overlay A (top)
        fx2: ImageManager.loadBitmap(base, "7")  // extra overlay B (top)
    };
};

// Resolve the base path for a given element id, handling singles/* and nested singles categories.
Elements._resolveElementBase = function(id) {
    if (!id) return `img/elements/${id}/`;

    // If caller already provided singles/ prefix, honor it directly.
    if (id.startsWith("singles/")) {
        return `img/elements/${id}/`;
    }

    const defaultBase = `img/elements/${id}/`;
    const singlesDirect = `img/elements/singles/${id}/`;

    try {
        if (Utils?.isNwjs?.() && typeof require === "function") {
            const fs = require("fs");
            const path = require("path");
            const cwd = process.cwd();
            const existsPng = rel => fs.existsSync(path.join(cwd, rel, "1.png"));

            // 1) direct match in singles (e.g., singles/CityElements/Lamp_Pole or singles/Lamp_Pole)
            if (existsPng(singlesDirect)) return singlesDirect;

            // 2) search nested categories under singles if id has no slash
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

            // 3) default location
            if (existsPng(defaultBase)) return defaultBase;
        }
    } catch (e) {
        // fall through to default base
    }

    return defaultBase;
};

Elements._decodeTilesetId = function(id) {
    if (typeof id !== "string" || !id.startsWith("tileset:")) return null;
    const parts = id.split(":");
    if (parts.length !== 6) return null;
    const [, encFolder, sx, sy, sw, sh] = parts;
    const folder = decodeURIComponent(encFolder);
    const x = Number(sx), y = Number(sy), w = Number(sw), h = Number(sh);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
    return { folder, x, y, w, h };
};

Elements._buildTilesetCrops = function(meta) {
    const { folder, x, y, w, h } = meta;
    const basePath = `img/elements/tilesets/${folder}/`;
    const src = {
        col: ImageManager.loadBitmap(basePath, "1"),
        bot: ImageManager.loadBitmap(basePath, "2"),
        botFx: ImageManager.loadBitmap(basePath, "3"),
        botFx2: ImageManager.loadBitmap(basePath, "4"),
        top: ImageManager.loadBitmap(basePath, "5"),
        fx:  ImageManager.loadBitmap(basePath, "6"),
        fx2: ImageManager.loadBitmap(basePath, "7")
    };
    // When the base bitmaps are ready, blit the desired region into fresh bitmaps
    const crop = key => {
        const bmp = new Bitmap(w, h);
        const srcBmp = src[key];
        // ensure drawImage receives a canvas even before the source is ready
        bmp._image = bmp._canvas;
        bmp._elementsPendingBlit = true;
        if (srcBmp && srcBmp.isReady()) {
            bmp.blt(srcBmp, x, y, w, h, 0, 0);
            bmp._setDirty?.();
            bmp._elementsPendingBlit = false;
        } else {
            // If not ready yet, redraw when ready
            const redraw = () => {
                if (!srcBmp || !srcBmp.isReady()) return setTimeout(redraw, 16);
                bmp.blt(srcBmp, x, y, w, h, 0, 0);
                bmp._image = bmp._canvas;
                bmp._setDirty?.();
                bmp._elementsPendingBlit = false;
            };
            redraw();
        }
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
};

// Wait until all collision bitmaps are ready
Elements.waitForBitmaps = function(elements) {
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
        ["col","bot","top","fx","fx2","botFx","botFx2"].forEach(key => {
            const bmp = el.images[key];
            if (bmp) promises.push(wait(bmp));
        });
    });
    return Promise.all(promises);
};

// ============================================================================
// Collision core (build/scan/check) + DotMove hook
// ============================================================================
Elements.Collision = {
    canvas: null,
    ctx: null,
    pixels: null,
    width: 0,
    height: 0,
    blockers: [],
    blockerSet: new Set(),
    losBlockerSet: new Set(),

    // Build collision canvas from element collision bitmaps
    build(elements) {
        const tw = $gameMap.tileWidth();
        const th = $gameMap.tileHeight();
        this.width  = $gameMap.width()  * tw;
        this.height = $gameMap.height() * th;

        this.canvas = document.createElement("canvas");
        this.canvas.width  = this.width;
        this.canvas.height = this.height;
        this.ctx = this.canvas.getContext("2d");
        this.ctx.clearRect(0, 0, this.width, this.height);

        for (const el of elements) {
            const bmp = el.images.col;
            if (!bmp || !bmp.isReady()) continue;
            const x = Math.round(el.x - bmp.width / 2);
            const y = Math.round(el.y - bmp.height);
            this.ctx.drawImage(bmp._image, x, y);
        }

        const img = this.ctx.getImageData(0, 0, this.width, this.height);
        this.pixels = img.data;
        this._scanPixels();
    },

    // Scan RED/ORANGE pixels into sets (CollisionMapEx style)
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
                const r = img[i], g = img[i+1], b = img[i+2], a = img[i+3];
                if (a === 0) continue;

                // RED = collision + LOS
                if (r === 255 && g === 0 && b === 0) {
                    this.blockers.push({ x, y });
                    this.blockerSet.add(`${x},${y}`);
                    this.losBlockerSet.add(`${x},${y}`);
                }
                // ORANGE = collision only
                else if (r === 255 && g === 165 && b === 0) {
                    this.blockers.push({ x, y });
                    this.blockerSet.add(`${x},${y}`);
                }
            }
        }

        console.log(
            `Elements Collision: ${this.blockerSet.size} collision pixels, ` +
            `${this.losBlockerSet.size} LOS pixels`
        );
    },

    // Border-sampling rectangle check (pixel space)
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
    }
};

// Inject collision into DotMoveSystem
Elements.Collision.hookDotMoveSystem = function() {
    const DMS = window.DotMoveSystem;
    if (!DMS || !DMS.CharacterCollisionChecker) {
        console.warn("Elements Collision: DotMoveSystem not found");
        return;
    }
    const proto = DMS.CharacterCollisionChecker.prototype;
    if (proto.__elements_collision_hook__) return;
    proto.__elements_collision_hook__ = true;

    const _check = proto.checkCollisionMasses;
    proto.checkCollisionMasses = function(x, y, d, option) {
        const result = _check.call(this, x, y, d, option);
        const base = Array.isArray(result) ? result.slice() : [];

        if (!Elements.Collision.blockerSet.size) return base;

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

        // Safety: already overlapping
        if (Elements.Collision.rectOverlapsSolid(currPx, currPy, currPw, currPh)) {
            return base.length ? base : [];
        }

        // Next position hits collision
        if (Elements.Collision.rectOverlapsSolid(nextPx, nextPy, nextPw, nextPh)) {
            const hitX = nextPx + nextPw / 2;
            const hitY = nextPy + nextPh / 2;
            if (Number.isFinite(hitX) && Number.isFinite(hitY)) {
                const blockRect = new DMS.DotMoveRectangle(
                    hitX / tw, hitY / th, 1 / tw, 1 / th
                );
                base.push(new DMS.CollisionResult(rect, blockRect, char));
            }
            return base;
        }

        return base;
    };
};

// ============================================================================
// Debug helpers (overlay bitmap + collider outlines)
// ============================================================================
Elements.Collision.buildDebugBitmap = function() {
    if (!this.pixels || !Elements.DEBUG) return null;

    const bmp = new Bitmap(this.width, this.height);
    const out = bmp._context.getImageData(0, 0, this.width, this.height);
    const inp = this.pixels;
    let any = false;

    for (let i = 0; i < inp.length; i += 4) {
        const r = inp[i], g = inp[i+1], b = inp[i+2], a = inp[i+3];
        if (a === 0) continue;

        // RED = collision + LOS
        if (r === 255 && g === 0 && b === 0) {
            out.data[i]   = 255;
            out.data[i+1] = 0;
            out.data[i+2] = 0;
            out.data[i+3] = 192; // 25% opacity
            any = true;
        }
        // ORANGE = collision-only
        else if (r === 255 && g === 165 && b === 0) {
            out.data[i]   = 255;
            out.data[i+1] = 165;
            out.data[i+2] = 0;
            out.data[i+3] = 192; // 25% opacity
            any = true;
        }
    }

    if (!any) return null;
    bmp._context.putImageData(out, 0, 0);

    // Draw bright red outline around the actual collision pixels (non-transparent)
    {
        const ctx = bmp._context;
        const w = this.width;
        const h = this.height;
        const data = out.data;
        const idx = (x, y) => (y * w + x) * 4 + 3; // alpha index
        const isSolid = (x, y) =>
            x >= 0 && y >= 0 && x < w && y < h && data[idx(x, y)] !== 0;

        ctx.save();
        ctx.fillStyle = "rgba(255,255,0,1)"; // bright yellow outline

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (!isSolid(x, y)) continue;
                // Border if any 4-neighbor is empty
                if (!isSolid(x - 1, y) || !isSolid(x + 1, y) || !isSolid(x, y - 1) || !isSolid(x, y + 1)) {
                    ctx.fillRect(x, y, 2, 2); // 2px thick outline
                }
            }
        }
        ctx.restore();
    }

    bmp._setDirty?.();
    return bmp;
};

// Draw collider rectangles each frame (PIXI.Graphics)
Elements.updateColliderLayer = function() {
    if (!Elements.colliderLayer) return;
    const g = Elements.colliderLayer;
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
};

// Update collision overlay position immediately
Elements._updateOverlayPosition = function() {
    if (!Elements.debugSprite) return;
    const tw = $gameMap.tileWidth();
    const th = $gameMap.tileHeight();
    Elements.debugSprite.x = -$gameMap.displayX() * tw;
    Elements.debugSprite.y = -$gameMap.displayY() * th;
};

// Create and attach the debug overlay at the absolute top of the scene
Elements._attachDebugSprite = function(bitmap, spriteset) {
    if (!bitmap || !spriteset) return null;
    const sprite = new Sprite(bitmap);
    sprite.alpha = 0.25;      // force 25% opacity
    sprite.z = 999999;        // very high z to outdraw everything
    sprite.zIndex = 999999;
    spriteset.addChild(sprite);
    Elements.debugSprite = sprite;
    Elements._updateOverlayPosition();
    return sprite;
};

// ============================================================================
// Renderer for element sprites (2.png under, 5.png over, 6/7.png extra over)
// ============================================================================
Elements.Renderer = {
    sprites: [],

    create(elements, spriteset) {
        const tilemap = spriteset._tilemap;
        const tileH   = $gameMap.tileHeight();
        const tileW   = $gameMap.tileWidth();

        // Ensure upper layer exists
        if (!spriteset._upperLayer) {
            spriteset._upperLayer = new Sprite();
            spriteset._upperLayer.z = 10000;
            spriteset.addChild(spriteset._upperLayer);
        }

        for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
            const el = elements[elementIndex];
            const botBmp = el.images.bot;
            const topBmp = el.images.top;
            const fxBmp  = el.images.fx;  // optional FX layer A (6.png)
            const fx2Bmp = el.images.fx2; // optional FX layer B (7.png)
            if (!botBmp || !topBmp) continue;

            const useGradient = !!el.useGradient;
            const useFxLayer = (el.useFx !== undefined) ? !!el.useFx : !!fxBmp;
            const useFxLayer2 = (el.useFx2 !== undefined) ? !!el.useFx2 : !!fx2Bmp;
            // In gradient mode, prefer top bitmap so 6.png is not required
            const gradientBmp = useGradient ? topBmp : null;
            if (useGradient && !gradientBmp) continue;

            const bot = new Sprite(botBmp);
            bot._elementsLayer = "tilemap";
            const top = useGradient ? null : new Sprite(topBmp);
            if (top) top._elementsLayer = "upper";
            const fxPlain  = useGradient ? new Sprite(gradientBmp) : null; // unmasked base
            const fxMasked = useGradient ? new Sprite(gradientBmp) : null; // masked overlay
            if (fxPlain) fxPlain._elementsLayer = "upper";
            if (fxMasked) fxMasked._elementsLayer = "upper";

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
                fxBounds = Elements._bitmapOpaqueBounds(gradientBmp);
                const maskH = fxBounds?.height || gradientBmp.height;
                const maskW = gradientBmp.width;
                fxMaskBmp = Elements._createGradientBitmap(maskW, maskH, gradientStops, "vertical");
                fxMask = new Sprite(fxMaskBmp);
                fxMask._elementsLayer = "upper";
                fxMask.visible = false;
                spriteset._upperLayer.addChild(fxMask);
                this.sprites.push(fxMask);
            };
            const applyFxMode = (sprite, mode) => {
                if (!sprite) return;
                if (mode === "displace") {
                    Elements.DisplacementFX.applyTo(sprite, spriteset);
                }
                if (mode === "multiply") sprite.blendMode = PIXI.BLEND_MODES.MULTIPLY;
                else if (mode === "add") sprite.blendMode = PIXI.BLEND_MODES.ADD;
                else if (mode === "screen") sprite.blendMode = PIXI.BLEND_MODES.SCREEN;
                else sprite.blendMode = PIXI.BLEND_MODES.NORMAL;
            };
            fxSolo.forEach(layer => applyFxMode(layer.sprite, layer.mode));
            fxGradient.forEach(layer => {
                applyFxMode(layer.plain, layer.mode);
                applyFxMode(layer.masked, layer.mode);
            });

            // Bottom sprite (2.png) - below party
            bot.update = function() {
                const ox = $gameMap.displayX() * tileW;
                const oy = $gameMap.displayY() * tileH;

                this.x = el.x - this.width / 2 - ox;
                this.y = el.y - botH - oy;
                this.z = 1;
            };

            // Top sprite (5.png) — always above party (disabled when gradient is used)
            if (top) {
                top.update = function() {
                    const ox = $gameMap.displayX() * tileW;
                    const oy = $gameMap.displayY() * tileH;

                    this.x = el.x - this.width / 2 - ox;
                    this.y = el.y - topH - oy + 0.5; // +0.5 fix added 
                };
            }

            // Extra overlay sprite (6.png) - highest visible layer with progressive fade-out of opaque layer
            if (useGradient && fxPlain && fxMasked) {
                let fadeTimer = 0;
                const fadeFrames = 60; // frames to fully transition
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
                    fxGradient.forEach(layer => {
                        const lx = el.x - layer.bmp.width / 2 - ox;
                        const ly = el.y - layer.bmp.height - oy + 0.5;
                        layer.plain.x = lx;
                        layer.plain.y = ly;
                        layer.masked.x = lx;
                        layer.masked.y = ly;
                    });

                    // Fade only when the player's feet overlap non-transparent pixels of the fx layer
                    const foot = Elements._playerFootPixel();
                    let inside = false;
                    if (foot && gradientBmp.isReady?.()) {
                        const left = el.x - gradientBmp.width / 2;
                        const topPos = el.y - fxH;
                        const px = Math.floor(foot.x - left);
                        const py = Math.floor(foot.y - topPos);
                        if (px >= 0 && py >= 0 && px < gradientBmp.width && py < gradientBmp.height) {
                            inside = Elements._alphaAtPixel(gradientBmp, px, py) > 0;
                        }
                    }

                    // Fade only the opaque base; show gradient instantly when inside
                    if (inside) fadeTimer = Math.min(fadeFrames, fadeTimer + 1);
                    else fadeTimer = Math.max(0, fadeTimer - 1);
                    const t = fadeFrames > 0 ? fadeTimer / fadeFrames : 1;

                    // Opaque base goes from 1 -> 0 over fadeFrames when inside, back to 1 when leaving
                    fxPlain.alpha = 1 - t;
                    // Keep gradient visible during both fade-out and fade-in; hide only when fully restored
                    fxMasked.alpha = t > 0 ? 1 : 0;
                    fxGradient.forEach(layer => {
                        layer.plain.alpha = 1 - t;
                        layer.masked.alpha = t > 0 ? 1 : 0;
                    });

                    if (fxMask) {
                        const yOffset = fxBounds ? fxBounds.y : 0;
                        fxMask.x = x;
                        fxMask.y = y + yOffset; // align to opaque region within fx sprite
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

            // Optional additional FX layer (6/7.png) with normal render stack
            fxSolo.forEach(layer => {
                const h = layer.bmp.height;
                layer.sprite.update = function() {
                    const ox = $gameMap.displayX() * tileW;
                    const oy = $gameMap.displayY() * tileH;
                    this.x = el.x - this.width / 2 - ox;
                    this.y = el.y - h - oy + 0.5;
                };
            });

            // Selection outline (separate renderer, not tied to collider overlay)
            sel.update = function() {
                const isSelected = elementIndex === Elements.selectedIndex;
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

            tilemap.addChild(bot);
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
        // Update selection outlines immediately (e.g., when editor window has focus)
        this.sprites.forEach(sp => {
            if (sp && typeof sp.update === "function") sp.update();
        });
    },

    // Force element sprites to update immediately (even when the game window is unfocused)
    refreshNow() {
        this.sprites.forEach(sp => {
            if (sp && typeof sp.update === "function") sp.update();
        });
        const tilemap = SceneManager._scene?._spriteset?._tilemap;
        if (tilemap?.children?.length) {
            tilemap.children.sort((a, b) => (a.z || 0) - (b.z || 0));
        }
    }
};

// ============================================================================
// Scene_Map hooks (start/terminate) and Spriteset_Map update
// ============================================================================
const _Elements_Scene_Map_isReady = Scene_Map.prototype.isReady;
Scene_Map.prototype.isReady = function() {
    if (!_Elements_Scene_Map_isReady.call(this)) return false;
    const mapId = String($gameMap.mapId());
    if (!this._elementsPreloadStarted || Elements._mapReady?.mapId !== mapId) {
        this._elementsPreloadStarted = true;
        Elements._mapReadyPromise = Elements._prepareMapElements(mapId);
        if (Elements._mapReadyPromise?.finally) {
            Elements._mapReadyPromise.finally(() => {
                if (Elements._mapReady?.mapId === mapId) Elements._mapReadyPromise = null;
            });
        }
    }
    if (Elements._mapReadyPromise) return false;
    return true;
};

const _Elements_Scene_Map_start = Scene_Map.prototype.start;
Scene_Map.prototype.start = async function() {
    _Elements_Scene_Map_start.call(this);

    // If returning from menu with cached sprites for this map, reattach immediately
    const mapId = String($gameMap.mapId());
    const cache = Elements._menuCache[mapId];

    // Clean previous overlays/layers when re-entering Scene_Map
    if (!cache) Elements._removeDebugLayers();

    // Ensure DotMoveSystem hook is installed even on maps with no elements yet
    Elements.Collision.hookDotMoveSystem();

    // Load data (reuse cached if already loaded) or use preloaded list
    const list = (Elements._mapReady?.mapId === mapId && Elements._mapReady.list) || Elements.mapData[mapId] || [];

    // Always initialize editor state for the current map (even if no elements exist yet)
    Elements.currentMapId = mapId;
    Elements.currentElements = [];
    if (!Array.isArray(Elements.mapData[mapId])) Elements.mapData[mapId] = [];

    if (!Array.isArray(list) || !list.length) return;

    const elements = (Elements._mapReady?.mapId === mapId && Elements._mapReady.elements) || list.map((e,i) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        useGradient: !!e.useGradient,
        useFx: (e.useFx !== undefined ? !!e.useFx : true),
        fxMode: e.fxMode || "opaque",
        useFx2: (e.useFx2 !== undefined ? !!e.useFx2 : !!e.useFx), // fallback to fx1 if legacy data
        fxMode2: e.fxMode2 || e.fxMode || "opaque",
        _index: i,
        images: Elements.loadElementImages(e.id)
    }));

    if (!(Elements._mapReady && Elements._mapReady.mapId === mapId && Elements._mapReady.elements)) {
        await Elements.waitForBitmaps(elements);
    }

    Elements.Collision.build(elements);

    // Store current elements + map early (used by overlays/debug)
    Elements.currentElements = elements;
    Elements.currentMapId = mapId;

    if (cache && Array.isArray(cache.sprites) && cache.sprites.length) {
        const upper = this._spriteset._upperLayer || this._spriteset;
        const tilemap = this._spriteset._tilemap || this._spriteset;
        if (cache.debugSprite && !cache.debugSprite.parent) {
            this._spriteset.addChild(cache.debugSprite);
            Elements.debugSprite = cache.debugSprite;
        }
        if (cache.colliderLayer && !cache.colliderLayer.parent) {
            tilemap.addChild(cache.colliderLayer);
            Elements.colliderLayer = cache.colliderLayer;
        }
        if (cache.displacementSprite && !cache.displacementSprite.parent) {
            upper.addChild(cache.displacementSprite);
            Elements.DisplacementFX.sprite = cache.displacementSprite;
        }
        cache.sprites.forEach(sp => {
            if (!sp) return;
            const layer = sp._elementsLayer;
            if (layer === "tilemap") {
                tilemap.addChild(sp);
            } else {
                upper.addChild(sp);
            }
        });
        Elements.Renderer.sprites = cache.sprites;
        delete Elements._menuCache[mapId];
    } else {
        // Collision overlay bitmap
        const debugBmp = Elements.Collision.buildDebugBitmap();
        if (Elements.DEBUG && debugBmp) {
            Elements._attachDebugSprite(debugBmp, this._spriteset);
        }

        // Collider outlines layer
        if (Elements.DEBUG_COLLIDERS) {
            if (!Elements.colliderLayer) {
                Elements.colliderLayer = new PIXI.Graphics();
                Elements.colliderLayer.zIndex = 999999;
                this._spriteset._tilemap.addChild(Elements.colliderLayer);
            }
            Elements.updateColliderLayer();
        }

        // Element rendering (2.png under, 5.png over)
        Elements.Renderer.create(elements, this._spriteset);
    }

    Elements.Collision.hookDotMoveSystem();
};

const _Elements_Spriteset_Map_update = Spriteset_Map.prototype.update;
Spriteset_Map.prototype.update = function() {
    _Elements_Spriteset_Map_update.call(this);

    Elements.DisplacementFX.update();

    const tw = $gameMap.tileWidth();
    const th = $gameMap.tileHeight();
    const ox = $gameMap.displayX() * tw;
    const oy = $gameMap.displayY() * th;

    // Scroll collision overlay with map
    if (Elements.debugSprite) {
        Elements.debugSprite.x = -ox;
        Elements.debugSprite.y = -oy;
    }

    // Redraw collider outlines each frame
    if (Elements.DEBUG_COLLIDERS) {
        Elements.updateColliderLayer();
    }

    // Keep tilemap children sorted by z (for rendered elements)
    const tilemap = this._tilemap;
    if (tilemap?.children) {
        tilemap.children.sort((a, b) => (a.z || 0) - (b.z || 0));
    }
};

const _Elements_Scene_Map_terminate = Scene_Map.prototype.terminate;
Scene_Map.prototype.terminate = function() {
    const isMenu = SceneManager._nextScene instanceof Scene_MenuBase;
    const mapId = String($gameMap?.mapId?.() || "");
    if (isMenu) {
        const cache = Elements._menuCache[mapId] = {};
        cache.sprites = Elements.Renderer?.sprites ? Elements.Renderer.sprites.slice() : [];
        cache.debugSprite = Elements.debugSprite;
        cache.colliderLayer = Elements.colliderLayer;
        cache.displacementSprite = Elements.DisplacementFX?.sprite || null;

        cache.sprites?.forEach(sp => { if (sp?.parent) sp.parent.removeChild(sp); });
        if (cache.debugSprite?.parent) cache.debugSprite.parent.removeChild(cache.debugSprite);
        if (cache.colliderLayer?.parent) cache.colliderLayer.parent.removeChild(cache.colliderLayer);
        if (cache.displacementSprite?.parent) cache.displacementSprite.parent.removeChild(cache.displacementSprite);
    } else {
        if (Elements.debugSprite?.parent) Elements.debugSprite.parent.removeChild(Elements.debugSprite);
        Elements.debugSprite = null;

        if (Elements.DEBUG_COLLIDERS) {
            if (Elements.colliderLayer?.parent) {
                Elements.colliderLayer.parent.removeChild(Elements.colliderLayer);
            }
            Elements.colliderLayer = null;
        }

        // Remove rendered element sprites
        if (Elements.Renderer && Elements.Renderer.sprites) {
            Elements.Renderer.sprites.forEach(sp => {
                if (sp?.parent) sp.parent.removeChild(sp);
            });
            Elements.Renderer.sprites = [];
        }
        Elements.DisplacementFX.clear();
    }

    _Elements_Scene_Map_terminate.call(this);
};

// Remove debug layers/sprites
Elements._removeDebugLayers = function({ overlay = true, colliders = true, sprites = true } = {}) {
    if (Elements.debugSprite?.parent) {
        Elements.debugSprite.parent.removeChild(Elements.debugSprite);
    }
    if (overlay) Elements.debugSprite = null;

    if (colliders) {
        if (Elements.colliderLayer?.parent) {
            Elements.colliderLayer.parent.removeChild(Elements.colliderLayer);
        }
        Elements.colliderLayer = null;
    }

    if (sprites && Elements.Renderer && Elements.Renderer.sprites) {
        Elements.Renderer.sprites.forEach(sp => {
            if (sp?.parent) sp.parent.removeChild(sp);
        });
        Elements.Renderer.sprites = [];
    }
    if (sprites) Elements.DisplacementFX.clear();
};

// Rebuild collision overlay/colliders after live edits
Elements.rebuildDebugLayers = function(scene) {
    if (!(scene instanceof Scene_Map)) return;
    if (!Elements.currentElements.length) return;

    // Rebuild collision
    Elements.Collision.build(Elements.currentElements);

    // Overlay
    Elements._removeDebugLayers({ overlay:true, colliders:false, sprites:false });
    if (Elements.DEBUG) {
        const debugBmp = Elements.Collision.buildDebugBitmap();
        if (debugBmp) {
            Elements._attachDebugSprite(debugBmp, scene._spriteset);
        }
    }

    // Collider outlines
    if (Elements.DEBUG_COLLIDERS) {
        if (!Elements.colliderLayer) {
            Elements.colliderLayer = new PIXI.Graphics();
            Elements.colliderLayer.zIndex = 999999;
            scene._spriteset._tilemap.addChild(Elements.colliderLayer);
        }
        Elements.colliderLayer.visible = true;
        Elements.updateColliderLayer();
    } else if (Elements.colliderLayer) {
        Elements.colliderLayer.clear();
        Elements.colliderLayer.visible = false;
    }
};

// ============================================================================
// Simple editor (debug toggles only) - Ctrl+Shift+E
// ============================================================================
Elements.Editor = {
    editorWindow: null,
    _addWindow: null,
    _tilesetWindow: null,
    _addPickHandler: null,
    _movePickHandler: null,
    _autoOpened: false,

    init() {
        document.addEventListener("keydown", e => {
            if (e.ctrlKey && e.shiftKey && e.code === "KeyE") {
                e.preventDefault();
                this.toggleEditor();
            }
        });
        if (Elements._params.autoOpen && Utils.isNwjs?.()) {
            setTimeout(() => {
                if (this._autoOpened) return;
                this._autoOpened = true;
                this.openPopup(true);
            }, 400);
        }
        window.addEventListener("message", evt => {
            const data = evt.data;
            if (!data) return;
            if (data.type === "elementsDebugToggle") {
                Elements.DEBUG = !!data.collisionOverlay;
                Elements.DEBUG_COLLIDERS = !!data.colliderOverlay;
                Elements.AUTO_SAVE_JSON = !!data.autoSaveJson;
                Elements._removeDebugLayers({ overlay:true, colliders:true, sprites:false });
                // Rebuild overlays if on map and collision is built
                const scene = SceneManager._scene;
                if (scene instanceof Scene_Map && Elements.Collision.pixels) {
                    // Collision overlay bitmap
                    const debugBmp = Elements.Collision.buildDebugBitmap();
                    if (Elements.DEBUG && debugBmp) {
                        Elements._attachDebugSprite(debugBmp, scene._spriteset);
                    }
                    // Collider outlines layer
                    if (Elements.DEBUG_COLLIDERS) {
                        if (!Elements.colliderLayer) {
                            Elements.colliderLayer = new PIXI.Graphics();
                            Elements.colliderLayer.zIndex = 999999;
                            scene._spriteset._tilemap.addChild(Elements.colliderLayer);
                        }
                        Elements.colliderLayer.visible = true;
                        Elements.updateColliderLayer();
                    } else if (Elements.colliderLayer) {
                        Elements.colliderLayer.clear();
                        Elements.colliderLayer.visible = false;
                    }
                }
            if (Elements.AUTO_SAVE_JSON) Elements.saveJson();
            this.sendState();
        } else if (data.type === "elementsSelect") {
            Elements.selectedIndex = (data.index == null ? null : data.index);
            if (Elements.colliderLayer) Elements.updateColliderLayer();
            Elements.Renderer.refreshSelection?.();
            this.sendState();
        } else if (data.type === "elementsMove") {
            Elements.Editor._applyDelta(data.dx || 0, data.dy || 0);
            } else if (data.type === "elementsSet") {
                Elements.Editor._applySet(data.x, data.y);
            } else if (data.type === "elementsSaveJson") {
                Elements.saveJson();
            } else if (data.type === "elementsDelete") {
                Elements.Editor._deleteSelected();
            } else if (data.type === "elementsAddPopup") {
                Elements.Editor._openAddPopup();
        } else if (data.type === "elementsAddTilesetPopup") {
            Elements.Editor._openAddTilesetPopup();
        } else if (data.type === "elementsAddTilesetCreate") {
            Elements.Editor._createElementFromTileset(data.folder, data.selection, data.x, data.y, data.useGradient, data.useFx, data.fxMode, data.useFx2, data.fxMode2);
        } else if (data.type === "elementsAddChosen") {
            Elements.Editor._addElement(data.id, data.x, data.y, data.useGradient, data.useFx, data.fxMode, data.useFx2, data.fxMode2);
        } else if (data.type === "elementsTilesetPreviewStart") {
            Elements.Editor._startTilesetPreview(
                data.folder,
                data.selection,
                data.useGradient,
                data.useFx,
                data.fxMode,
                data.roundTo10,
                data.snapTo48,
                data.useFx2,
                data.fxMode2
            );
        } else if (data.type === "elementsSinglePreviewStart") {
            Elements.Editor._startSinglePreview(
                data.id,
                data.useGradient,
                data.useFx,
                data.fxMode,
                data.roundTo10,
                data.snapTo48,
                data.useFx2,
                data.fxMode2
            );
        } else if (data.type === "elementsPickPositionStart") {
            Elements.Editor._startPickPosition();
        }
    });
},

    _applyDelta(dx, dy) {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map)) return;
        const el = Elements.currentElements?.[Elements.selectedIndex];
        if (!el) return;
        el.x += dx;
        el.y += dy;
        // also update source data so editor columns stay in sync
        const mapList = Elements.mapData[Elements.currentMapId];
        if (mapList && mapList[Elements.selectedIndex]) {
            mapList[Elements.selectedIndex].x = el.x;
            mapList[Elements.selectedIndex].y = el.y;
        }
        Elements.rebuildDebugLayers(scene);
        Elements.Renderer.refreshNow();
        this.sendState();
    },

    _applySet(x, y) {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map)) return;
        const el = Elements.currentElements?.[Elements.selectedIndex];
        if (!el) return;
        if (typeof x === "number" && !Number.isNaN(x)) el.x = x;
        if (typeof y === "number" && !Number.isNaN(y)) el.y = y;
        const mapList = Elements.mapData[Elements.currentMapId];
        if (mapList && mapList[Elements.selectedIndex]) {
            if (typeof x === "number" && !Number.isNaN(x)) mapList[Elements.selectedIndex].x = x;
            if (typeof y === "number" && !Number.isNaN(y)) mapList[Elements.selectedIndex].y = y;
        }
        Elements.rebuildDebugLayers(scene);
        Elements.Renderer.refreshNow();
        this.sendState();
    },

    _deleteSelected() {
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map) || !scene._spriteset) return;
        const spriteset = scene._spriteset;
        const idx = Elements.selectedIndex;
        if (idx == null || idx < 0) return;
        const list = Elements.currentElements;
        if (!Array.isArray(list) || !list[idx]) return;

        // remove from runtime and source data
        list.splice(idx, 1);
        const mapList = Elements.mapData[Elements.currentMapId];
        if (Array.isArray(mapList) && mapList[idx]) {
            mapList.splice(idx, 1);
        }
        Elements.selectedIndex = -1;

        // rebuild collision / overlays
        Elements.Collision.build(list);
        Elements._removeDebugLayers({ overlay:true, colliders:true, sprites:true });

        if (Elements.DEBUG) {
            const debugBmp = Elements.Collision.buildDebugBitmap();
            if (debugBmp) Elements._attachDebugSprite(debugBmp, spriteset);
        }
        if (Elements.DEBUG_COLLIDERS) {
            if (!Elements.colliderLayer) {
                Elements.colliderLayer = new PIXI.Graphics();
                Elements.colliderLayer.zIndex = 999999;
                spriteset._tilemap.addChild(Elements.colliderLayer);
            }
            Elements.updateColliderLayer();
        }

        // recreate element sprites
        Elements.Renderer.create(list, spriteset);
        Elements.Renderer.refreshNow();
        Elements.Renderer.refreshSelection?.();

        if (Elements.AUTO_SAVE_JSON) Elements.saveJson();
        this.sendState();
    },

    async _addElement(id, x = 0, y = 0, useGradient = false, useFx = false, fxMode = "opaque", useFx2 = false, fxMode2 = "opaque") {
        if (!id) return;
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map) || !scene._spriteset) return;
        const spriteset = scene._spriteset;

        // Ensure editor state exists even if the map started with no elements
        if (!Elements.currentMapId) Elements.currentMapId = String($gameMap.mapId());
        if (!Array.isArray(Elements.currentElements)) Elements.currentElements = [];

        const newX = Number(x);
        const newY = Number(y);
        const finalX = Number.isFinite(newX) ? newX : 0;
        const finalY = Number.isFinite(newY) ? newY : 0;

        const mapList = Elements.mapData[Elements.currentMapId];
        if (!Array.isArray(mapList)) Elements.mapData[Elements.currentMapId] = [];

        const newEntry = {
            id,
            x: finalX,
            y: finalY,
            useGradient: !!useGradient,
            useFx: !!useFx,
            fxMode: fxMode || "opaque",
            useFx2: !!useFx2,
            fxMode2: fxMode2 || "opaque"
        };
        Elements.mapData[Elements.currentMapId].push(newEntry);

        const el = {
            id,
            x: finalX,
            y: finalY,
            useGradient: !!useGradient,
            useFx: !!useFx,
            fxMode: fxMode || "opaque",
            useFx2: !!useFx2,
            fxMode2: fxMode2 || "opaque",
            _index: Elements.currentElements.length,
            images: Elements.loadElementImages(id)
        };
        Elements.currentElements.push(el);

        await Elements.waitForBitmaps([el]);

        Elements.Collision.build(Elements.currentElements);
        Elements._removeDebugLayers({ overlay:true, colliders:true, sprites:true });

        if (Elements.DEBUG) {
            const debugBmp = Elements.Collision.buildDebugBitmap();
            if (debugBmp) Elements._attachDebugSprite(debugBmp, spriteset);
        }
        if (Elements.DEBUG_COLLIDERS) {
            if (!Elements.colliderLayer) {
                Elements.colliderLayer = new PIXI.Graphics();
                Elements.colliderLayer.zIndex = 999999;
                spriteset._tilemap.addChild(Elements.colliderLayer);
            }
            Elements.updateColliderLayer();
        }

        Elements.Renderer.create(Elements.currentElements, spriteset);
        Elements.Renderer.refreshNow();

        Elements.selectedIndex = Elements.currentElements.length - 1;
        if (Elements.colliderLayer) Elements.updateColliderLayer();
        Elements.Renderer.refreshSelection?.();

        if (Elements.AUTO_SAVE_JSON) Elements.saveJson();
        this.sendState();
    },

// message handler already exists; ensure it routes elementsAddTilesetCreate to _createElementFromTileset

    _createElementFromTileset(folder, selection, x = 0, y = 0, useGradient = false, useFx = false, fxMode = "opaque", useFx2 = false, fxMode2 = "opaque") {
      if (!folder || !selection || selection.w <= 0 || selection.h <= 0) return;
      const grid = 48;
      const snap = v => Math.max(0, Math.floor(v / grid) * grid);
      const sx = snap(selection.x);
  const sy = snap(selection.y);
  const sw = Math.max(grid, Math.floor(selection.w / grid) * grid);
      const sh = Math.max(grid, Math.floor(selection.h / grid) * grid);
      const encFolder = encodeURIComponent(folder);
      const id = `tileset:${encFolder}:${sx}:${sy}:${sw}:${sh}`;
      this._addElement(id, x, y, useGradient, useFx, fxMode, useFx2, fxMode2); // _addElement will call Elements.loadElementImages(id)
    },

    async _startTilesetPreview(folder, selection, useGradient = false, useFx = false, fxMode = "opaque", roundTo10 = false, snapTo48 = false, useFx2 = false, fxMode2 = "opaque") {
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

        const images = Elements.loadElementImages(id);
        await Elements.waitForBitmaps([{ images }]);
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
            sprites: [],
            mask: null,
            maskBmp: null,
            botBmp,
            topBmp,
            fxBmp: images.fx,
            fx2Bmp: images.fx2,
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

            const bounds = Elements._bitmapOpaqueBounds(topBmp);
            const maskH = bounds?.height || topBmp.height;
            const maskW = topBmp.width;
            preview.maskBmp = Elements._createGradientBitmap(
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
            if (preview.fxMode === "multiply") fxSp.blendMode = PIXI.BLEND_MODES.MULTIPLY;
            else if (preview.fxMode === "add") fxSp.blendMode = PIXI.BLEND_MODES.ADD;
            else if (preview.fxMode === "screen") fxSp.blendMode = PIXI.BLEND_MODES.SCREEN;
            else fxSp.blendMode = PIXI.BLEND_MODES.NORMAL;
            spriteset._upperLayer.addChild(fxSp);
            if (preview.fxMode === "displace") {
                Elements.DisplacementFX.applyTo(fxSp, spriteset);
            }
            preview.fxSp = fxSp;
            preview.sprites.push(fxSp);
        }
        if (preview.useFx2 && preview.fx2Bmp) {
            const fx2Sp = new Sprite(preview.fx2Bmp);
            fx2Sp.alpha = 0.7;
            if (preview.fxMode2 === "multiply") fx2Sp.blendMode = PIXI.BLEND_MODES.MULTIPLY;
            else if (preview.fxMode2 === "add") fx2Sp.blendMode = PIXI.BLEND_MODES.ADD;
            else if (preview.fxMode2 === "screen") fx2Sp.blendMode = PIXI.BLEND_MODES.SCREEN;
            else fx2Sp.blendMode = PIXI.BLEND_MODES.NORMAL;
            spriteset._upperLayer.addChild(fx2Sp);
            if (preview.fxMode2 === "displace") {
                Elements.DisplacementFX.applyTo(fx2Sp, spriteset);
            }
            preview.fx2Sp = fx2Sp;
            preview.sprites.push(fx2Sp);
        }
        if (preview.useFx2 && preview.fx2Bmp) {
            const fx2Sp = new Sprite(preview.fx2Bmp);
            fx2Sp.alpha = 0.7;
            if (preview.fxMode2 === "multiply") fx2Sp.blendMode = PIXI.BLEND_MODES.MULTIPLY;
            else if (preview.fxMode2 === "add") fx2Sp.blendMode = PIXI.BLEND_MODES.ADD;
            else if (preview.fxMode2 === "screen") fx2Sp.blendMode = PIXI.BLEND_MODES.SCREEN;
            else fx2Sp.blendMode = PIXI.BLEND_MODES.NORMAL;
            spriteset._upperLayer.addChild(fx2Sp);
            if (preview.fxMode2 === "displace") {
                Elements.DisplacementFX.applyTo(fx2Sp, spriteset);
            }
            preview.fx2Sp = fx2Sp;
            preview.sprites.push(fx2Sp);
        }

        this._previewState = preview;
        this._installPreviewHandlers();
        this._updatePreviewPosition();
    },

    async _startSinglePreview(id, useGradient = false, useFx = false, fxMode = "opaque", roundTo10 = false, snapTo48 = false, useFx2 = false, fxMode2 = "opaque") {
        if (!id) return;
        const scene = SceneManager._scene;
        if (!(scene instanceof Scene_Map) || !scene._spriteset) return;
        this._stopTilesetPreview();

        const images = Elements.loadElementImages(id);
        await Elements.waitForBitmaps([{ images }]);
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
            sprites: [],
            mask: null,
            maskBmp: null,
            botBmp,
            topBmp,
            fxBmp: images.fx,
            fx2Bmp: images.fx2,
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

            const bounds = Elements._bitmapOpaqueBounds(topBmp);
            const maskH = bounds?.height || topBmp.height;
            const maskW = topBmp.width;
            preview.maskBmp = Elements._createGradientBitmap(
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
            if (preview.fxMode === "multiply") fxSp.blendMode = PIXI.BLEND_MODES.MULTIPLY;
            else if (preview.fxMode === "add") fxSp.blendMode = PIXI.BLEND_MODES.ADD;
            else if (preview.fxMode === "screen") fxSp.blendMode = PIXI.BLEND_MODES.SCREEN;
            else fxSp.blendMode = PIXI.BLEND_MODES.NORMAL;
            spriteset._upperLayer.addChild(fxSp);
            if (preview.fxMode === "displace") {
                Elements.DisplacementFX.applyTo(fxSp, spriteset);
            }
            preview.fxSp = fxSp;
            preview.sprites.push(fxSp);
        }
        if (preview.useFx2 && preview.fx2Bmp) {
            const fx2Sp = new Sprite(preview.fx2Bmp);
            fx2Sp.alpha = 0.7;
            if (preview.fxMode2 === "multiply") fx2Sp.blendMode = PIXI.BLEND_MODES.MULTIPLY;
            else if (preview.fxMode2 === "add") fx2Sp.blendMode = PIXI.BLEND_MODES.ADD;
            else if (preview.fxMode2 === "screen") fx2Sp.blendMode = PIXI.BLEND_MODES.SCREEN;
            else fx2Sp.blendMode = PIXI.BLEND_MODES.NORMAL;
            spriteset._upperLayer.addChild(fx2Sp);
            if (preview.fxMode2 === "displace") {
                Elements.DisplacementFX.applyTo(fx2Sp, spriteset);
            }
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
            if (e.button !== 0) return; // left click to place
            const scene = SceneManager._scene;
            if (!(scene instanceof Scene_Map) || !this._previewState) return;
            // place at the exact cursor world position (no grid snap)
            let worldX = Math.round(this._previewState.worldX);
            let worldY = Math.round(this._previewState.worldY);
            if (this._previewState.snapTo48) {
                worldX = Math.round(worldX / 48) * 48;
                worldY = Math.round(worldY / 48) * 48;
            } else if (this._previewState.roundTo10) {
                worldX = Math.round(worldX / 10) * 10;
                worldY = Math.round(worldY / 10) * 10;
            }
            const data = this._previewState;
            // Reuse creation helper
            const parts = data.id.split(":");
            if (parts.length === 6 && parts[0] === "tileset") {
                const folder = decodeURIComponent(parts[1]);
                const selection = {
                    x: Number(parts[2]),
                    y: Number(parts[3]),
                    w: Number(parts[4]),
                    h: Number(parts[5])
                };
                this._createElementFromTileset(folder, selection, worldX, worldY, data.useGradient, data.useFx, data.fxMode, data.useFx2, data.fxMode2);
            } else {
                this._addElement(data.id, worldX, worldY, data.useGradient, data.useFx, data.fxMode, data.useFx2, data.fxMode2);
            }
            // keep preview alive for rapid re-placement; right-click cancels
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
                // ignore cross-window errors
            }
        }
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
        const refW = Math.max(topBmp?.width || 0, botBmp?.width || 0, fxBmp?.width || 0, fx2Bmp?.width || 0);
        const refH = Math.max(topBmp?.height || 0, botBmp?.height || 0, fxBmp?.height || 0, fx2Bmp?.height || 0);
        const baseW = refW || (topBmp?.width || botBmp?.width || fxBmp?.width || fx2Bmp?.width || 0);
        const baseH = refH || (topBmp?.height || botBmp?.height || fxBmp?.height || fx2Bmp?.height || 0);
        const sx = preview.worldX - baseW / 2 - ox;
        const sy = preview.worldY - baseH - oy + 0.5;
        const labelText = `x: ${Math.round(preview.worldX)}  y: ${Math.round(preview.worldY)}`;
        const outline = preview.outline;

        if (preview.botSp && botBmp) {
            preview.botSp.x = preview.worldX - botBmp.width / 2 - ox;
            preview.botSp.y = preview.worldY - botBmp.height - oy + 0.5;
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
            const bounds = Elements._bitmapOpaqueBounds(topBmp);
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
            outline.x = sx;
            outline.y = sy;
            outline.drawRect(0, 0, baseW, baseH);
            outline.endFill();
        }
    },

    _startPickPosition() {
        // Remove any stale handler first
        if (this._movePickHandler) {
            document.removeEventListener("mousedown", this._movePickHandler, true);
            this._movePickHandler = null;
        }

        this._movePickHandler = e => {
            if (e.button !== 0) return; // left click only
            const scene = SceneManager._scene;
            if (!(scene instanceof Scene_Map)) return;
            if (Elements.selectedIndex == null || Elements.selectedIndex < 0) return;

            const tw = $gameMap.tileWidth();
            const th = $gameMap.tileHeight();
            const cx = Graphics.pageToCanvasX(e.pageX);
            const cy = Graphics.pageToCanvasY(e.pageY);
            if (cx < 0 || cy < 0) return;

            const worldX = Math.round(cx + $gameMap.displayX() * tw);
            const worldY = Math.round(cy + $gameMap.displayY() * th);

            // Apply new position
            this._applySet(worldX, worldY);

            // Stop listening after first successful click
            document.removeEventListener("mousedown", this._movePickHandler, true);
            this._movePickHandler = null;
        };
        document.addEventListener("mousedown", this._movePickHandler, true);
    },

    _openAddPopup() {
        if (!Utils.isNwjs?.() || typeof nw === "undefined") {
            console.warn("Elements: Add element popup requires NW.js");
            return;
        }
        // Only allow one add popup at a time
        if (this._addWindow) {
            if (!this._addWindow.closed) {
                this._addWindow.focus();
                return;
            }
            this._addWindow = null;
        }
        const fs = require("fs");
        const path = require("path");
        const singlesBase = path.join(process.cwd(), "img", "elements", "singles");

  const popupW = 660, popupH = 660;
  // Default fallback
  let x, y;
  if (this.editorWindow && !this.editorWindow.closed) {
    const host = this.editorWindow;
    x = host.x + (host.width - popupW) / 2;
    y = host.y + (host.height - popupH) / 2;
  }

        const categories = [];
        let rootCategory = null;
        const elementsByCategory = {};
        try {
            const listElementDirs = dirPath =>
                fs.readdirSync(dirPath, { withFileTypes: true })
                    .filter(d => d.isDirectory())
                    .map(d => d.name)
                    .filter(name =>
                        ["1.png", "2.png", "5.png", "6.png"].every(file =>
                            fs.existsSync(path.join(dirPath, name, file))
                        )
                    )
                    .sort((a, b) => a.localeCompare(b));

            // Root-level singles (img/elements/singles/<id>/1.png)
            const rootElements = listElementDirs(singlesBase);
            if (rootElements.length) {
                elementsByCategory[""] = rootElements;
                rootCategory = { label: "(singles)", value: "" };
            }

            // Category folders (img/elements/singles/<category>/<id>/1.png)
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
            });

            // Put root at the end so the default is the first real category
            if (rootCategory) categories.push(rootCategory);
        } catch (e) {
            console.warn("Elements: Failed to read singles directory", e);
        }

        const html = this._addPopupHTML(categories, elementsByCategory);
        const url = "data:text/html," + encodeURIComponent(html);
            nw.Window.open(url, { width: popupW, height: popupH, x, y }, win => {
                this._addWindow = win;
                this._installAddPickListener();
                win.on("closed", () => { this._addWindow = null; 
                this._removeAddPickListener(); 
            });
        });
    },

    _openAddTilesetPopup() {
        if (!Utils.isNwjs?.() || typeof nw === "undefined") {
            console.warn("Elements: Add tileset popup requires NW.js");
            return;
        }
        if (this._tilesetWindow) {
            if (!this._tilesetWindow.closed) {
                this._tilesetWindow.focus();
                return;
            }
            this._tilesetWindow = null;
        }

        const popupW = 824, popupH = 1024;
        let x, y;
        if (this.editorWindow && !this.editorWindow.closed) {
            const host = this.editorWindow;
            x = host.x + (host.width - popupW) / 2;
            y = host.y + (host.height - popupH) / 2;
        }

        const fs = require("fs");
        const path = require("path");
        const tilesetBase = path.join(process.cwd(), "img", "elements", "tilesets");

        let tilesetFolders = [];
        const previewDataByFolder = {};
        try {
            console.log("Elements: scanning tilesets at", tilesetBase);
            const required = ["1.png", "2.png", "5.png", "6.png"];
            tilesetFolders = fs.readdirSync(tilesetBase, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name)
                .filter(name => {
                    const dir = path.join(tilesetBase, name);
                    const missing = required.filter(f => !fs.existsSync(path.join(dir, f)));
                    if (missing.length) {
                        console.warn(`Elements: tileset folder '${name}' missing files: ${missing.join(", ")}`);
                        return false;
                    }
                    return true;
                })
                .sort((a, b) => a.localeCompare(b));
            if (!tilesetFolders.length) {
                console.warn("Elements: No tileset folders found with required files (1.png,2.png,5.png,6.png) under", tilesetBase);
            }

            const toData = filePath => "data:image/png;base64," + fs.readFileSync(filePath).toString("base64");
            tilesetFolders.forEach(name => {
                try {
                    const dir = path.join(tilesetBase, name);
                    const fx2Path = path.join(dir, "7.png");
                    previewDataByFolder[name] = {
                        bot: toData(path.join(dir, "2.png")),
                        top: toData(path.join(dir, "5.png")),
                        fx:  toData(path.join(dir, "6.png")),
                        fx2: fs.existsSync(fx2Path) ? toData(fx2Path) : null
                    };
                } catch (readErr) {
                    console.warn("[Tileset popup] Failed to load previews for", name, readErr);
                }
            });
        } catch (e) {
            console.warn("Elements: Failed to read tileset directory", e);
        }

        const baseHref = "file:///" + process.cwd().replace(/\\/g, "/") + "/";
        const html = this._tilesetPopupHTML(tilesetFolders, baseHref, previewDataByFolder);
        const url = "data:text/html," + encodeURIComponent(html);

        nw.Window.open(url, { width: popupW, height: popupH, x, y }, win => {
            this._tilesetWindow = win;
            this._installAddPickListener();
            win.on("closed", () => { this._tilesetWindow = null; this._removeAddPickListener(); });
        });
    },

    _tilesetPopupHTML(folders = [], baseHref = "", previewDataByFolder = {}) {
        return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<base href="${baseHref}">
<title>Add Tileset Element</title>
<style>
:root {
    --bg: #222;
    --panel: #1f1f1f;
    --border: #444;
    --text: #eee;
}
body {
    margin: 0;
    padding: 16px;
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, sans-serif;
    user-select: none;
}
h3 { margin: 0 0 12px 0; letter-spacing: 0.2px; }
label { font-size: 14px; color: #ccc; }
select,
input[type="text"] {
    height: 34px;
    padding: 6px 10px;
    box-sizing: border-box;
    background: #2a2a2a;
    border: 1px solid var(--border);
    color: var(--text);
}
.field {
    display: flex;
    align-items: center;
    gap: 10px;
}
.field label { min-width: 120px; }
.checkbox-field {
    display: flex;
    align-items: center;
    gap: 10px;
}
.checkbox-field label { min-width: 150px; }
.checkbox-field input { width: 18px; height: 18px; }
.row-inline { display: flex; gap: 18px; flex-wrap: wrap; align-items: center; }
.cards-row {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    margin: 8px 0 10px 0;
}
.card {
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 18px 14px 14px 14px;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
    min-width: 320px;
    margin-top: 14px;
    margin-bottom: 8px;
}
.card-label {
    position: absolute;
    top: -12px;
    left: 14px;
    padding: 2px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    font-size: 12px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
}
.sel-info {
    color: #aaa;
    font-size: 12px;
    text-align: right;
    min-width: 180px;
    display: inline-block;
}
.preview-shell {
    width: 768px;
    margin: 6px auto 0 auto;
}
.preview {
    width: 768px;
    height: 576px;
    border: 1px solid var(--border);
    background: #111;
    position: relative;
}
.preview canvas { position:absolute; top:0; left:0; image-rendering: pixelated; }
</style>
</head>
<body>
  <h3>Add Tileset Element</h3>
  <div class="field" style="margin-bottom:10px;">
    <label for="folderSel" style="min-width:70px;">Folder</label>
    <select id="folderSel" style="flex:1; min-width:260px;"></select>
  </div>
  <div class="row-inline" style="margin-bottom:8px;">
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
    <div class="card">
      <div class="card-label">Bottom</div>
      <div class="checkbox-field">
        <label for="chkBottomUseFx">Use Additional FX Layer 1</label>
        <input id="chkBottomUseFx" type="checkbox">
      </div>
      <div class="field">
        <label for="bottomFxMode">FX Layer 1</label>
        <select id="bottomFxMode" style="width:220px;">
          <option value="opaque">Opaque</option>
          <option value="multiply">Multiply</option>
          <option value="add">Add</option>
          <option value="screen">Screen</option>
          <option value="displace">Displacement</option>
        </select>
      </div>
      <div class="checkbox-field">
        <label for="chkBottomUseFx2">Use Additional FX Layer 2</label>
        <input id="chkBottomUseFx2" type="checkbox">
      </div>
      <div class="field">
        <label for="bottomFxMode2">FX Layer 2</label>
        <select id="bottomFxMode2" style="width:220px;">
          <option value="opaque">Opaque</option>
          <option value="multiply">Multiply</option>
          <option value="add">Add</option>
          <option value="screen">Screen</option>
          <option value="displace">Displacement</option>
        </select>
      </div>
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
          <option value="opaque">Opaque</option>
          <option value="multiply">Multiply</option>
          <option value="add">Add</option>
          <option value="screen">Screen</option>
          <option value="displace">Displacement</option>
        </select>
      </div>
      <div class="checkbox-field">
        <label for="chkUseFx2">Use Additional FX Layer 2</label>
        <input id="chkUseFx2" type="checkbox">
      </div>
      <div class="field">
        <label for="fxMode2">FX Layer 2</label>
        <select id="fxMode2" style="width:220px;">
          <option value="opaque">Opaque</option>
          <option value="multiply">Multiply</option>
          <option value="add">Add</option>
          <option value="screen">Screen</option>
          <option value="displace">Displacement</option>
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
    const chkGradient = document.getElementById("chkGradient");
    const chkRound10 = document.getElementById("chkRound10");
    const chkSnap48 = document.getElementById("chkSnap48");
    const chkUseFx = document.getElementById("chkUseFx");
    const chkUseFx2 = document.getElementById("chkUseFx2");
    const fxModeSel = document.getElementById("fxMode");
    const fxMode2Sel = document.getElementById("fxMode2");
    const folderSel = document.getElementById("folderSel");
    let folders = ${JSON.stringify(folders)};
    const previewDataByFolder = ${JSON.stringify(previewDataByFolder)};
    console.log("[Tileset popup] folders available:", folders);
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
        folderSel.value = folders[0];
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

    function sendPreview() {
        if (!selection || !folderSel.value) return;
        window.opener.postMessage({
            type: "elementsTilesetPreviewStart",
            folder: folderSel.value,
            selection: { ...selection },
            useGradient: !!(chkGradient && chkGradient.checked),
            useFx: !!(chkUseFx && chkUseFx.checked),
            useFx2: !!(chkUseFx2 && chkUseFx2.checked),
            roundTo10: !!(chkRound10 && chkRound10.checked),
            snapTo48: !!(chkSnap48 && chkSnap48.checked),
            fxMode: (fxModeSel && fxModeSel.value) || "opaque",
            fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque"
        }, "*");
    }

    if (chkGradient) {
        chkGradient.onchange = () => {
            if (!selection) return;
            sendPreview();
        };
    }
    if (chkRound10) {
        chkRound10.onchange = () => {
            if (chkRound10.checked && chkSnap48) chkSnap48.checked = false; // only one snap mode at a time
            if (!selection) return;
            sendPreview();
        };
    }
    if (chkSnap48) {
        chkSnap48.onchange = () => {
            if (chkSnap48.checked && chkRound10) chkRound10.checked = false; // only one snap mode at a time
            if (!selection) return;
            sendPreview();
        };
    }
    if (chkUseFx) {
        chkUseFx.onchange = () => {
            // redraw tileset view to show/hide 6/7.png, keeping current selection
            if (folderSel && folderSel.value) loadPreview(folderSel.value, true);
            if (!selection) return;
            sendPreview();
        };
    }
    if (chkUseFx2) {
        chkUseFx2.onchange = () => {
            if (folderSel && folderSel.value) loadPreview(folderSel.value, true);
            if (!selection) return;
            sendPreview();
        };
    }
    if (fxModeSel) {
        fxModeSel.onchange = () => {
            if (folderSel && folderSel.value) loadPreview(folderSel.value, true);
            if (!selection) return;
            sendPreview();
        };
    }
    if (fxMode2Sel) {
        fxMode2Sel.onchange = () => {
            if (folderSel && folderSel.value) loadPreview(folderSel.value, true);
            if (!selection) return;
            sendPreview();
        };
    }

    window.addEventListener("message", e => {
        if (e.data && e.data.type === "elementsTilesetSelectionClear") {
            selection = null;
            updateSelectionInfo();
            drawOverlay();
        }
    });

    function drawLayered(botSrc, topSrc, fxSrc, fx2Src, keepSelection = false) {
        const prevSelection = keepSelection && selection ? { ...selection } : null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        octx.clearRect(0, 0, overlay.width, overlay.height);
        ctx.imageSmoothingEnabled = false;
        drawMeta = null;

        const botImg = new Image();
        botImg.onload = () => {
            const w = botImg.naturalWidth || botImg.width;
            const h = botImg.naturalHeight || botImg.height;
            const scale = Math.min(canvas.width / w, canvas.height / h, 1);
            const dw = w * scale;
            const dh = h * scale;
            const dx = (canvas.width - dw) / 2;
            const dy = (canvas.height - dh) / 2;
            ctx.drawImage(botImg, 0, 0, w, h, dx, dy, dw, dh);

            const topImg = new Image();
            topImg.onload = () => {
                ctx.drawImage(topImg, 0, 0, w, h, dx, dy, dw, dh);
                const renderFx = !!(chkUseFx && chkUseFx.checked);
                const renderFx2 = !!(chkUseFx2 && chkUseFx2.checked);
                const mode = (fxModeSel && fxModeSel.value) || "opaque";
                const mode2 = (fxMode2Sel && fxMode2Sel.value) || "opaque";

                const drawFxLayer = (src, modeVal, label) => new Promise(resolve => {
                    if (!src) return resolve();
                    const img = new Image();
                    img.onload = () => {
                        if (modeVal === "multiply") ctx.globalCompositeOperation = "multiply";
                        else if (modeVal === "add") ctx.globalCompositeOperation = "lighter";
                        else if (modeVal === "screen") ctx.globalCompositeOperation = "screen";
                        ctx.drawImage(img, 0, 0, w, h, dx, dy, dw, dh);
                        ctx.globalCompositeOperation = "source-over";
                        resolve();
                    };
                    img.onerror = e => {
                        console.warn("[Tileset popup] Extra layer failed", { src, label, error: e });
                        resolve();
                    };
                    img.src = src;
                });

                (async () => {
                    if (renderFx) {
                        await drawFxLayer(fxSrc, mode, "fx");
                    }
                    if (renderFx2) {
                        await drawFxLayer(fx2Src, mode2, "fx2");
                    }
                    drawMeta = { dx, dy, scale, srcW: w, srcH: h };
                    selection = prevSelection;
                    updateSelectionInfo();
                    drawOverlay();
                })();
            };
            topImg.onerror = e => {
                console.warn("[Tileset popup] Top layer failed", { topSrc, error: e });
                drawMeta = { dx, dy, scale, srcW: w, srcH: h };
                selection = prevSelection;
                updateSelectionInfo();
                drawOverlay();
            };
            topImg.src = topSrc;
        };
        botImg.onerror = e => {
            console.warn("[Tileset popup] Bottom layer failed", { botSrc, error: e });
            drawMeta = null;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            octx.clearRect(0, 0, overlay.width, overlay.height);
        };
        botImg.src = botSrc;
    }

    function loadPreview(name, keepSelection = false) {
        if (!name) {
            ctx.clearRect(0,0,canvas.width,canvas.height);
            octx.clearRect(0,0,overlay.width,overlay.height);
            drawMeta = null;
            return;
        }
        const entry = previewDataByFolder[name] || {};
        const botSrc = entry.bot || ("img/elements/tilesets/" + encodeURIComponent(name) + "/2.png");
        const topSrc = entry.top || ("img/elements/tilesets/" + encodeURIComponent(name) + "/5.png");
        const fxSrc  = entry.fx  || ("img/elements/tilesets/" + encodeURIComponent(name) + "/6.png");
        const fx2Src = entry.fx2 || ("img/elements/tilesets/" + encodeURIComponent(name) + "/7.png");
        drawLayered(botSrc, topSrc, fxSrc, fx2Src, keepSelection);
    }

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

    if (folders.length) loadPreview(folders[0]);
  </script>
</body>
</html>`;
    },

    _addPopupHTML(categories = [], elementsByCategory = {}) {
        return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Add Single Element</title>
<style>
:root {
    --bg: #222;
    --panel: #1f1f1f;
    --border: #444;
    --text: #eee;
}
body {
    margin: 0;
    padding: 16px;
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, sans-serif;
}
h3 {
    margin: 0 0 14px 0;
    letter-spacing: 0.2px;
}
.layout {
    display: flex;
    gap: 16px;
    align-items: flex-start;
}
.left {
    flex: 1;
    min-width: 320px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.right {
    flex: 1;
    min-width: 280px;
}
label {
    font-size: 14px;
    color: #ccc;
}
select,
input[type="text"] {
    height: 34px;
    padding: 6px 10px;
    box-sizing: border-box;
    background: #2a2a2a;
    border: 1px solid var(--border);
    color: var(--text);
}
.field {
    display: flex;
    align-items: center;
    gap: 10px;
}
.field label {
    width: 170px;
}
.checkbox-field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}
.checkbox-field label {
    flex: 1;
}
.checkbox-field input {
    width: 18px;
    height: 18px;
}
.card {
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 18px 14px 14px 14px;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 12px;
    margin-bottom: 12px;
}
.card:first-of-type { margin-top: 30px; }
.card + .card { margin-top: 10px; }
.card-label {
    position: absolute;
    top: -12px;
    left: 14px;
    padding: 2px 10px;
    background: var(--bg);
    border: 1px solid var(--border);
    font-size: 12px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
}
.list-shell {
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 10px;
}
.list {
    max-height: 530px;
    min-height: 530px;
    overflow-y: auto;
    background: #2d2d2d;
    border: 1px solid var(--border);
    padding: 6px;
}
.item {
    padding: 8px 10px;
    margin: 4px 0;
    background: #333;
    border: 1px solid var(--border);
    cursor: pointer;
}
.item:hover { background:#3a3a3a; }
.item.selected { background:#556; border-color:#88a; }
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
            <option value="opaque">Opaque</option>
            <option value="multiply">Multiply</option>
            <option value="add">Add</option>
            <option value="screen">Screen</option>
            <option value="displace">Displacement</option>
          </select>
        </div>
        <div class="checkbox-field">
          <label for="chkUseFx2">Use Additional FX Layer 2</label>
          <input id="chkUseFx2" type="checkbox">
        </div>
        <div class="field">
          <label for="fxMode2">FX Layer 2</label>
          <select id="fxMode2" style="width:220px;">
            <option value="opaque">Opaque</option>
            <option value="multiply">Multiply</option>
            <option value="add">Add</option>
            <option value="screen">Screen</option>
            <option value="displace">Displacement</option>
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
            <option value="opaque">Opaque</option>
            <option value="multiply">Multiply</option>
            <option value="add">Add</option>
            <option value="screen">Screen</option>
            <option value="displace">Displacement</option>
          </select>
        </div>
        <div class="checkbox-field">
          <label for="chkBottomUseFx2">Use Additional FX Layer 2</label>
          <input id="chkBottomUseFx2" type="checkbox">
        </div>
        <div class="field">
          <label for="bottomFxMode2">FX Layer 2</label>
          <select id="bottomFxMode2" style="width:220px;">
            <option value="opaque">Opaque</option>
            <option value="multiply">Multiply</option>
            <option value="add">Add</option>
            <option value="screen">Screen</option>
            <option value="displace">Displacement</option>
          </select>
        </div>
      </div>
    </div>

    <div class="right">
      <div class="list-shell">
        <div id="list" class="list"></div>
      </div>
    </div>
  </div>
  <script>
    const categories = ${JSON.stringify(categories)};
    const elementsByCategory = ${JSON.stringify(elementsByCategory)};
    const listDiv = document.getElementById("list");
    const folderSel = document.getElementById("folderSel");
    const chkGradient = document.getElementById("chkGradient");
    const chkRound10 = document.getElementById("chkRound10");
    const chkSnap48 = document.getElementById("chkSnap48");
    const chkUseFx = document.getElementById("chkUseFx");
    const chkUseFx2 = document.getElementById("chkUseFx2");
    const fxModeSel = document.getElementById("fxMode");
    const fxMode2Sel = document.getElementById("fxMode2");
    let currentId = null;

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
                window.opener.postMessage({
                    type:"elementsSinglePreviewStart",
                    id: currentId,
                    useGradient: !!(chkGradient && chkGradient.checked),
                    useFx: !!(chkUseFx && chkUseFx.checked),
                    useFx2: !!(chkUseFx2 && chkUseFx2.checked),
                    roundTo10: !!(chkRound10 && chkRound10.checked),
                    snapTo48: !!(chkSnap48 && chkSnap48.checked),
                    fxMode: (fxModeSel && fxModeSel.value) || "opaque",
                    fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque"
                }, "*");
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
    // Default to first non-root category if available
    const firstNonRoot = categories.find(c => c.value !== "")?.value;
    if (firstNonRoot != null) folderSel.value = firstNonRoot;
    const initial = folderSel.value;
    renderList(initial);
    folderSel.onchange = () => renderList(folderSel.value);
    if (chkGradient) {
        chkGradient.onchange = () => {
            if (!currentId) return;
            window.opener.postMessage({
                type:"elementsSinglePreviewStart",
                id: currentId,
                useGradient: !!chkGradient.checked,
                useFx: !!(chkUseFx && chkUseFx.checked),
                useFx2: !!(chkUseFx2 && chkUseFx2.checked),
                roundTo10: !!(chkRound10 && chkRound10.checked),
                snapTo48: !!(chkSnap48 && chkSnap48.checked),
                fxMode: (fxModeSel && fxModeSel.value) || "opaque",
                fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque"
            }, "*");
        };
    }
    if (chkRound10) {
        chkRound10.onchange = () => {
            if (chkRound10.checked && chkSnap48) chkSnap48.checked = false; // only one snap mode at a time
            if (!currentId) return;
            window.opener.postMessage({
                type:"elementsSinglePreviewStart",
                id: currentId,
                useGradient: !!(chkGradient && chkGradient.checked),
                useFx: !!(chkUseFx && chkUseFx.checked),
                useFx2: !!chkUseFx2.checked,
                roundTo10: !!chkRound10.checked,
                snapTo48: !!(chkSnap48 && chkSnap48.checked),
                fxMode: (fxModeSel && fxModeSel.value) || "opaque",
                fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque"
            }, "*");
        };
    }
    if (chkSnap48) {
        chkSnap48.onchange = () => {
            if (chkSnap48.checked && chkRound10) chkRound10.checked = false; // only one snap mode at a time
            if (!currentId) return;
            window.opener.postMessage({
                type:"elementsSinglePreviewStart",
                id: currentId,
                useGradient: !!(chkGradient && chkGradient.checked),
                useFx: !!(chkUseFx && chkUseFx.checked),
                useFx2: !!(chkUseFx2 && chkUseFx2.checked),
                roundTo10: !!(chkRound10 && chkRound10.checked),
                snapTo48: !!chkSnap48.checked,
                fxMode: (fxModeSel && fxModeSel.value) || "opaque",
                fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque"
            }, "*");
        };
    }
    if (chkUseFx) {
        chkUseFx.onchange = () => {
            if (!currentId) return;
            window.opener.postMessage({
                type:"elementsSinglePreviewStart",
                id: currentId,
                useGradient: !!(chkGradient && chkGradient.checked),
                useFx: !!chkUseFx.checked,
                useFx2: !!(chkUseFx2 && chkUseFx2.checked),
                roundTo10: !!(chkRound10 && chkRound10.checked),
                snapTo48: !!(chkSnap48 && chkSnap48.checked),
                fxMode: (fxModeSel && fxModeSel.value) || "opaque",
                fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque"
            }, "*");
        };
    }
    if (fxModeSel) {
        fxModeSel.onchange = () => {
            if (!currentId) return;
            window.opener.postMessage({
                type:"elementsSinglePreviewStart",
                id: currentId,
                useGradient: !!(chkGradient && chkGradient.checked),
                useFx: !!(chkUseFx && chkUseFx.checked),
                useFx2: !!(chkUseFx2 && chkUseFx2.checked),
                roundTo10: !!(chkRound10 && chkRound10.checked),
                snapTo48: !!(chkSnap48 && chkSnap48.checked),
                fxMode: (fxModeSel && fxModeSel.value) || "opaque",
                fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque"
            }, "*");
        };
    }
    if (chkUseFx2) {
        chkUseFx2.onchange = () => {
            if (!currentId) return;
            window.opener.postMessage({
                type:"elementsSinglePreviewStart",
                id: currentId,
                useGradient: !!(chkGradient && chkGradient.checked),
                useFx: !!(chkUseFx && chkUseFx.checked),
                useFx2: !!chkUseFx2.checked,
                roundTo10: !!(chkRound10 && chkRound10.checked),
                snapTo48: !!(chkSnap48 && chkSnap48.checked),
                fxMode: (fxModeSel && fxModeSel.value) || "opaque",
                fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque"
            }, "*");
        };
    }
    if (fxMode2Sel) {
        fxMode2Sel.onchange = () => {
            if (!currentId) return;
            window.opener.postMessage({
                type:"elementsSinglePreviewStart",
                id: currentId,
                useGradient: !!(chkGradient && chkGradient.checked),
                useFx: !!(chkUseFx && chkUseFx.checked),
                useFx2: !!(chkUseFx2 && chkUseFx2.checked),
                roundTo10: !!(chkRound10 && chkRound10.checked),
                snapTo48: !!(chkSnap48 && chkSnap48.checked),
                fxMode: (fxModeSel && fxModeSel.value) || "opaque",
                fxMode2: (fxMode2Sel && fxMode2Sel.value) || "opaque"
            }, "*");
        };
    }

    // Receive picked coordinates from main window
    // (legacy coord pick removed)
  </script>
</body>
</html>`;
    },

    // Mouse-pick helpers for Add Element popup
    _installAddPickListener() {
        if (this._addPickHandler) return;
        this._addPickHandler = e => {
            if (e.button !== 0) return; // left click only
            const scene = SceneManager._scene;
            if (!(scene instanceof Scene_Map)) return;
            const targets = [];
            if (this._addWindow && !this._addWindow.closed) targets.push(this._addWindow.window);
            if (this._tilesetWindow && !this._tilesetWindow.closed) targets.push(this._tilesetWindow.window);
            if (!targets.length) return;

            const tw = $gameMap.tileWidth();
            const th = $gameMap.tileHeight();
            const cx = Graphics.pageToCanvasX(e.pageX);
            const cy = Graphics.pageToCanvasY(e.pageY);
            if (cx < 0 || cy < 0) return;

            const worldX = cx + $gameMap.displayX() * tw;
            const worldY = cy + $gameMap.displayY() * th;

            targets.forEach(win => {
                win.postMessage({
                    type: "elementsAddPick",
                    x: Math.round(worldX),
                    y: Math.round(worldY)
                }, "*");
            });
        };
        document.addEventListener("mousedown", this._addPickHandler, true);
    },

    _removeAddPickListener() {
        const anyOpen = (this._addWindow && !this._addWindow.closed) ||
                        (this._tilesetWindow && !this._tilesetWindow.closed);
        if (anyOpen) return;
        if (!this._addPickHandler) return;
        document.removeEventListener("mousedown", this._addPickHandler, true);
        this._addPickHandler = null;
    },

    _createPreviewLabel(preview, spriteset) {
        if (!preview || !spriteset) return;
        if (!spriteset._upperLayer) {
            spriteset._upperLayer = new Sprite();
            spriteset._upperLayer.z = 10000;
            spriteset.addChild(spriteset._upperLayer);
        }
        const bmp = new Bitmap(220, 28);
        bmp.fontSize = 16;
        bmp.textColor = "#ffffff";
        bmp.outlineColor = "rgba(0,0,0,0.7)";
        bmp.outlineWidth = 4;
        const sp = new Sprite(bmp);
        sp.alpha = 0.9;
        spriteset._upperLayer.addChild(sp);
        preview.labelBmp = bmp;
        preview.labelSp = sp;
        preview.sprites.push(sp);
    },

    _computeSnapPosition(w, h) {
        if (!Utils.isNwjs?.()) return null;
        const scr = window?.screen || {};
        const left = Number(scr.availLeft ?? scr.availX ?? 0) || 0;
        const top = Number(scr.availTop ?? scr.availY ?? 0) || 0;
        const sw = Number(scr.availWidth ?? scr.width ?? 0) || 0;
        const sh = Number(scr.availHeight ?? scr.height ?? 0) || 0;
        if (!sw || !sh) return null;
        const mode = Elements._params.snapTo;
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

    toggleEditor() {
        if (this.editorWindow && !this.editorWindow.closed) {
            this.editorWindow.close();
            this.editorWindow = null;
            return;
        }
        this.openPopup();
    },

    //Main editor window size
    openPopup(forceSnap = false) {
        if (Elements._params.autoOpen) this._autoOpened = true;
        const html = this.popupHTML();
        const url = "data:text/html," + encodeURIComponent(html);
        const opts = { width: 900, height: 1200 };
        if (forceSnap && Elements._params.autoOpen) {
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

    sendState() {
        if (!this.editorWindow) return;
        this.editorWindow.window.postMessage({
            type: "elementsDebugState",
            collisionOverlay: Elements.DEBUG,
            colliderOverlay: Elements.DEBUG_COLLIDERS,
            autoSaveJson: Elements.AUTO_SAVE_JSON,
            columns: this.buildColumnsForCurrentMap(),
            selected: this.getSelectedElementInfo()
        }, "*");
    },

    buildColumnsForCurrentMap() {
        const mapId = String($gameMap?.mapId?.() || "");
        const list = Elements.mapData[mapId];
        if (!Array.isArray(list) || !list.length) {
            return Array.from({ length: 8 }, () => []);
        }

        const colWidth = 480;
        const cols = [];
        let maxIdx = 0;
        list.forEach((e, i) => {
            const idx = Math.max(0, Math.floor(e.x / colWidth));
            maxIdx = Math.max(maxIdx, idx);
            if (!cols[idx]) cols[idx] = [];
            cols[idx].push({ id: e.id, x: e.x, y: e.y, index: i });
        });
        const targetCols = Math.max(8, maxIdx + 1);
        for (let i = 0; i < targetCols; i++) {
            if (!cols[i]) cols[i] = [];
            cols[i].sort((a, b) => a.y - b.y);
        }
        return cols;
    },

    getSelectedElementInfo() {
        const idx = Elements.selectedIndex;
        const el = Elements.currentElements?.[idx];
        if (!el) return null;
        return { index: idx, id: el.id, x: el.x, y: el.y };
    },

    popupHTML() {
        return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Elements Debug</title>
<style>
body { background:#222; color:#eee; font-family: system-ui, sans-serif; padding:16px; margin:0; }
h3 { margin:0 0 10px 0; }
button { padding:6px 12px; height:36px; border:1px solid #555; background:#eee; color:#111; cursor:pointer; }
button:disabled { opacity:0.6; cursor:not-allowed; }
input[type="number"] { height:36px; padding:6px 8px; box-sizing:border-box; background:#fff; color:#111; border:1px solid #555; }

.layout { display:grid; grid-template-columns: 240px 1fr; gap:16px; align-items:start; }

.card { background:#2b2b2b; border:1px solid #444; padding:12px; border-radius:4px; }
.card label { display:block; margin-bottom:10px; }
.card button { margin-top:0; }

.pos-card { background:#2d2d2d; border:1px solid #444; padding:12px; border-radius:4px; width:360px; }
.pos-grid { display:grid; grid-template-columns: repeat(5, 1fr); gap:8px; margin-top:8px; }
.pos-grid input { width:100%; }
.actions-row { display:flex; gap:12px; margin:10px 0 0 0; }
.actions-row button { flex:1; height:44px; font-size:16px; font-family: inherit; }
.pick-row { display:flex; justify-content:flex-end; margin-top:6px; }

.cols { display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap; margin-top:16px; }
.col { background:#2d2d2d; border:1px solid #444; padding:10px; min-width:160px; width:186px; height:380px; overflow-y:auto; border-radius:4px; }
.col h4 { margin:0 0 8px 0; font-size:13px; color:#ccc; }
.item { font-size:12px; margin:2px 0; }
</style>
</head>
<body>
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
        <button class="btnMove" data-dx="-96" data-dy="0">🢀 96</button>
        <button class="btnMove" data-dx="-48" data-dy="0">🢀 48</button>
        <input id="posX" type="number">
        <button class="btnMove" data-dx="48" data-dy="0">48 🢂</button>
        <button class="btnMove" data-dx="96" data-dy="0">96 🢂</button>

        <button class="btnMove" data-dx="0" data-dy="96">🢃 96</button>
        <button class="btnMove" data-dx="0" data-dy="48">🢃 48</button>
        <input id="posY" type="number">
        <button class="btnMove" data-dx="0" data-dy="-48">48 🢁</button>
        <button class="btnMove" data-dx="0" data-dy="-96">96 🢁</button>

      </div>
      <div class="pick-row">
        <button id="btnPickPos" style="width:360px;">Click on the map to reposition this element</button>
      </div>
      <small id="selInfo" style="color:#aaa; display:block; margin-top:6px;">No element selected</small>
    </div>
  </div>

  <div class="actions-row">
    <button id="btnAddElement">Add new element</button>
    <button id="btnAddTilesetElement">Add Tileset Element</button>
    <button id="btnDeleteElement">Delete this element</button>
  </div>

  <div id="cols" class="cols"></div>
  <script>
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
            window.opener.postMessage({ type:"elementsMove", dx, dy },"*");
        };
    });
    [posX, posY].forEach(inp => {
        inp.onchange = () => {
            if (currentSelection == null) return;
            const x = Number(posX.value);
            const y = Number(posY.value);
            window.opener.postMessage({ type:"elementsSet", x, y },"*");
        };
    });

    function renderColumns(columns){
        colsDiv.innerHTML = "";
        if (!columns || !columns.length) {
            columns = Array.from({ length: 8 }, () => []);
        }
        if (columns.length < 8) {
            for (let i = columns.length; i < 8; i++) columns.push([]);
        }
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
                    d.textContent = \`\${displayName}  (x:\${item.x}, y:\${item.y})\`;
                    d.onclick = () => {
                        if (currentSelection === item.index) {
                            currentSelection = null;
                            window.opener.postMessage({ type:"elementsSelect", index:null },"*");
                        } else {
                            currentSelection = item.index;
                            window.opener.postMessage({ type:"elementsSelect", index:item.index },"*");
                        }
                    };
                    if (currentSelection === item.index) {
                        d.style.background = "#ffe500";
                        d.style.color = "#111";
                        d.style.border = "1px solid #ccae00";
                    }
                    wrap.appendChild(d);
                });
            }
            colsDiv.appendChild(wrap);
        });
    }

    window.addEventListener("message", e => {
        if (e.data.type === "elementsDebugState") {
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
            if (btnDeleteElement) btnDeleteElement.disabled = currentSelection == null;
        }
    });
    const send = () => {
        window.opener.postMessage({
            type:"elementsDebugToggle",
            collisionOverlay: chkColl.checked,
            colliderOverlay: chkCols.checked,
            autoSaveJson: chkAutoSave.checked
        },"*");
    };
    chkColl.onchange = send;
    chkCols.onchange = send;
    chkAutoSave.onchange = () => {
        btnSaveJson.disabled = chkAutoSave.checked;
        send();
    };
    btnSaveJson.onclick = () => window.opener.postMessage({ type:"elementsSaveJson" },"*");
    if (btnAddElement) btnAddElement.onclick = () => window.opener.postMessage({ type:"elementsAddPopup" },"*");
    if (btnAddTilesetElement) btnAddTilesetElement.onclick = () => window.opener.postMessage({ type:"elementsAddTilesetPopup" },"*");
    if (btnDeleteElement) btnDeleteElement.onclick = () => window.opener.postMessage({ type:"elementsDelete" },"*");
    if (btnPickPos) btnPickPos.onclick = () => window.opener.postMessage({ type:"elementsPickPositionStart" },"*");
  </script>
</body>
</html>`;
    }
};

// Initialize editor hotkey
Elements.Editor.init();
