/// <reference types="vite/client" />

declare module '*.json?raw' {
  const value: string;
  export default value;
}

interface HTMLInputElement {
  webkitdirectory: boolean;
}
