# Metodología

[English](METHODOLOGY.md) · **Español** · [Glosario](GLOSSARY.md)

Cada regla que aplica el analizador, con su valor por default y dónde vive en el código. Cada default se puede cambiar en el panel de **Política** (vista de Gerente); al cambiarlo, todo se recalcula en el navegador.

`reference/segment.py` es la fuente de verdad para las secciones 1–6. `js/segment.js` es un port línea por línea, y `test/check.mjs` revisa que reproduzca `reference/expected_results.csv` con la muestra. `test/policy.mjs` prueba cada regla en sus límites con partes construidas a mano.

Notación: `avg` y `sd` son la media y la desviación estándar **poblacional** (ddof = 0) de las 26 semanas de demanda. `R` es el periodo de revisión y `L` el lead time de exposición, ambos en semanas.

---

## 1. Integridad de datos

| Revisión | Efecto | Código |
|---|---|---|
| Falta el lead time | **Bloquea** la parte de la segmentación | `js/segment.js` `analyze()` |
| Costo unitario ≤ 0 o vacío | **Bloquea** | `js/segment.js` `analyze()` |
| Sin demanda en 26 semanas | **Bloquea** | `js/segment.js` `analyze()` |
| MOQ > 8 semanas de demanda promedio (`moq_weeks_flag`) | Advertencia; la parte sí se analiza | `js/segment.js` `analyze()` |
| Número de parte duplicado | Advertencia (solo en la app, no en el Python) | `js/segment.js` `analyze()` |

Las partes bloqueadas quedan fuera del ranking de gasto, así que no mueven la clase ABC de las demás.

## 2. ABC por gasto anual

```
annual_spend = avg × 52 × unit_cost
```

Las partes se ordenan por gasto anual, de mayor a menor. Cada parte recibe la **participación acumulada antes de ella**, así que la parte más grande siempre empieza en 0%.

| Clase | Regla | Default | Código |
|---|---|---|---|
| A | acumulado-antes < `abc_a` | 80% | `js/segment.js` `analyze()` |
| B | acumulado-antes < `abc_b` | 95% | `js/segment.js` `analyze()` |
| C | en otro caso | | `js/segment.js` `analyze()` |
| Super A | acumulado-antes < `super_a` | 50% | `js/segment.js` `analyze()` |

Usar la participación *antes* de la parte significa que la parte que cruza el 80% sigue siendo A.

## 3. XYZ por variabilidad de la demanda

```
CV = sd / avg          zero_share = semanas con demanda 0 / 26
```

| Clase | Regla | Default | Código |
|---|---|---|---|
| Z | zero_share > `zero_share_z` **o** CV ≥ `cv_y` | 30%, 1.0 | `js/segment.js` `analyze()` |
| Y | CV ≥ `cv_x` | 0.5 | `js/segment.js` `analyze()` |
| X | en otro caso | | `js/segment.js` `analyze()` |

## 4. Tendencia

Solo se evalúa cuando zero_share ≤ 30%, porque las partes intermitentes no tienen una tendencia con sentido (`js/segment.js` `analyze()`). La regla compara la media de las últimas `trend_weeks` semanas con la media de las primeras `trend_weeks`.

| Tendencia | Regla | Default | Código |
|---|---|---|---|
| Ramp-up | últimas > `trend_up` × primeras | 1.5× | `js/segment.js` `analyze()` |
| En declive | últimas < `trend_down` × primeras | 0.5× | `js/segment.js` `analyze()` |
| Estable | en otro caso | | |

`trend_weeks` es 8 por default.

## 5. Asignación de programa

La tendencia manda sobre la matriz (`js/segment.js` `recommend()`, `reference/segment.py` `recommend`).

| Condición | Programa | Por qué |
|---|---|---|
| Ramp-up | MRP | La demanda aún no es estable; revisar después del ramp-up |
| En declive | MRP | Riesgo de EOL: no pedirle al proveedor que cargue inventario |
| AX, LT ≥ `vmi_lt_ax` (8 sem) | VMI | Gasto alto, estable, lead time largo: el proveedor carga el pipeline |
| AX, LT menor | CRP | Gasto alto, estable, lead time corto |
| AY, LT ≥ `vmi_lt_ay` (12 sem) | VMI | La variabilidad moderada necesita un LT más largo para justificar VMI |
| AY, LT menor | CRP | |
| BX, costo unitario < `kanban_max_cost` ($1) | Kanban | Gasto medio, estable, barata: dos contenedores |
| BX, costo unitario ≥ $1 | CRP | |
| BY | CRP | |
| CX, CY | Kanban | Gasto bajo: el control más simple |
| AZ, BZ, CZ | MRP | Errática o intermitente: el pull escondería el riesgo |

