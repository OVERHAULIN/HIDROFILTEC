/* api.js: Conexión nativa con Backend SQL Server */
const API = '/api';
let token = null;
let currentUser = null;
let todayStr = new Date().toISOString().split('T')[0];

let db = { users: [], asistencias: [], horasExtra: [], nominas: [], dispensadores: [], produccion: [] };

async function api(path, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 
      'Content-Type': 'application/json', 
      ...(token ? { Authorization: 'Bearer ' + token } : {}) 
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Error del servidor');
  return d;
}

async function cargarDatos() {
  const { hoy, ...datos } = await api('/bootstrap');
  todayStr = hoy;
  db = datos;
}

async function run(fn, okMsg) {
  try {
    await fn();
    await cargarDatos();
    renderAll();
    if (okMsg) showToast(okMsg, 'green', 'fa-check-circle');
  } catch (e) { 
    showToast(e.message, 'red', 'fa-ban'); 
  }
}

/* ---------- Control de Menú Móvil ---------- */
const sidebar = document.getElementById('sidebar');
function toggleMenu() {
  if (sidebar.classList.contains('hidden')) {
    sidebar.classList.remove('hidden');
    sidebar.classList.add('absolute', 'inset-y-0', 'left-0', 'shadow-2xl');
  } else {
    sidebar.classList.add('hidden');
    sidebar.classList.remove('absolute', 'inset-y-0', 'left-0', 'shadow-2xl');
  }
}

if (document.getElementById('mobileMenuBtn')) {
  document.getElementById('mobileMenuBtn').addEventListener('click', toggleMenu);
}
if (document.getElementById('closeSidebarMobile')) {
  document.getElementById('closeSidebarMobile').addEventListener('click', toggleMenu);
}

/* ---------- Login ---------- */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const d = await api('/login', 'POST', {
      rol: document.getElementById('loginRole').value,
      usuario: document.getElementById('loginUser').value.trim(),
      password: document.getElementById('loginPass').value.trim()
    });
    token = d.token; 
    currentUser = d.user;
    document.getElementById('loginError').classList.add('hidden');
    iniciarSesion();
  } catch (err) {
    const el = document.getElementById('loginError');
    el.textContent = err.message === 'Credenciales incorrectas' ? 'Credenciales incorrectas.' : 'Error: ' + err.message;
    el.classList.remove('hidden');
  }
});

async function iniciarSesion() {
  await cargarDatos();
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appWrapper').classList.remove('hidden');
  document.getElementById('headerUserName').textContent = currentUser.nombre;
  document.getElementById('sidebarRoleLabel').textContent = currentUser.cargo;
  construirMenuPorRol();
  
  const adminEls = document.querySelectorAll('.admin-only');
  adminEls.forEach(el => el.style.display = (currentUser.rol === 'admin') ? '' : 'none');
  
  if (currentUser.rol === 'empleado') showView('mi-perfil', 'Autogestión del Trabajador');
  else showView('dashboard', 'Panel de Control');
  
  renderAll();
}

function logout() {
  token = null;
  currentUser = null;
  document.getElementById('appWrapper').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('loginForm').reset();
  document.getElementById('loginError').classList.add('hidden');
  if (!sidebar.classList.contains('hidden') && window.innerWidth < 768) toggleMenu();
}

function construirMenuPorRol() {
  const nav = document.getElementById('navMenu');
  let links = '';
  const linkBaseClass = "flex items-center gap-3 px-6 py-3.5 text-sm font-medium hover:bg-gray-800 hover:text-white transition-colors border-l-4 border-transparent hover:border-blue-500";
  
  if (currentUser.rol === 'empleado') {
    links = `<a href="#" onclick="showView('mi-perfil','Autogestión del Trabajador')" class="${linkBaseClass} border-blue-500 bg-gray-800 text-white"><i class="fas fa-user-circle w-5"></i> Mi Espacio</a>`;
  } else {
    links = `
      <a href="#" onclick="showView('dashboard','Panel de Control')" class="${linkBaseClass}"><i class="fas fa-home w-5"></i> Dashboard</a>
      <a href="#" onclick="showView('trabajadores','Directorio de Personal')" class="${linkBaseClass}"><i class="fas fa-users w-5"></i> Personal</a>
      <a href="#" onclick="showView('asistencia','Control de Asistencia')" class="${linkBaseClass}"><i class="fas fa-clock w-5"></i> Asistencia</a>
      <a href="#" onclick="showView('horas-extra','Gestión de Horas Extra')" class="${linkBaseClass}"><i class="fas fa-business-time w-5"></i> Horas Extra</a>
      <a href="#" onclick="showView('nomina','Procesamiento de Nómina')" class="${linkBaseClass}"><i class="fas fa-file-invoice-dollar w-5"></i> Nóminas y Boletas</a>
      <a href="#" onclick="showView('dispensadores','Inventario Dispensadores')" class="${linkBaseClass}"><i class="fas fa-box w-5"></i> Dispensadores</a>
      <a href="#" onclick="showView('produccion','Control de Producción')" class="${linkBaseClass}"><i class="fas fa-water w-5"></i> Producción</a>
    `;
  }
  nav.innerHTML = links;
}

