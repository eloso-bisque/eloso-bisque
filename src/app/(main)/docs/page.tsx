"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import VaultFileTree, { type FileNode } from "@/components/VaultFileTree";

// Dynamically import VaultEditor to avoid SSR issues with CodeMirror
const VaultEditor = dynamic(() => import("@/components/VaultEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-bisque-400 text-sm">
      Loading editor...
    </div>
  ),
});

export default function DocsPage() {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [loadingTree, setLoadingTree] = useState(true);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [treeError, setTreeError] = useState<string | null>(null);

  // Load file tree on mount
  useEffect(() => {
    setLoadingTree(true);
    fetch("/api/vault/files")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { tree: FileNode[] }) => {
        setTree(data.tree);
        setTreeError(null);
      })
      .catch((err) => {
        console.error("Failed to load vault tree:", err);
        setTreeError("Failed to load vault. Please refresh.");
      })
      .finally(() => setLoadingTree(false));
  }, []);

  // Load file when selected
  const handleSelectFile = useCallback((path: string) => {
    if (path === selectedPath) return;
    setSelectedPath(path);
    setLoadingFile(true);
    setSaveStatus("idle");

    fetch(`/api/vault/file?path=${encodeURIComponent(path)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { content: string }) => {
        setFileContent(data.content);
      })
      .catch((err) => {
        console.error("Failed to load file:", err);
        setFileContent(`# Error loading file\n\n${err.message}`);
      })
      .finally(() => setLoadingFile(false));
  }, [selectedPath]);

  // Save file handler (used by editor's debounced auto-save)
  const handleSave = useCallback(async (content: string) => {
    if (!selectedPath) return;
    setSaveStatus("saving");

    try {
      const res = await fetch("/api/vault/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath, content }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      console.error("Failed to save:", err);
      setSaveStatus("error");
    }
  }, [selectedPath]);

  const fileName = selectedPath
    ? selectedPath.split("/").pop()?.replace(/\.md$/, "") ?? selectedPath
    : null;

  return (
    <div className="flex h-[calc(100vh-120px)] gap-0 -m-4 md:-m-6 mt-0 md:mt-0">
      {/* Sidebar: file tree */}
      <aside className="w-64 min-w-48 max-w-80 flex-shrink-0 border-r border-bisque-200 bg-bisque-50 flex flex-col">
        <div className="px-3 py-3 border-b border-bisque-200">
          <h2 className="text-sm font-semibold text-bisque-700">Vault</h2>
        </div>
        <div className="flex-1 overflow-hidden">
          {loadingTree ? (
            <div className="flex items-center justify-center h-20 text-bisque-400 text-sm">
              Loading...
            </div>
          ) : treeError ? (
            <div className="p-3 text-red-500 text-sm">{treeError}</div>
          ) : (
            <VaultFileTree
              tree={tree}
              selectedPath={selectedPath}
              onSelect={handleSelectFile}
            />
          )}
        </div>
      </aside>

      {/* Main editor area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Editor header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-bisque-200 bg-white min-h-[44px]">
          {fileName ? (
            <h1 className="text-sm font-medium text-bisque-800 truncate">{fileName}</h1>
          ) : (
            <span className="text-sm text-bisque-400">No file selected</span>
          )}
          {saveStatus === "saving" && (
            <span className="ml-auto text-xs text-bisque-400">Saving...</span>
          )}
          {saveStatus === "saved" && (
            <span className="ml-auto text-xs text-green-500">Saved</span>
          )}
          {saveStatus === "error" && (
            <span className="ml-auto text-xs text-red-500">Save failed</span>
          )}
          {selectedPath && (
            <span className="ml-auto text-xs text-bisque-300 truncate hidden md:block">
              {selectedPath}
            </span>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden relative">
          {loadingFile ? (
            <div className="flex items-center justify-center h-full text-bisque-400 text-sm">
              Loading file...
            </div>
          ) : (
            <VaultEditor
              content={fileContent}
              filePath={selectedPath}
              readOnly={false}
              onSave={handleSave}
            />
          )}
        </div>
      </main>
    </div>
  );
}
