// Carta digital de AKROS Café: lee carta.json (publicado por el POS) y la muestra para el celular del cliente.
// Todo dato de la carta se inserta con textContent, nunca como HTML.
import { URL_CARTA } from './config.js';

const SIN_DECIMALES = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const CON_DECIMALES = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CLAVE_GUARDADA = 'akros-carta';

/** Mismo formato que el POS (src/utils/dinero.ts): $1.500, $1.500,50. */
export function formatPesos(monto) {
  if (!Number.isFinite(monto)) return '$0';
  const centavos = Math.round(Math.abs(monto) * 100);
  const pesos = centavos / 100;
  const texto = centavos % 100 === 0 ? SIN_DECIMALES.format(pesos) : CON_DECIMALES.format(pesos);
  return `${monto < 0 && centavos !== 0 ? '-' : ''}$${texto}`;
}

/** Número de mesa del link (`?mesa=5`), o null si no hay o no es válido. */
export function mesaDesdeUrl(busqueda) {
  const valor = new URLSearchParams(busqueda).get('mesa');
  if (!valor || !/^\d{1,3}$/.test(valor)) return null;
  const numero = Number(valor);
  return numero > 0 ? numero : null;
}

/** Solo imágenes https o relativas: un `javascript:` o `data:` en la carta no llega a la página. */
export function imagenSegura(url) {
  if (typeof url !== 'string' || url.trim() === '') return '';
  try {
    const base = 'https://carta.invalid/';
    const resuelta = new URL(url, base);
    if (resuelta.protocol !== 'https:') return '';
    return url.startsWith('http') ? resuelta.href : url;
  } catch {
    return '';
  }
}

const texto = (valor) => (typeof valor === 'string' ? valor.trim() : '');

/** Valida la forma de carta.json y descarta lo que no sirve, sin romper la página por un producto mal cargado. */
export function normalizarCarta(datos) {
  if (!datos || typeof datos !== 'object' || !Array.isArray(datos.categorias)) {
    throw new Error('La carta no tiene el formato esperado');
  }
  const categorias = datos.categorias
    .map((categoria, i) => ({
      id: String(categoria?.id ?? i),
      nombre: texto(categoria?.nombre),
      productos: (Array.isArray(categoria?.productos) ? categoria.productos : [])
        .filter((p) => texto(p?.nombre) && Number.isFinite(p?.precio) && p.precio >= 0)
        .map((p) => ({
          id: String(p.id ?? p.nombre),
          nombre: texto(p.nombre),
          descripcion: texto(p.descripcion),
          precio: p.precio,
          imagen: imagenSegura(p.imagen),
        })),
    }))
    .filter((categoria) => categoria.nombre && categoria.productos.length > 0);
  const fecha = new Date(datos.publicadaEn);
  return {
    negocio: texto(datos.negocio) || 'AKROS Café',
    publicadaEn: Number.isNaN(fecha.getTime()) ? null : fecha,
    categorias,
  };
}

const sinAcentos = (valor) => valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Productos cuyo nombre o descripción contienen lo buscado (sin importar acentos ni mayúsculas). */
export function filtrarCarta(carta, busqueda) {
  const buscado = sinAcentos(busqueda.trim());
  if (!buscado) return carta.categorias;
  return carta.categorias
    .map((categoria) => ({
      ...categoria,
      productos: categoria.productos.filter((p) => sinAcentos(`${p.nombre} ${p.descripcion}`).includes(buscado)),
    }))
    .filter((categoria) => categoria.productos.length > 0);
}

/** "25/10/2026 15:30", en hora de Argentina. */
export function formatFecha(fecha) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
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

const idSeccion = (categoria) => `categoria-${categoria.id}`;

function tarjetaProducto(producto) {
  const tarjeta = crear('article', 'producto');
  const foto = crear('div', 'producto-foto');
  if (producto.imagen) {
    const img = document.createElement('img');
    img.src = producto.imagen;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => img.remove(), { once: true });
    foto.append(img);
  }
  const cuerpo = crear('div', 'producto-cuerpo');
  cuerpo.append(crear('h3', 'producto-nombre', producto.nombre));
  if (producto.descripcion) cuerpo.append(crear('p', 'producto-descripcion', producto.descripcion));
  cuerpo.append(crear('p', 'producto-precio', formatPesos(producto.precio)));
  tarjeta.append(foto, cuerpo);
  return tarjeta;
}

function dibujarCategorias(categorias, contenedor, nav) {
  contenedor.replaceChildren();
  nav.replaceChildren();
  if (categorias.length === 0) {
    contenedor.append(crear('p', 'aviso', 'No encontramos nada con ese nombre.'));
    return;
  }
  for (const categoria of categorias) {
    const enlace = crear('a', 'chip', categoria.nombre);
    enlace.href = `#${idSeccion(categoria)}`;
    nav.append(enlace);

    const seccion = crear('section', 'categoria');
    seccion.id = idSeccion(categoria);
    seccion.setAttribute('aria-labelledby', `${seccion.id}-titulo`);
    const titulo = crear('h2', 'categoria-titulo', categoria.nombre);
    titulo.id = `${seccion.id}-titulo`;
    const lista = crear('div', 'productos');
    lista.append(...categoria.productos.map(tarjetaProducto));
    seccion.append(titulo, lista);
    contenedor.append(seccion);
  }
}

/** Marca en la barra la categoría que se está viendo. */
function seguirCategoriaVisible(nav) {
  if (!('IntersectionObserver' in window)) return null;
  const observador = new IntersectionObserver(
    (entradas) => {
      for (const entrada of entradas) {
        if (!entrada.isIntersecting) continue;
        for (const chip of nav.querySelectorAll('.chip')) {
          const activo = chip.getAttribute('href') === `#${entrada.target.id}`;
          chip.classList.toggle('activo', activo);
          if (activo) {
            chip.setAttribute('aria-current', 'true');
            chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          } else {
            chip.removeAttribute('aria-current');
          }
        }
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  return observador;
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
  const nav = document.getElementById('categorias');
  const estado = document.getElementById('estado');
  const buscador = document.getElementById('buscar');
  const pie = document.getElementById('actualizada');
  const mesa = mesaDesdeUrl(location.search);

  if (mesa) {
    const etiquetaMesa = document.getElementById('mesa');
    etiquetaMesa.textContent = `Mesa ${mesa}`;
    etiquetaMesa.hidden = false;
  }

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

  estado.hidden = true;
  document.title = `Carta · ${carta.negocio}`;
  if (carta.publicadaEn && !pie.textContent) pie.textContent = `Precios actualizados el ${formatFecha(carta.publicadaEn)}`;

  let observador = seguirCategoriaVisible(nav);
  const dibujar = () => {
    observador?.disconnect();
    dibujarCategorias(filtrarCarta(carta, buscador.value), contenedor, nav);
    for (const seccion of contenedor.querySelectorAll('.categoria')) observador?.observe(seccion);
  };
  buscador.addEventListener('input', dibujar);
  document.getElementById('buscador').hidden = false;
  dibujar();
}

if (typeof document !== 'undefined') iniciar();
