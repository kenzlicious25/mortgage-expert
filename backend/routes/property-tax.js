const express = require('express');
const axios = require('axios');
const router = express.Router();

// ─── US State average effective property tax rates (2023, Tax Foundation) ───
const STATE_TAX_RATES = {
  AL: 0.0042, AK: 0.0098, AZ: 0.0063, AR: 0.0062, CA: 0.0076,
  CO: 0.0051, CT: 0.0218, DE: 0.0057, FL: 0.0089, GA: 0.0092,
  HI: 0.0028, ID: 0.0069, IL: 0.0227, IN: 0.0085, IA: 0.0153,
  KS: 0.0138, KY: 0.0086, LA: 0.0055, ME: 0.0136, MD: 0.0110,
  MA: 0.0123, MI: 0.0154, MN: 0.0110, MS: 0.0065, MO: 0.0097,
  MT: 0.0084, NE: 0.0161, NV: 0.0060, NH: 0.0218, NJ: 0.0247,
  NM: 0.0077, NY: 0.0172, NC: 0.0084, ND: 0.0098, OH: 0.0153,
  OK: 0.0090, OR: 0.0097, PA: 0.0150, RI: 0.0155, SC: 0.0057,
  SD: 0.0117, TN: 0.0071, TX: 0.0180, UT: 0.0058, VT: 0.0188,
  VA: 0.0082, WA: 0.0098, WV: 0.0059, WI: 0.0185, WY: 0.0057,
  DC: 0.0085
};

const STATE_NAMES = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
  Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
  Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX',
  Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV',
  Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC'
};

// Browser-like headers to avoid bot detection
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Cache-Control': 'max-age=0',
};

/**
 * Extract state abbreviation from an address string.
 * Handles "City, ST 12345" and "City, StateName, Country" formats.
 */
function extractState(address) {
  // Match ", TX 78701" or ", TX," patterns
  const abbr = address.match(/,\s*([A-Z]{2})(?:\s+\d{5})?(?:,|\s*$)/);
  if (abbr) return abbr[1].toUpperCase();

  // Match full state name
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (address.toLowerCase().includes(name.toLowerCase())) return code;
  }
  return null;
}

/**
 * Try to find a tax amount in a JSON blob using multiple search paths.
 * Returns the annual tax as a number, or null.
 */
function extractTaxFromObj(obj) {
  if (!obj || typeof obj !== 'object') return null;

  // Direct taxHistory array
  const taxHistory = obj.taxHistory || obj.propertyTaxHistory;
  if (Array.isArray(taxHistory) && taxHistory.length > 0) {
    for (const entry of taxHistory) {
      const amount = entry.taxPaid || entry.value || entry.taxAmount || entry.amount;
      if (amount && Number(amount) > 0) return Number(amount);
    }
  }

  // taxAssessment / assessment map (keyed by year)
  const assessment = obj.taxAssessment || obj.assessment;
  if (assessment && typeof assessment === 'object') {
    const years = Object.keys(assessment).sort().reverse();
    for (const yr of years) {
      const val = assessment[yr]?.value || assessment[yr]?.taxPaid || assessment[yr];
      if (val && Number(val) > 0) return Number(val);
    }
  }

  // Direct taxAnnualAmount, annualPropertyTax
  const direct = obj.taxAnnualAmount || obj.annualPropertyTax || obj.taxAmount || obj.propertyTaxRate;
  if (direct && Number(direct) > 0) return Number(direct);

  return null;
}

/**
 * Scrape Zillow for property tax data.
 * Extracts the embedded __NEXT_DATA__ JSON and searches multiple paths.
 */
async function scrapeZillow(address) {
  // Build Zillow search URL
  const slug = address.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  const searchUrl = `https://www.zillow.com/homes/${encodeURIComponent(address)}_rb/`;

  let html = '';
  try {
    const response = await axios.get(searchUrl, {
      headers: { ...BROWSER_HEADERS, Referer: 'https://www.zillow.com/' },
      timeout: 12000,
      maxRedirects: 5,
    });
    html = response.data;
  } catch (err) {
    // Try alternate URL format
    try {
      const altUrl = `https://www.zillow.com/homes/${slug}_rb/`;
      const r2 = await axios.get(altUrl, {
        headers: { ...BROWSER_HEADERS, Referer: 'https://www.zillow.com/' },
        timeout: 12000,
        maxRedirects: 5,
      });
      html = r2.data;
    } catch (e) {
      console.warn('Zillow fetch failed:', e.message);
      return null;
    }
  }

  if (!html || typeof html !== 'string') return null;

  // ── Method 1: Parse __NEXT_DATA__ JSON ─────────────────────────────────
  const nextMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i)
    || html.match(/<script[^>]*type="application\/json"[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);

  if (nextMatch) {
    try {
      const nextData = JSON.parse(nextMatch[1]);
      // Walk all nested values looking for taxHistory
      const found = walkForTax(nextData);
      if (found) return found;
    } catch (e) { /* continue */ }
  }

  // ── Method 2: taxHistory inline JSON ───────────────────────────────────
  const taxHistMatch = html.match(/"taxHistory"\s*:\s*(\[[^\]]*\])/);
  if (taxHistMatch) {
    try {
      const entries = JSON.parse(taxHistMatch[1]);
      if (Array.isArray(entries) && entries.length > 0) {
        for (const e of entries) {
          const amt = e.taxPaid || e.value || e.taxAmount;
          if (amt && Number(amt) > 0) return Number(amt);
        }
      }
    } catch (e) { /* continue */ }
  }

  // ── Method 3: Single taxPaid / taxAnnualAmount value ───────────────────
  const patterns = [
    /"taxPaid"\s*:\s*(\d+(?:\.\d+)?)/,
    /"taxAnnualAmount"\s*:\s*(\d+(?:\.\d+)?)/,
    /"annualPropertyTax"\s*:\s*(\d+(?:\.\d+)?)/,
    /"propertyTaxRate"\s*:\s*(\d+(?:\.\d+)?)/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m && Number(m[1]) > 0) return Number(m[1]);
  }

  return null;
}