async function showView(id, title) {
  try { await cargarDatos(); }
  catch (e) { if (e.message === 'No autenticado') { logout(); return showToast('Sesión expirada.', 'red'); } }
  
  document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
  const view = document.getElementById('view-' + id);
  if (view) view.classList.remove('hidden');
  document.getElementById('pageTitle').textContent = title;
  
  if (window.innerWidth < 768 && !sidebar.classList.contains('hidden')) {
    toggleMenu();
  }
  renderAll();
}

/* ---------- Geolocalización GPS ---------- */
function obtenerUbicacion() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject("El navegador no soporta GPS");
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(`Lat: ${pos.coords.latitude.toFixed(3)}, Lon: ${pos.coords.longitude.toFixed(3)}`),
      (err) => reject("Permiso de ubicación denegado por el usuario")
    );
  });
}

/* ---------- Trabajadores ---------- */
document.getElementById('formTrabajador').addEventListener('submit', (e) => {
  e.preventDefault();
  run(async () => {
    await api('/trabajadores', 'POST', {
      dni: document.getElementById('tDNI').value.trim(),
      nombre: document.getElementById('tNombre').value.trim(),
      cargo: document.getElementById('tCargo').value,
      regimen: document.getElementById('tRegimen').value,
      sueldo: parseFloat(document.getElementById('tSueldo').value),
      asigFamiliar: document.getElementById('tAsigFamiliar').checked,
      usuario: document.getElementById('tUsuario').value.trim(),
      password: document.getElementById('tPassword').value
    });
    cerrarModalTrabajador();
  }, 'Trabajador registrado en SQL Server.');
});

function abrirModalTrabajador() { document.getElementById('modalTrabajador').classList.remove('hidden'); }
function cerrarModalTrabajador() { document.getElementById('modalTrabajador').classList.add('hidden'); document.getElementById('formTrabajador').reset(); }

function eliminarTrabajador(id) {
  if (confirm('¿Está seguro de eliminar a este trabajador?')) {
    run(() => api('/trabajadores/' + id, 'DELETE'), 'Trabajador eliminado de la base de datos.');
  }
}

/* ---------- Asistencia ---------- */
async function registrarAsistenciaEmp(tipo) {
  try {
    showToast('Obteniendo ubicación GPS...', 'blue', 'fa-satellite-dish');
    const loc = await obtenerUbicacion();
    await api('/asistencia/' + tipo, 'POST', { loc });
    await cargarDatos();
    renderAll();
    showToast(tipo === 'ingreso' ? 'Ingreso marcado exitosamente.' : 'Salida marcada exitosamente.', 'green', 'fa-check-circle');
  } catch (e) { showToast((e.message || e) + '', 'red', 'fa-map-marker-alt'); }
}

