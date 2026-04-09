"use client";

import { useState } from "react";
import AddContactModal from "./AddContactModal";
import BulkAddModal from "./BulkAddModal";

interface AddNewButtonProps {
  defaultKind?: "person" | "org";
}

export default function AddNewButton({ defaultKind = "person" }: AddNewButtonProps) {
  const [singleOpen, setSingleOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const handleSuccess = () => {
    // Reload the page to reflect the new contact(s)
    window.location.reload();
  };

  const handleBulkSuccess = (_count: number) => {
    // Reload after bulk import so the contacts list refreshes
    window.location.reload();
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSingleOpen(true)}
          className="px-4 py-2 bg-bisque-700 text-bisque-50 rounded-lg text-sm font-medium hover:bg-bisque-600 transition-colors flex items-center gap-1.5"
        >
          <span className="text-lg leading-none">+</span>
          Add New
        </button>
        <button
          type="button"
          onClick={() => setBulkOpen(true)}
          className="px-4 py-2 bg-bisque-100 text-bisque-800 rounded-lg text-sm font-medium hover:bg-bisque-200 transition-colors flex items-center gap-1.5"
          title="Import multiple contacts from CSV"
        >
          <span className="text-base leading-none">⬆</span>
          Bulk Add
        </button>
      </div>

      <AddContactModal
        isOpen={singleOpen}
        onClose={() => setSingleOpen(false)}
        onSuccess={handleSuccess}
        defaultKind={defaultKind}
      />

      <BulkAddModal
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onSuccess={handleBulkSuccess}
      />
    </>
  );
}
