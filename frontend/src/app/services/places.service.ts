import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface PlacePrediction {
  description: string;
  place_id: string;
}

export interface PlacesResponse {
  predictions: PlacePrediction[];
  note?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PlacesService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getAutocompleteSuggestions(input: string): Observable<PlacesResponse> {
    if (!input || input.trim().length < 2) {
      return of({ predictions: [] });
    }
    return this.http
      .get<PlacesResponse>(`${this.apiUrl}/places/autocomplete`, {
        params: { input: input.trim() }
      })
      .pipe(catchError(() => of({ predictions: [] })));
  }
}
