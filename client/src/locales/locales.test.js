import test from 'node:test';
import assert from 'node:assert/strict';
import en from './en/translation.json' with { type: 'json' };
import hi from './hi/translation.json' with { type: 'json' };
import mr from './mr/translation.json' with { type: 'json' };
import i18n, { getStoredLanguage, persistLanguage, LANGUAGE_STORAGE_KEY, supportedLanguages } from './index.js';

test('all initial locale catalogs have complete, matching key coverage', () => {
  const expected = Object.keys(en).sort();
  assert.ok(expected.length > 0);
  assert.deepEqual(Object.keys(hi).sort(), expected);
  assert.deepEqual(Object.keys(mr).sort(), expected);
  for (const catalog of [en, hi, mr]) {
    for (const key of expected) assert.equal(typeof catalog[key], 'string', `${key} must be a string`);
  }
});

test('language switching selects translated interface strings', async () => {
  for (const language of supportedLanguages) {
    await i18n.changeLanguage(language);
    assert.equal(i18n.language, language);
    assert.equal(typeof i18n.t('nav.overview'), 'string');
  }
  assert.notEqual(i18n.t('nav.overview', { lng: 'hi' }), i18n.t('nav.overview', { lng: 'en' }));
  assert.notEqual(i18n.t('nav.overview', { lng: 'mr' }), i18n.t('nav.overview', { lng: 'en' }));
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  await i18n.changeLanguage('mr');
  assert.equal(values.get(LANGUAGE_STORAGE_KEY), 'mr');
  assert.equal(getStoredLanguage(globalThis.localStorage), 'mr');
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
  await i18n.changeLanguage('en');
});

test('language preference persists and rejects unsupported language codes', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(persistLanguage('hi', storage), true);
  assert.equal(values.get(LANGUAGE_STORAGE_KEY), 'hi');
  assert.equal(getStoredLanguage(storage), 'hi');
  assert.equal(persistLanguage('fr', storage), false);
  values.set(LANGUAGE_STORAGE_KEY, 'fr');
  assert.equal(getStoredLanguage(storage), 'en');
});

test('missing keys fall back to English', async () => {
  i18n.addResource('en', 'translation', 'fallback.coverageProbe', 'Coverage probe');
  await i18n.changeLanguage('hi');
  assert.equal(i18n.t('fallback.coverageProbe'), 'Coverage probe');
  i18n.removeResourceBundle('en', 'translation');
  i18n.addResourceBundle('en', 'translation', en, true, true);
  await i18n.changeLanguage('en');
});
