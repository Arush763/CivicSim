import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { readStatus, streetViewUrl, useStreetViewToken, type StreetViewProps } from '@/lib/streetview';

/** Phone version: the server's Street View page in a WebView. (Browser version: StreetView.web.tsx.) */
export function StreetView({ onStatus, style, ...props }: StreetViewProps) {
  const token = useStreetViewToken();
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: '#E8EAED' }, style]}>
      <WebView
        source={{ uri: streetViewUrl(props, token) }}
        style={{ flex: 1, backgroundColor: '#E8EAED' }}
        onMessage={(e) => {
          const s = readStatus(e.nativeEvent.data);
          if (s) onStatus?.(s.status, s.message);
        }}
        onError={() => onStatus?.('error', 'Street View could not be loaded.')}
        javaScriptEnabled
        allowsInlineMediaPlayback
        originWhitelist={['*']}
        // Let the panorama take drags instead of the page scrolling.
        scrollEnabled={false}
        nestedScrollEnabled
      />
    </View>
  );
}
