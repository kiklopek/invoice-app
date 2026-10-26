"use client";

import { useEffect, useState } from "react";

export function MatchingNotice({ message, className }: { message: string; className: string }) {
  return <TimedNotice key={message} message={message} className={className} />;
}

function TimedNotice({ message, className }: { message: string; className: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);
  return visible ? <p className={className} role="status">{message}</p> : null;
}
