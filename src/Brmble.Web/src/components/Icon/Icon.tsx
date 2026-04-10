import type { SVGProps, ReactNode } from 'react';

// ── Icon path definitions ──────────────────────────────────────────────────
// Feather / Lucide-style: 24×24 viewBox, stroke-based, currentColor.
//
// Organized by category, with logical pairs (foo / foo-off) grouped together.
// To add a new icon: find the right category, add an entry to `iconPaths`,
// then use <Icon name="your-icon" />.  See docs/UI_GUIDE.md § 11.

type IconDef = {
  /** Default viewBox (omit for standard "0 0 24 24") */
  viewBox?: string;
  /** Use fill instead of stroke */
  fill?: boolean;
  /** SVG inner elements */
  paths: ReactNode;
};

const iconPaths: Record<string, IconDef> = {

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  VOICE                                                             ║
  // ║  Microphone, headphones, phone — anything audio / call related     ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  /* ── mic / mic-off ───────────────────────────────────── */

  'mic': {
    paths: (
      <>
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </>
    ),
  },
  'mic-off': {
    paths: (
      <>
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      </>
    ),
  },

  /* ── headphones / headphones-off ─────────────────────── */

  'headphones': {
    paths: (
      <>
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
        <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
      </>
    ),
  },
  'headphones-off': {
    paths: (
      <>
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
        <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
      </>
    ),
  },

  /* ── phone-off (leave voice) ─────────────────────────── */

  'phone-off': {
    paths: (
      <>
        <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </>
    ),
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  MEDIA                                                             ║
  // ║  Screen share, fullscreen toggles                                  ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  /* ── monitor / monitor-off (screen share) ────────────── */

  'monitor': {
    paths: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </>
    ),
  },
  'monitor-off': {
    paths: (
      <>
        <line x1="1" y1="1" x2="23" y2="23" />
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </>
    ),
  },

  /* ── minimize-2 / maximize-2 (fullscreen) ────────────── */

  'minimize-2': {
    paths: <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />,
  },
  'maximize-2': {
    paths: <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />,
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  CHAT                                                              ║
  // ║  Message bubbles, text communication                               ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  'message-square': {
    paths: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  },
  'message-circle': {
    paths: <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />,
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  SERVER                                                            ║
  // ║  Server infrastructure, channels, moderation                       ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  'server': {
    paths: (
      <>
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
        <line x1="6" y1="6" x2="6.01" y2="6" />
        <line x1="6" y1="18" x2="6.01" y2="18" />
      </>
    ),
  },
  'globe': {
    paths: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </>
    ),
  },
  'folder': {
    paths: <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />,
  },
  'shield': {
    paths: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  },
  'star': {
    paths: <path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2z" />,
  },
  'ban': {
    paths: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </>
    ),
  },

  /* ── channel tree ────────────────────────────────────── */

  'triangle-right': {
    viewBox: '0 0 10 10',
    fill: true,
    paths: <path d="M3 2L7 5L3 8V2Z" />,
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  UI — ACTIONS                                                      ║
  // ║  Generic action icons used across the interface                    ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  'x': {
    paths: (
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>
    ),
  },
  'search': {
    paths: (
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    ),
  },
  'plus': {
    paths: (
      <>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </>
    ),
  },
  'check': {
    viewBox: '0 0 16 16',
    paths: <polyline points="3.5 8 6.5 11 12.5 5" />,
  },
  'send': {
    paths: (
      <>
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </>
    ),
  },
  'upload': {
    paths: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </>
    ),
  },
  'arrow-right': {
    paths: <path d="M5 12h14M12 5l7 7-7 7" />,
  },

  /* ── eye / eye-off (password visibility) ─────────────── */

  'eye': {
    paths: (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  'eye-off': {
    paths: (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </>
    ),
  },

  /* ── chevron-up / chevron-down ───────────────────────── */

  'chevron-up': {
    paths: <polyline points="18 15 12 9 6 15" />,
  },
  'chevron-down': {
    paths: <polyline points="6 9 12 15 18 9" />,
  },

  /* ── info / info-filled ──────────────────────────────── */

  'info': {
    paths: (
      <>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </>
    ),
  },
  'info-filled': {
    paths: (
      <>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="8" r="1" fill="currentColor" stroke="none" />
        <line x1="12" y1="12" x2="12" y2="16" />
      </>
    ),
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  UI — OBJECTS                                                      ║
  // ║  Settings, user profile, save, palette, etc.                       ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  'user': {
    paths: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
  },
  'settings': {
    paths: (
      <>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  'save': {
    paths: (
      <>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
      </>
    ),
  },
  'palette': {
    paths: (
      <>
        <circle cx="13.5" cy="6.5" r="2.5" />
        <circle cx="17.5" cy="10.5" r="2.5" />
        <circle cx="8.5" cy="7.5" r="2.5" />
        <circle cx="6.5" cy="12.5" r="2.5" />
        <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.04-.24-.3-.39-.65-.39-1.04 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.17-4.5-8.92-10-8.92z" />
      </>
    ),
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  WINDOW                                                            ║
  // ║  Title bar controls (custom viewBox, non-standard)                 ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  'window-minimize': {
    viewBox: '0 0 10 1',
    fill: true,
    paths: <rect width="10" height="1" fill="currentColor" />,
  },
  'window-maximize': {
    viewBox: '0 0 10 10',
    paths: <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />,
  },
  'window-close': {
    viewBox: '0 0 10 10',
    paths: (
      <>
        <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
        <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
      </>
    ),
  },

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  BRMBLEGOTCHI                                                      ║
  // ║  Virtual pet game icons — actions and stat indicators.             ║
  // ║  Shared across all pet themes (original, dino, cat).               ║
  // ║  Add pet-specific icons under sub-headers if needed:               ║
  // ║    /* ── gotchi · original ── */                                    ║
  // ║    /* ── gotchi · dino ── */                                        ║
  // ║    /* ── gotchi · cat ── */                                         ║
  // ╚══════════════════════════════════════════════════════════════════════╝

  /* ── gotchi · actions ────────────────────────────────── */

  'gotchi-food': {
    paths: (
      <>
        <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
        <line x1="6" y1="1" x2="6" y2="4" />
        <line x1="10" y1="1" x2="10" y2="4" />
        <line x1="14" y1="1" x2="14" y2="4" />
      </>
    ),
  },
  'gotchi-play': {
    paths: (
      <>
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
      </>
    ),
  },
  'gotchi-clean': {
    paths: <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />,
  },

  /* ── gotchi · stats ──────────────────────────────────── */

  'gotchi-hunger': {
    paths: (
      <>
        <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
      </>
    ),
  },
  'gotchi-happiness': {
    fill: true,
    paths: <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />,
  },
  'gotchi-cleanliness': {
    paths: <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />,
  },
};

// ── Exported type for autocompletion ──
export type IconName = keyof typeof iconPaths;

// ── Component ──
interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Icon name from the icon map */
  name: IconName;
  /** Width & height in px (default 16) */
  size?: number;
}

export function Icon({ name, size = 16, className, style, ...rest }: IconProps) {
  const def = iconPaths[name];
  if (!def) {
    if (import.meta.env.DEV) console.warn(`[Icon] Unknown icon: "${name}"`);
    return null;
  }

  const viewBox = def.viewBox ?? '0 0 24 24';
  const isStroked = !def.fill;

  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill={isStroked ? 'none' : 'currentColor'}
      stroke={isStroked ? 'currentColor' : undefined}
      strokeWidth={isStroked ? 2 : undefined}
      strokeLinecap={isStroked ? 'round' : undefined}
      strokeLinejoin={isStroked ? 'round' : undefined}
      aria-hidden="true"
      className={className}
      style={style}
      {...rest}
    >
      {def.paths}
    </svg>
  );
}
