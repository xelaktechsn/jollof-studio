// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Mamadou Sarr
import { assertDoc } from './rich-doc';

const p = (...content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });

describe('documents riches', () => {
  it('accepte les nœuds et marques admis', () => {
    expect(() =>
      assertDoc(
        p(
          { type: 'text', text: 'a', marks: [{ type: 'bold' }, { type: 'highlight', attrs: { color: '#ff0' } }, { type: 'textStyle', attrs: { color: 'rgb(1, 2, 3)' } }] },
          { type: 'hardBreak' },
          { type: 'text', text: 'b', marks: [{ type: 'link', attrs: { href: 'http://example.org', target: '_blank' } }] },
        ),
        'd',
      ),
    ).not.toThrow();
  });

  it.each([
    ['nœud inconnu', { type: 'doc', content: [{ type: 'iframe' }] }],
    ['marque inconnue', p({ type: 'text', text: 'a', marks: [{ type: 'script' }] })],
    ['lien javascript', p({ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] })],
    ['lien data', p({ type: 'text', text: 'a', marks: [{ type: 'link', attrs: { href: 'data:text/html,x' } }] })],
    ['couleur CSS piégée', p({ type: 'text', text: 'a', marks: [{ type: 'textStyle', attrs: { color: 'red; background:url(x)' } }] })],
    ['attribut objet', p({ type: 'text', text: 'a', marks: [{ type: 'bold', attrs: { x: { y: 1 } } }] })],
    ['racine non doc', { type: 'paragraph' }],
    ['doc imbriqué', { type: 'doc', content: [{ type: 'doc' }] }],
    ['texte sans text', p({ type: 'text' })],
  ])('refuse : %s', (_, value) => {
    expect(() => assertDoc(value, 'd')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
  });

  it('limite la profondeur et la taille', () => {
    let deep: Record<string, unknown> = { type: 'paragraph' };
    for (let i = 0; i < 60; i++) deep = { type: 'blockquote', content: [deep] };
    expect(() => assertDoc({ type: 'doc', content: [deep] }, 'd')).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
    expect(() => assertDoc(p({ type: 'text', text: 'x'.repeat(201 * 1024) }), 'd')).toThrow(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
  });
});
