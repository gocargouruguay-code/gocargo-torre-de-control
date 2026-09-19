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

  window.refrescarTodo = async function refrescarTodoConReparacion() {
    const btn = document.getElementById("refreshAllBtn");
    if (btn?.disabled) return;
    const original = btn?.innerHTML || "↻ Actualizar";
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = "↻ Actualizando…";
      btn.title =
        "Corrige asignaciones del proveedor activo, reprocesa pedidos abiertos, actualiza el panel y prueba conexiones UES / RyR";
    }

    try {
      if (typeof toast === "function") {
        toast("Corrigiendo asignaciones y sincronizando UES / RyR…");
      }

      const [uOpen, rOpen] = await Promise.allSettled([
        apiProvider("UES", "dashboard-list", { query: { kind: "abiertos" } }),
        apiProvider("RYR", "dashboard-list", { query: { kind: "abiertos" } }),
      ]);

      const porOrden = new Map();
      const cargar = (provider, res) => {
        for (const row of rowsDashboard(res)) {
          const orderCode = codigoOrdenRow(row);
          if (!orderCode) continue;
          const set = porOrden.get(orderCode) || new Set();
          set.add(provider);
          porOrden.set(orderCode, set);
        }
      };
      if (uOpen.status === "fulfilled") cargar("UES", uOpen.value);
      if (rOpen.status === "fulfilled") cargar("RYR", rOpen.value);

      const jobs = [];
      const conflictos = [];
      for (const [orderCode, providers] of porOrden.entries()) {
        const lista = [...providers];
        if (lista.length !== 1) {
          conflictos.push({ orderCode, providers: lista });
          continue;
        }
        jobs.push({ provider: lista[0], orderCode });
      }

      const resultados = [];
      let cursor = 0;
      async function worker() {
        while (cursor < jobs.length) {
          const job = jobs[cursor++];
          try {
            const repair = await repararAsignacionesProveedor(
              job.provider,
              job.orderCode,
            );
            const rp = await apiProvider(job.provider, "reprocess", {
              method: "POST",
              body: { order_code: job.orderCode },
            });
            resultados.push({
              provider: job.provider,
              orderCode: job.orderCode,
              ok: rp?.ok !== false,
              repaired: repair?.repaired === true,
              reassigned: Number(repair?.reassignedTaskIds?.length || 0),
            });
          } catch (err) {
            resultados.push({
              provider: job.provider,
              orderCode: job.orderCode,
              ok: false,
              error: err?.message || String(err),
            });
          }
        }
      }

      await Promise.all([worker(), worker()]);
      await new Promise((r) => setTimeout(r, 700));
      await Promise.allSettled([
        typeof cargarDashboard === "function"
          ? cargarDashboard(true)
          : Promise.resolve(),
        typeof cargarReviews === "function"
          ? cargarReviews()
          : Promise.resolve(),
      ]);

      if (typeof probarConexiones === "function") {
        try {
          await probarConexiones();
        } catch {
        }
      }

      const ok = resultados.filter((x) => x.ok).length;
      const fail = resultados.length - ok;
      const reasignadas = resultados.reduce(
        (acc, x) => acc + Number(x.reassigned || 0),
        0,
      );
      const fuentesFallidas = [];
      if (uOpen.status === "rejected") fuentesFallidas.push("UES");
      if (rOpen.status === "rejected") fuentesFallidas.push("RyR");

      if (typeof toast === "function") {
        if (jobs.length === 0 && conflictos.length === 0) {
          toast(
            fuentesFallidas.length
              ? `Panel actualizado · no se pudo consultar ${fuentesFallidas.join(" y ")}`
              : "Panel actualizado · no había pedidos abiertos para sincronizar",
          );
        } else if (
          fail === 0 && conflictos.length === 0 && fuentesFallidas.length === 0
        ) {
          toast(
            `Panel sincronizado · ${ok} pedido${ok === 1 ? "" : "s"} revisado${ok === 1 ? "" : "s"}` +
              (reasignadas
                ? ` · ${reasignadas} tarea${reasignadas === 1 ? "" : "s"} reasignada${reasignadas === 1 ? "" : "s"}`
                : ""),
          );
        } else {
          toast(
            `Panel sincronizado · ${ok} OK · ${fail} con error` +
              (conflictos.length
                ? ` · ${conflictos.length} ORD con UES y RyR abiertos (sin reasignar)`
                : "") +
              (fuentesFallidas.length
                ? ` · sin consultar ${fuentesFallidas.join("/")}`
                : ""),
          );
        }
      }
    } catch (err) {
      if (typeof toast === "function") {
        toast(err?.message || "No se pudo sincronizar el panel");
      }
      try {
        await Promise.allSettled([
          cargarDashboard(true),
          cargarReviews(),
        ]);
      } catch {
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = original;
      }
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
        "Corrige asignaciones del proveedor activo, reprocesa pedidos abiertos, actualiza el panel y prueba conexiones UES / RyR";
    }
  }

  integrarBoton();
  window.GoCargoAssignmentRepair = {
    repair: repararAsignacionesProveedor,
  };
})();
