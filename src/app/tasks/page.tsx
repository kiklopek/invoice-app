"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppFrame } from "@/components/app-sidebar";
import { Icon } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import type { TodayTasksResponse } from "@/types/today-tasks";

export default function TasksPage() {
  const [data, setData] = useState<TodayTasksResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<TodayTasksResponse>("/api/tasks", { signal: controller.signal })
      .then(setData)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Úkoly se nepodařilo načíst.");
      });
    return () => controller.abort();
  }, []);

  return <AppFrame invoiceCount={data?.groups.find((group) => group.key === "overdue")?.count}>
    <header className="section-header"><div><p>PRACOVNÍ FRONTA</p><h1>Úkoly dnes</h1><span>Všechny provozní výjimky na jednom místě, seřazené podle toho, co vyžaduje zásah.</span></div></header>
    <div aria-live="polite" aria-atomic="true">
      {error ? <p className="form-error" role="alert">{error} <button type="button" className="link-button" onClick={() => window.location.reload()}>Zkusit znovu</button></p> : null}
      {!data && !error ? <p className="page-state">Načítám dnešní úkoly…</p> : null}
      {data ? <>
        <section className={`page-panel tasks-summary ${data.total ? "has-failures" : ""}`}>
          <span className="metric-icon amber"><Icon name={data.total ? "alert" : "check"} /></span>
          <div><strong>{data.total ? `${data.total} úkolů vyžaduje pozornost` : "Vše je vyřízené"}</strong><p>{data.total ? "Otevřete položku a pokračujte rovnou k nápravě." : "Aplikace nyní neeviduje žádnou provozní výjimku."}</p></div>
        </section>
        <section className="tasks-grid">
          {data.groups.map((group) => <article className={`page-panel task-group ${group.count ? "has-tasks" : ""}`} key={group.key}>
            <header><div><h2>{group.label}</h2><p>{group.description}</p></div><strong>{group.count}</strong></header>
            <div className="task-list">
              {group.items.map((item) => <Link href={item.href} key={item.id}><span><strong>{item.title}</strong><small>{item.detail}</small></span><b aria-hidden="true">→</b></Link>)}
              {!group.count ? <p className="page-state success-state">Bez úkolů.</p> : null}
              {group.count > group.items.length ? <small className="tasks-more">A dalších {group.count - group.items.length} položek.</small> : null}
            </div>
          </article>)}
        </section>
      </> : null}
    </div>
  </AppFrame>;
}