## 6. Inventario objetivo y días de inventario

Código: `js/segment.js` `computeTarget()`.

| Programa | R (semanas) | L (semanas) | Piso (días) |
|---|---|---|---|
| VMI | 1 | 2 | 14 |
| CRP | 1 | 2 | 14 |
| Kanban | 2 | 2 | 21 |
| MRP | 2 | el lead time de la propia parte | 21 |

En VMI, CRP y Kanban la planta solo está expuesta durante `L`, porque el proveedor reabastece contra consumo. En MRP la planta carga todo el lead time.

El factor de servicio `z` depende de la clase ABC: A 1.65, B 1.65, C 2.05. Las partes C tienen el nivel de servicio más alto porque su inventario es barato, y un faltante de una parte barata para la línea igual.

```
safety  = z × sd × √(R + L)                                   js/segment.js computeTarget()
cycle   = max(avg × R, MOQ) / 2                               js/segment.js computeTarget()
floor   = floor_days × avg / 7                                js/segment.js computeTarget()
target  = max(safety + cycle, floor), redondeado a unidad     js/segment.js computeTarget()
DOS     = cantidad ÷ (avg / 7)   (días naturales)             js/segment.js computeTarget()
```

El panel de detalle de cada parte muestra este cálculo con los números de la parte.

## 7. Exceso y consignación

```
exceso                       = max(0, on_hand − target × tolerance) × unit_cost      js/segment.js computeTarget()
transferencia por consignación = max(0, target − lineside_days × avg/7) × unit_cost  js/segment.js computeTarget()
                               (solo partes VMI, con la consignación encendida)
```

`tolerance` es 1.20 por default y `lineside_days` es 2.

Estas dos cifras nunca se suman. El exceso es ajustar el inventario a su tamaño. La consignación pasa la propiedad del inventario al proveedor, así que no es un ahorro.

### Cómo se conectan las cifras de efectivo

La app muestra tres cifras de efectivo de una sola vez. Cada una está a un paso de la anterior. El puente se calcula en `js/v2.js` `cashBridge()`, se muestra debajo del pipeline de valor del Director y se prueba en `test/v2.mjs`.

| Paso | Muestra |
|---|---|
| **Exceso**: inventario arriba de objetivo × 1.20 (Gerente, Planeador) | $2.66 M |
| + banda de tolerancia: inventario entre el objetivo y objetivo × 1.20 | $0.24 M |
| = liberación bruta: cada parte con sobreinventario llevada a su objetivo | $2.90 M |
| − reabastecimiento: inventario a comprar para las partes abajo del objetivo | $0.63 M |
| = **capital de trabajo neto**: inventario actual − objetivo (Director) | $2.27 M |
| + proyectos de MOQ y LT, que bajan el objetivo mismo | $0.23 M |
| = **pipeline de valor, efectivo de una sola vez** | $2.50 M |

## 8. Carrying cost

```
carrying cost evitado / año = max(0, inventario actual − inventario objetivo) × carrying_rate     js/insights.js insights()
```

`carrying_rate` es 25% anual por default (`js/insights.js` `INSIGHT_DEFAULTS`).

Este es el número recurrente de P&L. Se mantiene aparte del exceso, que es efectivo de una sola vez, y de la consignación, que es una transferencia de propiedad.

## 9. Riesgo de faltante, E&O y olas de implementación

Código: `js/insights.js`.

**Riesgo de faltante** (`js/insights.js` `insights()`)
- Crítico: on hand < safety stock.
- Vigilar: safety stock ≤ on hand < objetivo.
- Reabastecimiento = (objetivo − on hand) × costo.

**Exposición E&O** (`js/insights.js` `insights()`)
- Fórmula: max(0, on hand − consumo de las últimas 8 semanas × `eo_horizon_weeks` (26)) × costo.
- Solo aplica a partes En declive o con más de `eo_dos_days` (180) días de inventario.

