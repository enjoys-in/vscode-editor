// ---------------------------------------------------------------------------
// Account Storage — localStorage + Web Crypto API
//
// - User passwords are hashed with PBKDF2 (never stored in plaintext)
// - SFTP connection passwords are encrypted with AES-GCM using a key
//   derived from the user's password (only decryptable while logged in)
// - Accounts and profiles are stored in localStorage
// ---------------------------------------------------------------------------

const ACCOUNTS_KEY = 'webterminal:accounts';
const PROFILES_KEY = 'webterminal:profiles';

export interface UserAccount {
  username: string;
  /** PBKDF2 hash of password (base64) */
  passwordHash: string;
  /** Salt used for PBKDF2 (base64) */
  salt: string;
  createdAt: number;
}

export interface ConnectionProfile {
  id: string;
  /** Owner username */
  owner: string;
  label: string;
  bridgeUrl: string;
  host: string;
  port: number;
  username: string;
  /** AES-GCM encrypted password (base64), null if using key-based auth */
  encryptedPassword?: string;
  /** AES-GCM IV used for encryption (base64) */
  iv?: string;
  /** Whether to use private key auth instead */
  usePrivateKey?: boolean;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await deriveKey(password, salt);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    ),
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

async function encryptString(plaintext: string, password: string, salt: Uint8Array): Promise<{ ciphertext: string; iv: string }> {
  const key = await deriveKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded,
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

async function decryptString(ciphertext: string, iv: string, password: string, salt: Uint8Array): Promise<string> {
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) },
    key,
    base64ToBytes(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Account Storage class
// ---------------------------------------------------------------------------

export class AccountStorage {
  private sessionPassword: string | null = null;
  private sessionUser: UserAccount | null = null;

  // ----- Account CRUD -----

  getAccounts(): UserAccount[] {
    try {
      return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
    } catch {
      return [];
    }
  }

  private saveAccounts(accounts: UserAccount[]): void {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }

  async register(username: string, password: string): Promise<boolean> {
    const accounts = this.getAccounts();
    if (accounts.some((a) => a.username === username)) {
      return false; // username taken
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordHash = await hashPassword(password, salt);
    accounts.push({
      username,
      passwordHash,
      salt: bytesToBase64(salt),
      createdAt: Date.now(),
    });
    this.saveAccounts(accounts);
    return true;
  }

  async login(username: string, password: string): Promise<boolean> {
    const accounts = this.getAccounts();
    const account = accounts.find((a) => a.username === username);
    if (!account) return false;

    const salt = base64ToBytes(account.salt);
    const hash = await hashPassword(password, salt);
    if (hash !== account.passwordHash) return false;

    this.sessionUser = account;
    this.sessionPassword = password;
    return true;
  }

  logout(): void {
    this.sessionUser = null;
    this.sessionPassword = null;
  }

  get currentUser(): string | null {
    return this.sessionUser?.username ?? null;
  }

  get isLoggedIn(): boolean {
    return this.sessionUser !== null;
  }

  // ----- Connection Profiles -----

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

  getUserProfiles(): ConnectionProfile[] {
    if (!this.sessionUser) return [];
    return this.getProfiles().filter((p) => p.owner === this.sessionUser!.username);
  }

  async addProfile(profile: {
    label: string;
    bridgeUrl: string;
    host: string;
    port?: number;
    username: string;
    password?: string;
    usePrivateKey?: boolean;
  }): Promise<ConnectionProfile | null> {
    if (!this.sessionUser || !this.sessionPassword) return null;

    const salt = base64ToBytes(this.sessionUser.salt);
    let encryptedPassword: string | undefined;
    let iv: string | undefined;

    if (profile.password) {
      const encrypted = await encryptString(profile.password, this.sessionPassword, salt);
      encryptedPassword = encrypted.ciphertext;
      iv = encrypted.iv;
    }

    const entry: ConnectionProfile = {
      id: crypto.randomUUID(),
      owner: this.sessionUser.username,
      label: profile.label,
      bridgeUrl: profile.bridgeUrl,
      host: profile.host,
      port: profile.port ?? 22,
      username: profile.username,
      encryptedPassword,
      iv,
      usePrivateKey: profile.usePrivateKey,
      createdAt: Date.now(),
    };

    const profiles = this.getProfiles();
    profiles.push(entry);
    this.saveProfiles(profiles);
    return entry;
  }

  async getProfilePassword(profile: ConnectionProfile): Promise<string | undefined> {
    if (!this.sessionUser || !this.sessionPassword) return undefined;
    if (!profile.encryptedPassword || !profile.iv) return undefined;

    const salt = base64ToBytes(this.sessionUser.salt);
    return decryptString(profile.encryptedPassword, profile.iv, this.sessionPassword, salt);
  }

  addProfileSimple(profile: {
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
      owner: 'local',
      label: profile.label,
      bridgeUrl: profile.bridgeUrl,
      host: profile.host,
      port: profile.port ?? 22,
      username: profile.username,
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
