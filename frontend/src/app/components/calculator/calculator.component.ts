import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
  ValidationErrors,
  ValidatorFn,
} from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';

import { CalculatorService, MortgageResult } from '../../services/calculator.service';
import { PlacesService, PlacePrediction } from '../../services/places.service';
import { PropertyTaxService } from '../../services/property-tax.service';

// ── Module-level helpers ──────────────────────────────────────────────────────

/** Strip commas/currency symbols and return the numeric value. */
function parseCurrency(val: string | number | null | undefined): number {
  if (val === null || val === undefined || val === '') return 0;
  return parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0;
}

/** Format a number with thousands commas, up to 2 decimal places. */
function formatWithCommas(raw: string): string {
  if (!raw) return '';
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const parts = cleaned.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (parts.length > 1) {
    parts[1] = parts[1].slice(0, 2);
    return parts[0] + '.' + parts[1];
  }
  return parts[0];
}

/** Reactive-form validator that requires the field to parse to ≥ min. */
function currencyMin(min: number): ValidatorFn {
  return (ctrl: AbstractControl): ValidationErrors | null => {
    if (ctrl.value === null || ctrl.value === undefined || ctrl.value === '') return null;
    const v = parseCurrency(ctrl.value);
    return v < min ? { min: { min, actual: v } } : null;
  };
}

/** Cross-field validator: downPayment must not exceed purchasePrice. */
function downPaymentValidator(group: AbstractControl): ValidationErrors | null {
  const price = parseCurrency(group.get('purchasePrice')?.value);
  const down  = parseCurrency(group.get('downPayment')?.value);
  if (price > 0 && down > 0 && down > price) {
    return { downPaymentExceedsPrice: true };
  }
  return null;
}

/** Cross-field validator: grant/DPA must not exceed purchase price + down payment. */
function grantDpaValidator(group: AbstractControl): ValidationErrors | null {
  const price = parseCurrency(group.get('purchasePrice')?.value);
  const down  = parseCurrency(group.get('downPayment')?.value);
  const grant = parseCurrency(group.get('grantDpa')?.value);
  if (price > 0 && grant > 0 && grant > price + down) {
    return { grantExceedsLimit: true };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-calculator',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatRadioModule,
    MatButtonModule,
    MatIconModule,
    MatAutocompleteModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDividerModule,
  ],
  templateUrl: './calculator.component.html',
  styleUrls: ['./calculator.component.scss'],
})
export class CalculatorComponent implements OnInit, OnDestroy {
  form!: FormGroup;
  result: MortgageResult | null = null;
  addressSuggestions: PlacePrediction[] = [];
  propertyTaxNote = '';
  loadingPropertyTax = false;
  loadingAddresses = false;

  /** Stores the state tax rate returned by the backend for estimation fallback. */
  private stateTaxRate: number | null = null;
  private stateCode: string | null = null;

  readonly loanTypes = ['Conventional', 'FHA', 'VA', 'Jumbo'];
  readonly loanTerms = [15, 20, 30];

  private addressInput$ = new Subject<string>();
  private subs = new Subscription();

  constructor(
    private fb: FormBuilder,
    private calculatorService: CalculatorService,
    private placesService: PlacesService,
    private propertyTaxService: PropertyTaxService
  ) {}

  ngOnInit(): void {
    this.buildForm();
    this.setupAddressAutocomplete();
    this.setupRealtimeCalculation();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  // ── Form construction ──────────────────────────────────────────────────────

  private buildForm(): void {
    this.form = this.fb.group(
      {
        address:       [''],
        loanType:      ['Conventional', Validators.required],
        loanTerm:      [30, Validators.required],
        purchasePrice: ['',    [Validators.required, currencyMin(1)]],
        downPayment:   ['',    [Validators.required, currencyMin(0)]],
        grantDpa:      ['0',   [currencyMin(0)]],
        interestRate:  [null,  [Validators.required, Validators.min(0.01), Validators.max(30)]],
        pmi:           ['0',   [currencyMin(0)]],
        homeInsurance: ['180', [Validators.required, currencyMin(0)]],
        propertyTax:   ['',    [currencyMin(0)]],
      },
      { validators: [downPaymentValidator, grantDpaValidator] }
    );
  }

  // ── Address autocomplete ───────────────────────────────────────────────────

  private setupAddressAutocomplete(): void {
    const sub = this.addressInput$
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        switchMap(input => {
          this.loadingAddresses = true;
          return this.placesService.getAutocompleteSuggestions(input);
        })
      )
      .subscribe(response => {
        this.addressSuggestions = response.predictions || [];
        this.loadingAddresses = false;
      });
    this.subs.add(sub);
  }

  onAddressInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.addressInput$.next(value);
  }

  onAddressSelected(address: string): void {
    this.form.get('address')!.setValue(address);
    this.addressSuggestions = [];
    this.fetchPropertyTax(address);
  }

  // ── Property tax lookup ────────────────────────────────────────────────────

  private fetchPropertyTax(address: string): void {
    this.loadingPropertyTax = true;
    this.propertyTaxNote = 'Looking up property tax…';

    this.propertyTaxService.lookupPropertyTax(address).subscribe(result => {
      this.loadingPropertyTax = false;
      this.stateTaxRate = result.stateTaxRate ?? null;
      this.stateCode    = result.stateCode    ?? null;

      if (result.monthlyTax !== null && result.monthlyTax !== undefined) {
        // We have real Zillow / ATTOM data
        this.setCurrencyField('propertyTax', result.monthlyTax);
        this.propertyTaxNote =
          `✓ Auto-fetched from ${result.source}: ${this.formatCurrency(result.monthlyTax)}/mo ` +
          `(${this.formatCurrency(result.annualTax!)}/yr)`;
      } else if (result.source === 'estimate' && result.stateTaxRate) {
        // Backend returned a state-average rate – estimate from purchase price
        const purchasePrice = parseCurrency(this.form.get('purchasePrice')?.value);
        if (purchasePrice > 0) {
          const estimated = parseFloat(((purchasePrice * result.stateTaxRate) / 12).toFixed(2));
          this.setCurrencyField('propertyTax', estimated);
          this.propertyTaxNote =
            `⚠ Estimated from ${result.stateCode} avg rate ` +
            `(${(result.stateTaxRate * 100).toFixed(2)}%): ` +
            `${this.formatCurrency(estimated)}/mo — verify with your county assessor.`;
        } else {
          this.propertyTaxNote =
            result.note || `Enter purchase price first for a ${result.stateCode} tax estimate.`;
        }
      } else {
        this.propertyTaxNote = result.note || 'Property tax not found. Please enter manually.';
      }
    });
  }

  // ── Real-time calculation ──────────────────────────────────────────────────

  private setupRealtimeCalculation(): void {
    const sub = this.form.valueChanges.subscribe(() => {
      if (this.form.valid) {
        this.calculate();
      } else {
        this.result = null;
      }
    });
    this.subs.add(sub);
  }

  calculate(): void {
    if (!this.form.valid) return;
    const v = this.form.value;
    this.result = this.calculatorService.calculateLocally({
      purchasePrice: parseCurrency(v.purchasePrice),
      downPayment:   parseCurrency(v.downPayment),
      grantDpa:      parseCurrency(v.grantDpa)     || 0,
      interestRate:  v.interestRate,
      loanTermYears: v.loanTerm,
      pmi:           parseCurrency(v.pmi)           || 0,
      homeInsurance: parseCurrency(v.homeInsurance) || 180,
      propertyTax:   parseCurrency(v.propertyTax)  || 0,
    });
  }

  resetForm(): void {
    this.form.reset({
      loanType:      'Conventional',
      loanTerm:      30,
      homeInsurance: '180',
      grantDpa:      '0',
      pmi:           '0',
      address:       '',
      purchasePrice: '',
      downPayment:   '',
      interestRate:  null,
      propertyTax:   '',
    });
    this.result         = null;
    this.propertyTaxNote = '';
    this.addressSuggestions = [];
    this.stateTaxRate   = null;
    this.stateCode      = null;
  }

  // ── Currency input formatting ──────────────────────────────────────────────

  /**
   * Called on every keystroke in a currency text input.
   * Formats the displayed value with commas and updates the form control
   * with the formatted string (validators parse it back to a number).
   */
  formatCurrencyInput(event: Event, field: string): void {
    const input = event.target as HTMLInputElement;
    const cursorPos = input.selectionStart ?? input.value.length;
    const prevLen   = input.value.length;

    const formatted = formatWithCommas(input.value);
    input.value = formatted;

    // Restore cursor, accounting for the added/removed comma characters
    const delta    = formatted.length - prevLen;
    const newCursor = Math.max(0, cursorPos + delta);
    input.setSelectionRange(newCursor, newCursor);

    this.form.get(field)?.setValue(formatted, { emitEvent: true });
  }

  /** Programmatically set a currency field value with proper comma formatting. */
  private setCurrencyField(field: string, value: number): void {
    const formatted = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
    this.form.get(field)?.setValue(formatted, { emitEvent: true });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  loanTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      Conventional: 'home',
      FHA:          'account_balance',
      VA:           'military_tech',
      Jumbo:        'villa',
    };
    return icons[type] || 'home';
  }

  formatCurrency(value: number | null): string {
    if (value === null || value === undefined) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }

  get downPaymentError(): boolean {
    return this.form.hasError('downPaymentExceedsPrice');
  }

  get grantDpaError(): boolean {
    return this.form.hasError('grantExceedsLimit');
  }

  get taxNoteIsSuccess(): boolean {
    return !this.loadingPropertyTax && this.propertyTaxNote.startsWith('✓');
  }

  get taxNoteIsWarning(): boolean {
    return !this.loadingPropertyTax && this.propertyTaxNote.startsWith('⚠');
  }
}