function verificarBotonesEmpleado() {
  if (currentUser.rol !== 'empleado') return;
  const reg = db.asistencias.find(a => a.userId === currentUser.id && a.fecha === todayStr);
  const btnIn = document.getElementById('btnIngresoEmp');
  const btnOut = document.getElementById('btnSalidaEmp');
  const info = document.getElementById('empLocationInfo');
  info.classList.remove('hidden');
  
  if (!reg) {
    btnIn.disabled = false; btnIn.classList.remove('opacity-50','cursor-not-allowed');
    btnOut.disabled = true; btnOut.classList.add('opacity-50','cursor-not-allowed');
    info.innerHTML = "Estado: <span class='text-orange-500 font-bold'>Pendiente de Ingreso</span>";
  } else if (reg && !reg.salida) {
    btnIn.disabled = true; btnIn.classList.add('opacity-50','cursor-not-allowed');
    btnOut.disabled = false; btnOut.classList.remove('opacity-50','cursor-not-allowed');
    info.innerHTML = `Ingreso: <b>${reg.ingreso}</b>.<br><span class='text-xs text-gray-400'>Desde: ${reg.locIngreso || 'Sin GPS'}</span>`;
  } else {
    btnIn.disabled = true; btnIn.classList.add('opacity-50','cursor-not-allowed');
    btnOut.disabled = true; btnOut.classList.add('opacity-50','cursor-not-allowed');
    info.innerHTML = `Jornada finalizada. Salida: <b>${reg.salida}</b>`;
  }
}

/* ---------- Horas Extra ---------- */
async function solicitarHorasExtraEmp() {
  const h = parseInt(document.getElementById('empHeHoras').value);
  const m = document.getElementById('empHeMotivo').value.trim();
  if (!h || !m) return showToast('Especifique horas y motivo.', 'red', 'fa-exclamation-circle');
  try {
    showToast('Obteniendo coordenadas GPS...', 'blue', 'fa-satellite-dish');
    const loc = await obtenerUbicacion();
    await api('/horas-extra', 'POST', { horas: h, motivo: m, loc });
    document.getElementById('empHeHoras').value = ''; 
    document.getElementById('empHeMotivo').value = '';
    await cargarDatos(); 
    renderAll();
    showToast('Solicitud registrada en SQL Server.', 'green', 'fa-check-circle');
  } catch (e) { showToast((e.message || e) + '', 'red', 'fa-ban'); }
}

function cambiarEstadoHE(id, estado) {
  run(() => api('/horas-extra/' + id, 'PUT', { estado }), `Horas Extras: ${estado}`);
}

/* ---------- Nómina y Boletas ---------- */
function procesarPlanillaGlobal() { 
  run(() => api('/nomina/generar', 'POST'), 'Nómina mensual calculada y guardada.'); 
}

function aprobarNominaUnica(id) { 
  run(() => api(`/nomina/${id}/aprobar`, 'PUT'), 'Nómina aprobada.'); 
}

function prepararBoleta(idNomina) {
  const nom = db.nominas.find(x => x.id === idNomina);
  const usr = db.users.find(u => u.id === nom.userId);
  if (!nom || !usr) return;

  document.getElementById('boletaNombre').textContent = usr.nombre;
  document.getElementById('boletaDNI').textContent = usr.dni;
  document.getElementById('boletaCargo').textContent = usr.cargo;
  document.getElementById('boletaRegimen').textContent = usr.regimen;
  document.getElementById('boletaPeriodo').textContent = "Periodo: " + nom.periodo;
  document.getElementById('boletaFirmaNombre').textContent = usr.nombre;
  
  const totalIngresos = nom.sueldoBase + nom.asigFamiliarMonto + nom.pagoHE;
  let filaAsigFamiliar = nom.asigFamiliarMonto > 0
      ? `<tr><td class="p-3 border-r border-gray-300">Asignación Familiar</td><td class="p-3 text-right border-r border-gray-300">${nom.asigFamiliarMonto.toFixed(2)}</td><td class="p-3 text-right"></td></tr>`
      : '';
      
  document.getElementById('boletaConceptos').innerHTML = `
      <tr><td class="p-3 border-r border-gray-300">Sueldo Básico</td><td class="p-3 text-right border-r border-gray-300">${nom.sueldoBase.toFixed(2)}</td><td class="p-3 text-right"></td></tr>
      ${filaAsigFamiliar}
      <tr><td class="p-3 border-r border-gray-300">Horas Extras Reembolsables</td><td class="p-3 text-right border-r border-gray-300">${nom.pagoHE.toFixed(2)}</td><td class="p-3 text-right"></td></tr>
      <tr><td class="p-3 border-r border-gray-300 text-red-600">Aportación Pensión - ${nom.regimenUsado} (${(nom.porcentajeUsado * 100).toFixed(1)}%)</td><td class="p-3 text-right border-r border-gray-300"></td><td class="p-3 text-right text-red-600">${nom.descuento.toFixed(2)}</td></tr>
  `;
  document.getElementById('boletaTotalIngresos').textContent = totalIngresos.toFixed(2);
  document.getElementById('boletaTotalDescuentos').textContent = nom.descuento.toFixed(2);
  document.getElementById('boletaNeto').textContent = `S/ ${nom.neto.toFixed(2)}`;
  document.getElementById('modalBoleta').classList.remove('hidden');
}

