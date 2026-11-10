import { Notice } from "obsidian";
import type { SecretStorage } from "obsidian";
import GpgEncryptPlugin from "../main";

// Settings object
export interface GpgEncryptSettings {
	pgpExecPath: string;
	pgpSignPublicKeyId: string
    pgpAlwaysTrust: boolean,
    pgpDefaultEncryptKeys: Array<string>,
    pgpLibrary: string,
    pgpAditionalCommands: boolean,
    pgpAditionalCommandsBefore: string,
    pgpAditionalCommandsAfter: string,
    pgpAditionalCommandsConsole: boolean,
    // OpenPGP.js library settings (used when pgpLibrary === "openpgpjs")
    pgpPublicKeyArmored: string,
    pgpPrivateKeyArmored: string,
    // Name of the secret in Obsidian's Keychain (app.secretStorage) that holds the passphrase, never the passphrase itself
    pgpPassphraseSecret: string,
    pgpPassphraseCacheMinutes: number
}

// Settings as persisted by versions <= 1.2.0, which stored the passphrase in plain text
type StoredSettings = GpgEncryptSettings & { pgpPassphrase?: string };

// Keychain secret name used when moving a plain-text passphrase out of data.json
const MIGRATED_PASSPHRASE_SECRET = "gpg-encrypt-passphrase";

// Default settings values
const DEFAULT_SETTINGS: GpgEncryptSettings = {
    pgpExecPath: getDefaultExecPath(),
    pgpSignPublicKeyId: "0",
    pgpAlwaysTrust: false,
    pgpDefaultEncryptKeys: [],
    pgpLibrary: "openpgpjs",
    pgpAditionalCommands: false,
    pgpAditionalCommandsBefore: "",
    pgpAditionalCommandsAfter: "",
    pgpAditionalCommandsConsole: false,
    // OpenPGP.js library settings
    pgpPublicKeyArmored: "",
    pgpPrivateKeyArmored: "",
    pgpPassphraseSecret: "",
    pgpPassphraseCacheMinutes: 5
}

// Settings class
export class Settings {

    // Current plugin instance
	plugin: GpgEncryptPlugin;

    // Constructor of modal encrypt
    constructor(plugin: GpgEncryptPlugin) {
        this.plugin = plugin;
    }

    // Load Settings from Plugin Data
    async loadSettings() {
        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, await this.plugin.loadData());
        await this.migratePlainTextPassphrase();
    }

    // Move a passphrase saved in plain text by versions <= 1.2.0 into Obsidian's Keychain
    private async migratePlainTextPassphrase() {
        const settings = this.plugin.settings as StoredSettings;
        if (settings.pgpPassphrase === undefined) return;
        const legacy = settings.pgpPassphrase;
        if (legacy.trim() !== "") {
            const secrets = this.plugin.app.secretStorage;
            try {
                const name = findSecretName(secrets, legacy);
                secrets.setSecret(name, legacy);
                // Only drop the plain-text copy once the Keychain holds it, so a passphrase is never lost
                if (secrets.getSecret(name) !== legacy) throw new Error("the secret could not be read back");
                if (!settings.pgpPassphraseSecret) settings.pgpPassphraseSecret = name;
                new Notice(`GPG Encrypt: your saved passphrase was moved to Obsidian's Keychain as "${name}" and removed from data.json.`);
            } catch (ex) {
                // Keep data.json untouched and retry on the next load
                console.error("GPG Encrypt: could not move the saved passphrase to Obsidian's Keychain", ex);
                new Notice("GPG Encrypt: could not move your saved passphrase to Obsidian's Keychain. It is still stored in plain text in data.json.");
                return;
            }
        }
        delete settings.pgpPassphrase;
        await this.saveSettings();
    }

    // Save Settings to Plugin Data
    async saveSettings() {
        await this.plugin.saveData(this.plugin.settings);
    }
}

// First free Keychain name (or one that already holds this same value) for the migrated passphrase
function findSecretName(secrets: SecretStorage, value: string): string {
    for (let i = 1; ; i++) {
        const name = i === 1 ? MIGRATED_PASSPHRASE_SECRET : `${MIGRATED_PASSPHRASE_SECRET}-${i}`;
        const existing = secrets.getSecret(name);
        if (existing === null || existing === value) return name;
    }
}

// Get Default Exec Path in base on platform name
function getDefaultExecPath(): string {
    // On mobile there is no Node process; return empty (native GPG is unavailable there)
    if (typeof process === "undefined" || !process.platform) {
        return "";
    }
    // Check platform name
    switch (process.platform) {
        // In case of Windows OS
        case "win32":
            return "C:\\Program Files (x86)\\GnuPG\\bin\\gpg.exe";
        // In case of MacOS
        case "darwin":
            return "/usr/local/bin/gpg";
        // In case of Linux
        case "linux":
            return "/usr/bin/gpg";
        // In default value return empty
        default:
            return "";
    }
}
