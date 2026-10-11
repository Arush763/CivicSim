import { GOOGLE_MAPS_KEY } from './config';

/** A place suggestion from Google Places. */
export interface PlaceHit {
  id: string;
  title: string;
  subtitle: string;
}

// Phone version: Places API (New) over HTTPS. (Browser version: places.web.ts, via the Maps JS library.)

export async function searchPlaces(input: string, near: [number, number]): Promise<PlaceHit[]> {
  if (!GOOGLE_MAPS_KEY || input.trim().length < 2) return [];
  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_MAPS_KEY },
    body: JSON.stringify({ input, locationBias: { circle: { center: { latitude: near[1], longitude: near[0] }, radius: 5000 } } }),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    suggestions?: { placePrediction?: { placeId: string; text: { text: string }; structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } } } }[];
  };
  return (body.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .slice(0, 5)
    .map((p) => ({ id: p.placeId, title: p.structuredFormat?.mainText?.text ?? p.text.text, subtitle: p.structuredFormat?.secondaryText?.text ?? '' }));
}

export async function placeLocation(id: string): Promise<[number, number] | null> {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
    headers: { 'X-Goog-Api-Key': GOOGLE_MAPS_KEY, 'X-Goog-FieldMask': 'location' },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { location?: { latitude: number; longitude: number } };
  return body.location ? [body.location.longitude, body.location.latitude] : null;
}