function cerrarBoleta() { document.getElementById('modalBoleta').classList.add('hidden'); }

/* ---------- Dispensadores ---------- */
function agregarDispensador() {
  const codigo = document.getElementById('dispCodigo').value.trim();
  const ubicacion = document.getElementById('dispUbicacion').value.trim();
  if (!codigo || !ubicacion) return showToast('Ingrese código y ubicación.', 'red', 'fa-exclamation-circle');
  
  run(async () => {
    await api('/dispensadores', 'POST', { codigo, ubicacion });
    document.getElementById('dispCodigo').value = ''; 
    document.getElementById('dispUbicacion').value = '';
  }, 'Dispensador guardado en la base de datos.');
}

function eliminarDispensador(id) {
  if (confirm('¿Eliminar dispensador?')) {
    run(() => api('/dispensadores/' + encodeURIComponent(id), 'DELETE'), 'Dispensador eliminado.');
  }
}

/* ---------- Producción ---------- */
function agregarProduccion() {
  const litros = parseInt(document.getElementById('prodLitros').value);
  if (!litros || litros <= 0) return showToast('Ingrese un volumen de litros válido.', 'red', 'fa-exclamation-circle');
  
  run(async () => {
    await api('/produccion', 'POST', { litros });
    document.getElementById('prodLitros').value = '';
  }, 'Lote de producción guardado en SQL Server.');
}

function eliminarProduccion(id) {
  if (confirm('¿Eliminar registro de producción?')) {
    run(() => api('/produccion/' + id, 'DELETE'), 'Lote eliminado.');
  }
}

/* ---------- Renderizado de Vistas ---------- */
function renderAll() {
  if (!currentUser) return;
  if (currentUser.rol === 'empleado') {
    document.getElementById('empNameTitle').textContent = currentUser.nombre.split(' ')[0];
    verificarBotonesEmpleado();
    renderNominasEmpleado();
  } else {
    renderDashboard();
    renderTrabajadores();
    renderAsistencias();
    renderHorasExtra();
    renderNominaGlobal();
    renderDispensadores();
    renderProduccion();
  }
}

function renderDashboard() {
  document.getElementById('stat-trabajadores').textContent = db.users.length;
  document.getElementById('stat-presentes').textContent = db.asistencias.filter(a => a.fecha === todayStr).length;
  document.getElementById('stat-dispensadores').textContent = db.dispensadores.length;
  document.getElementById('stat-produccion').textContent = db.produccion.reduce((a, c) => a + c.litros, 0);
  
  const alertas = [];
  const hePendientes = db.horasExtra.filter(h => h.estado === 'Pendiente').length;
  if (hePendientes > 0) alertas.push(`Hay <b>${hePendientes}</b> solicitud(es) de horas extra pendientes.`);
  
  const list = document.getElementById('alertasList');
  list.innerHTML = alertas.length === 0 
    ? "<li class='text-gray-600'><i class='fas fa-check-circle text-green-500'></i> Todo opera con normalidad.</li>"
    : alertas.map(a => `<li><i class="fas fa-exclamation-triangle"></i> ${a}</li>`).join('');
}

function renderTrabajadores() {
  const html = db.users.map(u => `
    <tr class="hover:bg-blue-50/50 transition">
        <td class="p-4 font-bold text-gray-700">${u.dni}</td>
        <td class="p-4 font-medium text-gray-900">${u.nombre}</td>
        <td class="p-4"><span class="bg-gray-100 text-gray-700 border text-xs px-3 py-1 rounded-full font-bold uppercase">${u.cargo}</span></td>
        <td class="p-4 text-gray-500">${u.regimen}</td>
        <td class="p-4 font-medium">S/ ${u.sueldo.toFixed(2)} ${u.asigFamiliar ? '<span class="text-xs text-blue-600 font-bold bg-blue-50 px-1 rounded ml-1">+AF</span>' : ''}</td>
        <td class="p-4 text-center admin-only" style="display:${currentUser.rol==='admin'?'':'none'}">
            ${u.rol !== 'admin' ? `<button onclick="eliminarTrabajador(${u.id})" class="text-red-500 hover:text-red-700 bg-red-50 p-2 rounded-lg"><i class="fas fa-user-minus"></i></button>` : '-'}
        </td>
    </tr>
  `).join('');
  document.getElementById('tablaTrabajadores').innerHTML = html;
}

