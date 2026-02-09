"use client";

import { Moon, Sun } from "lucide-react";
import { useState } from "react";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof document === "undefined") {
    return "light";
  }

  return document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(nextTheme);
    localStorage.setItem("theme", nextTheme);
    setTheme(nextTheme);
  };

  const Icon = theme === "dark" ? Sun : Moon;
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
