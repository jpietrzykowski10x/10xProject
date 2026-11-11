import { toNameKey } from './name-key.js';

describe('toNameKey', () => {
  it.each([
    ['Ślub', 'ślub'],
    ['ŻYCIE', 'życie'],
    ['Łódź', 'łódź'],
    ['ĄĆĘŁŃÓŚŹŻ', 'ąćęłńóśźż'],
    ['Prasa i Książki', 'prasa i książki'],
    ['Netflix', 'netflix'],
  ])('folds %s to %s', (name, key) => {
    expect(toNameKey(name)).toBe(key);
  });

  it('gives the same key for names that differ only in case', () => {
    expect(toNameKey('ślub')).toBe(toNameKey('ŚLUB'));
    expect(toNameKey('żółw')).toBe(toNameKey('Żółw'));
  });

  it('leaves a lowercase name and its spaces as they are', () => {
    expect(toNameKey('dom i usługi')).toBe('dom i usługi');
    expect(toNameKey(' a ')).toBe(' a ');
  });
});
