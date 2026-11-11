/*
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

import { fetchBuffer, fetchJson } from "@main/utils/http";
import { IpcEvents } from "@shared/IpcEvents";
import { VENCORD_USER_AGENT } from "@shared/vencordUserAgent";
import { ipcMain } from "electron";
import { writeFileSync } from "original-fs";

import gitHash from "~git-hash";
import gitRemote from "~git-remote";

import { ASAR_FILE, serializeErrors } from "./common";
import { getComparePath, getReleaseInfo, isCompleteAsar, isReleaseAssetUrl } from "./release";

const API_BASE = `https://api.github.com/repos/${gitRemote}`;
let PendingUpdate: { url: string; size: number; } | null = null;
let applying: Promise<boolean> | null = null;
let LatestReleaseSha: string | null = null;
let LatestReleaseTag: string | null = null;

async function githubGet<T = any>(endpoint: string) {
    return fetchJson<T>(API_BASE + endpoint, {
        headers: {
            Accept: "application/vnd.github+json",
            // "All API requests MUST include a valid User-Agent header.
            // Requests with no User-Agent header will be rejected."
            "User-Agent": VENCORD_USER_AGENT
        }
    });
}

async function calculateGitChanges() {
    const isOutdated = await fetchUpdates();
    if (!isOutdated) return [];

    const data = await githubGet(getComparePath(gitHash, LatestReleaseSha!));

    return data.commits.map((c: any) => ({
        hash: c.sha,
        author: c.author?.login ?? c.commit?.author?.name ?? "Unknown Author",
        message: c.commit.message.split("\n")[0]
    }));
}

async function fetchUpdates() {
    const data = await githubGet("/releases/latest");
    const release = getReleaseInfo(gitHash, data.name);

    if (!release)
        throw new Error("The latest release name does not contain a 40-character commit SHA");

    LatestReleaseSha = release.sha;
    LatestReleaseTag = typeof data.tag_name === "string" ? data.tag_name : null;
    PendingUpdate = null;

    if (release.isCurrent)
        return false;

    const asset = data.assets.find(a => a.name === ASAR_FILE);
    if (!asset)
        throw new Error(`The latest release does not contain the ${ASAR_FILE} asset`);
    if (!isReleaseAssetUrl(asset.browser_download_url, gitRemote))
        throw new Error(`Refusing to download ${ASAR_FILE} from outside this repository's releases`);

    PendingUpdate = { url: asset.browser_download_url, size: asset.size };

    return true;
}

// Single-flight: a second "Update now" (or the tray's Repair) while a download is running joins it
// instead of starting another write of the same archive.
function applyUpdates() {
    return applying ??= applyPendingUpdate().finally(() => { applying = null; });
}

async function applyPendingUpdate() {
    if (!PendingUpdate) return true;

    const { url, size } = PendingUpdate;
    const data = await fetchBuffer(url);
    if (!isCompleteAsar(data, size))
        throw new Error(`The downloaded ${ASAR_FILE} is incomplete or not an asar archive; nothing was written`);

    // ponytail: in-place write of an already validated buffer; write-to-temp + rename if Windows
    // allows renaming over the archive Electron holds open (unmeasured - Vencord has always written in place).
    writeFileSync(__dirname, data, { flush: true });

    PendingUpdate = null;

    return true;
}

ipcMain.handle(IpcEvents.GET_REPO, serializeErrors(() => `https://github.com/${gitRemote}`));
ipcMain.handle(IpcEvents.GET_UPDATES, serializeErrors(calculateGitChanges));
ipcMain.handle(IpcEvents.GET_UPDATE_VERSION, serializeErrors(() => LatestReleaseTag));
ipcMain.handle(IpcEvents.UPDATE, serializeErrors(fetchUpdates));
ipcMain.handle(IpcEvents.BUILD, serializeErrors(applyUpdates));
