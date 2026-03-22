import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface PropertyTaxResult {
  annualTax: number | null;
  monthlyTax: number | null;
  source: string;
  address: string;
  note?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PropertyTaxService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  lookupPropertyTax(address: string): Observable<PropertyTaxResult> {
    if (!address || address.trim().length === 0) {
      return of({ annualTax: null, monthlyTax: null, source: 'manual', address });
    }
    return this.http
      .get<PropertyTaxResult>(`${this.apiUrl}/property-tax`, {
        params: { address: address.trim() }
      })
      .pipe(
        catchError(() =>
          of({
            annualTax: null,
            monthlyTax: null,
            source: 'manual',
            address,
            note: 'Property tax lookup failed. Please enter manually.'
          })
        )
      );
  }
}
