'use client';

import * as React from 'react';
import { useTheme } from 'next-themes';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useInsightStore, type ViewId } from '@/lib/insightiq/store';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  UploadCloud,
  ChartColumnBig,
  Sparkles,
  GitCompareArrows,
  MessageSquareText,
  ImageIcon,
  Moon,
  Sun,
  Menu,
  X,
} from 'lucide-react';

const NAV: { id: ViewId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'upload', label: 'Upload', icon: UploadCloud },
  { id: 'analyze', label: 'Analyze', icon: ChartColumnBig },
  { id: 'clean', label: 'Clean', icon: Sparkles },
  { id: 'compare', label: 'Compare', icon: GitCompareArrows },
  { id: 'chat', label: 'Chat', icon: MessageSquareText },
  { id: 'media', label: 'Media', icon: ImageIcon },
];

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { view, setView, files } = useInsightStore();
  const mediaCount = files.filter((f) => f.category === 'IMAGE' || f.category === 'VIDEO').length;
  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-1">
      {NAV.map(({ id, label, icon: Icon }) => {
        const badge = id === 'media' && mediaCount > 0 ? mediaCount : null;
        return (
          <button
            key={id}
            onClick={() => {
              setView(id);
              onNavigate?.();
            }}
            aria-current={view === id ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[44px]',
              view === id
                ? 'bg-secondary text-foreground shadow-[inset_2px_0_0_0_var(--primary)]'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', view === id ? 'text-primary' : 'text-muted-foreground group-hover:text-primary')} />
            <span className="flex-1 text-left">{label}</span>
            {badge ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{badge}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 rotate-6 items-center justify-center rounded-lg border-2 border-primary text-sm font-bold text-primary shadow-sm">
        IQ
      </div>
      <div>
        <p className="text-sm font-bold leading-4 tracking-tight">InsightIQ</p>
        <p className="text-[11px] text-muted-foreground">AI-assisted analytics</p>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Toggle theme"
      className="rounded-lg"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {mounted && theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { files } = useInsightStore();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-lg md:hidden" aria-label="Open navigation">
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-4">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="mb-4 flex items-center justify-between">
                <BrandMark />
                <Button variant="ghost" size="icon" className="rounded-lg" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <NavItems onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <BrandMark />

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground sm:inline-flex">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 dot-live" aria-hidden />
              {files.length} dataset{files.length === 1 ? '' : 's'} loaded
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-6 px-4 py-6 sm:px-6">
        {/* Desktop sidebar */}
        <aside className="sticky top-20 hidden h-fit w-56 shrink-0 rounded-xl border bg-card p-3 shadow-sm md:block">
          <NavItems />
          <div className="mt-4 border-t pt-3">
            <p className="px-3 text-[11px] leading-4 text-muted-foreground">
              Deterministic engine + grounded AI. Results are computed locally; AI adds explanations only.
            </p>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {/* Sticky footer: mt-auto keeps it at the bottom on short pages */}
      <footer className="mt-auto border-t bg-card/60">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p>InsightIQ — Upload → Understand → Analyze → Clean → Compare → Ask → Export</p>
          <p>Deterministic Python engine (pandas · NumPy · SciPy) + optional Gemini/Groq AI layer</p>
        </div>
      </footer>
    </div>
  );
}