/**
 * Recursively walk an object for any tax-related arrays/values.
 */
function walkForTax(obj, depth = 0) {
  if (depth > 12 || !obj || typeof obj !== 'object') return null;

  // If it's a string that looks like JSON, try to parse
  if (typeof obj === 'string' && obj.startsWith('{')) {
    try { obj = JSON.parse(obj); } catch (e) { return null; }
  }

  // Try to extract directly
  const direct = extractTaxFromObj(obj);
  if (direct) return direct;

  // Recurse into children
  for (const key of Object.keys(obj)) {
    const child = obj[key];
    if (!child || typeof child !== 'object') continue;
    const result = walkForTax(child, depth + 1);
    if (result) return result;
  }
  return null;
}

/**
 * Try Realtor.com as a second scraping source.
 */
async function scrapeRealtor(address) {
  // Build a search slug
  const slug = address.trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '_');

  const url = `https://www.realtor.com/realestateandhomes-search/${slug}`;
  try {
    const response = await axios.get(url, {
      headers: {
        ...BROWSER_HEADERS,
        Accept: 'text/html,application/xhtml+xml',
        Referer: 'https://www.realtor.com/',
      },
      timeout: 10000,
      maxRedirects: 3,
    });
    const html = response.data;

    // Look for annual_tax_amount or similar in embedded JSON
    const patterns = [
      /"annual_tax_amount"\s*:\s*(\d+(?:\.\d+)?)/,
      /"propertyTaxes"\s*:\s*(\d+(?:\.\d+)?)/,
      /"taxAmount"\s*:\s*(\d+(?:\.\d+)?)/,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m && Number(m[1]) > 0) return Number(m[1]);
    }
  } catch (e) {
    console.warn('Realtor.com scrape failed:', e.message);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/property-tax?address=<full address>
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { address } = req.query;
  if (!address || address.trim().length === 0) {
    return res.status(400).json({ error: 'Address is required' });
  }

  const addr = address.trim();
  const stateCode = extractState(addr);
  const stateTaxRate = stateCode ? (STATE_TAX_RATES[stateCode] || 0.011) : 0.011;

  // ── 1. Try ATTOM Data API (if key configured) ─────────────────────────
  const attomKey = process.env.ATTOM_API_KEY;
  if (attomKey && attomKey !== 'your_attom_api_key_here') {
    try {
      const r = await axios.get(
        'https://api.gateway.attomdata.com/propertyapi/v1.0.0/assessmenthistory/detail',
        {
          headers: { apikey: attomKey, accept: 'application/json' },
          params: { address: addr },
          timeout: 8000,
        }
      );
      const property = r.data?.property?.[0];
      if (property) {
        const annualTax =
          property.assessment?.tax?.taxamt ||
          (property.assessment?.assessed?.assdttlvalue * stateTaxRate) ||
          null;
        if (annualTax) {
          return res.json({
            annualTax: parseFloat(annualTax),
            monthlyTax: parseFloat((annualTax / 12).toFixed(2)),
            source: 'ATTOM',
            address: addr,
            stateTaxRate,
          });
        }
      }
    } catch (e) {
      console.warn('ATTOM API failed:', e.message);
    }
  }

  // ── 2. Try Zillow scraping ────────────────────────────────────────────
  try {
    const annualTax = await scrapeZillow(addr);
    if (annualTax && annualTax > 0) {
      return res.json({
        annualTax: parseFloat(annualTax.toFixed(2)),
        monthlyTax: parseFloat((annualTax / 12).toFixed(2)),
        source: 'Zillow',
        address: addr,
        stateTaxRate,
      });
    }
  } catch (e) {
    console.warn('Zillow scrape failed:', e.message);
  }

  // ── 3. Try Realtor.com scraping ───────────────────────────────────────
  try {
    const annualTax = await scrapeRealtor(addr);
    if (annualTax && annualTax > 0) {
      return res.json({
        annualTax: parseFloat(annualTax.toFixed(2)),
        monthlyTax: parseFloat((annualTax / 12).toFixed(2)),
        source: 'Realtor.com',
        address: addr,
        stateTaxRate,
      });
    }
  } catch (e) {
    console.warn('Realtor.com scrape failed:', e.message);
  }

  // ── 4. Always return state rate for frontend to estimate ─────────────
  res.json({
    annualTax: null,
    monthlyTax: null,
    source: 'estimate',
    address: addr,
    stateTaxRate,
    stateCode,
    note: stateCode
      ? `Using ${stateCode} average rate (${(stateTaxRate * 100).toFixed(2)}%) — enter your actual tax bill for accuracy.`
      : 'Could not determine state. Enter property tax manually.',
  });
});

module.exports = router;
