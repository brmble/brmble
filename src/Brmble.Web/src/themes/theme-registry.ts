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
];

export function getTheme(id: string): ThemeDefinition | undefined {
  return themes.find(t => t.id === id);
}

export function getDefaultTheme(): ThemeDefinition {
  return themes[0];
}
