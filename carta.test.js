import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  formatPesos, imagenSegura, normalizarCarta, filtrarCarta, formatFecha, seccionDelMomento, textoHorario, minutosEnArgentina,
} from './carta.js';

const NBSP = / /g;
const ejemplo = () => JSON.parse(fs.readFileSync(new URL('./carta-ejemplo.json', import.meta.url)));
/** Una fecha a esa hora de Argentina (UTC-3, sin horario de verano). */
const aLas = (hhmm) => new Date(`2026-10-29T${hhmm}:00-03:00`);

test('formatPesos: igual que el POS', () => {
  assert.equal(formatPesos(5500), '$5.500');
  assert.equal(formatPesos(1500.5), '$1.500,50');
  assert.equal(formatPesos(0), '$0');
  assert.equal(formatPesos(Number.NaN), '$0');
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

test('normalizarCarta (v2): descarta productos inválidos, categorías y secciones vacías, horarios mal escritos', () => {
  const carta = normalizarCarta({
    negocio: 'AKROS Café',
    publicadaEn: '2026-10-25T18:30:00.000Z',
    secciones: [
      {
        id: 'cafe', nombre: 'Cafetería',
        horarios: [{ desde: '07:00', hasta: '12:30' }, { desde: '25:00', hasta: '26:00' }, { desde: 'x' }, { desde: '10:00', hasta: '10:00' }],
        categorias: [
          { id: 1, nombre: 'Cafés', productos: [
            { id: 1, nombre: 'Cortado', descripcion: ' Chico ', precio: 1800, imagen: 'javascript:x' },
            { id: 2, nombre: '', precio: 100 },
            { id: 3, nombre: 'Sin precio' },
            { id: 4, nombre: 'Negativo', precio: -5 },
          ] },
          { id: 2, nombre: 'Vacía', productos: [] },
        ],
      },
      { id: 'vacia', nombre: 'Sin productos', categorias: [{ nombre: 'Nada', productos: [] }] },
      { id: 'sin-nombre', nombre: '', categorias: [{ nombre: 'x', productos: [{ nombre: 'x', precio: 1 }] }] },
    ],
  });
  assert.equal(carta.secciones.length, 1);
  assert.deepEqual(carta.secciones[0].horarios, [{ desde: 420, hasta: 750 }]);
  assert.deepEqual(carta.secciones[0].categorias, [
    { id: '1', nombre: 'Cafés', productos: [{ id: '1', nombre: 'Cortado', descripcion: 'Chico', precio: 1800, imagen: '' }] },
  ]);
  assert.equal(formatFecha(carta.publicadaEn).replace(NBSP, ' '), '25/10/2026, 15:30');
});

test('normalizarCarta (v1, solo categorías): se muestra como una única sección "Carta"', () => {
  const carta = normalizarCarta({ categorias: [{ id: 1, nombre: 'Cafés', productos: [{ nombre: 'Cortado', precio: 1800 }] }] });
  assert.equal(carta.secciones.length, 1);
  assert.equal(carta.secciones[0].nombre, 'Carta');
  assert.deepEqual(carta.secciones[0].horarios, []);
});

test('normalizarCarta: rechaza lo que no es una carta', () => {
  assert.throws(() => normalizarCarta(null));
  assert.throws(() => normalizarCarta({ secciones: 'x' }));
  assert.throws(() => normalizarCarta({}));
  assert.equal(normalizarCarta({ secciones: [], publicadaEn: 'nada' }).publicadaEn, null);
});

test('minutosEnArgentina: la hora de Argentina aunque el celular esté en otra zona', () => {
  assert.equal(minutosEnArgentina(new Date('2026-10-29T10:15:00Z')), 7 * 60 + 15);
  assert.equal(minutosEnArgentina(aLas('23:59')), 23 * 60 + 59);
});

test('seccionDelMomento: según el horario de cada sección', () => {
  const { secciones } = normalizarCarta(ejemplo());
  assert.equal(seccionDelMomento(secciones, aLas('08:30')).nombre, 'Desayuno y Merienda');
  assert.equal(seccionDelMomento(secciones, aLas('12:00')).nombre, 'Almuerzo');
  assert.equal(seccionDelMomento(secciones, aLas('17:45')).nombre, 'Desayuno y Merienda');
  assert.equal(seccionDelMomento(secciones, aLas('21:10')).nombre, 'Cena');
  // Fuera de todo horario: la primera sección.
  assert.equal(seccionDelMomento(secciones, aLas('03:00')).nombre, 'Desayuno y Merienda');
  assert.equal(seccionDelMomento([], aLas('03:00')), null);
});

test('seccionDelMomento: un horario que cruza la medianoche', () => {
  const { secciones } = normalizarCarta({ secciones: [
    { id: 'a', nombre: 'Día', horarios: [{ desde: '08:00', hasta: '20:00' }], categorias: [{ nombre: 'x', productos: [{ nombre: 'x', precio: 1 }] }] },
    { id: 'b', nombre: 'Noche', horarios: [{ desde: '20:00', hasta: '02:00' }], categorias: [{ nombre: 'x', productos: [{ nombre: 'x', precio: 1 }] }] },
  ] });
  assert.equal(seccionDelMomento(secciones, aLas('23:00')).nombre, 'Noche');
  assert.equal(seccionDelMomento(secciones, aLas('01:30')).nombre, 'Noche');
  assert.equal(seccionDelMomento(secciones, aLas('02:00')).nombre, 'Día');
});

test('textoHorario', () => {
  assert.equal(textoHorario([]), '');
  assert.equal(textoHorario([{ desde: 420, hasta: 720 }, { desde: 960, hasta: 1200 }]), 'De 7 a 12 h y de 16 a 20 h');
  assert.equal(textoHorario([{ desde: 1200, hasta: 1440 }]), 'De 20 a 0 h');
  assert.equal(textoHorario([{ desde: 450, hasta: 690 }]), 'De 7:30 a 11:30 h');
});

test('filtrarCarta: busca en todas las secciones, sin importar acentos ni mayúsculas', () => {
  const carta = normalizarCarta(ejemplo());
  const nombres = (secciones) => secciones.flatMap((s) => s.categorias.flatMap((c) => c.productos.map((p) => p.nombre)));
  assert.deepEqual(nombres(filtrarCarta(carta, 'lagrima')), ['Lágrima']);
  assert.deepEqual(nombres(filtrarCarta(carta, 'MEDIALUNA')).sort(), ['Desayuno AKROS', 'Medialuna']);
  assert.deepEqual(filtrarCarta(carta, 'flan').map((s) => s.nombre), ['Cena']);
  assert.equal(filtrarCarta(carta, '  ').length, carta.secciones.length);
  assert.equal(filtrarCarta(carta, 'zzz').length, 0);
});

test('carta-ejemplo.json tiene el formato que publica el POS (v2) y nada se descarta', () => {
  const datos = ejemplo();
  assert.equal(datos.version, 2);
  const carta = normalizarCarta(datos);
  const contar = (secciones) => secciones.reduce((n, s) => n + s.categorias.reduce((m, c) => m + c.productos.length, 0), 0);
  assert.equal(carta.secciones.length, datos.secciones.length);
  assert.equal(contar(carta.secciones), contar(datos.secciones));
  assert.deepEqual(carta.secciones.map((s) => s.nombre), ['Desayuno y Merienda', 'Cafetería', 'Confitería', 'Almuerzo', 'Cena']);
});
