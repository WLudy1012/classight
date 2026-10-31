import type { SVGProps } from 'react'

/** One consistent stroke system: 24 grid, 1.5 stroke, square caps (echoes the corner-bracket cursor). */
const PATHS = {
  arrowRight: 'M4 12h16M14 6l6 6-6 6',
  arrowLeft: 'M20 12H4M10 6l-6 6 6 6',
  arrowUp: 'M12 20V4M6 10l6-6 6 6',
  arrowDown: 'M12 4v16M6 14l6 6 6-6',
  close: 'M5 5l14 14M19 5L5 19',
  plus: 'M12 4v16M4 12h16',
  minus: 'M4 12h16',
  check: 'M4 12.5l5 5L20 6.5',
  search: 'M10.5 17a6.5 6.5 0 100-13 6.5 6.5 0 000 13zM20 20l-4.8-4.8',
  user: 'M12 12a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM4 21c0-4.4 3.6-7 8-7s8 2.6 8 7',
  users:
    'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20c0-3.6 2.9-5.5 6.5-5.5s6.5 1.9 6.5 5.5M16 4.3a3.5 3.5 0 010 6.4M18 14.8c2.2.6 3.5 2.3 3.5 5.2',
  logout: 'M9 4H5v16h4M16 8l4 4-4 4M20 12H9',
  globe:
    'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  key: 'M9 15a5 5 0 110-10 5 5 0 010 10zM12.5 12.5L21 21M17 17l2.5-2.5',
  shield: 'M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6l8-3z',
  sliders: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  server: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
  mail: 'M3 6h18v12H3zM3 7l9 7 9-7',
  ticket: 'M4 7h16v4a2 2 0 000 2v4H4v-4a2 2 0 000-2V7zM14 7v10',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  menu: 'M4 7h16M4 12h16M4 17h16',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5',
  timeline: 'M5 21V4M5 5h12l-2 4 2 4H5',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v6M12 7.5h.01',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  alert: 'M12 3l10 18H2L12 3zM12 10v5M12 18h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  play: 'M7 4l13 8-13 8z',
  pause: 'M8 5v14M16 5v14',
  skip: 'M5 5l10 7-10 7zM19 5v14',
  stop: 'M6 6h12v12H6z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  presentation: 'M3 4h18M5 4v11h14V4M12 15v5M8 20h8',
  team: 'M12 11a3 3 0 100-6 3 3 0 000 6zM7 20c0-3 2.2-5 5-5s5 2 5 5M4.5 11.5a2.4 2.4 0 110-4.8M19.5 11.5a2.4 2.4 0 100-4.8',
  checkCircle: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8 12.5l3 3 5-6',
  externalLink: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  fullscreenExit: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  mic: 'M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM6 11a6 6 0 0012 0M12 17v4',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 018 0v3',
  web: 'M3 5h18v14H3zM3 9h18M6 7h.01M9 7h.01',
} as const

export type IconName = keyof typeof PATHS

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
