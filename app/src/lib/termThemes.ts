import type { ITheme } from "@xterm/xterm";
import { tr } from "./i18n";

/**
 * 终端配色。第一个「跟随应用」= 纸面 / 暖炭，随应用明暗切换；
 * 其余是终端圈最常用的几套，色值取各自官方配色。
 */
export interface TermTheme {
  id: string;
  name: string;
  dark: boolean;
  theme: ITheme;
}

const PAPER: ITheme = {
  background: "#FFFEFB",
  foreground: "#2B2A26",
  cursor: "#C0653F",
  cursorAccent: "#FFFEFB",
  selectionBackground: "rgba(192,101,63,0.18)",
  black: "#2B2A26",
  red: "#B5483E",
  green: "#3E8A53",
  yellow: "#B06F24",
  blue: "#3C6E93",
  magenta: "#8A5E9E",
  cyan: "#2B8676",
  white: "#4A4740",
  brightBlack: "#9A968C",
  brightRed: "#C64545",
  brightGreen: "#4E9F63",
  brightYellow: "#C98831",
  brightBlue: "#5B86A8",
  brightMagenta: "#A277B4",
  brightCyan: "#3A9E8B",
  brightWhite: "#141413",
};

const CHARCOAL: ITheme = {
  background: "#24221F",
  foreground: "#ECE7DC",
  cursor: "#DD906F",
  cursorAccent: "#24221F",
  selectionBackground: "rgba(221,144,111,0.26)",
  black: "#1F1D1A",
  red: "#E27272",
  green: "#79C38B",
  yellow: "#E3AA66",
  blue: "#8FB0CF",
  magenta: "#C9A3D8",
  cyan: "#6CC4B2",
  white: "#ECE7DC",
  brightBlack: "#827E75",
  brightRed: "#F08A8A",
  brightGreen: "#93D3A2",
  brightYellow: "#F0BF7E",
  brightBlue: "#A6C3DE",
  brightMagenta: "#D9B6E4",
  brightCyan: "#8AD4C4",
  brightWhite: "#FAF9F5",
};

