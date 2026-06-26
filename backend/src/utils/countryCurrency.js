/**
 * ISO country code → ISO currency code + symbol. This is a factual mapping
 * (not a business decision), so it lives in code rather than in admin-editable
 * config — only the actual INR conversion rate per currency is admin-configurable
 * (see models/CurrencyConfig.js). Covers the markets Dhara is realistically
 * seeing traffic from; unmapped countries simply show the INR price alone.
 */
export const COUNTRY_CURRENCY = {
  US: { currencyCode: 'USD', symbol: '$' },
  GB: { currencyCode: 'GBP', symbol: '£' },
  CA: { currencyCode: 'CAD', symbol: 'CA$' },
  AU: { currencyCode: 'AUD', symbol: 'A$' },
  AE: { currencyCode: 'AED', symbol: 'AED' },
  SA: { currencyCode: 'SAR', symbol: 'SAR' },
  QA: { currencyCode: 'QAR', symbol: 'QAR' },
  KW: { currencyCode: 'KWD', symbol: 'KWD' },
  BH: { currencyCode: 'BHD', symbol: 'BHD' },
  OM: { currencyCode: 'OMR', symbol: 'OMR' },
  SG: { currencyCode: 'SGD', symbol: 'S$' },
  MY: { currencyCode: 'MYR', symbol: 'RM' },
  BD: { currencyCode: 'BDT', symbol: '৳' },
  NP: { currencyCode: 'NPR', symbol: 'Rs' },
  LK: { currencyCode: 'LKR', symbol: 'Rs' },
  PK: { currencyCode: 'PKR', symbol: 'Rs' },
  DE: { currencyCode: 'EUR', symbol: '€' },
  FR: { currencyCode: 'EUR', symbol: '€' },
  IT: { currencyCode: 'EUR', symbol: '€' },
  ES: { currencyCode: 'EUR', symbol: '€' },
  NL: { currencyCode: 'EUR', symbol: '€' },
  IE: { currencyCode: 'EUR', symbol: '€' },
  JP: { currencyCode: 'JPY', symbol: '¥' },
  CN: { currencyCode: 'CNY', symbol: '¥' },
  ZA: { currencyCode: 'ZAR', symbol: 'R' },
  NZ: { currencyCode: 'NZD', symbol: 'NZ$' },
  CH: { currencyCode: 'CHF', symbol: 'CHF' },
}

/** Returns { currencyCode, symbol } for a country, or null if unmapped. */
export function currencyForCountry(countryCode) {
  return COUNTRY_CURRENCY[countryCode] || null
}
