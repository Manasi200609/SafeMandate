export const CURRENCY_MINOR_UNITS = Object.freeze({ INR: 2, USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, NZD: 2, SGD: 2, CHF: 2, CNY: 2, AED: 2, SAR: 2, JPY: 0, KRW: 0, KWD: 3, BHD: 3 });
export const SUPPORTED_CURRENCIES = Object.freeze(Object.keys(CURRENCY_MINOR_UNITS));
export const isSupportedCurrency = (code) => Object.hasOwn(CURRENCY_MINOR_UNITS, code);
