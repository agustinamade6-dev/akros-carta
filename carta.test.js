import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatPesos, mesaDesdeUrl, imagenSegura, normalizarCarta, filtrarCarta, formatFecha } from './carta.js';

const NBSP = / /g;

test('formatPesos: igual que el POS', () => {
  assert.equal(formatPesos(5500), '$5.500');
  assert.equal(formatPesos(1500.5), '$1.500,50');
  assert.equal(formatPesos(0), '$0');
  assert.equal(formatPesos(Number.NaN), '$0');
});

test('mesaDesdeUrl: solo números de mesa válidos', () => {
  assert.equal(mesaDesdeUrl('?mesa=5'), 5);
  assert.equal(mesaDesdeUrl('?mesa=12&x=1'), 12);
  assert.equal(mesaDesdeUrl(''), null);
  assert.equal(mesaDesdeUrl('?mesa=0'), null);
  assert.equal(mesaDesdeUrl('?mesa=-1'), null);
  assert.equal(mesaDesdeUrl('?mesa=5abc'), null);
  assert.equal(mesaDesdeUrl('?mesa=<script>'), null);
});

test('imagenSegura: solo https o rutas relativas', () => {
  assert.equal(imagenSegura('https://x.supabase.co/a.jpg'), 'https://x.supabase.co/a.jpg');
  assert.equal(imagenSegura('fotos/a.jpg'), 'fotos/a.jpg');
  assert.equal(imagenSegura('javascript:alert(1)'), '');
  assert.equal(imagenSegura('data:image/png;base64,AAA'), '');
  assert.equal(imagenSegura('http://inseguro/a.jpg'), '');
  assert.equal(imagenSegura(''), '');
  assert.equal(imagenSegura(null), '');
});

test('normalizarCarta: descarta productos inválidos y categorías vacías', () => {
  const carta = normalizarCarta({
    negocio: 'AKROS Café',
    publicadaEn: '2026-10-25T18:30:00.000Z',
    categorias: [
      { id: 1, nombre: 'Café', productos: [
        { id: 1, nombre: 'Cortado', descripcion: ' Chico ', precio: 1800, imagen: 'javascript:x' },
        { id: 2, nombre: '', precio: 100 },
        { id: 3, nombre: 'Sin precio' },
        { id: 4, nombre: 'Negativo', precio: -5 },
      ] },
      { id: 2, nombre: 'Vacía', productos: [] },
      { id: 3, nombre: '', productos: [{ nombre: 'x', precio: 1 }] },
    ],
  });
  assert.equal(carta.categorias.length, 1);
  assert.deepEqual(carta.categorias[0].productos, [
    { id: '1', nombre: 'Cortado', descripcion: 'Chico', precio: 1800, imagen: '' },
  ]);
  assert.equal(formatFecha(carta.publicadaEn).replace(NBSP, ' '), '25/10/2026, 15:30');
});

test('normalizarCarta: rechaza lo que no es una carta', () => {
  assert.throws(() => normalizarCarta(null));
  assert.throws(() => normalizarCarta({ categorias: 'x' }));
  assert.equal(normalizarCarta({ categorias: [], publicadaEn: 'nada' }).publicadaEn, null);
});

test('filtrarCarta: sin importar acentos ni mayúsculas, y busca en la descripción', () => {
  const carta = normalizarCarta(JSON.parse(fs.readFileSync(new URL('./carta-ejemplo.json', import.meta.url))));
  const nombres = (cats) => cats.flatMap((c) => c.productos.map((p) => p.nombre));
  assert.deepEqual(nombres(filtrarCarta(carta, 'tiramisu')), ['Tiramisú']);
  assert.deepEqual(nombres(filtrarCarta(carta, 'CHEDDAR')).sort(), ['Hamburguesa Clásica', 'Hamburguesa Doble AKROS', 'Papas Fritas']);
  assert.equal(filtrarCarta(carta, '  ').length, carta.categorias.length);
  assert.equal(filtrarCarta(carta, 'zzz').length, 0);
});

test('carta-ejemplo.json tiene el formato que publica el POS', () => {
  const datos = JSON.parse(fs.readFileSync(new URL('./carta-ejemplo.json', import.meta.url)));
  assert.equal(datos.version, 1);
  const carta = normalizarCarta(datos);
  const total = datos.categorias.reduce((n, c) => n + c.productos.length, 0);
  assert.equal(carta.categorias.reduce((n, c) => n + c.productos.length, 0), total);
});
