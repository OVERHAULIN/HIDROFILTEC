require('dotenv').config();
const express = require('express');
const mssql = require('mssql/msnodesqlv8');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// Conexión a SQL Server con autenticación de Windows
const pool = new mssql.ConnectionPool({
  driver: 'msnodesqlv8',
  connectionString: `Driver={${process.env.DB_DRIVER || 'ODBC Driver 17 for SQL Server'}};Server=${process.env.DB_SERVER};Database=${process.env.DB_NAME};Trusted_Connection=Yes;TrustServerCertificate=Yes;`
});
// Helper: usa ? como parámetros y devuelve las filas
const q = async (text, p = []) => {
  const r = pool.request();
  let i = 0;
  const t = text.replace(/\?/g, () => { r.input('v' + i, p[i]); return '@v' + i++; });
  return (await r.query(t)).recordset || [];
};

/* ---------- Utilidades ---------- */
const TZ = 'America/Lima';
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const hora = () => new Date().toLocaleTimeString('en-GB', { timeZone: TZ });
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const periodoActual = () => { const [y, m] = hoy().split('-'); return `${MESES[+m - 1]} ${y}`; };
const r2 = n => Math.round(n * 100) / 100;
const PCT = { 'ONP': 0.13, 'AFP Integra': 0.12, 'AFP Prima': 0.122, 'AFP Profuturo': 0.123, 'AFP Habitat': 0.121 };
const CARGOS = ['Operario', 'Tecnico', 'Secretaria', 'Gerente'];
const bad = (res, msg) => res.status(400).json({ error: msg });
const ACTIVO = "(Estado='Activo' OR Estado IS NULL)";

// Valores de Trabajador.RolAcceso permitidos por tu BD (se leen al arrancar)
let ROLES = [];
const rolApp = v => { v = String(v || '').toLowerCase(); return /empleado|operario|tecnico/.test(v) ? 'empleado' : /secret/.test(v) ? 'secretaria' : 'admin'; };
const rolDB = r => ROLES.find(v => rolApp(v) === r);

const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e);
  if (/duplic|UNIQUE|PRIMARY/i.test(e.message)) return bad(res, 'Registro duplicado.');
  res.status(500).json({ error: 'Error del servidor: ' + e.message });
});

function auth(roles = []) {
  return (req, res, next) => {
    try {
      const user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), process.env.JWT_SECRET);
      if (roles.length && !roles.includes(user.rol)) return res.status(403).json({ error: 'No tienes permisos para esta acción.' });
      req.user = user; next();
    } catch { res.status(401).json({ error: 'No autenticado' }); }
  };
}

/* ---------- Login (acepta contraseñas con hash bcrypt o en texto plano) ---------- */
app.post('/api/login', wrap(async (req, res) => {
  const { usuario, rol } = req.body, pass = String(req.body.password || '');
  const [u] = await q(`SELECT IdTrabajador,NombreCompleto,Cargo,RolAcceso,Contrasena FROM Trabajador WHERE UsuarioLogin=? AND ${ACTIVO}`, [usuario]);
  const guardada = u ? String(u.Contrasena || '') : '';
  const ok = u && rolApp(u.RolAcceso) === rol && (guardada.startsWith('$2') ? bcrypt.compareSync(pass, guardada) : guardada === pass);
  if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });
  const user = { id: u.IdTrabajador, nombre: u.NombreCompleto, cargo: u.Cargo, rol: rolApp(u.RolAcceso) };
  res.json({ token: jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '8h' }), user });
}));

