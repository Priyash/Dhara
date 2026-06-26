// Poster gradient palettes — used as CSS background fallback when no posterUrl is set
export const PALETTES = [
  'linear-gradient(135deg,#1a0533 0%,#4a0e8f 100%)',
  'linear-gradient(135deg,#0d1f3c 0%,#1a4a8a 100%)',
  'linear-gradient(135deg,#2d0a0a 0%,#8b1a1a 100%)',
  'linear-gradient(135deg,#0a2d1a 0%,#1a6b3a 100%)',
  'linear-gradient(135deg,#2d1a00 0%,#8b5e00 100%)',
  'linear-gradient(135deg,#1a0a2d 0%,#5e008b 100%)',
  'linear-gradient(135deg,#001a2d 0%,#006b8b 100%)',
  'linear-gradient(135deg,#2d0a1a 0%,#8b004a 100%)',
]

export const NAV_LINKS = ['Home', 'Movies', 'Series', 'ধারাবাহিক', 'Originals', 'Live', 'Reels']

export const PLANS = [
  {
    id:       'monthly',
    label:    'Monthly',
    tagline:  'Try it out',
    price:    '₹99',
    amountInr:99,
    priceNote:'₹99 / month',
    sub:      'per month',
    badge:    null,
    features: [
      '1 screen at a time',
      'Up to 720p HD',
      'All Bengali films & series',
      'Cancel anytime',
    ],
  },
  {
    id:       'annual',
    label:    'Annual',
    tagline:  'Most popular',
    price:    '₹599',
    amountInr:599,
    priceNote:'₹49 / month, billed yearly',
    sub:      'per year',
    badge:    'SAVE 50%',
    features: [
      '2 screens at once',
      'Full HD 1080p',
      'All Bengali films & series',
      'Save ₹589 vs monthly',
    ],
  },
  {
    id:       'family',
    label:    'Family',
    tagline:  'Watch together',
    price:    '₹999',
    amountInr:999,
    priceNote:'₹83 / month, billed yearly',
    sub:      'per year · up to 4 screens',
    badge:    'BEST VALUE',
    features: [
      '4 screens simultaneously',
      '4K Ultra HD, no limits',
      'All Bengali films & series',
      'Best value for families',
    ],
  },
]
