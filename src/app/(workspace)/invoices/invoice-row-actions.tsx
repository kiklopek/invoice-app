"use client";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { invoiceDate } from "./invoice-list-presentation";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import type { Invoice } from "@/types/invoice";
import styles from "./invoices.module.css";
export function InvoiceRowActions({
  invoice,
  canManage,
  onConfirm,
}: {
  invoice: Invoice;
  canManage: boolean;
  onConfirm: (invoice: Invoice) => void;
}) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    id = useId();
  const { showToast } = useToast();
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect(),
      menu = panel.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        12,
        Math.min(
          anchor.right - menu.width,
          window.innerWidth - menu.width - 12,
        ),
      ),
      top: Math.max(
        12,
        anchor.bottom + menu.height + 6 <= window.innerHeight - 12
          ? anchor.bottom + 6
          : anchor.top - menu.height - 6,
      ),
    });
    panel.current.querySelector<HTMLElement>("a,button")?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      showToast({ variant: "success", message: "Zkopírováno do schránky." });
      setOpen(false);
    } catch {
      showToast({
        variant: "error",
        message: "Text se nepodařilo zkopírovat.",
      });
    }
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.moreButton}
        aria-label={`Akce faktury ${invoice.invoice_number}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              id={id}
              className={styles.rowMenu}
              role="dialog"
              aria-label={`Akce faktury ${invoice.invoice_number}`}
              style={position}
              onBlur={(event) => {
                if (
                  event.relatedTarget &&
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  setOpen(false);
              }}
            >
              <small className={styles.menuNote}>Vystaveno {invoiceDate(invoice.issue_date)}</small>
              <Link href={`/invoices/${invoice.id}`}>Otevřít detail</Link>
              {canManage &&
              (invoice.status === "pending" || invoice.status === "overdue") ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onConfirm(invoice);
                  }}
                >
                  Potvrdit úhradu
                </button>
              ) : null}
              <Link href={`/invoices/${invoice.id}#invoice-payments`}>
                Platby a úhrady
              </Link>
              <Link href={`/invoices/${invoice.id}#invoice-reminders`}>
                Upomínky ({invoice.reminders_sent})
              </Link>
              <button
                type="button"
                onClick={() => void copy(invoice.invoice_number)}
              >
                Zkopírovat číslo faktury
              </button>
              {invoice.variable_symbol ? (
                <button
                  type="button"
                  onClick={() => void copy(invoice.variable_symbol!)}
                >
                  Zkopírovat variabilní symbol
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
