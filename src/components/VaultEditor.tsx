"use client";

import { useEffect, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { yCollab } from "y-codemirror.next";

// Deterministic color from user ID (hash-based)
function hashColor(userId: string): { color: string; colorLight: string } {
  const palette = [
    { color: "#30bced", colorLight: "#30bced33" },
    { color: "#6eeb83", colorLight: "#6eeb8333" },
    { color: "#ffbc42", colorLight: "#ffbc4233" },
    { color: "#ecd444", colorLight: "#ecd44433" },
    { color: "#ee6352", colorLight: "#ee635233" },
    { color: "#9ac2c9", colorLight: "#9ac2c933" },
    { color: "#8acb88", colorLight: "#8acb8833" },
    { color: "#1be7ff", colorLight: "#1be7ff33" },
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

interface VaultEditorProps {
  filePath: string | null;
  wsUrl: string;
  wsToken: string;
  userName: string;
  userId: string;
}

export default function VaultEditor({
  filePath,
  wsUrl,
  wsToken,
  userName,
  userId,
}: VaultEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const docRef = useRef<Y.Doc | null>(null);

  useEffect(() => {
    if (!containerRef.current || !filePath) return;

    // Cleanup previous session
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }
    if (providerRef.current) {
      providerRef.current.destroy();
      providerRef.current = null;
    }
    if (docRef.current) {
      docRef.current.destroy();
      docRef.current = null;
    }

    // Create Yjs doc
    const ydoc = new Y.Doc();
    docRef.current = ydoc;

    // Encode file path as URL-safe room name
    // y-websocket appends the roomname to the serverUrl to form the full WS URL
    const pathSegments = filePath.split("/").map(encodeURIComponent).join("/");

    // Create WebSocket provider
    // serverUrl = base WS URL (e.g. wss://...vault-ws)
    // roomname = the file path (used as the room)
    // params = { token } — passed as query string by y-websocket
    const provider = new WebsocketProvider(wsUrl, pathSegments, ydoc, {
      params: { token: wsToken },
    });
    providerRef.current = provider;

    // Set awareness (user info for floating cursors)
    const userColor = hashColor(userId);
    provider.awareness.setLocalStateField("user", {
      name: userName,
      color: userColor.color,
      colorLight: userColor.colorLight,
    });

    // Get the shared Y.Text
    const ytext = ydoc.getText("content");

    // Create undo manager scoped to this text
    const undoManager = new Y.UndoManager(ytext);

    // Build CodeMirror state with Yjs binding
    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        basicSetup,
        markdown(),
        oneDark,
        EditorView.lineWrapping,
        yCollab(ytext, provider.awareness, { undoManager }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    // Connection status indicator
    provider.on("status", (event: { status: string }) => {
      console.log(`[vault-ws] ${filePath}: ${event.status}`);
    });

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
      if (providerRef.current) {
        providerRef.current.destroy();
        providerRef.current = null;
      }
      if (docRef.current) {
        docRef.current.destroy();
        docRef.current = null;
      }
    };
  }, [filePath, wsUrl, wsToken, userName, userId]);

  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-bisque-400 text-sm">
        Select a file from the sidebar to view it
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto"
      style={{ fontSize: "14px" }}
    />
  );
}
