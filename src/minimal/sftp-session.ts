// ---------------------------------------------------------------------------
// Active SFTP session — shared, in-memory credentials for the current SSH/SFTP
// connection. Populated when the user connects (see the workspace plugin) and
// read by the terminal backend so a new terminal reuses the same credentials
// instead of opening a fresh SSH connection.
//
// Credentials are kept in memory only (never written to disk) — after a reload
// the terminal reconnects using the URL `sessionId`, which the backend resolves
// to the stored session server-side.
// ---------------------------------------------------------------------------

export interface SftpCredentials {
  bridgeUrl?: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

let current: SftpCredentials | null = null;

export function setSftpCredentials(creds: SftpCredentials | null): void {
  current = creds;
}

export function getSftpCredentials(): SftpCredentials | null {
  return current;
}

/** Session id from the URL, matching the SFTP / file-reader convention. */
export function getSessionId(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('tabId') || params.get('sessionId') || '';
}
