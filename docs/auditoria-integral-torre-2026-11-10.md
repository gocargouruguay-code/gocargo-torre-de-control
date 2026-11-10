# Auditoría integral — Torre de Control GoCargo

**Fecha:** 2026-11-10 (Uruguay)  
**Alcance auditado:** interfaz web de la Torre (`gocargo-torre-de-control`), backend UES (`fksbytkpdbcjbwakunpp`), backend RyR (`ruonmntlrtrtbmvzbnik`), cron activos/inactivos, configuración de webhooks, colas y seguridad básica de Supabase.  
**No incluido:** auditoría profunda de Contable ni de toda la API SendGround; no se ejecutaron pruebas destructivas en pedidos activos.

## 1. Flujos previstos

| Etapa | UES/WES | RyR/R&R |
|---|---|---|
| Transferencia a depósito | Car One, locationId 743 | Shangrilá, locationId 78623 |
| Alta automática de envío | 14:00, 14:30, 15:00, 15:30, 16:00 UYT | Mismos horarios |
| Recepción / Almacenamiento | Asignar solo cuando no haya responsable, worker 133 | Idéntica regla, worker 135 |
| Despacho | Asignar únicamente si Entrega ya está asignada a UES | Misma condición, Entrega asignada a RyR |
| Verificación de asignaciones | 4 veces/día | 4 veces/día |
| Estados intermedios ASIGNADO y EN TRÁNSITO | Ambos vienen por webhook UES, mapeados en `ues-sendground-mapping.ts` | C1 no los notifica; cron selectivo 10:30, 12:30, 15:30 y 18:00 UYT |
| Finales (entregado/fallido/devolución/cancelado) | Webhook UES, con cola de pendiente_ruteo | Webhook C1 HMAC-SHA256, con cola local |
| Poller antiguo de estados | Cron ID 18 inactivo | Cron ID 1 inactivo |

No cambiar automáticamente una tarea que ya tiene cualquier responsable. El cambio manual de proveedor desde la Torre es una excepción explícita, auditada y separada.

## 2. Hallazgos y correcciones aplicadas

### Resueltos en producción y GitHub
1. **Cron duplicado RyR:** los jobs 5 y 7 ejecutaban la misma función a la misma hora (10:30, 12:30, 15:30). El job ID 5 fue desactivado. Quedaron activos ID 7 para las primeras tres ejecuciones e ID 6 para las 18:00; el cron masivo ID 1 sigue apagado.
2. **Frontend obsoleto e inseguro operativamente:** `app-base.html` contenía un refresco con reproceso masivo de todos los pedidos. Ahora redirige al `index.html` actual. Se eliminó `provider-repair.js`, auxiliar sin referencia desde el frontend principal; el historial está preservado en GitHub.
3. **Refrescos demasiado frecuentes:** `index.html` consultaba UES y RyR cada 60 segundos por pestaña abierta. Ahora consulta cada cinco minutos y omite la operación con pestaña oculta. El botón manual Actualizar conserva lectura inmediata.
4. **Escrituras durante la lectura de la Torre:** se retiraron POST automáticos de conciliación de revisiones UES/RyR que se ejecutaban al refrescar el panel. Las acciones manuales se mantienen.
5. **UES admin hacía polling invisible durante GET de tablero:** se retiraron verificaciones externas de SendGround por cada error histórico en `count`, `dashboard` y `dashboard-list`. Estos endpoints utilizan eventos y estados persistidos. `reprocess` explícito conserva verificación por pedido.
6. **Indicadores engañosos:** se eliminó del panel la tarjeta del poller nocturno UES (inactivo) y se corrigió el horario de alta; RyR ahora reporta los webhooks realmente recibidos en el día desde `ryr_webhook_eventos`. No se inventan contadores de POD/entregados RyR sin fuente equivalente confirmada.
7. **Permisos de trigger functions:** revocados EXECUTE para PUBLIC/anon/authenticated en funciones SECURITY DEFINER de triggers; service_role conserva acceso. Se fijaron search_path de triggers PL/pgSQL. La comprobación posterior de advisors no mostró WARN; solo INFO de RLS habilitada sin políticas, acorde con el patrón service_role restringido.

