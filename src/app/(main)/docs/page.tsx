"use client";

import { useEffect, useState } from "react";
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

interface WsConfig {
  wsUrl: string;
  token: string;
}

export default function DocsPage() {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [wsConfig, setWsConfig] = useState<WsConfig | null>(null);
  const [loadingTree, setLoadingTree] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);

  // Load WS config and file tree on mount
  useEffect(() => {
    // Fetch WS config (URL + token from server)
    fetch("/api/vault/ws-url")
      .then((res) => res.json())
      .then((data: { wsUrl: string; token: string }) => setWsConfig(data))
      .catch((err) => console.error("Failed to load WS config:", err));

    // Fetch file tree
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

  const handleSelectFile = (path: string) => {
    setSelectedPath(path);
  };

  const fileName = selectedPath
    ? selectedPath.split("/").pop()?.replace(/\.md$/, "") ?? selectedPath
    : null;

  // Derive a stable user identity from localStorage (anonymous until we have proper session user)
  const [userInfo, setUserInfo] = useState({ name: "Guest", id: "guest-0" });
  useEffect(() => {
    // In the future this could come from the session JWT
    // For now, use a stored anonymous ID
    const storedId = localStorage.getItem("vault-user-id");
    const storedName = localStorage.getItem("vault-user-name");
    if (storedId) {
      setUserInfo({ name: storedName || "Guest", id: storedId });
    } else {
      const newId = `user-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("vault-user-id", newId);
      localStorage.setItem("vault-user-name", "Guest");
      setUserInfo({ name: "Guest", id: newId });
    }
  }, []);

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
          {selectedPath && (
            <span className="ml-auto text-xs text-bisque-300 truncate hidden md:block">
              {selectedPath}
            </span>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden relative">
          {wsConfig ? (
            <VaultEditor
              filePath={selectedPath}
              wsUrl={wsConfig.wsUrl}
              wsToken={wsConfig.token}
              userName={userInfo.name}
              userId={userInfo.id}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-bisque-400 text-sm">
              {selectedPath ? "Connecting..." : "Select a file to start editing"}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
