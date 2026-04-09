"use client";

import EnrichButton from "@/components/EnrichButton";

/**
 * Mobile-only full-width Enrich button section, shown at the bottom of the
 * contact header card on small screens. Desktop shows the inline EnrichButton.
 */
export default function MobileEnrichSection({ contactId }: { contactId: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-bisque-400 font-medium uppercase tracking-wide">
        Enrich Contact
      </p>
      {/* Full-width wrapper — EnrichButton's internal button gets the sizing */}
      <div className="[&_button]:w-full [&_button]:justify-center [&_button]:py-3 [&_button]:text-base [&_button]:min-h-[48px]">
        <EnrichButton contactId={contactId} />
      </div>
    </div>
  );
}
