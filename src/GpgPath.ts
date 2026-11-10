import type { App } from "obsidian";

// The GPG executable lives in a different place on each computer, so its path is kept in this
// device's local storage (app.saveLocalStorage) instead of data.json, which is synced with the vault.
const DEVICE_GPG_PATH_KEY = "gpg-encrypt-exec-path";

// Usual install locations, in lookup order, for each platform. The first one is the default of
// versions <= 1.2.0, so whoever relied on it keeps the same executable after upgrading.
const GPG_PATH_CANDIDATES: Record<string, string[]> = {
    win32: [
        "C:\\Program Files (x86)\\GnuPG\\bin\\gpg.exe",
        "C:\\Program Files\\GnuPG\\bin\\gpg.exe",
    ],
    darwin: [
        "/usr/local/bin/gpg",
        "/opt/homebrew/bin/gpg",
        "/usr/local/MacGPG2/bin/gpg",
        "/opt/local/bin/gpg",
    ],
    linux: [
        "/usr/bin/gpg",
        "/usr/local/bin/gpg",
        "/usr/bin/gpg2",
    ],
};

// Candidate paths for a platform; never mixes platforms, so a path from another OS is never probed
export function gpgPathCandidates(platform: string): string[] {
    return GPG_PATH_CANDIDATES[platform] ?? [];
}

// Current Node platform, or undefined on mobile where there is no Node process
function currentPlatform(): string | undefined {
    return typeof process !== "undefined" && process.platform ? process.platform : undefined;
}

// Whether a file exists on this device (always false on mobile)
export function fileExists(path: string): boolean {
    if (!currentPlatform() || path.trim() === "") return false;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay lazy, a top-level import breaks mobile
        const fs = require("fs") as typeof import("fs");
        return fs.existsSync(path);
    } catch {
        return false;
    }
}

// First GPG executable found in the usual locations of this platform, or "" if none
export function detectGpgPath(candidates: string[] = gpgPathCandidates(currentPlatform() ?? "")): string {
    return candidates.find(fileExists) ?? "";
}

// Path set by the user on this device, or "" to detect it automatically
export function getDeviceGpgPath(app: App): string {
    const stored: unknown = app.loadLocalStorage(DEVICE_GPG_PATH_KEY);
    return typeof stored === "string" ? stored : "";
}

// Save the path for this device only; an empty value goes back to automatic detection
export function setDeviceGpgPath(app: App, path: string): void {
    const value = path.trim();
    app.saveLocalStorage(DEVICE_GPG_PATH_KEY, value === "" ? null : value);
}

// Path to run GPG with on this device: the user's choice, otherwise the detected one
export function resolveGpgPath(app: App): string {
    return getDeviceGpgPath(app) || detectGpgPath();
}

// Versions <= 1.2.0 stored one shared path in data.json. Keep it on this device only when it
// exists here and automatic detection would not find it anyway; otherwise detection takes over.
export function adoptSharedGpgPath(app: App, sharedPath: string): void {
    const path = sharedPath.trim();
    if (getDeviceGpgPath(app) !== "" || !fileExists(path) || path === detectGpgPath()) return;
    setDeviceGpgPath(app, path);
}
