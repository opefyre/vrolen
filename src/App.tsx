import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import DesignTokens from "@/routes/DesignTokens";

function HomePage() {
  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center gap-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <h1 className="font-heading text-5xl font-bold tracking-tight">Hello Vrolen</h1>
      <p className="text-muted-foreground text-sm tracking-wide">
        Production-line simulator · Phase 0 foundation
      </p>
      <div className="flex w-72 flex-col items-stretch gap-3">
        <Input placeholder="Tailwind + shadcn smoke test" />
        <Dialog>
          <DialogTrigger render={<Button>Open dialog</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Dialog mounted</DialogTitle>
              <DialogDescription>
                shadcn/ui components render against the design tokens defined in src/index.css.
              </DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      </div>
      <a className="text-muted-foreground text-xs underline" href="/design-tokens">
        Design tokens
      </a>
    </main>
  );
}

export default function App() {
  // Lightweight pathname router — replaced by TanStack Router in VROL-33.
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";

  return (
    <TooltipProvider>
      {pathname === "/design-tokens" ? <DesignTokens /> : <HomePage />}
    </TooltipProvider>
  );
}
