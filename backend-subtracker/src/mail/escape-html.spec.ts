import { escapeHtml } from './escape-html.js';

describe('escapeHtml', () => {
  it('escapes the characters that are special in HTML', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHtml('jan.kowalski@example.com')).toBe(
      'jan.kowalski@example.com',
    );
  });
});