### Verificado, sin cambios
- Cron de altas UES/RyR: 5 ejecuciones por proveedor/día.
- Cron de asignaciones: 4 por proveedor/día.
- UES WhatsApp: cuatro jobs con propósitos de monitoreo operativo; 55 ejecuciones en 7 días, sin errores cron reportados. Conservar hasta comprobar la utilidad real de las alertas.
- Los botones **Enviar manualmente**, **Cambiar proveedor**, **Procesar transferencias atrasadas**, **Reprocesar una ORD** siguen disponibles y separados del refresco.
- No se eliminaron tablas de eventos ni historial de incidencias.

## 3. Datos operativos observados

| Métrica | UES | RyR |
|---|---:|---:|
| Vínculos totales | 636 | 154 |
| Vínculos abiertos | 43 | 37 |
| Webhooks históricos almacenados | 1.085 | 1 |
| Último webhook UES observado | 2026-11-09 11:38:52 UTC | — |
| Eventos UES últimos 7 días | 99 (19 aplicados, 80 no aplicados al recibirlos) | — |
| Errores históricos procesados/registrados | 235 fallidos UES | 5 vínculos abiertos con last_error, 3 de permisos históricos |
| Pendientes actuales en cola de ruteo | 0 | 0 |
| RyR primer webhook real | — | OnOrderDelivered de ORD4733 / ORD47EB, procesado |

Un evento con processing_ok=false no equivale automáticamente a un problema vigente: puede haberse recibido antes del ruteo y haber quedado superado por eventos posteriores. No borrar fallos históricos sin cotejar orden y secuencia temporal.

## 4. Hallazgos pendientes y riesgos

1. **UES:** estudiar 235 fallos históricos (principalmente bloqueos de Despacho anteriores a la cola) y distinguir errores reales de situaciones operativas superadas. En los últimos siete días, 80/99 webhooks quedaron marcados no aplicados al recibirlos. El esquema nuevo `pendiente_ruteo` no corrige automáticamente los fallos históricos. Validar eventos recientes con órdenes activas antes de dar por sana la recepción.
2. **RyR:** verificar en una entrega realmente activa una transición de `InProgress` detectada por el cron selectivo y su efecto en GoCargo. Se validaron un webhook real de orden cerrada y una lectura puntual sin cambios; no un caso vivo `InProgress`.
3. **Incidencias viejas RyR:** tres vínculos abiertos conservan errores de permisos de Warehouse Go Cargo del antiguo bridge. No insistir ni borrar a ciegas; cotejar responsable, ancla y estado de cada tarea.
4. **Telemetría:** contar aplicaciones reales de eventos y alertas pendientes, no confundir un HTTP 200 de pg_cron con éxito de cada pedido. Las ejecuciones pg_cron exitosas solo confirman que se encoló la llamada HTTP.
5. **RLS:** varios advisors informativos `rls_enabled_no_policy`. Es deliberado cuando el acceso a las tablas se limita a service_role, pero conviene verificar grants y excepciones al evolucionar el sistema.
6. **Criterio de limpieza:** no eliminar `ues-poller` ni `ryr-poller` como funciones todavía. Sus cron están inactivos; `reprocess` manual por una ORD puede reutilizarlos. No eliminar scripts de integración de cambio manual de proveedor.

## 5. Decisión sobre cron UES

**No reactivar el poller general UES ni crear un cron equivalente al de estados intermedios de RyR.** El webhook UES sí soporta `ASIGNADO` (Despacho InProgress) y `EN TRÁNSITO` (Entrega InProgress). Los webhooks son la fuente principal, con asignaciones y replay de eventos pendientes controlados cuatro veces al día. Si se comprueban pérdidas reales de webhooks, crear recuperación puntual por órdenes afectadas, no reactivar barridos de los 636 históricos ni de todos los abiertos.

## 6. Referencias de cambios
- Torre: PR #3 — limpieza legacy, refresh cada cinco minutos, GET sin conciliaciones automáticas.
- UES: PR #7 — dashboard solo lectura local; PR #8 — endurecimiento seguridad.
- RyR: PR #7 — métrica real de webhooks; PR #8 — endurecimiento seguridad.
- RyR: cron duplicado ID 5 apagado en producción.
