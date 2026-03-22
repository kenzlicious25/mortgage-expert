import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface PlacePrediction {
  description: string;
  place_id: string;
}

export interface PlacesResponse {
  predictions: PlacePrediction[];
  note?: string;
  source?: string;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  type: string;
  class: string;
  addresstype?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PlacesService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Returns address suggestions.
   * Primary: backend proxy (Google Places if configured, Nominatim otherwise).
   * Fallback: Nominatim directly from the browser (always works, no API key needed).
   */
  getAutocompleteSuggestions(input: string): Observable<PlacesResponse> {
    if (!input || input.trim().length < 3) {
      return of({ predictions: [] });
    }

    return this.http
      .get<PlacesResponse>(`${this.apiUrl}/places/autocomplete`, {
        params: { input: input.trim() }
      })
      .pipe(
        switchMap(response => {
          // If backend returned results, use them
          if (response.predictions && response.predictions.length > 0) {
            return of(response);
          }
          // Backend returned nothing (unconfigured API key etc.) – use Nominatim directly
          return this.nominatimSearch(input.trim());
        }),
        catchError(() => this.nominatimSearch(input.trim()))
      );
  }

  /** Call OpenStreetMap Nominatim directly – free, no API key, CORS-enabled */
  private nominatimSearch(query: string): Observable<PlacesResponse> {
    return this.http
      .get<NominatimResult[]>('https://nominatim.openstreetmap.org/search', {
        params: {
          q: query,
          format: 'json',
          addressdetails: '1',
          limit: '8',
          countrycodes: 'us',
          dedupe: '1',
        },
        headers: { 'Accept-Language': 'en-US,en;q=0.9' },
      })
      .pipe(
        map(results => ({
          predictions: (results || []).map(r => ({
            description: r.display_name,
            place_id: String(r.place_id),
          })),
          source: 'nominatim',
        })),
        catchError(() => of({ predictions: [] }))
      );
  }
}