function renderAsistencias() {
  const html = db.asistencias.map(a => {
    const user = db.users.find(u => u.id === a.userId);
    return `
      <tr class="hover:bg-gray-50">
          <td class="p-4">${a.fecha}</td>
          <td class="p-4 font-bold">${user ? user.nombre : 'Trabajador'}</td>
          <td class="p-4 text-green-600 font-bold"><i class="fas fa-sign-in-alt text-xs mr-1"></i> ${a.ingreso}</td>
          <td class="p-4 text-red-500 font-bold">${a.salida ? `<i class="fas fa-sign-out-alt text-xs mr-1"></i> ${a.salida}` : '---'}</td>
          <td class="p-4 text-xs text-gray-500">${a.locIngreso || 'Sin registro GPS'}</td>
      </tr>
  `}).join('');
  document.getElementById('tablaAsistencia').innerHTML = html || '<tr><td colspan="5" class="p-8 text-center text-gray-500">No hay registros hoy.</td></tr>';
}

function renderHorasExtra() {
  const html = db.horasExtra.map(h => {
    const user = db.users.find(u => u.id === h.userId);
    let badgeClass = h.estado === 'Pendiente' ? 'bg-yellow-100 text-yellow-800' : (h.estado === 'Aprobado' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800');
    let acciones = currentUser.rol === 'admin' && h.estado === 'Pendiente' ? `
        <button onclick="cambiarEstadoHE(${h.id}, 'Aprobado')" class="text-green-600 bg-green-50 p-2 rounded-lg mr-1"><i class="fas fa-check"></i></button>
        <button onclick="cambiarEstadoHE(${h.id}, 'Rechazado')" class="text-red-600 bg-red-50 p-2 rounded-lg"><i class="fas fa-times"></i></button>
    ` : `<span class="text-xs text-gray-400">Procesado</span>`;

    return `
      <tr class="hover:bg-gray-50">
          <td class="p-4">${h.fecha}</td>
          <td class="p-4 font-bold">${user ? user.nombre : ''}</td>
          <td class="p-4 font-bold">${h.horas} h</td>
          <td class="p-4 text-xs text-gray-600"><b>M:</b> ${h.motivo}<br><span class="text-gray-400">${h.loc || ''}</span></td>
          <td class="p-4"><span class="${badgeClass} text-xs px-3 py-1 rounded-full font-bold">${h.estado}</span></td>
          <td class="p-4 text-center admin-only" style="display:${currentUser.rol==='admin'?'':'none'}">${acciones}</td>
      </tr>
  `}).join('');
  document.getElementById('tablaHorasExtra').innerHTML = html || '<tr><td colspan="6" class="p-8 text-center text-gray-500">Sin solicitudes.</td></tr>';
}

function renderNominaGlobal() {
  const html = db.nominas.map(n => {
    const user = db.users.find(u => u.id === n.userId);
    let btns = '';
    if (currentUser.rol === 'admin' && n.estado === 'Pendiente') {
      btns += `<button onclick="aprobarNominaUnica(${n.id})" class="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg shadow font-bold hover:bg-green-700 mr-2"><i class="fas fa-check"></i> Aprobar</button>`;
    }
    if (n.estado === 'Aprobado') {
      btns += `<button onclick="prepararBoleta(${n.id})" class="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-lg shadow font-bold hover:bg-gray-900"><i class="fas fa-print"></i> Boleta</button>`;
    }
    return `
      <tr class="hover:bg-gray-50">
          <td class="p-4 font-bold">${user ? user.nombre : ''}</td>
          <td class="p-4">S/ ${n.sueldoBase.toFixed(2)}</td>
          <td class="p-4 text-blue-600">+ S/ ${n.pagoHE.toFixed(2)}</td>
          <td class="p-4 text-red-500">- S/ ${n.descuento.toFixed(2)}</td>
          <td class="p-4 font-bold text-gray-900 text-lg">S/ ${n.neto.toFixed(2)}</td>
          <td class="p-4"><span class="bg-blue-100 text-blue-800 text-xs px-3 py-1 rounded-full font-bold">${n.estado}</span></td>
          <td class="p-4 text-center">${btns || '-'}</td>
      </tr>
  `}).join('');
  document.getElementById('tablaNomina').innerHTML = html || '<tr><td colspan="7" class="p-8 text-center text-gray-500">Genera la planilla del mes.</td></tr>';
}

function renderNominasEmpleado() {
  const html = db.nominas.map(n => {
    let isAp = n.estado === 'Aprobado';
    let btn = isAp
      ? `<button onclick="prepararBoleta(${n.id})" class="bg-blue-600 text-white px-4 py-2 text-xs rounded-lg font-bold shadow-md"><i class="fas fa-file-pdf"></i> Visualizar Boleta</button>`
      : '<span class="text-xs text-gray-500 bg-gray-100 px-3 py-2 rounded-lg font-medium"><i class="fas fa-lock"></i> Pendiente</span>';
    return `
      <tr class="hover:bg-gray-50">
          <td class="p-4 font-bold text-gray-800">${n.periodo}</td>
          <td class="p-4 font-bold ${isAp ? 'text-green-600' : 'text-yellow-600'}">${isAp ? 'Aprobado' : 'En Revisión'}</td>
          <td class="p-4">${btn}</td>
      </tr>
  `}).join('');
  document.getElementById('empNominasTable').innerHTML = html || '<tr><td colspan="3" class="p-6 text-center text-gray-500">Sin nóminas.</td></tr>';
}

function renderDispensadores() {
  const html = db.dispensadores.map(d => `
    <tr class="hover:bg-gray-50">
        <td class="p-4 font-black text-indigo-700">${d.id}</td>
        <td class="p-4 text-gray-700 font-medium">${d.ubicacion}</td>
        <td class="p-4"><span class="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">${d.estado}</span></td>
        <td class="p-4 text-center admin-only" style="display:${currentUser.rol==='admin'?'':'none'}">
            <button onclick="eliminarDispensador('${d.id}')" class="text-red-500 hover:text-red-700 bg-red-50 p-2 rounded"><i class="fas fa-trash"></i></button>
        </td>
    </tr>
  `).join('');
  document.getElementById('tablaDispensadores').innerHTML = html || '<tr><td colspan="4" class="p-6 text-center text-gray-500">Sin dispensadores.</td></tr>';
}

function renderProduccion() {
  const html = db.produccion.map(p => `
    <tr class="hover:bg-gray-50">
        <td class="p-4 text-gray-600">${p.fecha}</td>
        <td class="p-4 font-black text-teal-600 text-lg">${p.litros} L</td>
        <td class="p-4 text-gray-600 font-medium">${p.userNombre}</td>
        <td class="p-4 text-center admin-only" style="display:${currentUser.rol==='admin'?'':'none'}">
            <button onclick="eliminarProduccion(${p.id})" class="text-red-500 hover:text-red-700 bg-red-50 p-2 rounded"><i class="fas fa-trash"></i></button>
        </td>
    </tr>
  `).join('');
  document.getElementById('tablaProduccion').innerHTML = html || '<tr><td colspan="4" class="p-6 text-center text-gray-500">Sin producción registrada.</td></tr>';
}

/* ---------- UI Helper Toast ---------- */
let toastTimeout;
function showToast(msg, type = "blue", icon = "fa-info-circle") {
  const t = document.getElementById('toast');
  const iconEl = document.getElementById('toastIcon');
  document.getElementById('toastMsg').innerHTML = msg;
  iconEl.className = `fas ${icon} text-xl`;
  t.className = `fixed bottom-6 right-6 text-white px-6 py-4 rounded-xl shadow-2xl z-[200] font-medium text-sm transition-all duration-300 transform translate-y-0 opacity-100 flex items-center gap-3 ${type==='red'?'bg-red-600':type==='green'?'bg-green-600':'bg-blue-600'}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    t.classList.add('translate-y-full', 'opacity-0');
  }, 4000);
}