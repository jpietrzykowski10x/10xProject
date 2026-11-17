import { TestBed } from '@angular/core/testing';
import { DuplicateWarningIcon } from './duplicate-warning-icon';

describe('DuplicateWarningIcon', () => {
  async function createIcon(level: 'reached' | 'exceeded', label: string | null = null) {
    const fixture = TestBed.createComponent(DuplicateWarningIcon);
    fixture.componentRef.setInput('level', level);
    fixture.componentRef.setInput('label', label);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('should create', async () => {
    const host = await createIcon('reached');

    expect(host.querySelector('svg')).toBeTruthy();
  });

  it('carries its level for the colour', async () => {
    expect((await createIcon('exceeded')).getAttribute('data-warning')).toBe('exceeded');
  });

  // Colour is never the only information: a labelled icon is an image with a name, an unlabelled
  // one is hidden because the text next to it says what happened.
  it('is an image named by its label, or hidden without one', async () => {
    const labelled = (await createIcon('exceeded', '1 kategoria przekroczyła próg')).querySelector(
      'svg',
    );
    expect(labelled?.getAttribute('role')).toBe('img');
    expect(labelled?.getAttribute('aria-label')).toBe('1 kategoria przekroczyła próg');
    expect(labelled?.hasAttribute('aria-hidden')).toBe(false);

    const decorative = (await createIcon('reached')).querySelector('svg');
    expect(decorative?.hasAttribute('role')).toBe(false);
    expect(decorative?.getAttribute('aria-hidden')).toBe('true');
  });
});