/* ---------- Carga de datos (según rol) ---------- */
app.get('/api/bootstrap', auth(), wrap(async (req, res) => {
  const emp = req.user.rol === 'empleado', id = req.user.id, f = hoy();
  const out = { hoy: f };
  const us = await q(`SELECT IdTrabajador AS id,DNI AS dni,NombreCompleto AS nombre,Cargo AS cargo,CAST(SueldoBase AS float) AS sueldo,RegimenPensionario AS regimen,AsignacionFamiliar AS asigFamiliar,RolAcceso AS rol FROM Trabajador WHERE ${ACTIVO}` + (emp ? ' AND IdTrabajador=?' : ''), emp ? [id] : []);
  out.users = us.map(u => ({ ...u, rol: rolApp(u.rol) }));
  out.asistencias = await q(
    'SELECT IdTrabajador AS userId,CONVERT(varchar(10),Fecha,23) AS fecha,CONVERT(varchar(8),HoraIngreso,108) AS ingreso,CONVERT(varchar(8),HoraSalida,108) AS salida,UbicacionIngreso AS locIngreso,UbicacionSalida AS locSalida FROM Asistencia WHERE Fecha=?' + (emp ? ' AND IdTrabajador=?' : ''),
    emp ? [f, id] : [f]);
  out.horasExtra = await q(
    'SELECT IdHorasExtra AS id,IdTrabajador AS userId,CONVERT(varchar(10),Fecha,23) AS fecha,CantidadHoras AS horas,Motivo AS motivo,Estado AS estado,Ubicacion AS loc FROM HorasExtra' + (emp ? ' WHERE IdTrabajador=?' : '') + ' ORDER BY IdHorasExtra DESC',
    emp ? [id] : []);
  const colsN = 'SELECT IdNomina AS id,IdTrabajador AS userId,Periodo AS periodo,CAST(SueldoBase AS float) AS sueldoBase,CAST(AsignacionFamiliar AS float) AS asigFamiliarMonto,CAST(PagoHorasExtra AS float) AS pagoHE,CAST(DescuentoPension AS float) AS descuento,CASE WHEN MontoBruto>0 THEN CAST(DescuentoPension AS float)/CAST(MontoBruto AS float) ELSE 0 END AS porcentajeUsado,RegimenPensionario AS regimenUsado,CAST(NetoAPagar AS float) AS neto,Estado AS estado FROM Nomina';
  out.nominas = emp ? await q(colsN + ' WHERE IdTrabajador=? ORDER BY IdNomina', [id]) : await q(colsN + ' WHERE Periodo=? ORDER BY IdNomina', [periodoActual()]);
  out.dispensadores = emp ? [] : await q('SELECT CodigoDispensador AS id,Ubicacion AS ubicacion,Estado AS estado FROM Dispensador');
  out.produccion = emp ? [] : await q('SELECT TOP 200 p.IdProduccion AS id,CONVERT(varchar(19),p.FechaHora,120) AS fecha,CAST(p.LitrosProducidos AS float) AS litros,t.NombreCompleto AS userNombre FROM ProduccionAgua p JOIN Trabajador t ON t.IdTrabajador=p.IdTrabajador ORDER BY p.IdProduccion DESC');
  res.json(out);
}));

/* ---------- Trabajadores ---------- */
app.post('/api/trabajadores', auth(['admin', 'secretaria']), wrap(async (req, res) => {
  const { dni, nombre, cargo, regimen, sueldo, asigFamiliar, usuario, password } = req.body;
  if (!dni || !nombre || !usuario || !password || !CARGOS.includes(cargo) || !PCT[regimen] || !(sueldo >= 1025))
    return bad(res, 'Datos incompletos o inválidos.');
  if ((await q('SELECT IdTrabajador FROM Trabajador WHERE DNI=?', [dni])).length) return bad(res, 'El número de documento ya está asignado a otro trabajador.');
  if ((await q('SELECT IdTrabajador FROM Trabajador WHERE UsuarioLogin=?', [usuario])).length) return bad(res, 'Ese nombre de usuario ya existe.');
  const rol = cargo === 'Gerente' ? 'admin' : cargo === 'Secretaria' ? 'secretaria' : 'empleado';
  const rolBD = rolDB(rol);
  if (!rolBD) return bad(res, 'No se pudo determinar el rol en la base de datos.');
  if (rol === 'admin' && (await q('SELECT IdTrabajador FROM Trabajador WHERE RolAcceso=?', [rolBD])).length)
    return bad(res, 'La estructura organizacional solo permite un (1) Gerente General.');
  await q("INSERT INTO Trabajador (DNI,NombreCompleto,Cargo,RolAcceso,UsuarioLogin,Contrasena,SueldoBase,RegimenPensionario,AsignacionFamiliar,Estado) VALUES (?,?,?,?,?,?,?,?,?,'Activo')",
    [dni, nombre, cargo, rolBD, usuario, bcrypt.hashSync(String(password), 10), sueldo, regimen, asigFamiliar ? 1 : 0]);
  res.json({ ok: true });
}));

