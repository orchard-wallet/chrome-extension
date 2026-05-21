import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Tone = "neutral" | "ready" | "warning" | "danger";

export function Surface({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`ow-surface ${className}`.trim()} {...props} />;
}

export function Widget({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`ow-widget ${className}`.trim()} {...props} />;
}

export function HeroWidget({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`ow-hero-widget ${className}`.trim()} {...props} />;
}

export function IconButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`ow-icon-button ${className}`.trim()} {...props} />;
}

export function PrimaryButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`ow-primary-button ${className}`.trim()} {...props} />;
}

export function GradientButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={`ow-gradient-button ${className}`.trim()} {...props} />;
}

export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`ow-status-badge ${tone}`}>{children}</span>;
}

export function TokenIcon({ symbol }: { symbol: string }) {
  return (
    <span className="ow-token-icon" aria-hidden="true">
      {symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function ChainIcon({ symbol }: { symbol: string }) {
  return (
    <span className="ow-chain-icon" aria-hidden="true">
      {symbol.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function CompactExtensionShell({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <main className={`ow-compact-shell ${className}`.trim()} {...props} />;
}

export function DesktopSidebarShell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return (
    <main className="ow-desktop-shell">
      <aside>{sidebar}</aside>
      <div>{children}</div>
    </main>
  );
}

export function WidgetGrid({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`ow-widget-grid ${className}`.trim()} {...props} />;
}

export function SheetContainer({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`ow-sheet ${className}`.trim()} {...props} />;
}
