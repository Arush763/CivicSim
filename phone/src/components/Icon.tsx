import Svg, { Path } from 'react-native-svg';

/** A circle as a path (so every icon is a list of paths). */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

/** Stroke icons from the CivicSim Mobile design (24 × 24). */
const PATHS = {
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  feed: 'M3 17l6-6 4 4 8-8M14 7h7v7',
  ranks: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3',
  settings:
    'M9 12a3 3 0 106 0 3 3 0 10-6 0M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z',
  bike: 'M2 17a3.5 3.5 0 107 0 3.5 3.5 0 10-7 0M15 17a3.5 3.5 0 107 0 3.5 3.5 0 10-7 0M5.5 17l3.5-7h6.5l3 7M9 10l3 7H5.5M14 6h2.5l-1 4',
  bus: 'M7 3h10a3 3 0 013 3v9a3 3 0 01-3 3H7a3 3 0 01-3-3V6a3 3 0 013-3zM4 11h16M8 21v-3M16 21v-3',
  walk: 'M4 4v16M20 4v16M8 12h8M8 12l2.5-2.5M8 12l2.5 2.5M16 12l-2.5-2.5M16 12l-2.5 2.5',
  noParking: 'M3 12a9 9 0 1018 0 9 9 0 10-18 0M10 16V8h3a2.5 2.5 0 010 5h-3M5.6 5.6l12.8 12.8',
  building: 'M6 3h12a1 1 0 011 1v17H5V4a1 1 0 011-1zM9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M11 21v-3h2v3',
  park: 'M12 3l5 7h-3l4 6H6l4-6H7zM12 16v5',
  tree: 'M6 9a6 6 0 1012 0 6 6 0 10-12 0M12 15v6M9 21h6',
  crosswalk: 'M3 5h18M3 19h18M6 8v8M10 8v8M14 8v8M18 8v8',
  search: `${circle(11, 11, 7)}M20 20l-3.5-3.5`,
  close: 'M18 6L6 18M6 6l12 12',
  back: 'M15 18l-6-6 6-6',
  chevron: 'M9 18l6-6-6-6',
  down: 'M6 9l6 6 6-6',
  share: `${circle(18, 5, 3)}${circle(6, 12, 3)}${circle(18, 19, 3)}M8.6 13.5l6.8 4M15.4 6.5l-6.8 4`,
  plus: 'M12 5v14M5 12h14',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'M5 12l5 5L20 7',
  up: 'M12 4l8 9h-5v7H9v-7H4z',
  downVote: 'M12 20l8-9h-5V4H9v7H4z',
  pen: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  locate: `${circle(12, 12, 4)}M12 2v3M12 19v3M2 12h3M19 12h3`,
  clock: `${circle(12, 12, 9)}M12 7v5l3 2`,
  pin: `M12 21s-7-6.2-7-11.5a7 7 0 0114 0C19 14.8 12 21 12 21z${circle(12, 9.5, 2.5)}`,
  sun: 'M12 7a5 5 0 100 10 5 5 0 100-10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  phone: 'M8 2h8a2 2 0 012 2v16a2 2 0 01-2 2H8a2 2 0 01-2-2V4a2 2 0 012-2zM11 18h2',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  collapse: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  spin: 'M12 3a9 9 0 019 9',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  drag: 'M9 6l-6 6 6 6M15 6l6 6-6 6',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  photo: 'M4 7h3l2-2h6l2 2h3v12H4zM12 10a3.5 3.5 0 100 7 3.5 3.5 0 100-7',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, color, fill = 'none', width = 2 }: { name: IconName | string; size?: number; color: string; fill?: string; width?: number }) {
  const d = PATHS[name as IconName] ?? PATHS.map;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path d={d} fill={fill} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** The map's north arrow: red north, grey south. */
export function Compass({ size = 20, north, south }: { size?: number; north: string; south: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path d="M12 3l4.5 9h-9z" fill={north} />
      <Path d="M12 21l-4.5-9h9z" fill={south} />
    </Svg>
  );
}
