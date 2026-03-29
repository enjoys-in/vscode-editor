// ---------------------------------------------------------------------------
// Example: Virtual Project Plugin (File System)
//
// Demonstrates:
//   - Registering a virtual file system with initial files
//   - Auto-opening files in the editor
//   - Dynamically adding files at runtime
//   - Command to create new virtual files
// ---------------------------------------------------------------------------

import { definePlugin } from '@core/define-plugin';

export default definePlugin({
  id: 'example.virtual-project',
  name: 'Virtual Project',

  commands: [
    {
      id: 'virtualProject.newFile',
      title: 'Create Virtual File',
      category: 'Virtual Project',
      async handler(ctx) {
        const name = await ctx.vscode.window.showInputBox({
          prompt: 'File name (e.g. utils.ts)',
          placeHolder: 'filename.ext',
        });
        if (!name) return;

        const content = await ctx.vscode.window.showInputBox({
          prompt: 'Initial content (optional)',
          placeHolder: '// your code here',
        }) ?? '';

        const path = `/project/${name}`;
        const fs = ctx.services.get<any>('fileSystem:example.virtual-project');
        fs?.addFile(path, content);

        // Open the newly created file
        const uri = ctx.vscode.Uri.file(path);
        await ctx.vscode.window.showTextDocument(uri);
        ctx.vscode.window.showInformationMessage(`Created ${path}`);
      },
    },
    {
      id: 'virtualProject.loadFromUrl',
      title: 'Load File from URL',
      category: 'Virtual Project',
      async handler(ctx) {
        const url = await ctx.vscode.window.showInputBox({
          prompt: 'URL to fetch',
          placeHolder: 'https://example.com/file.json',
        });
        if (!url) return;

        try {
          const resp = await fetch(url);
          const text = await resp.text();
          const filename = url.split('/').pop() ?? 'downloaded.txt';

          const fs = ctx.services.get<any>('fileSystem:example.virtual-project');
          fs?.addFile(`/project/${filename}`, text);

          const uri = ctx.vscode.Uri.file(`/project/${filename}`);
          await ctx.vscode.window.showTextDocument(uri);
        } catch (err: any) {
          ctx.vscode.window.showErrorMessage(`Failed to fetch: ${err.message}`);
        }
      },
    },
  ],

  // --- Virtual file system with initial files ---
  fileSystem: {
    readOnly: false,
    priority: 3,
    files: [
      {
        path: '/project/index.ts',
        content: `import { greet } from './utils';

console.log(greet('WebTerminal'));
`,
      },
      {
        path: '/project/utils.ts',
        content: `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
`,
      },
      {
        path: '/project/README.md',
        content: `# Virtual Project

This project lives entirely in memory.
Use "Create Virtual File" to add more files.
`,
      },
    ],
    // Auto-open these in editor tabs
    openFiles: ['/project/index.ts'],
  },

  statusBar: [
    {
      id: 'virtualProject.status',
      text: '$(file-directory) Virtual Project',
      tooltip: 'Create a new virtual file',
      command: 'virtualProject.newFile',
      alignment: 'left',
      priority: 200,
    },
  ],
});
