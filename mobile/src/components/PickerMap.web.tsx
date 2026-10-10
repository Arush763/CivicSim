import { AdvancedMarker, Map, Polygon, Polyline, Rectangle, RenderingType } from '@vis.gl/react-google-maps';
import { View } from 'react-native';
import { GOOGLE_MAP_ID } from '@/lib/config';
import type { PickerMapProps } from './PickerMap';

const BLUE = '#1A73E8';
const ll = ([lng, lat]: [number, number]) => ({ lng, lat });

/**
 * Browser version of the pick map: the real Google map of the zone, with its streets and
 * buildings as tappable overlays. Click a street or building, or click the map to place points.
 */
export function PickerMap({ area, pick, treeShape, streetId, buildingId, points, onStreet, onBuilding, onMapPress, height = 240 }: PickerMapProps) {
  const [w, s, e, n] = area.bbox;
  const pts = points.map((p) => ({ lng: p.longitude, lat: p.latitude }));
  const drawing = pick === 'polygon' || pick === 'line_or_polygon';

  return (
    <View style={{ height: height === 'fill' ? undefined : height, flex: height === 'fill' ? 1 : undefined, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#DADCE0' }}>
      <Map
        id={`picker-${area.id}`}
        style={{ width: '100%', height: '100%' }}
        mapId={GOOGLE_MAP_ID}
        renderingType={RenderingType.VECTOR}
        defaultBounds={{ west: w, south: s, east: e, north: n, padding: 24 }}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        clickableIcons={false}
        onClick={(ev) => {
          const p = ev.detail.latLng;
          if (p) onMapPress({ latitude: p.lat, longitude: p.lng });
        }}
      >
        <Rectangle bounds={{ west: w, south: s, east: e, north: n }} strokeColor={BLUE} strokeOpacity={0.6} strokeWeight={2} fillOpacity={0} clickable={false} />
        {pick === 'building' &&
          area.scene.buildings.map((b) => (
            <Polygon
              key={b.id}
              paths={b.ring.map(ll)}
              strokeColor={BLUE}
              strokeWeight={b.id === buildingId ? 2 : 1}
              strokeOpacity={b.id === buildingId ? 1 : 0.5}
              fillColor={BLUE}
              fillOpacity={b.id === buildingId ? 0.55 : 0.08}
              onClick={() => onBuilding(b.id)}
            />
          ))}
        {area.scene.streets.map((st) => {
          const selected = st.id === streetId;
          if (pick !== 'street' && !selected) return null;
          return (
            <Polyline
              key={st.id}
              path={st.line.map(ll)}
              strokeColor={BLUE}
              strokeOpacity={selected ? 1 : 0.35}
              strokeWeight={selected ? 9 : 7}
              clickable={pick === 'street'}
              onClick={() => onStreet(st.id)}
              zIndex={selected ? 3 : 2}
            />
          );
        })}
        {drawing && (pick === 'polygon' || treeShape === 'area') && pts.length >= 3 && (
          <Polygon paths={pts} strokeColor={BLUE} strokeWeight={2} fillColor={BLUE} fillOpacity={0.25} clickable={false} />
        )}
        {pick === 'line_or_polygon' && treeShape === 'line' && pts.length >= 2 && (
          <Polyline path={pts} strokeColor={BLUE} strokeWeight={5} clickable={false} />
        )}
        {(drawing || pick === 'point') &&
          pts.map((p, i) => (
            <AdvancedMarker key={i} position={p}>
              <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: BLUE, borderWidth: 2, borderColor: '#fff' }} />
            </AdvancedMarker>
          ))}
      </Map>
    </View>
  );
}
