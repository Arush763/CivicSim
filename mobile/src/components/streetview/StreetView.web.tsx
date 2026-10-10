import { createElement, useEffect } from 'react';
import { View } from 'react-native';
import { readStatus, streetViewUrl, type StreetViewProps } from '@/lib/streetview';

/** Browser version: the server's Street View page in an iframe. (Phone version: StreetView.tsx.) */
export function StreetView({ onStatus, style, ...props }: StreetViewProps) {
  const src = streetViewUrl(props);
  useEffect(() => {
    const listen = (e: MessageEvent) => {
      const s = readStatus(e.data);
      if (s) onStatus?.(s.status, s.message);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [onStatus]);
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: '#E8EAED' }, style]}>
      {createElement('iframe', {
        src,
        title: 'Street View before and after',
        allow: 'fullscreen; accelerometer; gyroscope',
        style: { border: 0, width: '100%', height: '100%', display: 'block' },
      })}
    </View>
  );
}
