import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/Toaster";
import { toast } from "@/lib/toast";
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
import RunPage from "@/routes/RunPage";

function HomePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
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
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.success("Toast wired up", { description: "VROL-43 done" })}
          >
            Success toast
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.error("Something exploded", { description: "But this is just a demo" })
            }
          >
            Error toast
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  let page;
  if (pathname === "/design-tokens") page = <DesignTokens />;
  else if (pathname === "/run") page = <RunPage />;
  else page = <HomePage />;

  return (
    <TooltipProvider>
      <AppShell>{page}</AppShell>
      <Toaster />
    </TooltipProvider>
  );
}
