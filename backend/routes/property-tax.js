const express = require('express');
const axios = require('axios');
const router = express.Router();

/**
 * GET /api/property-tax?address=<full address>
 * Attempts to look up annual property tax from Zillow/ATTOM or falls back gracefully.
 */
router.get('/', async (req, res) => {
  const { address } = req.query;
  if (!address || address.trim().length === 0) {
    return res.status(400).json({ error: 'Address is required' });
  }

  // Try Zillow API via Bridgedata / ATTOM if key is provided
  const attomApiKey = process.env.ATTOM_API_KEY;
  if (attomApiKey && attomApiKey !== 'your_attom_api_key_here') {
    try {
      const response = await axios.get(
        'https://api.gateway.attomdata.com/propertyapi/v1.0.0/assessmenthistory/detail',
        {
          headers: {
            apikey: attomApiKey,
            accept: 'application/json'
          },
          params: { address: address.trim() }
        }
      );

      const property = response.data?.property?.[0];
      if (property) {
        const annualTax =
          property.assessment?.tax?.taxamt ||
          property.assessment?.assessed?.assdttlvalue * 0.012 ||
          null;

        if (annualTax) {
          return res.json({
            annualTax: parseFloat(annualTax),
            monthlyTax: parseFloat((annualTax / 12).toFixed(2)),
            source: 'ATTOM',
            address: address
          });
        }
      }
    } catch (error) {
      console.warn('ATTOM API lookup failed:', error.message);
    }
  }

  // Fallback: return null so the frontend knows to show manual entry
  res.json({
    annualTax: null,
    monthlyTax: null,
    source: 'manual',
    address: address,
    note: 'Property tax data not available. Please enter manually.'
  });
});

module.exports = router;
