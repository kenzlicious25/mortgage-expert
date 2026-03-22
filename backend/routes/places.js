const express = require('express');
const axios = require('axios');
const router = express.Router();

// Browser-like headers to avoid bot detection
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Cache-Control': 'max-age=0',
};

/**
 * GET /api/places/autocomplete?input=<address>
 * Tries Google Places first; falls back to OpenStreetMap Nominatim (free, no key required).
 */
router.get('/autocomplete', async (req, res) => {
  const { input } = req.query;
  if (!input || input.trim().length < 2) {
    return res.json({ predictions: [] });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (apiKey && apiKey !== 'your_google_places_api_key_here') {
    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/place/autocomplete/json',
        {
          params: {
            input: input.trim(),
            types: 'address',
            components: 'country:us',
            key: apiKey
          },
          timeout: 5000
        }
      );
      if (response.data?.predictions?.length > 0) {
        return res.json(response.data);
      }
    } catch (error) {
      console.warn('Google Places API error, falling back to Nominatim:', error.message);
    }
  }

  // Fallback: OpenStreetMap Nominatim (free, no API key required)
  try {
    const nominatimRes = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: input.trim(),
        format: 'json',
        addressdetails: 1,
        limit: 8,
        countrycodes: 'us',
        dedupe: 1
      },
      headers: {
        'User-Agent': 'MortgageExpert/1.0 (homebuyer calculator; contact@mortgageexpert.com)',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 8000
    });

    const predictions = (nominatimRes.data || []).map(r => ({
      description: r.display_name,
      place_id: String(r.place_id)
    }));

    return res.json({ predictions, source: 'nominatim' });
  } catch (error) {
    console.error('Nominatim fallback failed:', error.message);
    return res.json({ predictions: [] });
  }
});

module.exports = router;
