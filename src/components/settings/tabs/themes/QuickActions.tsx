/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { FolderIcon, PaintbrushIcon, PlusIcon, RestartIcon } from "@components/Icons";
import { QuickAction, QuickActionCard } from "@components/settings";
import { findLazy } from "@webpack";
import { React } from "@webpack/common";
import type { ComponentType, Ref, SyntheticEvent } from "react";

type FileInputType = ComponentType<{
    ref: Ref<HTMLInputElement>;
    onChange: (e: SyntheticEvent<HTMLInputElement>) => void;
    multiple?: boolean;
    filters?: { name?: string; extensions: string[]; }[];
}>;

const FileInput: FileInputType = findLazy(m => m.prototype?.activateUploadDialogue && m.prototype.setRef);

export interface QuickActionsSectionProps {
    fileInputRef: any;
    onFileUpload: (e: SyntheticEvent<HTMLInputElement>) => void;
    refreshLocalThemes: () => void;
}

export function QuickActionsSection({ fileInputRef, onFileUpload, refreshLocalThemes }: QuickActionsSectionProps) {
    return (
        <QuickActionCard>
            {IS_WEB ? (
                <QuickAction
                    text={
                        <span style={{ position: "relative" }}>
                            Upload Theme
                            <FileInput
                                ref={fileInputRef}
                                onChange={onFileUpload}
                                multiple={true}
                                filters={[{ extensions: ["css"] }]}
                            />
                        </span>
                    }
                    Icon={PlusIcon}
                />
            ) : (
                <QuickAction
                    text="Open Themes Folder"
                    action={() => VencordNative.themes.openFolder()}
                    Icon={FolderIcon}
                />
            )}
            <QuickAction
                text="Load missing Themes"
                action={refreshLocalThemes}
                Icon={RestartIcon}
            />
            <QuickAction
                text="Edit QuickCSS"
                action={() => VencordNative.quickCss.openEditor()}
                Icon={PaintbrushIcon}
            />
            {/* The "Edit ClientTheme" action lived here. ClientTheme is one of the
                361 plugins this fork deleted, so Settings.plugins.ClientTheme is
                undefined and reading .enabled threw, taking the whole Themes tab
                down. Optional chaining would have silenced the crash but left a
                quick action that can only ever open a plugin that does not exist,
                so the block is gone rather than guarded. */}
        </QuickActionCard>
    );
}
