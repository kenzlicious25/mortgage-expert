import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
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
    MatDividerModule
  ],
  templateUrl: './calculator.component.html',
  styleUrls: ['./calculator.component.scss']
})
export class CalculatorComponent implements OnInit, OnDestroy {
  form!: FormGroup;
  result: MortgageResult | null = null;
  addressSuggestions: PlacePrediction[] = [];
  propertyTaxNote = '';
  loadingPropertyTax = false;
  loadingAddresses = false;

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

  private buildForm(): void {
    this.form = this.fb.group(
      {
        address: [''],
        loanType: ['Conventional', Validators.required],
        loanTerm: [30, Validators.required],
        purchasePrice: [null, [Validators.required, Validators.min(1)]],
        downPayment: [null, [Validators.required, Validators.min(0)]],
        grantDpa: [0, [Validators.min(0)]],
        interestRate: [null, [Validators.required, Validators.min(0.01), Validators.max(30)]],
        pmi: [0, [Validators.min(0)]],
        homeInsurance: [180, [Validators.required, Validators.min(0)]],
        propertyTax: [null, [Validators.min(0)]]
      },
      { validators: [this.downPaymentValidator, this.grantDpaValidator] }
    );
  }

  private setupAddressAutocomplete(): void {
    const addressSub = this.addressInput$
      .pipe(
        debounceTime(300),
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
    this.subs.add(addressSub);
  }

  private setupRealtimeCalculation(): void {
    const calcSub = this.form.valueChanges.subscribe(() => {
      if (this.form.valid) {
        this.calculate();
      } else {
        this.result = null;
      }
    });
    this.subs.add(calcSub);
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

  private fetchPropertyTax(address: string): void {
    this.loadingPropertyTax = true;
    this.propertyTaxNote = '';
    this.propertyTaxService.lookupPropertyTax(address).subscribe(result => {
      this.loadingPropertyTax = false;
      if (result.monthlyTax !== null) {
        this.form.get('propertyTax')!.setValue(result.monthlyTax);
        this.propertyTaxNote = `Auto-fetched from ${result.source} (${this.formatCurrency(result.annualTax! / 12)} /month)`;
      } else {
        this.propertyTaxNote = result.note || 'Please enter property tax manually.';
      }
    });
  }

  calculate(): void {
    if (!this.form.valid) return;
    const v = this.form.value;
    this.result = this.calculatorService.calculateLocally({
      purchasePrice: v.purchasePrice,
      downPayment: v.downPayment,
      grantDpa: v.grantDpa || 0,
      interestRate: v.interestRate,
      loanTermYears: v.loanTerm,
      pmi: v.pmi || 0,
      homeInsurance: v.homeInsurance || 180,
      propertyTax: v.propertyTax || 0
    });
  }

  resetForm(): void {
    this.form.reset({
      loanType: 'Conventional',
      loanTerm: 30,
      homeInsurance: 180,
      grantDpa: 0,
      pmi: 0
    });
    this.result = null;
    this.propertyTaxNote = '';
    this.addressSuggestions = [];
  }

  loanTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      'Conventional': 'home',
      'FHA': 'account_balance',
      'VA': 'military_tech',
      'Jumbo': 'villa'
    };
    return icons[type] || 'home';
  }

  formatCurrency(value: number | null): string {
    if (value === null || value === undefined) return '$0';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(value);
  }

  // Cross-field validators
  private downPaymentValidator(group: AbstractControl): ValidationErrors | null {
    const price = group.get('purchasePrice')?.value;
    const down = group.get('downPayment')?.value;
    if (price !== null && down !== null && down > price) {
      return { downPaymentExceedsPrice: true };
    }
    return null;
  }

  private grantDpaValidator(group: AbstractControl): ValidationErrors | null {
    const price = group.get('purchasePrice')?.value;
    const down = group.get('downPayment')?.value;
    const grant = group.get('grantDpa')?.value;
    if (price !== null && down !== null && grant !== null && grant > price + down) {
      return { grantExceedsLimit: true };
    }
    return null;
  }

  get downPaymentError(): boolean {
    return this.form.hasError('downPaymentExceedsPrice');
  }

  get grantDpaError(): boolean {
    return this.form.hasError('grantExceedsLimit');
  }
}