export const TERM_THEMES: TermTheme[] = [
  { id: "paper", get name() { return tr("纸面", "Paper"); }, dark: false, theme: PAPER },
  { id: "charcoal", get name() { return tr("暖炭", "Charcoal"); }, dark: true, theme: CHARCOAL },
  {
    id: "pro",
    name: "Pro",
    dark: true,
    theme: {
      background: "#000000", foreground: "#F2F2F2", cursor: "#4D4D4D", selectionBackground: "rgba(255,255,255,0.22)",
      black: "#000000", red: "#990000", green: "#00A600", yellow: "#999900", blue: "#2009DB", magenta: "#B200B2", cyan: "#00A6B2", white: "#BFBFBF",
      brightBlack: "#666666", brightRed: "#E50000", brightGreen: "#00D900", brightYellow: "#E5E500", brightBlue: "#0000FF", brightMagenta: "#E500E5", brightCyan: "#00E5E5", brightWhite: "#E5E5E5",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    dark: true,
    theme: {
      background: "#002B36", foreground: "#839496", cursor: "#93A1A1", selectionBackground: "rgba(147,161,161,0.25)",
      black: "#073642", red: "#DC322F", green: "#859900", yellow: "#B58900", blue: "#268BD2", magenta: "#D33682", cyan: "#2AA198", white: "#EEE8D5",
      brightBlack: "#586E75", brightRed: "#CB4B16", brightGreen: "#93A1A1", brightYellow: "#839496", brightBlue: "#657B83", brightMagenta: "#6C71C4", brightCyan: "#93A1A1", brightWhite: "#FDF6E3",
    },
  },
  {
    id: "solarized-light",
    name: "Solarized Light",
    dark: false,
    theme: {
      background: "#FDF6E3", foreground: "#586E75", cursor: "#586E75", selectionBackground: "rgba(88,110,117,0.2)",
      black: "#073642", red: "#DC322F", green: "#859900", yellow: "#B58900", blue: "#268BD2", magenta: "#D33682", cyan: "#2AA198", white: "#EEE8D5",
      brightBlack: "#002B36", brightRed: "#CB4B16", brightGreen: "#586E75", brightYellow: "#657B83", brightBlue: "#839496", brightMagenta: "#6C71C4", brightCyan: "#93A1A1", brightWhite: "#FDF6E3",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    dark: true,
    theme: {
      background: "#282A36", foreground: "#F8F8F2", cursor: "#F8F8F2", selectionBackground: "rgba(68,71,90,0.9)",
      black: "#21222C", red: "#FF5555", green: "#50FA7B", yellow: "#F1FA8C", blue: "#BD93F9", magenta: "#FF79C6", cyan: "#8BE9FD", white: "#F8F8F2",
      brightBlack: "#6272A4", brightRed: "#FF6E6E", brightGreen: "#69FF94", brightYellow: "#FFFFA5", brightBlue: "#D6ACFF", brightMagenta: "#FF92DF", brightCyan: "#A4FFFF", brightWhite: "#FFFFFF",
    },
  },
  {
    id: "nord",
    name: "Nord",
    dark: true,
    theme: {
      background: "#2E3440", foreground: "#D8DEE9", cursor: "#D8DEE9", selectionBackground: "rgba(67,76,94,0.9)",
      black: "#3B4252", red: "#BF616A", green: "#A3BE8C", yellow: "#EBCB8B", blue: "#81A1C1", magenta: "#B48EAD", cyan: "#88C0D0", white: "#E5E9F0",
      brightBlack: "#4C566A", brightRed: "#BF616A", brightGreen: "#A3BE8C", brightYellow: "#EBCB8B", brightBlue: "#81A1C1", brightMagenta: "#B48EAD", brightCyan: "#8FBCBB", brightWhite: "#ECEFF4",
    },
  },
  {
    id: "one-dark",
    name: "One Dark",
    dark: true,
    theme: {
      background: "#282C34", foreground: "#ABB2BF", cursor: "#528BFF", selectionBackground: "rgba(62,68,81,0.9)",
      black: "#282C34", red: "#E06C75", green: "#98C379", yellow: "#E5C07B", blue: "#61AFEF", magenta: "#C678DD", cyan: "#56B6C2", white: "#ABB2BF",
      brightBlack: "#5C6370", brightRed: "#E06C75", brightGreen: "#98C379", brightYellow: "#E5C07B", brightBlue: "#61AFEF", brightMagenta: "#C678DD", brightCyan: "#56B6C2", brightWhite: "#FFFFFF",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    dark: true,
    theme: {
      background: "#1A1B26", foreground: "#C0CAF5", cursor: "#C0CAF5", selectionBackground: "rgba(51,70,124,0.7)",
      black: "#15161E", red: "#F7768E", green: "#9ECE6A", yellow: "#E0AF68", blue: "#7AA2F7", magenta: "#BB9AF7", cyan: "#7DCFFF", white: "#A9B1D6",
      brightBlack: "#414868", brightRed: "#F7768E", brightGreen: "#9ECE6A", brightYellow: "#E0AF68", brightBlue: "#7AA2F7", brightMagenta: "#BB9AF7", brightCyan: "#7DCFFF", brightWhite: "#C0CAF5",
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    dark: true,
    theme: {
      background: "#282828", foreground: "#EBDBB2", cursor: "#EBDBB2", selectionBackground: "rgba(80,73,69,0.9)",
      black: "#282828", red: "#CC241D", green: "#98971A", yellow: "#D79921", blue: "#458588", magenta: "#B16286", cyan: "#689D6A", white: "#A89984",
      brightBlack: "#928374", brightRed: "#FB4934", brightGreen: "#B8BB26", brightYellow: "#FABD2F", brightBlue: "#83A598", brightMagenta: "#D3869B", brightCyan: "#8EC07C", brightWhite: "#EBDBB2",
    },
  },
  {
    id: "github-light",
    name: "GitHub Light",
    dark: false,
    theme: {
      background: "#FFFFFF", foreground: "#24292F", cursor: "#0969DA", selectionBackground: "rgba(9,105,218,0.18)",
      black: "#24292F", red: "#CF222E", green: "#116329", yellow: "#4D2D00", blue: "#0969DA", magenta: "#8250DF", cyan: "#1B7C83", white: "#6E7781",
      brightBlack: "#57606A", brightRed: "#A40E26", brightGreen: "#1A7F37", brightYellow: "#633C01", brightBlue: "#218BFF", brightMagenta: "#A475F9", brightCyan: "#3192AA", brightWhite: "#8C959F",
    },
  },
];

/** 「跟随应用」：浅色用纸面、深色用暖炭 */
export function resolveTermTheme(id: string | undefined): ITheme {
  if (!id || id === "auto") return document.documentElement.dataset.theme === "dark" ? CHARCOAL : PAPER;
  return TERM_THEMES.find((t) => t.id === id)?.theme ?? PAPER;
}

/** 等宽字体候选：没装的会自动回退，不会出乱码 */
export const TERM_FONTS = ["JetBrains Mono", "SF Mono", "Menlo", "Fira Code", "Cascadia Code", "Source Code Pro", "IBM Plex Mono"];

export const TERM_PADDING: Record<string, string> = {
  compact: "10px 14px 8px",
  normal: "20px 28px 18px",
  wide: "28px 56px 24px",
};
