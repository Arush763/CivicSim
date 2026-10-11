/// <reference types="google.maps" />
import type { PlaceHit } from './places';

export type { PlaceHit };

// Browser version: Places API (New) through the Maps JavaScript library the map already loads.

async function placesLib(): Promise<google.maps.PlacesLibrary | null> {
  const g = (globalThis as { google?: typeof google }).google;
  if (!g?.maps?.importLibrary) return null; // the map hasn't loaded the API yet
  return (await g.maps.importLibrary('places')) as google.maps.PlacesLibrary;
}

export async function searchPlaces(input: string, near: [number, number]): Promise<PlaceHit[]> {
  if (input.trim().length < 2) return [];
  const lib = await placesLib();
  if (!lib) return [];
  try {
    const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input,
      locationBias: { center: { lng: near[0], lat: near[1] }, radius: 5000 },
    });
    return suggestions
      .map((s) => s.placePrediction)
      .filter((p): p is google.maps.places.PlacePrediction => !!p)
      .slice(0, 5)
      .map((p) => ({ id: p.placeId, title: p.mainText?.text ?? p.text.text, subtitle: p.secondaryText?.text ?? '' }));
  } catch {
    return []; // key missing or Places API (New) not enabled
  }
}

export async function placeLocation(id: string): Promise<[number, number] | null> {
  const lib = await placesLib();
  if (!lib) return null;
  const place = new lib.Place({ id });
  await place.fetchFields({ fields: ['location'] });
  return place.location ? [place.location.lng(), place.location.lat()] : null;
}
