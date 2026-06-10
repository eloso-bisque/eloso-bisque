"use client";

import { useEffect, useRef, useCallback } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";

interface VaultEditorProps {
  content: string;
  filePath: string | null;
  readOnly?: boolean;
  onSave?: (content: string) => void;
}

export default function VaultEditor({ content, filePath, readOnly = false, onSave }: VaultEditorProps) {
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (newContent: string) => {
      if (!onSave || readOnly) return;
      // Debounced auto-save: 1.5s after last keystroke
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        onSave(newContent);
      }, 1500);
    },
    [onSave, readOnly]
  );

  useEffect(() => {
    if (!editorContainerRef.current) return;

    // Destroy old view if exists
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }

    const extensions = [
      basicSetup,
      markdown(),
      oneDark,
      EditorView.lineWrapping,
    ];

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
    } else {
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            handleChange(update.state.doc.toString());
          }
        })
      );
    }

    const state = EditorState.create({
      doc: content,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorContainerRef.current,
    });

    viewRef.current = view;

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      view.destroy();
      viewRef.current = null;
    };
  // We intentionally only re-create the editor when the file or readOnly mode changes.
  // Content changes are handled by the updateListener extension.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, readOnly]);

  // When content prop changes (new file loaded), update the document
  useEffect(() => {
    if (!viewRef.current) return;
    const currentContent = viewRef.current.state.doc.toString();
    if (currentContent !== content) {
      viewRef.current.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
      });
    }
  }, [content]);

  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full text-bisque-400 text-sm">
        Select a file from the sidebar to view it
      </div>
    );
  }

  return (
    <div
      ref={editorContainerRef}
      className="h-full overflow-auto"
      style={{ fontSize: "14px" }}
    />
  );
}
