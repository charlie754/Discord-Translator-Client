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

// DO NOT REMOVE UNLESS YOU WISH TO FACE THE WRATH OF THE CIRCULAR DEPENDENCY DEMON!!!!!!!
import "~plugins";
import "./fixWeirdAppRegionBug.css";

export * as Api from "./api";
export * as Plugins from "./api/PluginManager";
export * as Components from "./components";
export * as Util from "./utils";
export * as Updater from "./utils/updater";
export * as Webpack from "./webpack";
export * as WebpackPatcher from "./webpack/patchWebpack";
export { PlainSettings, Settings };

import { coreStyleRootNode, initStyles } from "@api/Styles";
import { openSettingsTabModal, UpdaterTab } from "@components/settings";
import { debounce } from "@shared/debounce";
import { IS_WINDOWS } from "@utils/constants";
import { createAndAppendStyle } from "@utils/css";
import { StartAt } from "@utils/types";
import { SettingsRouter } from "@webpack/common";

import { get as dsGet } from "./api/DataStore";
import { showNotification } from "./api/Notifications";
import { initPluginManager, PMLogger, startAllPlugins } from "./api/PluginManager";
import { PlainSettings, Settings, SettingsStore } from "./api/Settings";
import { areLocalSettingsDirty, getCloudSettings, getCloudSyncDirection, markLocalSettingsDirty, putCloudSettings, shouldCloudSync } from "./api/SettingsSync/cloudSync";
import { relaunch } from "./utils/native";
import { showBanner, updateBanner } from "./utils/updateBanner";
import { checkForUpdates, isOutdated as getIsOutdated, latestVersion, update, UpdateLogger, updateNow } from "./utils/updater";
import { onceReady } from "./webpack";
import { patches } from "./webpack/patchWebpack";

if (IS_REPORTER) {
    require("./debug/runReporter");
}

/**
 * Neutralise cloud settings sync left over from an older install.
 *
 * v0.1.0 shipped upstream's Cloud Settings tab, whose `cloud.url` defaulted to a
 * third-party host, so a user could authenticate and enable sync. This release deleted
 * that tab. Hiding the switch is not turning it off: the flags are persisted settings, so
 * an upgraded install would keep pushing settings to a server the user can no longer see,
 * disable, or point elsewhere.
 *
 * Clearing both flags here makes it unreachable rather than merely invisible —
 * `syncSettings()` gates every push and pull on `cloud.authenticated`, and the debounced
 * push listener it installs gates on `cloud.settingsSync` as well.
 *
 * Called before init() so it lands before syncSettings() can read either flag. Guarded on
 * the current value so a fresh install (both already false) writes nothing.
 */
function disableCloudSync() {
    if (Settings.cloud.authenticated) Settings.cloud.authenticated = false;
    if (Settings.cloud.settingsSync) Settings.cloud.settingsSync = false;
}

async function syncSettings() {
    const hasCloudAuth = await dsGet("Vencord_cloudSecret");
    if (!hasCloudAuth) {
        if (Settings.cloud.authenticated) {
            // User switched to an account that isn't connected to cloud
            showNotification({
                title: "Cloud Settings",
                body: "Cloud sync was disabled because this account isn't connected to the cloud App. You can enable it again by connecting this account in Cloud Settings. (note: it will store your preferences separately)",
                color: "var(--yellow-360)",
                onClick: () => SettingsRouter.openUserSettings("equicord_cloud_panel")
            });
            // Disable cloud sync globally
            Settings.cloud.authenticated = false;
        }
        return;
    }

    // pre-check for local shared settings
    if (
        Settings.cloud.authenticated &&
        !hasCloudAuth // this has been enabled due to local settings share or some other bug
    ) {
        // show a notification letting them know and tell them how to fix it
        showNotification({
            title: "Cloud Integrations",
            body: "We've noticed you have cloud integrations enabled in another client! Due to limitations, you will " +
                "need to re-authenticate to continue using them. Click here to go to the settings page to do so!",
            color: "var(--yellow-360)",
            onClick: () => SettingsRouter.openUserSettings("equicord_cloud_panel")
        });
        return;
    }

    if (
        Settings.cloud.settingsSync && // if it's enabled
        Settings.cloud.authenticated && // if cloud integrations are enabled
        getCloudSyncDirection() !== "manual" // if we're not in manual mode
    ) {
        if (areLocalSettingsDirty() && shouldCloudSync("push")) {
            await putCloudSettings();
        } else if (shouldCloudSync("pull") && await getCloudSettings(false)) { // if we synchronized something (false means no sync)
            // we show a notification here instead of allowing getCloudSettings() to show one to declutter the amount of
            // potential notifications that might occur. getCloudSettings() will always send a notification regardless if
            // there was an error to notify the user, but besides that we only want to show one notification instead of all
            // of the possible ones it has (such as when your settings are newer).
            showNotification({
                title: "Cloud Settings",
                body: "Your settings have been updated! Click here to restart to fully apply changes!",
                color: "var(--green-360)",
                onClick: relaunch
            });
        }
    }

    const saveSettingsOnFrequentAction = debounce(async () => {
        if (Settings.cloud.settingsSync && Settings.cloud.authenticated && shouldCloudSync("push")) {
            await putCloudSettings();
        }
    }, 60_000);

    SettingsStore.addGlobalChangeListener(() => {
        markLocalSettingsDirty();
        saveSettingsOnFrequentAction();
    });
}

