/* GENERATED FROM tokens.json -- DO NOT EDIT. Run scripts/build-tokens.mjs. */
// Portable design tokens (colors as hex). Web consumes the theme via
// src/index.css; mobile (Expo) and any other platform import this object so the
// whole product shares one source of truth.
export const tokens = {
  "color": {
    "light": {
      "background": "#f5f0e4",
      "foreground": "#172323",
      "border": "#c8d1c8",
      "card": "#fffaf0",
      "cardForeground": "#172323",
      "popover": "#fffaf0",
      "popoverForeground": "#172323",
      "primary": "#e87128",
      "primaryForeground": "#172323",
      "secondary": "#dce9e4",
      "secondaryForeground": "#173d3a",
      "muted": "#e8e4da",
      "mutedForeground": "#5f706b",
      "accent": "#efb94c",
      "accentForeground": "#172323",
      "destructive": "#d94f3d",
      "destructiveForeground": "#fffaf0",
      "input": "#b9c8c2",
      "ring": "#e87128",
      "chart1": "#e87128",
      "chart2": "#3d8f86",
      "chart3": "#efb94c",
      "chart4": "#b86c91",
      "chart5": "#526f8c",
      "sidebar": "#e6ede8",
      "sidebarForeground": "#314540",
      "sidebarBorder": "#c0cdc7",
      "sidebarPrimary": "#e87128",
      "sidebarPrimaryForeground": "#172323",
      "sidebarAccent": "#d3e2dc",
      "sidebarAccentForeground": "#173d3a",
      "sidebarRing": "#e87128"
    },
    "dark": {
      "background": "#081112",
      "foreground": "#eee7d7",
      "border": "#344343",
      "card": "#101a1b",
      "cardForeground": "#eee7d7",
      "popover": "#152323",
      "popoverForeground": "#eee7d7",
      "primary": "#e87128",
      "primaryForeground": "#152021",
      "secondary": "#1a2929",
      "secondaryForeground": "#c9d2c8",
      "muted": "#172323",
      "mutedForeground": "#8ca6a0",
      "accent": "#efb94c",
      "accentForeground": "#152021",
      "destructive": "#f06445",
      "destructiveForeground": "#fff4ec",
      "input": "#405351",
      "ring": "#efb94c",
      "chart1": "#e87128",
      "chart2": "#78b8ac",
      "chart3": "#efb94c",
      "chart4": "#c88da7",
      "chart5": "#6d91b5",
      "sidebar": "#121d1d",
      "sidebarForeground": "#d9dfd5",
      "sidebarBorder": "#334141",
      "sidebarPrimary": "#e87128",
      "sidebarPrimaryForeground": "#152021",
      "sidebarAccent": "#243737",
      "sidebarAccentForeground": "#f2ead9",
      "sidebarRing": "#efb94c"
    }
  },
  "fontFamily": {
    "sans": [
      "DM Sans",
      "sans-serif"
    ],
    "serif": [
      "DM Sans",
      "sans-serif"
    ],
    "mono": [
      "Space Mono",
      "monospace"
    ]
  },
  "radius": "0.75rem",
  "spacing": "0.25rem"
} as const;

export type Tokens = typeof tokens;
export default tokens;