**Olas** (`js/insights.js` `insights()`)
- Ola 1: todo lo que no necesita acuerdo con el proveedor (Kanban, regreso a MRP, ajustar inventario sin cambiar de programa).
- Los cambios a VMI/CRP se agrupan por proveedor, ordenados por gasto. Los proveedores cuya participación acumulada antes de ellos es menor a `wave2_share` (70%) van a la Ola 2; el resto, a la Ola 3.

## 10. Cobertura del pipeline (expeditados)

Código: `js/v2.js` `pipeline()`.

```
proyectado[k] = on_hand + PO abierta (desde su semana de entrega) − forecast acumulado,   k = 1..13
```

| Estatus | Regla | Acción del planeador |
|---|---|---|
| Escalar | primera semana corta ≤ lead time (`js/v2.js` `pipeline()`) | **Expeditar**: una PO nueva no llega a tiempo |
| Vigilar | corta solo después del lead time (`js/v2.js` `pipeline()`) | **Colocar PO** a más tardar en la semana = primera semana corta − LT |
| Alerta de forecast | prom(siguientes 13) ÷ prom(últimas 8 reales) > 1.5 o < 0.6 | **Revisar forecast** |

Una parte puede estar corta en el pipeline y en exceso al mismo tiempo. Las dos medidas ven cosas distintas:
- El exceso compara el inventario de hoy con un objetivo dimensionado con el promedio de 26 semanas bajo el programa *recomendado*.
- El faltante viene del plan de abasto de hoy: la PO abierta, el lead time actual y el forecast de 13 semanas.

La línea de detalle del Planeador explica esta diferencia de tiempos, para que nadie cancele la orden que cubre el faltante (`js/layers.js` `plannerActions()`).

## 11. Oportunidades de MOQ y lead time

Código: `js/v2.js` `opportunities()`.

**MOQ**
- Aplica cuando MOQ > `moq_opp_weeks` (4) × avg.
- Valor = max(0, MOQ/2 − avg × R/2) × costo: el inventario de ciclo que agrega el MOQ.

**Lead time**
- Aplica a partes A o Super A con LT > `lt_opp_min_weeks` (12).
- El safety stock z × sd × √(R + LT) se recalcula con LT − `lt_cut_weeks` (4).
- En MRP la planta carga ese colchón, así que el recorte libera efectivo de la planta. En VMI/CRP lo carga el proveedor: es un punto de negociación, no efectivo de la planta.

## 12. Regla de frescura

Código: `js/freshness.js`. La fecha de análisis está fija en 2026-11-04 (`js/freshness.js` `ANALYSIS_DATE`).

**Date code**
- Formato YYWW, leído como la semana ISO WW de 20YY (`js/freshness.js` `parseDateCode()`).
- Fecha de fabricación = lunes de esa semana.

**Regla**
- El `freshness_rule_months` del proveedor (`data/suppliers.csv`).
- Si el proveedor no tiene regla: `fresh_default_rule_months` (24) (`js/freshness.js` `freshness()`).

**Resultados**

| Resultado | Regla | Código |
|---|---|---|
| **Reclamable** (responsabilidad del proveedor) | recibido después de fabricación + regla + `fresh_grace_months` (0) | `js/freshness.js` `freshness()` |
| **Envejecimiento interno** (nuestro, nunca un reclamo) | fresco al recibirse, fuera de regla hoy | `js/freshness.js` `freshness()` |
| **Inválido** | date code o fecha de recepción inválidos, date code posterior a la recepción, o parte que no está en el archivo de partes | `js/freshness.js` `freshness()` |

## 13. Excepciones: severidad y escalamiento

Código: `js/exceptions.js` `severityOf()`.

**Severidad para tipos de abasto**

| Severidad | Regla |
|---|---|
| Crítica | impacto dentro de `exc_now_weeks` (2), o dentro del lead time y ≥ `exc_big_value` ($100 k) |
| Alta | dentro del lead time, o ≥ $100 k |
| Media | tiene un valor |
| Baja | en otro caso |

Los demás tipos de impacto usan solo el valor.

**SLA por severidad:** 1, 3, 10 y 20 días.

**Escalamiento después del SLA** (`js/exceptions.js` `exceptions()`)
- Un pendiente del planeador pasa al gerente, y al director después de dos veces su SLA.
- Un pendiente del gerente pasa al director.

