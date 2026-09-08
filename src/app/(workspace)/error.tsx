"use client";

import AppError from "../error";

export default function WorkspaceError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="content"><AppError {...props} /></div>;
}
