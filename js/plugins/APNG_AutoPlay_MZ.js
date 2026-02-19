/*:
 * @target MZ
 * @plugindesc Minimal APNG support for Show Picture (APNG-only)
 * @author You
 *
 * @help
 * - Put APNG files in img/pictures/
 * - Use "Show Picture" normally
 * - APNG animates automatically
 *
 * Requirements:
 * - PixiApngAndGif.js (must be loaded BEFORE this plugin)
 */

(() => {
    "use strict";

    // -------------------------------------------------
    // 1. APNG Loader (APNG-only, minimal)
    // -------------------------------------------------
    class ApngLoader {
        constructor() {
            this._map = {};
        }

        load(name) {
            if (this._map[name]) {
                return this._map[name];
            }

            const path = `img/pictures/${name}.png`;

            PIXI.Loader.shared.add(
                path,
                {
                    loadType: PIXI.LoaderResource.LOAD_TYPE.XHR,
                    xhrType: PIXI.LoaderResource.XHR_RESPONSE_TYPE.BUFFER
                }
            );

            this._map[name] = path;
            return path;
        }

        createSprite(name) {
            const path = this._map[name];
            if (!path) return null;

            const apng = new PixiApngAndGif(path, PIXI.Loader.shared.resources);
            apng.play();

            const sprite = apng.sprite;
            sprite._pixiApng = apng;

            return sprite;
        }
    }

    const APNG_LOADER = new ApngLoader();

    // -------------------------------------------------
    // 2. Hook Sprite_Picture
    // -------------------------------------------------
    const _Sprite_Picture_loadBitmap =
        Sprite_Picture.prototype.loadBitmap;

    Sprite_Picture.prototype.loadBitmap = function () {
        const picture = this.picture();
        if (!picture) return;

        const name = picture.name();
        if (!name) return;

        // Avoid duplicate creation
        if (this._apngSprite) return;

        // Register APNG load
        APNG_LOADER.load(name);

        // Ensure loader runs
        PIXI.Loader.shared.load(() => {
            const sprite = APNG_LOADER.createSprite(name);
            if (!sprite) {
                _Sprite_Picture_loadBitmap.call(this);
                return;
            }

            // Remove default bitmap
            this.removeChildren();
            this.bitmap = null;

            // Match RPG Maker anchor behavior
            sprite.anchor.set(this.anchor.x, this.anchor.y);

            this._apngSprite = sprite;
            this.addChild(sprite);
        });
    };

})();
