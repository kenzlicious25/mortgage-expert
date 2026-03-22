import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface MortgageInput {
  purchasePrice: number;
  downPayment: number;
  grantDpa: number;
  interestRate: number;
  loanTermYears: number;
  pmi: number;
  homeInsurance: number;
  propertyTax: number;
}

export interface MortgageResult {
  monthlyMortgage: number;
  totalMonthlyPayment: number;
  principal: number;
  breakdown: {
    principalAndInterest: number;
    pmi: number;
    propertyTax: number;
    homeInsurance: number;
  };
}

@Injectable({
  providedIn: 'root'
})
export class CalculatorService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  /**
   * Calculates the monthly mortgage payment locally (no API call needed).
   * M = P * (r(1+r)^n) / ((1+r)^n - 1)
   */
  calculateLocally(input: MortgageInput): MortgageResult {
    const P = input.purchasePrice - input.downPayment - (input.grantDpa || 0);
    const r = input.interestRate / 12 / 100;
    const n = input.loanTermYears * 12;

    let monthlyMortgage: number;
    if (r === 0 || n === 0) {
      monthlyMortgage = n > 0 ? P / n : 0;
    } else {
      monthlyMortgage = P * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
    }

    const totalMonthly =
      monthlyMortgage +
      (input.pmi || 0) +
      (input.propertyTax || 0) +
      (input.homeInsurance || 180);

    return {
      monthlyMortgage: parseFloat(monthlyMortgage.toFixed(2)),
      totalMonthlyPayment: parseFloat(totalMonthly.toFixed(2)),
      principal: P,
      breakdown: {
        principalAndInterest: parseFloat(monthlyMortgage.toFixed(2)),
        pmi: input.pmi || 0,
        propertyTax: input.propertyTax || 0,
        homeInsurance: input.homeInsurance || 180
      }
    };
  }

  /**
   * Calculates via backend API (for server-side validation).
   */
  calculateViaApi(input: MortgageInput): Observable<MortgageResult> {
    return this.http.post<MortgageResult>(`${this.apiUrl}/calculate`, input);
  }
}
