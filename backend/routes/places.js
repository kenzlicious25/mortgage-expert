const express = require('express');
const axios = require('axios');
const router = express.Router();

/**
 * GET /api/places/autocomplete?input=<address>
 * Proxies Google Places Autocomplete API to hide API key from frontend
 */
router.get('/autocomplete', async (req, res) => {
  const { input } = req.query;
  if (!input || input.trim().length < 2) {
    return res.json({ predictions: [] });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || apiKey === 'your_google_places_api_key_here') {
    // Return mock suggestions when no API key is configured
    return res.json({
      predictions: [],
      note: 'Google Places API key not configured. Please add GOOGLE_PLACES_API_KEY to your .env file.'
    });
  }

  try {
    const response = await axios.get(
      'https://maps.googleapis.com/maps/api/place/autocomplete/json',
      {
        params: {
          input: input.trim(),
          types: 'address',
          components: 'country:us',
          key: apiKey
        }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Google Places API error:', error.message);
    res.status(500).json({ error: 'Failed to fetch address suggestions', predictions: [] });
  }
});

module.exports = router;
