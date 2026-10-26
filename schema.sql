IF DB_ID('Hidrofiltec_RH') IS NULL CREATE DATABASE Hidrofiltec_RH;
GO
USE Hidrofiltec_RH;
GO

IF OBJECT_ID('dbo.usuarios') IS NULL
CREATE TABLE dbo.usuarios (
  id INT IDENTITY(1,1) PRIMARY KEY,
  dni VARCHAR(15) NOT NULL UNIQUE,
  nombre VARCHAR(100) NOT NULL,
  cargo VARCHAR(30) NOT NULL,
  sueldo DECIMAL(10,2) NOT NULL,
  regimen VARCHAR(30) NOT NULL,
  asig_familiar BIT NOT NULL DEFAULT 0,
  rol VARCHAR(15) NOT NULL CHECK (rol IN ('admin','secretaria','empleado')),
  usuario VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL
);

IF OBJECT_ID('dbo.asistencias') IS NULL
CREATE TABLE dbo.asistencias (
  id INT IDENTITY(1,1) PRIMARY KEY,
  user_id INT NOT NULL REFERENCES dbo.usuarios(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  ingreso TIME(0), salida TIME(0),
  loc_ingreso VARCHAR(100), loc_salida VARCHAR(100),
  CONSTRAINT UQ_asistencia_dia UNIQUE (user_id, fecha)
);

IF OBJECT_ID('dbo.horas_extra') IS NULL
CREATE TABLE dbo.horas_extra (
  id INT IDENTITY(1,1) PRIMARY KEY,
  user_id INT NOT NULL REFERENCES dbo.usuarios(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  horas INT NOT NULL,
  motivo VARCHAR(200),
  estado VARCHAR(15) NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','Aprobado','Rechazado')),
  loc VARCHAR(100),
  CONSTRAINT UQ_he_dia UNIQUE (user_id, fecha)
);

IF OBJECT_ID('dbo.nominas') IS NULL
CREATE TABLE dbo.nominas (
  id INT IDENTITY(1,1) PRIMARY KEY,
  user_id INT NOT NULL REFERENCES dbo.usuarios(id) ON DELETE CASCADE,
  periodo VARCHAR(30) NOT NULL,
  sueldo_base DECIMAL(10,2), asig_familiar DECIMAL(10,2),
  pago_he DECIMAL(10,2), descuento DECIMAL(10,2),
  porcentaje DECIMAL(5,4), regimen VARCHAR(30),
  neto DECIMAL(10,2),
  estado VARCHAR(15) NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','Aprobado'))
);

IF OBJECT_ID('dbo.dispensadores') IS NULL
CREATE TABLE dbo.dispensadores (
  codigo VARCHAR(30) PRIMARY KEY,
  ubicacion VARCHAR(100) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo'
);

IF OBJECT_ID('dbo.produccion') IS NULL
CREATE TABLE dbo.produccion (
  id INT IDENTITY(1,1) PRIMARY KEY,
  fecha DATETIME NOT NULL DEFAULT GETDATE(),
  litros INT NOT NULL,
  user_nombre VARCHAR(100)
);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.dispensadores)
  INSERT INTO dbo.dispensadores (codigo, ubicacion) VALUES ('DISP-001', 'Planta Embotelladora A');
GO