// "Eliminar" = marcar Inactivo (conserva el historial de asistencia, nómina, etc.)
app.delete('/api/trabajadores/:id', auth(['admin']), wrap(async (req, res) => {
  const [t] = await q('SELECT RolAcceso FROM Trabajador WHERE IdTrabajador=?', [req.params.id]);
  if (!t) return bad(res, 'Trabajador no encontrado.');
  if (rolApp(t.RolAcceso) === 'admin') return bad(res, 'No se puede eliminar al Gerente General.');
  await q("UPDATE Trabajador SET Estado='Inactivo' WHERE IdTrabajador=?", [req.params.id]);
  res.json({ ok: true });
}));

/* ---------- Asistencia (1 ingreso y 1 salida por día) ---------- */
app.post('/api/asistencia/ingreso', auth(), wrap(async (req, res) => {
  if ((await q('SELECT IdAsistencia FROM Asistencia WHERE IdTrabajador=? AND Fecha=?', [req.user.id, hoy()])).length)
    return bad(res, 'El ingreso ya fue registrado el día de hoy.');
  await q('INSERT INTO Asistencia (IdTrabajador,Fecha,HoraIngreso,UbicacionIngreso) VALUES (?,?,?,?)', [req.user.id, hoy(), hora(), req.body.loc || null]);
  res.json({ ok: true });
}));

app.post('/api/asistencia/salida', auth(), wrap(async (req, res) => {
  const [a] = await q('SELECT IdAsistencia,HoraSalida FROM Asistencia WHERE IdTrabajador=? AND Fecha=?', [req.user.id, hoy()]);
  if (!a) return bad(res, 'Debes marcar tu ingreso antes de salir.');
  if (a.HoraSalida) return bad(res, 'La salida ya fue registrada el día de hoy.');
  await q('UPDATE Asistencia SET HoraSalida=?, UbicacionSalida=? WHERE IdAsistencia=?', [hora(), req.body.loc || null, a.IdAsistencia]);
  res.json({ ok: true });
}));

/* ---------- Horas extra (1 solicitud por día) ---------- */
app.post('/api/horas-extra', auth(), wrap(async (req, res) => {
  const { horas, motivo, loc } = req.body;
  if (!Number.isInteger(horas) || horas < 1 || horas > 8 || !motivo) return bad(res, 'Indica de 1 a 8 horas y el motivo.');
  if ((await q('SELECT IdHorasExtra FROM HorasExtra WHERE IdTrabajador=? AND Fecha=?', [req.user.id, hoy()])).length)
    return bad(res, 'Solo tienes permitido emitir una (1) solicitud por día.');
  await q("INSERT INTO HorasExtra (IdTrabajador,Fecha,CantidadHoras,Motivo,Ubicacion,Estado) VALUES (?,?,?,?,?,'Pendiente')", [req.user.id, hoy(), horas, motivo, loc || null]);
  res.json({ ok: true });
}));

app.put('/api/horas-extra/:id', auth(['admin']), wrap(async (req, res) => {
  if (!['Aprobado', 'Rechazado'].includes(req.body.estado)) return bad(res, 'Estado inválido.');
  await q("UPDATE HorasExtra SET Estado=? WHERE IdHorasExtra=? AND Estado='Pendiente'", [req.body.estado, req.params.id]);
  res.json({ ok: true });
}));

/* ---------- Nómina ---------- */
app.post('/api/nomina/generar', auth(['admin', 'secretaria']), wrap(async (req, res) => {
  const periodo = periodoActual(), ym = hoy().slice(0, 7);
  const estado = req.user.rol === 'admin' ? 'Aprobado' : 'Pendiente';
  const users = await q(`SELECT * FROM Trabajador WHERE ${ACTIVO}`);
  await q('DELETE FROM Nomina WHERE Periodo=?', [periodo]);
  for (const u of users) {
    const [r] = await q("SELECT COALESCE(SUM(CantidadHoras),0) AS h FROM HorasExtra WHERE IdTrabajador=? AND Estado='Aprobado' AND FORMAT(Fecha,'yyyy-MM')=?", [u.IdTrabajador, ym]);
    const he = Number(r.h) * 15, af = u.AsignacionFamiliar ? 102.5 : 0, pct = PCT[u.RegimenPensionario] || 0.13;
    const bruto = Number(u.SueldoBase) + af + he, desc = r2(bruto * pct);
    await q('INSERT INTO Nomina (IdTrabajador,Periodo,SueldoBase,AsignacionFamiliar,PagoHorasExtra,MontoBruto,RegimenPensionario,DescuentoPension,NetoAPagar,Estado,FechaGeneracion) VALUES (?,?,?,?,?,?,?,?,?,?,GETDATE())',
      [u.IdTrabajador, periodo, u.SueldoBase, af, he, bruto, u.RegimenPensionario, desc, r2(bruto - desc), estado]);
  }
  res.json({ ok: true });
}));

