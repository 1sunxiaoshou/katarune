import { MoonIcon, SunIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { applyTheme, readTheme, type Theme } from "../theme";

export function ThemeSettings(): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(readTheme);

  const selectTheme = (nextTheme: Theme): void => {
    applyTheme(nextTheme);
    setTheme(nextTheme);
  };

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6" aria-labelledby="general-settings-title">
      <div className="grid gap-1">
        <h2 className="text-xl font-semibold" id="general-settings-title">常规</h2>
        <p className="text-sm text-muted-foreground">调整言奏在此设备上的显示方式。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>主题</CardTitle>
          <CardDescription>选择界面的明暗外观，设置会保存在当前设备。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Button
            className="h-auto min-h-24 justify-start gap-3 px-4 py-4 text-left"
            data-testid="theme-light"
            variant={theme === "light" ? "secondary" : "outline"}
            onClick={() => selectTheme("light")}
          >
            <SunIcon className="size-5" aria-hidden="true" />
            <span className="grid gap-1">
              <span>亮色</span>
              <span className="text-xs font-normal text-muted-foreground">明亮、清晰的默认界面</span>
            </span>
          </Button>
          <Button
            className="h-auto min-h-24 justify-start gap-3 px-4 py-4 text-left"
            data-testid="theme-dark"
            variant={theme === "dark" ? "secondary" : "outline"}
            onClick={() => selectTheme("dark")}
          >
            <MoonIcon className="size-5" aria-hidden="true" />
            <span className="grid gap-1">
              <span>暗色</span>
              <span className="text-xs font-normal text-muted-foreground">适合低光环境的深色界面</span>
            </span>
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
