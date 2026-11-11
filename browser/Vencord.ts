/*!
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// This entry point intentionally uses lazy CommonJS requires. The browser build
// is an IIFE, so esbuild still bundles both modules and gives the normal path the
// same exports, while safe mode can avoid evaluating Vencord (and its plugin,
// webpack, and Discord-injection side effects) altogether.
const guard = IS_EXTENSION
    ? require("./updateGuard").startUpdateGuard(VERSION) as { safeMode: boolean }
    : { safeMode: false };

if (!guard.safeMode) require("./VencordNativeStub");

const implementation = guard.safeMode
    ? undefined
    : require("../src/Vencord") as typeof import("../src/Vencord");

export const Api = implementation?.Api;
export const Plugins = implementation?.Plugins;
export const Components = implementation?.Components;
export const Util = implementation?.Util;
export const Updater = implementation?.Updater;
export const Webpack = implementation?.Webpack;
export const WebpackPatcher = implementation?.WebpackPatcher;
export const PlainSettings = implementation?.PlainSettings;
export const Settings = implementation?.Settings;
