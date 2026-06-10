"use client";

import { useState } from "react";

export interface FileNode {
  type: "file" | "directory";
  name: string;
  path: string;
  children?: FileNode[];
}

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

function FileTreeNode({ node, depth, selectedPath, onSelect }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isSelected = node.type === "file" && selectedPath === node.path;

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 w-full text-left px-2 py-1 text-sm hover:bg-bisque-100 rounded transition-colors"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <span className="text-bisque-500 text-xs">{expanded ? "▾" : "▸"}</span>
          <span className="font-medium text-bisque-700 truncate">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex items-center gap-1 w-full text-left px-2 py-1 text-sm rounded transition-colors truncate ${
        isSelected
          ? "bg-bisque-600 text-white"
          : "hover:bg-bisque-100 text-bisque-800"
      }`}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      title={node.name}
    >
      <span className="text-xs opacity-60">📄</span>
      <span className="truncate">{node.name.replace(/\.md$/, "")}</span>
    </button>
  );
}

interface VaultFileTreeProps {
  tree: FileNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export default function VaultFileTree({ tree, selectedPath, onSelect }: VaultFileTreeProps) {
  return (
    <div className="overflow-y-auto h-full py-2">
      {tree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
