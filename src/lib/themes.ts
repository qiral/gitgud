export interface ThemeInfo {
  id: string
  label: string
  dark: boolean
}

/** Every theme, in the order shown. The colors live in src/themes.css. */
export const THEMES: ThemeInfo[] = [
  { id: 'dark', label: 'Dark', dark: true },
  { id: 'light', label: 'Light', dark: false },
  { id: 'ayu-dark', label: 'Ayu Dark', dark: true },
  { id: 'ayu-light', label: 'Ayu Light', dark: false },
  { id: 'ayu-mirage', label: 'Ayu Mirage', dark: true },
  { id: 'catppuccin-frappe', label: 'Catppuccin Frappé', dark: true },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', dark: false },
  { id: 'catppuccin-macchiato', label: 'Catppuccin Macchiato', dark: true },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', dark: true },
  { id: 'cobalt', label: 'Cobalt', dark: true },
  { id: 'dracula', label: 'Dracula', dark: true },
  { id: 'everforest-dark', label: 'Everforest Dark', dark: true },
  { id: 'everforest-light', label: 'Everforest Light', dark: false },
  { id: 'flexoki-dark', label: 'Flexoki Dark', dark: true },
  { id: 'flexoki-light', label: 'Flexoki Light', dark: false },
  { id: 'github-dark', label: 'GitHub Dark', dark: true },
  { id: 'github-dimmed', label: 'GitHub Dimmed', dark: true },
  { id: 'github-light', label: 'GitHub Light', dark: false },
  { id: 'gruvbox', label: 'Gruvbox Dark', dark: true },
  { id: 'gruvbox-light', label: 'Gruvbox Light', dark: false },
  { id: 'kanagawa', label: 'Kanagawa', dark: true },
  { id: 'kanagawa-lotus', label: 'Kanagawa Lotus', dark: false },
  { id: 'midnight', label: 'Midnight', dark: true },
  { id: 'monokai', label: 'Monokai', dark: true },
  { id: 'night-owl', label: 'Night Owl', dark: true },
  { id: 'nord', label: 'Nord', dark: true },
  { id: 'one-dark', label: 'One Dark', dark: true },
  { id: 'one-light', label: 'One Light', dark: false },
  { id: 'rose-pine', label: 'Rosé Pine', dark: true },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', dark: false },
  { id: 'rose-pine-moon', label: 'Rosé Pine Moon', dark: true },
  { id: 'solarized-dark', label: 'Solarized Dark', dark: true },
  { id: 'solarized-light', label: 'Solarized Light', dark: false },
  { id: 'synthwave', label: 'Synthwave', dark: true },
  { id: 'tokyo-night', label: 'Tokyo Night', dark: true },
  { id: 'tokyo-night-day', label: 'Tokyo Night Day', dark: false },
  { id: 'tokyo-night-storm', label: 'Tokyo Night Storm', dark: true },
  { id: 'vesper', label: 'Vesper', dark: true },
  { id: 'high-contrast-dark', label: 'High Contrast Dark', dark: true },
  { id: 'high-contrast-light', label: 'High Contrast Light', dark: false },
]
