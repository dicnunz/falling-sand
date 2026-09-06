import type { CSSProperties } from 'react'

const paths = {
  upload: 'M12 16V4m-4 4 4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
  open: 'M3 7V5a1 1 0 0 1 1-1h6l2 3h7a1 1 0 0 1 1 1v2M3 10h18l-3 10H5L3 10Z',
  save: 'M5 3h12l4 4v14H3V3h2Zm2 0v6h9V3M7 21v-8h10v8',
  play: 'm8 4 12 8-12 8V4Z',
  pause: 'M8 4v16M16 4v16',
  step: 'm5 5 10 7-10 7V5ZM19 5v14',
  reset: 'M3 10a9 9 0 1 1 1 7M3 4v6h6',
  push: 'M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4',
  spark: 'm13 2-9 12h7l-1 8 10-13h-8l1-7Z',
  erase: 'm4 14 9-10a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-7 8H9l-5-4a1.5 1.5 0 0 1 0-2ZM9 9l9 8M9 20h13',
  close: 'm6 6 12 12M6 18 18 6',
  record: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z',
  chevron: 'm6 9 6 6 6-6',
} as const

export function Icon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={style}><path d={paths[name]} /></svg>
}
