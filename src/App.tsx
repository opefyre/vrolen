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

export default function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 text-slate-100">
      <h1 className="text-5xl font-bold tracking-tight">Hello Vrolen</h1>
      <p className="text-sm tracking-wide text-slate-400">
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
    </main>
  );
}
