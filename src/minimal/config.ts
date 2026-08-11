// ---------------------------------------------------------------------------
// Centralized API configuration
//
// Change the base URL and endpoints here — all plugins read from this config.
// ---------------------------------------------------------------------------

export const API_CONFIG = {
  /** Base URL for all backend API calls */
  baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:7145',

  /** Endpoints (relative to baseUrl) */
  endpoints: {
    // AI inline completion (SSE stream)
    aiStream: '/api/stream',

    // AI chat (SSE stream)
    aiChat: '/api/chat',

    // AI providers list
    aiProviders: '/api/ai/providers',

    // File operations
    fileRead: '/api/file/read',
    fileWrite: '/api/file/write',
    fileList: '/api/files',
  },

  /** Socket.IO namespace for SFTP */
  sftpNamespace: '/sftp',

  /** Socket.IO namespace for the integrated terminal (pty) */
  terminalNamespace: '/terminal',
} as const;

/** Build a full URL from an endpoint key */
export function apiUrl(endpoint: keyof typeof API_CONFIG.endpoints): string {
  return `${API_CONFIG.baseUrl}${API_CONFIG.endpoints[endpoint]}`;
}

// ---------------------------------------------------------------------------
// Environment gating
// ---------------------------------------------------------------------------

/** App environment from .env (VITE_APP_ENV). Defaults to production. */
export const APP_ENV = String(import.meta.env.VITE_APP_ENV ?? 'prod');

/**
 * Dev mode disables the session/param entry checks so the editor can be opened
 * without a `tabId`/`path`. Default (prod) enforces a valid, existing session.
 */
export const IS_DEV = APP_ENV.toUpperCase() === 'DEV';
