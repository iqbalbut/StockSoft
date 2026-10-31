"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Home", icon: "M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
  { href: "/review", label: "Review", icon: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" },
  { href: "/capture", label: "Capture", icon: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
  { href: "/documents", label: "Records", icon: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" },
  { href: "/upload", label: "Upload", icon: "M12 16V4m0 0-4 4m4-4 4 4M4 16v4h16v-4" },
];

export const MORE = [
  { href: "/payables", label: "Bills", icon: "" },
  { href: "/invoices", label: "Invoices", icon: "" },
  { href: "/bank", label: "Bank", icon: "" },
  { href: "/reports", label: "Reports", icon: "" },
  { href: "/clients", label: "Clients", icon: "" },
  { href: "/rules", label: "Rules", icon: "" },
  { href: "/ledger", label: "Ledger", icon: "" },
  { href: "/settings", label: "Settings", icon: "" },
];

export function NavLinks({ reviewCount, variant }: { reviewCount: number; variant: "top" | "bottom" }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  if (variant === "top") {
    return (
      <>
        {[...ITEMS, ...MORE].map((i) => (
          <Link key={i.href} href={i.href} className={`rounded-lg px-3 py-1.5 ${active(i.href) ? "bg-brand-500/10 text-brand-600 dark:text-brand-100" : "muted hover:text-[var(--ink)]"}`}>
            {i.label}
            {i.href === "/review" && reviewCount > 0 && <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-xs text-white">{reviewCount}</span>}
          </Link>
        ))}
      </>
    );
  }
  return (
    <>
      {ITEMS.map((i) => {
        const center = i.href === "/capture";
        return (
          <Link key={i.href} href={i.href} className="relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium">
            <span className={center ? "grid h-11 w-11 -mt-5 place-items-center rounded-full bg-brand-600 text-white shadow-lg" : active(i.href) ? "text-brand-600 dark:text-brand-100" : "muted"}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d={i.icon} />
              </svg>
            </span>
            <span className={active(i.href) ? "" : "muted"}>{i.label}</span>
            {i.href === "/review" && reviewCount > 0 && (
              <span className="absolute right-3 top-1 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{reviewCount}</span>
            )}
          </Link>
        );
      })}
    </>
  );
}