// The update prompt is our own DOM card, not a Discord notice. Measured on the desktop client
// 2026-11-11: Discord's NoticeStore accepted the notice and drew nothing, so the prompt was
// invisible. A self-rendered card also still works when a Discord update has broken our patches,
// which is exactly when the user most needs to be told about a fix.
function showUpdatePrompt() {
    let installing = false;

    showBanner({
        kind: "update",
        placement: "corner",
        message: latestVersion === null
            ? "A new version of Discord Translator is available."
            : `Discord Translator ${latestVersion} is available.`,
        updateAction: {
            label: "Update now",
            onClick: async () => {
                if (installing) return;
                installing = true;
                updateBanner({ detail: "Downloading - Discord will restart when it is done." });

                try {
                    await updateNow();
                } catch (err) {
                    installing = false;
                    UpdateLogger.error("Failed to install update", err);
                    updateBanner({
                        detail: "The update could not be installed.",
                        updateAction: { label: "Open Updater", onClick: openUpdaterTab }
                    });
                }
            }
        }
    });
}

function showUpdateStatus(message: string) {
    showBanner({ kind: "update", placement: "corner", message });
}

function openUpdaterTab() {
    try {
        openSettingsTabModal(UpdaterTab!);
    } catch (err) {
        UpdateLogger.error("Failed to open the Updater tab", err);
    }
}

async function runUpdateCheck() {
    if (IS_UPDATER_DISABLED) return;

    try {
        const isOutdated = await checkForUpdates();
        if (IS_DISCORD_DESKTOP) VencordNative.tray.setUpdateState(isOutdated);
        if (!isOutdated) return;

        showUpdatePrompt();
    } catch (err) {
        UpdateLogger.error("Failed to check for updates", err);
    }
}

function initTrayIpc() {
    if (IS_WEB || IS_UPDATER_DISABLED) return;

    VencordNative.tray.onCheckUpdates(async () => {
        try {
            const isOutdated = await checkForUpdates();
            VencordNative.tray.setUpdateState(isOutdated);

            if (isOutdated) {
                showUpdatePrompt();
            } else {
                showUpdateStatus("Discord Translator is up to date.");
            }
        } catch (err) {
            UpdateLogger.error("Failed to check for updates from tray", err);
            showUpdateStatus("Could not check for Discord Translator updates. Try again later.");
        }
    });

    VencordNative.tray.onRepair(async () => {
        try {
            await update();
            relaunch();
        } catch (err) {
            UpdateLogger.error("Failed to repair Discord Translator", err);
        }
    });

    VencordNative.tray.setUpdateState(getIsOutdated);
}

async function init() {
    await onceReady;
    startAllPlugins(StartAt.WebpackReady);

    syncSettings();
    initTrayIpc();

    if (IS_DEV) {
        const pendingPatches = patches.filter(p => !p.all && p.predicate?.() !== false);
        if (pendingPatches.length)
            PMLogger.warn(
                "Webpack has finished initialising, but some patches haven't been applied yet.",
                "This might be expected since some Modules are lazy loaded, but please verify",
                "that all plugins are working as intended.",
                "You are seeing this warning because this is a Development build of Discord Translator.",
                "\nThe following patches have not been applied:",
                "\n\n" + pendingPatches.map(p => `${p.plugin}: ${p.find}`).join("\n")
            );
    }
}

// Must precede init(): init() calls syncSettings(), which is the only consumer of these
// flags, and this is the point at which any v0.1.0 state has been loaded but not yet read.
disableCloudSync();

initPluginManager();
initStyles();
startAllPlugins(StartAt.Init);
init();

// Not inside init(): init() waits on onceReady, which never resolves if a Discord update has
// broken our webpack layer - and that is the moment the update prompt matters most. The check
// itself is IPC to the main process and the prompt is plain DOM, so neither needs webpack.
if (!IS_DEV && !IS_WEB && !IS_UPDATER_DISABLED) {
    runUpdateCheck();
}

document.addEventListener("DOMContentLoaded", () => {
    startAllPlugins(StartAt.DOMContentLoaded);

    // FIXME
    if (IS_DISCORD_DESKTOP && Settings.winNativeTitleBar && IS_WINDOWS) {
        createAndAppendStyle("vencord-native-titlebar-style", coreStyleRootNode).textContent = "[class*=titleBar]{display: none!important}";
    }
}, { once: true });
