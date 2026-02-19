/*:
 * @target MZ
 * @plugindesc Proximity popup above events (Bitmap text, no jitter) + Debug circle in Test Play. DotMoveSystem-stable.
 * @author RDM
 *
 * @param DefaultRange
 * @text Default popup range
 * @type number
 * @decimals 2
 * @default 1.5
 * @desc Distance in tiles at which popup becomes visible.
 *
 * @help
 * Add this tag to an event's Note box:
 *
 *   <popupText: Talk>
 *
 * Popup appears when player is nearby (any direction).
 * Debug circles appear only in Test Play.
 */

(() => {

// ----------------------------------------------------------
// Parameters
// ----------------------------------------------------------
const params = PluginManager.parameters("RDM_ProximityPopup");
const DEFAULT_RANGE = Number(params.DefaultRange || 1.5);


// ----------------------------------------------------------
// NOTE TAG PARSER
// ----------------------------------------------------------
function getPopupText(event) {
    const note = event.event().note;
    const match = note.match(/<popupText:\s*(.+?)\s*>/i);
    return match ? match[1] : null;
}


// ----------------------------------------------------------
// Spriteset_Map EXTENSION
// ----------------------------------------------------------
const _Spriteset_Map_createCharacters = Spriteset_Map.prototype.createCharacters;
Spriteset_Map.prototype.createCharacters = function() {
    _Spriteset_Map_createCharacters.call(this);

    this._popupSprites = new Map();
    this._debugCircles = new Map();

    for (const sprite of this._characterSprites) {
        const ev = sprite._character;
        if (ev instanceof Game_Event) {
            const text = getPopupText(ev);
            if (text) {

                // --- Popup Bitmap Text ---
                const popup = this.createPopupBitmap(text);
                popup.visible = false;
                this._popupSprites.set(ev, popup);
                this._tilemap.addChild(popup);

                // --- Debug circle (Test Play only) ---
                if (Utils.isOptionValid("test")) {
                    const circle = this.createDebugCircle(DEFAULT_RANGE);
                    this._debugCircles.set(ev, circle);
                    this._tilemap.addChild(circle);
                }
            }
        }
    }
};


// ----------------------------------------------------------
// Create popup text (Bitmap)
// ----------------------------------------------------------
Spriteset_Map.prototype.createPopupBitmap = function(text) {
    const bmp = new Bitmap(200, 48);
    bmp.fontFace = "GameFont";
    bmp.fontSize = 18;
    bmp.textColor = "#ffffff";
    bmp.outlineWidth = 3;
    bmp.outlineColor = "rgba(0,0,0,1)";
    bmp.drawText(text, 0, 0, 200, 36, "center");

    const sprite = new Sprite(bmp);
    sprite.anchor.x = 0.5;
    sprite.anchor.y = 1.0;

    sprite._lastX = 0;
    sprite._lastY = 0;

    return sprite;
};


// ----------------------------------------------------------
// Create debug radius circle (stable)
// ----------------------------------------------------------
Spriteset_Map.prototype.createDebugCircle = function(range) {
    const g = new PIXI.Graphics();

    g.beginFill(0x00ff00, 0.25);
    g.lineStyle(2, 0x00ff00, 0.6);

    const px = range * $gameMap.tileWidth();
    g.drawCircle(0, 0, px);
    g.endFill();

    g.zIndex = 1;
    return g;
};


// ----------------------------------------------------------
// UPDATE LOOP
// ----------------------------------------------------------
const _Spriteset_Map_update = Spriteset_Map.prototype.update;
Spriteset_Map.prototype.update = function() {
    _Spriteset_Map_update.call(this);
    this.updatePopupPositions();
};


// ----------------------------------------------------------
// Popup + debug circle positioning (no jitter)
// ----------------------------------------------------------
Spriteset_Map.prototype.updatePopupPositions = function() {
    if (!this._popupSprites) return;

    const player = $gamePlayer;
    const tw = $gameMap.tileWidth();
    const th = $gameMap.tileHeight();

    for (const [event, popup] of this._popupSprites.entries()) {
        if (event._erased) {
            popup.visible = false;
            const circle = this._debugCircles.get(event);
            if (circle) circle.visible = false;
            continue;
        }

        // Get real DotMoveSystem coordinates
        const realX = event._realX;
        const realY = event._realY;

        // Convert map coords → screen coords
        const screenX = Math.round($gameMap.adjustX(realX) * tw + tw / 2);
        const screenY = Math.round($gameMap.adjustY(realY) * th);

        // Popup offset above event
        const targetX = screenX;
        const targetY = screenY - 24; // ~1/2 tile above

        // Smooth deadzone (remove micro drift)
        const dx = Math.abs(targetX - popup._lastX);
        const dy = Math.abs(targetY - popup._lastY);
        if (dx > 0.15 || dy > 0.15) {
            popup.x = popup._lastX = targetX;
            popup.y = popup._lastY = targetY;
        }

        // Distance check (range)
        const dist = Math.hypot(player._realX - realX, player._realY - realY);
        popup.visible = dist <= DEFAULT_RANGE;

        // --- Debug circle stable position ---
        const circle = this._debugCircles.get(event);
        if (circle) {
            circle.x = screenX;
            circle.y = Math.round($gameMap.adjustY(realY) * th + th / 2);
        }
    }
};


// ----------------------------------------------------------
// Helper: get character sprite
// ----------------------------------------------------------
Spriteset_Map.prototype.findTargetSprite = function(character) {
    return this._characterSprites.find(s => s._character === character);
};

})();
