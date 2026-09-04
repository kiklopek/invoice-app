"use client";

import { useEffect, useRef } from "react";
import { confirmAction } from "@/lib/confirm-action";

export function useUnsavedChanges(active: boolean) {
  const dialogOpen = useRef(false);

  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin || anchor.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      if (dialogOpen.current) return;
      dialogOpen.current = true;
      void confirmAction({
        title: "Opustit stránku bez uložení?",
        description: "Provedené změny ještě nejsou uložené a po odchodu se ztratí.",
        confirmLabel: "Opustit stránku",
      }).then((confirmed) => {
        dialogOpen.current = false;
        if (confirmed) window.location.assign(anchor.href);
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", navigate, true);
    };
  }, [active]);
}
