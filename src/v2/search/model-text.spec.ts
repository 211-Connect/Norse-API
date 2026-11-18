import { modelText } from './model-text';

describe('modelText', () => {
  it.each([
    ['FOOD PANTRY', 'food pantry'],
    ['  food   pantry  ', 'food pantry'],
    ['food\t\npantry', 'food pantry'],
    ['food pantry?', 'food pantry'],
    ['food pantry ?!', 'food pantry'],
    ['food pantry...', 'food pantry'],
    ['¿Dónde hay comida?', 'dónde hay comida'],
    ['¡Ayuda!', 'ayuda'],
    ['ÉCOLE', 'école'],
    ['rent? due friday', 'rent? due friday'],
    ['', ''],
    ['   ', ''],
  ])('%j -> %j', (input, expected) => {
    expect(modelText(input)).toBe(expected);
  });

  it('keeps a punctuation-only query so it still reaches the classifier', () => {
    expect(modelText('???')).toBe('???');
    expect(modelText('  ? ! ?  ')).toBe('? ! ?');
  });

  it('normalizes to NFC', () => {
    const decomposed = 'é';
    const composed = 'é';
    expect(modelText(composed)).toBe(composed);
    expect(modelText(decomposed)).toBe(composed);
  });
});
