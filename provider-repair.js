/* GoCargo Torre — reparación de asignaciones por proveedor activo */
(() => {
  "use strict";

  const API_REPAIR = {
    UES: "https://fksbytkpdbcjbwakunpp.supabase.co/functions/v1/ues-assignment-repair",
    RYR: "https://ruonmntlrtrtbmvzbnik.supabase.co/functions/v1/ryr-assignment-repair",
  };

  async function repararAsignacionesProveedor(provider, orderCode) {
    const p = String(provider || "UES").toUpperCase();
    const base = API_REPAIR[p];
    if (!base) throw new Error(`Proveedor inválido: ${p}`);

    const res = await fetch(base, {
      method: "POST",
      headers: {
        ...(typeof PASSWORD === "string" && PASSWORD
          ? { "X-Admin-Password": PASSWORD }
          : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orderCode }),
    });

    let data;
    try {
      data = await res.json();
    } catch {
      data = { error: `HTTP ${res.status} sin JSON válido` };
    }

    if (!res.ok || data?.ok === false) {
      const err = new Error(
        data?.error || data?.detalle ||
          `No se pudieron reparar asignaciones de ${p}`,
      );
      err.status = res.status;
      err.data = data;
      err.provider = p;
      throw err;
    }
    return data;
  }

  if (typeof apiProviderSwitch === "function") {
    const apiProviderSwitchOriginal = apiProviderSwitch;
    apiProviderSwitch = async function (provider, action, opts = {}) {
      const p = String(provider || "UES").toUpperCase();
      const data = await apiProviderSwitchOriginal(provider, action, opts);
      const esEntrada = action === "activate" || action === "adopt";
      const confirmado = action === "activate"
        ? data?.activated === true
        : action === "adopt"
        ? data?.adopted === true
        : false;

      if (!esEntrada || !confirmado) return data;

      const orderCode = String(opts?.body?.orderCode || "").trim().toUpperCase();
      if (!/^ORD[A-Z0-9_-]+$/.test(orderCode)) {
        throw new Error(
          `${p} quedó activado, pero no se pudo verificar la ORD para reasignar tareas.`,
        );
      }

      const repair = await repararAsignacionesProveedor(p, orderCode);
      if (repair?.active !== true) {
        throw new Error(
          `${p} quedó vinculado, pero la reparación no lo reconoce como proveedor activo.`,
        );
      }

      const reasignadas = Number(repair?.reassignedTaskIds?.length || 0);
      let continuidad = "";
      try {
        if (typeof apiProvider === "function") {
          const rp = await apiProvider(p, "reprocess", {
            method: "POST",
            body: { order_code: orderCode },
          });
          continuidad = rp?.ok === false
            ? " · el flujo quedó pendiente de un próximo reproceso automático"
            : " · flujo reprocesado";
        }
      } catch (err) {
        continuidad =
          ` · asignación corregida; el flujo continuará automáticamente (${err?.message || err})`;
      }

      const asignacion = reasignadas > 0
        ? ` · ${reasignadas} tarea${reasignadas === 1 ? "" : "s"} abierta${reasignadas === 1 ? "" : "s"} reasignada${reasignadas === 1 ? "" : "s"} y verificada${reasignadas === 1 ? "" : "s"}`
        : " · asignaciones abiertas verificadas";

      return {
        ...data,
        assignmentRepair: repair,
        detalle: `${String(data?.detalle || `${p} activado.`)}${asignacion}${continuidad}`,
      };
    };
  }

  window.refrescarTodo = async function refrescarTodoSoloLectura() {
    const btn = document.getElementById("refreshAllBtn");
    if (btn?.disabled) return;
    const original = btn?.innerHTML || "↻ Actualizar";
    if (btn) { btn.disabled = true; btn.innerHTML = "↻ Actualizando…"; }
    try {
      await Promise.all([
        typeof cargarDashboard === "function" ? cargarDashboard(true) : Promise.resolve(),
        typeof cargarReviews === "function" ? cargarReviews() : Promise.resolve(),
      ]);
      if (typeof toast === "function") {
        toast("Panel actualizado · sin reasignar ni reprocesar pedidos");
      }
    } catch (err) {
      if (typeof toast === "function") toast(err?.message || "No se pudo actualizar");
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = original; }
    }
  };

  function integrarBoton() {
    const actions = document.querySelector(".hero-actions");
    if (!actions) return;
    const buttons = [...actions.querySelectorAll("button")];
    const actualizar = buttons.find((b) =>
      /actualizar/i.test(b.textContent || "")
    );
    const probar = buttons.find((b) =>
      /probar conexiones/i.test(b.textContent || "")
    );
    if (probar) probar.remove();
    if (actualizar) {
      actualizar.title =
        "Actualiza el tablero sin modificar asignaciones ni estados";
    }
  }

  integrarBoton();
  window.GoCargoAssignmentRepair = {
    repair: repararAsignacionesProveedor,
  };
})();
