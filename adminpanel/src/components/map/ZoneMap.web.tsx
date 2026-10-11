import { AdvancedMarker, Map, Rectangle, RenderingType, useMap } from '@vis.gl/react-google-maps';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Text, View } from 'react-native';
import { GOOGLE_MAP_ID, GOOGLE_MAPS_KEY } from '@/lib/config';
import { fonts, shadow, useTheme } from '@/lib/theme';
import { Icon } from '../icons';
import { IconButton } from '../ui';
import { HEAT_COLORS } from '@mamdani/shared';
import { ZONE_COLORS, type Camera, type ZoneMapHandle, type ZoneMapProps } from './types';

/**
 * Browser version: Google's vector map, tilted, with Google's own 3D buildings. Zones are
 * rectangles on the ground; zones with requests are tinted and carry a count badge.
 */
export const ZoneMap = forwardRef<ZoneMapHandle, ZoneMapProps>(function ZoneMap(props, ref) {
  return (
    <View style={[{ overflow: 'hidden', backgroundColor: '#E8EAED' }, props.style]}>
      <Inner {...props} innerRef={ref} />
      {!GOOGLE_MAPS_KEY && <KeyBanner />}
    </View>
  );
});

function Inner({ zones, onZonePress, onMapPress, onViewChange, initialCamera, focus, controls = { right: 16, bottom: 24 }, quietGrid, innerRef }: ZoneMapProps & { innerRef: React.Ref<ZoneMapHandle> }) {
  const map = useMap();
  const t = useTheme();
  const [tilted, setTilted] = useState((initialCamera.tilt ?? 0) > 0);

  const flyTo = (c: Camera) => {
    if (!map) return;
    map.moveCamera({ center: { lng: c.center[0], lat: c.center[1] }, zoom: c.zoom, tilt: c.tilt ?? map.getTilt(), heading: c.heading ?? map.getHeading() });
  };
  useImperativeHandle(innerRef, () => ({ flyTo }));

  // Smoothly fly when the focus changes.
  useEffect(() => {
    if (!map || !focus) return;
    map.panTo({ lng: focus.center[0], lat: focus.center[1] });
    const z = window.setTimeout(() => {
      map.setZoom(focus.zoom);
      if (focus.tilt !== undefined) map.setTilt(focus.tilt);
      if (focus.heading !== undefined) map.setHeading(focus.heading);
    }, 350);
    return () => window.clearTimeout(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focus?.center.join(','), focus?.zoom, focus?.tilt, focus?.heading]);

  const locate = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 17 });
        setMe([pos.coords.longitude, pos.coords.latitude]);
      },
      () => window.alert('Location is blocked for this site. Allow it in your browser to use "my location".'),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };
  const [me, setMe] = useState<[number, number] | null>(null);

  return (
    <>
      <Map
        style={{ width: '100%', height: '100%' }}
        mapId={GOOGLE_MAP_ID}
        renderingType={RenderingType.VECTOR}
        defaultCenter={{ lng: initialCamera.center[0], lat: initialCamera.center[1] }}
        defaultZoom={initialCamera.zoom}
        defaultTilt={initialCamera.tilt ?? 0}
        defaultHeading={initialCamera.heading ?? 0}
        gestureHandling="greedy"
        disableDefaultUI
        clickableIcons={false}
        onTiltChanged={(e) => setTilted((e.map.getTilt() ?? 0) > 1)}
        onClick={(e) => {
          const p = e.detail.latLng;
          if (p) onMapPress?.(p.lng, p.lat);
        }}
        onIdle={(e) => {
          const b = e.map.getBounds();
          if (!b || !onViewChange) return;
          const ne = b.getNorthEast();
          const sw = b.getSouthWest();
          onViewChange([sw.lng(), sw.lat(), ne.lng(), ne.lat()], e.map.getZoom() ?? 0);
        }}
      >
        {zones.map((z) => {
          const base = ZONE_COLORS[z.state ?? 'idle'];
          // The heat map: the zone filled in its complaint colour; a request's outline stays on top.
          const hot = z.heat && z.heat !== 'none' ? HEAT_COLORS[z.heat] : null;
          const look = hot ? { ...base, fill: hot, fillOpacity: 0.38, ...(z.state ? {} : { stroke: hot, strokeOpacity: 0.85 }) } : base;
          const [w, s, e, n] = z.bbox;
          if (quietGrid && !z.state && !hot) return null;
          return (
            <Rectangle
              key={z.id}
              bounds={{ west: w, south: s, east: e, north: n }}
              strokeColor={look.stroke}
              strokeOpacity={look.strokeOpacity}
              strokeWeight={z.state === 'selected' ? 3 : z.state ? 2 : 1}
              fillColor={look.fill}
              fillOpacity={look.fillOpacity}
              clickable={!!onZonePress}
              onClick={() => onZonePress?.(z.id)}
              zIndex={z.state ? 2 : 1}
            />
          );
        })}
        {zones
          .filter((z) => z.badge)
          .map((z) => {
            const [w, s, e, n] = z.bbox;
            const approved = z.state === 'approved';
            return (
              <AdvancedMarker key={`b-${z.id}`} position={{ lng: (w + e) / 2, lat: (s + n) / 2 }} onClick={() => onZonePress?.(z.id)} title={z.name}>
                <View style={[{ minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' }, shadow, { backgroundColor: approved ? t.approved : t.waiting }]}>
                  <Text style={{ color: '#fff', fontFamily: fonts.bodyBold, fontSize: 13 }}>{z.badge}</Text>
                </View>
              </AdvancedMarker>
            );
          })}
        {me && (
          <AdvancedMarker position={{ lng: me[0], lat: me[1] }} title="You are here">
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#1A73E8', borderWidth: 3, borderColor: '#fff', ...shadow }} />
          </AdvancedMarker>
        )}
      </Map>
      {controls && (
        <View style={{ position: 'absolute', right: controls.right, bottom: controls.bottom, top: controls.top, gap: 10 }} pointerEvents="box-none">
          <MapButton label="My location" onPress={locate}><Icon name="locate" size={20} color={t.accent} /></MapButton>
          <MapButton label={tilted ? 'Show flat map' : 'Show 3D buildings'} onPress={() => map?.setTilt(tilted ? 0 : 45)}>
            <Text style={{ color: t.text, fontFamily: fonts.bodyBold, fontSize: 13 }}>{tilted ? '2D' : '3D'}</Text>
          </MapButton>
          <MapButton label="Point north" onPress={() => map?.setHeading(0)}><Icon name="compass" size={20} color={t.text} /></MapButton>
        </View>
      )}
    </>
  );
}

export function MapButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <IconButton label={label} onPress={onPress} tint="#FFFFFF" style={[{ borderColor: 'transparent', width: 44, height: 44 }, shadow]}>
      {children}
    </IconButton>
  );
}

function KeyBanner() {
  const t = useTheme();
  return (
    <View style={{ position: 'absolute', left: 12, right: 12, bottom: 12, alignItems: 'center' }} pointerEvents="none">
      <View style={[{ backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, maxWidth: 520 }, shadow]}>
        <Text style={{ color: t.text, fontFamily: fonts.bodyMedium, fontSize: 13 }}>
          Add your Google Maps API key as EXPO_PUBLIC_GOOGLE_MAPS_API_KEY in adminpanel/.env to remove the "development purposes" overlay.
        </Text>
      </View>
    </View>
  );
}

