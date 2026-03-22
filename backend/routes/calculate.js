const express = require('express');
const router = express.Router();

/**
 * POST /api/calculate
 * Calculates monthly mortgage payment server-side.
 * Body: { purchasePrice, downPayment, grantDpa, interestRate, loanTermYears, pmi, homeInsurance, propertyTax }
 */
router.post('/', (req, res) => {
  const {
    purchasePrice,
    downPayment,
    grantDpa,
    interestRate,
    loanTermYears,
    pmi,
    homeInsurance,
    propertyTax
  } = req.body;

  // Validation
  const errors = [];
  if (!purchasePrice || purchasePrice <= 0) errors.push('Purchase price must be positive');
  if (downPayment < 0) errors.push('Down payment must be non-negative');
  if (downPayment > purchasePrice) errors.push('Down payment cannot exceed purchase price');
  if (grantDpa < 0) errors.push('Grant/DPA must be non-negative');
  if (grantDpa > purchasePrice + downPayment) errors.push('Grant/DPA cannot exceed purchase price + down payment');
  if (!interestRate || interestRate <= 0) errors.push('Interest rate must be positive');
  if (![15, 20, 30].includes(Number(loanTermYears))) errors.push('Loan term must be 15, 20, or 30 years');

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  const P = purchasePrice - downPayment - (grantDpa || 0);
  const r = interestRate / 12 / 100;
  const n = loanTermYears * 12;

  let monthlyMortgage;
  if (r === 0) {
    monthlyMortgage = P / n;
  } else {
    monthlyMortgage = P * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  }

  const totalMonthly =
    monthlyMortgage +
    (pmi || 0) +
    (propertyTax || 0) +
    (homeInsurance || 180);

  res.json({
    monthlyMortgage: parseFloat(monthlyMortgage.toFixed(2)),
    totalMonthlyPayment: parseFloat(totalMonthly.toFixed(2)),
    principal: P,
    breakdown: {
      principalAndInterest: parseFloat(monthlyMortgage.toFixed(2)),
      pmi: pmi || 0,
      propertyTax: propertyTax || 0,
      homeInsurance: homeInsurance || 180
    }
  });
});

module.exports = router;
