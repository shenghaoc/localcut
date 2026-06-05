/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface FileSystemFileHandle {
  getFile(): Promise<File>;
}

interface OpenFilePickerOptions {
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
  multiple?: boolean;
}

interface Window {
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
}
