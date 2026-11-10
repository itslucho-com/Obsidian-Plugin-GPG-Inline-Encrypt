import { Notice } from "obsidian";
import type { SecretStorage } from "obsidian";
import GpgEncryptPlugin from "../main";
import { adoptSharedGpgPath, resolveGpgPath } from "./GpgPath";

// Settings object
export interface GpgEncryptSettings {
	// GPG executable for this device, resolved at runtime (see GpgPath.ts); never persisted in data.json
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
    pgpExecPath: "",
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
        const stored = (await this.plugin.loadData()) as Partial<StoredSettings> | null;
        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
        // Versions <= 1.2.0 kept a single GPG path in data.json, shared by every device syncing the vault
        const sharedExecPath = typeof stored?.pgpExecPath === "string" ? stored.pgpExecPath : undefined;
        if (sharedExecPath !== undefined) adoptSharedGpgPath(this.plugin.app, sharedExecPath);
        this.plugin.settings.pgpExecPath = resolveGpgPath(this.plugin.app);
        await this.migratePlainTextPassphrase();
        // Rewrite data.json once without the shared path (saveSettings never writes it)
        if (sharedExecPath !== undefined) await this.saveSettings();
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
        // The GPG path belongs to this device (local storage), so it never goes into the synced data.json
        const persisted: Partial<StoredSettings> = { ...this.plugin.settings };
        delete persisted.pgpExecPath;
        await this.plugin.saveData(persisted);
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
