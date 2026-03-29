// ---------------------------------------------------------------------------
// Connection Profile Storage — localStorage
// ---------------------------------------------------------------------------

const PROFILES_KEY = 'webterminal:profiles';

export interface ConnectionProfile {
  id: string;
  label: string;
  bridgeUrl: string;
  host: string;
  port: number;
  username: string;
  /** Plain-text password (optional — prompted at connect if missing) */
  password?: string;
  /** Whether to use private key auth instead */
  usePrivateKey?: boolean;
  createdAt: number;
}

export class ConnectionStorage {
  getProfiles(): ConnectionProfile[] {
    try {
      return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]');
    } catch {
      return [];
    }
  }

  private saveProfiles(profiles: ConnectionProfile[]): void {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  }

  addProfile(profile: {
    label: string;
    bridgeUrl: string;
    host: string;
    port?: number;
    username: string;
    password?: string;
    usePrivateKey?: boolean;
  }): ConnectionProfile {
    const entry: ConnectionProfile = {
      id: crypto.randomUUID(),
      label: profile.label,
      bridgeUrl: profile.bridgeUrl,
      host: profile.host,
      port: profile.port ?? 22,
      username: profile.username,
      password: profile.password,
      usePrivateKey: profile.usePrivateKey,
      createdAt: Date.now(),
    };

    const profiles = this.getProfiles();
    profiles.push(entry);
    this.saveProfiles(profiles);
    return entry;
  }

  deleteProfile(id: string): boolean {
    const profiles = this.getProfiles();
    const idx = profiles.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    profiles.splice(idx, 1);
    this.saveProfiles(profiles);
    return true;
  }
}
