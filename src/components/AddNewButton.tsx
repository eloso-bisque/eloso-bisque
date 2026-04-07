"use client";

import { useState } from "react";
import AddContactModal from "./AddContactModal";

interface AddNewButtonProps {
  defaultKind?: "person" | "org";
}

export default function AddNewButton({ defaultKind = "person" }: AddNewButtonProps) {
  const [open, setOpen] = useState(false);

  const handleSuccess = () => {
    // Reload the page to reflect the new contact
    window.location.reload();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-bisque-700 text-bisque-50 rounded-lg text-sm font-medium hover:bg-bisque-600 transition-colors flex items-center gap-1.5"
      >
        <span className="text-lg leading-none">+</span>
        Add New
      </button>
      <AddContactModal
        isOpen={open}
        onClose={() => setOpen(false)}
        onSuccess={handleSuccess}
        defaultKind={defaultKind}
      />
    </>
  );
}
