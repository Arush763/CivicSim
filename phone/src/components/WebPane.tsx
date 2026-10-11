import { forwardRef, useImperativeHandle, useRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import { readPageMessage } from '@/lib/streetview';

export interface WebPaneHandle {
  /** Run a line of JavaScript in the page (e.g. switch Before/After). */
  run: (js: string) => void;
}

/**
 * One of the laptop's pages (Street View before/after, or the 3D model) inside the app. The page
 * posts {source, status, message} back as it loads.
 */
export const WebPane = forwardRef<WebPaneHandle, { uri: string; background: string; onStatus?: (status: string, message?: string) => void; style?: StyleProp<ViewStyle> }>(
  function WebPane({ uri, background, onStatus, style }, ref) {
    const web = useRef<WebView>(null);
    useImperativeHandle(ref, () => ({ run: (js) => web.current?.injectJavaScript(`${js};true;`) }));
    return (
      <View style={[{ overflow: 'hidden', backgroundColor: background }, style]}>
        <WebView
          ref={web}
          source={{ uri, headers: { 'ngrok-skip-browser-warning': '1' } }}
          style={{ flex: 1, backgroundColor: background }}
          onMessage={(e) => {
            const m = readPageMessage(e.nativeEvent.data);
            if (m) onStatus?.(m.status, m.message);
          }}
          onError={() => onStatus?.('error', 'The view could not be loaded from the server.')}
          onHttpError={(e) => onStatus?.('error', `The server answered ${e.nativeEvent.statusCode}.`)}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          originWhitelist={['*']}
          // Drags turn the view instead of scrolling the page.
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
        />
      </View>
    );
  },
);
