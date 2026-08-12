import Link from "next/link";
import ThemeToggle from "./theme-toggle";

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            L
          </span>
          <span className="brand-name">Last Min Prep</span>
        </Link>
        <div className="site-header-actions">
          <span className="site-header-tagline muted">AI-powered interview practice</span>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
