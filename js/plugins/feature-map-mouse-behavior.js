/*:
 * @target MZ
 * @plugindesc Playtest-only edge-scroll camera with unlocked player follow (8 directions).
 * @author RDM
 *
 * @param EdgePixels
 * @text Edge Trigger Size
 * @type number
 * @min 1
 * @default 28
 * @desc Distance from the screen border (px) that starts camera scrolling.
 *
 * @param MaxScrollSpeed
 * @text Max Scroll Speed
 * @type number
 * @decimals 3
 * @min 0.01
 * @default 0.20
 * @desc Maximum camera speed in tiles per frame at the border.
 *
 * @param DisableTouchMove
 * @text Disable Click Move
 * @type boolean
 * @on Yes
 * @off No
 * @default true
 * @desc Disable default click/touch move in playtest mode.
 *
 * @help
 * Playtest mode only:
 * - Camera no longer auto-follows player movement.
 * - Move the mouse near screen borders to scroll the camera.
 * - Diagonal edge scrolling works (8 directions).
 */

(() => {
"use strict";

const script = document.currentScript;
const match = script && script.src ? script.src.match(/([^/]+)\.js$/i) : null;
const pluginName = match ? match[1] : "feature-map-mouse-behavior";
const params = PluginManager.parameters(pluginName);

const EDGE_PIXELS = Math.max(1, Number(params.EdgePixels || 28));
const MAX_SCROLL_SPEED = Math.max(0.01, Number(params.MaxScrollSpeed || 0.2));
const DISABLE_TOUCH_MOVE = String(params.DisableTouchMove || "true") === "true";
let hasMouseMoved = false;
let isMouseInsideCanvas = false;

function isPlaytest() {
    return !!($gameTemp && $gameTemp.isPlaytest && $gameTemp.isPlaytest());
}

function edgeFactor(position, length) {
    if (position <= EDGE_PIXELS) {
        return -(EDGE_PIXELS - position) / EDGE_PIXELS;
    }
    const innerMax = length - EDGE_PIXELS;
    if (position >= innerMax) {
        return (position - innerMax) / EDGE_PIXELS;
    }
    return 0;
}

function applyMouseEdgeScroll(scene) {
    if (!scene || !scene.isActive() || !$gameMap || $gameMap.isScrolling()) {
        return;
    }
    if (!hasMouseMoved || !document.hasFocus() || !isMouseInsideCanvas) {
        return;
    }

    const width = Graphics.width;
    const height = Graphics.height;
    if (width <= 0 || height <= 0) {
        return;
    }

    const xFactor = edgeFactor(TouchInput.x, width);
    const yFactor = edgeFactor(TouchInput.y, height);

    if (xFactor < 0) {
        $gameMap.scrollLeft(-xFactor * MAX_SCROLL_SPEED);
    } else if (xFactor > 0) {
        $gameMap.scrollRight(xFactor * MAX_SCROLL_SPEED);
    }

    if (yFactor < 0) {
        $gameMap.scrollUp(-yFactor * MAX_SCROLL_SPEED);
    } else if (yFactor > 0) {
        $gameMap.scrollDown(yFactor * MAX_SCROLL_SPEED);
    }
}

const _TouchInput_onMouseMove = TouchInput._onMouseMove;
TouchInput._onMouseMove = function(event) {
    const x = Graphics.pageToCanvasX(event.pageX);
    const y = Graphics.pageToCanvasY(event.pageY);
    isMouseInsideCanvas = Graphics.isInsideCanvas(x, y);
    _TouchInput_onMouseMove.call(this, event);
    hasMouseMoved = true;
};

const _TouchInput_onLostFocus = TouchInput._onLostFocus;
TouchInput._onLostFocus = function() {
    isMouseInsideCanvas = false;
    _TouchInput_onLostFocus.call(this);
};

document.addEventListener("mouseleave", () => {
    isMouseInsideCanvas = false;
});

window.addEventListener("mouseout", event => {
    if (!event.relatedTarget && !event.toElement) {
        isMouseInsideCanvas = false;
    }
});

const _Scene_Map_update = Scene_Map.prototype.update;
Scene_Map.prototype.update = function() {
    _Scene_Map_update.call(this);
    if (isPlaytest()) {
        applyMouseEdgeScroll(this);
    }
};

// Unlock camera from player by disabling auto-follow in playtest.
const _Game_Player_updateScroll = Game_Player.prototype.updateScroll;
Game_Player.prototype.updateScroll = function(lastScrolledX, lastScrolledY) {
    if (isPlaytest()) {
        return;
    }
    _Game_Player_updateScroll.call(this, lastScrolledX, lastScrolledY);
};

if (DISABLE_TOUCH_MOVE) {
    const _Scene_Map_onMapTouch = Scene_Map.prototype.onMapTouch;
    Scene_Map.prototype.onMapTouch = function() {
        if (isPlaytest()) {
            $gameTemp.clearDestination();
            return;
        }
        _Scene_Map_onMapTouch.call(this);
    };
}

})();
