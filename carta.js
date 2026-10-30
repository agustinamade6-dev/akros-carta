// Carta digital de AKROS Café: lee carta.json (publicado por el POS) y la muestra para el celular del cliente.
// Todo dato de la carta se inserta con textContent, nunca como HTML.
import { URL_CARTA } from './config.js';

const SIN_DECIMALES = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const CON_DECIMALES = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ZONA = 'America/Argentina/Buenos_Aires';
const CLAVE_GUARDADA = 'akros-carta';

/** Mismo formato que el POS (src/utils/dinero.ts): $1.500, $1.500,50. */
export function formatPesos(monto) {
  if (!Number.isFinite(monto)) return '$0';
  const centavos = Math.round(Math.abs(monto) * 100);
  const pesos = centavos / 100;
  const texto = centavos % 100 === 0 ? SIN_DECIMALES.format(pesos) : CON_DECIMALES.format(pesos);
  return `${monto < 0 && centavos !== 0 ? '-' : ''}$${texto}`;
}

/** Solo imágenes https o relativas: un `javascript:` o `data:` en la carta no llega a la página. */
export function imagenSegura(url) {
  if (typeof url !== 'string' || url.trim() === '') return '';
  try {
    const resuelta = new URL(url, 'https://carta.invalid/');
    if (resuelta.protocol !== 'https:') return '';
    return url.startsWith('http') ? resuelta.href : url;
  } catch {
    return '';
  }
}

const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

/** "07:30" → 450 minutos; null si no es una hora válida. */
function aMinutos(hora) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(texto(hora));
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

function normalizarHorarios(horarios) {
  return (Array.isArray(horarios) ? horarios : [])
    .map((h) => ({ desde: aMinutos(h?.desde), hasta: aMinutos(h?.hasta) }))
    .filter((h) => h.desde !== null && h.hasta !== null && h.desde !== h.hasta);
}

function normalizarCategorias(categorias) {
  return (Array.isArray(categorias) ? categorias : [])
    .map((categoria, i) => ({
      id: String(categoria?.id ?? i),
      nombre: texto(categoria?.nombre),
      productos: (Array.isArray(categoria?.productos) ? categoria.productos : [])
        // Sin precio (null o ausente) se muestra igual, sin precio; un precio inválido descarta el producto.
        .filter((p) => texto(p?.nombre) && (p?.precio == null || (Number.isFinite(p.precio) && p.precio >= 0)))
        .map((p) => ({
          id: String(p.id ?? p.nombre),
          nombre: texto(p.nombre),
          descripcion: texto(p.descripcion),
          precio: p.precio ?? null,
          imagen: imagenSegura(p.imagen),
        })),
    }))
    .filter((categoria) => categoria.nombre && categoria.productos.length > 0);
}

/**
 * Valida la forma de carta.json y descarta lo que no sirve, sin romper la página por un producto mal cargado.
 * Versión 2: secciones (Desayuno y Merienda, Cafetería...) con su horario y sus categorías.
 * Versión 1 (solo `categorias`): se muestra como una única sección "Carta".
 */
export function normalizarCarta(datos) {
  if (!datos || typeof datos !== 'object' || (!Array.isArray(datos.secciones) && !Array.isArray(datos.categorias))) {
    throw new Error('La carta no tiene el formato esperado');
  }
  const crudas = Array.isArray(datos.secciones) ? datos.secciones : [{ id: 'carta', nombre: 'Carta', categorias: datos.categorias }];
  const secciones = crudas
    .map((seccion, i) => ({
      id: String(seccion?.id ?? i),
      nombre: texto(seccion?.nombre),
      // `disponible: false`: la sección aparece como "Próximamente" (Almuerzo y Cena todavía no se sirven).
      disponible: seccion?.disponible !== false,
      horarios: normalizarHorarios(seccion?.horarios),
      categorias: normalizarCategorias(seccion?.categorias),
    }))
    .filter((seccion) => seccion.nombre && (!seccion.disponible || seccion.categorias.length > 0));
  const fecha = new Date(datos.publicadaEn);
  return {
    negocio: texto(datos.negocio) || 'AKROS Café',
    publicadaEn: Number.isNaN(fecha.getTime()) ? null : fecha,
    secciones,
  };
}

/** Minutos desde la medianoche en Argentina (la hora del celular puede estar en otra zona). */
export function minutosEnArgentina(fecha) {
  const partes = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: ZONA })
    .formatToParts(fecha);
  const valor = (tipo) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  return valor('hour') * 60 + valor('minute');
}

