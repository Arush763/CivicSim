/** A zone drawn on the real map. */
export interface MapZone {
  id: string;
  name: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  state?: 'waiting' | 'approved' | 'selected';
  /** Number shown on the zone's badge, if any. */
  badge?: number;
}

export interface Camera {
  center: [number, number]; // [lng, lat]
  zoom: number;
  tilt?: number; // degrees from straight down
  heading?: number; // degrees clockwise from north
}

export interface ZoneMapProps {
  zones: MapZone[];
  onZonePress?: (id: string) => void;
  initialCamera: Camera;
  /** Fly the camera here whenever it changes. */
  focus?: Camera | null;
  /** Where the map's own buttons (my location, 2D/3D, north) sit. */
  controls?: { right?: number; bottom?: number; top?: number } | false;
  /** Hide the thin outline of zones without requests (zone pages, small maps). */
  quietGrid?: boolean;
  /** A tap on the map itself (not on a zone). */
  onMapPress?: (lng: number, lat: number) => void;
  /** After the camera settles: the visible box [west, south, east, north] and zoom. */
  onViewChange?: (bbox: [number, number, number, number], zoom: number) => void;
  style?: object;
}

/** Zoom at which the zone grid is drawn and the map can be tapped to open a zone. */
export const GRID_ZOOM = 15.5;

export interface ZoneMapHandle {
  flyTo: (c: Camera) => void;
}

/** Colours for zone overlays, in the familiar map signal palette. */
export const ZONE_COLORS = {
  idle: { stroke: '#5F6368', strokeOpacity: 0.7, fill: '#000000', fillOpacity: 0 },
  waiting: { stroke: '#E37400', strokeOpacity: 0.95, fill: '#F29900', fillOpacity: 0.22 },
  approved: { stroke: '#188038', strokeOpacity: 0.95, fill: '#34A853', fillOpacity: 0.22 },
  selected: { stroke: '#1A73E8', strokeOpacity: 1, fill: '#1A73E8', fillOpacity: 0.12 },
} as const;

/** Where the map opens: lower Manhattan. Zones work anywhere in the world. */
export const PILOT_CAMERA: Camera = { center: [-73.997, 40.7205], zoom: 14.3, tilt: 45, heading: 29 };