app.put('/api/nomina/:id/aprobar', auth(['admin']), wrap(async (req, res) => {
  await q("UPDATE Nomina SET Estado='Aprobado' WHERE IdNomina=?", [req.params.id]);
  res.json({ ok: true });
}));

/* ---------- Dispensadores ---------- */
app.post('/api/dispensadores', auth(['admin', 'secretaria']), wrap(async (req, res) => {
  const codigo = String(req.body.codigo || '').trim().toUpperCase(), ubicacion = String(req.body.ubicacion || '').trim();
  if (!codigo || !ubicacion) return bad(res, 'Ambos campos son requeridos.');
  if ((await q('SELECT CodigoDispensador FROM Dispensador WHERE CodigoDispensador=?', [codigo])).length) return bad(res, `El código ${codigo} ya está registrado en el sistema.`);
  await q("INSERT INTO Dispensador (CodigoDispensador,Ubicacion,Estado,FechaRegistro) VALUES (?,?,'Activo',GETDATE())", [codigo, ubicacion]);
  res.json({ ok: true });
}));

app.delete('/api/dispensadores/:codigo', auth(['admin']), wrap(async (req, res) => {
  await q('DELETE FROM Dispensador WHERE CodigoDispensador=?', [req.params.codigo]);
  res.json({ ok: true });
}));

/* ---------- Producción de agua ---------- */
app.post('/api/produccion', auth(['admin', 'secretaria']), wrap(async (req, res) => {
  const litros = parseInt(req.body.litros);
  if (!litros || litros <= 0) return bad(res, 'Valor de litros no válido.');
  await q('INSERT INTO ProduccionAgua (IdTrabajador,FechaHora,LitrosProducidos) VALUES (?,GETDATE(),?)', [req.user.id, litros]);
  res.json({ ok: true });
}));

app.delete('/api/produccion/:id', auth(['admin']), wrap(async (req, res) => {
  await q('DELETE FROM ProduccionAgua WHERE IdProduccion=?', [req.params.id]);
  res.json({ ok: true });
}));

/* ---------- Arranque ---------- */
(async () => {
  await pool.connect();
  const [c] = await q("SELECT definition FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID('dbo.Trabajador') AND definition LIKE '%RolAcceso%'");
  ROLES = [...String(c ? c.definition : '').matchAll(/'([^']+)'/g)].map(m => m[1]);
  console.log('Roles permitidos en la BD:', ROLES.join(', ') || '(no se pudieron leer)');

  const [{ n }] = await q('SELECT COUNT(*) AS n FROM Trabajador');
  if (!n && rolDB('admin') && rolDB('secretaria') && rolDB('empleado')) {
    const h = p => bcrypt.hashSync(p, 10);
    for (const u of [
      ['44445555', 'Administrador General', 'Gerente', rolDB('admin'), 'admin', h('admin123'), 4500, 'AFP Integra', 0],
      ['70123456', 'Lucia Fernandez', 'Secretaria', rolDB('secretaria'), 'secretaria', h('secretaria123'), 1800, 'ONP', 1],
      ['45678912', 'Carlos Mendoza', 'Operario', rolDB('empleado'), 'empleado', h('empleado123'), 1400, 'AFP Prima', 1]
    ]) await q("INSERT INTO Trabajador (DNI,NombreCompleto,Cargo,RolAcceso,UsuarioLogin,Contrasena,SueldoBase,RegimenPensionario,AsignacionFamiliar,Estado) VALUES (?,?,?,?,?,?,?,?,?,'Activo')", u);
    console.log('Tabla Trabajador vacía: usuarios demo creados (admin/secretaria/empleado).');
  }
  app.listen(3000, () => console.log('Sistema en http://localhost:3000'));
})().catch(e => { console.error('No se pudo iniciar:', e.message); process.exit(1); });
