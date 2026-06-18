import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme, type ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * Compact 3-button theme switcher. Click cycles through Light → Dark → System.
 * Tooltip shows the current preference for hover discovery.
 */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const idx = OPTIONS.findIndex((o) => o.value === preference);
  const current = OPTIONS[idx === -1 ? 0 : idx];
  const next = OPTIONS[(idx + 1) % OPTIONS.length];
  if (!current || !next) return null;

  const Icon = current.icon;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Theme: ${current.label}. Click to switch to ${next.label}.`}
            onClick={() => {
              setPreference(next.value);
            }}
          >
            <Icon className="h-4 w-4" />
          </Button>
        }
      />
      <TooltipContent>
        Theme: {current.label}
        <span className="text-muted-foreground"> → click for {next.label}</span>
      </TooltipContent>
    </Tooltip>
  );
}