**Conteos entre vistas**
- La pestaña del Gerente y la tarjeta del Director cuentan toda la cola abierta.
- La pestaña del Planeador cuenta solo los pendientes del planeador.
- La lista *Esta semana* del Planeador tiene una fila por parte, no una por excepción.

## 14. Resumen para el Director

Código: `js/v2.js` `turns()`, `dio()`.

```
rotación = gasto anual ÷ inventario
DIO      = inventario ÷ (gasto anual / 365)
```

El pipeline de valor subtotaliza cada tipo de valor por separado y nunca los suma en un solo número. Los tipos son efectivo de una sola vez, P&L por año, recuperación, transferencia de propiedad y riesgo.

## 15. Simulación de retraso de proveedor

Código: `js/whatif.js` `delayScenario()`. Se muestra en Gerente → Pipeline.

- Aplica a las partes del proveedor elegido (o a una parte) que tienen una PO abierta con entrega dentro de las 13 semanas.
- La semana de entrega de la PO se recorre según el retraso. Una PO que pasa de la semana 13 sale del horizonte.
- `pipeline()` (sección 10) se vuelve a correr sobre esas partes, antes y después del retraso.

| Impacto | Regla | Acción |
|---|---|---|
| Expeditar (nuevo) | Escalar después, no antes | Expeditar o buscar segunda fuente (las MLCC ligan al MLCC Alternate Finder) |
| Faltante mayor | Escalar antes y después, con mayor valor de faltante | Expeditar o buscar segunda fuente |
| Ordenar antes | Cubierta antes, Vigilar después | Colocar PO a más tardar en la semana indicada |
| Menos cobertura | Vigilar antes y después, con la primera semana corta antes | Vigilar |
| Sin cambio | en otro caso | |

Valor adicional en riesgo = Σ max(0, valor del faltante después − antes). El valor del faltante es el peor faltante dentro del lead time × costo unitario, como en la sección 10.

## 16. Borrador de propuesta VMI / CRP

Código: `js/proposal.js` `proposal()`. Se muestra en Gerente → Proveedores.

Líneas: las partes del proveedor recomendadas para VMI o CRP. Para cada una:

```
min = safety stock                                   (sección 6)
max = max(safety stock + max(avg × R, MOQ), target)  un ciclo de revisión completo o el MOQ arriba del min
```

Lo que se le pide al proveedor sale del scorecard (la sección 11 para el lead time):

| Petición | Cuándo |
|---|---|
| Acuerdo VMI | hay partes VMI y no hay `vmi_agreement` |
| EDI | el proveedor no tiene `edi_enabled` |
| Consignación | hay partes VMI y la consignación está encendida |
| Reducción de lead time | partes en la lista de oportunidades de LT donde el colchón lo carga el proveedor |
| Plan de OTD | `otd_pct` abajo de `exc_otd_min` (90%) |
| Renovación del hub | contrato del hub que vence dentro de `hub_warn_months` |

La propuesta es un borrador. Su estatus (Borrador → Revisado → Enviado) vive solo en la sesión, y para marcarla Enviado primero hay que marcarla Revisado.

## 17. Revisión de datos y encabezados

**Revisión** (`js/readiness.js` `readiness()`)
- Cada archivo queda **Listo** (todas sus filas coinciden con el archivo de partes), **Parcial** (algunas filas no se pueden usar) o **Falta**.
- En el archivo de partes, Parcial significa que hay partes bloqueadas por datos.
- Cada archivo lista las vistas que alimenta. Una vista aparece como no disponible cuando falta su archivo.

**Encabezados** (`js/headers.js`)
- La comparación ignora mayúsculas, espacios, guiones y puntos.
- Los nombres comunes de exportación del ERP se leen como las columnas canónicas: Item → part_number, Vendor → supplier, Qty On Hand → on_hand_qty, Standard Cost → unit_cost_usd, Min Order Qty → moq, Week 1 → w01.
- Un lead time en días se divide entre 7.
- Si existe la columna canónica, siempre gana sobre el alias.

## 18. Skill de Claude

`claude-skill/pull-program-fit/` corre el mismo motor desde la línea de comandos. `scripts/engine/` es una copia de los módulos de `js/`, generada por `scripts/build-skill.mjs`. `test/skill.mjs` revisa que:
- la copia esté al día;
- la CLI reproduzca `reference/expected_results.csv`;
- los encabezados estilo ERP den las mismas recomendaciones.
