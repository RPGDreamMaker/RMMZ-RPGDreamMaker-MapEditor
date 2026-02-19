/*:
 * @target MZ
 * @plugindesc Pixel-perfect LOS cone (angle, range, text popup) with CollisionMapEx red-only blocking
 * @author RDM
 *
 * @help
 * Event note format:
 *
 *     <LOS: angle, range, text>
 *
 * Example:
 *     <LOS: 90, 8, Stop!>
 *
 * - angle: cone width in degrees
 * - range: tiles
 * - text: popup text shown above the event ONLY when a ray touches the player's collider
 */

(() => {

// ============================================================================
// NOTE TAG PARSER
// ============================================================================
function parseLOSTag(ev) {
    const note = ev.event().note;
    const m = note.match(/<LOS:\s*(\d+)\s*,\s*(\d+)\s*,\s*(.+?)\s*>/i);
    if (!m) return null;
    return {
        angle: Number(m[1]),
        range: Number(m[2]),
        text:  String(m[3]).trim()
    };
}

// ============================================================================
// SPRITESET MAP HOOK
// ============================================================================
const _Spriteset_Map_createCharacters = Spriteset_Map.prototype.createCharacters;
Spriteset_Map.prototype.createCharacters = function() {
    _Spriteset_Map_createCharacters.call(this);

    this._losEvents = [];
    this._losPopups = new Map();

    const tw = $gameMap.tileWidth();
    const th = $gameMap.tileHeight();

    for (const sprite of this._characterSprites) {
        const ev = sprite._character;
        if (ev instanceof Game_Event) {
            const cfg = parseLOSTag(ev);
            if (cfg) {

                // Store config on event
                ev._losConfig = cfg;
                ev._losHasSight = false;

                this._losEvents.push(ev);

                // --- Create popup sprite (Bitmap Text) ---
                const bmp = new Bitmap(200, 48);
                bmp.fontFace = "GameFont";
                bmp.fontSize = 18;
                bmp.textColor = "#ffffff";
                bmp.outlineWidth = 3;
                bmp.outlineColor = "rgba(0,0,0,1)";
                bmp.drawText(cfg.text, 0, 0, 200, 36, "center");

                const popup = new Sprite(bmp);
                popup.anchor.x = 0.5;
                popup.anchor.y = 1.0;
                popup.visible = false;
                popup._lastX = 0;
                popup._lastY = 0;

                this._tilemap.addChild(popup);
                this._losPopups.set(ev, popup);
            }
        }
    }

    // LOS debug graphics (optional)
    this._losGraphics = new PIXI.Graphics();
    this.addChild(this._losGraphics);
    this._losGraphics.zIndex = 999999;
};

const _Spriteset_Map_update = Spriteset_Map.prototype.update;
Spriteset_Map.prototype.update = function() {
    _Spriteset_Map_update.call(this);
    this.updateLOS();
    this.updateLOSPopups();
};

// ============================================================================
// UPDATE LOS (cast rays)
// ============================================================================
Spriteset_Map.prototype.updateLOS = function() {

    const g = this._losGraphics;
    g.clear();

    if (!CMEX_Core || !CMEX_Core.losBlockerSet) return;
    if (!this._losEvents.length) return;

    for (const ev of this._losEvents) {
        if (!ev || ev._erased) continue;

        const cfg = ev._losConfig;
        const angleDeg = cfg.angle;
        const rangeTiles = cfg.range;

        // Base direction in radians
        const baseRad = dirToRad(ev.direction());

        // Angle -> radians
        const total = angleDeg * Math.PI / 180;
        const half = total / 2;

        // Number of rays
        const rayCount = Math.round(angleDeg / 10) + 1;
        const segments = rayCount - 1;
        const delta = segments > 0 ? total / segments : 0;

        ev._losHasSight = false; // reset for this frame

        for (let i = 0; i < rayCount; i++) {
            const offset = -half + delta * i;
            const rad = baseRad + offset;
            const hitPlayer = this.castRay(ev, rad, rangeTiles, g);

            if (hitPlayer) {
                ev._losHasSight = true;
            }
        }
    }
};

// ============================================================================
// RAYCAST FUNCTION (pixel-perfect, checks player collider each step)
// ============================================================================
Spriteset_Map.prototype.castRay = function(ev, rad, range, g) {

    const tw = $gameMap.tileWidth();
    const th = $gameMap.tileHeight();

    // Event collision rect center
    const r = ev.collisionRect();
    const cx = (r.x + r.width / 2) * tw;
    const cy = (r.y + r.height / 2) * th;

    // Ray stepping
    const step = 2;
    const dx = Math.cos(rad) * step;
    const dy = Math.sin(rad) * step;

    const maxPix = range * tw;

    // Player collider
    const pr = $gamePlayer.collisionRect();
    const ppx = pr.x * tw;
    const ppy = pr.y * th;
    const ppw = pr.width  * tw;
    const pph = pr.height * th;

    // Starting pos
    let px = cx;
    let py = cy;
    let dist = 0;

    const sx = $gameMap.adjustX(r.x + r.width/2) * tw;
    const sy = $gameMap.adjustY(r.y + r.height/2) * th;

    while (dist < maxPix) {
        px += dx;
        py += dy;
        dist += step;

        const ix = Math.floor(px);
        const iy = Math.floor(py);
        const key = `${ix},${iy}`;

        // PLAYER COLLISION CHECK (pixel perfect)
        if (px >= ppx && px <= ppx + ppw && py >= ppy && py <= ppy + pph) {
            // Draw green line
            const ex = $gameMap.adjustX(px / tw) * tw;
            const ey = $gameMap.adjustY(py / th) * th;

            g.lineStyle(2, 0x00ff00, 1.0);
            g.moveTo(sx, sy);
            g.lineTo(ex, ey);

            return true; // player hit
        }

        // LOS BLOCKER (RED pixels only)
        if (CMEX_Core.losBlockerSet.has(key)) {
            const ex = $gameMap.adjustX(px / tw) * tw;
            const ey = $gameMap.adjustY(py / th) * th;

            g.lineStyle(2, 0xff0000, 0.9);
            g.moveTo(sx, sy);
            g.lineTo(ex, ey);
            return false;
        }
    }

    // Nothing hit (yellow line)
    const ex = $gameMap.adjustX(px / tw) * tw;
    const ey = $gameMap.adjustY(py / th) * th;
    g.lineStyle(1, 0xffff00, 0.5);
    g.moveTo(sx, sy);
    g.lineTo(ex, ey);

    return false;
};

// ============================================================================
// POPUP UPDATE
// ============================================================================
Spriteset_Map.prototype.updateLOSPopups = function() {

    const tw = $gameMap.tileWidth();
    const th = $gameMap.tileHeight();

    for (const ev of this._losEvents) {

        const popup = this._losPopups.get(ev);
        if (!popup) continue;

        if (ev._erased) {
            popup.visible = false;
            continue;
        }

        // Position the popup above the event
        const rx = ev._realX;
        const ry = ev._realY;

        const screenX = Math.round($gameMap.adjustX(rx) * tw + tw / 2);
        const screenY = Math.round($gameMap.adjustY(ry) * th);

        const targetX = screenX;
        const targetY = screenY - 24;

        const dx = Math.abs(targetX - popup._lastX);
        const dy = Math.abs(targetY - popup._lastY);

        if (dx > 0.15 || dy > 0.15) {
            popup.x = popup._lastX = targetX;
            popup.y = popup._lastY = targetY;
        }

        // SHOW ONLY IF event sees player
        popup.visible = !!ev._losHasSight;
    }
};

// ============================================================================
// Facing direction → radians
// ============================================================================
function dirToRad(d) {
    switch (d) {
        case 2: return Math.PI / 2;
        case 4: return Math.PI;
        case 6: return 0;
        case 8: return -Math.PI / 2;
    }
    return 0;
}

})();
