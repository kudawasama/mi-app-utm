# Plan de Implementación: Fase 5 - Edición y Robustez

El objetivo es solucionar los problemas de visibilidad de datos reportados y permitir la edición de registros existentes para mayor flexibilidad.

## Proposed Changes

### [Componente] Interfaz de Usuario (index.html e index.css)

- **Modal de Edición**: Añadir un nuevo modal universal para editar tanto ingresos como gastos.
- **Botones de Edición**: Incorporar un icono de "lápiz" (📝) en cada fila de las tablas.
- **Filtro Relaxed**: Añadir la opción "Ver Todos los Periodos" en el selector global para que el usuario pueda encontrar datos que no coincidan exactamente con un mes.

### [Componente] Lógica de Negocio (app.js)

- **Gestión de Edición**: Funciones para abrir el modal con los datos actuales y guardar los cambios actualizando `localStorage`.
- **Compatibilidad de Datos**: Mejorar el parseo de fechas para que reconozca formatos `YYYY-MM-DD` (formato ISO/Input) y `DD/MM/YYYY` (formato vista) sin romper el filtrado.
- **Filtro Global "all"**: Implementar la lógica para que si el periodo es "all", se desactive el filtrado en el `renderAll()`.

## Verification Plan

### Manual Verification

1. **Edición**: Editar un gasto, cambiarle el monto y la categoría. Verificar que se actualiza en la tabla y en el gráfico.
2. **Carga de Datos**: Cambiar el filtro a "Ver Todos" y confirmar que aparecen registros de cualquier fecha.
3. **Persistencia**: Recargar la página y confirmar que los cambios editados se mantienen.
