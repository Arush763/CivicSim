import Svg, { Circle, Path } from 'react-native-svg';

export type IconName =
  | 'map' | 'requests' | 'petitions' | 'ranks' | 'you'
  | 'search' | 'plus' | 'minus' | 'reset' | 'chevron' | 'back' | 'close' | 'cube' | 'check' | 'locate' | 'compass';

/** The stroke icons from the design canvas (24×24, 2px stroke, rounded). */
export function Icon({ name, size = 22, color = '#202124', strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const p = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'map' && (
        <>
          <Path d="M12 3l9 5-9 5-9-5 9-5z" {...p} />
          <Path d="M3 13l9 5 9-5" {...p} />
        </>
      )}
      {name === 'requests' && <Path d="M4 6h16M4 12h16M4 18h10" {...p} />}
      {name === 'petitions' && (
        <>
          <Path d="M7 3h7l4 4v14H7z" {...p} />
          <Path d="M10 12h5M10 16h5" {...p} />
        </>
      )}
      {name === 'ranks' && <Path d="M6 20V10M12 20V4M18 20v-7" {...p} />}
      {name === 'you' && (
        <>
          <Circle cx={12} cy={8} r={4} {...p} />
          <Path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" {...p} />
        </>
      )}
      {name === 'search' && (
        <>
          <Circle cx={11} cy={11} r={7} {...p} />
          <Path d="M20 20l-3.5-3.5" {...p} />
        </>
      )}
      {name === 'plus' && <Path d="M12 5v14M5 12h14" {...p} />}
      {name === 'minus' && <Path d="M5 12h14" {...p} />}
      {name === 'reset' && (
        <>
          <Path d="M4 12a8 8 0 1 0 3-6.2" {...p} />
          <Path d="M4 4v4h4" {...p} />
        </>
      )}
      {name === 'chevron' && <Path d="M9 6l6 6-6 6" {...p} />}
      {name === 'back' && <Path d="M15 6l-6 6 6 6" {...p} />}
      {name === 'close' && <Path d="M6 6l12 12M18 6L6 18" {...p} />}
      {name === 'check' && <Path d="M5 12.5l4.5 4.5L19 7.5" {...p} />}
      {name === 'locate' && (
        <>
          <Circle cx={12} cy={12} r={4} {...p} />
          <Path d="M12 2v3M12 19v3M2 12h3M19 12h3" {...p} />
        </>
      )}
      {name === 'compass' && (
        <>
          <Path d="M12 3l3.5 9H8.5z" {...p} fill={color} />
          <Path d="M12 21l-3.5-9h7z" {...p} />
        </>
      )}
      {name === 'cube' && (
        <>
          <Path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" {...p} />
          <Path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" {...p} />
        </>
      )}
    </Svg>
  );
}