/** Si el horario cubre ese minuto del día. Un horario que cruza la medianoche (20:00 a 01:00) también vale. */
function enHorario({ desde, hasta }, minuto) {
  return desde < hasta ? minuto >= desde && minuto < hasta : minuto >= desde || minuto < hasta;
}

/**
 * Sección que corresponde a esta hora (la primera disponible cuyo horario la cubre); si ninguna, la primera
 * disponible de la carta. Una sección "Próximamente" nunca es la del momento.
 */
export function seccionDelMomento(secciones, fecha) {
  const minuto = minutosEnArgentina(fecha);
  const disponibles = secciones.filter((s) => s.disponible);
  const delMomento = disponibles.find((s) => s.horarios.some((h) => enHorario(h, minuto)));
  return delMomento ?? disponibles[0] ?? secciones[0] ?? null;
}

const hora = (minutos) => {
  const h = Math.floor(minutos / 60) % 24;
  const m = minutos % 60;
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, '0')}`;
};

/** "De 7 a 12 h y de 16 a 20 h"; vacío si la sección no tiene horario (se sirve todo el día). */
export function textoHorario(horarios) {
  if (horarios.length === 0) return '';
  return horarios.map((h, i) => `${i === 0 ? 'De' : 'de'} ${hora(h.desde)} a ${hora(h.hasta)} h`).join(' y ');
}

const sinAcentos = (valor) => valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Secciones con solo los productos cuyo nombre o descripción contienen lo buscado (sin acentos ni mayúsculas). */
export function filtrarCarta(carta, busqueda) {
  const buscado = sinAcentos(busqueda.trim());
  if (!buscado) return carta.secciones;
  return carta.secciones
    .map((seccion) => ({
      ...seccion,
      categorias: seccion.categorias
        .map((categoria) => ({
          ...categoria,
          productos: categoria.productos.filter((p) => sinAcentos(`${p.nombre} ${p.descripcion}`).includes(buscado)),
        }))
        .filter((categoria) => categoria.productos.length > 0),
    }))
    .filter((seccion) => seccion.categorias.length > 0);
}

/** "25/10/2026, 15:30", en hora de Argentina. */
export function formatFecha(fecha) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    timeZone: ZONA,
  }).format(fecha);
}

// ---------------------------------------------------------------------------------------------------------------
// Página

function crear(etiqueta, clase, contenido) {
  const elemento = document.createElement(etiqueta);
  if (clase) elemento.className = clase;
  if (contenido !== undefined) elemento.textContent = contenido;
  return elemento;
}

/** Renglón de carta: nombre y precio en la misma línea, descripción debajo y, si hay, una foto chica. */
function renglonProducto(producto) {
  const renglon = crear('article', producto.imagen ? 'item con-foto' : 'item');
  if (producto.imagen) {
    const img = document.createElement('img');
    img.className = 'item-foto';
    img.src = producto.imagen;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      img.remove();
      renglon.classList.remove('con-foto');
    }, { once: true });
    renglon.append(img);
  }
  const cuerpo = crear('div', 'item-cuerpo');
  const linea = crear('div', 'item-linea');
  linea.append(crear('h4', 'item-nombre', producto.nombre));
  if (producto.precio !== null) linea.append(crear('span', 'item-puntos'), crear('p', 'item-precio', formatPesos(producto.precio)));
  cuerpo.append(linea);
  if (producto.descripcion) cuerpo.append(crear('p', 'item-descripcion', producto.descripcion));
  renglon.append(cuerpo);
  return renglon;
}

function bloqueSeccion(seccion, { conTitulo }) {
  const bloque = crear('section', 'seccion');
  bloque.setAttribute('aria-label', seccion.nombre);
  if (conTitulo) {
    const cabecera = crear('header', 'seccion-cabecera');
    cabecera.append(crear('h2', 'seccion-titulo', seccion.nombre));
    const horario = textoHorario(seccion.horarios);
    if (horario) cabecera.append(crear('p', 'seccion-horario', horario));
    bloque.append(cabecera);
  }
  if (!seccion.disponible) {
    bloque.append(crear('p', 'proximamente', 'Próximamente. Por ahora esta sección no está disponible.'));
    return bloque;
  }
  for (const categoria of seccion.categorias) {
    const grupo = crear('div', 'categoria');
    grupo.append(crear('h3', 'categoria-titulo', categoria.nombre));
    const lista = crear('div', 'items');
    lista.append(...categoria.productos.map(renglonProducto));
    grupo.append(lista);
    bloque.append(grupo);
  }
  return bloque;
}

function leerGuardada() {
  try {
    const guardada = localStorage.getItem(CLAVE_GUARDADA);
    return guardada ? JSON.parse(guardada) : null;
  } catch {
    return null;
  }
}

function guardar(datos) {
  try {
    localStorage.setItem(CLAVE_GUARDADA, JSON.stringify(datos));
  } catch {
    // Sin almacenamiento (modo privado): la próxima visita la vuelve a pedir.
  }
}

async function pedirCarta() {
  const respuesta = await fetch(URL_CARTA, { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  const datos = await respuesta.json();
  normalizarCarta(datos);
  guardar(datos);
  return datos;
}

async function iniciar() {
  const contenedor = document.getElementById('carta');
  const pestanias = document.getElementById('secciones');
  const estado = document.getElementById('estado');
  const buscador = document.getElementById('buscar');
  const pie = document.getElementById('actualizada');

  let datos;
  try {
    datos = await pedirCarta();
  } catch {
    // Señal débil: se muestra la última carta vista en este celular, avisando que puede estar desactualizada.
    datos = leerGuardada();
    if (!datos) {
      estado.replaceChildren(crear('p', 'aviso', 'No pudimos cargar la carta. Revisá tu conexión.'));
      const reintentar = crear('button', 'boton', 'Reintentar');
      reintentar.type = 'button';
      reintentar.addEventListener('click', () => location.reload());
      estado.append(reintentar);
      return;
    }
    pie.textContent = 'Sin conexión: puede que algunos precios no estén actualizados.';
  }

  let carta;
  try {
    carta = normalizarCarta(datos);
  } catch {
    estado.replaceChildren(crear('p', 'aviso', 'La carta no está disponible en este momento.'));
    return;
  }
  if (carta.secciones.length === 0) {
    estado.replaceChildren(crear('p', 'aviso', 'La carta no está disponible en este momento.'));
    return;
  }

  estado.hidden = true;
  document.title = `Carta · ${carta.negocio}`;
  if (carta.publicadaEn && !pie.textContent) pie.textContent = `Carta actualizada el ${formatFecha(carta.publicadaEn)}`;

  const delMomento = seccionDelMomento(carta.secciones, new Date());
  let elegida = delMomento.id;

  const dibujar = () => {
    const buscando = buscador.value.trim() !== '';
    pestanias.hidden = buscando;
    contenedor.replaceChildren();
    if (buscando) {
      const resultado = filtrarCarta(carta, buscador.value);
      if (resultado.length === 0) contenedor.append(crear('p', 'aviso', 'No encontramos nada con ese nombre.'));
      for (const seccion of resultado) contenedor.append(bloqueSeccion(seccion, { conTitulo: true }));
      return;
    }
    for (const boton of pestanias.querySelectorAll('.pestania')) {
      boton.setAttribute('aria-selected', String(boton.dataset.id === elegida));
      boton.tabIndex = boton.dataset.id === elegida ? 0 : -1;
    }
    const seccion = carta.secciones.find((s) => s.id === elegida);
    contenedor.append(bloqueSeccion(seccion, { conTitulo: true }));
  };

  for (const seccion of carta.secciones) {
    const boton = crear('button', 'pestania');
    boton.type = 'button';
    boton.setAttribute('role', 'tab');
    boton.dataset.id = seccion.id;
    boton.append(crear('span', '', seccion.nombre));
    if (seccion.id === delMomento.id && seccion.horarios.length > 0) boton.append(crear('span', 'ahora', 'Ahora'));
    if (!seccion.disponible) {
      boton.classList.add('no-disponible');
      boton.append(crear('span', 'pronto', 'Pronto'));
    }
    boton.addEventListener('click', () => {
      elegida = seccion.id;
      dibujar();
      boton.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    pestanias.append(boton);
  }
  // Flechas entre pestañas (patrón de pestañas accesibles).
  pestanias.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const botones = [...pestanias.querySelectorAll('.pestania')];
    const i = botones.findIndex((b) => b.dataset.id === elegida);
    const siguiente = botones[(i + (e.key === 'ArrowRight' ? 1 : botones.length - 1)) % botones.length];
    siguiente.click();
    siguiente.focus();
  });

  buscador.addEventListener('input', dibujar);
  document.getElementById('buscador').hidden = false;
  dibujar();
  pestanias.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

if (typeof document !== 'undefined') iniciar();
