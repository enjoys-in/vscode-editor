# Terminus Editor — Setup Guide

Terminus is a browser-based code editor built on Monaco + VS Code API.  
It comes in two modes: **Minimal** (deployed to Vercel) and **Full** (local dev with terminal, extensions, etc.).

---

## Quick Start

```bash
# Install dependencies
npm install

# Dev server (both modes)
npm run dev

# Dev server (minimal only - opens /minimal.html)
npm run dev:minimal
```

Open:
- `http://localhost:5173/` → Full editor
- `http://localhost:5173/minimal.html?tabId=SESSION&path=/remote/dir&host=myserver` → Minimal editor

---

## Build

```bash
# Build minimal (for Vercel deployment)
npm run build:minimal

# Build full (all features)
npm run build:full

# Build both
npm run build
```

Output goes to `dist/`.

---

## Project Structure

```
src/
  core/              Shared kernel — plugin system, types, registries
    define-plugin.ts   Developer-friendly plugin builder
    types.ts           Plugin, PluginContext, Disposable, etc.
    plugin-registry.ts Plugin lifecycle management
    ...

  full/              Full editor mode
    main.ts            Entry point (index.html)
    app.ts             App class — registers plugins, boots workbench
    setup.ts           Monaco services, workers, lazy language loader
    user/              Default configuration.json + keybindings.json

  minimal/           Minimal editor mode (Vercel deployment)
    main.ts            Entry point (minimal.html)
    app.ts             MinimalApp class
    setup.ts           Stripped-down services, no terminal/markers/output
    config.ts          API base URL (reads VITE_API_BASE_URL env var)
    api-file-reader.ts REST + Socket.IO file operations
    language-loader.ts Lazy grammar + language features loader
    sftp-socket.ts     Socket.IO SFTP client
    user/              Default configuration.json + keybindings.json

  plugins/           Shared plugins (used by both modes)
    ai-completion/     AI inline suggestions (SSE streaming)
    ai-chat/           AI chat sidebar (webview)
    account/           SFTP connections sidebar (tree view)
    workspace/         File system, explorer, SFTP
    lsp/               Language Server Protocol via WebSocket
    theme/             Runtime theme/config changes
    keybindings/       Default keybinding registration
    examples/          Example plugins (word-count, bookmarks, etc.)

  ui/
    styles.css         Shared CSS
```

---

## Minimal vs Full Comparison

| Feature | Minimal | Full |
|---------|---------|------|
| Terminal | No | Yes |
| Extension host worker | No | Yes |
| Extension gallery (Open VSX) | Yes (install only) | Yes (full) |
| Markers panel | No | Yes |
| Output panel | No | Yes |
| Preferences editor | No | Yes |
| Outline panel | No | Yes |
| Chat/AI service | No | Yes |
| Workspace trust | No | Yes |
| Lazy language loading | Yes (40+ languages) | Yes (40+ languages) |
| SFTP file reader | Yes | Via plugin |
| Deployed to Vercel | Yes | No (local) |

---

## Environment Variables

Set in Vercel project settings or `.env` file:

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_BASE_URL` | Backend API base URL | `http://localhost:7145` |

---

## URL Query Parameters (Minimal mode)

| Param | Required | Description |
|-------|----------|-------------|
| `tabId` or `sessionId` | Yes | SFTP session ID from backend |
| `path` | Yes | Remote file or directory path |
| `host` | No | Server hostname (shown in branding) |
| `user` | No | Username (for display) |
