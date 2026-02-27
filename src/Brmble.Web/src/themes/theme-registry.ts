export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  fontUrl: string;
}

export const themes: ThemeDefinition[] = [
  {
    id: 'classic',
    name: 'Brmble Classic',
    description: 'The original Bramble cocktail palette — vintage lounge',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
  {
    id: 'clean',
    name: 'Brmble Clean',
    description: 'Stripped-down dark mode — neutral and modern',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
  {
    id: 'blue-lagoon',
    name: 'Blue Lagoon',
    description: 'Tropical electric cyan — poolside cool',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400&family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
  {
    id: 'cosmopolitan',
    name: 'Cosmopolitan',
    description: 'Glamorous cranberry-rose — fashion-editorial elegance',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Manrope:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
  {
    id: 'aperol-spritz',
    name: 'Aperol Spritz',
    description: 'Mediterranean sunset warmth — golden hour amber',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Nunito:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
  {
    id: 'midori-sour',
    name: 'Midori Sour',
    description: 'Neon emerald energy — cyberpunk Tokyo nights',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Lexend:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
  {
    id: 'lemon-drop',
    name: 'Lemon Drop Martini',
    description: 'Bright lemon gold — premium optimism',
    fontUrl: 'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  },
];

export function getTheme(id: string): ThemeDefinition | undefined {
  return themes.find(t => t.id === id);
}

export function getDefaultTheme(): ThemeDefinition {
  return themes[0];
}
