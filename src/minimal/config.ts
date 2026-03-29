// ---------------------------------------------------------------------------
// Centralized API configuration
//
// Change the base URL and endpoints here — all plugins read from this config.
// ---------------------------------------------------------------------------

export const API_CONFIG = {
  /** Base URL for all backend API calls */
  baseUrl: 'http://localhost:7145',

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
} as const;

/** Build a full URL from an endpoint key */
export function apiUrl(endpoint: keyof typeof API_CONFIG.endpoints): string {
  return `${API_CONFIG.baseUrl}${API_CONFIG.endpoints[endpoint]}`;
}
